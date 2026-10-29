-- Migration: contract_documents — eGov подпись (Этап 2)
-- Apply this in Supabase Dashboard → SQL Editor
--
-- Хранение CMS-подписи, полученной через eGov Mobile (QR · SIGEX).
-- Остальные поля подписи (sign_provider / sign_ref / signed_by / signed_at)
-- уже заведены в supabase_migration_contract_documents.sql.

ALTER TABLE public.contract_documents
  ADD COLUMN IF NOT EXISTS sign_cms text;

-- Обновление договора в статус 'signed' выполняет Edge Function
-- `contract-egov-sign` под service role (клиент не имеет UPDATE по RLS),
-- после проверки, что договор принадлежит компании клиента.
