-- supabase_migration_cart.sql
-- Запустить вручную в Supabase Dashboard → SQL Editor → Run
-- Серверная корзина для CabinetPage (client-role пользователи).
-- user_id = profiles.id = auth.uid() для RLS.
--
-- ВАЖНО: если таблица уже создана, но корзина не сохраняется —
-- запустите только блок GRANT ниже (строки с GRANT и DROP POLICY / CREATE POLICY).
-- Причина: при создании таблицы через SQL Editor Supabase не выдаёт
-- GRANT автоматически (в отличие от создания через Dashboard UI),
-- поэтому RLS-политики есть, но роль authenticated не имеет доступа.

CREATE TABLE IF NOT EXISTS cart (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id  uuid        NOT NULL,
  qty         integer     NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_price  numeric     NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id)
);

-- Без этого гранта все операции падают с "permission denied",
-- даже если RLS-политики правильно настроены.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cart TO authenticated;

ALTER TABLE cart ENABLE ROW LEVEL SECURITY;

-- Пересоздаём политики через DROP IF EXISTS → CREATE (идемпотентно)
DROP POLICY IF EXISTS cart_select ON cart;
DROP POLICY IF EXISTS cart_insert ON cart;
DROP POLICY IF EXISTS cart_update ON cart;
DROP POLICY IF EXISTS cart_delete ON cart;

-- Пользователь видит только свою корзину
CREATE POLICY cart_select ON cart
  FOR SELECT USING (auth.uid() = user_id);

-- Пользователь может добавлять только в свою корзину
CREATE POLICY cart_insert ON cart
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Пользователь может изменять только свои строки
CREATE POLICY cart_update ON cart
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Пользователь может удалять только свои строки
CREATE POLICY cart_delete ON cart
  FOR DELETE USING (auth.uid() = user_id);
