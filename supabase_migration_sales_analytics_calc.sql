-- ============================================================================
-- Аналитика продаж: расчёты (только чтение analytics.*, кроме sa_plan_set)
-- Все показатели считаются по фактическим строкам регистра «Продажи» 1С.
-- Прогноз — отдельная функция, в факт не подмешивается.
--
-- Определения:
--   Выручка        = Сумма движений (с НДС), возвраты уменьшают выручку.
--   Чистая выручка = Сумма − СуммаНДС.  Маржа = Чистая выручка − Себестоимость без НДС.
--   Себестоимость окончательна только для месяцев с проведённым «Закрытием месяца».
--   Заказ          = документ продажи (РасходнаяНакладная) с суммой > 0.
--   Внутренние     = контрагенты из групп/наименований analytics.settings('exclude') — исключены.
-- ============================================================================

-- ---------- Доступ: только персонал admin/manager ----------
create or replace function analytics.require_staff()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(public.get_role_for_uid(auth.uid()), '') not in ('admin', 'manager') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end $$;

-- ---------- Контрагент → канал (группа верхнего уровня) и признак «внутренний» ----------
create or replace view analytics.v_clients as
with recursive g as (
  select ref, name as top_name from analytics.counterparty_groups where parent_ref is null
  union all
  select c.ref, g.top_name from analytics.counterparty_groups c join g on c.parent_ref = g.ref
), ex as (select value v from analytics.settings where key = 'exclude')
select c.ref, c.name, c.full_name, c.phone, c.bin, c.responsible_ref,
       coalesce(g.top_name, 'Без группы') as channel,
       ( coalesce(g.top_name, '') in (select jsonb_array_elements_text(ex.v -> 'groups'))
         or exists (select 1 from jsonb_array_elements_text(ex.v -> 'name_patterns') x
                     where c.name ilike '%' || x || '%' or c.full_name ilike '%' || x || '%') ) as internal
  from analytics.counterparties c
  cross join ex
  left join g on g.ref = c.parent_ref;

-- ---------- Номенклатура → категория (папка верхнего уровня) ----------
create or replace view analytics.v_products as
with recursive pf as (
  select ref, name as top_name from analytics.products where is_folder and parent_ref is null
  union all
  select p.ref, pf.top_name from analytics.products p join pf on p.parent_ref = pf.ref where p.is_folder
)
select p.ref, p.name, p.code, p.article, coalesce(pf.top_name, 'Без категории') as category
  from analytics.products p
  left join pf on pf.ref = p.parent_ref
 where not p.is_folder;

-- ---------- Строки продаж с измерениями ----------
create or replace view analytics.v_lines as
select s.period::date                      as day,
       s.month,
       coalesce(s.doc_ref, s.recorder)     as doc,
       s.recorder_type,
       case when s.amount = 0 and s.qty = 0 then 'adj'
            when s.amount < 0 or s.qty < 0 or s.recorder_type ~ 'ПриходнаяНакладная|Возврат' then 'return'
            else 'sale' end                as kind,
       s.counterparty_ref                  as client_ref,
       coalesce(c.name, '(не указан)')     as client_name,
       coalesce(c.channel, 'Без группы')   as channel,
       s.responsible_ref                   as manager_ref,
       coalesce(e.name, '(не указан)')     as manager_name,
       s.product_ref,
       coalesce(p.name, '(не указана)')    as product_name,
       coalesce(p.category, 'Без категории') as category,
       s.org_ref, s.qty, s.amount,
       s.amount - s.vat                    as net,
       s.cost_novat,
       (s.counterparty_ref is null or coalesce(c.internal, false)) as internal
  from analytics.sales s
  left join analytics.v_clients  c on c.ref = s.counterparty_ref
  left join analytics.employees  e on e.ref = s.responsible_ref
  left join analytics.v_products p on p.ref = s.product_ref;

-- ---------- Фильтр (общий для всех RPC) ----------
create or replace function analytics.lines_f(
  p_managers uuid[], p_channels text[], p_categories text[], p_client uuid)
returns setof analytics.v_lines language sql stable as $$
  select * from analytics.v_lines l
   where not l.internal
     and (p_managers   is null or cardinality(p_managers)   = 0 or l.manager_ref = any(p_managers))
     and (p_channels   is null or cardinality(p_channels)   = 0 or l.channel     = any(p_channels))
     and (p_categories is null or cardinality(p_categories) = 0 or l.category    = any(p_categories))
     and (p_client     is null or l.client_ref = p_client);
