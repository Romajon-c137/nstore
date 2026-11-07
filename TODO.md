# TODO по итогам полного code review

Проверено 2026-11-02 на `main`, commit `99851a0`. В ревью вошли Next.js/FSD,
Django/DRF, Supabase SQL и Edge Functions, интеграции 1С/CRM/Kaspi, зависимости,
сборка и тесты.

## P0 — исправить до production-релиза

- [ ] Сделать приём платежа Kaspi одной транзакцией в БД.
  Сейчас Edge Function сначала вставляет `kaspi_payments`, потом отдельным запросом
  обновляет `crm_tasks.is_paid` и игнорирует ошибку UPDATE
  (`supabase/functions/kaspi-payment/index.ts:271-321`). В результате функция может
  вернуть успех, хотя заказ остался неоплаченным. Два параллельных платежа с разными
  `txn_id` для одного заказа также оба пройдут проверку `is_paid = false` и будут
  приняты. Перенести проверку заказа, сравнение суммы, INSERT платежа и UPDATE заказа
  в одну `SECURITY DEFINER` RPC-транзакцию с блокировкой заказа; добавить уникальность
  успешного платежа по `order_id`; обязательно проверять результат каждого запроса.
  Добавить конкурентный интеграционный тест для одинаковых и разных `txn_id`.

- [ ] Закрыть возможность подмены IP в авторизации Kaspi webhook.
  `getClientIp()` доверяет первому адресу из `x-forwarded-for`, а доступ разрешается
  по условию `IP allowlist OR shared secret`
  (`supabase/functions/kaspi-payment/index.ts:94-107,146-170`). Проверить контракт
  Supabase Edge по trusted proxy; брать только гарантированно выставленный платформой
  адрес. Предпочтительно требовать одновременно корректный provider secret/signature
  и доверенный адрес. Не передавать секрет в query string, если протокол позволяет.
  Добавить тесты spoofed/multiple `x-forwarded-for`.

- [ ] Устранить известные уязвимости production-зависимостей.
  `npm audit --omit=dev` на текущем lock-файле: critical в `dompurify` (DOM XSS),
  high в `xlsx` (prototype pollution и ReDoS), high в `source-map-js`, два moderate.
  Обновить `dompurify` до исправленной версии и lock-файл. Для `xlsx`, у которого
  npm не предлагает исправление, перейти на поддерживаемый пакет/актуальную сборку
  SheetJS и ограничить размер/сложность импортируемых файлов
  (`src/views/crm/tabs/BatchesView.tsx:240-244,618`). После замены прогнать импорт
  недоверенного XLS/XLSX и `npm audit --omit=dev` без high/critical.

## P1 — надёжность, безопасность и воспроизводимость

- [ ] Исправить конкурентную обработку Django outbox.
  `deliver_pending_outbox()` снимает `select_for_update(skip_locked)` до того, как
  события помечены занятыми, а `process_event()` повторно обрабатывает любой статус,
  кроме `delivered` (`backend/apps/integrations/tasks.py:52-65,113-125`). Два worker-а
  могут отправить один заказ в CRM одновременно. Атомарно claim-ить выбранные строки
  (status/lock token) до COMMIT и разрешать обработку только владельцу claim; сохранить
  `Idempotency-Key` как второй рубеж. Добавить PostgreSQL-тест с двумя соединениями.

- [ ] Сделать Supabase-регистрацию и применение invite атомарными.
  Клиент отдельно читает invite, создаёт/перезаписывает профиль и затем помечает invite
  использованным, причём ошибка последнего UPDATE игнорируется
  (`src/views/register/ui/RegisterPage.tsx:110-125,169-214`). Два пользователя могут
  одновременно применить один token, а частичный сбой оставляет несогласованные
  company/profile/location. Перенести consume invite и создание связанных записей в
  транзакционную RPC, заблокировать invite, проверить срок/used внутри транзакции и
  возвращать единый результат. Для обычной регистрации также предусмотреть cleanup
  или серверную транзакцию при частичном сбое.

- [ ] Завершить и версионировать воспроизводимую схему Supabase.
  `supabase/migrations/README.md` прямо указывает, что полного bootstrap и production
  migration history нет; в `supabase/migrations/` находится только один incremental
  patch, а десятки корневых `supabase_migration_*.sql` не имеют гарантированного порядка.
  Из-за этого нельзя с нуля восстановить БД или доказательно проверить итоговые RLS,
  grants, owners и triggers. Снять baseline со staging, перенести последующие изменения
  в timestamped migrations, добавить `supabase db reset`/schema diff в CI и запретить
  ручное применение legacy-файлов без reconciliation.

- [ ] Добавить CI как обязательный merge gate.
  В репозитории нет workflow. На Node 22.14+ и Python 3.13 запускать: `npm ci`,
  typecheck, architecture check, checkout/catalog tests, demo production build,
  `npm audit --omit=dev`, `ruff check`, Django tests, migrations check и
  `manage.py check --deploy` с production-подобными безопасными env. Поднять PostgreSQL
  для конкурентных и RLS-интеграционных тестов; SQLite/PGlite не заменяют их.

