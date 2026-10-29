-- ============================================================
-- MIGRATION: wa_broadcasts
-- Лог рассылок WhatsApp (вкладка CRM → WhatsApp → Рассылка).
-- Строки создаёт/обновляет Edge Function supabase/functions/broadcast-whatsapp
-- (service_role), читает CRM-фронтенд (admin/manager) для истории рассылок.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.wa_broadcasts (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by        uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  segment           text,                          -- market_segment или NULL = все сегменты
  filter_days       integer,                       -- "не писали X дней" или NULL = все контакты
  message           text        NOT NULL,
  recipients_count  integer     NOT NULL DEFAULT 0,
  sent_count        integer     NOT NULL DEFAULT 0,
  failed_count      integer     NOT NULL DEFAULT 0,
  status            text        NOT NULL DEFAULT 'running',  -- running | done | failed
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_broadcasts_created_at
  ON public.wa_broadcasts (created_at DESC);

-- RLS
ALTER TABLE public.wa_broadcasts ENABLE ROW LEVEL SECURITY;

-- Edge Function пишет через service_role — полный доступ
DROP POLICY IF EXISTS "wa_broadcasts_service_role_all" ON public.wa_broadcasts;
CREATE POLICY "wa_broadcasts_service_role_all" ON public.wa_broadcasts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Фронтенд CRM: историю рассылок видят только admin/manager
DROP POLICY IF EXISTS "wa_broadcasts_select_admin_manager" ON public.wa_broadcasts;
CREATE POLICY "wa_broadcasts_select_admin_manager" ON public.wa_broadcasts
  FOR SELECT
  USING (get_role_for_uid(auth.uid()) = ANY (ARRAY['admin', 'manager']));

-- ─────────────────────────────────────────────────────────────────────────────
-- Проверка после применения:
-- SELECT id, segment, filter_days, recipients_count, sent_count, failed_count,
--        status, created_at
-- FROM   public.wa_broadcasts
-- ORDER  BY created_at DESC
-- LIMIT  20;
-- ─────────────────────────────────────────────────────────────────────────────
