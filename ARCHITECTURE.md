> Фронтенд переведён на Next.js App Router и FSD. Актуальная структура и запуск:
> [docs/NEXT-FSD.md](docs/NEXT-FSD.md). Описания Vite/React Router ниже относятся
> к прежней реализации; доменные правила и контракты сохранены.

# Архитектура Nstore ERP

Цель документа — карта разделов, файлов, таблиц, ключей кэша и RLS, чтобы
**разные части сайта правились параллельно без взаимных помех и конфликтов**.
Перед правкой найдите свой раздел ниже и работайте в его файлах.

Стек: React 18 + TypeScript + Vite · TanStack Query v5 · React Router v6 ·
Supabase (Postgres + RLS + Storage). Деплой: Vercel (`main` → opt-nstore.vercel.app).

---

## 1. Принципы изоляции

| Уровень | Как изолировано |
|---|---|
| **Маршруты** | Каждый раздел — свой lazy-чанк (`App.tsx`). Правка одного не ломает загрузку другого. |
| **Файлы** | Каждый экран/блок — отдельный файл (после P1). Разные фичи = разные файлы = нет merge-конфликтов. |
| **Данные** | Домен заказов вынесен в `src/data/orders.ts` (P2/P3) — статусы и инвалидация в одном месте. |
| **Права** | RBAC централизован в `CRMContext.can(tabId)`; на уровне БД — RLS. |

**Главный общий ресурс — это Supabase (таблицы + RLS).** Изменения схемы/политик
координируйте в первую очередь: одна таблица `crm_tasks` обслуживает 6 разделов.

---

## 2. Карта маршрутов (`src/App.tsx`)

| Путь | Компонент | Доступ |
|---|---|---|
| `/` | `LandingPage` | публичный |
| `/login`, `/register` | `LoginPage`, `RegisterPage` | публичный |
| `/shop` | `ShopPage` (каталог для заказа) | публичный; клиент — свои цены и заказ |
| `/cabinet` | `CabinetPage` (`?tab=orders` и др.) | клиент (роль `client`) |
| `/crm/dash` | `DashTab` | персонал |
| `/crm/board` | `BoardTab` | персонал |
| `/crm/partners` | `PartnersTab` → секции Клиенты/Точки/Компании | персонал |
| `/crm/products1c` | `Products1cTab` | персонал |
| `/crm/logistics` | `LogisticsTab` | персонал (логист по умолчанию видит свои) |
| `/crm/content` | `ContentTab` (конструктор лендинга) | персонал |
| `/crm/whatsapp` | `WhatsAppTab` | персонал |
| `/crm/sales` | `SalesTab` (аналитика продаж из 1С, `?v=` вкладка) | модуль `sales` (по умолчанию admin) |
| `/crm/roles` | `RolesTab` | admin/manager |
| `/crm/{clients,locations,companies}` | → редирект на `/crm/partners` | — |

---

## 3. Карта владения (какие файлы правит какой раздел)

Берите файлы **только своего раздела** — так параллельные правки не пересекаются.

### Лендинг (публичный сайт) — `src/pages/landing/`
- Оболочка: `src/pages/LandingPage.tsx` (запросы, состояние, `renderBlock`).
- Блоки: `Header, PromoBar, CategoriesChips, UspHeroBlock, HeroBlock, ProductsBlock,`
  `CatGrid, TermsBlock, StepsBlock, PerksBlock, B2BBanner, ReviewsBlock, TextBlock,`
  `FormBlock, FooterBlock, CartDrawer, ProductModal, SearchBox`.
- Общее: `landing/shared.tsx` (типы, `DEFAULT_BLOCKS`, `ProductImageArea`, хелперы).
- Контент управляется из CRM · Контент через таблицу `page_blocks`.

### Каталог для заказа — `src/pages/shop/` (маршрут `/shop`)
- Оболочка: `ShopPage.tsx` (URL-состояние `?c= ?q= ?p= ?view=`, секции, лента).
- Части: `ProductCard, ProductSheet, CartSheet, FiltersSheet, MyPurchases`, примитивы `ui.tsx`, стили `shop.css` (префикс `sh-`).
- Данные: `source.ts` (адаптер Supabase; `VITE_CATALOG_SOURCE=demo` → `demoSource.ts`), `normalize.ts` (бренд, фасовка, варианты), `categories.ts`, `pricing.ts`, `search.ts`, `b2b.ts`, `hooks.ts`.
- Оформление заказа — общий `src/data/placeOrder.ts` (его же использует кабинет).
- Подробно: `docs/SHOP_CATALOG.md`.

### Кабинет клиента — `src/pages/cabinet/`
- Оболочка: `src/pages/CabinetPage.tsx` (корзина, вкладки, сайдбар, настройки).
- Экраны: `OverviewTab, CatalogTab, OrdersTab, LocationsTab, UsersTab, ProfileTab, CartDrawer`.
- Общее: `cabinet/shared.tsx` (типы, `deliveryView`, `fmt`, геокодер, `LocationsMap`).

