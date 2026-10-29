# Nstore Django backend

Production-oriented modular monolith for the Nstore public shop, B2C/B2B account and a small staff admin. PostgreSQL is the source of truth for the website. 1C is read-only; every accepted order is durably recorded before CRM delivery.

## Guarantees

- An order is accepted even when requested quantity exceeds the stock or stock is zero.
- Every line stores `sufficient`, `insufficient`, `absent` or `unknown` and the quantity snapshot.
- Prices and totals are calculated on the server. Missing price remains `null`, never a fake zero.
- Order and outbox event are committed in one database transaction. CRM retries are idempotent by order UUID.
- The browser never receives 1C or CRM credentials and never calls those systems directly.

## Local start

```powershell
py -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements\dev.txt
.\.venv\Scripts\python manage.py migrate
.\.venv\Scripts\python manage.py createsuperuser
.\.venv\Scripts\python manage.py runserver
```

Local commands fall back to SQLite for a fast developer loop. CI and production run PostgreSQL. Copy `.env.example` to `.env`, replace every placeholder and run `docker compose up --build`. Apply `collectstatic` before serving a release.

## 1C import

The adapter performs GET requests only. Start safely with:

```powershell
python manage.py sync_onec --dry-run --catalog
python manage.py sync_onec --catalog
python manage.py sync_onec --prices --stock
python manage.py sync_onec --images
```

New products arrive as drafts and must be published deliberately in Django Admin. Configure an explicit price-type and warehouse allowlist before production stock/price imports.

## CRM

`CRM_MODE=disabled` is the safe default: checkout works and events remain in the durable outbox. `CRM_MODE=mock` is only for local tests. Once the real API contract is supplied, set `CRM_MODE=http`; the current generic adapter posts `/orders` with bearer auth and `Idempotency-Key` and expects an `id` in JSON. Adapt only `apps/integrations/crm.py` if the contract differs.

## API

- `GET /api/v1/catalog/products/`, `GET /api/v1/catalog/products/{slug}/`
- `GET /api/v1/catalog/categories/`
- `POST /api/v1/auth/register/`, `login/`, `logout/`, `GET me/`
- customer addresses under `/api/v1/auth/addresses/`
- `POST /api/v1/checkout/` with mandatory `Idempotency-Key`; guests also send a stable `X-Guest-Token` UUID
- authenticated order history at `/api/v1/orders/`
- OpenAPI at `/api/schema/`, Swagger at `/api/docs/`
- probes at `/api/v1/health/` and `/api/v1/ready/`

## Release checklist

Run `python manage.py check --deploy`, migrations, tests and a PostgreSQL backup. TLS must terminate before Nginx (or be added there), secrets stay only on the VPS, and CRM should first point to its sandbox. Domain switching and live CRM/1C writes are intentionally not automated here.
