-- Migration: add 'lead' to crm_tasks task_type + RLS for anon form submissions
-- Run in Supabase Dashboard → SQL Editor

-- 1. Extend check constraint to allow task_type = 'lead'
ALTER TABLE public.crm_tasks
  DROP CONSTRAINT IF EXISTS crm_tasks_task_type_check;

ALTER TABLE public.crm_tasks
  ADD CONSTRAINT crm_tasks_task_type_check
  CHECK (task_type IN ('order', 'task', 'lead'));

-- 2. Allow anonymous users (landing form) to insert lead tasks
DROP POLICY IF EXISTS "anon_insert_leads" ON public.crm_tasks;

CREATE POLICY "anon_insert_leads" ON public.crm_tasks
  FOR INSERT TO anon
  WITH CHECK (task_type = 'lead' AND order_status = 'new' AND is_active = true);

-- 3. Clean up test record inserted during debugging
DELETE FROM public.crm_tasks WHERE client_name = '__rls_test__';
