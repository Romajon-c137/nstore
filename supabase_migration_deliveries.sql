-- ============================================================================
-- Доставки: накладные склада «Алаш» из 1С → водитель ставит статус с фото
-- подписанной накладной → статус и фото уходят обратно в 1С (HTTP-сервис расширения).
--   1С OData ──► edge sync-onec-deliveries ──► delivery.invoices
--   водитель (CRM «Доставки») ──► rpc dl_* ──► delivery.status (+ фото в Storage)
--   edge delivery-to-onec ──► 1С /hs/nstore_delivery/status (доп. реквизит + файл)
-- Нет строки в delivery.status или status = 'waiting' — «Ожидает».
-- ============================================================================

create schema if not exists delivery;

create table if not exists delivery.invoices (
  ref          uuid primary key,              -- Ref_Key документа РасходнаяНакладная
  number       text not null,
  doc_date     timestamp not null,
  client_ref   uuid,
  client_name  text,
  amount       numeric not null default 0,
  address      text,                          -- АдресДоставки, иначе Комментарий, иначе название клиента
  phone        text,                          -- найденный в адресе/комментарии/названии
  comment      text,
  manager_name text,
  lines        jsonb not null default '[]',   -- [{n, name, article, qty, price, sum}]
  is_active    boolean not null default true, -- false: документ распроведён / помечен на удаление в 1С
  synced_at    timestamptz not null default now()
);
create index if not exists delivery_invoices_date_idx on delivery.invoices (doc_date);

create table if not exists delivery.status (
  ref            uuid primary key references delivery.invoices(ref),
  status         text not null check (status in ('waiting', 'taken', 'delivered', 'returned')),
  driver_id      uuid,
  driver_name    text,
  taken_at       timestamptz,
  done_at        timestamptz,
  photo_path     text,                        -- путь в Storage-бакете delivery-docs
  note           text,
  updated_at     timestamptz not null default now(),
  -- отправка в 1С
  onec_pending   boolean not null default true,
  onec_pushed_at timestamptz,
  onec_attempts  int not null default 0,
  onec_error     text
);
create index if not exists delivery_status_pending_idx on delivery.status (onec_pending) where onec_pending;

create table if not exists delivery.events (
  id        bigserial primary key,
  ref       uuid not null,
  status    text not null,                    -- taken / released / delivered / returned / reset
  driver_id uuid,
  actor_id  uuid,
  note      text,
  at        timestamptz not null default now()
);
create index if not exists delivery_events_ref_idx on delivery.events (ref, at);

create table if not exists delivery.sync_runs (
  id          bigserial primary key,
  kind        text not null,                  -- invoices | onec_push
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running',
  stats       jsonb,
  error       text
);

alter table delivery.invoices  enable row level security;
alter table delivery.status    enable row level security;
alter table delivery.events    enable row level security;
alter table delivery.sync_runs enable row level security;

