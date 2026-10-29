-- Migration: Database trigger for order status email notification
-- Apply in Supabase Dashboard → SQL Editor
--
-- ВАРИАНТ А (рекомендуется): Database Webhook через Dashboard
-- Supabase Dashboard → Database → Webhooks → Create webhook:
--   Name:   notify-order-status-email
--   Table:  crm_tasks
--   Events: UPDATE
--   URL:    https://znhwajycjdluzoypjejh.supabase.co/functions/v1/notify-order-status-email
--   HTTP Headers:
--     Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
--     Content-Type: application/json
--
-- ВАРИАНТ Б (SQL-триггер через pg_net — если pg_net расширение доступно):

-- Включить pg_net (если не включено)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Функция-триггер
CREATE OR REPLACE FUNCTION public.on_order_status_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Отправляем только при изменении order_status у заказов с клиентом
  IF NEW.order_status IS DISTINCT FROM OLD.order_status
     AND NEW.task_type = 'order'
     AND NEW.client_id IS NOT NULL
  THEN
    PERFORM net.http_post(
      url     := 'https://znhwajycjdluzoypjejh.supabase.co/functions/v1/notify-order-status-email',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
      ),
      body    := jsonb_build_object(
        'type',       'UPDATE',
        'table',      'crm_tasks',
        'record',     row_to_json(NEW),
        'old_record', row_to_json(OLD)
      )::text
    );
  END IF;
  RETURN NEW;
END;
$$;

-- Триггер на таблице
DROP TRIGGER IF EXISTS on_order_status_changed ON public.crm_tasks;
CREATE TRIGGER on_order_status_changed
  AFTER UPDATE OF order_status ON public.crm_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.on_order_status_changed();

-- Установить service_role_key как настройку БД (нужно для триггера ВАРИАНТ Б):
-- ALTER DATABASE postgres SET app.settings.service_role_key = '<SUPABASE_SERVICE_ROLE_KEY>';
-- (раскомментируй и вставь ключ если используешь ВАРИАНТ Б)
