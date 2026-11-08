-- Listas compartidas (ver docs/plan-listas.md, §4). Para instalaciones que ya tienen 20261101_limites.sql.
-- No toca public.items ni public.pairings salvo delete_account. Idempotente: se puede ejecutar varias veces
-- en el SQL editor de Supabase.
--
-- El servidor no ve nada en claro: el nombre de la lista y sus tareas van cifrados con la clave de la lista
-- (LK) en list_items. Lo que sí ve: quién es miembro de qué lista, cuántas filas tiene y cuándo cambian.
begin;

-- 1. Listas. Solo guarda que existe: el id es el mismo que el de la lista local (crypto.randomUUID).
create table if not exists public.lists (
  id         uuid        primary key,
  created_by uuid        default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.lists is 'Listas compartidas de Lista. El nombre va cifrado en list_items (registro meta).';

-- 2. Miembros. Mientras una lista tenga miembros, exactamente uno es 'owner' (ver list_members_after_delete).
create table if not exists public.list_members (
  list_id   uuid        not null references public.lists on delete cascade,
  user_id   uuid        not null references auth.users on delete cascade,
  role      text        not null default 'member',
  joined_at timestamptz not null default clock_timestamp(),
  primary key (list_id, user_id)
);

alter table public.list_members drop constraint if exists list_members_role_check;
alter table public.list_members add constraint list_members_role_check check (role in ('owner', 'member'));

create index if not exists list_members_user_id_idx on public.list_members (user_id);
create unique index if not exists list_members_one_owner on public.list_members (list_id) where role = 'owner';

-- 3. Registros de la lista (tareas, temas, personas y la ficha meta), cifrados con la LK.
-- Mismo formato que public.items con kind 'enc', pero una sola copia por lista para todos sus miembros.
create table if not exists public.list_items (
  list_id    uuid        not null references public.lists on delete cascade,
  kind       text        not null,
  id         text        not null,            -- HMAC(LK, tipo real + ':' + id real) en hex
  data       jsonb       not null,
  updated_at bigint      not null,            -- ms epoch, fijado por el cliente
  deleted    boolean     not null default false,
  synced_at  timestamptz not null default clock_timestamp(),
  primary key (list_id, kind, id)
);

alter table public.list_items drop constraint if exists list_items_kind_check;
alter table public.list_items add constraint list_items_kind_check check (kind = 'enc');

alter table public.list_items drop constraint if exists list_items_data_size;
alter table public.list_items add constraint list_items_data_size
  check (octet_length(data::text) <= 65536) not valid;

comment on table public.list_items is 'Registros cifrados de las listas compartidas (last-write-wins por updated_at).';

-- Pull incremental por lista: WHERE list_id = ... AND synced_at > cursor ORDER BY synced_at.
create index if not exists list_items_list_synced_at_idx on public.list_items (list_id, synced_at);

-- Last-write-wins, como items_lww: descarta escrituras más antiguas y sella synced_at con clock_timestamp().
create or replace function public.list_items_lww()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  new.synced_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists list_items_lww on public.list_items;
create trigger list_items_lww
  before insert or update on public.list_items
  for each row execute function public.list_items_lww();

-- 4. Invitaciones por enlace (#unirse=<id>.<secreto>). El secreto no llega nunca al servidor:
-- token_hash = SHA-256(authKey) y wrapped = { lk, name } cifrado con wrapKey; las dos claves salen del secreto.
create table if not exists public.list_invites (
  id         uuid        primary key,          -- lo genera el cliente: va en el AAD de wrapped
  list_id    uuid        not null references public.lists on delete cascade,
  created_by uuid        default auth.uid() references auth.users on delete cascade,
  token_hash text        not null,
  wrapped    text        not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by    uuid        references auth.users on delete set null,
  used_at    timestamptz
);

alter table public.list_invites drop constraint if exists list_invites_token_hash_check;
alter table public.list_invites add constraint list_invites_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$');
alter table public.list_invites drop constraint if exists list_invites_wrapped_size;
alter table public.list_invites add constraint list_invites_wrapped_size check (length(wrapped) <= 4096);

create index if not exists list_invites_list_id_idx on public.list_invites (list_id);

-- 5. Comprobaciones para las políticas. security definer: leen list_members sin pasar por su RLS
-- (si no, la política de list_members se llamaría a sí misma).
create or replace function public.is_member(p_list uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.list_members where list_id = p_list and user_id = auth.uid());
$$;

create or replace function public.is_list_owner(p_list uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.list_members where list_id = p_list and user_id = auth.uid() and role = 'owner'
  );
$$;

revoke all on function public.is_member(uuid) from public, anon;
revoke all on function public.is_list_owner(uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_list_owner(uuid) to authenticated;

-- 6. Seguridad. Ni lists ni list_members admiten insert o update desde el cliente: se crean con
-- create_list() y se entra con accept_invite(). list_items no admite delete: los borrados son tombstones.
alter table public.lists enable row level security;
alter table public.list_members enable row level security;
alter table public.list_items enable row level security;
alter table public.list_invites enable row level security;

drop policy if exists "lists select" on public.lists;
drop policy if exists "lists delete" on public.lists;
create policy "lists select" on public.lists
  for select to authenticated using (public.is_member(id));
create policy "lists delete" on public.lists
  for delete to authenticated using (public.is_list_owner(id));

drop policy if exists "members select" on public.list_members;
drop policy if exists "members delete" on public.list_members;
create policy "members select" on public.list_members
  for select to authenticated using (public.is_member(list_id));
-- Salir (mi fila) o, si soy quien manda en la lista, quitar a otro.
create policy "members delete" on public.list_members
  for delete to authenticated using (user_id = auth.uid() or public.is_list_owner(list_id));

drop policy if exists "list items select" on public.list_items;
drop policy if exists "list items insert" on public.list_items;
drop policy if exists "list items update" on public.list_items;
create policy "list items select" on public.list_items
  for select to authenticated using (public.is_member(list_id));
create policy "list items insert" on public.list_items
  for insert to authenticated with check (public.is_member(list_id));
create policy "list items update" on public.list_items
  for update to authenticated using (public.is_member(list_id)) with check (public.is_member(list_id));

drop policy if exists "invites select" on public.list_invites;
drop policy if exists "invites insert" on public.list_invites;
drop policy if exists "invites delete" on public.list_invites;
create policy "invites select" on public.list_invites
  for select to authenticated using (public.is_member(list_id));
-- Una invitación nueva: de un miembro, a su nombre, sin usar y con 7 días como mucho.
create policy "invites insert" on public.list_invites
  for insert to authenticated with check (
    public.is_member(list_id)
    and created_by = auth.uid()
    and used_by is null
    and used_at is null
    and expires_at <= now() + interval '7 days 1 minute'
  );
create policy "invites delete" on public.list_invites
  for delete to authenticated using (public.is_member(list_id));

-- 7. Al salir alguien (por su cuenta, porque lo quitan o porque borra su cuenta):
--    - sus invitaciones sin usar dejan de valer: no puede volver con un enlace que creó él;
--    - si era el owner, pasa a serlo el miembro más antiguo;
--    - si no queda nadie, se borra la lista con todo su contenido.
create or replace function public.list_members_after_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.list_invites
   where list_id = old.list_id and created_by = old.user_id and used_by is null;

  if old.role = 'owner' then
    update public.list_members set role = 'owner'
     where (list_id, user_id) = (
       select m.list_id, m.user_id from public.list_members m
        where m.list_id = old.list_id
        order by m.joined_at, m.user_id
        limit 1
     );
  end if;

  if not exists (select 1 from public.list_members where list_id = old.list_id) then
    delete from public.lists where id = old.list_id;
  end if;
  return null;
end;
$$;

revoke all on function public.list_members_after_delete() from public, anon, authenticated;

drop trigger if exists list_members_after_delete on public.list_members;
create trigger list_members_after_delete
  after delete on public.list_members
  for each row execute function public.list_members_after_delete();

-- 8. Compartir una lista: crea la lista y a quien llama como owner, en una sola transacción.
-- Devuelve { created: false } si ya existía y quien llama ya era miembro (un reintento u otro de sus
-- dispositivos se adelantó): entonces el cliente no debe usar la LK que acaba de generar.
create or replace function public.create_list(p_list uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if (select count(*) from public.list_members where user_id = uid) >= 200 then
    raise exception using errcode = 'P0001', message = 'too_many_lists';
  end if;

  insert into public.lists (id, created_by) values (p_list, uid) on conflict (id) do nothing;
  if not found then
    if exists (select 1 from public.list_members where list_id = p_list and user_id = uid) then
      return jsonb_build_object('created', false);
    end if;
    raise exception using errcode = 'P0001', message = 'list_exists';
  end if;

  insert into public.list_members (list_id, user_id, role) values (p_list, uid, 'owner');
  return jsonb_build_object('created', true);
end;
$$;

revoke all on function public.create_list(uuid) from public, anon;
grant execute on function public.create_list(uuid) to authenticated;

-- 9. Unirse con un enlace. p_auth = authKey en hex (64 caracteres). Primero se comprueba el secreto:
-- sin él no se sabe ni si la invitación existe, ni si está usada o caducada.
-- Es idempotente para quien ya la usó y sigue siendo miembro (la respuesta se perdió y reintenta).
create or replace function public.accept_invite(p_invite uuid, p_auth text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  inv public.list_invites;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select * into inv from public.list_invites where id = p_invite for update;
  if not found or p_auth is null or p_auth !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'P0001', message = 'invite_invalid';
  end if;
  if encode(sha256(decode(p_auth, 'hex')), 'hex') <> inv.token_hash then
    raise exception using errcode = 'P0001', message = 'invite_invalid';
  end if;

  if inv.used_by is not null then
    if inv.used_by = uid
       and exists (select 1 from public.list_members where list_id = inv.list_id and user_id = uid) then
      return jsonb_build_object('list_id', inv.list_id, 'wrapped', inv.wrapped);
    end if;
    raise exception using errcode = 'P0001', message = 'invite_used';
  end if;

  if inv.expires_at < now() then
    raise exception using errcode = 'P0001', message = 'invite_expired';
  end if;

  -- Ya era miembro (por otra invitación): no gasta esta, que puede ser para otra persona.
  if exists (select 1 from public.list_members where list_id = inv.list_id and user_id = uid) then
    return jsonb_build_object('list_id', inv.list_id, 'wrapped', inv.wrapped);
  end if;

  if (select count(*) from public.list_members where list_id = inv.list_id) >= 50 then
    raise exception using errcode = 'P0001', message = 'list_full';
  end if;

  insert into public.list_members (list_id, user_id, role) values (inv.list_id, uid, 'member');
  update public.list_invites set used_by = uid, used_at = now() where id = p_invite;
  return jsonb_build_object('list_id', inv.list_id, 'wrapped', inv.wrapped);
end;
$$;

revoke all on function public.accept_invite(uuid, text) from public, anon;
grant execute on function public.accept_invite(uuid, text) to authenticated;

-- 10. Con quién se comparte: email y nombre de Google de los miembros. Solo para miembros.
create or replace function public.list_members_info(p_list uuid)
returns table (user_id uuid, role text, joined_at timestamptz, email text, name text)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, m.role, m.joined_at, u.email::text,
         coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')
    from public.list_members m
    join auth.users u on u.id = m.user_id
   where m.list_id = p_list and public.is_member(p_list)
   order by m.joined_at, m.user_id;
$$;

revoke all on function public.list_members_info(uuid) from public, anon;
grant execute on function public.list_members_info(uuid) to authenticated;

-- 11. Eliminar la cuenta: ahora también sale de sus listas compartidas. Las que creó no se borran:
-- pasan al miembro más antiguo (trigger del punto 7) y solo desaparecen si no queda nadie.
create or replace function public.delete_account()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.list_members where user_id = auth.uid();
  delete from public.list_invites where created_by = auth.uid();
  delete from public.items where user_id = auth.uid();
  delete from public.pairings where user_id = auth.uid();
  delete from auth.users where id = auth.uid();
$$;

revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;

-- 12. Limpieza de invitaciones: las caducadas sin usar a partir de 1 día; las usadas a los 30 días
-- (se guardan un tiempo para que un reintento de accept_invite funcione). Solo pg_cron la ejecuta.
create or replace function public.purge_old_invites()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.list_invites
   where (used_by is null and expires_at < now() - interval '1 day')
      or (used_at is not null and used_at < now() - interval '30 days');
$$;

revoke all on function public.purge_old_invites() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    begin
      perform cron.unschedule('lista-purge-invites');
    exception when others then
      null;
    end;
    perform cron.schedule('lista-purge-invites', '17 3 * * *', 'select public.purge_old_invites()');
  end if;
end $$;

commit;
