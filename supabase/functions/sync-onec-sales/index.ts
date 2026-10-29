// supabase/functions/sync-onec-sales/index.ts
//
// Синхронизация продаж 1С УНФ → Supabase для модуля «Аналитика продаж».
//   1С OData (только GET) ──► эта функция ──► rpc sa_sync_* ──► analytics.*
//
// Что грузится за запуск:
//   • регистр накопления «Продажи» (движения) по месяцам: текущий, прошлый и N самых
//     давно сверенных — так вся история перепроверяется по кругу (исправления задним числом,
//     перепроведение, закрытие месяца меняют себестоимость);
//   • сверка каждого месяца с оборотами регистра в 1С (Turnover) → analytics.sync_months;
//   • признак «Закрытие месяца проведено» (себестоимость окончательная);
//   • справочники: контрагенты и их группы, сотрудники, номенклатура, организации;
//   • долги покупателей: остатки регистра «РасчетыСПокупателями».
//
// Тело запроса (необязательно): { "months": ["2026-09-01", ...], "stale": 2, "dims": true }
// Секреты: ONEC_ODATA_URL, ONEC_ODATA_USER, ONEC_ODATA_PASSWORD (общие с sync-onec).
// Деплой: --no-verify-jwt (проверка заголовка x-sync-secret из staging.onec_sync_config).

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ODATA_URL    = (Deno.env.get('ONEC_ODATA_URL') ?? '').replace(/\/+$/, '')
const ODATA_USER   = Deno.env.get('ONEC_ODATA_USER') ?? ''
const ODATA_PASS   = Deno.env.get('ONEC_ODATA_PASSWORD') ?? ''

const REQUEST_TIMEOUT_MS = 90_000
const RUN_BUDGET_MS      = 125_000   // лимит edge-функции ~150 с
const CHUNK_ROWS         = 2_000
const EMPTY              = '00000000-0000-0000-0000-000000000000'

type Row = Record<string, unknown>

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function rpc<T = unknown>(fn: string, args: Row = {}): Promise<T> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`rpc ${fn}: HTTP ${r.status} ${text.slice(0, 400)}`)
  return (text ? JSON.parse(text) : null) as T
}

const auth = () => 'Basic ' + btoa(unescape(encodeURIComponent(`${ODATA_USER}:${ODATA_PASS}`)))

/** GET к OData 1С. Только чтение. */
async function odata(path: string, params: Record<string, string> = {}): Promise<Row[]> {
  const qs = Object.entries({ $format: 'json', ...params })
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
  const url = `${ODATA_URL}/${encodeURI(path)}?${qs}`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  try {
    const r = await fetch(url, { method: 'GET', headers: { Authorization: auth(), Accept: 'application/json' }, signal: ctrl.signal })
    const text = await r.text()
    if (!r.ok) {
      let msg = text.slice(0, 300)
      try { msg = JSON.parse(text)?.['odata.error']?.message?.value ?? msg } catch { /* not json */ }
      throw new Error(`1С OData ${path.split('(')[0]}: HTTP ${r.status} ${msg}`)
    }
    const d = JSON.parse(text)
    return (d.value ?? d.d?.results ?? []) as Row[]
  } finally {
    clearTimeout(t)
  }
}

const g = (v: unknown) => (typeof v === 'string' && v && v !== EMPTY ? v : null)
const n = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0)
const pad = (x: number) => String(x).padStart(2, '0')
const dt = (d: Date) => `datetime'${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}'`

const SALES_FIELDS = [
  'Recorder', 'Recorder_Type', 'LineNumber', 'Period', 'Документ', 'Документ_Type', 'Номенклатура_Key',
  'Контрагент_Key', 'Организация_Key', 'Склад_Key', 'Ответственный_Key', 'ЗаказПокупателя_Key',
  'Количество', 'Сумма', 'СуммаНДС', 'СуммаБезСкидки', 'Себестоимость', 'СебестоимостьБезНДС',
].join(',')

const shortType = (t: unknown) => String(t ?? '').replace(/^StandardODATA\./, '')

