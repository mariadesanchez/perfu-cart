-- Perfu Cart · mail diario
-- La planilla necesita el mail de cada usuario de Perfu que tiene el mail activado.
-- perfu_perfiles no guarda el mail: esta función lo toma de la cuenta (auth.users).
-- Solo la puede usar la planilla (clave secreta); los usuarios de la app no.
-- Correr una sola vez en Supabase > SQL Editor > Run.

create or replace function public.perfu_destinatarios()
returns table (id uuid, email text, modo text, supers text[], baja_token uuid, avisos_enviados integer)
language sql security definer set search_path = public as $$
  select p.id, lower(u.email)::text, p.modo, p.supers, p.baja_token, p.avisos_enviados
  from public.perfu_perfiles p join auth.users u on u.id = p.id
  where p.avisos and u.email is not null
  order by p.creado
$$;

revoke all on function public.perfu_destinatarios() from public, anon, authenticated;
grant execute on function public.perfu_destinatarios() to service_role;
