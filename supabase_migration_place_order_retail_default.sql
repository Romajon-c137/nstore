-- place_order: цена по умолчанию = «Розница (офис, сайт)» (products.price).
-- Оптовый прайс ТП (price_tp) — только если в договоре price_list = 'price_tp';
-- «Топ клиенты» (price_top) — если price_list = 'price_top'. Скидки договора/разделов как раньше.
CREATE OR REPLACE FUNCTION public.place_order(p_items jsonb, p_client_id uuid, p_client_name text, p_client_phone text, p_location_id uuid, p_address text, p_total numeric)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid              uuid := auth.uid();
  v_item             jsonb;
  v_product_id       uuid;
  v_qty              int;
  v_stock            int;
  v_reserved         int;
  v_available        int;
  v_price            numeric;
  v_price_tp         numeric;
  v_price_top        numeric;
  v_section          text;
  v_sku              text;
  v_name             text;
  v_unit_price       numeric;
  v_section_discount numeric;
  v_shortage         jsonb := '[]'::jsonb;
  v_server_items     jsonb := '[]'::jsonb;
  v_server_total     numeric := 0;
  v_task_id          uuid;
  v_order_number     text;
  v_contract_price_list text;
  v_contract_discount   numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  IF p_client_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'CLIENT_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  SELECT price_list, discount_pct
    INTO v_contract_price_list, v_contract_discount
    FROM public.contracts
    WHERE user_id = v_uid
    LIMIT 1;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'id')::uuid;
    v_qty        := (v_item->>'qty')::int;

    IF v_product_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'INVALID_ITEM' USING ERRCODE = 'P0001';
    END IF;

    SELECT stock, reserved_qty, price, price_tp, price_top, section_name, sku, name
      INTO v_stock, v_reserved, v_price, v_price_tp, v_price_top, v_section, v_sku, v_name
      FROM public.products
      WHERE id = v_product_id
      FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND:%', v_product_id USING ERRCODE = 'P0001';
    END IF;

    v_available := COALESCE(v_stock, 0) - COALESCE(v_reserved, 0);

    IF v_available < v_qty THEN
      v_shortage := v_shortage || jsonb_build_object(
        'id', v_product_id, 'name', v_name, 'sku', v_sku,
        'requested', v_qty, 'available', GREATEST(0, v_available));
    END IF;

    -- Серверный пересчёт цены (как getPrice() в CatalogTab.tsx / CabinetPage.tsx и resolvePrice() в shop/pricing.ts)
    IF v_contract_price_list = 'price_top' AND v_price_top IS NOT NULL THEN
      v_unit_price := v_price_top;
    ELSE
      IF v_contract_price_list = 'price_tp' THEN
        v_unit_price := COALESCE(v_price_tp, v_price);
      ELSE
        v_unit_price := v_price;
      END IF;

      IF v_unit_price IS NULL THEN
        RAISE EXCEPTION 'NO_PRICE:%', v_product_id USING ERRCODE = 'P0001';
      END IF;

      IF v_contract_discount IS NOT NULL AND v_contract_discount != 0 THEN
        v_unit_price := round(v_unit_price * (1 - v_contract_discount / 100));
      ELSE
        v_section_discount := NULL;
        SELECT discount INTO v_section_discount
          FROM public.discounts
          WHERE user_id = v_uid AND section_id = v_section
          LIMIT 1;

        IF v_section_discount IS NOT NULL THEN
          v_unit_price := round(v_unit_price * (1 - v_section_discount / 100));
        END IF;
      END IF;
    END IF;

    v_server_items := v_server_items || jsonb_build_object(
      'id', v_product_id, 'sku', v_sku, 'name', v_name, 'qty', v_qty,
      'price', v_unit_price, 'unit', COALESCE(v_item->>'unit', 'шт'));
    v_server_total := v_server_total + v_unit_price * v_qty;
  END LOOP;

  IF jsonb_array_length(v_shortage) > 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK:%', v_shortage::text USING ERRCODE = 'P0001';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'id')::uuid;
    v_qty        := (v_item->>'qty')::int;
    UPDATE public.products SET reserved_qty = reserved_qty + v_qty WHERE id = v_product_id;
  END LOOP;

  INSERT INTO public.crm_tasks (
    task_type, order_status, client_id, client_name, client_phone,
    location_id, address, items, total, is_active, title
  ) VALUES (
    'order', 'new', v_uid, p_client_name, p_client_phone,
    p_location_id, p_address, v_server_items, v_server_total, true,
    'Заказ от ' || COALESCE(p_client_name, 'клиента')
  )
  RETURNING id, order_number INTO v_task_id, v_order_number;

  RETURN v_order_number;
END;
$function$;