$$;

-- ============================================================================
-- Профиль клиента на дату: частота, средний чек, динамика, статус риска
-- ============================================================================
create or replace function analytics.client_stats(p_asof date)
returns table (
  client_ref uuid, client_name text, channel text, manager_ref uuid, manager_name text,
  first_sale date, last_sale date, last_order_amount numeric,
  orders_total int, orders_12m int, orders_90 int, orders_prev90 int,
  median_gap numeric, rev_12m numeric, rev_90 numeric, rev_prev90 numeric, margin_12m numeric,
  avg_check_12m numeric, baseline_monthly numeric, days_since int, expected_next date, overdue_days int,
  status text, debt numeric)
language sql stable as $$
with l as (
  select * from analytics.v_lines where not internal and client_ref is not null and day <= p_asof
), orders as (
  select client_ref, doc, min(day) as day, sum(amount) as amt
    from l where kind = 'sale' group by 1, 2 having sum(amount) > 0
), odays as (
  select distinct client_ref, day from orders
), gaps as (
  select client_ref, day, day - lag(day) over (partition by client_ref order by day) as gap from odays
), g as (
  select client_ref,
         percentile_cont(0.5) within group (order by gap) filter (where day > p_asof - 365) as g12,
         count(gap) filter (where day > p_asof - 365) as n12,
         percentile_cont(0.5) within group (order by gap) as gall
    from gaps where gap is not null group by 1
), agg as (
  select client_ref,
         min(client_name) as client_name, min(channel) as channel,
         sum(amount) filter (where day > p_asof - 365) as rev_12m,
         sum(amount) filter (where day > p_asof - 90)  as rev_90,
         sum(amount) filter (where day > p_asof - 180 and day <= p_asof - 90) as rev_prev90,
         sum(net - cost_novat) filter (where day > p_asof - 365) as margin_12m
    from l group by 1
), oc as (
  select client_ref, min(day) as first_sale, max(day) as last_sale,
         count(*)::int as orders_total,
         count(*) filter (where day > p_asof - 365)::int as o12,
         count(*) filter (where day > p_asof - 90)::int  as o90,
         count(*) filter (where day > p_asof - 180 and day <= p_asof - 90)::int as op90,
         sum(amt) filter (where day > p_asof - 365) as amt12
    from orders group by 1
), lastord as (
  select distinct on (client_ref) client_ref, amt from orders order by client_ref, day desc, amt desc
), mgr as (
  select distinct on (client_ref) client_ref, manager_ref, manager_name
    from l where kind = 'sale' and manager_ref is not null order by client_ref, day desc
), base as (
  select oc.client_ref, sum(l.amount) as rev_before_last
    from oc join l on l.client_ref = oc.client_ref and l.day > oc.last_sale - 180 and l.day <= oc.last_sale
   group by 1
), x as (
  select oc.client_ref, agg.client_name, agg.channel,
         coalesce(mgr.manager_ref, vc.responsible_ref) as manager_ref,
         coalesce(mgr.manager_name, e.name, '(не указан)') as manager_name,
         oc.first_sale, oc.last_sale, lastord.amt as last_order_amount,
         oc.orders_total, oc.o12, oc.o90, oc.op90,
         round((case when g.n12 >= 2 then g.g12 else g.gall end)::numeric, 1) as mg,
         coalesce(agg.rev_12m, 0) as rev_12m, coalesce(agg.rev_90, 0) as rev_90,
         coalesce(agg.rev_prev90, 0) as rev_prev90, coalesce(agg.margin_12m, 0) as margin_12m,
         case when oc.o12 > 0 then round(oc.amt12 / oc.o12) end as avg_check_12m,
         round(coalesce(base.rev_before_last, 0)
               / greatest(1, least(6, (oc.last_sale - oc.first_sale + 30) / 30.4))) as baseline_monthly,
         (p_asof - oc.last_sale) as days_since,
         coalesce(d.debt, 0) as debt
    from oc
    join agg on agg.client_ref = oc.client_ref
    left join g       on g.client_ref = oc.client_ref
    left join lastord on lastord.client_ref = oc.client_ref
    left join mgr     on mgr.client_ref = oc.client_ref
    left join base    on base.client_ref = oc.client_ref
    left join analytics.v_clients vc on vc.ref = oc.client_ref
    left join analytics.employees e  on e.ref = vc.responsible_ref
    left join analytics.debts d      on d.counterparty_ref = oc.client_ref
)
select client_ref, client_name, channel, manager_ref, manager_name,
       first_sale, last_sale, last_order_amount,
       orders_total, o12, o90, op90, mg, rev_12m, rev_90, rev_prev90, margin_12m,
       avg_check_12m, baseline_monthly, days_since,
       case when mg is not null then last_sale + ceil(mg)::int end as expected_next,
       case when mg is not null then days_since - ceil(mg)::int end as overdue_days,
       case
         when days_since > 730 then 'archive'
         when days_since > greatest(90, 3 * coalesce(mg, 30)) then 'lost'
         when orders_total = 1 and days_since > 45 then 'one_time'
         when mg is not null and days_since > greatest(mg * 1.5, mg + 7, 14) then 'sleeping'
         when rev_prev90 >= 30000 and rev_90 < 0.7 * rev_prev90 then 'declining'
         when op90 >= 3 and o90 < 0.6 * op90 then 'declining'
         when first_sale > p_asof - 60 then 'new'
         when rev_prev90 > 0 and rev_90 > 1.3 * rev_prev90 then 'growing'
         else 'active'
       end as status,
       debt
  from x;
