-- ============================================================================
-- Аналитика продаж: слой хранения и синхронизации из 1С УНФ (OData, только чтение)
--   1С OData ──► edge sync-onec-sales ──► rpc sa_sync_* (service_role) ──► analytics.*
-- Схема analytics не публикуется через PostgREST: доступ к данным только через
-- RPC sa_* (см. supabase_migration_sales_analytics_calc.sql) с проверкой роли.
-- ============================================================================

create schema if not exists analytics;
revoke all on schema analytics from public, anon, authenticated;

-- ---------- Факт: движения регистра накопления «Продажи» 1:1 ----------
create table if not exists analytics.sales (
  recorder        uuid    not null,
  recorder_type   text    not null,        -- Document_РасходнаяНакладная / ПриходнаяНакладная / ЗакрытиеМесяца ...
  line_no         int     not null,
  period          timestamp not null,      -- локальное время 1С (без зоны)
  month           date    not null,
  doc_ref         uuid,
  doc_type        text,
  product_ref     uuid,
  counterparty_ref uuid,
  org_ref         uuid,
  warehouse_ref   uuid,
  responsible_ref uuid,
  order_ref       uuid,
  qty             numeric not null default 0,
  amount          numeric not null default 0,   -- Сумма (с НДС)
  vat             numeric not null default 0,   -- СуммаНДС
  amount_nodisc   numeric not null default 0,   -- СуммаБезСкидки
  cost            numeric not null default 0,   -- Себестоимость
  cost_novat      numeric not null default 0,   -- СебестоимостьБезНДС
  primary key (recorder, recorder_type, line_no)
);
create index if not exists sales_month_idx   on analytics.sales (month);
create index if not exists sales_period_idx  on analytics.sales (period);
create index if not exists sales_cp_idx      on analytics.sales (counterparty_ref, period);
create index if not exists sales_resp_idx    on analytics.sales (responsible_ref);

-- Буфер загрузки месяца частями (атомарная замена месяца в sa_sync_month_finish)
create table if not exists analytics.sales_load (
  run_id  bigint not null,
  month   date   not null,
  chunk   int    not null,
  rows    jsonb  not null,
  primary key (run_id, month, chunk)
);

-- ---------- Справочники ----------
create table if not exists analytics.counterparties (
  ref           uuid primary key,
  name          text,
  full_name     text,
  parent_ref    uuid,
  responsible_ref uuid,
  bin           text,
  phone         text,
  is_buyer      boolean,
  deleted       boolean,
  inactive      boolean,
  created_at_1c timestamp,
  synced_at     timestamptz not null default now()
);
create table if not exists analytics.counterparty_groups (
  ref        uuid primary key,
  name       text,
  parent_ref uuid,
  synced_at  timestamptz not null default now()
);
create table if not exists analytics.employees (
  ref       uuid primary key,
  name      text,
  deleted   boolean,
  synced_at timestamptz not null default now()
);
create table if not exists analytics.products (
  ref        uuid primary key,
  name       text,
  code       text,
  article    text,
  parent_ref uuid,
  is_folder  boolean not null default false,
  item_type  text,
  deleted    boolean,
  synced_at  timestamptz not null default now()
);
create table if not exists analytics.organizations (
  ref  uuid primary key,
  name text
);

-- Долги покупателей: снимок остатков регистра «РасчетыСПокупателями» (ТипРасчетов = Долг/Аванс)
create table if not exists analytics.debts (
  counterparty_ref uuid primary key,
  debt             numeric not null default 0,  -- > 0: клиент должен нам
  advance          numeric not null default 0,  -- > 0: аванс клиента
  synced_at        timestamptz not null default now()
);

-- ---------- Журнал и сверка ----------
create table if not exists analytics.sync_runs (
  id          bigserial primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running',   -- running | ok | partial | error
  mode        text,
  stats       jsonb,
  error       text
);
create index if not exists sync_runs_started_idx on analytics.sync_runs (started_at desc);

