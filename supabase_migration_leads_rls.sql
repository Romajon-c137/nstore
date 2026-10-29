-- Migration: leads_rls
-- Apply this in Supabase Dashboard → SQL Editor

DROP POLICY IF EXISTS "anon_insert_leads" ON public.contacts;

-- Разрешить анонимным посетителям лендинга оставлять заявку "Стать партнёром"
-- (форма на / -> блок form -> INSERT в public.contacts, см. src/pages/LandingPage.tsx)
-- Ограничено: relation_status обязан быть 'potential', company_id обязан быть NULL —
-- анонимный посетитель не может создать "одобренного" клиента или привязать себя к чужой компании.
CREATE POLICY "anon_insert_leads" ON public.contacts
  FOR INSERT TO anon
  WITH CHECK (relation_status = 'potential' AND company_id IS NULL);