$$;

-- ============================================================================
-- RPC: справочники фильтров + состояние синхронизации
-- ============================================================================
create or replace function public.sa_meta()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform analytics.require_staff();
  select jsonb_build_object(
    'managers', (select coalesce(jsonb_agg(jsonb_build_object('ref', manager_ref, 'name', manager_name, 'revenue_12m', rev) order by rev desc), '[]')
                   from (select manager_ref, min(manager_name) manager_name, sum(amount) rev from analytics.v_lines
                          where not internal and manager_ref is not null and day > current_date - 365 group by 1) m),
    'channels', (select coalesce(jsonb_agg(channel order by rev desc), '[]')
                   from (select channel, sum(amount) rev from analytics.v_lines where not internal and day > current_date - 730 group by 1) c),
    'categories', (select coalesce(jsonb_agg(category order by rev desc), '[]')
                   from (select category, sum(amount) rev from analytics.v_lines where not internal and day > current_date - 730 group by 1) c),
    'data_from', (select min(month) from analytics.sales),
    'data_to',   (select max(period)::date from analytics.sales),
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

-- ============================================================================
-- RPC: обзор периода — KPI, динамика, разрезы, причины изменения выручки
-- ============================================================================
create or replace function public.sa_overview(
  p_from date, p_to date,
  p_managers uuid[] default null, p_channels text[] default null,
  p_categories text[] default null, p_client uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_len   int  := p_to - p_from + 1;
  v_pfrom date := p_from - (p_to - p_from + 1);
  v_pto   date := p_from - 1;
  v_byday boolean := (p_to - p_from) <= 62;
  r jsonb;
begin
  perform analytics.require_staff();
  if p_from is null or p_to is null or p_to < p_from then raise exception 'bad period'; end if;

  with
  _f as materialized (
    select * from analytics.lines_f(p_managers, p_channels, p_categories, p_client)
     where day between least(v_pfrom, (p_from - interval '1 year')::date) and p_to
  ),
  kpi as (
    select w,
           coalesce(sum(amount), 0)                                   as revenue,
           coalesce(sum(net), 0)                                      as revenue_net,
           coalesce(sum(net - cost_novat), 0)                         as margin,
           coalesce(sum(amount) filter (where kind = 'sale'), 0)      as sales,
           coalesce(-sum(amount) filter (where kind = 'return'), 0)   as returns,
           count(distinct doc) filter (where kind = 'sale' and amount > 0) as orders,
           count(distinct client_ref) filter (where kind = 'sale' and amount > 0) as clients
      from (select *, case when day between p_from and p_to then 'cur'
                           when day between v_pfrom and v_pto then 'prev'
                           when day between (p_from - interval '1 year')::date and (p_to - interval '1 year')::date then 'yoy' end as w
              from _f) t
     where w is not null group by w
  ),
  firsts as (   -- первая продажа клиента за всю историю (в рамках фильтра)
    select client_ref, min(day) as first_day
      from analytics.lines_f(p_managers, p_channels, p_categories, p_client)
     where kind = 'sale' and amount > 0 group by 1
  ),
  series as (
    select case when v_byday then day else date_trunc('month', day)::date end as t,
           sum(amount) as revenue, sum(net - cost_novat) as margin,
           count(distinct doc) filter (where kind = 'sale' and amount > 0) as orders,
           count(distinct client_ref) filter (where kind = 'sale' and amount > 0) as clients
      from _f where day between p_from and p_to group by 1
  ),
  series_yoy as (
    select case when v_byday then (day + interval '1 year')::date else date_trunc('month', day + interval '1 year')::date end as t,
           sum(amount) as revenue
      from _f where day between (p_from - interval '1 year')::date and (p_to - interval '1 year')::date group by 1
  ),
  bycl as (
    select client_ref, min(client_name) as name,
           coalesce(sum(amount) filter (where day between p_from and p_to), 0) as cur,
           coalesce(sum(amount) filter (where day between v_pfrom and v_pto), 0) as prev
      from _f group by 1
  ),
  bridge as (
    select b.*, case
             when b.cur > 0 and f.first_day between p_from and p_to then 'new'
             when b.prev <= 0 and b.cur > 0 then 'returned'
             when b.prev > 0 and b.cur <= 0 then 'lost'
             when b.prev > 0 and b.cur > b.prev then 'growth'
             when b.prev > 0 and b.cur < b.prev then 'decline'
             else 'flat' end as kind
      from bycl b left join firsts f on f.client_ref = b.client_ref
  ),
  dim as (
    select 'manager' as d, coalesce(manager_ref::text, '') as key, min(manager_name) as name,
           sum(amount) filter (where day between p_from and p_to) as cur,
           sum(amount) filter (where day between v_pfrom and v_pto) as prev,
           sum(net - cost_novat) filter (where day between p_from and p_to) as margin,
           count(distinct doc) filter (where day between p_from and p_to and kind = 'sale' and amount > 0) as orders,
           count(distinct client_ref) filter (where day between p_from and p_to and kind = 'sale' and amount > 0) as clients
      from _f group by 1, 2
    union all
    select 'channel', channel, channel,
           sum(amount) filter (where day between p_from and p_to), sum(amount) filter (where day between v_pfrom and v_pto),
           sum(net - cost_novat) filter (where day between p_from and p_to),
           count(distinct doc) filter (where day between p_from and p_to and kind = 'sale' and amount > 0),
           count(distinct client_ref) filter (where day between p_from and p_to and kind = 'sale' and amount > 0)
      from _f group by 1, 2
    union all
    select 'category', category, category,
           sum(amount) filter (where day between p_from and p_to), sum(amount) filter (where day between v_pfrom and v_pto),
           sum(net - cost_novat) filter (where day between p_from and p_to),
           count(distinct doc) filter (where day between p_from and p_to and kind = 'sale' and amount > 0),
           count(distinct client_ref) filter (where day between p_from and p_to and kind = 'sale' and amount > 0)
      from _f group by 1, 2
    union all
    select 'product', coalesce(product_ref::text, ''), min(product_name),
           sum(amount) filter (where day between p_from and p_to), sum(amount) filter (where day between v_pfrom and v_pto),
           sum(net - cost_novat) filter (where day between p_from and p_to),
           count(distinct doc) filter (where day between p_from and p_to and kind = 'sale' and amount > 0),
           count(distinct client_ref) filter (where day between p_from and p_to and kind = 'sale' and amount > 0)
      from _f group by 1, 2
    union all
    select 'client', coalesce(client_ref::text, ''), min(client_name),
           sum(amount) filter (where day between p_from and p_to), sum(amount) filter (where day between v_pfrom and v_pto),
           sum(net - cost_novat) filter (where day between p_from and p_to),
           count(distinct doc) filter (where day between p_from and p_to and kind = 'sale' and amount > 0),
           count(distinct client_ref) filter (where day between p_from and p_to and kind = 'sale' and amount > 0)
      from _f group by 1, 2
  ),
  dim_ranked as (
    select *, row_number() over (partition by d order by coalesce(cur, 0) desc) as rn from dim
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
        select d, jsonb_agg(jsonb_build_object('key', key, 'name', name, 'revenue', round(coalesce(cur, 0)), 'prev', round(coalesce(prev, 0)),
                 'margin', round(coalesce(margin, 0)), 'orders', orders, 'clients', clients) order by coalesce(cur, 0) desc) as items
          from dim_ranked where rn <= case when d in ('product', 'client') then 15 else 50 end and (coalesce(cur, 0) <> 0 or coalesce(prev, 0) <> 0)
         group by d) z),
    'cost_preliminary', exists (select 1 from analytics.sync_months
                                 where month between date_trunc('month', p_from)::date and p_to and rows > 0 and coalesce(closed, false) = false)
  ) into r;
  return r;
