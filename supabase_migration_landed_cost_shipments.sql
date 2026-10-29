-- Migration: landed_cost_shipments
-- Apply this in Supabase Dashboard → SQL Editor
--
-- Партия = одна поставка целиком (crm/balance → вид «Партии»,
-- src/pages/crm/tabs/BatchesView.tsx). В одной партии — список товаров
-- (items, jsonb), а логистика / пошлина / НДS / прочее задаются один раз
-- на всю партию и распределяются по товарам при расчёте.
--
-- Себестоимость партии и маржа считаются на фронте — в БД только вводимые
-- поля. Компания — плательщик НДС РК (16%): импортный НДС берётся в зачёт и
-- по умолчанию НЕ входит в себестоимость (vat_in_cost = false).
--
-- items: [{ "product": text, "qty": number, "unit_price": number,
--           "sale_price": number }]  — цена закупа в валюте партии,
-- цена продажи в тенге (без НДС).
--
-- Доступ — только admin (как finance_pnl), через RLS + get_role_for_uid().

BEGIN;

CREATE TABLE IF NOT EXISTS public.landed_cost_shipments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company        text        NOT NULL DEFAULT 'JJCo',
  name           text        NOT NULL DEFAULT '',        -- название партии (№ счёта / поставщик)
  shipment_date  date        NOT NULL DEFAULT CURRENT_DATE,
  supplier       text        NOT NULL DEFAULT '',
  currency       text        NOT NULL DEFAULT 'USD',     -- валюта закупа: USD/CNY/EUR/RUB/KZT
  fx_rate        numeric     NOT NULL DEFAULT 1,         -- курс валюты к тенге
  logistics      numeric     NOT NULL DEFAULT 0,         -- логистика на партию, ₸
  customs_duty   numeric     NOT NULL DEFAULT 0,         -- таможенная пошлина на партию, ₸
  vat_rate       numeric     NOT NULL DEFAULT 16,        -- ставка НДС, % (РК = 16)
  other_costs    numeric     NOT NULL DEFAULT 0,         -- прочие сборы на партию, ₸
  vat_in_cost    boolean     NOT NULL DEFAULT false,     -- включать НДС в себестоимость?
  items          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid        REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS landed_cost_shipments_company_date_idx
  ON public.landed_cost_shipments (company, shipment_date DESC);

ALTER TABLE public.landed_cost_shipments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "landed_ship_admin_select" ON public.landed_cost_shipments;
CREATE POLICY "landed_ship_admin_select" ON public.landed_cost_shipments
  FOR SELECT USING (get_role_for_uid(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "landed_ship_admin_insert" ON public.landed_cost_shipments;
CREATE POLICY "landed_ship_admin_insert" ON public.landed_cost_shipments
  FOR INSERT WITH CHECK (get_role_for_uid(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "landed_ship_admin_update" ON public.landed_cost_shipments;
CREATE POLICY "landed_ship_admin_update" ON public.landed_cost_shipments
  FOR UPDATE USING (get_role_for_uid(auth.uid()) = 'admin');

DROP POLICY IF EXISTS "landed_ship_admin_delete" ON public.landed_cost_shipments;
CREATE POLICY "landed_ship_admin_delete" ON public.landed_cost_shipments
  FOR DELETE USING (get_role_for_uid(auth.uid()) = 'admin');

COMMIT;
