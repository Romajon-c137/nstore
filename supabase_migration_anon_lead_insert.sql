-- Migration: allow anonymous users to create B2B lead tasks from landing form
-- Apply in Supabase Dashboard → SQL Editor

-- The existing "anon_insert_orders" policy only allows task_type = 'order'.
-- The landing 'Стать партнёром' form submits as anon and needs task_type = 'lead'.

DROP POLICY IF EXISTS "anon_insert_leads" ON public.crm_tasks;

CREATE POLICY "anon_insert_leads" ON public.crm_tasks
  FOR INSERT TO anon
  WITH CHECK (task_type = 'lead' AND order_status = 'new' AND is_active = true);