/** Движения регистра «Продажи» за [from, to). При ошибке/таймауте делит интервал пополам. */
async function loadSales(from: Date, to: Date, depth = 0): Promise<Row[]> {
  try {
    const rows = await odata('AccumulationRegister_Продажи_RecordType', {
      $filter: `Period ge ${dt(from)} and Period lt ${dt(to)} and Active eq true`,
      $select: SALES_FIELDS,
    })
    return rows.map(r => ({
      recorder: r['Recorder'], recorder_type: shortType(r['Recorder_Type']), line_no: Number(r['LineNumber']),
      period: String(r['Period']), doc_ref: g(r['Документ']), doc_type: shortType(r['Документ_Type']) || null,
      product_ref: g(r['Номенклатура_Key']), counterparty_ref: g(r['Контрагент_Key']),
      org_ref: g(r['Организация_Key']), warehouse_ref: g(r['Склад_Key']),
      responsible_ref: g(r['Ответственный_Key']), order_ref: g(r['ЗаказПокупателя_Key']),
      qty: n(r['Количество']), amount: n(r['Сумма']), vat: n(r['СуммаНДС']), amount_nodisc: n(r['СуммаБезСкидки']),
      cost: n(r['Себестоимость']), cost_novat: n(r['СебестоимостьБезНДС']),
    }))
  } catch (e) {
    const span = to.getTime() - from.getTime()
    if (depth >= 4 || span <= 86_400_000) throw e
    const mid = new Date(from.getTime() + Math.floor(span / 2 / 86_400_000) * 86_400_000)
    return [...await loadSales(from, mid, depth + 1), ...await loadSales(mid, to, depth + 1)]
  }
}

/** Контроль: обороты регистра в 1С за месяц (без детализации). */
async function turnover(from: Date, toInclusive: Date): Promise<{ amount: number; qty: number } | null> {
  try {
    const rows = await odata(
      `AccumulationRegister_Продажи/Turnovers(StartPeriod=${dt(from)},EndPeriod=${dt(toInclusive)})`,
      { $select: 'СуммаTurnover,КоличествоTurnover' })
    return rows.reduce<{ amount: number; qty: number }>(
      (a, r) => ({ amount: a.amount + n(r['СуммаTurnover']), qty: a.qty + n(r['КоличествоTurnover']) }),
      { amount: 0, qty: 0 })
  } catch {
    return null   // сверка не удалась — месяц будет помечен 'unchecked'
  }
}

async function monthClosed(from: Date, to: Date): Promise<boolean | null> {
  try {
    const rows = await odata('Document_ЗакрытиеМесяца', {
      $filter: `Date ge ${dt(from)} and Date lt ${dt(to)} and Posted eq true and DeletionMark eq false`,
      $select: 'Ref_Key', $top: '1',
    })
    return rows.length > 0
  } catch {
    return null
  }
}

async function syncMonth(run: number, monthIso: string): Promise<Row> {
  const from = new Date(monthIso + 'T00:00:00Z')
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1))
  const lastSecond = new Date(to.getTime() - 1000)
  const t0 = Date.now()
  const [rows, check, closed] = await Promise.all([loadSales(from, to), turnover(from, lastSecond), monthClosed(from, to)])
  for (let i = 0, c = 0; i < rows.length; i += CHUNK_ROWS, c++) {
    await rpc('sa_sync_load_chunk', { p_run: run, p_month: monthIso, p_chunk: c, p_rows: rows.slice(i, i + CHUNK_ROWS) })
  }
  const res = await rpc<Row>('sa_sync_month_finish', {
    p_run: run, p_month: monthIso,
    p_onec_amount: check ? Math.round(check.amount * 100) / 100 : null,
    p_onec_qty: check ? Math.round(check.qty * 1000) / 1000 : null,
    p_closed: closed,
  })
  return { ...res, fetched: rows.length, ms: Date.now() - t0 }
}

