-- Migration: landed_cost_batches
-- Apply this in Supabase Dashboard → SQL Editor
--
-- Финансовый анализатор маржи по партиям товара («landed cost»,
-- себестоимость на складе) для вкладки crm/balance → вид «Партии»
-- (src/pages/crm/tabs/BatchesView.tsx).
--
-- По каждой партии храним ТОЛЬКО вводимые данные. Себестоимость на складе
-- (landed cost за единицу), НДС и маржа считаются на фронте — как и в PNL,
-- ничего не дублируется в БД.
--
-- НДС: компания — плательщик НДС РК (новая ставка 16%). Импортный НДС берётся
-- В ЗАЧЁТ, поэтому в себестоимость товара по умолчанию НЕ входит
-- (vat_in_cost = false). Флаг оставлен на партию на случай товаров/режимов,
-- где НДС в зачёт не идёт и должен садиться в себестоимость.
--
-- База НДС на импорт в РК ≈ таможенная стоимость + пошлина, поэтому
-- НДС считается от (стоимость товара в ₸ + таможенная пошлина).
-- Доступ — только admin (как finance_pnl), через RLS.

BEGIN;

CREATE TABLE IF NOT EXISTS public.landed_cost_batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company       text        NOT NULL DEFAULT 'JJCo',
  batch_date    date        NOT NULL DEFAULT CURRENT_DATE,
  product       text        NOT NULL DEFAULT '',        -- наименование / партия
  supplier      text        NOT NULL DEFAULT '',        -- поставщик
  currency      text        NOT NULL DEFAULT 'USD',     -- валюта закупа: USD/CNY/EUR/RUB/KZT
  fx_rate       numeric     NOT NULL DEFAULT 1,         -- курс валюты к тенге
  qty           numeric     NOT NULL DEFAULT 0,         -- количество, шт
  unit_price    numeric     NOT NULL DEFAULT 0,         -- цена за единицу в валюте закупа
  logistics     numeric     NOT NULL DEFAULT 0,         -- логистика на партию, ₸
  customs_duty  numeric     NOT NULL DEFAULT 0,         -- таможенная пошлина на партию, ₸
  vat_rate      numeric     NOT NULL DEFAULT 16,        -- ставка НДС, % (РК = 16)
  other_costs   numeric     NOT NULL DEFAULT 0,         -- прочие сборы на партию, ₸
  vat_in_cost   boolean     NOT NULL DEFAULT false,     -- включать НДС в себестоимость?
  sale_price    numeric     NOT NULL DEFAULT 0,         -- цена продажи за ед. (без НДС), ₸
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid        REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS landed_cost_batches_company_date_idx
  ON public.landed_cost_batches (company, batch_date DESC);

ALTER TABLE public.landed_cost_batches ENABLE ROW LEVEL SECURITY;

-- Admin-only, как finance_pnl. get_role_for_uid() уже используется в проекте.
DROP POLICY IF EXISTS "landed_cost_admin_select" ON public.landed_cost_batches;
CREATE POLICY "landed_cost_admin_select" ON public.landed_cost_batches
  FOR SELECT USING (get_role_for_uid(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "landed_cost_admin_insert" ON public.landed_cost_batches;
CREATE POLICY "landed_cost_admin_insert" ON public.landed_cost_batches
  FOR INSERT WITH CHECK (get_role_for_uid(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "landed_cost_admin_update" ON public.landed_cost_batches;
CREATE POLICY "landed_cost_admin_update" ON public.landed_cost_batches
  FOR UPDATE USING (get_role_for_uid(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "landed_cost_admin_delete" ON public.landed_cost_batches;
CREATE POLICY "landed_cost_admin_delete" ON public.landed_cost_batches
  FOR DELETE USING (get_role_for_uid(auth.uid()) = 'admin');

COMMIT;

-- Проверка после применения (ничего не меняет):
-- select policyname, cmd from pg_policies
-- where schemaname='public' and tablename='landed_cost_batches';
