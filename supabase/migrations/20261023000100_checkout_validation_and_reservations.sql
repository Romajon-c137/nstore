-- Incremental patch for an EXISTING Nstore database, not a schema bootstrap.
-- Reconcile with the deployed schema and test in staging before application.
-- Keeps the current seven-argument RPC and text order-number response.
BEGIN;

DO $$
DECLARE
  v_oid regprocedure := to_regprocedure('public.place_order(jsonb,uuid,text,text,uuid,text,numeric)');
BEGIN
  IF v_oid IS NULL OR pg_get_function_result(v_oid) <> 'text' THEN
    RAISE EXCEPTION 'CHECKOUT_SCHEMA_MISMATCH: expected existing place_order returning text';
  END IF;
  IF to_regprocedure('public.recalc_reserved_qty(uuid)') IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.crm_tasks')
      AND tgname = 'crm_task_reservation' AND tgenabled IN ('O','A')
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.crm_tasks')
      AND tgname = 'crm_task_items_changed' AND tgenabled IN ('O','A')
  ) THEN
    RAISE EXCEPTION 'CHECKOUT_SCHEMA_MISMATCH: reconcile reservation functions/triggers first';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.place_order(
  p_items jsonb, p_client_id uuid, p_client_name text, p_client_phone text,
  p_location_id uuid, p_address text, p_total numeric
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_items jsonb;
  v_product_id uuid;
  v_qty integer;
  v_stock integer;
  v_reserved integer;
  v_active boolean;
  v_available integer;
  v_price numeric;
  v_price_tp numeric;
  v_price_top numeric;
  v_section text;
  v_sku text;
  v_name text;
  v_unit_price numeric;
  v_section_discount numeric;
  v_shortage jsonb := '[]'::jsonb;
  v_server_items jsonb := '[]'::jsonb;
  v_server_total numeric := 0;
  v_order_number text;
  v_contract_price_list text;
  v_contract_discount numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_client_id IS DISTINCT FROM v_uid THEN RAISE EXCEPTION 'CLIENT_MISMATCH'; END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_ITEMS';
  END IF;
  IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'INVALID_ITEMS';
  END IF;

  -- Validate before casting/aggregating. Bound each quantity and its per-product
  -- sum to the integer representation already used by the existing RPC.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(v_item) <> 'object' OR v_item->>'id' IS NULL
       OR COALESCE(v_item->>'qty', '') !~ '^[1-9][0-9]{0,9}$' THEN
      RAISE EXCEPTION 'INVALID_ITEM';
    END IF;
    IF (v_item->>'qty')::numeric > 2147483647 THEN
      RAISE EXCEPTION 'INVALID_ITEM';
    END IF;
    BEGIN
      v_product_id := (v_item->>'id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'INVALID_ITEM';
    END;
  END LOOP;

  SELECT jsonb_agg(jsonb_build_object('id', id, 'qty', qty, 'unit', unit) ORDER BY id)
  INTO v_items
  FROM (
    SELECT (value->>'id')::uuid AS id, sum((value->>'qty')::numeric) AS qty,
           (array_agg(COALESCE(value->>'unit','шт') ORDER BY ord))[1] AS unit
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS x(value,ord)
    GROUP BY (value->>'id')::uuid
  ) normalized;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) x WHERE (x->>'qty')::numeric > 2147483647) THEN
    RAISE EXCEPTION 'INVALID_ITEM';
  END IF;

  IF p_location_id IS NOT NULL THEN
    PERFORM l.id FROM public.locations l JOIN public.profiles p ON p.company_id = l.company_id
      WHERE l.id = p_location_id AND p.id = v_uid
      FOR SHARE OF l, p;
    IF NOT FOUND THEN RAISE EXCEPTION 'LOCATION_NOT_ALLOWED'; END IF;
  END IF;

  SELECT price_list, discount_pct INTO v_contract_price_list, v_contract_discount
    FROM public.contracts WHERE user_id = v_uid LIMIT 1;

  -- All callers acquire product row locks in UUID order, regardless of input
  -- order. Duplicate lines are already combined before availability is checked.
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) ORDER BY (value->>'id')::uuid LOOP
    v_product_id := (v_item->>'id')::uuid;
    v_qty := (v_item->>'qty')::integer;
    SELECT stock,reserved_qty,is_active,price,price_tp,price_top,section_name,sku,name
      INTO v_stock,v_reserved,v_active,v_price,v_price_tp,v_price_top,v_section,v_sku,v_name
      FROM public.products WHERE id = v_product_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND:%', v_product_id; END IF;
    IF v_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'PRODUCT_INACTIVE:%', v_product_id; END IF;
    v_available := COALESCE(v_stock,0) - COALESCE(v_reserved,0);
    IF v_available < v_qty THEN
      v_shortage := v_shortage || jsonb_build_object('id',v_product_id,'name',v_name,
        'sku',v_sku,'requested',v_qty,'available',GREATEST(0,v_available));
    END IF;

    -- Preserve the existing contract/top/retail discount precedence.
    IF v_contract_price_list = 'price_top' AND v_price_top IS NOT NULL THEN
      v_unit_price := v_price_top;
    ELSE
      v_unit_price := CASE WHEN v_contract_price_list = 'price_tp'
        THEN COALESCE(v_price_tp,v_price) ELSE v_price END;
      IF v_contract_discount IS NOT NULL AND v_contract_discount <> 0 THEN
        v_unit_price := round(v_unit_price * (1-v_contract_discount/100));
      ELSE
        v_section_discount := NULL;
        SELECT discount INTO v_section_discount FROM public.discounts
          WHERE user_id = v_uid AND section_id = v_section LIMIT 1;
        IF v_section_discount IS NOT NULL THEN
          v_unit_price := round(v_unit_price * (1-v_section_discount/100));
        END IF;
      END IF;
    END IF;
    IF v_unit_price IS NULL OR v_unit_price <= 0 OR v_unit_price::text IN ('NaN','Infinity','-Infinity') THEN
      RAISE EXCEPTION 'NO_PRICE:%', v_product_id;
    END IF;
    v_server_items := v_server_items || jsonb_build_object('id',v_product_id,'sku',v_sku,
      'name',v_name,'qty',v_qty,'price',v_unit_price,'unit',v_item->>'unit');
    v_server_total := v_server_total + v_unit_price*v_qty;
  END LOOP;
  IF jsonb_array_length(v_shortage) > 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK:%', v_shortage::text;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    UPDATE public.products SET reserved_qty = COALESCE(reserved_qty,0)+(v_item->>'qty')::integer
      WHERE id = (v_item->>'id')::uuid;
  END LOOP;
  INSERT INTO public.crm_tasks(task_type,order_status,client_id,client_name,client_phone,
    location_id,address,items,total,is_active,title)
  VALUES ('order','new',v_uid,p_client_name,p_client_phone,p_location_id,p_address,
    v_server_items,v_server_total,true,'Заказ от ' || COALESCE(p_client_name,'клиента'))
  RETURNING order_number INTO v_order_number;
  RETURN v_order_number;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_task_reservation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_product_id uuid; v_item jsonb;
BEGIN
  IF NEW.task_type <> 'order' OR NEW.order_status IS NOT DISTINCT FROM OLD.order_status THEN
    RETURN NEW;
  END IF;
  -- An empty NEW array still requires releasing products present in OLD.
  FOR v_product_id IN
    SELECT DISTINCT (x->>'id')::uuid FROM (
      SELECT value AS x FROM jsonb_array_elements(COALESCE(OLD.items,'[]'::jsonb))
      UNION ALL
      SELECT value AS x FROM jsonb_array_elements(COALESCE(NEW.items,'[]'::jsonb))
    ) affected ORDER BY 1
  LOOP
    PERFORM public.recalc_reserved_qty(v_product_id);
  END LOOP;
  -- Retain existing completion semantics until ERP stock ownership is reconciled.
  IF NEW.order_status = 'done' AND OLD.order_status <> 'done' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.items,'[]'::jsonb))
      ORDER BY (value->>'id')::uuid LOOP
      UPDATE public.products SET stock = GREATEST(0,stock-(v_item->>'qty')::integer)
        WHERE id = (v_item->>'id')::uuid;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