-- ---------- Storage: фото подписанных накладных (приватный бакет) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('delivery-docs', 'delivery-docs', false, 8 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "delivery_docs_staff_read" on storage.objects for select to authenticated
  using (bucket_id = 'delivery-docs' and public.get_role_for_uid(auth.uid()) in ('admin', 'manager', 'logist'));
create policy "delivery_docs_staff_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'delivery-docs' and public.get_role_for_uid(auth.uid()) in ('admin', 'manager', 'logist'));

-- ============================================================================
-- RPC синхронизации (service_role)
-- ============================================================================
create or replace function public.dl_sync_invoices(p_from date, p_to date, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_up int; v_off int;
begin
  insert into delivery.invoices (ref, number, doc_date, client_ref, client_name, amount, address, phone, comment, manager_name, lines, is_active, synced_at)
  select (r->>'ref')::uuid, r->>'number', (r->>'doc_date')::timestamp, nullif(r->>'client_ref','')::uuid, r->>'client_name',
         coalesce((r->>'amount')::numeric, 0), r->>'address', r->>'phone', r->>'comment', r->>'manager_name',
         coalesce(r->'lines', '[]'::jsonb), true, now()
    from jsonb_array_elements(p_rows) r
  on conflict (ref) do update set number = excluded.number, doc_date = excluded.doc_date, client_ref = excluded.client_ref,
    client_name = excluded.client_name, amount = excluded.amount, address = excluded.address, phone = excluded.phone,
    comment = excluded.comment, manager_name = excluded.manager_name, lines = excluded.lines, is_active = true, synced_at = now();
  get diagnostics v_up = row_count;

  -- документы окна, которых 1С больше не отдаёт (распроведены / удалены), — скрываем
  update delivery.invoices i set is_active = false, synced_at = now()
   where i.doc_date >= p_from and i.doc_date < p_to + 1 and i.is_active
     and not exists (select 1 from jsonb_array_elements(p_rows) r where (r->>'ref')::uuid = i.ref);
  get diagnostics v_off = row_count;

  return jsonb_build_object('upserted', v_up, 'deactivated', v_off);
end $$;

create or replace function public.dl_log_run(p_kind text, p_status text, p_stats jsonb, p_error text)
returns void language sql security definer set search_path = '' as $$
  insert into delivery.sync_runs(kind, finished_at, status, stats, error) values (p_kind, now(), p_status, p_stats, p_error);
$$;

-- Очередь отправки в 1С
create or replace function public.dl_push_queue(p_limit int default 30)
returns jsonb language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(q)), '[]') from (
    select s.ref, i.number, s.status, s.driver_name, s.taken_at, s.done_at, s.photo_path, s.note, s.onec_attempts
      from delivery.status s join delivery.invoices i on i.ref = s.ref
     where s.onec_pending
       -- после 10 неудач — не чаще раза в час
       and (s.onec_attempts < 10 or s.updated_at < now() - interval '1 hour' * (s.onec_attempts - 9))
     order by s.updated_at
     limit p_limit) q;
$$;

create or replace function public.dl_push_result(p_ref uuid, p_ok boolean, p_error text)
returns void language sql security definer set search_path = '' as $$
  update delivery.status set
    onec_pending   = not p_ok,
    onec_pushed_at = case when p_ok then now() else onec_pushed_at end,
    onec_attempts  = case when p_ok then 0 else onec_attempts + 1 end,
    onec_error     = case when p_ok then null else left(p_error, 1000) end
  where ref = p_ref;
$$;

-- ============================================================================
-- RPC для CRM (водитель = роль logist; admin/manager видят всё, admin сбрасывает)
-- ============================================================================
create or replace function delivery.me()
returns table (uid uuid, role text, name text) language sql stable security definer set search_path = '' as $$
  select p.id, p.role, coalesce(nullif(p.name, ''), p.phone, p.email) from public.profiles p where p.id = auth.uid();
$$;

create or replace function delivery.require(p_roles text[])
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(public.get_role_for_uid(auth.uid()), '') <> all(p_roles) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

create or replace function public.dl_list(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform delivery.require(array['admin', 'manager', 'logist']);
  select jsonb_build_object(
    'me', (select to_jsonb(m) from delivery.me() m),
    'last_sync', (select max(finished_at) from delivery.sync_runs where kind = 'invoices' and status = 'ok'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ref', i.ref, 'number', i.number, 'date', i.doc_date, 'client', i.client_name, 'amount', i.amount,
        'address', i.address, 'phone', i.phone, 'comment', i.comment, 'manager', i.manager_name, 'lines', i.lines,
        'status', coalesce(s.status, 'waiting'), 'driver_id', s.driver_id, 'driver', s.driver_name,
        'taken_at', s.taken_at, 'done_at', s.done_at, 'photo_path', s.photo_path, 'note', s.note,
        'onec', case when s.ref is null then null when s.onec_pending then case when s.onec_error is null then 'pending' else 'error' end else 'ok' end,
        'onec_error', s.onec_error
      ) order by i.doc_date desc, i.number desc)
      from delivery.invoices i left join delivery.status s on s.ref = i.ref
     where i.is_active and i.doc_date >= p_from and i.doc_date < p_to + 1), '[]')
  ) into r;
  return r;
end $$;

