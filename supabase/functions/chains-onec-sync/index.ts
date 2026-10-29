// supabase/functions/chains-onec-sync/index.ts
//
// Сети клиентов ↔ 1С (доп. реквизит контрагента «Сеть», тип «Дополнительное значение»).
//   1) CRM → 1С: analytics.chain_members (onec_pending) → POST {1С}/hs/nstore_delivery/chain
//   2) 1С → CRM: OData — у кого «Сеть» заполнена в 1С → rpc ch_apply_onec (поставили/сменили/очистили вручную)
//   3) CRM → 1С: контакты контрагентов (ct_push_queue) → POST /contact; правки наименования/телефона
//      (cpe_push_queue) → POST /counterparty. Нет шаблона в расширении (404) — пропуск без ошибки.
// Запуск: pg_cron каждые 10 минут (delivery.trigger('chains-onec-sync')). Деплой --no-verify-jwt.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ODATA_URL    = (Deno.env.get('ONEC_ODATA_URL') ?? '').replace(/\/+$/, '')
const HS_BASE      = Deno.env.get('ONEC_DELIVERY_HS_BASE') ?? ODATA_URL.replace(/\/odata\/standard\.odata$/i, '') + '/hs/nstore_delivery'
const USER         = Deno.env.get('ONEC_ODATA_USER') ?? ''
const PASS         = Deno.env.get('ONEC_ODATA_PASSWORD') ?? ''
const AUTH = 'Basic ' + btoa(unescape(encodeURIComponent(`${USER}:${PASS}`)))
const PROPERTY_NAME = 'Сеть'

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
  const r = await fetch(`${ODATA_URL}/${encodeURI(path)}?${qs}`, { headers: { Authorization: AUTH, Accept: 'application/json' } })
  const t = await r.text()
  if (!r.ok) {
    let m = t.slice(0, 200)
    try { m = JSON.parse(t)?.['odata.error']?.message?.value ?? m } catch { /* */ }
    throw new Error(`OData ${path}: HTTP ${r.status} ${m}`)
  }
  return (JSON.parse(t).value ?? []) as Row[]
}

const EMPTY = '00000000-0000-0000-0000-000000000000'

