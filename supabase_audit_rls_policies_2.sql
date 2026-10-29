-- Audit: rls_policies_2 (READ-ONLY — ничего не меняет, только SELECT)
-- Запустить в Supabase Dashboard → SQL Editor и прислать оба результата обратно.

-- 1. Включён ли RLS на этих таблицах вообще
select schemaname, tablename, rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public'
  and tablename in ('companies', 'crm_task_events', 'wa_conversations', 'wa_messages', 'wa_otp')
order by tablename;

-- 2. Все текущие политики на этих таблицах
select
  schemaname, tablename, policyname,
  roles, cmd,
  qual as using_expr,
  with_check as with_check_expr
from pg_policies
where schemaname = 'public'
  and tablename in ('companies', 'crm_task_events', 'wa_conversations', 'wa_messages', 'wa_otp')
order by tablename, cmd, policyname;