async function syncDims(): Promise<Row> {
  const [groups, cps, emps, prods, orgs, debts] = await Promise.all([
    odata('Catalog_Контрагенты', { $filter: 'IsFolder eq true', $select: 'Ref_Key,Description,Parent_Key' }),
    odata('Catalog_Контрагенты', {
      $filter: 'IsFolder eq false',
      $select: 'Ref_Key,Description,НаименованиеПолное,Parent_Key,Ответственный_Key,ИдентификационныйНомер,НомерТелефонаДляПоиска,Покупатель,DeletionMark,Недействителен,ДатаСоздания',
    }),
    odata('Catalog_Сотрудники', { $select: 'Ref_Key,Description,DeletionMark' }),
    odata('Catalog_Номенклатура', { $select: 'Ref_Key,Description,Code,Артикул,Parent_Key,IsFolder,ТипНоменклатуры,DeletionMark' }),
    odata('Catalog_Организации', { $select: 'Ref_Key,Description' }),
    odata('AccumulationRegister_РасчетыСПокупателями/Balance', { $select: 'Контрагент_Key,ТипРасчетов,СуммаBalance' }),
  ])

  const debtMap = new Map<string, { debt: number; advance: number }>()
  for (const r of debts) {
    const k = g(r['Контрагент_Key']); if (!k) continue
    const cur = debtMap.get(k) ?? { debt: 0, advance: 0 }
    const bal = n(r['СуммаBalance'])
    if (r['ТипРасчетов'] === 'Аванс') cur.advance += -bal; else cur.debt += bal
    debtMap.set(k, cur)
  }

  return await rpc<Row>('sa_sync_dims', { p: {
    groups: groups.map(r => ({ ref: r['Ref_Key'], name: r['Description'], parent_ref: g(r['Parent_Key']) })),
    counterparties: cps.map(r => ({
      ref: r['Ref_Key'], name: r['Description'], full_name: r['НаименованиеПолное'], parent_ref: g(r['Parent_Key']),
      responsible_ref: g(r['Ответственный_Key']), bin: r['ИдентификационныйНомер'] || null,
      phone: r['НомерТелефонаДляПоиска'] || null, is_buyer: r['Покупатель'] ?? null,
      deleted: r['DeletionMark'] ?? false, inactive: r['Недействителен'] ?? false,
      created_at: typeof r['ДатаСоздания'] === 'string' && !String(r['ДатаСоздания']).startsWith('0001') ? r['ДатаСоздания'] : null,
    })),
    employees: emps.map(r => ({ ref: r['Ref_Key'], name: r['Description'], deleted: r['DeletionMark'] ?? false })),
    products: prods.map(r => ({
      ref: r['Ref_Key'], name: r['Description'], code: r['Code'], article: r['Артикул'], parent_ref: g(r['Parent_Key']),
      is_folder: r['IsFolder'] ?? false, item_type: r['ТипНоменклатуры'] ?? null, deleted: r['DeletionMark'] ?? false,
    })),
    organizations: orgs.map(r => ({ ref: r['Ref_Key'], name: r['Description'] })),
    debts: [...debtMap.entries()]
      .filter(([, v]) => Math.abs(v.debt) > 0.005 || Math.abs(v.advance) > 0.005)
      .map(([k, v]) => ({ counterparty_ref: k, debt: Math.round(v.debt * 100) / 100, advance: Math.round(v.advance * 100) / 100 })),
  } })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const t0 = Date.now()

  let cfg: { sync_secret?: string }
  try { cfg = await rpc('onec_sync_get_config') } catch (e) { return json({ error: 'config: ' + (e as Error).message }, 500) }
  if (!cfg?.sync_secret || req.headers.get('x-sync-secret') !== cfg.sync_secret) return json({ error: 'forbidden' }, 403)

  const body = await req.json().catch(() => ({})) as { months?: string[]; stale?: number; dims?: boolean }
  const mode = body.months?.length ? 'manual' : 'scheduled'
  const run = await rpc<number>('sa_sync_begin', { p_mode: mode })

  if (!ODATA_URL || !ODATA_USER || !ODATA_PASS) {
    const msg = 'Не заданы секреты ONEC_ODATA_URL / ONEC_ODATA_USER / ONEC_ODATA_PASSWORD'
    await rpc('sa_sync_finish', { p_run: run, p_status: 'error', p_stats: null, p_error: msg })
    return json({ error: msg }, 500)
  }

  const stats: Row = { months: [] as Row[] }
  const errors: string[] = []
  try {
    if (body.dims !== false) {
      try { stats.dims = await syncDims() } catch (e) { errors.push('справочники: ' + (e as Error).message) }
    }
    const months: string[] = body.months?.length
      ? body.months
      : await rpc<string[]>('sa_sync_plan', { p_stale: body.stale ?? 2 })
    const skipped: string[] = []
    for (const m of months ?? []) {
      if (Date.now() - t0 > RUN_BUDGET_MS) { skipped.push(m); continue }
      try {
        ;(stats.months as Row[]).push(await syncMonth(run, m))
      } catch (e) {
        const msg = (e as Error).message
        errors.push(`${m}: ${msg}`)
        await rpc('sa_sync_month_error', { p_month: m, p_error: msg }).catch(() => {})
      }
    }
    if (skipped.length) stats.skipped = skipped
    stats.ms = Date.now() - t0
    const status = errors.length ? ((stats.months as Row[]).length ? 'partial' : 'error') : (skipped.length ? 'partial' : 'ok')
    await rpc('sa_sync_finish', { p_run: run, p_status: status, p_stats: stats, p_error: errors.join('\n') || null })
    return json({ ok: status === 'ok', status, run, stats, errors })
  } catch (e) {
    const msg = (e as Error).message
    await rpc('sa_sync_finish', { p_run: run, p_status: 'error', p_stats: { ...stats, ms: Date.now() - t0 }, p_error: msg }).catch(() => {})
    return json({ ok: false, error: msg }, 502)
  }
})