/** Ключ реквизита «Сеть» и его значения (ref → наименование). */
async function chainProperty(): Promise<{ key: string; values: Map<string, string> } | null> {
  let keys: string[] = []
  try {
    const props = await odata('ChartOfCharacteristicTypes_ДополнительныеРеквизитыИСведения', {
      $filter: `DeletionMark eq false and (Заголовок eq '${PROPERTY_NAME}' or Description eq '${PROPERTY_NAME}')`,
      $select: 'Ref_Key,Description,Заголовок',
    })
    keys = props.map(p => String(p['Ref_Key']))
  } catch { /* ПВХ не опубликован в OData — определим по значениям */ }

  const vals = await odata('Catalog_ЗначенияСвойствОбъектов', { $filter: 'DeletionMark eq false', $select: 'Ref_Key,Owner_Key,Description' })
  if (!keys.length) {
    // реквизит, у которого больше всего значений с названиями сетей CRM
    const chains = new Set((await rpc<{ name: string }[]>('ch_chain_names')).map(c => c.name.toLowerCase()))
    const score = new Map<string, number>()
    for (const v of vals) if (chains.has(String(v['Description']).trim().toLowerCase())) score.set(String(v['Owner_Key']), (score.get(String(v['Owner_Key'])) ?? 0) + 1)
    const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0]
    if (best) keys = [best[0]]
  }
  if (!keys.length) return null
  const key = keys[0]
  const values = new Map<string, string>()
  for (const v of vals) if (String(v['Owner_Key']) === key) values.set(String(v['Ref_Key']), String(v['Description']).trim())
  return { key, values }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const t0 = Date.now()
  const cfg = await rpc<{ sync_secret?: string }>('onec_sync_get_config').catch(() => null)
  if (!cfg?.sync_secret || req.headers.get('x-sync-secret') !== cfg.sync_secret) return json({ error: 'forbidden' }, 403)

  const stats: Row = {}
  const errors: string[] = []

  // 1) CRM → 1С
  try {
    const queue = await rpc<{ ref: string; chain: string }[]>('ch_push_queue', { p_limit: 200 })
    stats.queue = queue.length
    if (queue.length) {
      const r = await fetch(`${HS_BASE}/chain`, {
        method: 'POST',
        headers: { Authorization: AUTH, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ items: queue }),
      })
      const t = await r.text()
      if (r.status === 404 && !t.includes('"ok"')) {
        stats.push = 'skipped: в 1С нет шаблона /chain (модуль расширения не обновлён)'
      } else {
        let res: Row = {}
        try { res = JSON.parse(t) } catch { /* */ }
        if (res.ok !== true) throw new Error(String(res.error ?? `HTTP ${r.status} ${t.slice(0, 200)}`))
        const results = (res.results ?? []) as Row[]
        await rpc('ch_push_done', { p_rows: results })
        stats.pushed_ok = results.filter(x => x.ok === true).length
        stats.pushed_err = results.filter(x => x.ok !== true).length
        if (stats.pushed_err) errors.push(String(results.find(x => x.ok !== true)?.error ?? ''))
      }
    }
  } catch (e) {
    errors.push('push: ' + (e as Error).message)
  }

  // 2) 1С → CRM
  try {
    const prop = await chainProperty()
    if (!prop) {
      stats.read = 'skipped: реквизит «Сеть» не найден'
    } else {
      const rows = await odata('Catalog_Контрагенты_ДополнительныеРеквизиты', {
        $filter: `Свойство_Key eq guid'${prop.key}'`,
        $select: 'Ref_Key,Значение,Значение_Type',
      })
      const items = rows
        .map(r => ({ ref: String(r['Ref_Key']), chain: prop.values.get(String(r['Значение'])) ?? (typeof r['Значение'] === 'string' && r['Значение'] !== EMPTY && !String(r['Значение_Type'] ?? '').includes('Catalog') ? String(r['Значение']) : '') }))
        .filter(x => x.chain)
      stats.read = items.length
      stats.apply = await rpc('ch_apply_onec', { p_rows: items })
    }
  } catch (e) {
    errors.push('read: ' + (e as Error).message)
  }

  // 3) Контакты и правки контрагентов
  for (const [key, queueFn, doneFn, path] of [
    ['contacts', 'ct_push_queue', 'ct_push_done', 'contact'],
    ['counterparties', 'cpe_push_queue', 'cpe_push_done', 'counterparty'],
  ] as const) {
    try {
      const queue = await rpc<Row[]>(queueFn, { p_limit: 200 })
      if (!queue?.length) continue
      const r = await fetch(`${HS_BASE}/${path}`, {
        method: 'POST',
        headers: { Authorization: AUTH, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ items: queue }),
      })
      const t = await r.text()
      if (r.status === 404 && !t.includes('"ok"')) { stats[key] = `skipped: нет шаблона /${path} (${queue.length} в очереди)`; continue }
      let res: Row = {}
      try { res = JSON.parse(t) } catch { /* */ }
      if (res.ok !== true) throw new Error(String(res.error ?? `HTTP ${r.status} ${t.slice(0, 200)}`))
      const results = (res.results ?? []) as Row[]
      await rpc(doneFn, { p_rows: results })
      const bad = results.filter(x => x.ok !== true)
      stats[key] = { ok: results.length - bad.length, err: bad.length }
      if (bad.length) errors.push(`${path}: ${String(bad[0].error ?? '')}`)
    } catch (e) {
      errors.push(`${path}: ${(e as Error).message}`)
    }
  }

  stats.ms = Date.now() - t0
  const status = errors.length ? 'error' : 'ok'
  if (stats.queue || stats.read || stats.contacts || stats.counterparties || errors.length) {
    await rpc('dl_log_run', { p_kind: 'chains', p_status: status, p_stats: stats, p_error: errors.join('; ').slice(0, 1000) || null }).catch(() => {})
  }
  return json({ ok: !errors.length, stats, errors })
})
