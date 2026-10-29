-- ============================================================================
-- Контрагенты CRM = контрагенты 1С (по ключу Ref_Key), контакты → контактные лица 1С.
--
-- Применено миграциями counterparties_onec_keys + counterparties_onec_rpc.
--
-- Ключи:
--   public.companies.onec_ref        — GUID контрагента 1С (auto-name | manual | relink), hidden — без пары в 1С
--   public.contacts.onec_counterparty_ref — контрагент 1С; onec_contact_ref — КонтактноеЛицо 1С после отправки
--   Триггер contacts_onec_link: контакт компании с ключом получает ключ; изменения → onec_pending.
--   Триггер companies_onec_propagate: компании привязали ключ → её контактам тоже.
--
-- Объединения в 1С (дубли сливают в одну карточку, старая удаляется/помечается):
--   sa_sync_dims: при полной выгрузке (≥90% известных) отсутствующие карточки → deleted.
--   analytics.relink_merged(): ссылки CRM на удалённые карточки переносятся на карточку
--   с тем же БИН (12 цифр), иначе с тем же нормализованным названием; не нашлось → analytics.onec_relink
--   (админ перепривязывает вручную в «Контрагенты 1С» → «Перепривязать»).
--
-- Правки CRM → 1С (edge chains-onec-sync, тот же cron):
--   ct_push_queue/ct_push_done   → POST /hs/nstore_delivery/contact      (КонтактPOST)
--   cpe_push_queue/cpe_push_done → POST /hs/nstore_delivery/counterparty (КонтрагентPOST)
--
-- RPC (staff): cp_list, cp_detail, cp_search, cp_contact_save, cp_contact_unlink, cp_edit
-- RPC (admin): cp_companies_unlinked, cp_company_link, cp_relink_list, cp_relink_resolve
-- ============================================================================

create table if not exists analytics.counterparty_edits (
  ref uuid primary key,
  name text, full_name text, phone text,
  pending boolean not null default true,
  error text,
  edited_by uuid,
  edited_at timestamptz not null default now(),
  pushed_at timestamptz
);
alter table analytics.counterparty_edits enable row level security;

-- ---------- Список контрагентов 1С ----------
create or replace function public.cp_list(p_q text default null, p_channel text default null, p_chain int default null,
                                          p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = '' set statement_timeout = '20s' as $$
declare v_q text := nullif(trim(coalesce(p_q, '')), ''); v_digits text; r jsonb;
begin
  perform analytics.require_staff();
  v_digits := nullif(regexp_replace(coalesce(v_q, ''), '\D', '', 'g'), '');
  with base as (
    select c.ref, coalesce(e.name, c.name) as name, c.full_name, c.bin, coalesce(e.phone, c.phone) as phone,
           vc.channel, m.chain_id, ch.name as chain, emp.name as manager,
           s.rev_12m, s.last_sale, s.status, d.debt, (e.ref is not null) as edit_pending
      from analytics.counterparties c
      join analytics.v_clients vc on vc.ref = c.ref
      left join analytics.chain_members m on m.client_ref = c.ref and not m.excluded
      left join analytics.chains ch on ch.id = m.chain_id
      left join analytics.employees emp on emp.ref = c.responsible_ref
      left join analytics.mv_client_stats s on s.client_ref = c.ref
      left join analytics.debts d on d.counterparty_ref = c.ref
      left join analytics.counterparty_edits e on e.ref = c.ref and e.pending
     where not c.deleted and not vc.internal
       and (p_channel is null or vc.channel = p_channel)
       and (p_chain is null or m.chain_id = p_chain)
       and (v_q is null or c.name ilike '%' || v_q || '%' or c.full_name ilike '%' || v_q || '%'
            or (v_digits is not null and length(v_digits) >= 4 and
                (regexp_replace(coalesce(c.bin, ''), '\D', '', 'g') like '%' || v_digits || '%'
                 or regexp_replace(coalesce(c.phone, '') || ' ' || c.name, '\D', '', 'g') like '%' || right(v_digits, 10) || '%')))
  ), page as (
    select * from base order by rev_12m desc nulls last, name limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'items', coalesce((select jsonb_agg(to_jsonb(p) || jsonb_build_object(
                 'contacts',  (select count(*) from public.contacts k where k.onec_counterparty_ref = p.ref),
                 'companies', (select count(*) from public.companies k where k.onec_ref = p.ref))
               order by p.rev_12m desc nulls last, p.name) from page p), '[]'::jsonb),
    'channels', coalesce((select jsonb_agg(distinct channel) from analytics.v_clients where not internal), '[]'::jsonb),
    'chains', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name) from analytics.chains), '[]'::jsonb),
    'is_admin', coalesce(public.get_role_for_uid(auth.uid()), '') = 'admin',
    'unlinked_companies', (select count(*) from public.companies where hidden),
    'relink', (select count(*) from analytics.onec_relink where new_ref is null and resolved_at is null)
  ) into r;
  return r;
