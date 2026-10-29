-- ══════════════════════════════════════════════════════════════════════════════
-- Резервирование остатков товара при создании заказа
-- Запустить вручную в Supabase SQL Editor (целиком, за один раз)
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Новая колонка products.reserved_qty
--    Хранит количество, уже "занятое" неотгруженными заказами.
--    Доступный остаток клиенту = stock - reserved_qty.
--    sync_1c_products.py не трогает эту колонку — она независима от stock.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS reserved_qty integer NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RPC: place_order
--    Атомарная операция: проверка → резервирование → создание заказа.
--    Вызывается из CartDrawer вместо прямого INSERT в crm_tasks.
--    Использует FOR UPDATE, чтобы исключить гонку при одновременных заказах.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.place_order(
  p_items        jsonb,        -- [{id, sku, name, qty, price, unit}, ...]
  p_client_id    uuid,
  p_client_name  text,
  p_client_phone text,
  p_location_id  uuid,
  p_address      text,
  p_total        numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item       jsonb;
  v_product_id uuid;
  v_qty        int;
  v_stock      int;
  v_reserved   int;
  v_available  int;
  v_shortage   jsonb := '[]'::jsonb;
  v_task_id    uuid;
BEGIN
  -- Фаза 1: блокируем строки и проверяем доступность
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'id')::uuid;
    v_qty        := (v_item->>'qty')::int;

    SELECT stock, reserved_qty
      INTO v_stock, v_reserved
      FROM public.products
      WHERE id = v_product_id
      FOR UPDATE;  -- строчная блокировка от гонки

    v_available := COALESCE(v_stock, 0) - COALESCE(v_reserved, 0);

    IF v_available < v_qty THEN
      v_shortage := v_shortage || jsonb_build_object(
        'id',        v_product_id,
        'name',      v_item->>'name',
        'sku',       v_item->>'sku',
        'requested', v_qty,
        'available', GREATEST(0, v_available)
      );
    END IF;
  END LOOP;

  -- Если хоть что-то не хватает — откат с подробной ошибкой
  IF jsonb_array_length(v_shortage) > 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK:%', v_shortage::text
      USING ERRCODE = 'P0001';
  END IF;

  -- Фаза 2: резервируем
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'id')::uuid;
    v_qty        := (v_item->>'qty')::int;

    UPDATE public.products
      SET reserved_qty = reserved_qty + v_qty
      WHERE id = v_product_id;
  END LOOP;

  -- Фаза 3: создаём заказ
  INSERT INTO public.crm_tasks (
    task_type, order_status,
    client_id, client_name, client_phone,
    location_id, address, items, total, is_active, title
  ) VALUES (
    'order', 'new',
    p_client_id, p_client_name, p_client_phone,
    p_location_id, p_address, p_items, p_total, true,
    'Заказ от ' || COALESCE(p_client_name, 'клиента')
  )
  RETURNING id INTO v_task_id;

  RETURN v_task_id;
END;
$$;

-- Разрешаем вызов авторизованным клиентам (cabinet)
GRANT EXECUTE ON FUNCTION public.place_order TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Триггер: при смене статуса заказа освобождаем или потребляем резерв
--
--    cancelled → резерв возвращается в доступный остаток
--    done      → резерв освобождается И stock уменьшается (товар физически ушёл)
--
--    Работает только для заказов с полем items (client-facing orders из CartDrawer).
--    Заказы, созданные вручную в CRM без items, триггер игнорирует.
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
  v_qty        int;
BEGIN
  -- Пропускаем: не заказ, статус не менялся, нет items
  IF NEW.task_type != 'order'
     OR NEW.order_status IS NOT DISTINCT FROM OLD.order_status
     OR NEW.items IS NULL
  THEN
    RETURN NEW;
  END IF;

  -- Отмена: возвращаем товары в доступный остаток
  IF NEW.order_status = 'cancelled' AND OLD.order_status != 'cancelled' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      v_product_id := (v_item->>'id')::uuid;
      v_qty        := (v_item->>'qty')::int;
      UPDATE public.products
        SET reserved_qty = GREATEST(0, reserved_qty - v_qty)
        WHERE id = v_product_id;
    END LOOP;
  END IF;

  -- Выполнен: потребляем — снимаем резерв и уменьшаем физический stock
  IF NEW.order_status = 'done' AND OLD.order_status != 'done' THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      v_product_id := (v_item->>'id')::uuid;
      v_qty        := (v_item->>'qty')::int;
      UPDATE public.products
        SET reserved_qty = GREATEST(0, reserved_qty - v_qty),
            stock        = GREATEST(0, stock - v_qty)
        WHERE id = v_product_id;
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
-- Проверка после применения:
-- SELECT id, name, stock, reserved_qty, stock - reserved_qty AS available
-- FROM public.products
-- WHERE stock IS NOT NULL
-- LIMIT 10;
-- ─────────────────────────────────────────────────────────────────────────────
