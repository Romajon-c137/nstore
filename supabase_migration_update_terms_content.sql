-- Migration: update_terms_content
-- Apply this in Supabase Dashboard → SQL Editor
--
-- Обновляет содержимое блока "Условия работы" (page_blocks, page='home',
-- block_type='terms') реальным текстом, скопированным с nstore.kz
-- (страницы /page/delivery и /page/payment-2), вместо изначальной
-- заглушки. Код-фолбэк DEFAULT_TERMS в LandingPage.tsx обновлён тем же
-- текстом, но т.к. в page_blocks уже есть строка для 'home'/'terms',
-- реальный сайт читает именно её — фолбэк не используется.

UPDATE public.page_blocks
SET props = '{
  "title": "Условия работы",
  "items": [
    {"title": "Доставка по Астане",           "desc": "Бесплатно при заказе от 30 000 ₸, иначе 1 500 ₸. Оформление до 09:00 — доставка в тот же день"},
    {"title": "Доставка по Казахстану и СНГ", "desc": "Отправляем в любой регион, стоимость доставки оплачивает покупатель"},
    {"title": "Оплата",                       "desc": "Наличными курьеру или по QR (Kaspi), безналичный расчёт, перевод на Kaspi"},
    {"title": "Самовывоз",                    "desc": "г. Астана, ул. Керей Жанибек ханов, д. 50, офис №6"}
  ]
}'::jsonb
WHERE page = 'home' AND block_type = 'terms';