end $$;

-- ---------- Карточка ----------
create or replace function public.cp_detail(p_ref uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform analytics.require_staff();
  select jsonb_build_object(
    'ref', c.ref, 'name', c.name, 'full_name', c.full_name, 'bin', c.bin, 'phone', c.phone,
    'deleted', c.deleted, 'inactive', c.inactive, 'created_at_1c', c.created_at_1c,
    'channel', vc.channel, 'chain', ch.name, 'manager', emp.name,
    'rev_12m', s.rev_12m, 'orders_12m', s.orders_12m, 'last_sale', s.last_sale, 'status', s.status,
    'debt', d.debt, 'advance', d.advance,
    'edit', (select to_jsonb(e) - 'edited_by' from analytics.counterparty_edits e where e.ref = c.ref and (e.pending or e.error is not null)),
    'contacts', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'phone', k.phone, 'email', k.email,
                  'role', k.role, 'onec_contact_ref', k.onec_contact_ref, 'onec_pending', k.onec_pending,
                  'onec_error', k.onec_error, 'company', co.name) order by k.name)
                from public.contacts k left join public.companies co on co.id = k.company_id
               where k.onec_counterparty_ref = c.ref), '[]'::jsonb),
    'companies', coalesce((select jsonb_agg(jsonb_build_object('id', co.id, 'name', co.name, 'linked_by', co.onec_linked_by) order by co.name)
                from public.companies co where co.onec_ref = c.ref), '[]'::jsonb)
  ) into r
  from analytics.counterparties c
  left join analytics.v_clients vc on vc.ref = c.ref
  left join analytics.chain_members m on m.client_ref = c.ref and not m.excluded
  left join analytics.chains ch on ch.id = m.chain_id
  left join analytics.employees emp on emp.ref = c.responsible_ref
  left join analytics.mv_client_stats s on s.client_ref = c.ref
  left join analytics.debts d on d.counterparty_ref = c.ref
  where c.ref = p_ref;
  return r;
end $$;

-- ---------- Поиск карточки 1С (для привязки) ----------
create or replace function public.cp_search(p_q text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_q text := nullif(trim(coalesce(p_q, '')), '');
begin
  perform analytics.require_staff();
  if v_q is null or length(v_q) < 2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x) from (
    select c.ref, c.name, c.bin, c.phone from analytics.counterparties c
     where not c.deleted and (c.name ilike '%' || v_q || '%' or c.full_name ilike '%' || v_q || '%'
           or regexp_replace(coalesce(c.bin, ''), '\D', '', 'g') = regexp_replace(v_q, '\D', '', 'g'))
     order by (analytics.norm_name(c.name) = analytics.norm_name(v_q)) desc, length(c.name) limit 20) x), '[]'::jsonb);
end $$;

