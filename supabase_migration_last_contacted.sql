-- Migration: "Давно не писали" — last_contacted_at на contacts
-- Run in Supabase Dashboard → SQL Editor

BEGIN;

-- 1. Колонка last_contacted_at на contacts
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS last_contacted_at timestamptz;

-- 2. Триггерная функция: при INSERT/UPDATE в crm_tasks с task_type IN ('order','lead')
--    обновляем last_contacted_at контакта с совпадающим телефоном.
CREATE OR REPLACE FUNCTION public.crm_task_touch_contact()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.task_type IN ('order', 'lead') AND NEW.client_phone IS NOT NULL THEN
    UPDATE public.contacts
    SET last_contacted_at = now()
    WHERE phone = NEW.client_phone;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_task_touch_contact ON public.crm_tasks;
CREATE TRIGGER crm_task_touch_contact
  AFTER INSERT OR UPDATE ON public.crm_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.crm_task_touch_contact();

-- 3. Единовременный пересчёт: проставляем last_contacted_at из истории задач
UPDATE public.contacts
SET last_contacted_at = (
  SELECT MAX(created_at) FROM public.crm_tasks
  WHERE client_phone = contacts.phone
    AND task_type IN ('order', 'lead')
)
WHERE phone IS NOT NULL;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Проверка после применения:
-- SELECT name, phone, last_contacted_at FROM public.contacts ORDER BY last_contacted_at NULLS FIRST LIMIT 20;
-- ─────────────────────────────────────────────────────────────────────────────