end $$;

-- ============================================================================
-- RPC: клиенты — риск, причины, потери, рекомендуемое действие, «позвонить сегодня»
-- ============================================================================
create or replace function public.sa_clients(
  p_asof date default null,
  p_managers uuid[] default null, p_channels text[] default null,
  p_categories text[] default null, p_client uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_asof date := coalesce(p_asof, (now() at time zone 'Asia/Almaty')::date); r jsonb;
begin
  perform analytics.require_staff();

  with cs as (
    select * from analytics.client_stats(v_asof) s
     where s.status <> 'archive'
       and (p_managers is null or cardinality(p_managers) = 0 or s.manager_ref = any(p_managers))
       and (p_channels is null or cardinality(p_channels) = 0 or s.channel = any(p_channels))
       and (p_client is null or s.client_ref = p_client)
       and (p_categories is null or cardinality(p_categories) = 0 or exists (
             select 1 from analytics.v_lines l where l.client_ref = s.client_ref and l.category = any(p_categories)
                and l.day > v_asof - 365 and l.day <= v_asof and l.kind = 'sale'))
  ),
  dropped as (   -- категории, которые клиент покупал 3–9 мес. назад и перестал за последние 90 дней
    select client_ref, jsonb_agg(category order by prev_rev desc) as cats, sum(prev_rev) / 6 as monthly
      from (select l.client_ref, l.category,
                   sum(l.amount) filter (where l.day > v_asof - 270 and l.day <= v_asof - 90) as prev_rev,
                   coalesce(sum(l.amount) filter (where l.day > v_asof - 90 and l.day <= v_asof), 0) as cur_rev
              from analytics.v_lines l
             where not l.internal and l.day > v_asof - 270 and l.day <= v_asof
               and l.client_ref in (select client_ref from cs where status in ('sleeping', 'declining'))
             group by 1, 2) z
     where prev_rev > 0 and cur_rev <= 0
     group by client_ref
  ),
  scored as (
    select cs.*, d.cats as dropped_categories,
           -- потенциальные потери в месяц (по фактической истории клиента)
           round(case
             when cs.status in ('lost', 'sleeping', 'one_time') then cs.baseline_monthly
             when cs.status = 'declining' then greatest(0, (cs.rev_prev90 - cs.rev_90) / 3)
             else 0 end) as loss_monthly,
           -- уже недополучено с ожидаемой даты заказа
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
            then 'Долг ' || to_char(round(s.debt), 'FM999G999G999') || ' ₸ — согласовать оплату. ' else '' end)
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
      ) order by priority desc, rev_12m desc), '[]')
      from ranked where status <> 'archive' and (rev_12m > 0 or status in ('lost', 'one_time') and days_since <= 365))
  ) into r;
  return r;
