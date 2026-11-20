/*
  LEER Y DIVIDIR EL PDF DE NÓMINAS (todo ocurre en el navegador; no se envía nada)
  ------------------------------------------------------------------------------
  · Lee el texto de cada página con pdf.js.
  · Busca el NIF del trabajador (DNI o NIE con la letra correcta) en el recuadro «TRABAJADOR»,
    el nombre («APELLIDOS, NOMBRE») y el periodo («Del 1 de NOVIEMBRE de 2026 …»).
    El NIF del colegio (R…) no es un DNI válido y además se descarta expresamente.
  · Une las páginas seguidas del mismo NIF (nóminas de más de una hoja).
  · Empareja con el personal: por la «huella» del NIF (si ya se conoce de otros meses) y por el nombre.
  · Divide el PDF con pdf-lib.
*/
(() => {
  const LETRAS = "TRWAGMYFPDXBNJZSQVHLCKE";
  const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
  const VACIAS = new Set(["DE", "DEL", "LA", "LAS", "LOS", "Y", "I", "SAN", "SANTA"]);

  const normal = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
    .replace(/\bM[ªA]?\.\s*|\bMª\s*/g, "MARIA ").replace(/[^A-ZÑ0-9, '-]/g, " ").replace(/\s+/g, " ").trim();

  function nifValido(s) {
    const t = String(s).toUpperCase().replace(/[\s.-]/g, "");
    let num;
    if (/^\d{8}[A-Z]$/.test(t)) num = t.slice(0, 8);
    else if (/^[XYZ]\d{7}[A-Z]$/.test(t)) num = "XYZ".indexOf(t[0]) + t.slice(1, 8);
    else return null;
    return LETRAS[parseInt(num, 10) % 23] === t[8] ? t : null;
  }

  // Tokens de un nombre, sin palabras vacías
  const tokens = (s) => normal(s).replace(/,/g, " ").split(" ").filter((w) => w.length > 1 && !VACIAS.has(w));

  // ¿Es el mismo nombre? Compara palabras en común (orden y tildes no importan)
  function parecido(nombreNomina, nombrePersona) {
    const a = new Set(tokens(nombreNomina)), b = tokens(nombrePersona);
    if (!a.size || !b.length) return 0;
    const comunes = b.filter((w) => a.has(w)).length;
    return comunes / Math.min(a.size, b.length) * (comunes >= 2 ? 1 : 0.5);
  }

  async function huella(nif) {
    const datos = new TextEncoder().encode("nominas-nervion|" + nif);
    const h = await crypto.subtle.digest("SHA-256", datos);
    return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }

  // Analiza el texto de una página
  function analizar(items, nifEmpresa = []) {
    const excluir = new Set(nifEmpresa.map((x) => x.toUpperCase()));
    const texto = items.map((i) => i.str).join(" ").replace(/\s+/g, " ");
    const T = normal(texto);
    const iTrab = items.findIndex((i) => /TRABAJADOR/i.test(i.str));
    const pTrab = iTrab >= 0 ? items[iTrab].pos : null;

    // NIF: todos los DNI/NIE válidos de la página; si hay varios, el más cercano al recuadro «Trabajador»
    const candidatos = [];
    items.forEach((it, idx) => {
      const trozos = it.str.toUpperCase().match(/[XYZ]?\d[\d .-]{6,10}[A-Z]/g) || [];
      for (const tr of trozos) {
        const n = nifValido(tr);
        if (n && !excluir.has(n)) candidatos.push({ n, idx, pos: it.pos });
      }
    });
    if (!candidatos.length) { // por si el NIF viene partido en dos trozos de texto
      for (const m of texto.toUpperCase().matchAll(/[XYZ]?\d[\d .-]{6,10}[A-Z]/g)) {
        const n = nifValido(m[0]); if (n && !excluir.has(n)) candidatos.push({ n, idx: 0, pos: null });
      }
    }
    let nif = null;
    if (candidatos.length) {
      const dist = (c) => (pTrab && c.pos) ? Math.hypot(c.pos[0] - pTrab[0], c.pos[1] - pTrab[1]) : Math.abs(c.idx - iTrab);
      nif = candidatos.sort((x, y) => dist(x) - dist(y))[0].n;
    }

    // Nombre: el primer «APELLIDOS, NOMBRE» en mayúsculas después de «TRABAJADOR»
    let nombre = null;
    const patron = /^[A-ZÁÉÍÓÚÜÑÇ][A-ZÁÉÍÓÚÜÑÇ' .-]+,\s*[A-ZÁÉÍÓÚÜÑÇ][A-ZÁÉÍÓÚÜÑÇ' .-]+$/;
    for (let k = Math.max(iTrab, 0); k < items.length && !nombre; k++) {
      const s = items[k].str.trim();
      if (patron.test(s) && !/(^|\s)S\.?\s?[LA]\.?U?\.?$|SALESIANAS|EMPRESA/.test(normal(s))) nombre = s;
    }
    if (!nombre && iTrab >= 0) {
      const m = normal(texto.slice(texto.search(/TRABAJADOR/i))).match(/TRABAJADOR:?\s*(?:N\.?I\.?F\.?:?\s*\S+\s*)?([A-ZÑ' -]+,\s*[A-ZÑ' -]+?)(?=\s+N |\s+NO? AFILIACION|\s+NUM|\s+CATEGORIA|$)/);
      if (m) nombre = m[1].trim();
    }

    // Periodo
    let periodo = null;
    const mp = T.match(/DEL?\s+\d{1,2}\s+DE\s+([A-Z]+)\s+DE\s+(\d{4})/);
    if (mp && MESES.includes(mp[1])) periodo = `${mp[2]}-${String(MESES.indexOf(mp[1]) + 1).padStart(2, "0")}`;

    return { nif, nombre, periodo, tieneTexto: texto.trim().length > 20, esCabecera: iTrab >= 0 };
  }

  async function leerPdf(bytes, { onProgreso, miniaturas = true } = {}) {
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    const paginas = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const pag = await pdf.getPage(p);
      const tc = await pag.getTextContent();
      const items = tc.items.map((i) => ({ str: i.str, pos: [i.transform[4], i.transform[5]] }));
      let mini = null;
      if (miniaturas) {
        const vp = pag.getViewport({ scale: 0.35 });
        const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
        await pag.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
        mini = c.toDataURL("image/jpeg", 0.6);
      }
      paginas.push({ n: p, items, mini });
      onProgreso?.(p, pdf.numPages);
    }
    return paginas;
  }

  // Agrupa las páginas en nóminas. Devuelve { nominas: [...], sueltas: [...] }
  function agrupar(paginas, nifEmpresa) {
    const nominas = [], sueltas = [];
    let ultima = null;
    for (const p of paginas) {
      const a = analizar(p.items, nifEmpresa);
      p.analisis = a;
      if (a.nif) {
        if (ultima && ultima.nif === a.nif && ultima.paginas[ultima.paginas.length - 1] === p.n - 1) { ultima.paginas.push(p.n); continue; }
        ultima = { id: "n" + p.n, nif: a.nif, nombre: a.nombre, periodo: a.periodo, paginas: [p.n], mini: p.mini };
        nominas.push(ultima);
      } else {
        sueltas.push({ n: p.n, mini: p.mini, motivo: !a.tieneTexto ? "Sin texto (página escaneada o en blanco)" : a.esCabecera ? "Tiene recuadro «Trabajador» pero no se lee un NIF válido" : "Sin NIF de trabajador (¿resumen o página de continuación?)", anterior: ultima?.id || null, accion: "fuera" });
      }
    }
    return { nominas, sueltas };
  }

  // Empareja cada nómina con una persona del personal
  async function emparejar(nominas, personal, huellas) {
    const porEmail = new Map(personal.map((p) => [p.email, p]));
    const porHuella = new Map(huellas.map((h) => [h.huella, h.email]));
    const usados = new Map();
    for (const n of nominas) {
      n.huella = n.nif ? await huella(n.nif) : null;
      n.email = null; n.estado = "rojo"; n.motivo = ""; n.confirmada = false; n.candidatos = [];
      const conocido = n.huella && porHuella.get(n.huella);
      const ranking = personal.map((p) => ({ p, s: n.nombre ? parecido(n.nombre, p.nombre) : 0 })).filter((x) => x.s >= 0.66).sort((a, b) => b.s - a.s);
      n.candidatos = ranking.slice(0, 5).map((x) => x.p.email);
      if (conocido) {
        const p = porEmail.get(conocido);
        if (!p) { n.motivo = "Este NIF era de una persona que ya no está en el personal del colegio"; }
        else if (!n.nombre || parecido(n.nombre, p.nombre) >= 0.66) { n.email = p.email; n.estado = "ok"; n.motivo = "NIF ya conocido y nombre coincidente"; }
        else { n.motivo = `El NIF corresponde a «${p.nombre}», pero el nombre de la nómina no coincide`; n.candidatos = [p.email, ...n.candidatos.filter((e) => e !== p.email)]; }
      } else if (ranking.length === 1 || (ranking.length > 1 && ranking[0].s > ranking[1].s)) {
        n.email = ranking[0].p.email; n.estado = "amb"; n.motivo = "Primera vez que aparece este NIF: comprueba la persona y confírmalo (se recordará)";
      } else if (ranking.length > 1) {
        n.estado = "amb"; n.motivo = "Hay varias personas con un nombre parecido: elige la correcta";
      } else {
        n.motivo = n.nombre ? "No se encuentra a nadie con ese nombre en el personal (¿sin cuenta del colegio?)" : "No se lee el nombre";
      }
      if (n.email) usados.set(n.email, (usados.get(n.email) || 0) + 1);
    }
    for (const n of nominas) if (n.email && usados.get(n.email) > 1 && n.estado === "ok") { n.estado = "amb"; n.motivo = "Hay más de una nómina para esta persona en este PDF: confírmalo"; }
    return nominas;
  }

  // Crea el PDF de una nómina con las páginas indicadas (y la nota de copia, si hace falta)
  async function extraer(docOriginal, paginas, nota) {
    const nuevo = await PDFLib.PDFDocument.create();
    const copias = await nuevo.copyPages(docOriginal, paginas.map((n) => n - 1));
    const fuente = nota ? await nuevo.embedFont(PDFLib.StandardFonts.Helvetica) : null;
    for (const c of copias) {
      nuevo.addPage(c);
      if (nota) c.drawText(nota, { x: 18, y: 6, size: 6, font: fuente, color: PDFLib.rgb(0.35, 0.35, 0.35) });
    }
    nuevo.setTitle("Nómina"); nuevo.setProducer("Mis nóminas · Salesianas Nervión"); nuevo.setCreator("Mis nóminas");
    return await nuevo.save();
  }

  async function sha256Hex(bytes) {
    const h = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }

  window.LeerNominas = { leerPdf, agrupar, emparejar, extraer, huella, nifValido, parecido, sha256Hex, normal, MESES };
})();
