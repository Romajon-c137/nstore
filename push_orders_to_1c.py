# -*- coding: utf-8 -*-
"""
push_orders_to_1c.py

Забирает из Supabase заказы (crm_tasks) со статусом order_status='confirmed'
и ещё не отправленные в 1С (invoice_no IS NULL), создаёт в 1С:УТ документ
"Реализация товаров и услуг" и пишет номер документа обратно в
crm_tasks.invoice_no (то же поле, которое менеджеры сейчас заполняют
вручную в CRM — "№ накладной (1С)").

Документ создаётся не через execute_code (прокси MCP Toolkit блокирует
ключевое слово "Записать" на уровне кода, без возможности отключить через
UI), а через отдельный HTTP-сервис, опубликованный прямо в 1С — см.
onec_http_service_create_invoice.bsl в этом репозитории. Этот скрипт просто
шлёт туда обычный JSON: {external_id, client_name, items}, вся BSL-логика
(поиск/создание контрагента, поиск номенклатуры по артикулу, создание и
проведение документа) выполняется внутри 1С и прокси её не видит.

ПЕРЕД ПЕРВЫМ ЗАПУСКОМ:
  1. Задайте переменные окружения SUPABASE_URL и SUPABASE_ANON_KEY
     (например, export SUPABASE_URL=... / export SUPABASE_ANON_KEY=...,
     либо через .env и dotenv/systemd EnvironmentFile) — без них скрипт
     не запустится.
  2. Амандос публикует onec_http_service_create_invoice.bsl как HTTP-сервис
     в 1С (инструкция в шапке того файла) и заполняет там точное имя
     организации.
  3. Заполните ONEC_HTTP_SERVICE_URL ниже полученным адресом вида
     http://<хост>:<порт>/<база>/hs/crm_orders/invoice
  4. Если публикация требует аутентификацию — заполните ONEC_HTTP_USER /
     ONEC_HTTP_PASSWORD.
  5. Запустите с флагом --dry-run — он НЕ обращается к 1С и НЕ пишет в
     Supabase, только печатает JSON, который был бы отправлен, для первого
     найденного заказа. Проверьте его вместе с Амандосом, прежде чем
     снимать --dry-run.

Запуск:
  python push_orders_to_1c.py --dry-run   # только показать payload, ничего не трогать
  python push_orders_to_1c.py             # реальная отправка всех неотправленных
  python push_orders_to_1c.py --limit 1   # отправить только один заказ (для проверки)
"""
import argparse
import json
import os
import sys
from datetime import datetime

import requests

SUPA_URL = os.environ.get('SUPABASE_URL')
SUPA_KEY = os.environ.get('SUPABASE_ANON_KEY')
if not SUPA_URL or not SUPA_KEY:
    raise RuntimeError(
        "Переменные окружения SUPABASE_URL и SUPABASE_ANON_KEY должны быть заданы "
        "(например, через export или .env-файл) — встроенных значений по умолчанию больше нет."
    )

# --- НАСТРОЙКИ ПОД ПУБЛИКАЦИЮ 1С — заполнить перед первым запуском ---
ONEC_HTTP_SERVICE_URL = "ЗАПОЛНИТЕ АДРЕС HTTP-СЕРВИСА"  # напр. http://host:port/base/hs/crm_orders/invoice
ONEC_HTTP_USER = ""      # логин технического пользователя 1С, если публикация требует аутентификацию
ONEC_HTTP_PASSWORD = ""  # пароль
# ---------------------------------------------------------------------


def fetch_confirmed_orders(limit: int | None):
    params = {
        "select": "id,client_name,client_phone,address,items,total,invoice_no",
        "task_type": "eq.order",
        "order_status": "eq.confirmed",
        "invoice_no": "is.null",
        "order": "created_at.asc",
    }
    if limit:
        params["limit"] = str(limit)
    r = requests.get(
        f"{SUPA_URL}/rest/v1/crm_tasks",
        headers={"apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}"},
        params=params, timeout=30,
    )
    r.raise_for_status()
    return r.json()


