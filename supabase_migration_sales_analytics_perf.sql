-- ============================================================================
-- Аналитика продаж — шаг 4: витрины и производительность.
-- Применять после _sync, _calc, _access. Лимит запросов PostgREST — 8 с, поэтому
-- тяжёлые агрегаты считаются при обновлении (каждые 30 мин после синхронизации),
-- а дашборд читает готовые витрины.
--   analytics.v_lines          — строки продаж с измерениями (materialized)
--   analytics.mv_doc_cat       — документ × категория (обзор, разрезы, KPI)
--   analytics.mv_client_stats  — профили клиентов на сегодня (риски, «позвонить сегодня»)
-- ============================================================================

-- 1) Справочники/долги: upsert вместо полной замены (safeupdate запрещает DELETE без WHERE)
create or replace function public.sa_sync_dims(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb := '{}'::jsonb;
begin
  if p ? 'groups' then
    insert into analytics.counterparty_groups(ref, name, parent_ref, synced_at)
    select (r->>'ref')::uuid, r->>'name', nullif(r->>'parent_ref','')::uuid, now() from jsonb_array_elements(p->'groups') r
    on conflict (ref) do update set name = excluded.name, parent_ref = excluded.parent_ref, synced_at = now();
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
    insert into analytics.debts(counterparty_ref, debt, advance, synced_at)
    select (r->>'counterparty_ref')::uuid, coalesce((r->>'debt')::numeric,0), coalesce((r->>'advance')::numeric,0), now()
      from jsonb_array_elements(p->'debts') r
    on conflict (counterparty_ref) do update set debt = excluded.debt, advance = excluded.advance, synced_at = now();
    update analytics.debts d set debt = 0, advance = 0, synced_at = now()
     where not exists (select 1 from jsonb_array_elements(p->'debts') r where (r->>'counterparty_ref')::uuid = d.counterparty_ref)
       and (d.debt <> 0 or d.advance <> 0);
    v := v || jsonb_build_object('debts', jsonb_array_length(p->'debts'));
  end if;
  return v;
end $$;

-- 2) Витрины
alter view analytics.v_lines rename to v_lines_src;
create materialized view analytics.v_lines as select * from analytics.v_lines_src;
create index v_lines_day_idx on analytics.v_lines (day);
create index v_lines_client_day_idx on analytics.v_lines (client_ref, day);
create index v_lines_manager_idx on analytics.v_lines (manager_ref);

create materialized view analytics.mv_doc_cat as
select doc, min(day) as day, client_ref, manager_ref, min(manager_name) as manager_name, channel, category,
       sum(amount) as amt, sum(net) as net, sum(net - cost_novat) as mg,
       coalesce(sum(amount) filter (where kind = 'sale'), 0) as sales,
       coalesce(-sum(amount) filter (where kind = 'return'), 0) as returns,
       bool_or(kind = 'sale' and amount > 0) as is_order
  from analytics.v_lines
 where not internal
 group by doc, client_ref, manager_ref, channel, category;
create index mv_doc_cat_day_idx on analytics.mv_doc_cat (day);

create materialized view analytics.mv_client_stats as
  select (now() at time zone 'Asia/Almaty')::date as asof, s.*
    from analytics.client_stats((now() at time zone 'Asia/Almaty')::date) s;
create index mv_client_stats_status_idx on analytics.mv_client_stats (status);

create or replace function analytics.refresh_lines()
returns void language plpgsql security definer set search_path = '' set work_mem = '128MB' as $$
begin
  refresh materialized view analytics.v_lines;
  refresh materialized view analytics.mv_doc_cat;
  refresh materialized view analytics.mv_client_stats;
end $$;

-- обновление витрин через 5 мин после синхронизации (7,37) и сразу после полуночи по Астане
select cron.schedule('onec-sales-refresh', '12,42 * * * *', $$select analytics.refresh_lines()$$);
select cron.schedule('onec-sales-refresh-midnight', '2 19 * * *', $$select analytics.refresh_lines()$$);

