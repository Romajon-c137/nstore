-- ============================================================
-- MIGRATION: kaspi_payment_log
-- Аудит-лог входящих pay-запросов к supabase/functions/kaspi-payment
-- (в т.ч. заблокированных проверкой IP/shared secret — allowed = false)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.kaspi_payment_log (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ip         text,                          -- IP клиента (x-forwarded-for)
  txn_id     text,                          -- ID транзакции от Kaspi
  account    text,                          -- order_number из запроса
  sum        numeric(12, 2),
  allowed    boolean     NOT NULL,          -- прошла ли проверка IP/secret
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kaspi_payment_log_created_at
  ON public.kaspi_payment_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_kaspi_payment_log_allowed
  ON public.kaspi_payment_log (allowed)
  WHERE allowed = false;

-- RLS: пишет только service_role (Edge Function), публичного доступа нет
ALTER TABLE public.kaspi_payment_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all" ON public.kaspi_payment_log;
CREATE POLICY "service_role_all" ON public.kaspi_payment_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Проверка
-- SELECT ip, txn_id, account, sum, allowed, created_at
-- FROM   public.kaspi_payment_log
-- ORDER  BY created_at DESC
-- LIMIT  20;
-- ─────────────────────────────────────────────────────────────────────────────