create table if not exists analytics.sync_months (
  month        date primary key,
  synced_at    timestamptz,
  rows         int,
  amount       numeric,     -- сумма загруженных строк
  qty          numeric,
  onec_amount  numeric,     -- обороты регистра в 1С за месяц (Turnover) — контроль
  onec_qty     numeric,
  closed       boolean,     -- в 1С проведено «Закрытие месяца» (себестоимость окончательная)
  status       text,        -- ok | mismatch | error
  error        text
);

-- ---------- Настройки и план ----------
create table if not exists analytics.settings (
  key   text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into analytics.settings(key, value) values
  ('exclude', jsonb_build_object(
     -- группы контрагентов верхнего уровня, исключаемые из коммерческой аналитики
     'groups', jsonb_build_array('Внутреннее', 'Поставщик', '9. Закупки', 'Банки', 'НАЛОГИ'),
     -- подстроки наименования контрагента (собственные юрлица — внутренние передачи)
     'name_patterns', jsonb_build_array('Smart Data Kazakhstan', 'Jibek Joly')
  )),
  ('history_from', '"2023-09-01"'::jsonb)
on conflict (key) do nothing;

create table if not exists analytics.sales_plan (
  id          bigserial primary key,
  month       date not null check (month = date_trunc('month', month)::date),
  manager_ref uuid,              -- null = план компании
  amount      numeric not null check (amount >= 0),
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);
create unique index if not exists sales_plan_uq
  on analytics.sales_plan (month, coalesce(manager_ref, '00000000-0000-0000-0000-000000000000'::uuid));

-- RLS на всех таблицах; политик нет — доступ только через SECURITY DEFINER RPC.
do $$ declare t text; begin
  foreach t in array array['sales','sales_load','counterparties','counterparty_groups','employees',
                           'products','organizations','debts','sync_runs','sync_months','settings','sales_plan']
  loop execute format('alter table analytics.%I enable row level security', t); end loop;
end $$;

-- ============================================================================
-- RPC для edge-функции (только service_role)
-- ============================================================================

create or replace function public.sa_sync_begin(p_mode text)
returns bigint language sql security definer set search_path = '' as $$
  insert into analytics.sync_runs(mode) values (p_mode) returning id;
$$;

create or replace function public.sa_sync_finish(p_run bigint, p_status text, p_stats jsonb, p_error text)
returns void language sql security definer set search_path = '' as $$
  update analytics.sync_runs
     set finished_at = now(), status = p_status, stats = p_stats, error = p_error
   where id = p_run;
  delete from analytics.sales_load where run_id = p_run;
  delete from analytics.sync_runs where started_at < now() - interval '90 days';
$$;

-- Какие месяцы синхронизировать в этот запуск: текущий, прошлый, + p_stale самых давно сверенных
create or replace function public.sa_sync_plan(p_stale int default 2)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_from date := (select (value #>> '{}')::date from analytics.settings where key = 'history_from');
  v_cur  date := date_trunc('month', (now() at time zone 'Asia/Almaty'))::date;
  v_res  date[];
begin
  insert into analytics.sync_months(month)
  select m::date from generate_series(v_from, v_cur + interval '1 month', interval '1 month') m
  on conflict do nothing;

  select array_agg(month order by month desc) into v_res from (
    select month from analytics.sync_months where month >= v_cur - interval '1 month'
    union
    select month from (
      select month from analytics.sync_months
       where month < v_cur - interval '1 month'
       order by synced_at nulls first, month desc
       limit p_stale) s
  ) x;
  return to_jsonb(v_res);
end $$;

create or replace function public.sa_sync_load_chunk(p_run bigint, p_month date, p_chunk int, p_rows jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into analytics.sales_load(run_id, month, chunk, rows) values (p_run, p_month, p_chunk, p_rows)
  on conflict (run_id, month, chunk) do update set rows = excluded.rows;
$$;

-- Атомарно заменить месяц загруженными строками и записать сверку с оборотами 1С
create or replace function public.sa_sync_month_finish(
  p_run bigint, p_month date, p_onec_amount numeric, p_onec_qty numeric, p_closed boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_rows int; v_amount numeric; v_qty numeric; v_status text;
begin
  delete from analytics.sales where month = p_month;

  insert into analytics.sales (recorder, recorder_type, line_no, period, month, doc_ref, doc_type,
    product_ref, counterparty_ref, org_ref, warehouse_ref, responsible_ref, order_ref,
    qty, amount, vat, amount_nodisc, cost, cost_novat)
  select distinct on ((r->>'recorder'), (r->>'recorder_type'), (r->>'line_no')::int)
         (r->>'recorder')::uuid, r->>'recorder_type', (r->>'line_no')::int,
         (r->>'period')::timestamp, p_month,
         nullif(r->>'doc_ref','')::uuid, r->>'doc_type',
         nullif(r->>'product_ref','')::uuid, nullif(r->>'counterparty_ref','')::uuid,
         nullif(r->>'org_ref','')::uuid, nullif(r->>'warehouse_ref','')::uuid,
         nullif(r->>'responsible_ref','')::uuid, nullif(r->>'order_ref','')::uuid,
         coalesce((r->>'qty')::numeric,0), coalesce((r->>'amount')::numeric,0),
         coalesce((r->>'vat')::numeric,0), coalesce((r->>'amount_nodisc')::numeric,0),
         coalesce((r->>'cost')::numeric,0), coalesce((r->>'cost_novat')::numeric,0)
    from analytics.sales_load l, jsonb_array_elements(l.rows) r
   where l.run_id = p_run and l.month = p_month
  on conflict (recorder, recorder_type, line_no) do update set
    period = excluded.period, month = excluded.month, qty = excluded.qty, amount = excluded.amount,
    vat = excluded.vat, cost = excluded.cost, cost_novat = excluded.cost_novat;

  delete from analytics.sales_load where run_id = p_run and month = p_month;

  select count(*), coalesce(sum(amount),0), coalesce(sum(qty),0)
    into v_rows, v_amount, v_qty
    from analytics.sales where month = p_month;

  v_status := case
    when p_onec_amount is null then 'unchecked'
    when abs(v_amount - p_onec_amount) <= 1 and abs(v_qty - coalesce(p_onec_qty, v_qty)) <= 0.01 then 'ok'
    else 'mismatch' end;

  update analytics.sync_months set
    synced_at = now(), rows = v_rows, amount = v_amount, qty = v_qty,
    onec_amount = p_onec_amount, onec_qty = p_onec_qty, closed = p_closed,
    status = v_status, error = null
  where month = p_month;

  return jsonb_build_object('month', p_month, 'rows', v_rows, 'amount', v_amount, 'status', v_status);
end $$;

create or replace function public.sa_sync_month_error(p_month date, p_error text)
returns void language sql security definer set search_path = '' as $$
  update analytics.sync_months set status = 'error', error = left(p_error, 1000) where month = p_month;
$$;

-- Справочники и долги. ВНИМАНИЕ: эта версия заменена в supabase_migration_sales_analytics_perf.sql
-- (upsert: расширение safeupdate в Supabase запрещает DELETE без WHERE).
create or replace function public.sa_sync_dims(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb := '{}'::jsonb;
begin
  if p ? 'groups' then
    delete from analytics.counterparty_groups;
    insert into analytics.counterparty_groups(ref, name, parent_ref)
    select (r->>'ref')::uuid, r->>'name', nullif(r->>'parent_ref','')::uuid from jsonb_array_elements(p->'groups') r;
    v := v || jsonb_build_object('groups', jsonb_array_length(p->'groups'));
  end if;
  if p ? 'counterparties' then
    insert into analytics.counterparties(ref, name, full_name, parent_ref, responsible_ref, bin, phone,
                                         is_buyer, deleted, inactive, created_at_1c, synced_at)
    select (r->>'ref')::uuid, r->>'name', r->>'full_name', nullif(r->>'parent_ref','')::uuid,
           nullif(r->>'responsible_ref','')::uuid, r->>'bin', r->>'phone',
           (r->>'is_buyer')::boolean, (r->>'deleted')::boolean, (r->>'inactive')::boolean,
           nullif(r->>'created_at','')::timestamp, now()
      from jsonb_array_elements(p->'counterparties') r
    on conflict (ref) do update set name = excluded.name, full_name = excluded.full_name,
      parent_ref = excluded.parent_ref, responsible_ref = excluded.responsible_ref, bin = excluded.bin,
      phone = excluded.phone, is_buyer = excluded.is_buyer, deleted = excluded.deleted,
      inactive = excluded.inactive, created_at_1c = excluded.created_at_1c, synced_at = now();
    v := v || jsonb_build_object('counterparties', jsonb_array_length(p->'counterparties'));
  end if;
  if p ? 'employees' then
    insert into analytics.employees(ref, name, deleted, synced_at)
    select (r->>'ref')::uuid, r->>'name', (r->>'deleted')::boolean, now() from jsonb_array_elements(p->'employees') r
    on conflict (ref) do update set name = excluded.name, deleted = excluded.deleted, synced_at = now();
    v := v || jsonb_build_object('employees', jsonb_array_length(p->'employees'));
  end if;
  if p ? 'products' then
    insert into analytics.products(ref, name, code, article, parent_ref, is_folder, item_type, deleted, synced_at)
    select (r->>'ref')::uuid, r->>'name', r->>'code', r->>'article', nullif(r->>'parent_ref','')::uuid,
           coalesce((r->>'is_folder')::boolean,false), r->>'item_type', (r->>'deleted')::boolean, now()
      from jsonb_array_elements(p->'products') r
    on conflict (ref) do update set name = excluded.name, code = excluded.code, article = excluded.article,
      parent_ref = excluded.parent_ref, is_folder = excluded.is_folder, item_type = excluded.item_type,
      deleted = excluded.deleted, synced_at = now();
    v := v || jsonb_build_object('products', jsonb_array_length(p->'products'));
  end if;
  if p ? 'organizations' then
    insert into analytics.organizations(ref, name)
    select (r->>'ref')::uuid, r->>'name' from jsonb_array_elements(p->'organizations') r
    on conflict (ref) do update set name = excluded.name;
  end if;
  if p ? 'debts' then
    delete from analytics.debts;
    insert into analytics.debts(counterparty_ref, debt, advance, synced_at)
    select (r->>'counterparty_ref')::uuid, coalesce((r->>'debt')::numeric,0), coalesce((r->>'advance')::numeric,0), now()
      from jsonb_array_elements(p->'debts') r;
    v := v || jsonb_build_object('debts', jsonb_array_length(p->'debts'));
  end if;
  return v;
end $$;

-- Права: RPC синхронизации — только service_role
do $$ declare f text; begin
  foreach f in array array['sa_sync_begin(text)','sa_sync_finish(bigint,text,jsonb,text)','sa_sync_plan(integer)',
    'sa_sync_load_chunk(bigint,date,integer,jsonb)','sa_sync_month_finish(bigint,date,numeric,numeric,boolean)',
    'sa_sync_month_error(date,text)','sa_sync_dims(jsonb)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Запуск по расписанию (pg_cron → pg_net → edge function), секрет — общий с sync-onec
create or replace function analytics.sync_trigger(p_body jsonb default '{}'::jsonb)
returns bigint language sql security definer set search_path = '' as $$
  select net.http_post(
    url     := 'https://znhwajycjdluzoypjejh.supabase.co/functions/v1/sync-onec-sales',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-sync-secret', (select value->>'sync_secret' from staging.onec_sync_config where key = 'main')),
    body    := p_body,
    timeout_milliseconds := 150000
  );
$$;
revoke all on function analytics.sync_trigger(jsonb) from public, anon, authenticated;
