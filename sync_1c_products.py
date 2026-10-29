import re, requests, json, os, sys, base64
from datetime import datetime

ONEC_URL  = os.environ.get("ONEC_URL") or "http://localhost:6004/api/execute_query"
SUPA_URL  = os.environ.get('SUPABASE_URL')

# ── Ключ Supabase ─────────────────────────────────────────────────────────────
# ВАЖНО: запись в products защищена RLS (нужен rbac_access('kaspi')='full').
# Анонимный ключ этих прав НЕ имеет — под ним upsert/update/деактивация молча
# затрагивают 0 строк, а PostgREST отвечает 204 OK. Нужен service_role (обходит
# RLS). service_role — СЕКРЕТ, только на сервере; задаётся переменной окружения.
SUPA_KEY  = (os.environ.get('SUPABASE_SERVICE_KEY')
             or os.environ.get('SUPABASE_KEY')
             or os.environ.get('SUPABASE_ANON_KEY'))

if not SUPA_URL or not SUPA_KEY:
    raise RuntimeError(
        "Переменные окружения SUPABASE_URL и SUPABASE_SERVICE_KEY (или SUPABASE_KEY / "
        "SUPABASE_ANON_KEY) должны быть заданы (например, через export или .env-файл) — "
        "встроенных значений по умолчанию больше нет."
    )

BATCH     = 200
STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sync_state_1c_products.json")
DEACTIVATE_THRESHOLD = 0.80


def key_role(jwt):
    """Роль из JWT Supabase (anon / service_role) — без обращения к сети."""
    try:
        payload = jwt.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload.encode())).get("role")
    except Exception:
        return None


def require_write_access():
    """Прерывает запуск, если ключ не может писать в products. Иначе синхронизация
    лишь ИМИТИРУЕТ работу: PostgREST отвечает 204 OK при 0 изменённых строках."""
    role = key_role(SUPA_KEY)
    if role == "service_role":
        return
    print("[FATAL] Ключ Supabase с ролью '%s' не может писать в products под RLS." % role)
    print("        Все upsert/update/деактивация вернут 204 OK, но НИЧЕГО не изменят.")
    print("        Задайте service_role (Project Settings -> API -> service_role key):")
    print("            export SUPABASE_SERVICE_KEY=<service_role key>")
    sys.exit(1)

def onec(query):
    r = requests.post(ONEC_URL, json={"query": query},
                      headers={"Content-Type": "application/json; charset=utf-8"}, timeout=60)
    d = r.json()
    if not d.get("success"):
        raise RuntimeError(d.get("error"))
    raw = d["data"]
    if isinstance(raw, list):
        return raw
    # parse TOON format: [N]{col1,col2}:\n val\n val
    lines = raw.strip().split("\n")
    m = re.match(r'\[(\d+)\]\{([^}]+)\}:', lines[0])
    if not m:
        return []
    cols = [c.strip() for c in m.group(2).split(",")]
    vals = [l.strip().strip('"').replace('\\"', '"') for l in lines[1:] if l.strip()]
    rows = []
    for i in range(0, len(vals), len(cols)):
        chunk = vals[i:i+len(cols)]
        if len(chunk) == len(cols):
            rows.append(dict(zip(cols, chunk)))
    return rows

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
            f"{SUPA_URL}/rest/v1/products",
            headers={"apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}"},
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
    # Жёсткий предохранитель: за один прогон нельзя снять больше (1 - THRESHOLD)
    # активного каталога — спасает при неполном ответе 1С, даже если last_count потерян.
    max_deact = int((1 - DEACTIVATE_THRESHOLD) * len(active_in_db))
    if len(to_deactivate) > max_deact:
        print(f"  ⚠ Деактивация ОТМЕНЕНА: к снятию {len(to_deactivate)} из {len(active_in_db)} активных "
              f"(> {int((1 - DEACTIVATE_THRESHOLD) * 100)}%). Похоже на неполный ответ 1С — пропускаю.")
        return 0
    print(f"  Товаров к деактивации: {len(to_deactivate)}")
    count = 0
    for i in range(0, len(list(to_deactivate)), BATCH):
        chunk = list(to_deactivate)[i:i+BATCH]
        r = requests.patch(
            f"{SUPA_URL}/rest/v1/products",
            headers={"apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}",
                     "Content-Type": "application/json", "Prefer": "return=minimal"},
            params={"sku": "in.(" + ",".join(chunk) + ")"},
            json={"is_active": False, "updated_at": datetime.utcnow().isoformat()+"Z"},
            timeout=30)
        ok = r.status_code in (200, 201, 204)
        count += len(chunk)
        print(f"  {'OK' if ok else 'FAIL'} — деактивировано {len(chunk)} (итого: {count})")
    return count

