-- Migration: product_feasibility
-- Apply this in Supabase Dashboard → SQL Editor
--
-- Фин-аналитика новых продуктов (crm/balance → вид «Продукты»,
-- src/pages/crm/tabs/ProductsView.tsx). Решение «брать или нет» ДО закупки
-- по КП производителя + прогнозу: landed cost, маржа, ROI, инвестиция в MOQ,
-- окупаемость, целевая закупочная цена, вердикт Go/No-Go.
--
-- cities (jsonb) — аналитика по городам: [{ "city": text, "volume": number,
-- "delivery": number }] — прогноз объёма и стоимость доставки до клиента по
-- каждому городу; из них считается маржа/ROI/прибыль по городам.
--
-- В БД только вводимые поля; экономика считается на фронте. Каналы продаж и
-- их издержки берутся из тех же пресетов, что и «Партии». Доступ — admin.

BEGIN;

CREATE TABLE IF NOT EXISTS public.product_feasibility (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company        text        NOT NULL DEFAULT 'JJCo',
  name           text        NOT NULL DEFAULT '',
  supplier       text        NOT NULL DEFAULT '',
  status         text        NOT NULL DEFAULT 'draft',   -- draft / approved / rejected
  currency       text        NOT NULL DEFAULT 'USD',
  fx_rate        numeric     NOT NULL DEFAULT 1,
  buy_price      numeric     NOT NULL DEFAULT 0,         -- цена завода за ед., в валюте
  moq            numeric     NOT NULL DEFAULT 0,         -- минимальный заказ, шт
  logistics_unit numeric     NOT NULL DEFAULT 0,         -- логистика на ед. (оценка), ₸
  customs_pct    numeric     NOT NULL DEFAULT 0,         -- пошлина, % от товара
  vat_rate       numeric     NOT NULL DEFAULT 16,
  one_time       numeric     NOT NULL DEFAULT 0,         -- разовые: сертификация/листинг/контент, ₸
  sale_price     numeric     NOT NULL DEFAULT 0,         -- цена продажи за ед. С НДС, ₸
  channel        text        NOT NULL DEFAULT '',
  monthly_volume numeric     NOT NULL DEFAULT 0,         -- прогноз продаж, шт/мес
  cities         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid        REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS product_feasibility_company_idx
  ON public.product_feasibility (company, updated_at DESC);

ALTER TABLE public.product_feasibility ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_feas_admin_select" ON public.product_feasibility;
CREATE POLICY "product_feas_admin_select" ON public.product_feasibility
  FOR SELECT USING (get_role_for_uid(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "product_feas_admin_insert" ON public.product_feasibility;
CREATE POLICY "product_feas_admin_insert" ON public.product_feasibility
  FOR INSERT WITH CHECK (get_role_for_uid(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "product_feas_admin_update" ON public.product_feasibility;
CREATE POLICY "product_feas_admin_update" ON public.product_feasibility
  FOR UPDATE USING (get_role_for_uid(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "product_feas_admin_delete" ON public.product_feasibility;
CREATE POLICY "product_feas_admin_delete" ON public.product_feasibility
  FOR DELETE USING (get_role_for_uid(auth.uid()) = 'admin');

COMMIT;
