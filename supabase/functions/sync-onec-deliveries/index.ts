// supabase/functions/sync-onec-deliveries/index.ts
//
// Накладные на доставку: проведённые «Расходные накладные» (операция «Продажа покупателю») со склада «Алаш»
// за окно [сегодня − 14 дн.; сегодня + 7 дн.] → delivery.invoices.
//   1С OData (только GET) ──► эта функция ──► rpc dl_sync_invoices
// Названия клиента/менеджера/товаров, адрес и телефон вычисляются в базе.
// Секреты общие с sync-onec. Деплой --no-verify-jwt (проверка x-sync-secret).

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ODATA_URL    = (Deno.env.get('ONEC_ODATA_URL') ?? '').replace(/\/+$/, '')
const ODATA_USER   = Deno.env.get('ONEC_ODATA_USER') ?? ''
const ODATA_PASS   = Deno.env.get('ONEC_ODATA_PASSWORD') ?? ''

const WAREHOUSE_ALASH = '71206517-6cee-11ee-b247-30c9abdd6710'   // Склад «Алаш»
const DAYS_BACK = 14
const DAYS_AHEAD = 7
const EMPTY = '00000000-0000-0000-0000-000000000000'

type Row = Record<string, unknown>
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

async function rpc<T = unknown>(fn: string, args: Row = {}): Promise<T> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`rpc ${fn}: HTTP ${r.status} ${t.slice(0, 300)}`)
  return (t ? JSON.parse(t) : null) as T
}

async function odata(path: string, params: Record<string, string>): Promise<Row[]> {
  const qs = Object.entries({ $format: 'json', ...params }).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
  const r = await fetch(`${ODATA_URL}/${encodeURI(path)}?${qs}`, {
    method: 'GET',
    headers: { Authorization: 'Basic ' + btoa(unescape(encodeURIComponent(`${ODATA_USER}:${ODATA_PASS}`))), Accept: 'application/json' },
  })
  const t = await r.text()
  if (!r.ok) {
    let m = t.slice(0, 300)
    try { m = JSON.parse(t)?.['odata.error']?.message?.value ?? m } catch { /* */ }
    throw new Error(`1С OData ${path}: HTTP ${r.status} ${m}`)
  }
  return (JSON.parse(t).value ?? []) as Row[]
}

const g = (v: unknown) => (typeof v === 'string' && v && v !== EMPTY ? v : null)
const n = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0)
const pad = (x: number) => String(x).padStart(2, '0')
const dt = (d: Date) => `datetime'${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T00:00:00'`
const isoDate = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

function lineOf(l: Row) {
  return { n: Number(l['LineNumber']), product_ref: g(l['Номенклатура_Key']), qty: n(l['Количество']), price: n(l['Цена']), sum: n(l['Всего'] ?? l['Сумма']) }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const t0 = Date.now()
  const cfg = await rpc<{ sync_secret?: string }>('onec_sync_get_config').catch(() => null)
  if (!cfg?.sync_secret || req.headers.get('x-sync-secret') !== cfg.sync_secret) return json({ error: 'forbidden' }, 403)

  // «Сегодня» по Астане (UTC+5)
  const now = new Date(Date.now() + 5 * 3600_000)
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const from = new Date(today.getTime() - DAYS_BACK * 864e5)
  const to = new Date(today.getTime() + (DAYS_AHEAD + 1) * 864e5)   // [from, to)

  try {
    const docs = await odata('Document_РасходнаяНакладная', {
      $filter: `Date ge ${dt(from)} and Date lt ${dt(to)} and Posted eq true and DeletionMark eq false and СтруктурнаяЕдиница_Key eq guid'${WAREHOUSE_ALASH}' and ВидОперации eq 'ПродажаПокупателю'`,
      $select: 'Ref_Key,Number,Date,СуммаДокумента,Контрагент_Key,Ответственный_Key,АдресДоставки,Телефон,ДополнительнаяИнформацияПоДоставке,Комментарий,Запасы',
    })

    // Строки: из табличной части в ответе; если 1С её не отдала — догружаем пачками
    const linesBy = new Map<string, ReturnType<typeof lineOf>[]>()
    for (const d of docs) {
      const tp = d['Запасы']
      if (Array.isArray(tp)) linesBy.set(String(d['Ref_Key']), (tp as Row[]).map(lineOf))
    }
    const missing = docs.map(d => String(d['Ref_Key'])).filter(r => !linesBy.has(r))
    for (let i = 0; i < missing.length; i += 15) {
      const part = missing.slice(i, i + 15)
      const rows = await odata('Document_РасходнаяНакладная_Запасы', {
        $filter: part.map(r => `Ref_Key eq guid'${r}'`).join(' or '),
        $select: 'Ref_Key,LineNumber,Номенклатура_Key,Количество,Цена,Сумма,Всего',
      })
      for (const l of rows) {
        const k = String(l['Ref_Key'])
        linesBy.set(k, [...(linesBy.get(k) ?? []), lineOf(l)])
      }
      for (const r of part) if (!linesBy.has(r)) linesBy.set(r, [])
    }

    const payload = docs.map(d => ({
      ref: d['Ref_Key'], number: d['Number'], doc_date: d['Date'], amount: n(d['СуммаДокумента']),
      client_ref: g(d['Контрагент_Key']), manager_ref: g(d['Ответственный_Key']),
      address: d['АдресДоставки'] ?? '', phone: d['Телефон'] ?? '',
      delivery_info: d['ДополнительнаяИнформацияПоДоставке'] ?? '', comment: d['Комментарий'] ?? '',
      lines: (linesBy.get(String(d['Ref_Key'])) ?? []).sort((a, b) => a.n - b.n),
    }))

    // Справочники для привязки водителей: физлица (поле «Водитель») и транспортные средства
    const refs: Record<string, number> = {}
    for (const [kind, cat] of [['driver', 'Catalog_ФизическиеЛица'], ['vehicle', 'Catalog_ТранспортныеСредства']] as const) {
      const rows = await odata(cat, { $filter: 'IsFolder eq false', $select: 'Ref_Key,Description,DeletionMark' })
        .catch(() => odata(cat, { $select: 'Ref_Key,Description,DeletionMark' }))
      refs[kind] = await rpc<number>('dl_sync_refs', { p_kind: kind, p_rows: rows.map(r => ({ ref: r['Ref_Key'], name: r['Description'], deleted: r['DeletionMark'] === true })) })
    }

    const res = await rpc<Row>('dl_sync_invoices', { p_from: isoDate(from), p_to: isoDate(new Date(to.getTime() - 864e5)), p_rows: payload })
    const stats = { ...res, refs, fetched: docs.length, lines_inline: docs.length - missing.length, ms: Date.now() - t0 }
    await rpc('dl_log_run', { p_kind: 'invoices', p_status: 'ok', p_stats: stats, p_error: null })
    return json({ ok: true, stats })
  } catch (e) {
    const msg = (e as Error).message
    await rpc('dl_log_run', { p_kind: 'invoices', p_status: 'error', p_stats: { ms: Date.now() - t0 }, p_error: msg }).catch(() => {})
    return json({ ok: false, error: msg }, 502)
  }
})