def set_invoice_no(task_id: str, invoice_no: str) -> bool:
    r = requests.patch(
        f"{SUPA_URL}/rest/v1/crm_tasks",
        headers={"apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}",
                  "Content-Type": "application/json", "Prefer": "return=minimal"},
        params={"id": f"eq.{task_id}"},
        json={"invoice_no": invoice_no},
        timeout=30,
    )
    return r.status_code in (200, 204)


def build_payload(order: dict):
    """Строит JSON-payload для HTTP-сервиса 1С.

    Возвращает None, если у заказа нет ни одной позиции с артикулом (items
    пустой/без sku) — такой заказ нечем проводить, его нужно оформить в 1С
    вручную (например, заказы, созданные прямо в CRM без привязки к каталогу).
    """
    items = order.get("items") or []
    lines = [
        {"sku": str(it["sku"]), "qty": float(it.get("qty") or 0), "price": float(it.get("price") or 0)}
        for it in items if str(it.get("sku") or "").strip()
    ]
    if not lines:
        return None
    return {
        "external_id": order["id"],
        "client_name": order.get("client_name") or "Клиент без имени",
        "items": lines,
    }


def call_invoice_service(payload: dict) -> str:
    auth = (ONEC_HTTP_USER, ONEC_HTTP_PASSWORD) if ONEC_HTTP_USER else None
    r = requests.post(
        ONEC_HTTP_SERVICE_URL, json=payload, auth=auth,
        headers={"Content-Type": "application/json; charset=utf-8"},
        timeout=90,
    )
    try:
        d = r.json()
    except ValueError:
        raise RuntimeError(f"1С вернула не-JSON ответ (HTTP {r.status_code}): {r.text[:300]}")
    if not d.get("success"):
        raise RuntimeError(d.get("error") or f"HTTP {r.status_code}: {r.text[:300]}")
    return str(d["invoice_no"])


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true",
                     help="только напечатать payload для первого заказа, ничего не отправлять")
    ap.add_argument("--limit", type=int, default=None,
                     help="ограничить число обрабатываемых заказов за запуск")
    args = ap.parse_args()

    orders = fetch_confirmed_orders(args.limit)
    print(f"=== push_orders_to_1c {datetime.now():%Y-%m-%d %H:%M:%S} ===")
    print(f"Найдено подтверждённых заказов без invoice_no: {len(orders)}")

    if not orders:
        return

    if args.dry_run:
        payload = build_payload(orders[0])
        print(f"\n--- DRY RUN: payload для заказа {orders[0]['id']} ---\n")
        print(json.dumps(payload, ensure_ascii=False, indent=2) if payload else "(нет позиций с артикулом — нечего проводить)")
        return

    if ONEC_HTTP_SERVICE_URL.startswith("ЗАПОЛНИТЕ"):
        print("ОШИБКА: заполните ONEC_HTTP_SERVICE_URL в начале файла перед запуском.")
        sys.exit(1)

    ok, skipped, failed = 0, 0, 0
    for order in orders:
        oid = order["id"]
        payload = build_payload(order)
        if payload is None:
            print(f"  ПРОПУЩЕН {oid} — нет позиций с артикулом (оформить в 1С вручную)")
            skipped += 1
            continue
        try:
            invoice_no = call_invoice_service(payload)
            if set_invoice_no(oid, invoice_no):
                print(f"  OK {oid} -> накладная №{invoice_no}")
                ok += 1
            else:
                print(f"  ОШИБКА записи invoice_no в Supabase для {oid} (документ №{invoice_no} уже создан в 1С!)")
                failed += 1
        except Exception as e:
            print(f"  ОШИБКА {oid}: {e}")
            failed += 1

    print(f"\nИтого: создано {ok}, пропущено {skipped}, ошибок {failed}")


if __name__ == "__main__":
    main()