-- ---------- Контакты контрагента ----------
create or replace function public.cp_contact_save(p_id uuid, p_ref uuid, p_name text, p_phone text, p_email text, p_role text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform analytics.require_staff();
  if coalesce(trim(p_name), '') = '' and coalesce(trim(p_phone), '') = '' then
    raise exception 'Укажите имя или телефон';
  end if;
  if p_id is null then
    insert into public.contacts(name, phone, email, role, onec_counterparty_ref, created_by)
    values (coalesce(nullif(trim(p_name), ''), trim(p_phone)), nullif(trim(p_phone), ''), nullif(trim(p_email), ''),
            nullif(trim(p_role), ''), p_ref, auth.uid())
    returning id into v_id;
  else
    update public.contacts set name = coalesce(nullif(trim(p_name), ''), name), phone = nullif(trim(p_phone), ''),
           email = nullif(trim(p_email), ''), role = nullif(trim(p_role), ''), onec_counterparty_ref = p_ref
     where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.cp_contact_unlink(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform analytics.require_staff();
  update public.contacts set onec_counterparty_ref = null, onec_pending = false, onec_error = null where id = p_id;
end $$;

-- ---------- Правка наименования / телефона (уходит в 1С) ----------
create or replace function public.cp_edit(p_ref uuid, p_name text, p_full_name text, p_phone text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform analytics.require_staff();
  insert into analytics.counterparty_edits(ref, name, full_name, phone, pending, error, edited_by, edited_at)
  values (p_ref, nullif(trim(p_name), ''), nullif(trim(p_full_name), ''), nullif(trim(p_phone), ''), true, null, auth.uid(), now())
  on conflict (ref) do update set name = excluded.name, full_name = excluded.full_name, phone = excluded.phone,
    pending = true, error = null, edited_by = excluded.edited_by, edited_at = now();
end $$;

-- ---------- Админ: компании CRM без пары в 1С ----------
create or replace function public.cp_companies_unlinked(p_q text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform analytics.require_admin();
  return coalesce((select jsonb_agg(x order by x.refs desc, x.name) from (
    select co.id, co.name, co.legal_name, co.phone, co.created_at,
           (select count(*) from public.contacts k where k.company_id = co.id) as contacts,
           (select count(*) from public.contacts k where k.company_id = co.id)
           + (select count(*) from public.profiles p where p.company_id = co.id)
           + (select count(*) from public.locations l where l.company_id = co.id)
           + (select count(*) from public.contract_documents d where d.company_id = co.id) as refs
      from public.companies co
     where co.hidden and (p_q is null or co.name ilike '%' || p_q || '%')
     limit 300) x), '[]'::jsonb);
end $$;

create or replace function public.cp_company_link(p_company uuid, p_ref uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform analytics.require_admin();
  update public.companies set onec_ref = p_ref, onec_linked_by = case when p_ref is null then null else 'manual' end,
         hidden = (p_ref is null) where id = p_company;
end $$;

-- ---------- Админ: карточки, объединённые в 1С без однозначной пары ----------
create or replace function public.cp_relink_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform analytics.require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('old_ref', r.old_ref, 'old_name', r.old_name, 'created_at', r.created_at,
      'companies', (select count(*) from public.companies where onec_ref = r.old_ref),
      'contacts', (select count(*) from public.contacts where onec_counterparty_ref = r.old_ref),
      'chain', (select ch.name from analytics.chain_members m join analytics.chains ch on ch.id = m.chain_id where m.client_ref = r.old_ref))
      order by r.created_at desc)
    from analytics.onec_relink r where r.new_ref is null and r.resolved_at is null), '[]'::jsonb);
end $$;

create or replace function public.cp_relink_resolve(p_old uuid, p_new uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform analytics.require_admin();
  if p_new is null then
    update analytics.onec_relink set resolved_at = now(), method = 'dismissed' where old_ref = p_old;
  else
    perform analytics.move_onec_refs(p_old, p_new, 'manual');
  end if;
end $$;

-- ---------- Очереди для edge (service) ----------
create or replace function public.ct_push_queue(p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform delivery.require_service();
  return coalesce((select jsonb_agg(x) from (
    select k.id, k.onec_counterparty_ref as counterparty_ref, k.onec_contact_ref as contact_ref,
           k.name, k.phone, k.email, k.role
      from public.contacts k join analytics.counterparties c on c.ref = k.onec_counterparty_ref and not c.deleted
     where k.onec_pending and k.onec_counterparty_ref is not null
     order by k.created_at limit p_limit) x), '[]'::jsonb);
end $$;

create or replace function public.ct_push_done(p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform delivery.require_service();
  update public.contacts k set
    onec_contact_ref = coalesce(nullif(r->>'contact_ref', '')::uuid, k.onec_contact_ref),
    onec_pending = false,  -- ошибка видна в карточке; повтор — после правки контакта
    onec_error = case when coalesce((r->>'ok')::boolean, false) then null else left(r->>'error', 500) end,
    onec_pushed_at = now()
  from jsonb_array_elements(p_rows) r where k.id = (r->>'id')::uuid;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.cpe_push_queue(p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform delivery.require_service();
  return coalesce((select jsonb_agg(jsonb_build_object('ref', ref, 'name', name, 'full_name', full_name, 'phone', phone))
    from (select * from analytics.counterparty_edits where pending order by edited_at limit p_limit) e), '[]'::jsonb);
end $$;

create or replace function public.cpe_push_done(p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform delivery.require_service();
  update analytics.counterparties c set name = coalesce(e.name, c.name), full_name = coalesce(e.full_name, c.full_name),
         phone = coalesce(e.phone, c.phone)
    from jsonb_array_elements(p_rows) r join analytics.counterparty_edits e on e.ref = (r->>'ref')::uuid
   where c.ref = e.ref and coalesce((r->>'ok')::boolean, false);
  update analytics.counterparty_edits e set pending = false, pushed_at = now(),
         error = case when coalesce((r->>'ok')::boolean, false) then null else left(r->>'error', 500) end
    from jsonb_array_elements(p_rows) r where e.ref = (r->>'ref')::uuid;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- Права (доступ проверяют require_staff / require_admin / require_service внутри) ----------
do $$ declare f text; begin
  foreach f in array array['cp_list(text,text,integer,integer,integer)', 'cp_detail(uuid)', 'cp_search(text)',
    'cp_contact_save(uuid,uuid,text,text,text,text)', 'cp_contact_unlink(uuid)', 'cp_edit(uuid,text,text,text)',
    'cp_companies_unlinked(text)', 'cp_company_link(uuid,uuid)', 'cp_relink_list()', 'cp_relink_resolve(uuid,uuid)'] loop
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['ct_push_queue(integer)', 'ct_push_done(jsonb)', 'cpe_push_queue(integer)', 'cpe_push_done(jsonb)'] loop
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
