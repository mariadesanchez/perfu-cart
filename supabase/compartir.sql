-- Listas compartidas (Super Cart y Perfu Cart): una "foto" de la lista tal cual la ve quien la comparte.
-- Se crea con compartir_lista() (solo usuarios con sesión) y se lee con lista_compartida(id), sin poder listar las de otros.
create table if not exists public.listas_compartidas (
  id text primary key default substr(replace(gen_random_uuid()::text, '-', ''), 1, 14),
  app text not null check (app in ('super', 'perfu')),
  user_id uuid not null references auth.users(id) on delete cascade,
  datos jsonb not null check (octet_length(datos::text) < 300000),
  creada timestamptz not null default now()
);
create index if not exists listas_compartidas_user on public.listas_compartidas (user_id, creada);
alter table public.listas_compartidas enable row level security;
revoke all on public.listas_compartidas from anon, authenticated;

create or replace function public.compartir_lista(p_app text, p_datos jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  if auth.uid() is null then raise exception 'Ingresá a tu cuenta para compartir'; end if;
  if (select count(*) from listas_compartidas where user_id = auth.uid() and creada > now() - interval '1 day') >= 100 then
    raise exception 'Compartiste muchas listas hoy. Probá mañana.';
  end if;
  insert into listas_compartidas (app, user_id, datos) values (p_app, auth.uid(), p_datos) returning id into v_id;
  return v_id;
end $$;

create or replace function public.lista_compartida(p_id text)
returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object('app', app, 'creada', creada, 'datos', datos) from listas_compartidas where id = p_id;
$$;

revoke all on function public.compartir_lista(text, jsonb) from public, anon;
grant execute on function public.compartir_lista(text, jsonb) to authenticated;
revoke all on function public.lista_compartida(text) from public;
grant execute on function public.lista_compartida(text) to anon, authenticated;
