-- Migration: seed_landing_blocks
-- Apply this in Supabase Dashboard → SQL Editor
--
-- Добавляет на лендинг (page='home') 4 новых блока, которые уже поддержаны
-- в коде (src/pages/LandingPage.tsx) и в CRM-редакторе (ContentTab.tsx),
-- но отсутствуют в проде, т.к. таблица page_blocks уже не пуста и код
-- использует DEFAULT_BLOCKS только как fallback для пустой таблицы:
--   - usp_hero  (Hero с УТП и цифрами)      — между categories_chips и hero
--   - terms     (Условия работы)            — между cat_grid и b2b_banner
--   - steps     (Как начать работу)         — между b2b_banner и perks
--   - form      (Форма "Стать партнёром")   — между perks и footer
--
-- Итоговый порядок: header → promo_bar → categories_chips → usp_hero → hero
--   → products → cat_grid → terms → b2b_banner → steps → perks → form → footer

BEGIN;

-- Фаза 1: временно сдвигаем все существующие sort_order, чтобы не столкнуться
-- с занятыми значениями при переносе на новые позиции.
UPDATE public.page_blocks SET sort_order = sort_order + 100 WHERE page = 'home';

-- Фаза 2: расставляем существующие блоки на итоговые места
UPDATE public.page_blocks SET sort_order = 0  WHERE page = 'home' AND block_type = 'header';
UPDATE public.page_blocks SET sort_order = 1  WHERE page = 'home' AND block_type = 'promo_bar';
UPDATE public.page_blocks SET sort_order = 2  WHERE page = 'home' AND block_type = 'categories_chips';
UPDATE public.page_blocks SET sort_order = 4  WHERE page = 'home' AND block_type = 'hero';
UPDATE public.page_blocks SET sort_order = 5  WHERE page = 'home' AND block_type = 'products';
UPDATE public.page_blocks SET sort_order = 6  WHERE page = 'home' AND block_type = 'cat_grid';
UPDATE public.page_blocks SET sort_order = 8  WHERE page = 'home' AND block_type = 'b2b_banner';
UPDATE public.page_blocks SET sort_order = 10 WHERE page = 'home' AND block_type = 'perks';
UPDATE public.page_blocks SET sort_order = 12 WHERE page = 'home' AND block_type = 'footer';

-- Фаза 3: вставляем 4 новых блока
INSERT INTO public.page_blocks (page, block_type, props, sort_order, is_active) VALUES
('home', 'usp_hero', '{
  "title": "Продукты питания оптом и в розницу",
  "subtitle": "Прямые поставки от дистрибьютора — свежесть, цены и сроки под контролем",
  "primaryBtnText": "Смотреть каталог",
  "secondaryBtnText": "Стать партнёром B2B",
  "stats": [
    {"value": "1197+", "label": "товаров в каталоге"},
    {"value": "500+",  "label": "клиентов"},
    {"value": "7 лет", "label": "на рынке"}
  ]
}'::jsonb, 3, true),

('home', 'terms', '{
  "title": "Условия работы",
  "items": [
    {"title": "Минимальный заказ", "desc": "МОЗ от 15 000 ₸ для оптовых клиентов"},
    {"title": "Оплата",            "desc": "По счёту, наличными или картой при получении"},
    {"title": "Доставка",          "desc": "Собственный транспорт по городу, отгрузка под заказ"},
    {"title": "Договор",           "desc": "Работаем по договору поставки, отсрочка для проверенных партнёров"}
  ]
}'::jsonb, 7, true),

('home', 'steps', '{
  "title": "Как начать работу",
  "items": [
    {"title": "Заявка",   "desc": "Оставьте заявку на сайте или напишите менеджеру"},
    {"title": "Договор",  "desc": "Согласуем условия и подпишем договор поставки"},
    {"title": "Поставка", "desc": "Открываем доступ в B2B-кабинет и начинаем поставки"}
  ]
}'::jsonb, 9, true),

('home', 'form', '{
  "title": "Стать партнёром",
  "btnText": "Отправить заявку",
  "showEmail": false,
  "showCompany": true,
  "showSegment": true,
  "showComment": true
}'::jsonb, 11, true);

COMMIT;

-- Проверка результата:
-- select block_type, sort_order, is_active from public.page_blocks
-- where page = 'home' order by sort_order;
