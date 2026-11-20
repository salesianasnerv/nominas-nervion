-- Mis nóminas · tablas, almacén privado y permisos (20-11-2026). PEDIR VISTO BUENO A MARIÁN ANTES DE EJECUTAR.
-- Ejecutar en Supabase → SQL Editor, proyecto común «Acceso Microsoft 365». Se puede volver a ejecutar.
--
-- Qué crea
--   · nom_remesas: cada subida (mes, tipo, quién la publicó, si se ha retirado).
--   · nom_nominas: una fila por nómina publicada (de quién es, mes y archivo).
--   · nom_trabajadores: relación «huella del DNI → correo». El DNI NO se guarda: solo una huella (hash)
--     que sirve para reconocer a la persona el mes siguiente.
--   · nom_registro: quién sube, publica, retira, ve o descarga cada nómina, y cuándo.
--   · Almacén privado «nominas» (no público). Los archivos se llaman con códigos al azar, sin nombres.
--   · Permiso «nominas» en la tabla común «permisos» para titularnervion@ y administracionnervion@.
--
-- Quién ve qué (protección de datos)
--   · Cada trabajador: SOLO sus nóminas. Para abrir una, antes queda anotado en el registro; si no hay
--     anotación de los últimos 2 minutos, el almacén no deja abrir el archivo.
--   · Quien tiene el permiso «nominas» (titular y Administración): sube, revisa, publica y retira remesas,
--     y ve el registro. NO puede abrir las nóminas ya publicadas de otras personas.
--   · El permiso general «todas» del panel NO da acceso a nóminas.
--   · Plazo: curso de la nómina + 4 años (se borra el 31 de agosto). El borrado de filas es automático
--     cada noche; los archivos los borra la propia web la próxima vez que entra la titular o Administración.

begin;

-- 0. Ayudas
create or replace function nom_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function nom_es_gestor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from permisos where lower(email) = nom_email() and web = 'nominas')
$$;

-- 31 de agosto del curso de la nómina + 4 años
create or replace function nom_borrar_el(p_periodo date) returns date
language sql immutable as $$
  select make_date(extract(year from p_periodo)::int + case when extract(month from p_periodo) >= 9 then 1 else 0 end + 4, 8, 31)
$$;

-- 1. Tablas
create table if not exists nom_remesas (
  id          uuid primary key default gen_random_uuid(),
  periodo     date not null check (extract(day from periodo) = 1),     -- primer día del mes
  tipo        text not null default 'Nómina mensual' check (char_length(tipo) between 1 and 60),
  firma       text not null default 'original' check (firma in ('original', 'individual')),
  original    text,                                  -- ruta del PDF completo firmado (solo gestores)
  n           int not null default 0,
  avisar      boolean not null default true,
  creada      timestamptz not null default now(),
  creada_por  text not null default nom_email(),
  publicada   timestamptz,
  retirada    timestamptz,
  retirada_por text,
  borrar_el   date not null
);

create table if not exists nom_nominas (
  id        uuid primary key default gen_random_uuid(),
  remesa_id uuid not null references nom_remesas(id) on delete cascade,
  email     text not null,
  periodo   date not null,
  tipo      text not null,
  ruta      text not null unique,                    -- remesas/<remesa>/<código al azar>.pdf
  paginas   int not null default 1,
  creada    timestamptz not null default now(),
  borrar_el date not null
);
create index if not exists nom_nominas_email_idx on nom_nominas (email, periodo desc);

create table if not exists nom_trabajadores (
  huella      text primary key check (huella ~ '^[0-9a-f]{64}$'),
  email       text not null,
  actualizado timestamptz not null default now(),
  por         text not null default nom_email()
);

create table if not exists nom_registro (
  id        bigint generated always as identity primary key,
  cuando    timestamptz not null default now(),
  email     text not null default nom_email(),
  accion    text not null check (accion in ('ver', 'descargar', 'publicar', 'retirar', 'original')),
  nomina_id uuid,
  remesa_id uuid,
  ruta      text,
  detalle   text,
  borrar_el date not null
);
create index if not exists nom_registro_ruta_idx on nom_registro (ruta, email, cuando desc);

-- Archivos pendientes de borrar del almacén (remesas retiradas o caducadas)
create table if not exists nom_borrar_archivos (ruta text primary key, desde timestamptz not null default now());