create or replace function delivery.set_status(p_ref uuid, p_action text, p_photo text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me record; cur record;
begin
  select * into me from delivery.me();
  if me.uid is null or me.role not in ('admin', 'manager', 'logist') then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from delivery.invoices where ref = p_ref and is_active) then raise exception 'Накладная не найдена'; end if;
  select * into cur from delivery.status where ref = p_ref for update;

  if p_action = 'take' then
    if cur.ref is not null and cur.status = 'taken' and cur.driver_id is distinct from me.uid then
      raise exception 'Накладную уже взял %', cur.driver_name;
    end if;
    if cur.ref is not null and cur.status in ('delivered', 'returned') then raise exception 'Накладная уже закрыта'; end if;
    insert into delivery.status(ref, status, driver_id, driver_name, taken_at, updated_at, onec_pending)
    values (p_ref, 'taken', me.uid, me.name, now(), now(), true)
    on conflict (ref) do update set status = 'taken', driver_id = me.uid, driver_name = me.name, taken_at = now(),
      done_at = null, photo_path = null, note = null, updated_at = now(), onec_pending = true, onec_attempts = 0, onec_error = null;

  elsif p_action = 'release' then
    if cur.ref is null or cur.status <> 'taken' or (cur.driver_id is distinct from me.uid and me.role <> 'admin') then
      raise exception 'Отказаться можно только от своей накладной в пути';
    end if;
    update delivery.status set status = 'waiting', driver_id = null, driver_name = null, updated_at = now(),
      onec_pending = true, onec_attempts = 0, onec_error = null where ref = p_ref;

  elsif p_action = 'deliver' then
    if cur.ref is null or cur.status <> 'taken' or (cur.driver_id is distinct from me.uid and me.role <> 'admin') then
      raise exception 'Сначала возьмите накладную в доставку';
    end if;
    if coalesce(p_photo, '') = '' then raise exception 'Нужно фото подписанной накладной'; end if;
    if p_photo not like p_ref::text || '/%' then raise exception 'Неверный путь фото'; end if;
    update delivery.status set status = 'delivered', done_at = now(), photo_path = p_photo, note = nullif(p_note, ''),
      updated_at = now(), onec_pending = true, onec_attempts = 0, onec_error = null where ref = p_ref;

  elsif p_action = 'return' then
    if cur.ref is null or cur.status <> 'taken' or (cur.driver_id is distinct from me.uid and me.role <> 'admin') then
      raise exception 'Сначала возьмите накладную в доставку';
    end if;
    if coalesce(trim(p_note), '') = '' then raise exception 'Укажите причину возврата'; end if;
    update delivery.status set status = 'returned', done_at = now(), photo_path = nullif(p_photo, ''), note = p_note,
      updated_at = now(), onec_pending = true, onec_attempts = 0, onec_error = null where ref = p_ref;

  elsif p_action = 'reset' then
    if me.role <> 'admin' then raise exception 'forbidden' using errcode = '42501'; end if;
    update delivery.status set status = 'waiting', driver_id = null, driver_name = null, taken_at = null, done_at = null, photo_path = null,
      note = coalesce(p_note, note), updated_at = now(), onec_pending = true, onec_attempts = 0, onec_error = null where ref = p_ref;
  else
    raise exception 'Неизвестное действие %', p_action;
  end if;

  insert into delivery.events(ref, status, driver_id, actor_id, note) values (p_ref, case p_action when 'take' then 'taken' when 'deliver' then 'delivered' when 'return' then 'returned' when 'release' then 'released' else p_action end, me.uid, me.uid, p_note);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.dl_action(p_ref uuid, p_action text, p_photo text default null, p_note text default null)
returns jsonb language sql security definer set search_path = '' as $$
  select delivery.set_status(p_ref, p_action, p_photo, p_note);
$$;

