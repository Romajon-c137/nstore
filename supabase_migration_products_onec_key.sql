-- ============================================================================
-- Ключ товаров nStore ↔ 1С (2026-10-19)
-- Товар сайта связан с номенклатурой 1С по GUID (public.products.onec_ref).
-- Миграции: products_onec_key, order_items_onec_ref, products_name_normalize.
-- ============================================================================

-- Индексы под сопоставление и запрет дублей ключа
create index if not exists products_onec_ref_lower_idx on public.products (lower(onec_ref));
create index if not exists products_sku_idx on public.products (sku);
create unique index if not exists products_onec_ref_uniq on public.products (lower(onec_ref)) where onec_ref is not null;

-- Синхронизация сайта с 1С (onec_sync_apply, service_role) упиралась в общий лимит 8 с
alter role service_role set statement_timeout = '60s';
notify pgrst, 'reload config';

-- Строки заказа (crm_tasks.items) несут onec_ref — для выгрузки заказов в 1С без поиска по артикулу
create or replace function public.crm_items_add_onec_ref(p_items jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(
           case when jsonb_typeof(i) = 'object' and i ? 'id' then
             i || jsonb_build_object('onec_ref', coalesce(nullif(i->>'onec_ref', ''),
                    (select lower(p.onec_ref) from public.products p where p.id::text = i->>'id')))
           else i end order by n), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as t(i, n);
$$;

create or replace function public.crm_tasks_items_onec_ref()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.items is not null and jsonb_typeof(new.items) = 'array' and jsonb_array_length(new.items) > 0
     and (tg_op = 'INSERT' or new.items is distinct from old.items) then
    new.items := public.crm_items_add_onec_ref(new.items);
  end if;
  return new;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'crm_tasks_items_onec_ref' and tgrelid = 'public.crm_tasks'::regclass) then
    create trigger crm_tasks_items_onec_ref before insert or update of items on public.crm_tasks
    for each row execute function public.crm_tasks_items_onec_ref();
  end if;
end $$;

-- Названия: в 1С у ~270 карточек табуляции и двойные пробелы. На сайте и в аналитике
-- храним то же название без лишних пробелов — тогда они совпадают один в один.
create or replace function analytics.products_trim_name()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.name := nullif(trim(regexp_replace(new.name, '\s+', ' ', 'g')), '');
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'products_trim_name' and tgrelid = 'analytics.products'::regclass) then
    create trigger products_trim_name before insert or update of name on analytics.products
    for each row execute function analytics.products_trim_name();
  end if;
end $$;

create or replace function public.products_normalize_name()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.name := coalesce(nullif(trim(regexp_replace(new.name, '\s+', ' ', 'g')), ''), new.name);
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'products_normalize_name' and tgrelid = 'public.products'::regclass) then
    create trigger products_normalize_name before insert or update of name on public.products
    for each row execute function public.products_normalize_name();
  end if;
end $$;

-- Существующие данные
update public.crm_tasks set items = public.crm_items_add_onec_ref(items)
 where jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0;
update analytics.products set name = name
 where name is distinct from nullif(trim(regexp_replace(name, '\s+', ' ', 'g')), '');
update public.products set name = name where name ~ '\s\s|^\s|\s$|\t';