-- 2. Seguridad: nadie lee ni escribe las tablas directamente; todo pasa por las funciones de abajo
alter table nom_remesas enable row level security;
alter table nom_nominas enable row level security;
alter table nom_trabajadores enable row level security;
alter table nom_registro enable row level security;
alter table nom_borrar_archivos enable row level security;
revoke all on nom_remesas, nom_nominas, nom_trabajadores, nom_registro, nom_borrar_archivos from anon, authenticated;

-- 3. Funciones para cada trabajador
create or replace function nom_mis_nominas()
returns table (id uuid, periodo date, tipo text, paginas int, publicada timestamptz, ultima_apertura timestamptz)
language sql stable security definer set search_path = public as $$
  select n.id, n.periodo, n.tipo, n.paginas, r.publicada,
         (select max(g.cuando) from nom_registro g where g.nomina_id = n.id and g.email = nom_email() and g.accion in ('ver', 'descargar'))
  from nom_nominas n join nom_remesas r on r.id = n.remesa_id
  where n.email = nom_email() and r.publicada is not null and r.retirada is null
  order by n.periodo desc, r.publicada desc
$$;

-- Anota la apertura y devuelve la ruta del archivo (solo si la nómina es de quien la pide)
create or replace function nom_abrir(p_id uuid, p_accion text) returns text
language plpgsql security definer set search_path = public as $$
declare v nom_nominas;
begin
  if p_accion not in ('ver', 'descargar') then raise exception 'Acción no válida'; end if;
  select n.* into v from nom_nominas n join nom_remesas r on r.id = n.remesa_id
   where n.id = p_id and n.email = nom_email() and r.publicada is not null and r.retirada is null;
  if not found then raise exception 'Esta nómina no existe o no es tuya'; end if;
  insert into nom_registro (accion, nomina_id, remesa_id, ruta, borrar_el) values (p_accion, v.id, v.remesa_id, v.ruta, v.borrar_el);
  return v.ruta;
end $$;

-- 4. Funciones para la titular y Administración (permiso «nominas»)
create or replace function nom_soy_gestor() returns boolean
language sql stable security definer set search_path = public as $$ select nom_es_gestor() $$;

-- Personal activo (para emparejar) y huellas conocidas
create or replace function nom_personal() returns table (email text, nombre text)
language sql stable security definer set search_path = public as $$
  select lower(p.email::text), p.nombre::text from personal p where nom_es_gestor() and p.activo order by p.nombre
$$;
create or replace function nom_huellas() returns table (huella text, email text)
language sql stable security definer set search_path = public as $$
  select t.huella, t.email from nom_trabajadores t where nom_es_gestor()
$$;