create or replace function public.dl_history(p_ref uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform delivery.require(array['admin', 'manager', 'logist']);
  return coalesce((select jsonb_agg(jsonb_build_object('status', e.status, 'at', e.at, 'note', e.note,
            'who', coalesce(nullif(p.name, ''), p.phone, p.email)) order by e.at)
          from delivery.events e left join public.profiles p on p.id = e.actor_id where e.ref = p_ref), '[]');
end $$;

-- ---------- Доступ к вкладке «Доставки» ----------
insert into public.role_permissions(role, module, access_level)
values ('admin', 'deliveries', 'full'), ('logist', 'deliveries', 'full'), ('manager', 'deliveries', 'view'), ('client', 'deliveries', 'none')
on conflict (role, module) do nothing;

-- ============================================================================
-- Версия 2 (применена миграциями deliveries_service_guard, deliveries_sync_enrich,
-- deliveries_list_filter_cron, deliveries_push_version, deliveries_service_guard_fix).
-- Перекрывает определения выше.
-- ============================================================================

-- Только service_role (edge-функции) или прямая сессия postgres (pg_cron/SQL Editor).
-- current_user внутри SECURITY DEFINER = владелец функции, поэтому проверяем session_user.
create or replace function delivery.require_service()
returns void language plpgsql stable security definer set search_path = '' as $$
declare jrole text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
begin
  if jrole = 'service_role' then return; end if;
  if jrole is null and session_user in ('postgres', 'supabase_admin') then return; end if;
  raise exception 'forbidden' using errcode = '42501';
end $$;

-- Синхронизация: имена клиента/менеджера/товаров из analytics.*, адрес и телефон из полей 1С
create or replace function public.dl_sync_invoices(p_from date, p_to date, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_up int; v_off int;
begin
  perform delivery.require_service();
  with src as (
    select (r->>'ref')::uuid as ref, r->>'number' as number, (r->>'doc_date')::timestamp as doc_date,
           nullif(r->>'client_ref','')::uuid as client_ref, nullif(r->>'manager_ref','')::uuid as manager_ref,
           coalesce((r->>'amount')::numeric, 0) as amount,
           nullif(trim(r->>'address'), '') as addr, nullif(trim(r->>'comment'), '') as comment,
           nullif(trim(r->>'phone'), '') as phone, nullif(trim(r->>'delivery_info'), '') as delivery_info,
           coalesce(r->'lines', '[]'::jsonb) as lines
      from jsonb_array_elements(p_rows) r
  ), enr as (
    select s.*, c.name as client_name, e.name as manager_name,
           coalesce(s.addr, s.delivery_info, s.comment, c.name) as address_text,
           (select coalesce(jsonb_agg(l || jsonb_build_object('name', coalesce(p.name, '(товар)'), 'article', p.article) order by (l->>'n')::int), '[]')
              from jsonb_array_elements(s.lines) l left join analytics.products p on p.ref = nullif(l->>'product_ref','')::uuid) as lines_named
      from src s
      left join analytics.counterparties c on c.ref = s.client_ref
      left join analytics.employees e on e.ref = s.manager_ref
  )
  insert into delivery.invoices (ref, number, doc_date, client_ref, client_name, amount, address, phone, comment, manager_name, lines, is_active, synced_at)
  select ref, number, doc_date, client_ref, client_name, amount, address_text,
         coalesce(phone, substring(coalesce(addr, '') || ' ' || coalesce(delivery_info, '') || ' ' || coalesce(comment, '') || ' ' || coalesce(client_name, '')
                                   from '((?:\+?7|8)[\s\-\(]*7\d\d[\s\-\)]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2})')),
         comment, manager_name, lines_named, true, now()
    from enr
  on conflict (ref) do update set number = excluded.number, doc_date = excluded.doc_date, client_ref = excluded.client_ref,
    client_name = excluded.client_name, amount = excluded.amount, address = excluded.address, phone = excluded.phone,
    comment = excluded.comment, manager_name = excluded.manager_name, lines = excluded.lines, is_active = true, synced_at = now();
  get diagnostics v_up = row_count;

  update delivery.invoices i set is_active = false, synced_at = now()
   where i.doc_date >= p_from and i.doc_date < p_to + 1 and i.is_active
     and not exists (select 1 from jsonb_array_elements(p_rows) r where (r->>'ref')::uuid = i.ref);
  get diagnostics v_off = row_count;
  return jsonb_build_object('upserted', v_up, 'deactivated', v_off);
end $$;

-- Список для водителей: без розницы, Kaspi и внутренних передач ТОО ↔ ИП
create or replace function public.dl_list(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform delivery.require(array['admin', 'manager', 'logist']);
  select jsonb_build_object(
    'me', (select to_jsonb(m) from delivery.me() m),
    'last_sync', (select max(finished_at) from delivery.sync_runs where kind = 'invoices' and status = 'ok'),
    'last_push', (select max(onec_pushed_at) from delivery.status),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ref', i.ref, 'number', i.number, 'date', i.doc_date, 'client', i.client_name, 'amount', i.amount,
        'address', i.address, 'phone', i.phone, 'comment', i.comment, 'manager', i.manager_name, 'lines', i.lines,
        'status', coalesce(s.status, 'waiting'), 'driver_id', s.driver_id, 'driver', s.driver_name,
        'taken_at', s.taken_at, 'done_at', s.done_at, 'photo_path', s.photo_path, 'note', s.note,
        'onec', case when s.ref is null then null when s.onec_pending then case when s.onec_error is null then 'pending' else 'error' end else 'ok' end,
        'onec_error', s.onec_error
      ) order by i.doc_date desc, i.number desc)
      from delivery.invoices i
      left join delivery.status s on s.ref = i.ref
      left join analytics.v_clients vc on vc.ref = i.client_ref
     where i.is_active and i.doc_date >= p_from and i.doc_date < p_to + 1
       and coalesce(i.client_name, '') not ilike 'Розничная реализация%'
       and coalesce(i.client_name, '') not ilike 'KASPI%'
       and not coalesce(vc.internal, false)), '[]')
  ) into r;
  return r;