### CRM · Доска — `src/pages/crm/board/`
- Оболочка: `src/pages/crm/tabs/BoardTab.tsx` (запросы, `commitMove`, фильтры, DnD, рендер).
- Части: `CardModal, CreateModal, KanbanCard, KanbanColumn, MobileListView`.
- DnD: `useBoardDnd.tsx`. Общее: `board/shared.tsx` (типы, хелперы, `uploadImage`;
  статусы ре-экспортит из `src/data/orders.ts`).

### Прочие вкладки CRM — `src/pages/crm/tabs/` (по одному файлу-монолиту на вкладку)
`DashTab, LogisticsTab, ContentTab, WhatsAppTab, RolesTab, Products1cTab,`
`PartnersTab, ClientsTab, CompaniesTab, LocationsTab, OrdersTab`.

> Если такой файл станет крупным/горячим — разбейте его в папку по образцу
> `board/` (оболочка + части + `shared`).

### CRM · Аналитика продаж — `src/pages/crm/sales/`
- Оболочка: `src/pages/crm/tabs/SalesTab.tsx` (фильтры, свежесть данных, вкладки).
- Части: `OverviewView, ClientsView, OpportunitiesView, ForecastPlanView, SyncLogView, ClientDrawer`; общее `ui.tsx`, данные `api.ts` (`salesKeys`).
- Данные: только RPC `sa_*` над схемой `analytics` (источник 1С, синхронизация `sync-onec-sales`). Подробно: `docs/SALES_ANALYTICS.md`.

### Каркас CRM
- `src/pages/crm/CRMLayout.tsx` — сайдбар, мобильная шапка, «More»-шторка.
- `src/pages/crm/context/CRMContext.tsx` — `profile`, `can()`, `toast`.

---

## 4. Общие модули (⚠️ менять с осторожностью — фан-ин большой)

| Модуль | Кто зависит | Назначение |
|---|---|---|
| `src/lib/supabase.ts` | ~21 файл | клиент Supabase |
| `src/i18n/LanguageContext.tsx` | ~11 | язык (kz/ru), `tr()` |
| `src/pages/crm/context/CRMContext.tsx` | ~11 | профиль, RBAC `can()`, `toast()` |
| `src/pages/crm/shared/crmui.tsx` | ~11 | `Avatar, Modal, Pagination, useCompaniesList` |
| `src/data/orders.ts` | Board, Cabinet, Logistics | **статусы заказов + queryKey + инвалидация** |
| `src/components/UserSettingsModal.tsx` | CRM, Cabinet | настройки пользователя |
| `src/types/index.ts` | несколько | `Profile`, `UserRole` |

Правка этих файлов затрагивает много экранов — согласуйте изменения.

---

## 5. Слой данных

### 5.1. Таблицы БД по разделам

| Раздел | Таблицы (чтение/запись) |
|---|---|
| Лендинг | `page_blocks`, `products`, `contacts` (форма лид) |
| Кабинет | `crm_tasks`, `products`, `profiles`, `locations`, `contracts`, `discounts`, `invites` |
| Доска | `crm_tasks`, `companies`, `profiles` |
| Логистика | `crm_tasks`, `crm_task_events` (журнал), `profiles` |
| Дашборд | `crm_tasks`, `products`, `profiles`, `contracts`, `fx_rates`, `kpi_goals` |
| Партнёры (Clients/Companies/Locations) | `contacts`, `companies`, `locations`, `profiles`, `crm_tasks` |
| Роли | `profiles`, `role_permissions` |

### 5.2. Хаб-таблица `crm_tasks` (заявки + задачи)

Читают/пишут: **Доска, Логистика, Кабинет, Дашборд, Партнёры, Orders**.
> Любое изменение схемы/статусов `crm_tasks` затрагивает эти разделы.
> Статусы заказа и их цвета/подписи — **только** в `src/data/orders.ts`.

Ключевые поля: `task_type('order'|'task')`, `order_status`, `delivery_state`,
`logist_id`, `invoice_no`, `cash_received`, `delivered_at`, `delivering_at`,
`completed_at`, `checklist`, `sort_order`, `is_active`.

Статусы заказа: `new → confirmed → picking → delivering → review → done` (+`cancelled`).
Под-статус доставки: `waiting | going`. Триггеры БД пишут журнал в `crm_task_events`
и проставляют таймстемпы (`delivering_at`/`delivered_at`/`completed_at`).

### 5.3. Ключи кэша (`queryKey`) → раздел

