'use client'

import { supabase } from '@/shared/lib/supabase'
import { Segmented,useIsMobile } from '@/views/crm/shared/crmui'
import { useQuery } from '@tanstack/react-query'
import { useMemo,useState } from 'react'

interface Visit {
  created_at: string
  source: string | null
  referrer_host: string | null
  path: string | null
  device: string | null
  visitor_id: string | null
  utm_campaign: string | null
  utm_source: string | null
  country: string | null
  city: string | null
  browser: string | null
  os: string | null
}

// ISO-код страны → русское название + флаг (эмодзи)
const COUNTRY: Record<string, string> = {
  KZ: '🇰🇿 Казахстан', RU: '🇷🇺 Россия', UZ: '🇺🇿 Узбекистан', KG: '🇰🇬 Киргизия',
  UA: '🇺🇦 Украина', BY: '🇧🇾 Беларусь', US: '🇺🇸 США', DE: '🇩🇪 Германия',
  CN: '🇨🇳 Китай', TR: '🇹🇷 Турция', AE: '🇦🇪 ОАЭ', GB: '🇬🇧 Великобритания',
  TJ: '🇹🇯 Таджикистан', AZ: '🇦🇿 Азербайджан', GE: '🇬🇪 Грузия', AM: '🇦🇲 Армения',
}
function countryLabel(code: string): string { return COUNTRY[code] || code }

const SRC: Record<string, { label: string; color: string }> = {
  search:   { label: 'Поиск',    color: '#10A35B' },
  direct:   { label: 'Прямые',   color: '#2563EB' },
  ads:      { label: 'Реклама',  color: '#7C3AED' },
  referral: { label: 'Рефералы', color: '#D97706' },
}
const SRC_ORDER = ['search', 'direct', 'ads', 'referral']

const PERIODS = [
  { value: 7, label: '7 дней' },
  { value: 30, label: '30 дней' },
  { value: 90, label: '90 дней' },
  { value: 0, label: 'Всё время' },
]

function Card({ children, pad = 18 }: { children: React.ReactNode; pad?: number }) {
  return <div style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 16, padding: pad }}>{children}</div>
}

function AD_SRC_LABEL(src: string): string {
  const s = src.toLowerCase()
  if (s === 'facebook' || s === 'fb') return 'Facebook (Meta)'
  if (s === 'instagram' || s === 'ig') return 'Instagram (Meta)'
  if (s === 'meta') return 'Meta'
  if (s === 'google') return 'Google Ads'
  if (s === 'tiktok') return 'TikTok'
  if (s === 'telegram' || s === 'tg') return 'Telegram'
  if (s === 'youtube') return 'YouTube'
  return src
}

function topN(items: (string | null)[], n: number): { key: string; count: number }[] {
  const m = new Map<string, number>()
  for (const it of items) { if (!it) continue; m.set(it, (m.get(it) ?? 0) + 1) }
  return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, n)
}