end $$;

create or replace function public.dl_history(p_ref uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform delivery.require(array['admin', 'manager', 'logist']);
  return coalesce((select jsonb_agg(jsonb_build_object('status', e.status, 'at', e.at, 'note', e.note,
            'who', coalesce(nullif(p.name, ''), p.phone, p.email)) order by e.at, e.id)
          from delivery.events e left join public.profiles p on p.id = e.actor_id where e.ref = p_ref), '[]');
end $$;

-- Очередь в 1С (с updated_at — версия статуса на момент выборки)
create or replace function public.dl_push_queue(p_limit integer default 30)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  perform delivery.require_service();
  select coalesce(jsonb_agg(to_jsonb(q)), '[]') into r from (
    select s.ref, i.number, s.status, s.driver_name, s.taken_at, s.done_at, s.photo_path, s.note, s.onec_attempts, s.updated_at
      from delivery.status s join delivery.invoices i on i.ref = s.ref
     where s.onec_pending
       and (s.onec_attempts < 10 or s.updated_at < now() - interval '1 hour' * (s.onec_attempts - 9))
     order by s.updated_at
     limit p_limit) q;
  return r;
end $$;

-- Результат отправки: флаг снимается, только если водитель не менял статус за время отправки
create or replace function public.dl_push_done(p_ref uuid, p_ok boolean, p_error text, p_updated_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform delivery.require_service();
  update delivery.status set
    onec_pending = case when p_ok then updated_at is distinct from p_updated_at else true end,
    onec_pushed_at = case when p_ok then now() else onec_pushed_at end,
    onec_attempts = case when p_ok then 0 else onec_attempts + 1 end,
    onec_error = case when p_ok then null else left(p_error, 1000) end
  where ref = p_ref;
end $$;

-- Расписание
create or replace function delivery.trigger(p_fn text)
returns bigint language sql security definer set search_path = '' as $$
  select net.http_post(
    url := 'https://znhwajycjdluzoypjejh.supabase.co/functions/v1/' || p_fn,
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'x-sync-secret', (select value->>'sync_secret' from staging.onec_sync_config where key = 'main')),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
$$;

select cron.schedule('onec-deliveries-sync', '3,18,33,48 * * * *', $$select delivery.trigger('sync-onec-deliveries')$$);
select cron.schedule('onec-deliveries-push', '*/5 * * * *', $$select delivery.trigger('delivery-to-onec')$$);

-- ============================================================================
-- Версия 3 (миграция deliveries_drivers_1c, 2026-10-19): водители CRM ↔ водитель/автомобиль 1С.
-- При «Беру» в delivery.status фиксируются onec_driver_ref/onec_vehicle_ref; расширение 1С
-- заполняет ими «Водитель» и «Автомобиль» накладной. Итоги месяца — dl_report.
-- Полные определения функций — в миграции deliveries_drivers_1c (Supabase → Database → Migrations).
-- ============================================================================
-- delivery.onec_refs(kind 'driver'|'vehicle', ref, name, deleted)  ← sync-onec-deliveries (ФизическиеЛица, ТранспортныеСредства)
-- delivery.drivers(profile_id → onec_driver_ref, onec_vehicle_ref)  ← dl_driver_set (admin, вкладка «Водители»)
-- delivery.status + onec_driver_ref, onec_vehicle_ref
-- RPC: dl_sync_refs (service), dl_drivers / dl_driver_set (admin), dl_report(p_month) (admin/manager);
--      set_status 'take' требует привязку; dl_push_queue отдаёт driver_ref/vehicle_ref; dl_list.me + onec_driver/onec_vehicle.
-- В выгрузке только операция «Продажа покупателю» (возвраты поставщику исключены, фильтр в sync-onec-deliveries).
