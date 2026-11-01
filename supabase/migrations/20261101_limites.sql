-- Límites en el servidor: tamaño máximo por registro y limpieza de enlaces caducados.
-- Para instalaciones que ya tienen el cifrado (20261029_cifrado.sql). Conserva filas y el trigger
-- last-write-wins. Idempotente.
begin;

-- 1. Tamaño máximo de items.data: 64 KiB. El registro mayor legítimo es una tarea cifrada (kind 'enc'),
-- que ocupa unos pocos KiB en base64. NOT VALID: no falla si ya hubiera filas grandes; solo se aplica
-- a las escrituras nuevas (inserciones y actualizaciones).
alter table public.items drop constraint if exists items_data_size;
alter table public.items add constraint items_data_size
  check (octet_length(data::text) <= 65536) not valid;

-- 2. Pairings caducadas. El cliente no puede modificar filas caducadas (update) y sí puede borrarlas
-- (deleteExpiredPairings). El select NO filtra por caducidad: en Postgres un DELETE necesita ver la fila
-- con la política select, así que filtrarla haría que el borrado de caducadas no afectara a nada.
-- Se sustituye la política "own rows" por una por operación, manteniendo user_id = auth.uid() en todas.
drop policy if exists "own rows" on public.pairings;
drop policy if exists "pairings select" on public.pairings;
drop policy if exists "pairings insert" on public.pairings;
drop policy if exists "pairings update" on public.pairings;
drop policy if exists "pairings delete" on public.pairings;

create policy "pairings select" on public.pairings
  for select
  using (user_id = auth.uid());

create policy "pairings insert" on public.pairings
  for insert
  with check (user_id = auth.uid());

create policy "pairings update" on public.pairings
  for update
  using (user_id = auth.uid() and expires_at > now())
  with check (user_id = auth.uid());

create policy "pairings delete" on public.pairings
  for delete
  using (user_id = auth.uid());

-- Borra las peticiones caducadas de todos los usuarios. security definer (dueño postgres, sin RLS):
-- solo lo ejecuta pg_cron; anon y authenticated no pueden llamarla (ver revoke).
create or replace function public.purge_expired_pairings()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.pairings where expires_at < now();
$$;

revoke all on function public.purge_expired_pairings() from public, anon, authenticated;

-- Programa la limpieza cada 15 minutos si el proyecto tiene pg_cron. Sin pg_cron no hace nada y
-- el cliente sigue borrando sus caducadas con deleteExpiredPairings.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    -- Quita un trabajo previo con el mismo nombre para no duplicarlo (si no existe, se ignora el error).
    begin
      perform cron.unschedule('lista-purge-pairings');
    exception when others then
      null;
    end;
    perform cron.schedule('lista-purge-pairings', '*/15 * * * *', 'select public.purge_expired_pairings()');
  end if;
end $$;

commit;
