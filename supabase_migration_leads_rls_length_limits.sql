-- Migration: leads_rls_length_limits
-- Apply this in Supabase Dashboard → SQL Editor
--
-- Ужесточает anon_insert_leads (создана в supabase_migration_leads_rls.sql):
-- HTML maxLength на инпутах формы "Стать партнёром" (LandingPage.tsx) — это
-- только UX-подсказка, её обходит любой прямой запрос к Supabase REST API
-- в обход фронтенда. Реальное принуждение — только здесь, на уровне RLS.
-- Заодно требует непустые name/phone (сейчас это только проверка на фронте).

DROP POLICY IF EXISTS "anon_insert_leads" ON public.contacts;

CREATE POLICY "anon_insert_leads" ON public.contacts
  FOR INSERT TO anon
  WITH CHECK (
    relation_status = 'potential'
    AND company_id IS NULL
    AND char_length(coalesce(name, '')) BETWEEN 1 AND 200
    AND char_length(coalesce(phone, '')) BETWEEN 1 AND 30
    AND (email IS NULL OR char_length(email) <= 200)
    AND (notes IS NULL OR char_length(notes) <= 2000)
  );