end $$;

-- ============================================================================
-- RPC: возможности роста — кросс-продажи по категориям + возврат выручки
-- ============================================================================
create or replace function public.sa_opportunities(
  p_asof date default null,
  p_managers uuid[] default null, p_channels text[] default null, p_categories text[] default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_asof date := coalesce(p_asof, (now() at time zone 'Asia/Almaty')::date); r jsonb;
begin
  perform analytics.require_staff();

  with l as (
    select * from analytics.v_lines
     where not internal and client_ref is not null and day > v_asof - 365 and day <= v_asof
  ),
  cl as (   -- активные за 180 дней клиенты, их менеджер (последний) и канал
    select client_ref, min(client_name) as name, min(channel) as channel,
           (array_agg(manager_ref order by day desc) filter (where manager_ref is not null))[1] as manager_ref,
           (array_agg(manager_name order by day desc) filter (where manager_ref is not null))[1] as manager_name,
           sum(amount) filter (where day > v_asof - 180) / 6 as monthly
      from l group by 1
    having sum(amount) filter (where day > v_asof - 180 and kind = 'sale') > 0
  ),
  cc as (   -- траты клиента по категориям: 180 дн. (проникновение) и 365 дн. (покупал ли вообще)
    select client_ref, category,
           sum(amount) filter (where day > v_asof - 180) as rev180,
           sum(amount) as rev365
      from l group by 1, 2
  ),
  pen as (  -- проникновение категории в канале и медианные траты покупателей категории
    select c.channel, cc.category,
           count(*) filter (where cc.rev180 > 0)::numeric / nullif((select count(*) from cl c2 where c2.channel = c.channel), 0) as penetration,
           percentile_cont(0.5) within group (order by cc.rev180 / 6) filter (where cc.rev180 > 0) as median_monthly,
           count(*) filter (where cc.rev180 > 0) as buyers,
           (select count(*) from cl c2 where c2.channel = c.channel) as channel_clients
      from cc join cl c on c.client_ref = cc.client_ref
     group by 1, 2
  ),
  opp as (
    select c.client_ref, c.name, c.channel, c.manager_ref, c.manager_name, round(c.monthly) as client_monthly,
           p.category, round(100 * p.penetration) as penetration_pct, p.buyers, p.channel_clients,
           round(least(p.median_monthly, greatest(c.monthly, 0) * 0.5)) as potential_monthly
      from cl c
      join pen p on p.channel = c.channel
     where p.penetration >= 0.35 and p.channel_clients >= 5 and p.median_monthly > 0
       and not exists (select 1 from cc where cc.client_ref = c.client_ref and cc.category = p.category and cc.rev365 > 0)
       and (p_managers is null or cardinality(p_managers) = 0 or c.manager_ref = any(p_managers))
       and (p_channels is null or cardinality(p_channels) = 0 or c.channel = any(p_channels))
       and (p_categories is null or cardinality(p_categories) = 0 or p.category = any(p_categories))
  )
  select jsonb_build_object(
    'asof', v_asof,
    'method', 'Категория считается подходящей клиенту, если её покупают ≥35% активных клиентов того же канала (не менее 5 клиентов в канале), а клиент не покупал её 12 мес. Потенциал = медианные траты покупателей категории в канале в месяц, но не больше 50% текущего месячного оборота клиента.',
    'cross_sell', (select coalesce(jsonb_agg(to_jsonb(o) order by potential_monthly desc), '[]')
                     from (select * from opp order by potential_monthly desc limit 300) o),
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'clients', n, 'potential_monthly', pot) order by pot desc), '[]')
                      from (select category, count(*) n, round(sum(potential_monthly)) pot from opp group by 1) z),
    'penetration', (select coalesce(jsonb_agg(jsonb_build_object('channel', channel, 'category', category,
                        'penetration_pct', round(100 * penetration), 'buyers', buyers, 'channel_clients', channel_clients)
                        order by channel, penetration desc), '[]')
                      from pen where channel_clients >= 5)
  ) into r;
  return r;
