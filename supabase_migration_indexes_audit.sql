-- ═══════════════════════════════════════════════════════════════════════════════
-- АУДИТ ИНДЕКСОВ — Nstore ERP · 2026-07-10
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- СУЩЕСТВУЮЩИЕ ИНДЕКСЫ (автоматические, созданные Postgres/Supabase):
--   Таблица            │ Индекс
--   ───────────────────┼────────────────────────────────────────
--   crm_tasks          │ crm_tasks_pkey (id)
--   profiles           │ profiles_pkey (id)
--   contacts           │ contacts_pkey (id)
--   locations          │ locations_pkey (id)
--   products           │ products_pkey (id)
--   wa_conversations   │ wa_conversations_pkey (id)
--   wa_messages        │ wa_messages_pkey (id)
--   cart               │ cart_pkey (id)
--   contracts          │ contracts_pkey (id)
--
-- ВСЕ ОСТАЛЬНЫЕ ПОЛЯ — БЕЗ ИНДЕКСОВ.
-- Ни одного CREATE INDEX не было в миграциях проекта.
--
-- ⚠️  ВАЖНО для Supabase SQL Editor:
--     CREATE INDEX CONCURRENTLY нельзя запускать внутри транзакции.
--     Запускайте КАЖДУЮ команду ОТДЕЛЬНО (по одной в редакторе).
--     Либо уберите ключевое слово CONCURRENTLY — для таблиц с текущим
--     объёмом данных (~40-500 строк) блокировка будет < 1 секунды.
--
-- ═══════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. crm_tasks  (самая нагруженная таблица: борд, RLS, логистика, кабинет)
-- ─────────────────────────────────────────────────────────────────────────────

-- FK: client_id → profiles.id
-- Критично: RLS-политика "клиент видит свои заказы" делает seq-scan без него
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crm_tasks_client_id
  ON public.crm_tasks (client_id);

-- FK: assignee_id → profiles.id
-- Используется в фильтре "мои задачи" на борде
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crm_tasks_assignee_id
  ON public.crm_tasks (assignee_id);

-- FK: manager_id → profiles.id
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crm_tasks_manager_id
  ON public.crm_tasks (manager_id);

-- FK: logist_id → profiles.id
-- Нужен для LogisticsTab (SELECT ... WHERE logist_id = ?)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crm_tasks_logist_id
  ON public.crm_tasks (logist_id);

-- FK: company_id → companies.id
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crm_tasks_company_id
  ON public.crm_tasks (company_id);

-- FK: location_id → locations.id
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crm_tasks_location_id
  ON public.crm_tasks (location_id);

-- FK: column_id → crm_columns.id
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crm_tasks_column_id
  ON public.crm_tasks (column_id);

-- FK: created_by → profiles.id
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crm_tasks_created_by
  ON public.crm_tasks (created_by);

-- order_status: каждая колонка канбана = WHERE order_status = 'new' | 'confirmed' | …
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crm_tasks_order_status
  ON public.crm_tasks (order_status);

-- task_type: каждый запрос к борду фильтрует WHERE task_type IN ('order','lead')
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crm_tasks_task_type
  ON public.crm_tasks (task_type);

-- is_active: WHERE is_active = true/false в каждом запросе борда
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crm_tasks_is_active
  ON public.crm_tasks (is_active);

-- СОСТАВНОЙ: покрывает основной запрос борда
-- WHERE task_type IN (...) AND is_active = true ORDER BY sort_order
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crm_tasks_type_active_sort
  ON public.crm_tasks (task_type, is_active, sort_order);

-- СОСТАВНОЙ: канбан — WHERE task_type IN (...) AND order_status = ?
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crm_tasks_type_status
  ON public.crm_tasks (task_type, order_status);

-- СОСТАВНОЙ: кабинет клиента — WHERE client_id = ? AND is_active = ?
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crm_tasks_client_active
  ON public.crm_tasks (client_id, is_active);


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. profiles  (таблица пользователей, активно используется в RLS)
-- ─────────────────────────────────────────────────────────────────────────────

-- FK: company_id → companies.id
-- Нужен для RLS "клиент видит только свою компанию"
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_company_id
  ON public.profiles (company_id);

