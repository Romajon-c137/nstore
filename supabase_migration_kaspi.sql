-- ══════════════════════════════════════════════════════════════════════════════
-- Интеграция с Kaspi: поле is_paid + таблица kaspi_payments
-- Запустить вручную в Supabase SQL Editor (целиком, за один раз)
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Флаг оплаты в crm_tasks
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.crm_tasks
  ADD COLUMN IF NOT EXISTS is_paid boolean NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Таблица истории платежей Kaspi
--    prv_txn — наш внутренний ID платежа, возвращаем Kaspi в ответе на pay.
--              Генерируется автоматически как строковое представление id.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kaspi_payments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_id       text        NOT NULL,                          -- ID транзакции от Kaspi
  prv_txn      text        GENERATED ALWAYS AS (id::text) STORED,  -- наш внутренний ID
  order_id     uuid        NOT NULL REFERENCES public.crm_tasks(id) ON DELETE RESTRICT,
  order_number text        NOT NULL,
  sum          numeric(12, 2) NOT NULL,
  txn_date     text,                                          -- дата из Kaspi (YYYYMMDDHHMMSS)
  status       text        NOT NULL DEFAULT 'success',
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT kaspi_payments_txn_id_unique UNIQUE (txn_id)    -- идемпотентность: один txn_id = одна запись
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Индексы для быстрых проверок (требование Kaspi: ответ ≤ 15 сек)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_kaspi_payments_txn_id
  ON public.kaspi_payments (txn_id);

CREATE INDEX IF NOT EXISTS idx_kaspi_payments_order_id
  ON public.kaspi_payments (order_id);

-- order_number уже имеет UNIQUE-индекс из миграции order_number;
-- is_paid — добавляем для быстрой фильтрации
CREATE INDEX IF NOT EXISTS idx_crm_tasks_is_paid
  ON public.crm_tasks (is_paid)
  WHERE is_paid = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS: только сервисная роль пишет в kaspi_payments
--    (Edge Function использует service_role key — обходит RLS, дополнительных
--     политик не нужно, но включаем RLS для защиты через PostgREST)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.kaspi_payments ENABLE ROW LEVEL SECURITY;

-- Публичного SELECT нет намеренно — только через service_role
DROP POLICY IF EXISTS "service_role_all" ON public.kaspi_payments;
CREATE POLICY "service_role_all" ON public.kaspi_payments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Проверка
-- SELECT id, txn_id, prv_txn, order_number, sum, status, created_at
-- FROM   public.kaspi_payments
-- ORDER  BY created_at DESC
-- LIMIT  10;
-- ─────────────────────────────────────────────────────────────────────────────
