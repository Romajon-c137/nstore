# -*- coding: utf-8 -*-
import requests, json, os
from datetime import datetime as dt

ONEC_URL = "http://localhost:6004/api/execute_query"
SUPA_URL = os.environ.get('SUPABASE_URL')
SUPA_KEY = os.environ.get('SUPABASE_ANON_KEY')
if not SUPA_URL or not SUPA_KEY:
    raise RuntimeError(
        "Переменные окружения SUPABASE_URL и SUPABASE_ANON_KEY должны быть заданы "
        "(например, через export или .env-файл) — встроенных значений по умолчанию больше нет."
    )
BATCH = 200
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sync_state_ascii.json")
DEACTIVATE_THRESHOLD = 0.80

def load_state():
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_state(data):
    with open(STATE_FILE, "w") as f:
        json.dump(data, f)

def fetch_active_skus():
    skus = set()
    offset = 0
    limit = 1000
    while True:
        r = requests.get(
            SUPA_URL + "/rest/v1/products",
            headers={"apikey": SUPA_KEY, "Authorization": "Bearer " + SUPA_KEY},
            params={"select": "sku", "is_active": "eq.true", "limit": limit, "offset": offset},
            timeout=30)
        rows = r.json() if r.status_code == 200 else []
        if not rows:
            break
        for row in rows:
            if row.get("sku"):
                skus.add(row["sku"])
        if len(rows) < limit:
            break
        offset += limit
    return skus

def deactivate_missing(current_skus):
    print("  Проверяю активные товары в Supabase...")
    active_in_db = fetch_active_skus()
    to_deactivate = active_in_db - current_skus
    if not to_deactivate:
        print("  Деактивация: нет товаров для снятия.")
        return 0
    print(f"  Товаров к деактивации: {len(to_deactivate)}")
    count = 0
    deact_list = list(to_deactivate)
    for i in range(0, len(deact_list), BATCH):
        chunk = deact_list[i:i+BATCH]
        r = requests.patch(
            SUPA_URL + "/rest/v1/products",
            headers={"apikey": SUPA_KEY, "Authorization": "Bearer " + SUPA_KEY,
                     "Content-Type": "application/json", "Prefer": "return=minimal"},
            params={"sku": "in.(" + ",".join(chunk) + ")"},
            json={"is_active": False, "updated_at": dt.utcnow().isoformat()+"Z"},
            timeout=30)
        ok = r.status_code in (200, 201, 204)
        count += len(chunk)
        print(f"  {'OK' if ok else 'FAIL'} — деактивировано {len(chunk)} (итого: {count})")
    return count

def onec(query):
    r = requests.post(ONEC_URL, json={"query": query},
                      headers={"Content-Type": "application/json; charset=utf-8"}, timeout=60)
    d = r.json()
    if not d.get("success"):
        raise RuntimeError(d.get("error"))
    raw = d["data"]
    return raw if isinstance(raw, list) else []

def supa_upsert(table, rows, on_conflict):
    r = requests.post(
        SUPA_URL + "/rest/v1/" + table,
        headers={"apikey": SUPA_KEY, "Authorization": "Bearer " + SUPA_KEY,
                 "Content-Type": "application/json",
                 "Prefer": "resolution=merge-duplicates,return=minimal"},
        params={"on_conflict": on_conflict},
        json=rows, timeout=30)
    if r.status_code not in (200, 201):
        print("  Supabase error:", r.status_code, r.text[:200])
        return False
    return True

