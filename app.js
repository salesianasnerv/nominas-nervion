/* Mis nóminas · Escuelas Salesianas María Auxiliadora · Nervión
   - Cada trabajador ve y descarga sus nóminas (enlaces de 60 s, cada apertura queda anotada).
   - Quien tiene el permiso «nominas» (titular y Administración) sube el PDF, revisa y publica.
   Con ?demo funciona sin Supabase, con datos inventados, y nada sale del navegador. */
(() => {
  const CFG = window.APP_CONFIG;
  const DEMO = !CFG.supabaseUrl || new URLSearchParams(location.search).has("demo");
  const L = window.LeerNominas;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const mesTxt = (p) => { const [a, m] = String(p).slice(0, 7).split("-"); return `${MESES[+m - 1]} ${a}`; };
  const fecha = (t) => t ? new Date(t).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const fechaCorta = (t) => t ? new Date(t).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
  const tapar = (nif) => nif ? "···· " + nif.slice(-4, -1) + " " + nif.slice(-1) : "—";
  if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const S = { user: null, gestor: false, mias: [], personal: [], huellas: [], lote: null };

  // ─── Diálogo ───
  function preguntar(titulo, html, { si = "Aceptar", no = "Cancelar" } = {}) {
    const d = $("#dlg");
    $("#dlgT").textContent = titulo; $("#dlgTxt").innerHTML = html;
    $("#dlgSi").textContent = si; $("#dlgNo").textContent = no; $("#dlgNo").hidden = !no;
    d.returnValue = ""; d.showModal();
    return new Promise((ok) => d.addEventListener("close", () => ok(d.returnValue === "si"), { once: true }));
  }
  const avisar = (titulo, html) => preguntar(titulo, html, { si: "Entendido", no: "" });

  // ─── Datos: Supabase o modo prueba ───
  const sb = DEMO ? null : supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
  const ok = (r) => { if (r.error) throw r.error; return r.data; };

  const remoto = {
    async sesion() {
      let { data: { session } } = await sb.auth.getSession();
      if (!session && await window.TeamsSSO?.entrar(sb)) ({ data: { session } } = await sb.auth.getSession());
      if (!session) return null;
      const u = session.user, email = (u.email || "").toLowerCase();
      if (![CFG.dominio, ...(CFG.dominiosExtra || [])].some((d) => email.endsWith("@" + d))) {
        await sb.auth.signOut(); throw new Error(`Solo se permite el acceso con cuentas @${CFG.dominio}.`);
      }
      return { email, nombre: u.user_metadata?.full_name || u.user_metadata?.name || email };
    },
    async login() {
      if (await window.TeamsSSO?.entrar(sb)) return location.reload();
      ok(await sb.auth.signInWithOAuth({ provider: "azure", options: { scopes: "email profile", redirectTo: location.origin + location.pathname } }));
    },
    async logout() { await sb.auth.signOut(); location.reload(); },
    async soyGestor() { const r = await sb.rpc("nom_soy_gestor"); return !r.error && r.data === true; },
    async mias() { return ok(await sb.rpc("nom_mis_nominas")); },
    async abrir(id, accion, nombreArchivo) {
      const ruta = ok(await sb.rpc("nom_abrir", { p_id: id, p_accion: accion }));
      const r = ok(await sb.storage.from("nominas").createSignedUrl(ruta, 60, accion === "descargar" ? { download: nombreArchivo } : undefined));
      return r.signedUrl;
    },
    async personal() { return ok(await sb.rpc("nom_personal")); },
    async huellas() { return ok(await sb.rpc("nom_huellas")); },
    async crearRemesa(periodo, tipo, firma, avisar) { return ok(await sb.rpc("nom_crear_remesa", { p_periodo: periodo + "-01", p_tipo: tipo, p_firma: firma, p_avisar: avisar })); },
    async subir(ruta, bytes) { ok(await sb.storage.from("nominas").upload(ruta, new Blob([bytes], { type: "application/pdf" }), { contentType: "application/pdf", upsert: false })); },
    async publicar(remesa, items, original) { return ok(await sb.rpc("nom_publicar", { p_remesa: remesa, p_items: items, p_original: original })); },
    async remesas() { return ok(await sb.rpc("nom_remesas_lista")); },
    async registro() { return ok(await sb.rpc("nom_registro_lista", { p_limite: 200 })); },
    async retirar(id) { ok(await sb.rpc("nom_retirar", { p_remesa: id })); },
    async abrirOriginal(id) {
      const ruta = ok(await sb.rpc("nom_abrir_original", { p_remesa: id }));
      return ok(await sb.storage.from("nominas").createSignedUrl(ruta, 60)).signedUrl;
    },
    // Borra del almacén los archivos de remesas retiradas o caducadas
    async limpiar() {
      try {
        await sb.rpc("nom_limpiar_borradores");
        const rutas = ok(await sb.rpc("nom_archivos_a_borrar"));
        if (!rutas?.length) return;
        const lista = rutas.map((r) => typeof r === "string" ? r : r.nom_archivos_a_borrar);
        const { error } = await sb.storage.from("nominas").remove(lista);
        if (!error) await sb.rpc("nom_archivos_borrados", { p_rutas: lista });
      } catch (e) { console.warn("Limpieza pendiente", e); }
    },
  };

  // Modo prueba: personal y nóminas inventados
  const DEMO_PERSONAL = [
    ["marta.alba@salesianas.org", "Marta Alba Inventada"], ["juan.blanco@salesianas.org", "Juan Blanco Ejemplo"],
    ["rosa.castro@salesianas.org", "Rosa Castro Ficticia"], ["ana.diaz@salesianas.org", "Ana Díaz Ejemplo"],
    ["luis.esteban@salesianas.org", "Luis Esteban Modelo"], ["lucia.ejemplo@salesianas.org", "Lucía Ejemplo Ficticia"],
    ["mª.gil@salesianas.org", "Mª Ángeles Gil Prueba"], ["pablo.inventado@salesianas.org", "Pablo Inventado Ruiz"],
  ].map(([email, nombre]) => ({ email, nombre }));
  const demo = {
    _rem: [], _reg: [], huellasConocidas: [],
    async sesion() { return { email: "lucia.ejemplo@salesianas.org", nombre: "Lucía Ejemplo Ficticia (prueba)" }; },
    async login() {}, async logout() { location.href = location.pathname; },
    async soyGestor() { return true; },
    async mias() {
      const hoy = new Date(), out = [];
      for (let i = 1; i <= 14; i++) {
        const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
        out.push({ id: "d" + i, periodo: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`, tipo: "Nómina mensual", paginas: 1,
          publicada: new Date(d.getFullYear(), d.getMonth(), 28).toISOString(), ultima_apertura: i === 1 ? null : new Date(d.getFullYear(), d.getMonth(), 29).toISOString() });
        if (d.getMonth() === 5 || d.getMonth() === 11) out.push({ ...out[out.length - 1], id: "e" + i, tipo: "Paga extra", ultima_apertura: null });
      }
      return out;
    },
    async abrir(id, accion) {
      const n = (await this.mias()).find((x) => x.id === id);
      const bytes = await pdfEjemplo([{ nif: "53412769K", nombre: "EJEMPLO FICTICIA, LUCIA", periodo: n.periodo }]);
      return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    },
    async personal() { return DEMO_PERSONAL; },
    async huellas() { return this.huellasConocidas; },
    async crearRemesa() { return "demo-" + Date.now(); },
    async subir() { await new Promise((r) => setTimeout(r, 15)); },
    async publicar(remesa, items) {
      for (const it of items) if (it.huella && !this.huellasConocidas.some((h) => h.huella === it.huella)) this.huellasConocidas.push({ huella: it.huella, email: it.email });
      const l = S.lote;
      this._rem.unshift({ id: remesa, periodo: l.periodo + "-01", tipo: l.tipo, firma: l.firma, n: items.length, abiertas: 0, publicada: new Date().toISOString(), tiene_original: l.firma === "original" });
      this._reg.unshift({ cuando: new Date().toISOString(), nombre: S.user.nombre, accion: "publicar", periodo: l.periodo + "-01", tipo: l.tipo, detalle: items.length + " nóminas" });
      return items.length;
    },
    async remesas() { return this._rem; },
    async registro() { return this._reg; },
    async retirar(id) { const r = this._rem.find((x) => x.id === id); r.retirada = new Date().toISOString(); this._reg.unshift({ cuando: r.retirada, nombre: S.user.nombre, accion: "retirar", periodo: r.periodo, tipo: r.tipo }); },
    async abrirOriginal() { throw new Error("En modo prueba no se guarda el original."); },
    async limpiar() {},
  };
  const api = DEMO ? demo : remoto;

  // PDF de ejemplo con nóminas inventadas (sirve para probar sin usar nóminas reales)
  async function pdfEjemplo(lista) {
    const doc = await PDFLib.PDFDocument.create();
    const f = await doc.embedFont(PDFLib.StandardFonts.Helvetica), fb = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const MES = L.MESES;
    for (const x of lista) {
      const pg = doc.addPage([595, 842]);
      const t = (s, X, Y, o = {}) => pg.drawText(s, { x: X, y: Y, size: o.size || 9, font: o.b ? fb : f });
      if (x.resumen) { t("RESUMEN DE LA EMPRESA · TOTALES DEL MES", 60, 780, { b: true, size: 12 }); t("Total devengado ........ 000.000,00", 60, 740); continue; }
      if (x.continua) { t("(continuación)", 60, 780); t("Desglose de conceptos ...", 60, 760); continue; }
      // Misma estructura que la nómina de la gestoría (todos los datos inventados)
      const negro = PDFLib.rgb(0, 0, 0), caja = (x0, y0, w, h) => pg.drawRectangle({ x: x0, y: y0, width: w, height: h, borderWidth: 0.8, borderColor: negro });
      const der = (s, X, Y, o = {}) => t(s, X - (o.b ? fb : f).widthOfTextAtSize(s, o.size || 9), Y, o);
      caja(40, 700, 255, 105); caja(305, 700, 255, 105);
      t("EMPRESA:", 48, 790, { b: true }); t("(11)", 100, 790); t("N.I.F.:  R4100211D", 205, 790);
      t("ESC. SALESIANAS Ma AUXILIADORA", 48, 772); t("DOMICILIO:  CL EJEMPLO, no1", 48, 756); t("LOCALIDAD:  SEVILLA - 00000", 48, 742);
      t("COD. CUENTA COTIZACION:  00/0000000/00", 48, 726);
      t("TRABAJADOR:", 313, 790, { b: true }); t("N.I.F.:  " + x.nif, 455, 790); t(x.nombre, 313, 772);
      t("No Afiliacion:  00/00000000/00", 313, 756); t("OCUPACION:", 490, 756);
      t("CATEGORIA:  PROF. EJEMPLO", 313, 742); t("FECHA ANTIGUEDAD:  01/09/2000   G.COTIZACION: 1", 313, 726);
      const [a, m] = x.periodo.split("-"), mes = MES[+m - 1], dias = new Date(+a, +m, 0).getDate();
      t("PERIODO DE LIQUIDACION:", 40, 682, { b: true }); t(`Del 1 de ${mes} de ${a} al ${dias} de ${mes} de ${a}`, 220, 682); t("DIAS:  30", 500, 682);
      caja(40, 150, 255, 520); caja(305, 150, 255, 520);
      t("I. DEVENGOS", 48, 655, { b: true }); t("1. Percepciones Salariales", 56, 640);
      t("Valor", 190, 640); t("d/h", 225, 640); t("Importe", 252, 640);
      const conceptos = [["001-Salario base (ejemplo)", "1.000,00"], ["003-Antiguedad (ejemplo)", "100,00"], ["004-Complemento autonomico", "50,00"], ["039-Equiparacion salarial", "25,00"]];
      conceptos.forEach(([c, v], k) => { t(c, 56, 622 - k * 15); t("30", 228, 622 - k * 15); der(v, 288, 622 - k * 15); });
      t("Total Percepciones Salariales (1) ......", 70, 545); der("1.175,00", 288, 545, { b: true });
      t("Total Devengado (1) ..................", 70, 165); der("1.175,00", 288, 165, { b: true });
      t("(A) TOTAL DEVENGADO (1) .......", 313, 655); der("1.175,00", 552, 655, { b: true });
      t("II. DEDUCCIONES", 313, 635, { b: true }); t("1. Aportacion del Trabajador a las cotizaciones de la S. Social", 313, 620, { size: 8 });
      [["Contin. Comunes", "55,23"], ["Mecanismo Equidad In", "1,76"], ["Desempleo", "18,21"], ["Formacion profesional", "1,18"]].forEach(([c, v], k) => { t(c, 320, 604 - k * 14); der(v, 552, 604 - k * 14); });
      t("Total Aportaciones ..............", 380, 530); der("76,38", 552, 530, { b: true });
      t("2. Impuesto renta personas fisicas", 313, 500, { size: 8 }); t("Retenciones I.R.P.F.   1.175,00 * 10,00%", 320, 485); der("117,50", 552, 485, { b: true });
      t("(B) TOTAL A DEDUCIR ............", 313, 165); der("193,88", 552, 165, { b: true });
      t("LIQUIDO A PERCIBIR (A - B) Euros", 305, 132, { b: true, size: 11 }); der("981,12", 552, 132, { b: true, size: 12 });
      t("DATOS INVENTADOS - EJEMPLO PARA PROBAR LA WEB", 150, 60, { b: true, size: 12 });
    }
    return await doc.save();
  }
  // Nombre de quien ha entrado en formato de nómina: «APELLIDOS, NOMBRE» (las dos últimas palabras como apellidos)
  function nombreNomina(n) {
    const w = L.normal(n).replace(/[^A-ZÑ ]/g, " ").split(" ").filter(Boolean);
    if (w.length < 2) return null;
    const k = w.length >= 3 ? 2 : 1;
    return `${w.slice(-k).join(" ")}, ${w.slice(0, -k).join(" ")}`;
  }
  async function generarEjemplo() {
    const p = $("#sMes").value || new Date().toISOString().slice(0, 7);
    const yo = !DEMO && S.user ? nombreNomina(S.user.nombre) : null;
    const lista = [
      ...(yo ? [{ nif: "00000000T", nombre: yo }] : []),
      { nif: "11111111H", nombre: "ALBA INVENTADA, MARTA" }, { nif: "22222222J", nombre: "BLANCO EJEMPLO, JUAN" },
      { nif: "22222222J", nombre: "BLANCO EJEMPLO, JUAN" }, { nif: "33333333P", nombre: "CASTRO FICTICIA, ROSA" },
      { resumen: true }, { nif: "44444444A", nombre: "DIAZ PRUEBA, ANA" }, { nif: "X1234567L", nombre: "ESTEBAN MODELO, LUIS" },
      { nif: "55555555K", nombre: "FUENTES SIMULADA, EVA" }, { nif: "66666666Q", nombre: "GIL PRUEBA, MARIA ANGELES" },
      { nif: "77777777B", nombre: "INVENTADO RUIZ, PABLO" }, { continua: true },
    ].map((x) => ({ ...x, periodo: p }));
    return new File([await pdfEjemplo(lista)], "Ejemplo inventado.pdf", { type: "application/pdf" });
  }

  // ─── Pestañas ───
  function irA(v) {
    $$("#pestanas button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.v === v)));
    $$(".vista").forEach((x) => x.classList.toggle("activa", x.id === v));
    if (v === "vRegistro") pintarRegistro();
  }
  $$("#pestanas button").forEach((b) => b.addEventListener("click", () => irA(b.dataset.v)));

  // ─── Mis nóminas ───
  async function cargarMias() {
    S.mias = await api.mias();
    const anios = [...new Set(S.mias.map((n) => n.periodo.slice(0, 4)))], tipos = [...new Set(S.mias.map((n) => n.tipo))];
    $("#fAnio").innerHTML = `<option value="">Todos</option>` + anios.map((a) => `<option>${a}</option>`).join("");
    $("#fTipo").innerHTML = `<option value="">Todos</option>` + tipos.map((a) => `<option>${esc(a)}</option>`).join("");
    pintarMias();
  }
  function pintarMias() {
    const fa = $("#fAnio").value, ft = $("#fTipo").value;
    const lista = S.mias.filter((n) => (!fa || n.periodo.startsWith(fa)) && (!ft || n.tipo === ft));
    if (!lista.length) { $("#listaMias").innerHTML = `<p class="vacio">${S.mias.length ? "No hay nóminas con estos filtros." : "Todavía no tienes nóminas publicadas aquí."}</p>`; return; }
    const porAnio = {};
    lista.forEach((n) => (porAnio[n.periodo.slice(0, 4)] ||= []).push(n));
    $("#listaMias").innerHTML = Object.keys(porAnio).sort().reverse().map((a) => `<div class="anio">${a}</div><div class="rejilla">${
      porAnio[a].map((n) => `<div class="nom"><div class="mes">${mesTxt(n.periodo)}${n.ultima_apertura ? "" : '<span class="nueva">Nueva</span>'}</div>
        <span class="tipo">${esc(n.tipo)}</span>
        <div class="meta">${n.ultima_apertura ? "Abierta el " + fechaCorta(n.ultima_apertura) : "Sin abrir todavía"}${n.paginas > 1 ? " · " + n.paginas + " hojas" : ""}</div>
        <div class="btns"><button class="btn" data-ver="${n.id}">Ver</button><button class="btn sec" data-bajar="${n.id}">Descargar</button></div></div>`).join("")}</div>`).join("");
  }
  $("#fAnio").addEventListener("change", pintarMias); $("#fTipo").addEventListener("change", pintarMias);
  $("#listaMias").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-ver],button[data-bajar]"); if (!b) return;
    const id = b.dataset.ver || b.dataset.bajar, accion = b.dataset.ver ? "ver" : "descargar";
    const n = S.mias.find((x) => x.id === id);
    // La ventana se abre antes de pedir el enlace (si no, el navegador la bloquea)
    const ventana = accion === "ver" ? window.open("", "_blank") : null;
    b.disabled = true;
    try {
      const url = await api.abrir(id, accion, `Nomina ${n.periodo.slice(0, 7)} ${n.tipo}.pdf`);
      if (ventana) ventana.location.href = url;
      else { const a = document.createElement("a"); a.href = url; a.download = `Nomina ${n.periodo.slice(0, 7)}.pdf`; document.body.appendChild(a); a.click(); a.remove(); }
      n.ultima_apertura = new Date().toISOString(); pintarMias();
    } catch (err) { ventana?.close(); avisar("No se ha podido abrir", esc(err.message || err)); }
    finally { b.disabled = false; }
  });

  // ─── Subir ───
  function pasos(n) { $$(".paso").forEach((p) => { const k = +p.dataset.paso; p.classList.toggle("hecho", k < n); p.classList.toggle("actual", k === n); }); }
  const zona = $("#soltar");
  zona.addEventListener("dragover", (e) => { e.preventDefault(); zona.classList.add("encima"); });
  zona.addEventListener("dragleave", () => zona.classList.remove("encima"));
  zona.addEventListener("drop", (e) => { e.preventDefault(); zona.classList.remove("encima"); if (e.dataTransfer.files.length) procesar([...e.dataTransfer.files]); });
  $("#sArchivo").addEventListener("change", (e) => { if (e.target.files.length) procesar([...e.target.files]); e.target.value = ""; });
  $("#sFirma").addEventListener("change", () => { $("#sArchivo").multiple = $("#sFirma").value === "individual";
    $("#sArchivoTxt").textContent = $("#sFirma").value === "individual" ? "📄 Pulsa aquí o arrastra los PDF (uno por persona)" : "📄 Pulsa aquí o arrastra el PDF"; });

  async function procesar(archivos) {
    $("#errorSubir").hidden = true;
    const firma = $("#sFirma").value;
    archivos = archivos.filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    if (!archivos.length) return mostrarError("Solo se admiten archivos PDF.");
    if (firma === "original" && archivos.length > 1) return mostrarError("Con «Un PDF de todo el personal» sube un único PDF.");
    const info = $("#sArchivoInfo");
    try {
      if (!S.personal.length) { [S.personal, S.huellas] = await Promise.all([api.personal(), api.huellas()]); }
      const lote = { firma, tipo: $("#sTipo").value, periodo: $("#sMes").value, archivos: [], nominas: [], sueltas: [] };
      for (const [i, f] of archivos.entries()) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        $("#sArchivoTxt").textContent = "📄 " + (archivos.length > 1 ? `${archivos.length} archivos` : f.name);
        const paginas = await L.leerPdf(bytes, { onProgreso: (p, t) => { info.innerHTML = `Leyendo ${archivos.length > 1 ? `archivo ${i + 1} de ${archivos.length}, ` : ""}página ${p} de ${t}…`; } });
        lote.archivos.push({ nombre: f.name, bytes, paginas: paginas.length });
        const g = L.agrupar(paginas, CFG.nifEmpresa || []);
        if (firma === "individual") {
          // Un archivo = una nómina completa (todas sus páginas), aunque alguna hoja no tenga NIF
          const base = g.nominas[0] || { nif: null, nombre: null, periodo: null, mini: paginas[0]?.mini };
          lote.nominas.push({ ...base, id: "f" + i, archivo: i, paginas: paginas.map((p) => p.n), nombreArchivo: f.name });
        } else {
          g.nominas.forEach((n) => (n.archivo = 0)); g.sueltas.forEach((s) => (s.archivo = 0));
          lote.nominas.push(...g.nominas); lote.sueltas.push(...g.sueltas);
        }
      }
      const totalPags = lote.archivos.reduce((a, x) => a + x.paginas, 0);
      if (!lote.nominas.length && !lote.sueltas.some((s) => s.motivo.startsWith("Tiene"))) {
        info.textContent = `${totalPags} páginas`; return mostrarError("No se ha encontrado ningún NIF de trabajador. ¿Es un PDF escaneado (imagen)? Entonces no se puede leer el texto: avisa a Mª Ángeles.");
      }
      // Mes: el que pone la nómina (si el campo está vacío o no coincide, se avisa)
      const periodos = [...new Set(lote.nominas.map((n) => n.periodo).filter(Boolean))];
      if (!lote.periodo && periodos.length === 1) { lote.periodo = periodos[0]; $("#sMes").value = periodos[0]; }
      lote.avisoPeriodo = periodos.length && lote.periodo && !periodos.includes(lote.periodo) ? `Has elegido ${mesTxt(lote.periodo)}, pero las nóminas dicen ${periodos.map(mesTxt).join(", ")}.` : "";
      if (firma === "original") lote.huellaOriginal = (await L.sha256Hex(lote.archivos[0].bytes)).slice(0, 16);
      await L.emparejar(lote.nominas, S.personal, S.huellas);
      info.textContent = `${totalPags} páginas · ${lote.nominas.length} nóminas encontradas`;
      S.lote = lote; pasos(2); $("#cajaRevisar").hidden = false; pintarRevision();
      $("#cajaRevisar").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) { console.error(e); mostrarError("No se ha podido leer el PDF: " + (e.message || e)); }
  }
  function mostrarError(t) { $("#errorSubir").textContent = t; $("#errorSubir").hidden = false; }

  const ETQ = { ok: "✓ Correcta", amb: "! Confirmar", rojo: "✕ Revisar" };
  const nombreDe = (email) => S.personal.find((p) => p.email === email)?.nombre || email;
  function estadoFinal(n) {
    if (n.fuera) return "fuera";
    if (!n.email) return "rojo";
    if (n.estado === "ok" || n.confirmada) return "ok";
    return n.estado === "rojo" && !n.confirmada ? "rojo" : "amb";
  }
  function pintarRevision() {
    const l = S.lote, q = L.normal($("#rBuscar").value), solo = $("#rMostrar").value === "revisar";
    const cuenta = { ok: 0, amb: 0, rojo: 0, fuera: 0 };
    l.nominas.forEach((n) => cuenta[estadoFinal(n)]++);
    const sueltasPend = l.sueltas.filter((s) => s.accion === "fuera").length;
    $("#cifras").innerHTML = `<div class="cifra c-ok"><b>${cuenta.ok}</b>Listas para publicar</div>
      <div class="cifra c-amb"><b>${cuenta.amb}</b>Por confirmar</div><div class="cifra c-rojo"><b>${cuenta.rojo}</b>Sin persona o no coinciden</div>
      <div class="cifra c-gris"><b>${l.sueltas.length}</b>Páginas sin emparejar</div>` + (cuenta.fuera ? `<div class="cifra c-gris"><b>${cuenta.fuera}</b>Dejadas fuera</div>` : "");
    const opciones = (n) => {
      const cands = [...new Set([...(n.email ? [n.email] : []), ...n.candidatos])];
      const resto = S.personal.filter((p) => !cands.includes(p.email));
      return `<option value="">— Elegir persona —</option>` +
        (cands.length ? `<optgroup label="Sugeridas">${cands.map((e) => `<option value="${esc(e)}"${e === n.email ? " selected" : ""}>${esc(nombreDe(e))}</option>`).join("")}</optgroup>` : "") +
        `<optgroup label="Todo el personal">${resto.map((p) => `<option value="${esc(p.email)}">${esc(p.nombre)}</option>`).join("")}</optgroup>
         <option value="__fuera">Dejar fuera (no publicar)</option>`;
    };
    const filas = l.nominas.filter((n) => {
      const e = estadoFinal(n);
      if (solo && e === "ok") return false;
      return !q || L.normal(n.nombre || "").includes(q) || L.normal(nombreDe(n.email)).includes(q);
    });
    $("#filas").innerHTML = filas.length ? filas.map((n) => {
      const e = estadoFinal(n);
      const pags = n.paginas.length > 1 ? `${n.paginas[0]}–${n.paginas[n.paginas.length - 1]}` : n.paginas[0];
      return `<tr data-id="${n.id}"><td><div class="td-pag">${n.mini ? `<img class="mini" src="${n.mini}" alt="Página ${n.paginas[0]}" data-zoom="${n.id}">` : ""}${l.firma === "individual" ? esc(n.nombreArchivo) : pags}</div></td>
        <td>${esc(n.nombre || "—")}</td><td class="nif">${tapar(n.nif)}</td>
        <td class="persona">${n.fuera ? "<i>Se deja fuera</i>" : `<select data-persona="${n.id}" aria-label="Persona">${opciones(n)}</select>`}
          <div class="motivo">${esc(n.motivo)}</div>
          ${!n.fuera && n.email && n.estado !== "ok" ? `<label class="confirmar"><input type="checkbox" data-conf="${n.id}"${n.confirmada ? " checked" : ""}> Confirmo que es esta persona</label>` : ""}
          ${n.fuera ? `<button class="enlace" data-volver="${n.id}">Volver a incluir</button>` : ""}</td>
        <td>${e === "fuera" ? '<span class="sem">Fuera</span>' : `<span class="sem ${e}">${ETQ[e]}</span>`}</td></tr>`;
    }).join("") : `<tr><td colspan="5" class="vacio">${solo ? "No queda nada por revisar. 🎉" : "Sin resultados."}</td></tr>`;

    $("#bloqueSueltas").hidden = !l.sueltas.length;
    $("#sueltas").innerHTML = l.sueltas.map((s) => `<tr><td>${s.mini ? `<img class="mini" src="${s.mini}" alt="Página ${s.n}" data-zoomsuelta="${s.n}">` : ""}</td>
      <td>Página ${s.n}<div class="motivo">${esc(s.motivo)}</div></td>
      <td><select data-suelta="${s.n}"><option value="fuera">Dejar fuera</option>${l.nominas.filter((n) => !n.fuera).map((n) => `<option value="${n.id}"${s.accion === n.id ? " selected" : ""}>Unir a: ${esc(n.nombre || "nómina pág. " + n.paginas[0])}${n.id === s.anterior ? " (la anterior)" : ""}</option>`).join("")}</select></td></tr>`).join("");

    const pend = cuenta.amb + cuenta.rojo, publicables = cuenta.ok;
    $("#publicar").disabled = pend > 0 || !publicables || !l.periodo;
    $("#publicar").textContent = `Publicar ${publicables} nómina${publicables === 1 ? "" : "s"}`;
    $("#txtPublicar").textContent = !l.periodo ? "Elige el mes arriba." : pend ? `Quedan ${pend} por resolver (rojo o ámbar).` : (l.avisoPeriodo || "Todo revisado.") + (sueltasPend ? ` Se dejan fuera ${sueltasPend} página(s) sin emparejar.` : "");
  }
  $("#rBuscar").addEventListener("input", pintarRevision); $("#rMostrar").addEventListener("change", pintarRevision);
  $("#sMes").addEventListener("change", () => { if (S.lote) { S.lote.periodo = $("#sMes").value; pintarRevision(); } });
  $("#sTipo").addEventListener("change", () => { if (S.lote) S.lote.tipo = $("#sTipo").value; });
  $("#cajaRevisar").addEventListener("change", (e) => {
    const l = S.lote; const t = e.target;
    if (t.dataset.persona) {
      const n = l.nominas.find((x) => x.id === t.dataset.persona);
      if (t.value === "__fuera") { n.fuera = true; }
      else { n.email = t.value || null; n.confirmada = false;
        if (n.email && n.estado === "ok") n.estado = "amb";
        n.motivo = n.email ? "Elegida a mano: confírmalo" : "Sin persona"; }
      pintarRevision();
    } else if (t.dataset.conf) { l.nominas.find((x) => x.id === t.dataset.conf).confirmada = t.checked; pintarRevision(); }
    else if (t.dataset.suelta) { l.sueltas.find((s) => String(s.n) === t.dataset.suelta).accion = t.value; pintarRevision(); }
  });
  $("#cajaRevisar").addEventListener("click", (e) => {
    const v = e.target.closest("[data-volver]"); if (v) { S.lote.nominas.find((x) => x.id === v.dataset.volver).fuera = false; pintarRevision(); return; }
    const z = e.target.closest("[data-zoom],[data-zoomsuelta]");
    if (z) avisar("Vista de la página", `<img src="${z.src}" alt="">`);
  });
  $("#cancelar").addEventListener("click", reiniciar);
  function reiniciar() { S.lote = null; $("#cajaRevisar").hidden = true; $("#sArchivoTxt").textContent = "📄 Pulsa aquí o arrastra el PDF"; $("#sArchivoInfo").textContent = "Solo PDF. No se envía nada hasta publicar."; pasos(1); }

  $("#publicar").addEventListener("click", async () => {
    const l = S.lote;
    const lista = l.nominas.filter((n) => estadoFinal(n) === "ok");
    // Une las páginas sueltas elegidas
    const extra = {}; l.sueltas.forEach((s) => { if (s.accion !== "fuera") (extra[s.accion] ||= []).push(s.n); });
    const sigue = await preguntar("¿Publicar las nóminas?",
      `<p>Se van a publicar <b>${lista.length} nóminas</b> de <b>${mesTxt(l.periodo)}</b> (${esc(l.tipo)}). Cada persona verá solo la suya.</p>
       ${l.avisoPeriodo ? `<p class="error">${esc(l.avisoPeriodo)}</p>` : ""}
       ${l.nominas.filter((n) => n.fuera).length ? `<p>Se dejan fuera ${l.nominas.filter((n) => n.fuera).length} nómina(s).</p>` : ""}
       <p class="motivo">Si te equivocas, puedes retirar la remesa entera desde «Remesas y registro».</p>`, { si: "Publicar" });
    if (!sigue) return;
    const btn = $("#publicar"); btn.disabled = true;
    $("#txtPublicar").innerHTML = `Publicando… <div class="barra-prog"><span id="prog"></span></div>`;
    try {
      const remesa = await api.crearRemesa(l.periodo, l.tipo, l.firma, $("#sAvisar").checked);
      const docs = await Promise.all(l.archivos.map((a) => PDFLib.PDFDocument.load(a.bytes, { ignoreEncryption: true })));
      const nota = l.firma === "original" ? `Copia extraída del documento firmado digitalmente y publicado el ${fechaCorta(new Date())}. Huella del original: ${l.huellaOriginal}. El original firmado lo conserva la Dirección Titular.` : null;
      const items = []; let k = 0;
      for (const n of lista) {
        const pags = [...n.paginas, ...(extra[n.id] || [])].sort((a, b) => a - b);
        const bytes = l.firma === "individual" ? l.archivos[n.archivo].bytes : await L.extraer(docs[n.archivo], pags, nota);
        const ruta = `remesas/${remesa}/${crypto.randomUUID()}.pdf`;
        await api.subir(ruta, bytes);
        items.push({ email: n.email, ruta, paginas: pags.length, huella: n.huella || null });
        $("#prog").style.width = (++k / lista.length * 100) + "%";
      }
      let original = null;
      if (l.firma === "original") { original = `originales/${remesa}.pdf`; await api.subir(original, l.archivos[0].bytes); }
      const total = await api.publicar(remesa, items, original);
      S.huellas = await api.huellas();
      pasos(3);
      await avisar("Publicadas", `<p>Se han publicado <b>${total} nóminas</b> de ${mesTxt(l.periodo)}.</p>`);
      reiniciar(); irA("vRegistro");
    } catch (e) {
      console.error(e);
      await avisar("No se ha podido publicar", `<p>${esc(e.message || e)}</p><p class="motivo">No se ha publicado nada. Los archivos subidos a medias se borran solos al día siguiente.</p>`);
      btn.disabled = false; pintarRevision();
    }
  });

  // ─── Remesas y registro ───
  const ACC = { ver: "Vio", descargar: "Descargó", publicar: "Publicó remesa", retirar: "Retiró remesa", original: "Abrió el original" };
  async function pintarRegistro() {
    try {
      const [rem, reg] = await Promise.all([api.remesas(), api.registro()]);
      $("#remesas").innerHTML = rem.length ? rem.map((r) => `<tr><td>${mesTxt(r.periodo)}</td><td>${esc(r.tipo)}</td><td>${r.n}</td><td>${fecha(r.publicada)}</td>
        <td>${r.retirada ? `<span class="sem rojo">Retirada ${fechaCorta(r.retirada)}</span>` : `${r.abiertas} de ${r.n}`}</td>
        <td><div class="btns">${!r.retirada && r.tiene_original ? `<button class="btn sec" data-original="${r.id}">Original firmado</button>` : ""}
          ${!r.retirada ? `<button class="btn sec" data-retirar="${r.id}">Retirar</button>` : ""}</div></td></tr>`).join("")
        : `<tr><td colspan="6" class="vacio">Todavía no se ha publicado ninguna remesa.</td></tr>`;
      $("#registro").innerHTML = reg.length ? reg.map((g) => `<tr><td>${fecha(g.cuando)}</td><td>${esc(g.nombre)}</td><td>${ACC[g.accion] || g.accion}${g.detalle ? ` (${esc(g.detalle)})` : ""}</td>
        <td>${g.periodo ? mesTxt(g.periodo) + " · " + esc(g.tipo) : ""}</td></tr>`).join("") : `<tr><td colspan="4" class="vacio">Sin movimientos.</td></tr>`;
    } catch (e) { $("#remesas").innerHTML = `<tr><td colspan="6" class="error">${esc(e.message || e)}</td></tr>`; }
  }
  $("#vRegistro").addEventListener("click", async (e) => {
    const r = e.target.closest("[data-retirar]"), o = e.target.closest("[data-original]");
    if (r) {
      if (!await preguntar("¿Retirar esta remesa?", "<p>Las nóminas de esta remesa dejarán de verse <b>para todas las personas</b> al momento, y sus archivos se borrarán. Esto no se puede deshacer (habría que volver a subir el PDF).</p>", { si: "Retirar" })) return;
      try { await api.retirar(r.dataset.retirar); await api.limpiar(); pintarRegistro(); } catch (err) { avisar("No se ha podido retirar", esc(err.message || err)); }
    } else if (o) {
      const v = window.open("", "_blank");
      try { v.location.href = await api.abrirOriginal(o.dataset.original); } catch (err) { v?.close(); avisar("No se ha podido abrir", esc(err.message || err)); }
    }
  });

  // ─── Instalar como app (PWA) y aviso sin conexión ───
  (function instalar() {
    const b = $("#instalar");
    if (matchMedia("(display-mode: standalone)").matches || navigator.standalone) return;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    let aviso = null;
    if (ios) b.hidden = false;
    addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); aviso = e; b.hidden = false; });
    addEventListener("appinstalled", () => { b.hidden = true; });
    b.onclick = async () => {
      if (aviso) { aviso.prompt(); try { await aviso.userChoice; } catch {} aviso = null; b.hidden = true; return; }
      avisar("Instalar la app", `<ol><li>Pulsa el botón <b>Compartir</b> de Safari (el cuadrado con una flecha hacia arriba).</li>
        <li>Elige <b>«Añadir a pantalla de inicio»</b>.</li><li>Pulsa <b>Añadir</b>. Aparecerá el icono de Nóminas en tu pantalla.</li></ol>`);
    };
  })();
  const conexion = () => ($("#offline").hidden = navigator.onLine);
  addEventListener("online", conexion); addEventListener("offline", conexion); conexion();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

  // ─── Inicio ───
  async function iniciar() {
    if (DEMO) $("#avisoDemo").hidden = false;
    $("#entrar").addEventListener("click", () => api.login().catch((e) => { $("#errorEntrar").textContent = e.message; $("#errorEntrar").hidden = false; }));
    $("#salir").addEventListener("click", () => api.logout());
    try {
      S.user = await api.sesion();
    } catch (e) { $("#errorEntrar").textContent = e.message; $("#errorEntrar").hidden = false; }
    $("#cargando").hidden = true;
    if (!S.user) { $("#vEntrar").hidden = false; return; }
    $("#usuario").hidden = false; $("#usuarioNombre").textContent = S.user.nombre;
    $("#app").hidden = false;
    S.gestor = await api.soyGestor();
    if (S.gestor) {
      $("#pestanas").hidden = false; pasos(1);
      const d = new Date(); $("#sMes").value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      // Pruebas sin nóminas reales: PDF con datos inventados (incluye una hoja a nombre de quien ha entrado)
      const pr = document.createElement("div"); pr.className = "btns"; pr.style.marginTop = "12px";
      pr.innerHTML = `<button class="btn sec" type="button" id="ejProbar">Probar con un PDF de ejemplo inventado</button>
        <button class="btn sec" type="button" id="ejBajar">Descargar el PDF de ejemplo</button>`;
      $("#cajaSubir").appendChild(pr);
      $("#ejProbar").addEventListener("click", async () => procesar([await generarEjemplo()]));
      $("#ejBajar").addEventListener("click", async () => {
        const f = await generarEjemplo(), a = document.createElement("a");
        a.href = URL.createObjectURL(f); a.download = "Nominas de ejemplo (inventadas).pdf"; document.body.appendChild(a); a.click(); a.remove();
      });
      api.limpiar();
    }
    try { await cargarMias(); } catch (e) { $("#listaMias").innerHTML = `<p class="error">${esc(e.message || e)}</p>`; }
  }
  iniciar();
})();
