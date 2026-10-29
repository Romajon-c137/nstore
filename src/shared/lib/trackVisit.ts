import { supabase } from '@/shared/lib/supabase'

/* Лёгкий трекинг посещений сайта — одна запись на сессию.
   Классифицирует источник: прямой / поиск / реклама / реферал. */

const SEARCH_HOSTS = ['google.', 'yandex.', 'ya.ru', 'mail.ru', 'go.mail.ru', 'bing.', 'duckduckgo.', 'yahoo.', 'rambler.']

function classify(refHost: string, utmSource: string | null): string {
  if (utmSource) return 'ads'
  if (!refHost) return 'direct'
  if (SEARCH_HOSTS.some(h => refHost.includes(h))) return 'search'
  return 'referral'
}

export function trackVisit() {
  try {
    // Старый endpoint /api/track и fallback Supabase не входят в новый Django API.
    if (process.env.NEXT_PUBLIC_CATALOG_SOURCE === 'django') return
    if (sessionStorage.getItem('sv_tracked')) return // одна запись на сессию
    sessionStorage.setItem('sv_tracked', '1')

    const ref = document.referrer || ''
    let refHost = ''
    try { refHost = ref ? new URL(ref).hostname.replace(/^www\./, '') : '' } catch { /* ignore */ }
    if (refHost && refHost === location.hostname.replace(/^www\./, '')) refHost = '' // внутренний переход — не реферал

    const params = new URLSearchParams(location.search)
    const utm_source = params.get('utm_source')
    const utm_medium = params.get('utm_medium')
    const utm_campaign = params.get('utm_campaign')

    let visitor_id: string
    try {
      visitor_id = localStorage.getItem('sv_vid') || crypto.randomUUID()
      localStorage.setItem('sv_vid', visitor_id)
    } catch { visitor_id = 'anon' }

    const payload = {
      referrer: ref || null,
      referrer_host: refHost || null,
      source: classify(refHost, utm_source),
      utm_source, utm_medium, utm_campaign,
      path: location.pathname,
      device: window.innerWidth < 768 ? 'mobile' : 'desktop',
      visitor_id,
    }

    // Основной путь — через Vercel Edge (/api/track): там к записи добавляется
    // география (страна/город из гео-заголовков Vercel) и браузер/ОС из user-agent.
    // Если функция недоступна (локалка / не задеплоено) — прямой insert без гео.
    // ВАЖНО: билдер supabase-js ленивый — запрос уходит только при .then()/await.
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).then(res => {
      if (!res.ok) throw new Error('track failed')
    }).catch(() => {
      supabase.from('site_visits').insert(payload)
        .then(() => { /* ok */ }, () => { /* аналитика не должна ломать страницу */ })
    })
  } catch { /* аналитика никогда не должна ломать страницу */ }
}