-- 3) Обзор по витрине документ × категория
create or replace function public.sa_overview(
  p_from date, p_to date,
  p_managers uuid[] default null, p_channels text[] default null,
  p_categories text[] default null, p_client uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' set work_mem = '64MB' as $$
declare
  v_len   int  := p_to - p_from + 1;
  v_pfrom date := p_from - (p_to - p_from + 1);
  v_pto   date := p_from - 1;
  v_yfrom date := (p_from - interval '1 year')::date;
  v_yto   date := (p_to - interval '1 year')::date;
  v_byday boolean := (p_to - p_from) <= 62;
  r jsonb;
begin
  perform analytics.require_staff();
  if p_from is null or p_to is null or p_to < p_from then raise exception 'bad period'; end if;

  with
  dc as materialized (
    select case when day between p_from and p_to then 'cur' when day between v_pfrom and v_pto then 'prev' end as w, *
      from analytics.mv_doc_cat
     where (day between v_pfrom and p_to)
       and (p_managers is null or cardinality(p_managers) = 0 or manager_ref = any(p_managers))
       and (p_channels is null or cardinality(p_channels) = 0 or channel = any(p_channels))
       and (p_categories is null or cardinality(p_categories) = 0 or category = any(p_categories))
       and (p_client is null or client_ref = p_client)
    union all
    select 'yoy', *
      from analytics.mv_doc_cat
     where (day between v_yfrom and v_yto)
       and (p_managers is null or cardinality(p_managers) = 0 or manager_ref = any(p_managers))
       and (p_channels is null or cardinality(p_channels) = 0 or channel = any(p_channels))
       and (p_categories is null or cardinality(p_categories) = 0 or category = any(p_categories))
       and (p_client is null or client_ref = p_client)
  ),
  docs as materialized (
    select w, doc, client_ref, min(day) as day, min(manager_ref::text) as manager_key, min(manager_name) as manager_name,
           min(channel) as channel, sum(amt) as amt, sum(net) as net, sum(mg) as mg,
           sum(sales) as sales, sum(returns) as returns, bool_or(is_order) as is_order
      from dc group by w, doc, client_ref
  ),
  kcl as (select w, count(*) as clients from (select distinct w, client_ref from docs where is_order) q group by w),
  kpi as (
    select d.w, sum(d.amt) as revenue, sum(d.net) as revenue_net, sum(d.mg) as margin,
           sum(d.sales) as sales, sum(d.returns) as returns, count(*) filter (where d.is_order) as orders,
           coalesce(max(k.clients), 0) as clients
      from docs d left join kcl k on k.w = d.w group by d.w
  ),
  sdocs as (
    select case when v_byday then day else date_trunc('month', day)::date end as t, client_ref, amt, mg, is_order from docs where w = 'cur'
  ),
  scl as (select t, count(*) as clients from (select distinct t, client_ref from sdocs where is_order) q group by t),
  series as (
    select s.t, sum(s.amt) as revenue, sum(s.mg) as margin, count(*) filter (where s.is_order) as orders, coalesce(max(c.clients), 0) as clients
      from sdocs s left join scl c on c.t = s.t group by s.t
  ),
  series_yoy as (
    select case when v_byday then (day + interval '1 year')::date else date_trunc('month', day + interval '1 year')::date end as t, sum(amt) as revenue
      from docs where w = 'yoy' group by 1
  ),
  bycl as (
    select client_ref, coalesce(sum(amt) filter (where w = 'cur'), 0) as cur, coalesce(sum(amt) filter (where w = 'prev'), 0) as prev
      from docs where w in ('cur', 'prev') group by 1
  ),
  bridge as (
    select b.*, coalesce(c.name, '(не указан)') as name, case
             when b.cur > 0 and m.first_sale between p_from and p_to then 'new'
             when b.prev <= 0 and b.cur > 0 then 'returned'
             when b.prev > 0 and b.cur <= 0 then 'lost'
             when b.prev > 0 and b.cur > b.prev then 'growth'
             when b.prev > 0 and b.cur < b.prev then 'decline'
             else 'flat' end as kind
      from bycl b
      left join analytics.mv_client_stats m on m.client_ref = b.client_ref
      left join analytics.counterparties c on c.ref = b.client_ref
  ),
  u as (
    select 'manager'::text as d, coalesce(manager_key, '') as key, manager_name as name, w, doc, client_ref, amt, mg, is_order from docs where w <> 'yoy'
    union all select 'channel', channel, channel, w, doc, client_ref, amt, mg, is_order from docs where w <> 'yoy'
    union all select 'client', coalesce(client_ref::text, ''), null, w, doc, client_ref, amt, mg, is_order from docs where w <> 'yoy'
    union all select 'category', category, category, w, doc, client_ref, amt, mg, is_order from dc where w in ('cur', 'prev')
  ),
  ucl as (select d, key, count(*) as clients from (select distinct d, key, client_ref from u where w = 'cur' and is_order) q group by d, key),
  dim as (
    select a.d, a.key, min(a.name) as name,
           coalesce(sum(a.amt) filter (where a.w = 'cur'), 0) as cur, coalesce(sum(a.amt) filter (where a.w = 'prev'), 0) as prev,
           coalesce(sum(a.mg) filter (where a.w = 'cur'), 0) as margin,
           count(*) filter (where a.w = 'cur' and a.is_order) as orders, coalesce(max(c.clients), 0) as clients
      from u a left join ucl c on c.d = a.d and c.key = a.key group by a.d, a.key
  ),
  dim_ranked as (
    select dim.*, case when dim.d = 'client' then coalesce(cp.name, '(не указан)') else dim.name end as label,
           row_number() over (partition by dim.d order by dim.cur desc) as rn
      from dim left join analytics.counterparties cp on dim.d = 'client' and cp.ref::text = dim.key
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'prev_from', v_pfrom, 'prev_to', v_pto, 'days', v_len, 'granularity', case when v_byday then 'day' else 'month' end),
    'kpi', (select jsonb_object_agg(w, jsonb_build_object(
               'revenue', round(revenue), 'revenue_net', round(revenue_net), 'margin', round(margin),
               'margin_pct', case when revenue_net <> 0 then round(100 * margin / revenue_net, 1) end,
               'sales', round(sales), 'returns', round(returns), 'orders', orders, 'clients', clients,
               'avg_check', case when orders > 0 then round(sales / orders) end)) from kpi),
    'new_clients', (select count(*) from bridge where kind = 'new'),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('t', s.t, 'revenue', round(s.revenue), 'margin', round(s.margin),
                       'orders', s.orders, 'clients', s.clients, 'revenue_yoy', round(y.revenue)) order by s.t), '[]')
                 from series s left join series_yoy y on y.t = s.t),
    'bridge', jsonb_build_object(
        'prev', (select round(coalesce(sum(prev), 0)) from bycl),
        'cur',  (select round(coalesce(sum(cur), 0)) from bycl),
        'parts', (select coalesce(jsonb_object_agg(kind, jsonb_build_object('amount', round(delta), 'clients', n)), '{}')
                    from (select kind, sum(cur - prev) as delta, count(*) as n from bridge where kind <> 'flat' or cur <> prev group by kind) z),
        'top_lost', (select coalesce(jsonb_agg(jsonb_build_object('ref', client_ref, 'name', name, 'prev', round(prev), 'cur', round(cur)) order by prev - cur desc), '[]')
                       from (select * from bridge where kind = 'lost' order by prev - cur desc limit 10) z),
        'top_decline', (select coalesce(jsonb_agg(jsonb_build_object('ref', client_ref, 'name', name, 'prev', round(prev), 'cur', round(cur)) order by prev - cur desc), '[]')
                       from (select * from bridge where kind = 'decline' order by prev - cur desc limit 10) z)),
    'breakdown', (select jsonb_object_agg(d, items) from (
        select d, jsonb_agg(jsonb_build_object('key', key, 'name', label, 'revenue', round(cur), 'prev', round(prev),
                 'margin', round(margin), 'orders', orders, 'clients', clients) order by cur desc) as items
          from dim_ranked where rn <= case when d = 'client' then 15 else 50 end and (cur <> 0 or prev <> 0)
         group by d) z),
    'cost_preliminary', exists (select 1 from analytics.sync_months
                                 where month between date_trunc('month', p_from)::date and p_to and rows > 0 and coalesce(closed, false) = false)
  ) into r;
  return r;
