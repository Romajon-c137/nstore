// Vercel Edge Function — приём визитов с обогащением географией.
// Vercel добавляет гео-заголовки (x-vercel-ip-*) к каждому запросу — это те же
// данные, что и в Vercel Analytics. Здесь мы кладём их в нашу таблицу site_visits.
export const runtime = 'nodejs'

const SUPA_URL = process.env.SUPABASE_URL
// anon-ключ (он и так публичный в клиенте); RLS разрешает анонимный insert в site_visits
const SUPA_KEY = process.env.SUPABASE_ANON_KEY



function parseUA(ua: string): { browser: string | null; os: string | null } {
  let browser: string | null = null
  let os: string | null = null
  if (/edg/i.test(ua)) browser = 'Edge'
  else if (/opr|opera/i.test(ua)) browser = 'Opera'
  else if (/chrome|crios/i.test(ua)) browser = 'Chrome'
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox'
  else if (/safari/i.test(ua)) browser = 'Safari'
  else if (/yabrowser/i.test(ua)) browser = 'Yandex'

  if (/windows/i.test(ua)) os = 'Windows'
  else if (/android/i.test(ua)) os = 'Android'
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS'
  else if (/mac os x|macintosh/i.test(ua)) os = 'macOS'
  else if (/linux/i.test(ua)) os = 'Linux'
  return { browser, os }
}

export async function POST(req: Request): Promise<Response> {
  if (!SUPA_URL || !SUPA_KEY) return new Response(null, { status: 204 })
  try {
    const body = await req.json().catch(() => ({}))
    const h = req.headers
    const dec = (v: string | null) => { try { return v ? decodeURIComponent(v) : null } catch { return v } }

    const country = h.get('x-vercel-ip-country') || null
    const city = dec(h.get('x-vercel-ip-city')) || null
    const region = h.get('x-vercel-ip-country-region') || null
    const { browser, os } = parseUA(h.get('user-agent') || '')

    const row = {
      referrer: body.referrer ?? null,
      referrer_host: body.referrer_host ?? null,
      source: body.source ?? 'direct',
      utm_source: body.utm_source ?? null,
      utm_medium: body.utm_medium ?? null,
      utm_campaign: body.utm_campaign ?? null,
      path: body.path ?? null,
      device: body.device ?? null,
      visitor_id: body.visitor_id ?? null,
      country, city, region, browser, os,
    }

    await fetch(`${SUPA_URL}/rest/v1/site_visits`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPA_KEY,
        Authorization: `Bearer ${SUPA_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    })
    return new Response(null, { status: 204 })
  } catch {
    // аналитика не должна ломать ничего
    return new Response(null, { status: 204 })
  }
}
