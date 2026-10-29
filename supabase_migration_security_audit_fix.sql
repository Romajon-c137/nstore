-- ============================================================
-- MIGRATION: security_audit_fix
-- Fixes: C-2 (role escalation), C-3 (company_id hijack),
--        H-2 (anon order injection), L-2 (dead anon policies)
-- ============================================================

-- C-2 + C-3: profiles UPDATE — добавляем WITH CHECK
DROP POLICY IF EXISTS profiles_update ON public.profiles;

CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE
  USING (
    (auth.uid() = id)
    OR (get_role_for_uid(auth.uid()) = ANY (ARRAY['admin'::text, 'manager'::text]))
  )
  WITH CHECK (
    CASE
      WHEN get_role_for_uid(auth.uid()) = ANY (ARRAY['admin'::text, 'manager'::text])
      THEN true
      ELSE (
        role = (SELECT role FROM public.profiles WHERE id = auth.uid())
        AND company_id IS NOT DISTINCT FROM (SELECT company_id FROM public.profiles WHERE id = auth.uid())
      )
    END
  );

-- H-2: anon_insert_orders — ужесточаем WITH CHECK
DROP POLICY IF EXISTS anon_insert_orders ON public.crm_tasks;

CREATE POLICY anon_insert_orders ON public.crm_tasks
  FOR INSERT
  TO anon
  WITH CHECK (
    task_type = 'order'
    AND is_paid = false
    AND order_status = 'new'
    AND is_active = true
    AND client_id IS NULL
    AND order_number IS NULL
    AND (char_length(COALESCE(client_name, '')) BETWEEN 1 AND 200)
    AND (char_length(COALESCE(client_phone, '')) BETWEEN 1 AND 30)
    AND (address IS NULL OR char_length(address) <= 500)
    AND (COALESCE(total, 0) >= 0)
  );

-- L-2: убираем дубликат UPDATE-политики на locations
DROP POLICY IF EXISTS "owner update locations" ON public.locations;

-- Проверка результата
SELECT schemaname, tablename, policyname, cmd, using_expr, with_check_expr
FROM pg_policies
WHERE tablename IN ('profiles', 'crm_tasks', 'locations')
ORDER BY tablename, cmd;