end $$;

-- 4) Топ товаров — отдельный запрос по строкам
create or replace function public.sa_products(
  p_from date, p_to date,
  p_managers uuid[] default null, p_channels text[] default null,
  p_categories text[] default null, p_client uuid default null, p_limit int default 15)
returns jsonb language plpgsql stable security definer set search_path = '' set work_mem = '64MB' as $$
declare v_pfrom date := p_from - (p_to - p_from + 1); r jsonb;
begin
  perform analytics.require_staff();
  with s as (
    select product_ref, min(product_name) as name,
           coalesce(sum(amount) filter (where day >= p_from), 0) as cur,
           coalesce(sum(amount) filter (where day < p_from), 0) as prev,
           coalesce(sum(net - cost_novat) filter (where day >= p_from), 0) as margin,
           coalesce(sum(qty) filter (where day >= p_from and kind = 'sale'), 0) as qty
      from analytics.lines_f(p_managers, p_channels, p_categories, p_client)
     where day between v_pfrom and p_to
     group by product_ref
  )
  select coalesce(jsonb_agg(jsonb_build_object('key', coalesce(product_ref::text, ''), 'name', name, 'revenue', round(cur), 'prev', round(prev),
           'margin', round(margin), 'orders', round(qty), 'clients', null) order by cur desc), '[]')
    into r
    from (select * from s where cur <> 0 or prev <> 0 order by cur desc limit p_limit) z;
  return r;