-- Crea la remesa (aún sin publicar). Devuelve su código, que se usa como carpeta del almacén.
create or replace function nom_crear_remesa(p_periodo date, p_tipo text, p_firma text, p_avisar boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not nom_es_gestor() then raise exception 'No tienes permiso para subir nóminas'; end if;
  insert into nom_remesas (periodo, tipo, firma, avisar, borrar_el)
  values (date_trunc('month', p_periodo)::date, p_tipo, p_firma, coalesce(p_avisar, true), nom_borrar_el(date_trunc('month', p_periodo)::date))
  returning id into v;
  return v;
end $$;

-- Publica: p_items = [{"email": "...", "ruta": "remesas/<remesa>/<código>.pdf", "paginas": 1, "huella": "..."|null}]
create or replace function nom_publicar(p_remesa uuid, p_items jsonb, p_original text) returns int
language plpgsql security definer set search_path = public as $$
declare r nom_remesas; it jsonb; total int := 0;
begin
  if not nom_es_gestor() then raise exception 'No tienes permiso para publicar nóminas'; end if;
  select * into r from nom_remesas where id = p_remesa and publicada is null and retirada is null for update;
  if not found then raise exception 'Esta remesa ya está publicada o no existe'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if not exists (select 1 from personal p where lower(p.email::text) = lower(it ->> 'email') and p.activo) then
      raise exception 'La persona % no está en el personal activo', it ->> 'email';
    end if;
    if (it ->> 'ruta') not like 'remesas/' || p_remesa || '/%' then raise exception 'Ruta no válida'; end if;
    insert into nom_nominas (remesa_id, email, periodo, tipo, ruta, paginas, borrar_el)
    values (p_remesa, lower(it ->> 'email'), r.periodo, r.tipo, it ->> 'ruta', coalesce((it ->> 'paginas')::int, 1), r.borrar_el);
    if coalesce(it ->> 'huella', '') <> '' then
      insert into nom_trabajadores (huella, email) values (it ->> 'huella', lower(it ->> 'email'))
      on conflict (huella) do update set email = excluded.email, actualizado = now(), por = nom_email();
    end if;
    total := total + 1;
  end loop;
  update nom_remesas set publicada = now(), n = total,
         original = case when p_original like 'originales/' || p_remesa || '%' then p_original end
   where id = p_remesa;
  insert into nom_registro (accion, remesa_id, detalle, borrar_el) values ('publicar', p_remesa, total || ' nóminas', r.borrar_el);
  return total;
end $$;

-- Retira una remesa: deja de verse al momento y sus archivos pasan a la lista de borrado
create or replace function nom_retirar(p_remesa uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r nom_remesas;
begin
  if not nom_es_gestor() then raise exception 'No tienes permiso'; end if;
  select * into r from nom_remesas where id = p_remesa and retirada is null;
  if not found then raise exception 'La remesa no existe o ya está retirada'; end if;
  insert into nom_borrar_archivos (ruta) select ruta from nom_nominas where remesa_id = p_remesa on conflict do nothing;
  if r.original is not null then insert into nom_borrar_archivos (ruta) values (r.original) on conflict do nothing; end if;
  delete from nom_nominas where remesa_id = p_remesa;
  update nom_remesas set retirada = now(), retirada_por = nom_email(), original = null where id = p_remesa;
  insert into nom_registro (accion, remesa_id, borrar_el) values ('retirar', p_remesa, r.borrar_el);
end $$;

-- Remesas con cifras (sin ver las nóminas de nadie)
create or replace function nom_remesas_lista()
returns table (id uuid, periodo date, tipo text, firma text, n int, abiertas int, creada_por text, publicada timestamptz,
               retirada timestamptz, retirada_por text, tiene_original boolean, borrar_el date)
language sql stable security definer set search_path = public as $$
  select r.id, r.periodo, r.tipo, r.firma, r.n,
         (select count(distinct g.nomina_id)::int from nom_registro g where g.remesa_id = r.id and g.accion in ('ver', 'descargar')),
         r.creada_por, r.publicada, r.retirada, r.retirada_por, r.original is not null, r.borrar_el
  from nom_remesas r where nom_es_gestor() and r.publicada is not null
  order by r.periodo desc, r.publicada desc
$$;

-- Registro de accesos (nombre de la persona, sin datos de la nómina)
create or replace function nom_registro_lista(p_limite int default 200)
returns table (cuando timestamptz, email text, nombre text, accion text, periodo date, tipo text, detalle text)
language sql stable security definer set search_path = public as $$
  select g.cuando, g.email, coalesce((select p.nombre::text from personal p where lower(p.email::text) = g.email limit 1), g.email),
         g.accion, r.periodo, r.tipo, g.detalle
  from nom_registro g left join nom_remesas r on r.id = g.remesa_id
  where nom_es_gestor() order by g.cuando desc limit least(coalesce(p_limite, 200), 1000)
$$;

-- Abrir el PDF original firmado de una remesa (solo gestores; queda anotado)
create or replace function nom_abrir_original(p_remesa uuid) returns text
language plpgsql security definer set search_path = public as $$
declare r nom_remesas;
begin
  if not nom_es_gestor() then raise exception 'No tienes permiso'; end if;
  select * into r from nom_remesas where id = p_remesa and original is not null;
  if not found then raise exception 'Esta remesa no tiene original guardado'; end if;
  insert into nom_registro (accion, remesa_id, ruta, borrar_el) values ('original', r.id, r.original, r.borrar_el);
  return r.original;
end $$;

-- Archivos que hay que borrar del almacén (la web los borra y luego confirma)
create or replace function nom_archivos_a_borrar() returns setof text
language sql stable security definer set search_path = public as $$
  select ruta from nom_borrar_archivos where nom_es_gestor() limit 1000
$$;
create or replace function nom_archivos_borrados(p_rutas text[]) returns void
language sql security definer set search_path = public as $$
  delete from nom_borrar_archivos where nom_es_gestor() and ruta = any(p_rutas)
$$;

-- Remesas creadas pero nunca publicadas (p. ej. se cerró la ventana a medias): sus archivos se borran
create or replace function nom_limpiar_borradores() returns void
language sql security definer set search_path = public as $$
  insert into nom_borrar_archivos (ruta)
    select o.name from storage.objects o join nom_remesas r on o.name like 'remesas/' || r.id || '/%' or o.name like 'originales/' || r.id || '%'
    where nom_es_gestor() and o.bucket_id = 'nominas' and r.publicada is null and r.creada < now() - interval '1 day'
  on conflict do nothing;
  delete from nom_remesas where nom_es_gestor() and publicada is null and creada < now() - interval '1 day';
$$;

revoke execute on function nom_mis_nominas(), nom_abrir(uuid, text), nom_soy_gestor(), nom_personal(), nom_huellas(),
  nom_crear_remesa(date, text, text, boolean), nom_publicar(uuid, jsonb, text), nom_retirar(uuid), nom_remesas_lista(),
  nom_registro_lista(int), nom_abrir_original(uuid), nom_archivos_a_borrar(), nom_archivos_borrados(text[]), nom_limpiar_borradores()
  from public, anon;
grant execute on function nom_mis_nominas(), nom_abrir(uuid, text), nom_soy_gestor(), nom_personal(), nom_huellas(),
  nom_crear_remesa(date, text, text, boolean), nom_publicar(uuid, jsonb, text), nom_retirar(uuid), nom_remesas_lista(),
  nom_registro_lista(int), nom_abrir_original(uuid), nom_archivos_a_borrar(), nom_archivos_borrados(text[]), nom_limpiar_borradores()
  to authenticated;

-- 5. Almacén privado
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('nominas', 'nominas', false, 52428800, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 52428800, allowed_mime_types = array['application/pdf'];

-- Comprueba si quien pide un archivo lo ha anotado en el registro hace menos de 2 minutos
create or replace function nom_puede_leer_archivo(p_ruta text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from nom_registro g
    where g.ruta = p_ruta and g.email = nom_email() and g.cuando > now() - interval '2 minutes'
      and (g.accion in ('ver', 'descargar') and exists (select 1 from nom_nominas n where n.ruta = p_ruta and n.email = nom_email())
           or g.accion = 'original' and nom_es_gestor())
  )
$$;
grant execute on function nom_puede_leer_archivo(text) to authenticated;

drop policy if exists "nominas: subir" on storage.objects;
create policy "nominas: subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'nominas' and nom_es_gestor() and (name like 'remesas/%' or name like 'originales/%'));

drop policy if exists "nominas: leer" on storage.objects;
create policy "nominas: leer" on storage.objects for select to authenticated
  using (bucket_id = 'nominas' and nom_puede_leer_archivo(name));

drop policy if exists "nominas: borrar" on storage.objects;
create policy "nominas: borrar" on storage.objects for delete to authenticated
  using (bucket_id = 'nominas' and nom_es_gestor()
         and exists (select 1 from nom_borrar_archivos b where b.ruta = name));

-- 6. Borrado nocturno (3:00 UTC): filas caducadas fuera; sus archivos, a la lista de borrado
create or replace function nom_borrado_nocturno() returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into nom_borrar_archivos (ruta) select ruta from nom_nominas where borrar_el < current_date on conflict do nothing;
  insert into nom_borrar_archivos (ruta) select original from nom_remesas where borrar_el < current_date and original is not null on conflict do nothing;
  delete from nom_nominas where borrar_el < current_date;
  delete from nom_remesas where borrar_el < current_date;
  delete from nom_registro where borrar_el < current_date;
end $$;
revoke execute on function nom_borrado_nocturno() from public, anon, authenticated;

select cron.unschedule('nominas-borrado') where exists (select 1 from cron.job where jobname = 'nominas-borrado');
select cron.schedule('nominas-borrado', '15 3 * * *', 'select nom_borrado_nocturno()');

-- 7. Permiso para subir: titularnervion@ y administracionnervion@ (decidido el 20-11-2026)
--    Se busca el correo exacto en la tabla «personal», para no adivinar el dominio.
insert into permisos (email, web)
select lower(p.email::text), 'nominas' from personal p
where split_part(lower(p.email::text), '@', 1) in ('titularnervion', 'administracionnervion')
  and not exists (select 1 from permisos x where lower(x.email) = lower(p.email::text) and x.web = 'nominas');

commit;

-- Comprobación: quién puede subir nóminas (deberían salir las dos cuentas)
select email, web from permisos where web = 'nominas';
