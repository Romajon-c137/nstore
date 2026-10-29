-- Migration: landed_cost_shipments payment terms
-- Apply this in Supabase Dashboard → SQL Editor
--
-- Добавляет к партии (public.landed_cost_shipments) отсрочку платежа от
-- завода и плановый срок продажи. Нужны для ROI на собственный капитал:
-- если партия оборачивается в срок отсрочки, товар финансирует поставщик,
-- и свои деньги почти не замораживаются. RLS не меняется.

ALTER TABLE public.landed_cost_shipments
  ADD COLUMN IF NOT EXISTS payment_terms_days numeric NOT NULL DEFAULT 0,  -- отсрочка от завода, дней
  ADD COLUMN IF NOT EXISTS sell_days          numeric NOT NULL DEFAULT 0;  -- план срока продажи, дней
