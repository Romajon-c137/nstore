-- Migration: fix_orders_rls_and_crm_tasks_note
-- Apply this in Supabase Dashboard → SQL Editor

-- 1. Add note column to crm_tasks (stores manager note on order)
ALTER TABLE public.crm_tasks
  ADD COLUMN IF NOT EXISTS note text;

-- 2. Drop old anon insert policy if any
DROP POLICY IF EXISTS "anon_insert_orders" ON public.crm_tasks;
DROP POLICY IF EXISTS "anon can insert orders" ON public.crm_tasks;

-- 3. Allow anonymous users to insert orders (task_type = 'order')
--    The storefront is public — buyers are not logged in
CREATE POLICY "anon_insert_orders" ON public.crm_tasks
  FOR INSERT TO anon
  WITH CHECK (task_type = 'order');

-- 4. Allow anon to read crm_projects and crm_columns
--    (needed to resolve the column_id for new orders)
--    Skip if already exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'crm_projects' AND policyname = 'anon_read_projects'
  ) THEN
    CREATE POLICY "anon_read_projects" ON public.crm_projects
      FOR SELECT TO anon USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'crm_columns' AND policyname = 'anon_read_columns'
  ) THEN
    CREATE POLICY "anon_read_columns" ON public.crm_columns
      FOR SELECT TO anon USING (true);
  END IF;
END $$;