- **Заказы (crm_tasks):** `board-orders`, `board-tasks`, `logistics-delivering`,
  `nav-orders-count`, `cabinet-orders`, `orders`, `location-orders`, `contact-orders`,
  `company-tasks`, `dashboard-analytics`, `task-events`.
- **Партнёры:** `contacts`, `companies`, `companies-list`, `company-contacts`,
  `company-contact-counts`, `company-tasks`, `locations`, `b2b-applications`.
- **Продукты:** `products`, `products-stock`, `product-categories`, `landing-products`,
  `landing-search`, `section-counts`, `cabinet-products*`.
- **Кабинет:** `cabinet-*`, `client-contract`, `client-discounts`, `cart-locations`.
- **Каталог /shop:** `shop-customer`, `shop-products`, `shop-pricing`, `shop-orders`, `shop-locations`.
- **Роли/профиль:** `role-permissions`, `profiles-roles`, `my-profile`, `managers-list`, `logists`.
- **Прочее:** `wa-conversations`, `wa-messages`, `nav-wa-unread`, `fx-rates`, `page-blocks-home`.

**Инвалидация заказов:** используйте `invalidateOrders(qc)` из `src/data/orders.ts`
вместо ручного набора `invalidateQueries`. Фабрика ключей — `orderKeys`.
Исключение: оптимистичные пути (DnD `commitMove`, reorder логистики, `CartDrawer`)
оставлены с узкой инвалидацией, чтобы не рефетчить видимый список.

### 5.4. Storage (Supabase)
- Бакет **`board`** — фото/документы карточек (upload в `board/shared.uploadImage`,
  фолбэк, если Cloudinary недоступен). Основной аплоад — Cloudinary (`dwbmwxm2l`).

---

## 6. RLS (backend-контракт, критично для безопасности)

| Таблица | SELECT | INSERT/UPDATE/DELETE |
|---|---|---|
| `crm_tasks` | персонал (admin/manager/logist) — всё; клиент — только свои (`client_id`/`manager_id = auth.uid()`); аноним — контент-блоки лендинга | INSERT: авторизованный (+ аноним для заказов); UPDATE/DELETE: **только персонал** |
| `profiles` | сам (`id=auth.uid()`), admin/manager, родитель (`parent_id`) | сам или admin/manager |
| `products` | публично при `is_active=true` | персонал |
| `page_blocks` | публично при `is_active=true` | персонал |
| `crm_task_events` | только персонал | пишется триггером (SECURITY DEFINER) |

Роль определяется функцией `get_role_for_uid(auth.uid())` (SECURITY DEFINER,
без рекурсии по `profiles`). Персонал = `admin | manager | logist`, клиент = `client`.

---

## 7. Правила добавления фич (чтобы не сломать соседей)

1. **Работайте в файлах своего раздела** (см. §3). Не редактируйте один и тот же
   крупный файл параллельно — если файл «горячий», сначала разбейте его на части.
2. **Статусы/цвета/подписи заказа** меняйте только в `src/data/orders.ts`.
3. **Инвалидация заказов** — через `invalidateOrders(qc)`; новые ключи добавляйте
   в `orderKeys`.
4. **Схема БД** — миграцией через Supabase; после DDL проверяйте `get_advisors`.
   Помните про RLS (см. §6) — новая колонка не должна открывать данные клиенту.
5. **Общие модули (§4)** меняйте осознанно — фан-ин большой.
6. **Без эмодзи** в UI (решение по проекту). Функциональные глифы (× ▾ ⌕ ↩ ⠿ ✓)
   допустимы.
7. **Мобильный-first**: проверяйте на узком экране, избегайте горизонтального
   переполнения (`minmax(0,1fr)`, `overflow-x:auto` для широких блоков).
8. Коммиты — в ветку `main` (автодеплой). Перед пушем: `npm run build` без ошибок
   (строгий TS: `noUnusedLocals`/`noUnusedParameters`).

---

## 8. Статус рефакторинга (P-план)

- ✅ **P1** — монолиты разбиты: `CabinetPage` (→ `cabinet/`), `LandingPage`
  (→ `landing/`), `BoardTab` (→ `crm/board/`).
- ✅ **P2** — единый домен заказов `src/data/orders.ts` (`ORDER_COLS`, `TASK_COLS`,
  `PRIORITY`, `ORDER_STATUS_MAP`).
- ✅ **P3** — `orderKeys` + `invalidateOrders(qc)`.
- ✅ **P4** — этот документ.

### Известные долги (не блокеры)
- `contacts.count:'exact'` и `companies select('*')` без пагинации — оптимизировать
  при росте.
- Заказы контакта матчатся по строковому `client_name`/`client_phone` (нет FK) —
  хрупко.
- Тёмная тема в кабинете почти не действует (цвета захардкожены, не через CSS-переменные).
- `LocationsTab` пересоздаёт Leaflet-карту на каждое изменение — можно сделать
  инкрементально.
