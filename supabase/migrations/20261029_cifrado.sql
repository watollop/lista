-- Para instalaciones que todavía no admiten el cifrado de extremo a extremo (ver docs/plan-cifrado.md).
-- Conserva filas, políticas RLS y el trigger last-write-wins. Idempotente.
begin;

-- 'enc' = registro cifrado; 'key' = marcador de la clave de cifrado (sin la clave).
alter table public.items drop constraint if exists items_kind_check;
alter table public.items add constraint items_kind_check
  check (kind in ('task', 'topic', 'person', 'filter', 'setting', 'enc', 'key'));

-- Peticiones efímeras de enlace entre dispositivos (10 minutos).
create table if not exists public.pairings (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid() references auth.users on delete cascade,
  pk_b        text        not null,
  commit_b    text        not null,
  n_b         text,
  pk_a        text,
  n_a         text,
  wrapped_dk  text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '10 minutes'
);

create index if not exists pairings_user_id_idx on public.pairings (user_id);

alter table public.pairings enable row level security;

drop policy if exists "own rows" on public.pairings;
create policy "own rows" on public.pairings
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Eliminar la cuenta borra también las peticiones de enlace.
create or replace function public.delete_account()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.items where user_id = auth.uid();
  delete from public.pairings where user_id = auth.uid();
  delete from auth.users where id = auth.uid();
$$;

revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;

commit;
