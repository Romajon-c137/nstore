// supabase/functions/delivery-to-onec/index.ts
//
// Статусы доставки + фото подписанной накладной → 1С.
//   delivery.status (onec_pending) ──► эта функция ──► POST {1С}/hs/nstore_delivery/status
// HTTP-сервис — расширение 1С «nStoreДоставка» (onec_extension_delivery.bsl).
// Запуск: pg_cron каждые 5 минут (delivery.trigger('delivery-to-onec')).
// Деплой --no-verify-jwt (проверка x-sync-secret).

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ODATA_URL    = (Deno.env.get('ONEC_ODATA_URL') ?? '').replace(/\/+$/, '')
const HS_URL       = (Deno.env.get('ONEC_DELIVERY_HS_URL') ?? ODATA_URL.replace(/\/odata\/standard\.odata$/i, '') + '/hs/nstore_delivery/status')
const USER         = Deno.env.get('ONEC_HS_USER') ?? Deno.env.get('ONEC_ODATA_USER') ?? ''
const PASS         = Deno.env.get('ONEC_HS_PASSWORD') ?? Deno.env.get('ONEC_ODATA_PASSWORD') ?? ''
const BUCKET = 'delivery-docs'
const BATCH = 15

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

async function photoBase64(path: string): Promise<string> {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  if (!r.ok) throw new Error(`фото ${path}: HTTP ${r.status}`)
  const buf = new Uint8Array(await r.arrayBuffer())
  let s = ''
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
  return btoa(s)
}

class NotInstalled extends Error {}

async function push(it: Row) {
  const photo = typeof it.photo_path === 'string' && it.photo_path ? it.photo_path : null
  const body = {
    ref: it.ref, number: it.number, status: it.status, driver: it.driver_name ?? '',
    taken_at: it.taken_at ?? null, done_at: it.done_at ?? null, note: it.note ?? '',
    driver_ref: it.driver_ref ?? null, vehicle_ref: it.vehicle_ref ?? null,
    file_name: photo ? `Доставка ${it.number} ${photo.split('/').pop()}` : null,
    file_base64: photo ? await photoBase64(photo) : null,
  }
  const r = await fetch(HS_URL, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(unescape(encodeURIComponent(`${USER}:${PASS}`))), 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  })
  const t = await r.text()
  if (r.status === 404 && !t.includes('"ok"')) throw new NotInstalled('HTTP-сервис nstore_delivery не найден в 1С (расширение не установлено или не опубликовано)')
  let res: Row = {}
  try { res = JSON.parse(t) } catch { /* */ }
  if (!r.ok || res.ok !== true) throw new Error(String(res.error ?? `HTTP ${r.status} ${t.slice(0, 200)}`))
  return res
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const t0 = Date.now()
  const cfg = await rpc<{ sync_secret?: string }>('onec_sync_get_config').catch(() => null)
  if (!cfg?.sync_secret || req.headers.get('x-sync-secret') !== cfg.sync_secret) return json({ error: 'forbidden' }, 403)

  const queue = await rpc<Row[]>('dl_push_queue', { p_limit: BATCH })
  if (!queue.length) return json({ ok: true, pushed: 0 })

  let ok = 0, failed = 0
  const errors: string[] = []
  for (const it of queue) {
    try {
      await push(it)
      await rpc('dl_push_done', { p_ref: it.ref, p_ok: true, p_error: null, p_updated_at: it.updated_at })
      ok++
    } catch (e) {
      const msg = (e as Error).message
      if (e instanceof NotInstalled) {
        // Не тратим попытки, пока расширение не установлено: пишем причину и выходим
        await rpc('dl_log_run', { p_kind: 'push', p_status: 'skipped', p_stats: { queue: queue.length }, p_error: msg })
        return json({ ok: false, skipped: true, error: msg })
      }
      await rpc('dl_push_done', { p_ref: it.ref, p_ok: false, p_error: msg, p_updated_at: it.updated_at }).catch(() => {})
      failed++; errors.push(`${it.number}: ${msg}`)
    }
  }
  const stats = { queue: queue.length, ok, failed, ms: Date.now() - t0 }
  await rpc('dl_log_run', { p_kind: 'push', p_status: failed ? (ok ? 'partial' : 'error') : 'ok', p_stats: stats, p_error: errors.slice(0, 5).join('; ') || null }).catch(() => {})
  return json({ ok: failed === 0, stats })
})
