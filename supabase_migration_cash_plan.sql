-- Migration: cash_plan_entries
-- Apply this in Supabase Dashboard → SQL Editor
--
-- Платёжный календарь (crm/balance → вид «Платежи»,
-- src/pages/crm/tabs/CashPlanView.tsx). Ручные плановые платежи и
-- поступления (аренда, ФОТ, налоги, кредит, прочее) с датами; разовые и
-- ежемесячно повторяющиеся (recurring_day). Платежи поставщикам
-- подтягиваются из «Партий» автоматически (дата партии + отсрочка) и в этой
-- таблице не хранятся. Стартовый остаток денег хранится на клиенте.
--
-- Из ленты платежей строится накопительный остаток по неделям и
-- подсвечиваются кассовые разрывы. Доступ — admin.

BEGIN;

CREATE TABLE IF NOT EXISTS public.cash_plan_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company       text        NOT NULL DEFAULT 'JJCo',
  due_date      date        NOT NULL DEFAULT CURRENT_DATE,
  direction     text        NOT NULL DEFAULT 'out',          -- 'in' / 'out'
  category      text        NOT NULL DEFAULT 'Прочее',
  name          text        NOT NULL DEFAULT '',
  amount        numeric     NOT NULL DEFAULT 0,
  recurring_day integer     NOT NULL DEFAULT 0,              -- 0 разовый; 1..31 ежемесячно
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid        REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS cash_plan_entries_company_idx
  ON public.cash_plan_entries (company, due_date);

ALTER TABLE public.cash_plan_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cash_plan_admin_select" ON public.cash_plan_entries;
CREATE POLICY "cash_plan_admin_select" ON public.cash_plan_entries
  FOR SELECT USING (get_role_for_uid(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "cash_plan_admin_insert" ON public.cash_plan_entries;
CREATE POLICY "cash_plan_admin_insert" ON public.cash_plan_entries
  FOR INSERT WITH CHECK (get_role_for_uid(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "cash_plan_admin_update" ON public.cash_plan_entries;
CREATE POLICY "cash_plan_admin_update" ON public.cash_plan_entries
  FOR UPDATE USING (get_role_for_uid(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "cash_plan_admin_delete" ON public.cash_plan_entries;
CREATE POLICY "cash_plan_admin_delete" ON public.cash_plan_entries
  FOR DELETE USING (get_role_for_uid(auth.uid()) = 'admin');

COMMIT;

-- Дополнение: дата окончания повтора (закрытие кредита/договора).
ALTER TABLE public.cash_plan_entries
  ADD COLUMN IF NOT EXISTS recurring_until date;   -- NULL = бессрочно
