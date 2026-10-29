-- Esquema de sincronización de Lista.
-- Idempotente: se puede ejecutar varias veces en el SQL editor de Supabase.

-- Una fila por registro (tarea, tema, persona, filtro o preferencia) y usuario.
-- Los borrados son tombstones (deleted = true); nunca se borra la fila.
create table if not exists public.items (
  user_id    uuid    not null default auth.uid() references auth.users on delete cascade,
  kind       text    not null,
  id         text    not null,
  data       jsonb   not null,
  updated_at bigint  not null,            -- ms epoch, fijado por el cliente
  deleted    boolean not null default false,
  -- Marca de servidor de la última escritura aceptada. El cliente la usa como cursor de pull.
  synced_at  timestamptz not null default clock_timestamp(),
  primary key (user_id, kind, id)
);

-- Tipos de registro admitidos. Se declara aparte (y no inline) para que ejecutar de nuevo este archivo
-- también actualice proyectos ya creados: 'setting' = preferencias como la apariencia.
alter table public.items drop constraint if exists items_kind_check;
alter table public.items add constraint items_kind_check
  check (kind in ('task', 'topic', 'person', 'filter', 'setting'));

comment on table public.items is 'Registros sincronizados de Lista (last-write-wins por updated_at).';
comment on column public.items.updated_at is 'Marca de tiempo (ms epoch) de la última escritura local; decide el ganador LWW.';
comment on column public.items.synced_at is 'Momento de aceptación en el servidor; cursor para pull incremental.';

-- Pull incremental: WHERE user_id = ... AND synced_at > cursor ORDER BY synced_at.
create index if not exists items_user_synced_at_idx on public.items (user_id, synced_at);

-- Seguridad: cada usuario solo ve y escribe sus filas.
alter table public.items enable row level security;

drop policy if exists "own rows" on public.items;
create policy "own rows" on public.items
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Last-write-wins en el servidor.
-- Si una escritura llega con updated_at menor que la fila existente, se descarta
-- (devolver NULL en un trigger BEFORE cancela la fila sin error).
-- En caso contrario se sella synced_at con clock_timestamp() (no con now(),
-- que es el inicio de la transacción y no sirve como cursor).
create or replace function public.items_lww()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null; -- conserva la fila del servidor: gana la escritura más reciente
  end if;
  new.synced_at := clock_timestamp();
  return new;
end;
$$;

comment on function public.items_lww() is 'Trigger LWW para public.items: descarta escrituras más antiguas y sella synced_at.';

drop trigger if exists items_lww on public.items;
create trigger items_lww
  before insert or update on public.items
  for each row execute function public.items_lww();

-- Eliminar la cuenta desde la app (Ajustes -> Eliminar datos): borra las filas del usuario que llama y
-- su usuario de auth. security definer para poder tocar auth.users; solo actúa sobre auth.uid().
create or replace function public.delete_account()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.items where user_id = auth.uid();
  delete from auth.users where id = auth.uid();
$$;

revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