export default function TrafficTab() {
  const isMobile = useIsMobile()
  const [period, setPeriod] = useState(30)

  const { data: visits = [], isLoading } = useQuery<Visit[]>({
    queryKey: ['site-visits', period],
    queryFn: async () => {
      let q = supabase.from('site_visits')
        .select('created_at, source, referrer_host, path, device, visitor_id, utm_campaign, utm_source, country, city, browser, os')
        .order('created_at', { ascending: false })
        .limit(5000)
      if (period > 0) q = q.gte('created_at', new Date(Date.now() - period * 86400000).toISOString())
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as Visit[]
    },
    staleTime: 60_000,
  })

  const agg = useMemo(() => {
    const total = visits.length
    const uniques = new Set(visits.map(v => v.visitor_id).filter(Boolean)).size
    const bySource: Record<string, number> = {}
    for (const v of visits) { const s = v.source ?? 'direct'; bySource[s] = (bySource[s] ?? 0) + 1 }
    const mobile = visits.filter(v => v.device === 'mobile').length
    const refs = topN(visits.filter(v => v.source === 'search' || v.source === 'referral').map(v => v.referrer_host), 8)
    const pages = topN(visits.map(v => v.path), 8)
    const adSources = topN(visits.map(v => v.utm_source), 8)   // рекламные площадки (facebook/instagram/google…)
    const campaigns = topN(visits.map(v => v.utm_campaign), 6)
    const countries = topN(visits.map(v => v.country), 8)
    const cities = topN(visits.map(v => v.city), 8)
    const browsers = topN(visits.map(v => v.browser), 6)

    // визиты по дням (последние 14 непустых)
    const byDay = new Map<string, number>()
    for (const v of visits) { const d = v.created_at.slice(0, 10); byDay.set(d, (byDay.get(d) ?? 0) + 1) }
    const days = [...byDay.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).slice(-14)
    const dayMax = Math.max(1, ...days.map(d => d[1]))

    return { total, uniques, bySource, mobile, desktop: total - mobile, refs, pages, adSources, campaigns, countries, cities, browsers, days, dayMax }
  }, [visits])

  const pad = isMobile ? '14px' : '24px'
  const kpi: React.CSSProperties = { background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 16, padding: 16, flex: '1 1 150px' }
  const kpiVal: React.CSSProperties = { fontFamily: "'Unbounded', sans-serif", fontWeight: 700, fontSize: 22, color: 'var(--t)', marginTop: 4 }
  const kpiLbl: React.CSSProperties = { fontSize: 12, color: 'var(--t3)' }

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}>
      <div style={{ padding: `16px ${pad}`, background: 'var(--bg2)', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontFamily: "'Unbounded', sans-serif", fontWeight: 700, fontSize: isMobile ? 18 : 22, color: 'var(--t)' }}>Трафик сайта</div>
        <Segmented value={period} onChange={setPeriod} options={PERIODS} />
      </div>

      <div style={{ padding: `16px ${pad} 60px`, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {isLoading ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--t3)', fontSize: 14 }}>Загрузка…</div>
        ) : agg.total === 0 ? (
          <Card>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--t)', marginBottom: 6 }}>Пока нет данных</div>
            <div style={{ fontSize: 13, color: 'var(--t3)', lineHeight: 1.5 }}>
              Данные о посещениях начнут собираться после деплоя, когда посетители зайдут на сайт.
              Здесь появится разбивка: сколько пришло из поиска, напрямую, по рекламе или с других сайтов.
            </div>
          </Card>
        ) : (
          <>
            {/* KPI */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={kpi}><div style={kpiLbl}>Визитов</div><div style={kpiVal}>{agg.total.toLocaleString('ru')}</div></div>
              <div style={kpi}><div style={kpiLbl}>Уникальных</div><div style={kpiVal}>{agg.uniques.toLocaleString('ru')}</div></div>
              <div style={kpi}><div style={kpiLbl}>С телефона</div><div style={kpiVal}>{agg.total ? Math.round(agg.mobile / agg.total * 100) : 0}%</div></div>
              <div style={kpi}><div style={kpiLbl}>Из поиска</div><div style={{ ...kpiVal, color: '#10A35B' }}>{agg.total ? Math.round((agg.bySource.search ?? 0) / agg.total * 100) : 0}%</div></div>
            </div>

            {/* Источники */}
            <Card>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t)', marginBottom: 14 }}>Источники трафика</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {SRC_ORDER.map(s => {
                  const cnt = agg.bySource[s] ?? 0
                  const pct = agg.total ? Math.round(cnt / agg.total * 100) : 0
                  const meta = SRC[s]
                  return (
                    <div key={s}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                        <span style={{ color: 'var(--t2)', fontWeight: 600 }}>{meta.label}</span>
                        <span style={{ color: 'var(--t3)' }}>{cnt.toLocaleString('ru')} · {pct}%</span>
                      </div>
                      <div style={{ height: 8, borderRadius: 4, background: 'var(--bg3)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: meta.color, borderRadius: 4, transition: 'width .3s' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>

            {/* Визиты по дням */}
            {agg.days.length > 1 && (
              <Card>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t)', marginBottom: 14 }}>Визиты по дням</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }}>
                  {agg.days.map(([date, cnt]) => (
                    <div key={date} title={`${date}: ${cnt}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 4, height: '100%' }}>
                      <div style={{ width: '100%', maxWidth: 28, height: `${Math.max(4, cnt / agg.dayMax * 96)}px`, background: '#10A35B', borderRadius: '4px 4px 0 0' }} />
                      <span style={{ fontSize: 9, color: 'var(--t3)' }}>{date.slice(8, 10)}.{date.slice(5, 7)}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Топ рефереров + страниц */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
              <Card pad={0}>
                <div style={{ padding: '16px 18px 10px', fontSize: 14, fontWeight: 700, color: 'var(--t)' }}>Откуда переходят</div>
                {agg.refs.length === 0 ? <div style={{ padding: '0 18px 18px', fontSize: 13, color: 'var(--t3)' }}>Нет данных (в основном прямые заходы)</div>
                  : agg.refs.map(r => (
                    <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 18px', borderTop: '1px solid var(--bd)', fontSize: 13 }}>
                      <span style={{ color: 'var(--t)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.key}</span>
                      <span style={{ color: 'var(--t3)', fontWeight: 700, flexShrink: 0, marginLeft: 8 }}>{r.count}</span>
                    </div>
                  ))}
              </Card>
              <Card pad={0}>
                <div style={{ padding: '16px 18px 10px', fontSize: 14, fontWeight: 700, color: 'var(--t)' }}>Страницы входа</div>
                {agg.pages.map(p => (
                  <div key={p.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 18px', borderTop: '1px solid var(--bd)', fontSize: 13 }}>
                    <span style={{ color: 'var(--t)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.key}</span>
                    <span style={{ color: 'var(--t3)', fontWeight: 700, flexShrink: 0, marginLeft: 8 }}>{p.count}</span>
                  </div>
                ))}
              </Card>
            </div>

            {/* География (страна/город из гео-заголовков Vercel) + Браузеры */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
              <Card pad={0}>
                <div style={{ padding: '16px 18px 10px', fontSize: 14, fontWeight: 700, color: 'var(--t)' }}>География</div>
                {agg.countries.length === 0 ? <div style={{ padding: '0 18px 18px', fontSize: 13, color: 'var(--t3)' }}>Данные о стране появятся после следующего деплоя (собираются через Vercel).</div>
                  : agg.countries.map(c => (
                    <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 18px', borderTop: '1px solid var(--bd)', fontSize: 13 }}>
                      <span style={{ color: 'var(--t)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{countryLabel(c.key)}</span>
                      <span style={{ color: 'var(--t3)', fontWeight: 700, flexShrink: 0, marginLeft: 8 }}>{c.count}</span>
                    </div>
                  ))}
                {agg.cities.length > 0 && (
                  <>
                    <div style={{ padding: '14px 18px 6px', fontSize: 12, fontWeight: 700, color: 'var(--t3)', borderTop: '1px solid var(--bd)' }}>Города</div>
                    {agg.cities.map(c => (
                      <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 18px', fontSize: 13 }}>
                        <span style={{ color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.key}</span>
                        <span style={{ color: 'var(--t3)', fontWeight: 700, flexShrink: 0, marginLeft: 8 }}>{c.count}</span>
                      </div>
                    ))}
                  </>
                )}
              </Card>
              <Card pad={0}>
                <div style={{ padding: '16px 18px 10px', fontSize: 14, fontWeight: 700, color: 'var(--t)' }}>Устройства и браузеры</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 18px', borderTop: '1px solid var(--bd)', fontSize: 13 }}>
                  <span style={{ color: 'var(--t)' }}>📱 Телефон / 💻 Компьютер</span>
                  <span style={{ color: 'var(--t3)', fontWeight: 700 }}>{agg.mobile} / {agg.desktop}</span>
                </div>
                {agg.browsers.length === 0 ? <div style={{ padding: '0 18px 18px', fontSize: 13, color: 'var(--t3)' }}>Данные о браузере появятся после следующего деплоя.</div>
                  : agg.browsers.map(b => (
                    <div key={b.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 18px', borderTop: '1px solid var(--bd)', fontSize: 13 }}>
                      <span style={{ color: 'var(--t)' }}>{b.key}</span>
                      <span style={{ color: 'var(--t3)', fontWeight: 700 }}>{b.count}</span>
                    </div>
                  ))}
              </Card>
            </div>

            {/* Переходы с рекламы (utm_source): это ТРАФИК сайта по меткам, НЕ показатели Меты */}
            {agg.adSources.length > 0 && (
              <Card pad={0}>
                <div style={{ padding: '16px 18px 4px', fontSize: 14, fontWeight: 700, color: 'var(--t)' }}>Переходы с рекламы</div>
                <div style={{ padding: '0 18px 10px', fontSize: 12, color: 'var(--t3)', lineHeight: 1.4 }}>
                  Сколько визитов пришло на сайт по рекламным меткам (utm_source). Это трафик сайта, а не показатели рекламы Меты (охват, показы, бюджет) — их подключим отдельно.
                </div>
                {agg.adSources.map(s => (
                  <div key={s.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 18px', borderTop: '1px solid var(--bd)', fontSize: 13 }}>
                    <span style={{ color: 'var(--t)' }}>{AD_SRC_LABEL(s.key)}</span>
                    <span style={{ color: 'var(--t3)', fontWeight: 700 }}>{s.count}</span>
                  </div>
                ))}
              </Card>
            )}

            {/* UTM-кампании */}
            {agg.campaigns.length > 0 && (
              <Card pad={0}>
                <div style={{ padding: '16px 18px 10px', fontSize: 14, fontWeight: 700, color: 'var(--t)' }}>Рекламные кампании (UTM)</div>
                {agg.campaigns.map(c => (
                  <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 18px', borderTop: '1px solid var(--bd)', fontSize: 13 }}>
                    <span style={{ color: 'var(--t)' }}>{c.key}</span>
                    <span style={{ color: 'var(--t3)', fontWeight: 700 }}>{c.count}</span>
                  </div>
                ))}
              </Card>
            )}

            {/* Раздел «Реклама Мета» (охват/показы/бюджет/ROAS) — заглушка до подключения Meta API */}
            <Card>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--t)', marginBottom: 6 }}>Реклама Мета (Facebook/Instagram)</div>
              <div style={{ fontSize: 13, color: 'var(--t3)', lineHeight: 1.5 }}>
                Показатели самих рекламных кампаний Меты — бюджет, показы, охват, клики, CTR, цена за клик и ROAS — это <b>отдельные данные</b> из рекламного кабинета Меты, их нельзя получить из трафика сайта.
                Чтобы они появились здесь, нужно подключить Meta Marketing API (постоянный токен + ID рекламного аккаунта <code>act_…</code>).
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
