// ─── Configuración de «Mis nóminas» ───────────────────────────────────────────
// Usa la base de datos común del colegio en Supabase (acceso con Microsoft 365).
// Si se abre la web con ?demo al final de la dirección, funciona en MODO PRUEBA: personal y nóminas
// inventados, y nada sale del navegador (sirve para probar la división de un PDF de ejemplo).
window.APP_CONFIG = {
  supabaseUrl: "https://hblayjaknhfxieqbzrlq.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhibGF5amFrbmhmeGllcWJ6cmxxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMjg0ODEsImV4cCI6MjEwNjgwNDQ4MX0.K2iWyQAt9upNBXUhdZuV-Nle9fkCMYgQ6jTBBO0MluE",
  dominio: "salesianas.org",          // solo pueden entrar cuentas de este dominio
  dominiosExtra: ["salesianes.org"],  // otros dominios del mismo Microsoft 365 del colegio
  colegio: "Escuelas Salesianas María Auxiliadora · Nervión (Sevilla)",
  // NIF del colegio: nunca se toma como NIF de un trabajador
  nifEmpresa: ["R4100211D"],
};