end $$;

-- 5) Прогноз по готовому дневному ряду (один проход по данным)
create or replace function analytics.forecast_series(p_asof date, p_days int, p_d date[], p_a numeric[])
returns jsonb language sql immutable as $$
with d as (
  select day, amt from unnest(p_d, p_a) as x(day, amt) where day <= p_asof
), m as (
  select date_trunc('month', day)::date as mon, sum(amt) as amt from d
   where day < date_trunc('month', p_asof) group by 1
), yr as (
  select extract(year from mon)::int as y, avg(amt) as avg_m from m group by 1 having count(*) = 12
), si as (
  select extract(month from m.mon)::int as mo, avg(m.amt / nullif(yr.avg_m, 0)) as idx, count(*) as years
    from m join yr on yr.y = extract(year from m.mon)::int group by 1
), base as (
  select coalesce(sum(d.amt), 0) / 91.0 as rate, avg(coalesce(si.idx, 1)) as base_idx
    from generate_series(p_asof - 90, p_asof, interval '1 day') g(day)
    left join d on d.day = g.day::date
    left join si on si.mo = extract(month from g.day)::int
), fut as (
  select g.day::date as day,
         (select rate from base) * coalesce(si.idx, 1) / nullif((select base_idx from base), 0) as amt
    from generate_series(p_asof + 1, p_asof + p_days, interval '1 day') g(day)
    left join si on si.mo = extract(month from g.day)::int
)
select jsonb_build_object(
  'total', round(coalesce((select sum(amt) from fut), 0)),
  'rate_per_day', round((select rate from base)),
  'seasonal_years', (select max(years) from si),
  'by_month', (select coalesce(jsonb_agg(jsonb_build_object('month', mon, 'amount', round(a)) order by mon), '[]')
                 from (select date_trunc('month', day)::date mon, sum(amt) a from fut group by 1) z),
  'seasonal_index', (select coalesce(jsonb_object_agg(mo, round(idx::numeric, 3)), '{}') from si)
);
$$;

create or replace function public.sa_forecast(
  p_asof date default null,
  p_managers uuid[] default null, p_channels text[] default null,
  p_categories text[] default null, p_client uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' set work_mem = '64MB' as $$
declare
  v_asof date := coalesce(p_asof, (now() at time zone 'Asia/Almaty')::date - 1);
  v_d date[]; v_a numeric[];
  v_bt jsonb := '[]'::jsonb; v_cut date; v_fc numeric; v_fact numeric; i int;
begin
  perform analytics.require_staff();
  select array_agg(day order by day), array_agg(amt order by day) into v_d, v_a
    from (select day, sum(amount) amt from analytics.lines_f(p_managers, p_channels, p_categories, p_client)
           where day <= v_asof group by 1) z;
  v_d := coalesce(v_d, '{}'); v_a := coalesce(v_a, '{}');

  for i in 1..6 loop
    v_cut := (date_trunc('month', v_asof) - make_interval(months => i) - interval '1 day')::date;
    exit when v_cut + 30 > v_asof;
    v_fc := (analytics.forecast_series(v_cut, 30, v_d, v_a) ->> 'total')::numeric;
    select coalesce(sum(a), 0) into v_fact from unnest(v_d, v_a) x(d, a) where d > v_cut and d <= v_cut + 30;
    v_bt := v_bt || jsonb_build_object('asof', v_cut, 'forecast', round(v_fc), 'fact', round(v_fact),
              'error_pct', case when v_fact <> 0 then round(100 * (v_fc - v_fact) / v_fact, 1) end);
  end loop;

  return jsonb_build_object(
    'asof', v_asof,
    'method', 'Дневной темп выручки за последние 91 день, скорректированный сезонными индексами месяцев (по полным годам истории). Это оценка, не факт.',
    'h30', analytics.forecast_series(v_asof, 30, v_d, v_a),
    'h60', analytics.forecast_series(v_asof, 60, v_d, v_a),
    'h90', analytics.forecast_series(v_asof, 90, v_d, v_a),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('month', mon, 'revenue', round(a)) order by mon), '[]')
                  from (select date_trunc('month', d)::date mon, sum(a) a from unnest(v_d, v_a) x(d, a)
                         where d > (date_trunc('month', v_asof) - interval '24 months')::date group by 1) z),
    'backtest', v_bt,
    'mape', (select round(avg(abs((e ->> 'error_pct')::numeric)), 1) from jsonb_array_elements(v_bt) e where e ->> 'error_pct' is not null)
  );