end $$;

-- ============================================================================
-- Прогноз: дневной темп последних 91 дня × сезонные индексы прошлых лет.
-- Возвращает только прогноз; факт не изменяется.
-- ============================================================================
create or replace function analytics.forecast_amount(
  p_asof date, p_days int, p_managers uuid[], p_channels text[], p_categories text[], p_client uuid)
returns jsonb language sql stable as $$
with d as (
  select day, sum(amount) as amt
    from analytics.lines_f(p_managers, p_channels, p_categories, p_client)
   where day <= p_asof group by 1
), m as (   -- полные календарные месяцы истории до даты прогноза
  select date_trunc('month', day)::date as mon, sum(amt) as amt from d
   where day < date_trunc('month', p_asof) group by 1
), yr as (  -- годы, по которым есть все 12 месяцев
  select extract(year from mon)::int as y, avg(amt) as avg_m from m group by 1 having count(*) = 12
), si as (  -- сезонный индекс месяца года = выручка месяца / среднемесячная выручка этого года
  select extract(month from m.mon)::int as mo, avg(m.amt / nullif(yr.avg_m, 0)) as idx, count(*) as years
    from m join yr on yr.y = extract(year from m.mon)::int group by 1
), base as (
  select coalesce(sum(amt), 0) / 91.0 as rate,
         avg(coalesce(si.idx, 1)) as base_idx   -- средний индекс дней базового окна
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
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_asof date := coalesce(p_asof, (now() at time zone 'Asia/Almaty')::date - 1);
  v_bt jsonb := '[]'::jsonb; v_cut date; v_fc numeric; v_fact numeric; i int;
begin
  perform analytics.require_staff();

  -- Проверка на истории: прогноз на 30 дней с конца каждого из 6 последних месяцев против факта
  for i in 1..6 loop
    v_cut := (date_trunc('month', v_asof) - make_interval(months => i) - interval '1 day')::date;
    exit when v_cut + 30 > v_asof;
    v_fc := (analytics.forecast_amount(v_cut, 30, p_managers, p_channels, p_categories, p_client) ->> 'total')::numeric;
    select coalesce(sum(amount), 0) into v_fact
      from analytics.lines_f(p_managers, p_channels, p_categories, p_client)
     where day > v_cut and day <= v_cut + 30;
    v_bt := v_bt || jsonb_build_object('asof', v_cut, 'forecast', round(v_fc), 'fact', round(v_fact),
              'error_pct', case when v_fact <> 0 then round(100 * (v_fc - v_fact) / v_fact, 1) end);
  end loop;

  return jsonb_build_object(
    'asof', v_asof,
    'method', 'Дневной темп выручки за последние 91 день, скорректированный сезонными индексами месяцев (по полным годам истории). Это оценка, не факт.',
    'h30', analytics.forecast_amount(v_asof, 30, p_managers, p_channels, p_categories, p_client),
    'h60', analytics.forecast_amount(v_asof, 60, p_managers, p_channels, p_categories, p_client),
    'h90', analytics.forecast_amount(v_asof, 90, p_managers, p_channels, p_categories, p_client),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('month', mon, 'revenue', round(a)) order by mon), '[]')
                  from (select date_trunc('month', day)::date mon, sum(amount) a
                          from analytics.lines_f(p_managers, p_channels, p_categories, p_client)
                         where day > (date_trunc('month', v_asof) - interval '24 months')::date and day <= v_asof group by 1) z),
    'backtest', v_bt,
    'mape', (select round(avg(abs((e ->> 'error_pct')::numeric)), 1) from jsonb_array_elements(v_bt) e where e ->> 'error_pct' is not null)
  );
