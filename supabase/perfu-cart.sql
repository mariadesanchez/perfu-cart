-- =====================================================================
--  Perfu Cart · tablas propias en el mismo proyecto de Supabase que Super Cart
--  Comparte los usuarios, el ingreso y la lista de permitidos (permitidos, es_permitido, es_admin).
--  Correr una sola vez en Supabase > SQL Editor > Run.
-- =====================================================================

-- Preferencias del mail de Perfu Cart (una fila por usuario; la crea la app al entrar)
create table if not exists public.perfu_perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  avisos boolean not null default true,
  modo text not null default 'resumen' check (modo in ('resumen', 'ofertas')),
  supers text[] not null default array['farmaonline', 'farmacity', 'simplicity', 'pigmento', 'gpsfarma'],
  baja_token uuid not null default gen_random_uuid(),
  creado timestamptz not null default now(),
  ultimo_aviso timestamptz,
  avisos_enviados integer not null default 0,
  constraint perfu_supers_validos check (cardinality(supers) > 0 and supers <@ array['farmaonline', 'farmacity', 'simplicity', 'pigmento', 'gpsfarma'])
);

create table if not exists public.perfu_listas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  nombre text not null default 'Mi lista' check (char_length(nombre) between 1 and 80),
  creada timestamptz not null default now(),
  actualizada timestamptz not null default now(),
  datos jsonb not null default '{}'::jsonb
);
create index if not exists perfu_listas_user_idx on public.perfu_listas (user_id);

create table if not exists public.perfu_items (
  lista_id uuid not null references public.perfu_listas (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  ean text not null,
  nombre text not null default '',
  marca text not null default '',
  imagen text not null default '',
  link text not null default '',
  cantidad integer not null default 1 check (cantidad between 1 and 999),
  rubro text not null default '',
  datos jsonb not null default '{}'::jsonb,
  agregado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  primary key (lista_id, ean)
);
create index if not exists perfu_items_user_idx on public.perfu_items (user_id);

-- Estado de oferta de cada producto, para el aviso "solo cuando entra en oferta" (lo escribe la planilla)
create table if not exists public.perfu_seguimiento (
  user_id uuid not null references auth.users (id) on delete cascade,
  ean text not null,
  en_oferta boolean not null default false,
  mejor_precio numeric,
  mejor_tienda text not null default '',
  en_oferta_desde date,
  precio_avisado numeric,
  primary key (user_id, ean)
);

-- Reglas: un producto solo en listas propias; hasta 30 listas y 500 productos
create or replace function public.perfu_item_lista_propia() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.perfu_listas where id = new.lista_id and user_id = new.user_id) then
    raise exception 'La lista no es tuya';
  end if;
  return new;
end $$;
drop trigger if exists perfu_item_lista_propia on public.perfu_items;
create trigger perfu_item_lista_propia before insert or update on public.perfu_items for each row execute function public.perfu_item_lista_propia();

create or replace function public.perfu_limite_items() returns trigger language plpgsql as $$
begin
  if (select count(*) from public.perfu_items where user_id = new.user_id) >= 500 then
    raise exception 'Llegaste al máximo de 500 productos';
  end if;
  return new;
end $$;
drop trigger if exists perfu_limite_items on public.perfu_items;
create trigger perfu_limite_items before insert on public.perfu_items for each row execute function public.perfu_limite_items();

create or replace function public.perfu_limite_listas() returns trigger language plpgsql as $$
begin
  if (select count(*) from public.perfu_listas where user_id = new.user_id) >= 30 then
    raise exception 'Llegaste al máximo de 30 listas';
  end if;
  return new;
end $$;
drop trigger if exists perfu_limite_listas on public.perfu_listas;
create trigger perfu_limite_listas before insert on public.perfu_listas for each row execute function public.perfu_limite_listas();

-- Seguridad: cada usuario solo lo suyo, y solo si está en permitidos
alter table public.perfu_perfiles enable row level security;
alter table public.perfu_listas enable row level security;
alter table public.perfu_items enable row level security;
alter table public.perfu_seguimiento enable row level security;

drop policy if exists "perfu perfil propio" on public.perfu_perfiles;
create policy "perfu perfil propio" on public.perfu_perfiles for all using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "perfu listas propias" on public.perfu_listas;
create policy "perfu listas propias" on public.perfu_listas for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "perfu items propios" on public.perfu_items;
create policy "perfu items propios" on public.perfu_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "perfu seguimiento propio" on public.perfu_seguimiento;
create policy "perfu seguimiento propio" on public.perfu_seguimiento for select using (auth.uid() = user_id);
revoke insert, update, delete on public.perfu_seguimiento from anon, authenticated;
-- El usuario no puede cambiar su código de baja ni los contadores de envío
revoke update on public.perfu_perfiles from anon, authenticated;
grant update (avisos, modo, supers) on public.perfu_perfiles to authenticated;

drop policy if exists "solo permitidos" on public.perfu_perfiles;
create policy "solo permitidos" on public.perfu_perfiles as restrictive for all to anon, authenticated using (public.es_permitido()) with check (public.es_permitido());
drop policy if exists "solo permitidos" on public.perfu_listas;
create policy "solo permitidos" on public.perfu_listas as restrictive for all to anon, authenticated using (public.es_permitido()) with check (public.es_permitido());
drop policy if exists "solo permitidos" on public.perfu_items;
create policy "solo permitidos" on public.perfu_items as restrictive for all to anon, authenticated using (public.es_permitido()) with check (public.es_permitido());
drop policy if exists "solo permitidos" on public.perfu_seguimiento;
create policy "solo permitidos" on public.perfu_seguimiento as restrictive for all to anon, authenticated using (public.es_permitido()) with check (public.es_permitido());

-- Link "Darte de baja" del mail de Perfu Cart
create or replace function public.perfu_baja_avisos(token uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.perfu_perfiles set avisos = false where baja_token = token;
  return found;
end $$;
revoke all on function public.perfu_baja_avisos(uuid) from public;
grant execute on function public.perfu_baja_avisos(uuid) to anon, authenticated;

-- Andrómaco (Belleza Cart): se suma a las tiendas válidas y a los perfiles que ya existen
alter table public.perfu_perfiles drop constraint if exists perfu_supers_validos;
alter table public.perfu_perfiles add constraint perfu_supers_validos check (cardinality(supers) > 0 and supers <@ array['farmaonline', 'farmacity', 'simplicity', 'pigmento', 'gpsfarma', 'andromaco']);
alter table public.perfu_perfiles alter column supers set default array['farmaonline', 'farmacity', 'simplicity', 'pigmento', 'gpsfarma', 'andromaco'];
update public.perfu_perfiles set supers = supers || array['andromaco'] where not (supers @> array['andromaco']);
