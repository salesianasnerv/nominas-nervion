# Mis nóminas · Escuelas Salesianas María Auxiliadora · Nervión

Web para que cada trabajador vea y descargue **solo sus nóminas**, entrando con su cuenta de Microsoft 365 del colegio.
La titular (`titularnervion@`) y Administración (`administracionnervion@`) suben el PDF mensual de la gestoría,
la web lo divide por trabajador (NIF del recuadro «Trabajador» + nombre), se revisa y se publica.

> ⚠️ **Este repositorio es público. NUNCA subas aquí nóminas ni PDF de ningún tipo**, ni siquiera de prueba.
> `.gitignore` los ignora y la comprobación «Sin nóminas en el repositorio» se pone en rojo si aparece alguno.

## Probar sin datos reales
Abre la web con `?demo` al final (por ejemplo `https://…/?demo`): usa personal inventado, nada sale del navegador
y el botón «Probar con un PDF de ejemplo inventado» genera un PDF falso para ver la división y la revisión.

## Archivos
| Archivo | Qué hace |
|---|---|
| `index.html`, `styles.css` | Página y estética común (logo, franjas, Fira Sans, naranja de la sección General, barra «Volver al portal»). |
| `app.js` | Pantallas: Mis nóminas, Subir nóminas (revisión y publicación) y Remesas y registro. |
| `leer-nominas.js` | Lee el PDF en el navegador (pdf.js), reconoce NIF, nombre y mes, agrupa páginas y divide (pdf-lib). |
| `config.js` | Supabase común «Acceso Microsoft 365» (clave pública) y NIF del colegio, que nunca se toma como trabajador. |
| `teams.js` | Entrada automática desde la app de Teams. |
| `supabase/nominas.sql` | Tablas `nom_`, almacén privado `nominas`, reglas de acceso, registro y borrado programado. **Pedir visto bueno a Mª Ángeles antes de ejecutarlo.** |

## Protección de datos (resumen)
- Almacén **privado**. Los archivos se llaman con códigos al azar. Enlaces firmados de **60 segundos**.
- Para abrir una nómina, antes queda anotada en el registro; sin esa anotación (de hace menos de 2 min) el almacén no la entrega.
- Quien sube **no** puede abrir las nóminas publicadas de los demás. El permiso «todas» del panel no da acceso.
- El NIF no se guarda: solo una huella (SHA-256) para reconocer a la persona los meses siguientes.
- Conservación: curso de la nómina + 4 años (31 de agosto). Borrado nocturno de filas; los archivos los borra la web al entrar la titular o Administración.
- Firma: al dividir el PDF firmado, cada copia pierde la firma. Se guarda el original firmado (solo gestores) y cada copia lleva una nota al pie. Si la gestoría manda un PDF por persona ya firmado, se usa «Un PDF por persona».

## Pendiente
- Aviso por correo al publicar (Power Automate desde `administracionnervion@`): la casilla ya se guarda, falta el flujo.
- Añadir «nominas» a «Quién puede hacer qué» del panel de Administración.
- Añadir la dirección de la web a las URL de redirección de Supabase (Authentication → URL Configuration).
