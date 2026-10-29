-- Audit: rls_policies (READ-ONLY — ничего не меняет, только SELECT)
-- Запустить в Supabase Dashboard → SQL Editor и прислать оба результата обратно.

-- 1. Включён ли RLS на ключевых таблицах вообще
select schemaname, tablename, rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public'
  and tablename in ('crm_tasks', 'profiles', 'locations', 'products', 'contacts', 'companies')
order by tablename;

-- 2. Все текущие политики на этих таблицах
select
  schemaname, tablename, policyname,
  roles, cmd,
  qual as using_expr,
  with_check as with_check_expr
from pg_policies
where schemaname = 'public'
  and tablename in ('crm_tasks', 'profiles', 'locations', 'products', 'contacts', 'companies')
order by tablename, cmd, policyname;
