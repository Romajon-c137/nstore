-- Migration: contract_documents (Договоры)
-- Apply this in Supabase Dashboard → SQL Editor
--
-- Этап 1: структура + статусы + файл договора.
-- Подпись через eGov/mEgov (ЭЦП РК) — отдельным этапом; поля sign_* заложены
-- заранее, чтобы не пересоздавать таблицу.
--
-- Зависимости (созданы ранее в supabase_migration_rls_hardening.sql):
--   get_role_for_uid(uuid)  — роль пользователя
--   rls_my_company_id()     — company_id текущего пользователя

BEGIN;

CREATE TABLE IF NOT EXISTS public.contract_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  number        text NOT NULL,                 -- номер договора
  signed_date   date,                          -- дата заключения
  valid_until   date,                          -- срок действия (необязательно)
  amount        numeric(14,2),                 -- сумма договора (необязательно)
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'pending', 'signed', 'cancelled')),
  file_url      text,                          -- ссылка на файл договора (PDF)
  file_name     text,
  note          text,

  -- Задел под Этап 2 (eGov/mEgov · ЭЦП):
  signed_by     uuid REFERENCES public.profiles(id),
  signed_at     timestamptz,
  sign_provider text,                          -- 'egov' | 'megov' | ...
  sign_ref      text,                          -- референс подписи во внешней системе

  created_by    uuid REFERENCES public.profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_documents_company ON public.contract_documents (company_id);
CREATE INDEX IF NOT EXISTS idx_contract_documents_status  ON public.contract_documents (status);

-- updated_at автообновление
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_contract_documents_touch ON public.contract_documents;
CREATE TRIGGER trg_contract_documents_touch
  BEFORE UPDATE ON public.contract_documents
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.contract_documents ENABLE ROW LEVEL SECURITY;

-- Чтение: админ/менеджер/логист — все; клиент — только договоры своей компании.
DROP POLICY IF EXISTS "contract_documents_select" ON public.contract_documents;
CREATE POLICY "contract_documents_select" ON public.contract_documents
  FOR SELECT
  USING (
    get_role_for_uid(auth.uid()) = ANY (ARRAY['admin', 'manager', 'logist'])
    OR company_id = rls_my_company_id()
  );

-- Создание/изменение — только админ/менеджер (клиент пока read-only;
-- подпись клиентом будет добавлена отдельной policy на Этапе 2).
DROP POLICY IF EXISTS "contract_documents_insert" ON public.contract_documents;
CREATE POLICY "contract_documents_insert" ON public.contract_documents
  FOR INSERT
  WITH CHECK (
    get_role_for_uid(auth.uid()) = ANY (ARRAY['admin', 'manager'])
  );

DROP POLICY IF EXISTS "contract_documents_update" ON public.contract_documents;
CREATE POLICY "contract_documents_update" ON public.contract_documents
  FOR UPDATE
  USING (
    get_role_for_uid(auth.uid()) = ANY (ARRAY['admin', 'manager'])
  );

DROP POLICY IF EXISTS "contract_documents_delete" ON public.contract_documents;
CREATE POLICY "contract_documents_delete" ON public.contract_documents
  FOR DELETE
  USING (
    get_role_for_uid(auth.uid()) = 'admin'
  );

COMMIT;

-- Проверка после применения:
-- select tablename, policyname, cmd from pg_policies
-- where schemaname='public' and tablename='contract_documents' order by cmd;