- [ ] Сделать production-настройки Django fail-closed.
  Сейчас defaults включают `DEBUG=True`, небезопасный `SECRET_KEY`, HTTP cookies и
  отсутствие HSTS/SSL redirect (`backend/config/settings.py:17-19,115-122`).
  `manage.py check --deploy` выдаёт 6 security warnings по этим настройкам.
  При production mode завершать запуск, если secret/hosts/secure cookies/HTTPS не
  заданы, не принимать значения `replace-me`; выполнять deploy-check в entrypoint/CI.

- [ ] Добавить идемпотентность в старый Supabase checkout.
  Текущий `place_order` RPC вызывается без idempotency key
  (`src/entities/order/api/placeOrder.ts:24-48`), поэтому повтор после сетевого таймаута
  может создать второй заказ и повторно зарезервировать остатки. Добавить ключ с
  уникальным scope в RPC/таблицу и тест повторного и конкурентного запроса. Это уже
  обозначено как незакрытая зона в `supabase/migrations/README.md`.

## P2 — качество и поддерживаемость

- [ ] Определить поведение production build без каталожных env.
  Обычный `npm run build` падает при prerender `/sitemap.xml`, если source/Supabase env
  не заданы (`src/entities/catalog/api/public-catalog.ts:48-64`, `app/sitemap.ts:8-10`),
  хотя demo-build проходит. Либо валидировать env в начале сборки с полным списком
  обязательных переменных, либо генерировать базовый sitemap без товарных URL при
  недоступном каталоге. Добавить оба сценария в CI и задокументировать решение.

- [ ] Убрать O(N) lookup карточки Django.
  `ProductLookupView` перебирает все продаваемые варианты в Python для каждого slug
  (`backend/apps/catalog/views.py:73-92`). Хранить нормализованный storefront slug в
  индексируемой колонке с уникальным/явно разрешённым collision policy. Добавить тесты
  одинаковых названий/SKU и query/performance budget.

- [ ] Дать пользователю выбор компании в Django-каталоге.
  Адаптер безусловно выбирает первую membership с `can_order`
  (`src/features/shopping/api/djangoSource.ts:55-66`), поэтому пользователь нескольких
  компаний не может выбрать другую компанию/прайс/адреса. Хранить выбранную company,
  проверять membership на сервере и включать company в query keys и checkout.

- [ ] Ограничить и валидировать публичную аналитику.
  `/api/track` принимает произвольный JSON и всегда отвечает 204, не проверяя даже
  результат Supabase INSERT (`app/api/track/route.ts:31-66`). Добавить схему, лимиты
  длины/body, rate limit/bot protection и логирование backend-ошибок без PII; хранить
  только действительно нужные referrer/visitor данные и зафиксировать retention.

- [ ] Исправить lint и OpenAPI warnings Django.
  `ruff check .` на текущем коде находит 3 несортированных import block:
  `apps/catalog/views.py`, `apps/integrations/onec_sync.py`, `tests/test_onec.py`.
  `check --deploy` также сообщает, что `ProductLookupView` не имеет описанного
  serializer-а и исключается из схемы. Исправить imports, добавить request/response
  schema через GenericAPIView или `extend_schema`; сделать warnings ошибками CI.

- [ ] Разбить самые крупные UI-модули и покрыть критические hooks тестами.
  Наиболее рискованные файлы: `ContentTab.tsx` (~1597 строк), `CabinetPage.tsx`
  (~1321), `DashTab.tsx` (~945), `Products1cTab.tsx` (~860), `RolesTab.tsx` (~797).
  Выделять data hooks, формы и представления по доменам; начать с регистраций,
  permissions, checkout/cart и финансовых расчётов. Не делать механический rewrite
  без characterization tests.

## Зафиксированные результаты проверок

- [x] Репозиторий клонирован из `https://github.com/Romajon-c137/nstore.git`;
  `main` совпадает с `origin/main` на `99851a0`.
- [x] TypeScript: `next typegen` + `tsc --noEmit` — успешно на Node 22.14.
- [x] FSD/Next architecture check — успешно.
- [x] Supabase checkout tests — 35/35; catalog tests — 3/3.
- [x] Django pytest — 22/22; migrations check и обычный system check — успешно.
- [x] Next production build в `NEXT_PUBLIC_CATALOG_SOURCE=demo` — успешно.
- [ ] Browser test не запускался: он требует отдельно запущенный `next start` и
  установленный Chrome/Edge; добавить его в будущий CI.
- [ ] Полный production build без env — падает на `/sitemap.xml` (задача выше).
- [ ] `ruff check` — 3 ошибки; `npm audit --omit=dev` — 5 уязвимостей
  (1 critical, 2 high, 2 moderate); `manage.py check --deploy` — 7 warnings,
  включая один OpenAPI warning и 6 security warnings из-за dev defaults.
