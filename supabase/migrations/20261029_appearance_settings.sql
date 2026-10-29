-- Para instalaciones que todavía no admiten las preferencias de apariencia de main.
-- Conserva filas, políticas RLS y el trigger last-write-wins.
begin;

alter table public.items drop constraint if exists items_kind_check;
alter table public.items add constraint items_kind_check
  check (kind in ('task', 'topic', 'person', 'filter', 'setting'));

commit;