def sync_products():
    print("\n[1] Синхронизация товаров...")
    all_rows = []
    after_code = None
    page = 1
    while True:
        cond = "НЕ Ном.ЭтоГруппа И НЕ Ном.ПометкаУдаления"
        if after_code:
            cond += ' И Ном.Код > "' + after_code + '"'
        q = ("ВЫБРАТЬ ПЕРВЫЕ 100\n"
             "    Ном.Код КАК kod, Ном.Наименование КАК name,\n"
             "    Ном.Артикул КАК sku, Ном.Родитель.Наименование КАК section_name\n"
             "ИЗ Справочник.Номенклатура КАК Ном\n"
             "ГДЕ " + cond + "\nУПОРЯДОЧИТЬ ПО Ном.Код")
        rows = onec(q)
        if not rows:
            break
        all_rows.extend(rows)
        print(f"  Страница {page}: {len(rows)} товаров (итого: {len(all_rows)})")
        if len(rows) < 100:
            break
        after_code = rows[-1]["kod"].strip()
        page += 1

    seen = {}
    skipped_no_sku = 0
    for r in all_rows:
        sku = (r.get("sku") or "").strip()
        if sku:
            seen[sku] = r
        else:
            skipped_no_sku += 1
    unique = list(seen.values())
    print(f"  Уникальных SKU: {len(unique)} (дублей: {len(all_rows)-len(unique)}, без артикула: {skipped_no_sku})")

    total = 0
    for i in range(0, len(unique), BATCH):
        chunk = unique[i:i+BATCH]
        payload = [{"sku": r["sku"].strip(), "name": r["name"].strip(),
                    "section_name": (r.get("section_name") or "").strip() or None,
                    "is_active": True, "updated_at": dt.utcnow().isoformat()+"Z"}
                   for r in chunk if r.get("sku","").strip() and r.get("name","").strip()]
        if payload:
            ok = supa_upsert("products", payload, "sku")
            total += len(payload)
            print(f"  {'OK' if ok else 'FAIL'} — {len(payload)} шт (итого: {total})")
    print(f"  Пропущено (нет артикула): {skipped_no_sku} товаров")
    return seen, total

def sync_prices(sku_map):
    print("\n[2] Синхронизация цен...")
    after_code = None
    page = 1
    updates = {}

    while True:
        cond = "Цены.Цена > 0"
        if after_code:
            cond += ' И Цены.Номенклатура.Код > "' + after_code + '"'
        q = ("ВЫБРАТЬ ПЕРВЫЕ 100\n"
             "    Цены.Номенклатура.Код КАК kod,\n"
             "    Цены.Номенклатура.Артикул КАК sku,\n"
             "    Цены.ВидЦен.Наименование КАК price_type,\n"
             "    Цены.Цена КАК price\n"
             "ИЗ РегистрСведений.ЦеныНоменклатуры КАК Цены\n"
             "ГДЕ " + cond + "\nУПОРЯДОЧИТЬ ПО Цены.Номенклатура.Код")
        rows = onec(q)
        if not rows:
            break
        for row in rows:
            sku = (row.get("sku") or "").strip()
            ptype = (row.get("price_type") or "").strip()
            price = row.get("price")
            if not sku:
                continue
            if sku not in updates:
                updates[sku] = {}
            if "Розница (офис, сайт)" in ptype:
                updates[sku]["price"] = price
            elif "Традиционная розница" in ptype or "ТП" in ptype:
                updates[sku]["price_tp"] = price
        print(f"  Страница {page}: {len(rows)} записей")
        if len(rows) < 100:
            break
        after_code = rows[-1]["kod"].strip()
        page += 1

    payload = []
    for sku, prices in updates.items():
        if not prices:
            continue
        row = {"sku": sku, "updated_at": dt.utcnow().isoformat()+"Z"}
        if "price" in prices:
            row["price"] = prices["price"]
        if "price_tp" in prices:
            row["price_tp"] = prices["price_tp"]
        payload.append(row)

    total = 0
    for i in range(0, len(payload), BATCH):
        chunk = payload[i:i+BATCH]
        ok = supa_upsert("products", chunk, "sku")
        total += len(chunk)
        print(f"  {'OK' if ok else 'FAIL'} — цены для {len(chunk)} товаров (итого: {total})")
    print(f"  Цены обновлены: {total} товаров")

