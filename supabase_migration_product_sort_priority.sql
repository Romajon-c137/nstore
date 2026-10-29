-- Приоритет показа товара на сайте (главная, /shop, /opt). Применено 2026-10-17.
alter table public.products add column if not exists sort_priority integer;
comment on column public.products.sort_priority is 'Приоритет показа на сайте (главная, /shop, /opt): 1 — первым; пусто — после приоритетных, по алфавиту. Задаётся в CRM, синхронизация 1С не трогает.';