def upsert(rows):
    r = requests.post(
        f"{SUPA_URL}/rest/v1/products",
        headers={"apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}",
                 "Content-Type": "application/json",
                 "Prefer": "resolution=merge-duplicates,return=minimal"},
        params={"on_conflict": "sku"},
        json=rows, timeout=30)
    return r.status_code in (200, 201)

def sync():
    require_write_access()
    print(f"\n=== 1C -> Supabase sync {datetime.now():%H:%M:%S} ===\n")
    # Загружаем всё за один запрос (2902 товара — приемлемо)
    q = """ВЫБРАТЬ
        Ном.Наименование              КАК name,
        Ном.Артикул                   КАК sku,
        Ном.Родитель.Наименование     КАК section_name
    ИЗ Справочник.Номенклатура КАК Ном
    ГДЕ НЕ Ном.ЭтоГруппа И НЕ Ном.ПометкаУдаления
    УПОРЯДОЧИТЬ ПО Ном.Код"""
    print("Загружаю все товары из 1С...")
    rows = onec(q)
    print(f"Получено из 1С: {len(rows)} товаров")
    if not rows:
        print("Нет данных!")
        return

    total = 0
    skipped_no_sku = 0
    current_skus = set()

    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i+BATCH]
        payload = []
        for r in chunk:
            sku = r.get("sku", "").strip()
            name = r.get("name", "").strip()
            if sku and name:
                payload.append({"sku": sku, "name": name,
                                 "section_name": r.get("section_name", "").strip() or None,
                                 "is_active": True,
                                 "updated_at": datetime.utcnow().isoformat()+"Z"})
                current_skus.add(sku)
            elif not sku:
                skipped_no_sku += 1
        if payload:
            ok = upsert(payload)
            total += len(payload)
            print(f"  {'OK' if ok else 'FAIL'} — {len(payload)} товаров (итого: {total})")

    print(f"\nСинхронизировано: {total} товаров")
    print(f"Пропущено (нет артикула): {skipped_no_sku} товаров")

    state = load_state()
    last_count = state.get("last_count", 0)
    print(f"\n[Деактивация] Текущий прогон: {total} SKU, предыдущий успешный: {last_count}")
    if total == 0:
        # Защита от сбоя связи с 1С: пустой ответ НИКОГДА не должен снимать товары.
        print("  ⚠ 1С вернул 0 товаров — деактивация пропущена (защита от сбоя связи 1С).")
    elif last_count > 0 and total < last_count * DEACTIVATE_THRESHOLD:
        print(f"  ⚠ ПРЕДУПРЕЖДЕНИЕ: {total} < {int(last_count * DEACTIVATE_THRESHOLD)} (80% от {last_count}). "
              f"Деактивация пропущена — возможен сбой или неполный ответ 1С.")
    else:
        deactivated = deactivate_missing(current_skus)
        print(f"  Деактивировано: {deactivated} товаров")

    # Состояние обновляем только при успешном прогоне: иначе last_count=0
    # отключил бы порог-защиту на следующем запуске.
    if total > 0:
        save_state({"last_count": total, "last_run": datetime.utcnow().isoformat()+"Z"})
    else:
        print("  Состояние не обновлено (total=0).")
    print(f"\nГотово! {datetime.now():%H:%M:%S}\n")

if __name__ == "__main__":
    sync()