-- FK: manager_id → profiles.id
-- Связь клиент → менеджер, используется в дашборде и фильтрах
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_manager_id
  ON public.profiles (manager_id);

-- FK: parent_id → profiles.id (иерархия пользователей)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_parent_id
  ON public.profiles (parent_id);

-- FK: location_id → locations.id
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_location_id
  ON public.profiles (location_id);

-- role: fetchRoleRoute делает SELECT WHERE id = ? — role нужен для redirect
-- Также используется в AuthGuard и RLS-политиках
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_role
  ON public.profiles (role);


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. contacts
-- ─────────────────────────────────────────────────────────────────────────────

-- FK: company_id → companies.id
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_company_id
  ON public.contacts (company_id);

-- FK: profile_id → profiles.id
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_profile_id
  ON public.contacts (profile_id);

-- FK: created_by → profiles.id
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_created_by
  ON public.contacts (created_by);

-- phone: WhatsApp-таб ищет контакт по номеру телефона
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_phone
  ON public.contacts (phone);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. locations
-- ─────────────────────────────────────────────────────────────────────────────

-- FK: company_id → companies.id
-- Каждый запрос LocationsTab делает WHERE company_id = ?
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_locations_company_id
  ON public.locations (company_id);

-- FK: owner_id → profiles.id
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_locations_owner_id
  ON public.locations (owner_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. products  (каталог — самый частый SELECT в приложении)
-- ─────────────────────────────────────────────────────────────────────────────

-- sku: поиск товара по артикулу (импорт 1С, поиск на борде)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_sku
  ON public.products (sku);

-- section_name: фильтр каталога на лендинге и в кабинете
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_section_name
  ON public.products (section_name);

-- category: фильтр в кабинете B2B
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_category
  ON public.products (category);

-- is_active: WHERE is_active = true в каждом запросе каталога
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_is_active
  ON public.products (is_active);

-- СОСТАВНОЙ: основной запрос каталога
-- WHERE is_active = true ORDER BY name
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_active_name
  ON public.products (is_active, name);


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. wa_conversations
-- ─────────────────────────────────────────────────────────────────────────────

-- wa_id: идентификатор WhatsApp-диалога (телефон клиента).
-- Каждое входящее сообщение ищет диалог по wa_id.
-- Колонки contact_phone нет — поле называется wa_id.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wa_conversations_wa_id
  ON public.wa_conversations (wa_id);

-- FK: contact_id → contacts.id
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wa_conversations_contact_id
  ON public.wa_conversations (contact_id);

-- last_message_at: сортировка диалогов по времени
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wa_conversations_last_message_at
  ON public.wa_conversations (last_message_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. wa_messages
-- ─────────────────────────────────────────────────────────────────────────────

-- FK: conversation_id → wa_conversations.id
-- Критично: SELECT * FROM wa_messages WHERE conversation_id = ?
-- без индекса — полный seq-scan по всей таблице сообщений
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wa_messages_conversation_id
  ON public.wa_messages (conversation_id);

-- wa_message_id: дедупликация входящих (INSERT ... WHERE NOT EXISTS)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wa_messages_wa_message_id
  ON public.wa_messages (wa_message_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. cart
-- ─────────────────────────────────────────────────────────────────────────────

-- user_id: каждый запрос корзины = WHERE user_id = ?
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cart_user_id
  ON public.cart (user_id);

-- СОСТАВНОЙ: корзина конкретного пользователя по товару (для upsert)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cart_user_product
  ON public.cart (user_id, product_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 9. contracts
-- ─────────────────────────────────────────────────────────────────────────────

-- FK: user_id → profiles.id
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contracts_user_id
  ON public.contracts (user_id);

-- FK: assigned_by → profiles.id
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contracts_assigned_by
  ON public.contracts (assigned_by);


-- ═══════════════════════════════════════════════════════════════════════════════
-- ПРОВЕРКА после применения:
--
-- SELECT tablename, indexname
-- FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND indexname LIKE 'idx_%'
-- ORDER BY tablename, indexname;
--
-- Ожидаемый результат: 34 новых индекса (idx_*) в дополнение к PK-индексам.
-- ═══════════════════════════════════════════════════════════════════════════════
