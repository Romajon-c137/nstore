-- ══════════════════════════════════════════════════════════════════════════════
-- Короткий человекочитаемый номер заказа: ORDER-1001, ORDER-1002, …
-- Запустить вручную в Supabase SQL Editor (целиком, за один раз)
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Sequence — атомарный счётчик, исключает гонку при параллельных заказах
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.crm_order_number_seq
  START WITH 1001
  INCREMENT BY 1
  NO CYCLE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Колонка order_number в crm_tasks
--    NULL разрешён: задачи (task), лиды (lead) номера не получают.
--    UNIQUE задаётся сразу в ADD COLUMN — PostgreSQL это поддерживает.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.crm_tasks
  ADD COLUMN IF NOT EXISTS order_number text UNIQUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Триггер — автоматически присваивает номер при INSERT заказа
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_order_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.task_type = 'order' AND NEW.order_number IS NULL THEN
    NEW.order_number := 'ORDER-' || nextval('public.crm_order_number_seq');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assign_order_number ON public.crm_tasks;
CREATE TRIGGER assign_order_number
  BEFORE INSERT ON public.crm_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_order_number();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Бэкфилл существующих заказов (ORDER BY created_at)
--    Новые заказы числа не займут — sequence сдвинем ниже за max бэкфилла.
-- ─────────────────────────────────────────────────────────────────────────────
WITH numbered AS (
  SELECT id,
         1000 + ROW_NUMBER() OVER (ORDER BY created_at) AS num
  FROM   public.crm_tasks
  WHERE  task_type = 'order'
    AND  order_number IS NULL
)
UPDATE public.crm_tasks t
SET    order_number = 'ORDER-' || n.num
FROM   numbered n
WHERE  t.id = n.id;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Сдвигаем sequence за последний выданный номер, чтобы новые заказы
--    продолжили нумерацию без дыр
-- ─────────────────────────────────────────────────────────────────────────────
SELECT setval(
  'public.crm_order_number_seq',
  COALESCE(
    (SELECT MAX(REPLACE(order_number, 'ORDER-', '')::int)
     FROM   public.crm_tasks
     WHERE  order_number LIKE 'ORDER-%'),
    1000
  )
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Проверка
-- SELECT id, task_type, order_number, created_at
-- FROM   public.crm_tasks
-- WHERE  task_type = 'order'
-- ORDER  BY created_at
-- LIMIT  20;
-- ─────────────────────────────────────────────────────────────────────────────
