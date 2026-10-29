-- ══════════════════════════════════════════════════════════════════════════════
-- Исправление триггера резервирования: пересчёт вместо инкремента
--
-- Причина бага: reserved_qty ведётся инкрементально, но при редактировании
-- позиций заказа через CardModal (UPDATE items без изменения order_status)
-- триггер не срабатывал → reserved_qty расходился с реальными items.
-- При последующей отмене заказа триггер читал актуальный items (qty=12)
-- и снимал резерв 12 вместо реально забронированных 24.
--
-- Решение: при любом изменении order_status или items пересчитывать
-- reserved_qty напрямую из crm_tasks, а не накапливать дельту.
-- Пересчёт всегда возвращает правильное значение независимо от истории.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Вспомогательная функция: пересчёт reserved_qty одного товара
-- Суммирует qty по всем АКТИВНЫМ заказам (не cancelled/done).
-- Вызывается из обоих триггеров ниже.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recalc_reserved_qty(p_product_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.products
  SET reserved_qty = COALESCE((
    SELECT SUM((item->>'qty')::int)
    FROM   public.crm_tasks  t
    CROSS  JOIN jsonb_array_elements(t.items) AS item
    WHERE  (item->>'id')::uuid = p_product_id
      AND  t.task_type     = 'order'
      AND  t.order_status  NOT IN ('cancelled', 'done')
      AND  t.items         IS NOT NULL
  ), 0)
  WHERE id = p_product_id;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Триггер 1: изменение order_status (cancel / done / reopen)
-- Заменяет прежний crm_task_reservation, который снимал дельту.
-- Теперь: при любом переходе статуса пересчитываем reserved_qty
-- для каждого товара из NEW.items (или OLD.items если NEW.items NULL).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_task_reservation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item       jsonb;
  v_product_id uuid;
  v_seen       uuid[] := '{}';
BEGIN
  -- Пропускаем: не заказ, статус не менялся
  IF NEW.task_type != 'order'
     OR NEW.order_status IS NOT DISTINCT FROM OLD.order_status
  THEN
    RETURN NEW;
  END IF;

  -- Пересчитываем reserved_qty для каждого уникального товара из items.
  -- Используем COALESCE(NEW.items, OLD.items): если статус меняется вместе
  -- с обнулением items (edge case), берём предыдущий список товаров.
  FOR v_item IN
    SELECT * FROM jsonb_array_elements(COALESCE(NEW.items, OLD.items, '[]'::jsonb))
  LOOP
    v_product_id := (v_item->>'id')::uuid;
    -- Пропускаем дубли (если один товар в items несколько раз)
    IF v_product_id = ANY(v_seen) THEN CONTINUE; END IF;
    v_seen := v_seen || v_product_id;

    PERFORM public.recalc_reserved_qty(v_product_id);
  END LOOP;

  -- done: уменьшаем физический stock (поведение как раньше)
  IF NEW.order_status = 'done' AND OLD.order_status != 'done' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(NEW.items, '[]'::jsonb)) LOOP
      UPDATE public.products
        SET stock = GREATEST(0, stock - (v_item->>'qty')::int)
        WHERE id = (v_item->>'id')::uuid;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_task_reservation ON public.crm_tasks;
CREATE TRIGGER crm_task_reservation
  AFTER UPDATE OF order_status ON public.crm_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.crm_task_reservation();

-- ─────────────────────────────────────────────────────────────────────────────
-- Триггер 2: изменение items на АКТИВНОМ заказе (новый — раньше отсутствовал)
-- Срабатывает когда CardModal меняет позиции в уже существующем заказе.
-- Для cancelled/done пересчёт не нужен (резерв = 0).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_task_items_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item       jsonb;
  v_product_id uuid;
  v_seen       uuid[] := '{}';
BEGIN
  -- Пропускаем: не заказ, items не менялся, заказ уже закрыт
  IF NEW.task_type != 'order'
     OR NEW.items IS NOT DISTINCT FROM OLD.items
     OR NEW.order_status IN ('cancelled', 'done')
  THEN
    RETURN NEW;
  END IF;

  -- Собираем уникальные product_id из OLD и NEW items — пересчитываем оба.
  -- (Товар мог быть удалён из заказа → OLD.items нужен чтобы его обнулить.)
  FOR v_item IN
    SELECT * FROM jsonb_array_elements(COALESCE(OLD.items, '[]'::jsonb))
    UNION
    SELECT * FROM jsonb_array_elements(COALESCE(NEW.items, '[]'::jsonb))
  LOOP
    v_product_id := (v_item->>'id')::uuid;
    IF v_product_id = ANY(v_seen) THEN CONTINUE; END IF;
    v_seen := v_seen || v_product_id;

    PERFORM public.recalc_reserved_qty(v_product_id);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_task_items_changed ON public.crm_tasks;
CREATE TRIGGER crm_task_items_changed
  AFTER UPDATE OF items ON public.crm_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.crm_task_items_changed();

-- ─────────────────────────────────────────────────────────────────────────────
-- Единовременный пересчёт: синхронизируем текущее состояние
-- Обновляет reserved_qty для ВСЕХ товаров по активным заказам.
-- Запускать после применения миграции — исправит накопившийся drift.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE public.products p
SET reserved_qty = COALESCE((
  SELECT SUM((item->>'qty')::int)
  FROM   public.crm_tasks  t
  CROSS  JOIN jsonb_array_elements(t.items) AS item
  WHERE  (item->>'id')::uuid = p.id
    AND  t.task_type     = 'order'
    AND  t.order_status  NOT IN ('cancelled', 'done')
    AND  t.items         IS NOT NULL
), 0);

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Проверка после применения:
-- SELECT sku, name, reserved_qty FROM public.products WHERE reserved_qty > 0;
-- ─────────────────────────────────────────────────────────────────────────────
