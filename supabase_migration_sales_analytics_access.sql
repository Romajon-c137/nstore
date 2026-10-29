-- Аналитика продаж: доступ к вкладке, ручной запуск и расписание синхронизации.

-- Ручной запуск синхронизации из дашборда (только admin)
create or replace function public.sa_sync_now()
returns bigint language plpgsql volatile security definer set search_path = '' as $$
begin
  if coalesce(public.get_role_for_uid(auth.uid()), '') <> 'admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return analytics.sync_trigger(jsonb_build_object('stale', 2));
end $$;

-- Доступ к вкладке: admin — полный; остальным по умолчанию закрыто (меняется во вкладке «Роли»).
-- RPC sa_* дополнительно пускают только admin/manager.
insert into public.role_permissions(role, module, access_level)
values ('admin', 'sales', 'full'), ('manager', 'sales', 'none'), ('logist', 'sales', 'none'), ('client', 'sales', 'none')
on conflict (role, module) do nothing;

-- Расписание: каждые 30 минут (смещено относительно onec-sync */15)
select cron.schedule('onec-sales-sync', '7,37 * * * *', $$select analytics.sync_trigger('{}'::jsonb)$$);
