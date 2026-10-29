-- ══════════════════════════════════════════════════════════════════════════════
-- Обновление place_order: возвращать order_number (text) вместо uuid
-- Зависимость: supabase_migration_order_number.sql должен быть применён первым
-- Запустить вручную в Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.place_order(
  p_items        jsonb,
  p_client_id    uuid,
  p_client_name  text,
  p_client_phone text,
  p_location_id  uuid,
  p_address      text,
  p_total        numeric
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item         jsonb;
  v_product_id   uuid;
  v_qty          int;
  v_stock        int;
  v_reserved     int;
  v_available    int;
  v_shortage     jsonb := '[]'::jsonb;
  v_task_id      uuid;
  v_order_number text;
BEGIN
  -- Фаза 1: блокируем строки и проверяем доступность
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'id')::uuid;
    v_qty        := (v_item->>'qty')::int;

    SELECT stock, reserved_qty
      INTO v_stock, v_reserved
      FROM public.products
      WHERE id = v_product_id
      FOR UPDATE;

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

  -- Фаза 3: создаём заказ (триггер assign_order_number заполняет order_number BEFORE INSERT)
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
  RETURNING id, order_number INTO v_task_id, v_order_number;

  RETURN v_order_number;
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_order TO authenticated;