end $$;

-- ============================================================================
-- План-факт по месяцу: компания и менеджеры
-- ============================================================================
create or replace function public.sa_plan_fact(p_month date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Almaty')::date;
  v_m date := date_trunc('month', coalesce(p_month, v_today))::date;
  v_end date := (v_m + interval '1 month - 1 day')::date;
  v_days int := extract(day from v_end)::int;
  v_el int; r jsonb;
begin
  perform analytics.require_staff();
  v_el := case when v_today > v_end then v_days when v_today < v_m then 0 else (v_today - v_m + 1) end;

  with f as (
    select manager_ref, min(manager_name) as manager_name,
           sum(amount) filter (where day between v_m and v_end) as fact,
           -- прошлый месяц за тот же срок (сравнимый период)
           sum(amount) filter (where day between (v_m - interval '1 month')::date
                                and least((v_m - interval '1 month' + make_interval(days => greatest(v_el, 1) - 1))::date, (v_m - interval '1 day')::date)) as prev_same
      from analytics.v_lines
     where not internal and day between (v_m - interval '1 month')::date and v_end
     group by 1
  ),
  p as (select manager_ref, amount from analytics.sales_plan where month = v_m),
  rws as (
    select coalesce(f.manager_ref, p.manager_ref) as manager_ref,
           coalesce(f.manager_name, e.name, '(не указан)') as manager_name,
           coalesce(f.fact, 0) as fact, coalesce(f.prev_same, 0) as prev_same, p.amount as plan
      from f full join p on p.manager_ref = f.manager_ref
      left join analytics.employees e on e.ref = coalesce(f.manager_ref, p.manager_ref)
     where coalesce(f.manager_ref, p.manager_ref) is not null
  )
  select jsonb_build_object(
    'month', v_m, 'days_in_month', v_days, 'days_elapsed', v_el,
    'company', (select jsonb_build_object(
        'plan', (select amount from analytics.sales_plan where month = v_m and manager_ref is null),
        'plan_managers_sum', (select sum(plan) from rws),
        'fact', round(sum(fact)), 'prev_same', round(sum(prev_same)),
        'run_rate', case when v_el > 0 then round(sum(fact) / v_el * v_days) end) from rws),
    'managers', (select coalesce(jsonb_agg(jsonb_build_object(
        'ref', manager_ref, 'name', manager_name, 'plan', plan, 'fact', round(fact), 'prev_same', round(prev_same),
        'pct', case when plan > 0 then round(100 * fact / plan, 1) end,
        'expected_to_date', case when plan > 0 then round(plan * v_el / v_days) end,
        'deviation', case when plan > 0 then round(fact - plan * v_el / v_days) end,
        'run_rate', case when v_el > 0 then round(fact / v_el * v_days) end
      ) order by fact desc), '[]') from rws where fact <> 0 or plan is not null)
  ) into r;
  return r;
end $$;

create or replace function public.sa_plan_set(p_month date, p_manager uuid, p_amount numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.get_role_for_uid(auth.uid()), '') <> 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_amount is null or p_amount < 0 then raise exception 'План должен быть числом ≥ 0'; end if;
  insert into analytics.sales_plan(month, manager_ref, amount, updated_by, updated_at)
  values (date_trunc('month', p_month)::date, p_manager, p_amount, auth.uid(), now())
  on conflict (month, coalesce(manager_ref, '00000000-0000-0000-0000-000000000000'::uuid))
  do update set amount = excluded.amount, updated_by = excluded.updated_by, updated_at = now();
end $$;

-- ============================================================================
-- Карточка клиента и журнал синхронизации
-- ============================================================================
create or replace function public.sa_client_detail(p_client uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'Asia/Almaty')::date; r jsonb;
begin
  perform analytics.require_staff();
  select jsonb_build_object(
    'client', (select jsonb_build_object('ref', ref, 'name', name, 'full_name', full_name, 'phone', phone, 'bin', bin, 'channel', channel)
                 from analytics.v_clients where ref = p_client),
    'debt', (select jsonb_build_object('debt', round(debt), 'advance', round(advance), 'at', synced_at) from analytics.debts where counterparty_ref = p_client),
    'months', (select coalesce(jsonb_agg(jsonb_build_object('month', mon, 'revenue', round(a), 'orders', o) order by mon), '[]')
                 from (select date_trunc('month', day)::date mon, sum(amount) a,
                              count(distinct doc) filter (where kind = 'sale' and amount > 0) o
                         from analytics.v_lines where client_ref = p_client and day > v_today - 730 group by 1) z),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('category', category, 'rev_90', round(r90), 'rev_prev90', round(rp90), 'rev_12m', round(r12)) order by r12 desc), '[]')
                 from (select category,
                              coalesce(sum(amount) filter (where day > v_today - 90), 0) r90,
                              coalesce(sum(amount) filter (where day > v_today - 180 and day <= v_today - 90), 0) rp90,
                              sum(amount) r12
                         from analytics.v_lines where client_ref = p_client and day > v_today - 365 group by 1) z),
    'orders', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'amount', round(a), 'lines', n, 'manager', mgr) order by day desc), '[]')
                 from (select doc, min(day) as day, sum(amount) as a, count(*) n, min(manager_name) mgr
                         from analytics.v_lines where client_ref = p_client and kind = 'sale'
                        group by doc having sum(amount) > 0 order by min(day) desc limit 12) z)
  ) into r;
  return r;
end $$;

create or replace function public.sa_sync_log()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform analytics.require_staff();
  return jsonb_build_object(
    'runs', (select coalesce(jsonb_agg(to_jsonb(r) order by r.id desc), '[]')
               from (select id, started_at, finished_at, status, mode, error,
                            stats -> 'dims' as dims, stats -> 'months' as months, stats -> 'skipped' as skipped, stats -> 'ms' as ms
                       from analytics.sync_runs order by id desc limit 40) r),
    'months', (select coalesce(jsonb_agg(to_jsonb(m) order by m.month desc), '[]')
                 from (select month, synced_at, rows, round(amount) amount, round(onec_amount) onec_amount,
                              round(amount - onec_amount) diff, closed, status, error
                         from analytics.sync_months where synced_at is not null or status = 'error') m)
  );
end $$;