end $$;

-- 6) Клиенты: кэш на сегодня, сводка по тем же клиентам, что в списке
create or replace function public.sa_clients(
  p_asof date default null,
  p_managers uuid[] default null, p_channels text[] default null,
  p_categories text[] default null, p_client uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' set work_mem = '64MB' as $$
declare
  v_asof date := coalesce(p_asof, (now() at time zone 'Asia/Almaty')::date);
  v_cache boolean;
  r jsonb;
begin
  perform analytics.require_staff();
  v_cache := exists (select 1 from analytics.mv_client_stats where asof = v_asof);

  with src as (
    select m.client_ref, m.client_name, m.channel, m.manager_ref, m.manager_name, m.first_sale, m.last_sale,
           m.last_order_amount, m.orders_total, m.orders_12m, m.orders_90, m.orders_prev90, m.median_gap,
           m.rev_12m, m.rev_90, m.rev_prev90, m.margin_12m, m.avg_check_12m, m.baseline_monthly, m.days_since,
           m.expected_next, m.overdue_days, m.status, m.debt
      from analytics.mv_client_stats m where v_cache
    union all
    select * from analytics.client_stats(v_asof) where not v_cache
  ),
  cs as (
    select * from src s
     where s.status <> 'archive'
       and (s.rev_12m > 0 or (s.status in ('lost', 'one_time') and s.days_since <= 365))
       and (p_managers is null or cardinality(p_managers) = 0 or s.manager_ref = any(p_managers))
       and (p_channels is null or cardinality(p_channels) = 0 or s.channel = any(p_channels))
       and (p_client is null or s.client_ref = p_client)
       and (p_categories is null or cardinality(p_categories) = 0 or exists (
             select 1 from analytics.v_lines l where l.client_ref = s.client_ref and l.category = any(p_categories)
                and l.day > v_asof - 365 and l.day <= v_asof and l.kind = 'sale'))
  ),
  dropped as (
    select client_ref, jsonb_agg(category order by prev_rev desc) as cats
      from (select l.client_ref, l.category,
                   sum(l.amount) filter (where l.day > v_asof - 270 and l.day <= v_asof - 90) as prev_rev,
                   coalesce(sum(l.amount) filter (where l.day > v_asof - 90 and l.day <= v_asof), 0) as cur_rev
              from analytics.v_lines l
             where not l.internal and l.day > v_asof - 270 and l.day <= v_asof and l.category <> 'Без категории'
               and l.client_ref in (select client_ref from cs where status in ('sleeping', 'declining'))
             group by 1, 2) z
     where prev_rev > 0 and cur_rev <= 0
     group by client_ref
  ),
  scored as (
    select cs.*, d.cats as dropped_categories,
           round(case
             when cs.status in ('lost', 'sleeping', 'one_time') then cs.baseline_monthly
             when cs.status = 'declining' then greatest(0, (cs.rev_prev90 - cs.rev_90) / 3)
             else 0 end) as loss_monthly,
           round(case
             when cs.status in ('lost', 'sleeping') and cs.overdue_days > 0 then cs.baseline_monthly * cs.overdue_days / 30.4
             when cs.status = 'declining' then greatest(0, cs.rev_prev90 - cs.rev_90)
             else 0 end) as missed_so_far
      from cs left join dropped d on d.client_ref = cs.client_ref
  ),
  acts as (
    select s.*,
      (case s.status
        when 'lost' then 'Не покупает ' || s.days_since || ' дн. (последний заказ ' || to_char(s.last_sale, 'DD.MM.YYYY') || ')'
        when 'sleeping' then 'Обычно заказывает раз в ' || round(s.median_gap) || ' дн., сейчас пауза ' || s.days_since || ' дн.'
        when 'one_time' then 'Один заказ ' || to_char(s.last_sale, 'DD.MM.YYYY') || ', повторного не было'
        when 'declining' then
          case when s.rev_prev90 > 0 then 'Выручка за 90 дн. ' || round(100 * (s.rev_90 - s.rev_prev90) / s.rev_prev90) || '% к прошлым 90 дн.' else '' end
          || case when s.orders_prev90 > 0 and s.orders_90 < s.orders_prev90 then '; заказов ' || s.orders_90 || ' вместо ' || s.orders_prev90 else '' end
        else null end)
      || case when s.dropped_categories is not null then '; перестал брать: '
              || (select string_agg(x, ', ') from (select jsonb_array_elements_text(s.dropped_categories) x limit 3) q) else '' end
      as reason,
      (case when s.debt > 0 and s.status in ('lost', 'sleeping', 'declining', 'one_time')
            then 'Долг ' || replace(to_char(round(s.debt), 'FM999,999,999,999'), ',', ' ') || ' ₸ — согласовать оплату. ' else '' end)
      || case s.status
        when 'lost' then 'Позвонить: выяснить причину ухода (цена, сервис, ассортимент, конкурент) и предложить возобновить поставки.'
        when 'sleeping' then 'Позвонить сегодня: заказ ожидался ' || to_char(s.expected_next, 'DD.MM') || ', принять заказ по обычному ассортименту.'
        when 'one_time' then 'Узнать впечатление от первой поставки и предложить регулярный заказ.'
        when 'declining' then
          case when s.dropped_categories is not null then 'Выяснить, где теперь закупает выпавшие категории, предложить их в следующем заказе.'
               else 'Встреча/звонок: что изменилось у клиента, вернуть прежний объём заказа.' end
        when 'new' then 'Довести до второго заказа.'
        else null end
      as action
    from scored s
  ),
  ranked as (
    select a.*,
           round(a.loss_monthly * case a.status when 'sleeping' then 1.0 when 'declining' then 0.8
                                   when 'lost' then case when a.days_since <= 180 then 0.6 else 0.25 end
                                   when 'one_time' then 0.3 else 0 end) as priority
      from acts a
  )
  select jsonb_build_object(
    'asof', v_asof,
    'cached', v_cache,
    'summary', (select jsonb_object_agg(status, jsonb_build_object('clients', n, 'loss_monthly', loss, 'rev_12m', rev))
                  from (select status, count(*) n, round(sum(loss_monthly)) loss, round(sum(rev_12m)) rev from ranked group by status) z),
    'clients', (select coalesce(jsonb_agg(jsonb_build_object(
        'ref', client_ref, 'name', client_name, 'channel', channel, 'manager_ref', manager_ref, 'manager', manager_name,
        'status', status, 'first_sale', first_sale, 'last_sale', last_sale, 'last_order', round(last_order_amount),
        'days_since', days_since, 'expected_next', expected_next, 'overdue_days', overdue_days,
        'orders_total', orders_total, 'orders_12m', orders_12m, 'orders_90', orders_90, 'orders_prev90', orders_prev90,
        'median_gap', median_gap, 'avg_check', avg_check_12m,
        'rev_12m', round(rev_12m), 'rev_90', round(rev_90), 'rev_prev90', round(rev_prev90), 'margin_12m', round(margin_12m),
        'debt', round(debt), 'loss_monthly', loss_monthly, 'missed', missed_so_far, 'priority', priority,
        'dropped_categories', dropped_categories, 'reason', reason, 'action', action
      ) order by priority desc, rev_12m desc), '[]') from ranked)
  ) into r;
  return r;
end $$;

alter function public.sa_opportunities(date,uuid[],text[],text[]) set work_mem = '64MB';
alter function public.sa_meta() set work_mem = '32MB';

-- ============================================================================
-- Холодный кэш (2026-10-19): sa_meta сканировал v_lines трижды (до 7 с при пустом кэше,
-- таймаут 8 с). Миграции sales_meta_cache_prewarm + sales_refresh_skip_unchanged.
-- ============================================================================
create extension if not exists pg_prewarm with schema extensions;

create table if not exists analytics.meta_cache (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table analytics.meta_cache enable row level security;

create or replace function analytics.build_meta_cache()
returns void language plpgsql security definer set search_path = '' set work_mem = '64MB' as $$
declare v jsonb;
begin
  with g as (
    select manager_ref, min(manager_name) manager_name, channel, category,
           sum(amount) rev2y, sum(amount) filter (where day > current_date - 365) rev1y
      from analytics.v_lines
     where not internal and day > current_date - 730
     group by manager_ref, channel, category
  )
  select jsonb_build_object(
    'managers', (select coalesce(jsonb_agg(jsonb_build_object('ref', manager_ref, 'name', manager_name, 'revenue_12m', rev) order by rev desc), '[]')
                   from (select manager_ref, min(manager_name) manager_name, sum(rev1y) rev from g
                          where manager_ref is not null group by 1 having sum(rev1y) is not null) m),
    'channels', (select coalesce(jsonb_agg(channel order by rev desc), '[]') from (select channel, sum(rev2y) rev from g group by 1) c),
    'categories', (select coalesce(jsonb_agg(category order by rev desc), '[]') from (select category, sum(rev2y) rev from g group by 1) c),
    'data_from', (select min(month) from analytics.sales),
    'data_to', (select max(period)::date from analytics.sales)
  ) into v from (select 1) x;
  insert into analytics.meta_cache(key, value, updated_at) values ('meta', v, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-- Пересчёт только при изменении данных (подпись по sync_months); ночью — всегда.
-- После пересчёта: кэш справочников и прогрев витрин в shared_buffers.
create or replace function analytics.refresh_lines()
returns void language plpgsql security definer set search_path = '' set work_mem = '128MB' as $$
declare sig text; old text;
begin
  select md5(string_agg(month::text || ':' || coalesce(rows, 0) || ':' || coalesce(amount, 0) || ':' || coalesce(qty, 0), ',' order by month))
    into sig from analytics.sync_months;
  select value->>'sig' into old from analytics.meta_cache where key = 'lines_sig';
  if sig is not distinct from old and extract(hour from now() at time zone 'Asia/Almaty') <> 0 then
    return;
  end if;
  refresh materialized view analytics.v_lines;
  refresh materialized view analytics.mv_doc_cat;
  refresh materialized view analytics.mv_client_stats;
  perform analytics.build_meta_cache();
  insert into analytics.meta_cache(key, value, updated_at) values ('lines_sig', jsonb_build_object('sig', sig), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform extensions.pg_prewarm(c.oid::regclass)
     from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'analytics'
      and c.relname in ('mv_doc_cat', 'mv_doc_cat_day_idx', 'mv_client_stats', 'v_lines', 'v_lines_day_idx', 'v_lines_client_day_idx', 'v_lines_manager_idx');
end $$;

create or replace function public.sa_meta()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb; c jsonb;
begin
  perform analytics.require_staff();
  select value into c from analytics.meta_cache where key = 'meta';
  select coalesce(c, '{}'::jsonb) || jsonb_build_object(
    'managers', coalesce(c->'managers', '[]'::jsonb),
    'channels', coalesce(c->'channels', '[]'::jsonb),
    'categories', coalesce(c->'categories', '[]'::jsonb),
    'sync', (select jsonb_build_object(
        'last_run',    (select jsonb_build_object('id', id, 'started_at', started_at, 'finished_at', finished_at, 'status', status, 'error', error)
                          from analytics.sync_runs order by id desc limit 1),
        'last_ok_at',  (select max(finished_at) from analytics.sync_runs where status in ('ok', 'partial')),
        'months_total', (select count(*) from analytics.sync_months where synced_at is not null),
        'months_mismatch', (select coalesce(jsonb_agg(month order by month), '[]') from analytics.sync_months where status in ('mismatch', 'error')),
        'months_open', (select coalesce(jsonb_agg(month order by month), '[]') from analytics.sync_months
                         where synced_at is not null and coalesce(closed, false) = false and rows > 0),
        'debts_at',    (select max(synced_at) from analytics.debts))),
    'excluded', (select value from analytics.settings where key = 'exclude'),
    'is_admin', public.get_role_for_uid(auth.uid()) = 'admin'
  ) into r;
  return r;
end $$;

select analytics.build_meta_cache();

-- Запас на «холодный» кэш маленького инстанса (было 8s)
alter role authenticated set statement_timeout = '20s';
notify pgrst, 'reload config';