def sync_stock():
    """Шаг 3: синхронизация физических остатков из РегистрНакопления.ЗапасыНаСкладах.

    Четыре уровня защиты:
      1. Пустой ответ 1С → пропуск, лог.
      2. Порог 50%: если SKU-с-остатком упало более чем вдвое → пропуск (неполный ответ).
      3. Обновляем только SKU, присутствующие в ответе; отсутствующие не трогаем.
      4. reserved_qty никогда не затрагивается.

    Суммирует по SKU при нескольких складах одной номенклатуры.
    Возвращает кол-во SKU с остатком > 0 (для записи в state), или None при пропуске.
    """
    print("\n[3] Синхронизация остатков (ЗапасыНаСкладах)...")
    after_code = None
    page = 1
    raw_rows = []

    while True:
        cond = "Остатки.КоличествоОстаток > 0"
        if after_code:
            cond += ' И Остатки.Номенклатура.Код > "' + after_code + '"'
        q = (
            "ВЫБРАТЬ ПЕРВЫЕ 100\n"
            "    Остатки.Номенклатура.Код     КАК kod,\n"
            "    Остатки.Номенклатура.Артикул КАК sku,\n"
            "    Остатки.КоличествоОстаток    КАК stock\n"
            "ИЗ РегистрНакопления.ЗапасыНаСкладах.Остатки() КАК Остатки\n"
            "ГДЕ " + cond + "\n"
            "УПОРЯДОЧИТЬ ПО Остатки.Номенклатура.Код"
        )
        rows = onec(q)
        if not rows:
            break
        raw_rows.extend(rows)
        print(f"  Страница {page}: {len(rows)} строк (итого: {len(raw_rows)})")
        if len(rows) < 100:
            break
        after_code = rows[-1]["kod"].strip()
        page += 1

    # Уровень 1: пустой ответ
    if not raw_rows:
        print("  ⚠ ПРЕДУПРЕЖДЕНИЕ: 1С вернул 0 строк — остатки не обновляются.")
        return None

    # Суммирование по SKU (несколько складов → одна запись)
    totals = {}
    for r in raw_rows:
        sku = (r.get("sku") or "").strip()
        if not sku:
            continue
        raw_qty = r.get("stock")
        try:
            # 1С в русской локали использует запятую как десятичный разделитель
            qty = float(str(raw_qty).replace(",", ".")) if raw_qty is not None else 0.0
        except (ValueError, TypeError):
            qty = 0.0
        totals[sku] = totals.get(sku, 0.0) + qty

    nonzero_count = sum(1 for v in totals.values() if v > 0)

    # Уровень 2: порог 50% по SKU с остатком > 0
    state = load_state()
    last_nonzero = state.get("last_stock_nonzero_count", 0)
    print(f"  SKU с остатком > 0: {nonzero_count} (прошлый прогон: {last_nonzero})")
    if last_nonzero > 0 and nonzero_count < last_nonzero * 0.5:
        print(
            f"  ⚠ ПРЕДУПРЕЖДЕНИЕ: {nonzero_count} < 50% от {last_nonzero} — "
            f"возможен неполный ответ 1С. Остатки не обновляются."
        )
        return None

    # Уровень 3: только присутствующие в ответе SKU.
    # Уровень 4: reserved_qty не входит в payload — никогда не перезаписывается.
    payload = [
        {"sku": sku, "stock": int(qty), "updated_at": dt.utcnow().isoformat() + "Z"}
        for sku, qty in totals.items()
    ]

    total_updated = 0
    for i in range(0, len(payload), BATCH):
        chunk = payload[i:i + BATCH]
        ok = supa_upsert("products", chunk, "sku")
        total_updated += len(chunk)
        print(f"  {'OK' if ok else 'FAIL'} — остатки для {len(chunk)} SKU (итого: {total_updated})")

    print(f"  Остатки синхронизированы: {total_updated} SKU")
    return nonzero_count


def sync():
    print(f"=== 1C -> Supabase sync {dt.now().strftime('%H:%M:%S')} ===")
    sku_map, synced_count = sync_products()
    sync_prices(sku_map)

    stock_nonzero = sync_stock()

    state = load_state()
    last_count = state.get("last_count", 0)
    print(f"\n[Деактивация] Текущий прогон: {synced_count} SKU, предыдущий успешный: {last_count}")
    if last_count > 0 and synced_count < last_count * DEACTIVATE_THRESHOLD:
        print(f"  ⚠ ПРЕДУПРЕЖДЕНИЕ: {synced_count} < {int(last_count * DEACTIVATE_THRESHOLD)} (80% от {last_count}). "
              f"Деактивация пропущена — возможен сбой или неполный ответ 1С.")
    else:
        deactivated = deactivate_missing(set(sku_map.keys()))
        print(f"  Деактивировано: {deactivated} товаров")

    # Мёрджим с текущим state, чтобы не затереть last_stock_nonzero_count
    state.update({"last_count": synced_count, "last_run": dt.utcnow().isoformat() + "Z"})
    if stock_nonzero is not None:
        state["last_stock_nonzero_count"] = stock_nonzero
        state["last_stock_run"] = dt.utcnow().isoformat() + "Z"
    save_state(state)
    print(f"\n=== Готово! {dt.now().strftime('%H:%M:%S')} ===")

if __name__ == "__main__":
    sync()
