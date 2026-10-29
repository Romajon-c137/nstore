-- Migration: rls_hardening
-- Apply this in Supabase Dashboard → SQL Editor
-- Найдено в ходе аудита RLS 05.07.2026 (crm_tasks / locations / profiles).

BEGIN;

-- ============================================================
-- 1. crm_tasks: crm_task_read — убрать "мёртвую" публичную дыру
-- ============================================================
-- column_id нигде не используется в текущем коде (grep по всему src — 0
-- совпадений). Это остаток старой Kanban-архитектуры (crm_columns/crm_projects,
-- заменённой на хардкод ORDER_COLS/TASK_COLS в BoardTab.tsx). Условие
-- `column_id = ANY(ARRAY[...])` не проверяет auth.uid() вообще — если у любой
-- строки crm_tasks когда-либо появится column_id, совпадающий с одним из двух
-- захардкоженных UUID, она станет читаема ВСЕМИ, включая анонимов, без всякой
-- проверки роли/владельца. Убираем как небезопасный мёртвый код.
DROP POLICY IF EXISTS "crm_task_read" ON public.crm_tasks;
CREATE POLICY "crm_task_read" ON public.crm_tasks
  FOR SELECT
  USING (
    get_role_for_uid(auth.uid()) = ANY (ARRAY['admin', 'manager', 'logist'])
    OR (auth.uid() IS NOT NULL AND (client_id = auth.uid() OR manager_id = auth.uid()))
  );

-- ============================================================
-- 2. crm_tasks: crm_task_write — запрет подмены client_id и создания
--    внутренних задач под видом клиента
-- ============================================================
-- Было: WITH CHECK (auth.uid() IS NOT NULL) — любой залогиненный клиент мог
-- вставить строку с ЛЮБЫМ client_id (например, чужим — подсунуть фейковый
-- заказ в чужую историю, т.к. "Мои заказы" в кабинете фильтрует по client_id)
-- и с любым task_type (в т.ч. 'task' — внутренние задачи, не для клиентов).
-- Реальный insert из кабинета (CabinetPage.tsx:192-199) всегда шлёт
-- task_type:'order', client_id: profile.id — фикс его не затрагивает.
DROP POLICY IF EXISTS "crm_task_write" ON public.crm_tasks;
CREATE POLICY "crm_task_write" ON public.crm_tasks
  FOR INSERT
  WITH CHECK (
    get_role_for_uid(auth.uid()) = ANY (ARRAY['admin', 'manager', 'logist'])
    OR (task_type = 'order' AND client_id = auth.uid())
  );

-- ============================================================
-- 3. locations: консолидация 6 пересекающихся политик в 4 чистых,
--    основанных на company_id вместо хрупкой цепочки owner_id/parent_id
-- ============================================================
-- Было: несколько SELECT-политик пытались через owner_id/parent_id покрыть
-- "команда видит точки компании", но цепочка parent_id работает только на
-- один уровень вглубь. Пример разрыва: клиент A создал точку (owner_id=A),
-- пригласил B (B.parent_id=A) — B видит точку. Но если B потом пригласил C
-- (C.parent_id=B, НЕ A) — C эту точку уже НЕ увидит, хотя CabinetPage.tsx
-- ожидает видимость по company_id для всей компании целиком.

CREATE OR REPLACE FUNCTION public.rls_my_company_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid()
$$;

DROP POLICY IF EXISTS "owner manages own locations" ON public.locations;
DROP POLICY IF EXISTS "owner delete locations" ON public.locations;
DROP POLICY IF EXISTS "owner insert locations" ON public.locations;
DROP POLICY IF EXISTS "locations_select" ON public.locations;
DROP POLICY IF EXISTS "owner sees own locations" ON public.locations;
DROP POLICY IF EXISTS "owner select locations" ON public.locations;
DROP POLICY IF EXISTS "locations_select_company" ON public.locations;
DROP POLICY IF EXISTS "locations_insert_owner" ON public.locations;
DROP POLICY IF EXISTS "locations_update_owner" ON public.locations;
DROP POLICY IF EXISTS "locations_delete_owner" ON public.locations;

CREATE POLICY "locations_select_company" ON public.locations
  FOR SELECT
  USING (
    get_role_for_uid(auth.uid()) = ANY (ARRAY['admin', 'manager', 'logist'])
    OR company_id = rls_my_company_id()
  );

CREATE POLICY "locations_insert_owner" ON public.locations
  FOR INSERT
  WITH CHECK (
    get_role_for_uid(auth.uid()) = ANY (ARRAY['admin', 'manager'])
    OR (auth.uid() = owner_id AND company_id = rls_my_company_id())
  );

CREATE POLICY "locations_update_owner" ON public.locations
  FOR UPDATE
  USING (
    get_role_for_uid(auth.uid()) = ANY (ARRAY['admin', 'manager'])
    OR auth.uid() = owner_id
  );

CREATE POLICY "locations_delete_owner" ON public.locations
  FOR DELETE
  USING (
    get_role_for_uid(auth.uid()) = 'admin'
    OR auth.uid() = owner_id
  );

-- ============================================================
-- 4. profiles: добавить видимость команды по company_id
-- ============================================================
-- Было: клиент видит только свой профиль + людей, кого лично пригласил
-- (parent_id = свой id). Та же проблема цепочки, что и в locations: если
-- сотрудник B пригласил сотрудника C, изначальный владелец компании A не
-- увидит C в списке "Пользователи" (CabinetPage.tsx ожидает company_id).
-- Существующую политику profiles_select НЕ трогаем (не хотим случайно
-- сузить то, что уже работало) — добавляем отдельную policy, она
-- объединяется с существующими через OR (несколько permissive-политик
-- на одну команду в Postgres RLS складываются через OR).
DROP POLICY IF EXISTS "profiles_select_company" ON public.profiles;
CREATE POLICY "profiles_select_company" ON public.profiles
  FOR SELECT
  USING (company_id = rls_my_company_id());

COMMIT;

-- Проверка после применения (SELECT, ничего не меняет):
-- select tablename, policyname, cmd, qual, with_check
-- from pg_policies
-- where schemaname='public' and tablename in ('crm_tasks','locations','profiles')
-- order by tablename, cmd;
