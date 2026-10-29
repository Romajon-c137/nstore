'use client'

import { useLanguage } from '@/shared/i18n/LanguageContext'
import type { Lang } from '@/shared/i18n/translations'
import { supabase } from '@/shared/lib/supabase'
import { Helmet } from '@/shared/ui/Seo'
import { Button,Spinner } from '@/shared/ui/ui'
import CartDrawer from '@/views/cabinet/ui/CartDrawer'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect,useMemo,useRef,useState } from 'react'
import { QRSigningClientCMS } from 'sigex-qr-signing-client'

// Базовый URL SIGEX для QR-подписания через eGov Mobile.
// По умолчанию — прод sigex.kz; для тестовой среды задать VITE_SIGEX_URL.
const SIGEX_URL = (process.env.NEXT_PUBLIC_SIGEX_URL as string | undefined) || 'https://sigex.kz'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Profile {
  id: string; name: string | null; email: string | null; phone: string | null
  company: string | null; company_id: string | null; location_id: string | null
  manager_id: string | null; market_segment: string | null; notes: string | null
}

interface Product {
  id: string; sku: string; name: string; section_name: string | null
  price: number | null; price_tp: number | null; price_top: number | null
  box_qty: number | null; vol: string | null; is_active: boolean; stock: number | null
  reserved_qty: number | null; image_url: string | null
}

interface CartItem { product: Product; qty: number; unitPrice: number }

interface OrderRow {
  id: string; title: string; order_status: string | null; total: number | null
  items: any; client_name: string | null; address: string | null; created_at: string
}

interface Discount { id: string; section_id: string; discount: number; note: string | null }
interface Contract { price_list: string | null; discount_pct: number | null }

interface Location {
  id: string; name: string; address: string | null; phone: string | null
  owner_id: string | null; company_id: string | null; created_at: string
  lat: number | null; lon: number | null
}

interface TeamMember {
  id: string; name: string | null; email: string | null; role: string | null
  phone: string | null; location_id: string | null
}

type Tab = 'overview' | 'catalog' | 'locations' | 'users' | 'orders' | 'contracts' | 'profile'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | null) {
  if (!n && n !== 0) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + ' млн ₸'
  return n.toLocaleString('ru-RU') + ' ₸'
}

function fmtShort(n: number | null) {
  if (!n && n !== 0) return '—'
  return n.toLocaleString('ru-RU') + ' ₸'
}


const SECTION_PALETTE = ['#EAF6EE', '#FFF1DD', '#E7F3F4', '#F1ECE5', '#F4EEFE', '#E3F2FD', '#FFF8E1', '#FCE4EC']

function sectionColor(sectionName: string, sections: string[]): string {
  const idx = sections.indexOf(sectionName)
  return SECTION_PALETTE[idx >= 0 ? idx % SECTION_PALETTE.length : 0]
}

// ─── Geocoding ────────────────────────────────────────────────────────────────

async function geocodeAddress(address: string): Promise<{ lat: number; lon: number } | null> {
  const clean = address
    .replace(/г\.\s*/gi, '').replace(/ул\.\s*/gi, '').replace(/пр\.\s*/gi, '')
    .replace(/пр-т\.?\s*/gi, '').replace(/д\.\s*/gi, '').replace(/кв\.\s*/gi, '').trim()

  const noHouse = clean.replace(/,?\s*\d+[а-яА-Яa-zA-Z]?\s*$/, '').trim()
  const nurSultan = clean.replace(/\bАстана\b/gi, 'Нур-Султан')
  const nurSultanNoHouse = noHouse.replace(/\bАстана\b/gi, 'Нур-Султан')

  const attempts = [
    `${clean}, Казахстан`,
    `${nurSultan}, Казахстан`,
    `${noHouse}, Казахстан`,
    `${nurSultanNoHouse}, Казахстан`,
    clean,
  ]

  for (const q of attempts) {
    try {
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`
      )
      const data = await resp.json()
      if (Array.isArray(data) && data.length > 0) {
        return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) }
      }
    } catch { continue }
  }
  return null
}

// ─── Leaflet Map ──────────────────────────────────────────────────────────────

function LocationsMap({ locations }: { locations: Location[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    delete (L.Icon.Default.prototype as any)._getIconUrl
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    })

    const map = L.map(containerRef.current, { center: [51.1801, 71.4460], zoom: 11 })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(map)

    const withCoords = locations.filter(l => l.lat && l.lon)
    withCoords.forEach(loc => {
      L.marker([loc.lat!, loc.lon!]).addTo(map)
        .bindPopup(`<b>${loc.name}</b>${loc.address ? `<br>${loc.address}` : ''}`)
    })
    if (withCoords.length === 1) map.setView([withCoords[0].lat!, withCoords[0].lon!], 14)
    else if (withCoords.length > 1) {
      map.fitBounds(L.latLngBounds(withCoords.map(l => [l.lat!, l.lon!] as [number, number])), { padding: [40, 40] })
    }

    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  return (
    <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid #EDF1EF', marginBottom: 20 }}>
      <div ref={containerRef} style={{ height: 300, width: '100%' }} />
    </div>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ profile, isMobile }: { profile: Profile | null; isMobile?: boolean }) {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const monthNames = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

  const { data: orders = [] } = useQuery<OrderRow[]>({
    queryKey: ['cabinet-orders', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return []
      const { data } = await supabase.from('crm_tasks').select('id, title, order_status, total, items, client_name, address, created_at').eq('task_type', 'order').or(`client_id.eq.${profile.id},manager_id.eq.${profile.id}`).order('created_at', { ascending: false }).limit(50)
      return (data ?? []) as OrderRow[]
    },
    enabled: !!profile?.id, staleTime: 30_000,
  })

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ['cabinet-locations', profile?.company_id],
    queryFn: async () => {
      if (!profile?.company_id) return []
      const { data } = await supabase.from('locations').select('*').eq('company_id', profile.company_id)
      return (data ?? []) as Location[]
    },
    enabled: !!profile?.company_id, staleTime: 60_000,
  })

  const monthOrders = orders.filter(o => o.created_at >= monthStart)
  const monthTotal = monthOrders.reduce((s, o) => s + (o.total ?? 0), 0)
  const inProgress = orders.filter(o => o.order_status && !['done', 'cancelled'].includes(o.order_status)).length
  const delivering = orders.filter(o => o.order_status === 'delivering').length
  const avgOrder = orders.length > 0 ? Math.round(orders.reduce((s, o) => s + (o.total ?? 0), 0) / orders.length) : 0

  const barGradient = ['#C8E6D4', '#A5D4B8', '#7DC49A', '#55B37C', '#2DAE6B', 'var(--primary)']
  const bars = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    const start = d.toISOString()
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString()
    const total = orders.filter(o => o.created_at >= start && o.created_at < end).reduce((s, o) => s + (o.total ?? 0), 0)
    return { m: monthNames[d.getMonth()], total, color: barGradient[i] }
  })
  const maxBar = Math.max(...bars.map(b => b.total), 1)

  const catMap: Record<string, number> = {}
  orders.forEach(o => { if (Array.isArray(o.items)) o.items.forEach((item: any) => { const cat = item.section_name ?? item.name?.split(' ')[0] ?? 'Прочее'; const contrib = (Number(item.price) || 0) * (Number(item.qty) || 0); catMap[cat] = (catMap[cat] ?? 0) + contrib }) })
  const catTotal = Object.values(catMap).reduce((s, v) => s + (v > 0 ? v : 0), 0) || 1
  const cats = Object.entries(catMap).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4)
  const catColors = ['var(--primary)', '#7C3AED', '#F5A623', '#1B7E8C']

  const STATUS_MAP: Record<string, { label: string; bg: string; fg: string }> = {
    new: { label: 'Новый', bg: '#FFF3E0', fg: '#F57C00' }, confirmed: { label: 'Подтверждён', bg: '#E3F2FD', fg: '#1565C0' },
    picking: { label: 'Сборка', bg: '#F3E5F5', fg: '#6A1B9A' }, delivering: { label: 'Доставка', bg: '#E0F7FA', fg: '#00695C' },
    done: { label: 'Выполнен', bg: '#E8F5E9', fg: '#2E7D32' }, cancelled: { label: 'Отменён', bg: '#FFEBEE', fg: '#C62828' },
  }

  return (
    <div style={{ padding: isMobile ? '16px 14px 32px' : '28px 32px 48px', overflowY: 'auto', height: '100%', background: '#F6F8F7' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: isMobile ? 18 : 22, color: '#0E1E16' }}>Обзор закупок</div>
        <div style={{ fontSize: 13, color: '#7A877F', marginTop: 3 }}>{monthNames[now.getMonth()]} {now.getFullYear()} · сводка</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }} className="cab-kpi4">
        {[{ label: 'Закупки за месяц', value: fmt(monthTotal), sub: `${monthOrders.length} заказов`, subColor: 'var(--primary)' }, { label: 'Активные точки', value: String(locations.length), sub: 'торговых точек', subColor: '#8A968E' }, { label: 'Заказов в работе', value: String(inProgress), sub: delivering > 0 ? `${delivering} в доставке` : 'обрабатываются', subColor: delivering > 0 ? '#7C3AED' : '#8A968E' }, { label: 'Средний чек', value: fmtShort(avgOrder), sub: 'за все время', subColor: '#8A968E' }].map((card, i) => (
          <div key={i} style={{ background: '#fff', border: '1px solid #EDF1EF', borderRadius: 16, padding: '18px 20px' }}>
            <div style={{ fontSize: 12, color: '#7A877F', marginBottom: 6 }}>{card.label}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, color: '#0E1E16', marginBottom: 4 }}>{card.value}</div>
            <div style={{ fontSize: 12, color: card.subColor, fontWeight: 600 }}>{card.sub}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 16, marginBottom: 20 }} className="cab-split">
        <div style={{ background: '#fff', border: '1px solid #EDF1EF', borderRadius: 16, padding: 22 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 20, color: '#0E1E16' }}>Динамика закупок</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 130 }}>
            {bars.map((b, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, justifyContent: 'flex-end', height: '100%' }}>
                <div style={{ width: '100%', borderRadius: '6px 6px 0 0', background: b.color, height: `${Math.max(Math.round((b.total / maxBar) * 100), b.total > 0 ? 4 : 0)}%`, transition: 'height .3s ease' }} />
                <span style={{ fontSize: 11, color: '#A6B0A9' }}>{b.m}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ background: '#fff', border: '1px solid #EDF1EF', borderRadius: 16, padding: 22 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: '#0E1E16' }}>Структура категорий</div>
          {cats.length === 0 ? <div style={{ fontSize: 13, color: '#8A968E', textAlign: 'center', paddingTop: 20 }}>Нет данных</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {cats.map(([name, val], i) => { const pct = Math.round((val / catTotal) * 100); return (
                <div key={name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}><span style={{ color: '#1A2A21' }}>{name}</span><b>{pct}%</b></div>
                  <div style={{ height: 6, borderRadius: 5, background: '#EDF1EF' }}><div style={{ width: `${pct}%`, height: '100%', borderRadius: 5, background: catColors[i] }} /></div>
                </div>
              )})}
            </div>
          )}
        </div>
      </div>
      {locations.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #EDF1EF', borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #EDF1EF' }}><div style={{ fontSize: 14, fontWeight: 700, color: '#0E1E16' }}>Мои точки</div></div>
          {isMobile ? (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {locations.map((loc, idx) => (
                <div key={loc.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: idx < locations.length - 1 ? '1px solid #F4F7F5' : 'none' }}>
                  <div><div style={{ fontWeight: 600, fontSize: 13, color: '#0E1E16' }}>{loc.name}</div>{loc.address && <div style={{ fontSize: 11, color: '#8A968E', marginTop: 2 }}>{loc.address}</div>}</div>
                  <span style={{ background: '#EAF6EE', color: 'var(--primary)', borderRadius: 7, padding: '3px 9px', fontSize: 11, fontWeight: 700, flexShrink: 0, marginLeft: 10 }}>Активна</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', fontSize: 11, fontWeight: 700, color: '#8A968E', padding: '10px 20px', borderBottom: '1px solid #F2F5F3', minWidth: 480, textTransform: 'uppercase', letterSpacing: '.4px' }}><span>Точка</span><span>Телефон</span><span>Статус</span></div>
              {locations.map(loc => (
                <div key={loc.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', alignItems: 'center', fontSize: 13, padding: '13px 20px', borderBottom: '1px solid #F4F7F5', minWidth: 480 }}>
                  <div><div style={{ fontWeight: 600, color: '#0E1E16' }}>{loc.name}</div>{loc.address && <div style={{ fontSize: 11, color: '#8A968E', marginTop: 2 }}>{loc.address}</div>}</div>
                  <span style={{ color: '#5C6B63' }}>{loc.phone ?? '—'}</span>
                  <span style={{ background: '#EAF6EE', color: 'var(--primary)', borderRadius: 7, padding: '3px 9px', fontSize: 11, fontWeight: 700, width: 'fit-content' }}>Активна</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {orders.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #EDF1EF', borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #EDF1EF' }}><div style={{ fontSize: 14, fontWeight: 700, color: '#0E1E16' }}>Последние заказы</div></div>
          {isMobile ? (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {orders.slice(0, 5).map((o, idx) => { const st = STATUS_MAP[o.order_status ?? '']; return (
                <div key={o.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: idx < Math.min(orders.length, 5) - 1 ? '1px solid #F4F7F5' : 'none', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#0E1E16', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.client_name ?? o.title}</div>
                    <div style={{ fontSize: 11, color: '#8A968E', marginTop: 2 }}>{new Date(o.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--primary)' }}>{fmtShort(o.total)}</div>
                    {st && <span style={{ background: st.bg, color: st.fg, borderRadius: 7, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>{st.label}</span>}
                  </div>
                </div>
              )})}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', fontSize: 11, fontWeight: 700, color: '#8A968E', padding: '10px 20px', borderBottom: '1px solid #F2F5F3', minWidth: 540, textTransform: 'uppercase', letterSpacing: '.4px' }}><span>Заказ</span><span>Сумма</span><span>Дата</span><span>Статус</span></div>
              {orders.slice(0, 5).map(o => { const st = STATUS_MAP[o.order_status ?? '']; return (
                <div key={o.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', alignItems: 'center', fontSize: 13, padding: '12px 20px', borderBottom: '1px solid #F4F7F5', minWidth: 540 }}>
                  <span style={{ fontWeight: 600, color: '#0E1E16', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.client_name ?? o.title}</span>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, color: 'var(--primary)' }}>{fmtShort(o.total)}</span>
                  <span style={{ color: '#5C6B63', fontSize: 12 }}>{new Date(o.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}</span>
                  {st ? <span style={{ background: st.bg, color: st.fg, borderRadius: 7, padding: '3px 9px', fontSize: 11, fontWeight: 700, width: 'fit-content' }}>{st.label}</span> : <span>—</span>}
                </div>
              )})}
            </div>
          )}
        </div>
      )}
      {orders.length === 0 && locations.length === 0 && (
        <div style={{ textAlign: 'center', paddingTop: 60, color: '#8A968E' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1A2A21', marginBottom: 4 }}>Нет данных</div>
          <div style={{ fontSize: 13 }}>Оформите первый заказ, чтобы увидеть аналитику</div>
        </div>
      )}
    </div>
  )
}

// ─── Catalog Tab ──────────────────────────────────────────────────────────────

function CatalogTab({ profile, cart, onAdd, onRemove, isMobile }: {
  profile: Profile | null; cart: CartItem[]
  onAdd: (p: Product, price: number, step?: number) => void; onRemove: (id: string, step?: number) => void
  isMobile?: boolean
}) {
  const [search, setSearch] = useState('')
  const [dSearch, setDSearch] = useState('')
  const [section, setSection] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  function handleSearch(val: string) { setSearch(val); clearTimeout(searchTimer.current); searchTimer.current = setTimeout(() => setDSearch(val), 380) }

  const { data: discounts = [] } = useQuery<Discount[]>({ queryKey: ['client-discounts', profile?.id], queryFn: async () => { if (!profile?.id) return []; const { data } = await supabase.from('discounts').select('*').eq('user_id', profile.id); return data ?? [] }, enabled: !!profile?.id, staleTime: 60_000 })
  const { data: contract } = useQuery<Contract | null>({ queryKey: ['client-contract', profile?.id], queryFn: async () => { if (!profile?.id) return null; const { data } = await supabase.from('contracts').select('price_list, discount_pct').eq('user_id', profile.id).maybeSingle(); return data as Contract | null }, enabled: !!profile?.id, staleTime: 120_000 })
  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ['cabinet-products', dSearch, section],
    queryFn: async () => {
      let q = supabase.from('products').select('id, sku, name, section_name, price, price_tp, price_top, box_qty, vol, is_active, stock, image_url').eq('is_active', true).order('section_name').order('name').limit(200)
      if (dSearch) q = q.or(`name.ilike.%${dSearch}%,sku.ilike.%${dSearch}%`)
      if (section) q = q.eq('section_name', section)
      const { data, error } = await q; if (error) throw error; return (data ?? []) as Product[]
    }, staleTime: 60_000,
  })
  const { data: allProducts = [] } = useQuery<Product[]>({ queryKey: ['cabinet-products-all'], queryFn: async () => { const { data } = await supabase.from('products').select('section_name').eq('is_active', true); return (data ?? []) as Product[] }, staleTime: 300_000 })

  const sections = [...new Set(allProducts.map(p => p.section_name).filter(Boolean))] as string[]
  const sectionCounts = sections.reduce((acc, s) => { acc[s] = allProducts.filter(p => p.section_name === s).length; return acc }, {} as Record<string, number>)

  function getPrice(p: Product): number | null {
    if (contract?.price_list === 'price_top' && p.price_top) return p.price_top
    // Розница (офис, сайт) по умолчанию; оптовый прайс ТП — только если он указан в договоре
    const base = contract?.price_list === 'price_tp' ? (p.price_tp ?? p.price) : p.price; if (!base) return null
    if (contract?.discount_pct) return Math.round(base * (1 - contract.discount_pct / 100))
    const disc = discounts.find(d => d.section_id === p.section_name); if (disc) return Math.round(base * (1 - disc.discount / 100))
    return base
  }
  function getCartQty(id: string) { return cart.find(item => item.product.id === id)?.qty ?? 0 }
  // Кратность заказа = размер упаковки (кейса). Лучшая оптовая цена — при заказе упаковками.
  function getStep(p: Product) { return (p.box_qty && p.box_qty > 0) ? p.box_qty : 1 }
  const isSpecial = contract?.price_list === 'price_top'

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: '#F6F8F7' }}>
      {!isMobile && (
        <aside style={{ width: 220, flexShrink: 0, background: '#fff', borderRight: '1px solid #EDF1EF', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <div style={{ padding: '20px 14px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#8A968E', textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: 12, paddingLeft: 4 }}>Разделы</div>
            <button onClick={() => setSection('')} style={{ width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 10, border: 'none', background: !section ? '#10A35B12' : 'transparent', color: !section ? 'var(--primary)' : '#0E1E16', fontWeight: !section ? 700 : 500, fontSize: 13, cursor: 'pointer', marginBottom: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: 'inherit' }}>
              <span>Все товары</span><span style={{ fontSize: 11, color: !section ? 'var(--primary)' : '#B0BCB5', fontWeight: 600 }}>{allProducts.length}</span>
            </button>
            {sections.map(s => (
              <button key={s} onClick={() => setSection(s)} style={{ width: '100%', textAlign: 'left', padding: '8px 12px', borderRadius: 10, border: 'none', background: section === s ? '#10A35B12' : 'transparent', color: section === s ? 'var(--primary)' : '#5C6B63', fontWeight: section === s ? 700 : 400, fontSize: 13, cursor: 'pointer', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', lineHeight: 1.35 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: sectionColor(s, sections), flexShrink: 0, border: '1px solid rgba(0,0,0,.06)' }} />
                <span style={{ flex: 1 }}>{s}</span>
                <span style={{ fontSize: 11, color: section === s ? 'var(--primary)' : '#C0C8C2', fontWeight: 600, flexShrink: 0 }}>{sectionCounts[s] ?? 0}</span>
              </button>
            ))}
          </div>
        </aside>
      )}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <div style={{ padding: '14px 20px', background: '#fff', borderBottom: '1px solid #EDF1EF', flexShrink: 0 }}>
          {isSpecial && <div style={{ marginBottom: 10, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, background: '#F4EEFE', fontSize: 11, fontWeight: 700, color: '#7C3AED' }}>Специальные цены</div>}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {isMobile && (
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, flex: '0 0 auto', maxWidth: '45%' }}>
                <button onClick={() => setSection('')} style={{ padding: '6px 12px', borderRadius: 20, border: 'none', background: !section ? 'var(--primary)' : '#F2F5F3', color: !section ? '#fff' : '#5C6B63', cursor: 'pointer', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>Все</button>
                {sections.slice(0, 4).map(s => <button key={s} onClick={() => setSection(s)} style={{ padding: '6px 12px', borderRadius: 20, border: 'none', background: section === s ? 'var(--primary)' : '#F2F5F3', color: section === s ? '#fff' : '#5C6B63', cursor: 'pointer', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>{s}</button>)}
              </div>
            )}
            <div style={{ flex: 1, position: 'relative' }}>
              <input value={search} onChange={e => handleSearch(e.target.value)} placeholder={`Поиск по ${allProducts.length} товарам...`} style={{ width: '100%', padding: '9px 14px 9px 36px', borderRadius: 10, border: '1.5px solid #EDF1EF', background: '#F9FAFB', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
            </div>
          </div>
          {section && (
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: sectionColor(section, sections), border: '1px solid rgba(0,0,0,.06)' }} />
              <span style={{ fontSize: 12, color: '#5C6B63', fontWeight: 600 }}>{section}</span>
              <button onClick={() => setSection('')} style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Все разделы ×</button>
            </div>
          )}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>
          {isLoading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14 }}>
              {Array.from({ length: 8 }).map((_, i) => <div key={i} style={{ height: 240, borderRadius: 16, background: '#F2F5F3', animation: 'pulse 1.4s ease-in-out infinite' }} />)}
            </div>
          ) : products.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#8A968E', fontSize: 14, paddingTop: 60 }}>Ничего не найдено</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14 }}>
              {products.map(p => {
                const price = getPrice(p); const qty = getCartQty(p.id); const step = getStep(p); const inStock = (p.stock ?? 0) > 0
                return (
                  <div key={p.id} style={{ background: '#fff', borderRadius: 16, border: '1px solid #EDF1EF', overflow: 'hidden', display: 'flex', flexDirection: 'column', opacity: inStock ? 1 : 0.75, transition: 'box-shadow .15s' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(0,0,0,.07)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.boxShadow = 'none'}>
                    <div style={{ height: 108, background: '#fff', borderBottom: '1px solid #F1F4F2', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                      {p.image_url && <img src={p.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 8, boxSizing: 'border-box' }} />}
                      {!inStock && <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(255,140,0,.92)', color: '#fff', fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 6, letterSpacing: '.3px' }}>ПОД ЗАКАЗ</div>}
                      {qty > 0 && <div style={{ position: 'absolute', top: 8, left: 8, background: 'var(--primary)', color: '#fff', fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 6 }}>{qty} шт</div>}
                    </div>
                    <div style={{ padding: '12px 13px 14px', display: 'flex', flexDirection: 'column', flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0E1E16', lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', minHeight: 35, marginBottom: 5 }}>{p.name}</div>
                      <div style={{ fontSize: 10, color: '#A6B0A9', marginBottom: 4 }}>{p.sku && `#${p.sku}`}{p.vol ? ` · ${p.vol}` : ''}</div>
                      {step > 1 && <div style={{ fontSize: 10, color: 'var(--primary)', fontWeight: 700, marginBottom: 6 }}>Упаковка: {step} шт</div>}
                      <div style={{ marginTop: 'auto', marginBottom: 10 }}>
                        <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--primary)', lineHeight: 1 }}>{price ? fmtShort(price) : '—'}</div>
                        <div style={{ fontSize: 10, color: '#A6B0A9', marginTop: 2 }}>{isSpecial ? 'топ цена / ед.' : 'оптовая цена / ед.'}</div>
                        {price && step > 1 && <div style={{ fontSize: 10, color: '#5C6B63', marginTop: 3, fontWeight: 600 }}>{fmtShort(price * step)} / упак.</div>}
                      </div>
                      {qty === 0 ? (
                        <button onClick={() => price && onAdd(p, price, step)} disabled={!price} style={{ width: '100%', padding: '9px 0', borderRadius: 10, border: 'none', background: price ? 'var(--primary)' : '#EDF1EF', color: price ? '#fff' : '#B0BCB5', fontWeight: 700, fontSize: 13, cursor: price ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>В заявку</button>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button onClick={() => onRemove(p.id, 1)} style={{ width: 32, height: 32, borderRadius: 8, border: '1.5px solid #EDF1EF', background: '#fff', cursor: 'pointer', fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#DC2626', flexShrink: 0 }}>−</button>
                          <span style={{ flex: 1, textAlign: 'center', fontSize: 14, fontWeight: 800, color: '#0E1E16' }}>{qty}</span>
                          <button onClick={() => price && onAdd(p, price, 1)} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: 'var(--primary)', cursor: 'pointer', fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>+</button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Locations Tab ────────────────────────────────────────────────────────────

function LocationsTab({ profile }: { profile: Profile | null }) {
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', address: '', phone: '', lat: null as number | null, lon: null as number | null })
  const [formError, setFormError] = useState('')
  const [geocodeStatus, setGeocodeStatus] = useState<'idle' | 'loading' | 'found' | 'notfound'>('idle')
  const geocodeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const { data: locations = [], isLoading } = useQuery<Location[]>({
    queryKey: ['cabinet-locations', profile?.company_id],
    queryFn: async () => {
      if (!profile?.company_id) return []
      const { data } = await supabase.from('locations').select('id, name, address, phone, owner_id, company_id, created_at, lat, lon').eq('company_id', profile.company_id)
      return (data ?? []) as Location[]
    },
    enabled: !!profile?.company_id, staleTime: 60_000,
  })

  function handleAddressChange(val: string) {
    setForm(f => ({ ...f, address: val, lat: null, lon: null }))
    setGeocodeStatus('idle')
    clearTimeout(geocodeTimer.current)
    if (val.trim().length < 8) return
    geocodeTimer.current = setTimeout(async () => {
      setGeocodeStatus('loading')
      const coords = await geocodeAddress(val)
      if (coords) {
        setForm(f => ({ ...f, lat: coords.lat, lon: coords.lon }))
        setGeocodeStatus('found')
      } else {
        setGeocodeStatus('notfound')
      }
    }, 1000)
  }

  const createMut = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Введите название точки')
      if (!form.address.trim()) throw new Error('Введите адрес доставки')
      const { error } = await supabase.from('locations').insert({
        owner_id: profile?.id,
        company_id: profile?.company_id,
        name: form.name.trim(),
        address: form.address.trim(),
        phone: form.phone.trim() || null,
        lat: form.lat,
        lon: form.lon,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cabinet-locations'] })
      setCreating(false)
      setForm({ name: '', address: '', phone: '', lat: null, lon: null })
      setFormError(''); setGeocodeStatus('idle')
    },
    onError: (e: any) => setFormError(e.message),
  })

  const inputSt: React.CSSProperties = { width: '100%', padding: '11px 14px', borderRadius: 10, border: '1.5px solid #E2E8E4', background: '#F8FAF9', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }

  const hasCoords = locations.some(l => l.lat && l.lon)

  return (
    <div className="cab-tab-pad">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: '#0E1E16' }}>Мои точки</div>
        <button onClick={() => { setCreating(true); setFormError(''); setGeocodeStatus('idle') }}
          style={{ padding: '10px 18px', borderRadius: 12, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
          + Добавить точку
        </button>
      </div>

      {/* Map */}
      {!isLoading && hasCoords && (
        <LocationsMap key={locations.length} locations={locations} />
      )}

      {/* Create modal */}
      {creating && (
        <>
          <div onClick={() => setCreating(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, backdropFilter: 'blur(2px)' }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: '100%', maxWidth: 460, background: '#fff', borderRadius: 20, padding: '28px 28px 24px', zIndex: 1001, boxShadow: '0 20px 60px rgba(0,0,0,.2)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#0E1E16' }}>Новая точка доставки</div>
              <button onClick={() => setCreating(false)} style={{ width: 32, height: 32, borderRadius: 9, border: '1.5px solid #EDF1EF', background: '#F9FAFB', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>

            {formError && <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10, background: '#FFF0F0', border: '1px solid #FFCDD2', color: '#C62828', fontSize: 13 }}>{formError}</div>}

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#5C6B63', marginBottom: 6 }}>Название точки <span style={{ color: '#DC2626' }}>*</span></label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Магазин на Абая, Склад №2..." style={inputSt} />
            </div>

            <div style={{ marginBottom: 6 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#5C6B63', marginBottom: 6 }}>Адрес доставки <span style={{ color: '#DC2626' }}>*</span></label>
              <input
                value={form.address}
                onChange={e => handleAddressChange(e.target.value)}
                placeholder="г. Астана, ул. Достык, 5"
                style={inputSt}
              />
            </div>

            {/* Geocode status */}
            <div style={{ marginBottom: 14, minHeight: 20 }}>
              {geocodeStatus === 'loading' && <span style={{ fontSize: 11, color: '#8A968E' }}>Определяем координаты...</span>}
              {geocodeStatus === 'found' && <span style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 600 }}>Адрес найден на карте ({form.lat?.toFixed(4)}, {form.lon?.toFixed(4)})</span>}
              {geocodeStatus === 'notfound' && <span style={{ fontSize: 11, color: '#F57C00' }}>Не удалось определить координаты — точка будет без метки на карте</span>}
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#5C6B63', marginBottom: 6 }}>Телефон точки</label>
              <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+7 700 000 0000" type="tel" style={inputSt} />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <Button variant="secondary" size="form" font="inherit" onClick={() => { setCreating(false); setFormError('') }}
                style={{ flex: 1, fontWeight: 600, background: '#fff', border: '1.5px solid #E2E8E4', color: '#5C6B63' }}>Отмена</Button>
              <Button size="form" font="inherit" onClick={() => createMut.mutate()} loading={createMut.isPending} style={{ flex: 2 }}>
                {createMut.isPending ? 'Сохраняем...' : '+ Добавить точку'}
              </Button>
            </div>
          </div>
        </>
      )}

      {/* List */}
      {isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 3 }).map((_, i) => <div key={i} style={{ height: 70, borderRadius: 14, background: '#F2F5F3', animation: 'pulse 1.4s ease-in-out infinite' }} />)}
        </div>
      ) : locations.length === 0 ? (
        <div style={{ textAlign: 'center', paddingTop: 60, color: '#8A968E' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1A2A21', marginBottom: 4 }}>Нет точек</div>
          <div style={{ fontSize: 13 }}>Нажмите "+ Добавить точку" чтобы создать первую</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {locations.map(loc => (
            <div key={loc.id} style={{ background: '#fff', border: '1px solid #EDF1EF', borderRadius: 16, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0E1E16' }}>{loc.name}</div>
                {loc.address && <div style={{ fontSize: 13, color: '#5C6B63', marginTop: 2 }}>{loc.address}</div>}
                {loc.phone && <div style={{ fontSize: 13, color: '#8A968E', marginTop: 2 }}>{loc.phone}</div>}
                {loc.lat && loc.lon && <div style={{ fontSize: 10, color: '#A6B0A9', marginTop: 3 }}>{loc.lat.toFixed(4)}, {loc.lon.toFixed(4)}</div>}
              </div>
              <span style={{ background: '#EAF6EE', color: 'var(--primary)', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700 }}>Активна</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Users Tab ────────────────────────────────────────────────────────────────

function UsersTab({ profile }: { profile: Profile | null }) {
  const { data: users = [], isLoading } = useQuery<TeamMember[]>({
    queryKey: ['cabinet-users', profile?.company_id],
    queryFn: async () => { if (!profile?.company_id) return []; const { data } = await supabase.from('profiles').select('id, name, email, role, phone, location_id').eq('company_id', profile.company_id); return (data ?? []) as TeamMember[] },
    enabled: !!profile?.company_id, staleTime: 60_000,
  })
  const ROLE_COLORS: Record<string, { bg: string; fg: string }> = { client: { bg: '#EAF6EE', fg: 'var(--primary)' }, manager: { bg: '#EDE9FF', fg: '#7C3AED' }, admin: { bg: '#FFE4E4', fg: '#DC2626' } }
  const avatarColors = ['var(--primary)', '#7C3AED', '#1B7E8C', '#F57C00', '#DC2626']
  return (
    <div className="cab-tab-pad">
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, color: '#0E1E16', marginBottom: 24 }}>Пользователи</div>
      {isLoading ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{Array.from({ length: 3 }).map((_, i) => <div key={i} style={{ height: 64, borderRadius: 14, background: '#F2F5F3', animation: 'pulse 1.4s ease-in-out infinite' }} />)}</div>
        : users.length === 0 ? <div style={{ textAlign: 'center', paddingTop: 60, color: '#8A968E' }}><div style={{ fontSize: 15, fontWeight: 700, color: '#1A2A21', marginBottom: 4 }}>Нет пользователей</div></div>
        : <div style={{ background: '#fff', border: '1px solid #EDF1EF', borderRadius: 16, overflow: 'hidden' }}>
            {users.map((u, idx) => { const roleColors = ROLE_COLORS[u.role ?? 'client'] ?? ROLE_COLORS.client; return (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderBottom: idx < users.length - 1 ? '1px solid #F4F7F5' : 'none' }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: avatarColors[idx % avatarColors.length], display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 15, flexShrink: 0 }}>{(u.name ?? u.email ?? 'U').slice(0, 1).toUpperCase()}</div>
                <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 600, color: '#0E1E16' }}>{u.name ?? '—'}</div><div style={{ fontSize: 12, color: '#8A968E' }}>{u.email}</div></div>
                {u.phone && <span style={{ fontSize: 13, color: '#5C6B63' }}>{u.phone}</span>}
                <span style={{ background: roleColors.bg, color: roleColors.fg, borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700 }}>{u.role ?? 'client'}</span>
              </div>
            )})}
          </div>}
    </div>
  )
}

// ─── Orders Tab ───────────────────────────────────────────────────────────────

function OrdersTab({ profile, onRepeatOrder }: { profile: Profile | null; onRepeatOrder: (items: any[]) => void }) {
  const { data: orders = [], isLoading } = useQuery<OrderRow[]>({
    queryKey: ['cabinet-orders', profile?.id],
    queryFn: async () => { if (!profile?.id) return []; const { data, error } = await supabase.from('crm_tasks').select('id, title, order_status, total, items, client_name, address, created_at').eq('task_type', 'order').or(`client_id.eq.${profile.id},manager_id.eq.${profile.id}`).order('created_at', { ascending: false }).limit(50); if (error) throw error; return (data ?? []) as OrderRow[] },
    enabled: !!profile?.id, staleTime: 30_000,
  })
  const STATUS_MAP: Record<string, { label: string; bg: string; fg: string }> = {
    new: { label: 'Новый', bg: '#FFF3E0', fg: '#F57C00' }, confirmed: { label: 'Подтверждён', bg: '#E3F2FD', fg: '#1565C0' },
    picking: { label: 'Сборка', bg: '#F3E5F5', fg: '#6A1B9A' }, delivering: { label: 'Доставка', bg: '#E0F7FA', fg: '#00695C' },
    done: { label: 'Выполнен', bg: '#E8F5E9', fg: '#2E7D32' }, cancelled: { label: 'Отменён', bg: '#FFEBEE', fg: '#C62828' },
  }
  const [expanded, setExpanded] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Статусы, реально встречающиеся среди заказов клиента — только их показываем в фильтре
  const availableStatuses = useMemo(() => {
    const present = new Set(orders.map(o => o.order_status ?? '').filter(s => STATUS_MAP[s]))
    return Object.keys(STATUS_MAP).filter(s => present.has(s))
  }, [orders])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return orders.filter(o => {
      if (statusFilter !== 'all' && (o.order_status ?? '') !== statusFilter) return false
      if (!q) return true
      const inHead = `${o.client_name ?? ''} ${o.title ?? ''}`.toLowerCase().includes(q)
      const inItems = Array.isArray(o.items) && o.items.some((it: any) => `${it.name ?? ''} ${it.sku ?? ''}`.toLowerCase().includes(q))
      return inHead || inItems
    })
  }, [orders, query, statusFilter])

  const chip = (id: string, label: string) => {
    const active = statusFilter === id
    return (
      <button key={id} onClick={() => setStatusFilter(id)}
        style={{ padding: '6px 13px', borderRadius: 20, border: active ? '1px solid var(--primary)' : '1px solid #EDF1EF', background: active ? 'var(--primary)' : '#fff', color: active ? '#fff' : '#5C6B63', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}>
        {label}
      </button>
    )
  }

  return (
    <div className="cab-tab-pad">
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: '#0E1E16', marginBottom: 20 }}>История заказов</div>
      {!isLoading && orders.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#A6B0A9', fontSize: 15, pointerEvents: 'none' }}>🔍</span>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Поиск по номеру заказа или товару"
              style={{ width: '100%', boxSizing: 'border-box', padding: '11px 38px 11px 40px', borderRadius: 12, border: '1px solid #EDF1EF', background: '#fff', fontSize: 14, color: '#1A2A21', outline: 'none', fontFamily: 'inherit' }}
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Очистить"
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 22, height: 22, borderRadius: 11, border: 'none', background: '#F2F5F3', color: '#8A968E', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>×</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
            {chip('all', 'Все')}
            {availableStatuses.map(s => chip(s, STATUS_MAP[s].label))}
          </div>
        </div>
      )}
      {isLoading ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{Array.from({ length: 4 }).map((_, i) => <div key={i} style={{ height: 72, borderRadius: 14, background: '#F2F5F3', animation: 'pulse 1.4s ease-in-out infinite' }} />)}</div>
        : orders.length === 0 ? <div style={{ textAlign: 'center', paddingTop: 60, color: '#8A968E' }}><div style={{ fontSize: 15, fontWeight: 700, color: '#1A2A21', marginBottom: 4 }}>Заказов нет</div><div style={{ fontSize: 13 }}>Оформите заказ в каталоге</div></div>
        : filtered.length === 0 ? <div style={{ textAlign: 'center', paddingTop: 40, color: '#8A968E' }}><div style={{ fontSize: 15, fontWeight: 700, color: '#1A2A21', marginBottom: 4 }}>Ничего не найдено</div><div style={{ fontSize: 13 }}>Измените запрос или сбросьте фильтр</div></div>
        : filtered.map(o => { const st = STATUS_MAP[o.order_status ?? '']; const open = expanded === o.id; const hasItems = o.items && Array.isArray(o.items) && o.items.length > 0; return (
          <div key={o.id} style={{ background: '#fff', borderRadius: 16, marginBottom: 10, border: '1px solid #EDF1EF', overflow: 'hidden' }}>
            <div onClick={() => setExpanded(open ? null : o.id)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px', cursor: 'pointer' }}>
              <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 700, color: '#0E1E16', marginBottom: 3 }}>{o.client_name ?? o.title}</div><div style={{ fontSize: 12, color: '#8A968E' }}>{new Date(o.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })}</div></div>
              <div style={{ textAlign: 'right' }}><div style={{ fontSize: 15, fontWeight: 800, color: 'var(--primary)', marginBottom: 4 }}>{fmtShort(o.total)}</div>{st && <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: st.bg, color: st.fg }}>{st.label}</span>}</div>
              <span style={{ color: '#A6B0A9', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
            </div>
            {open && hasItems && (
              <div style={{ borderTop: '1px solid #EDF1EF', padding: '12px 20px 16px' }}>
                {o.items.map((it: any, i: number) => (
                  <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, padding: '5px 0', borderBottom: i < o.items.length - 1 ? '1px solid #F4F7F5' : 'none' }}>
                    <span style={{ flex: 1, color: '#1A2A21' }}>{it.name}</span>
                    <span style={{ color: '#8A968E' }}>{it.qty} шт</span>
                    <span style={{ fontWeight: 700, color: '#0E1E16' }}>{((it.price ?? 0) * (it.qty ?? 1)).toLocaleString('ru-RU')} ₸</span>
                  </div>
                ))}
                <button
                  onClick={e => { e.stopPropagation(); onRepeatOrder(o.items) }}
                  style={{ width: '100%', marginTop: 12, padding: '11px 0', borderRadius: 11, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  ↻ Повторить заказ
                </button>
              </div>
            )}
          </div>
        )})}
    </div>
  )
}

// ─── Contracts Tab (client) ─────────────────────────────────────────────────────

const CONTRACT_STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  draft:     { label: 'Черновик',   bg: '#EEF0F2', fg: '#5C6B63' },
  pending:   { label: 'На подписи', bg: '#FFF3E0', fg: '#F57C00' },
  signed:    { label: 'Подписан',   bg: '#E8F5E9', fg: '#2E7D32' },
  cancelled: { label: 'Отменён',    bg: '#FFEBEE', fg: '#C62828' },
}

interface ClientContract {
  id: string; number: string; signed_date: string | null; valid_until: string | null
  amount: number | null; status: string; file_url: string | null; file_name: string | null; note: string | null
  signed_at?: string | null; sign_provider?: string | null; sign_ref?: string | null; sign_cms?: string | null
}

// Скачать CMS-подпись (base64) как файл .p7s
function downloadCms(base64Cms: string, filename: string) {
  try {
    const bin = atob(base64Cms)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pkcs7-signature' }))
    const a = document.createElement('a')
    a.href = url; a.download = filename
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch { /* noop */ }
}

// ─── eGov QR signing modal (SIGEX) ──────────────────────────────────────────────

function abToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}
function textToB64(s: string): string {
  return btoa(unescape(encodeURIComponent(s)))
}

type SignStep = 'init' | 'qr' | 'waiting' | 'saving' | 'done' | 'error'

function ContractSignModal({ contract, onClose, onSigned }: {
  contract: ClientContract; onClose: () => void; onSigned: () => void
}) {
  const [step, setStep] = useState<SignStep>('init')
  const [qr, setQr] = useState<string | null>(null)
  const [mobileLink, setMobileLink] = useState<string | null>(null)
  const [businessLink, setBusinessLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const label = `Договор ${contract.number}`
        // Данные на подпись: файл договора (если есть), иначе текстовая карточка договора.
        let base64: string
        let isPDF = false
        if (contract.file_url) {
          try {
            const resp = await fetch(contract.file_url)
            if (!resp.ok) throw new Error('file fetch failed')
            base64 = abToB64(await resp.arrayBuffer())
            isPDF = (contract.file_name ?? contract.file_url).toLowerCase().endsWith('.pdf')
          } catch {
            base64 = textToB64(`${label}\nЗаключён: ${contract.signed_date ?? '—'}\nСумма: ${contract.amount ?? '—'}`)
          }
        } else {
          base64 = textToB64(`${label}\nЗаключён: ${contract.signed_date ?? '—'}\nСумма: ${contract.amount ?? '—'}`)
        }

        const signer = new QRSigningClientCMS(label, false, SIGEX_URL)
        await signer.addDataToSign([label], base64, [], isPDF)
        const qrImg = await signer.registerQRSinging()
        if (!alive) return
        setQr(qrImg)
        setMobileLink(signer.getEGovMobileLaunchLink())
        setBusinessLink(signer.getEGovBusinessLaunchLink())
        setStep('qr')

        const sigs = await signer.getSignatures(() => { if (alive) setStep('waiting') })
        if (!alive) return
        const cms = sigs?.[0]
        if (!cms) throw new Error('Подпись не получена')

        setStep('saving')
        const { error: fnErr } = await supabase.functions.invoke('contract-egov-sign', {
          body: { contractId: contract.id, cms, signRef: signer.signURL },
        })
        if (fnErr) throw fnErr
        if (!alive) return
        setStep('done')
        setTimeout(() => { if (alive) onSigned() }, 1400)
      } catch (e: any) {
        if (!alive) return
        setError(e?.details || e?.message || 'Не удалось выполнить подписание')
        setStep('error')
      }
    })()
    return () => { alive = false }
  }, [])

  const isMobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(14,30,22,.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 400, background: '#fff', borderRadius: 20, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1, fontSize: 17, fontWeight: 800, color: '#0E1E16' }}>Подпись через eGov</div>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 10, border: 'none', background: '#F2F5F3', color: '#8A968E', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
        <div style={{ fontSize: 13, color: '#5C6B63', marginBottom: 18 }}>Договор {contract.number}</div>

        {step === 'init' && (
          <div style={{ textAlign: 'center', padding: '30px 0', color: '#8A968E' }}>
            <Spinner size={28} />
            <div style={{ marginTop: 12, fontSize: 13 }}>Подготовка документа…</div>
          </div>
        )}

        {step === 'qr' && (
          <div style={{ textAlign: 'center' }}>
            {qr && <img src={`data:image/png;base64,${qr}`} alt="QR" style={{ width: 220, height: 220, objectFit: 'contain', margin: '0 auto', display: 'block' }} />}
            <div style={{ fontSize: 13, color: '#1A2A21', fontWeight: 600, marginTop: 10 }}>Отсканируйте QR в приложении eGov Mobile</div>
            <div style={{ fontSize: 12, color: '#8A968E', marginTop: 4 }}>и подтвердите подпись своим ЭЦП</div>
            {isMobile && mobileLink && (
              <a href={mobileLink} style={{ display: 'block', marginTop: 14, padding: '11px 0', borderRadius: 11, background: 'var(--primary)', color: '#fff', fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>Открыть eGov Mobile</a>
            )}
            {isMobile && businessLink && (
              <a href={businessLink} style={{ display: 'block', marginTop: 8, padding: '11px 0', borderRadius: 11, background: '#fff', border: '1.5px solid #EDF1EF', color: '#1A2A21', fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>Открыть eGov Business</a>
            )}
            <div style={{ fontSize: 12, color: '#A6B0A9', marginTop: 14 }}>Ожидание подписи…</div>
          </div>
        )}

        {step === 'waiting' && (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <Spinner size={28} />
            <div style={{ marginTop: 12, fontSize: 14, fontWeight: 700, color: '#1A2A21' }}>Подтвердите подпись в eGov Mobile</div>
            <div style={{ marginTop: 4, fontSize: 12, color: '#8A968E' }}>Это может занять несколько секунд…</div>
          </div>
        )}

        {step === 'saving' && (
          <div style={{ textAlign: 'center', padding: '24px 0', color: '#8A968E' }}>
            <Spinner size={28} />
            <div style={{ marginTop: 12, fontSize: 13 }}>Сохранение подписи…</div>
          </div>
        )}

        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ width: 56, height: 56, borderRadius: 28, background: '#E8F5E9', color: '#2E7D32', fontSize: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>✓</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#0E1E16' }}>Договор подписан</div>
          </div>
        )}

        {step === 'error' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#C62828', marginBottom: 6 }}>Не удалось подписать</div>
            <div style={{ fontSize: 12, color: '#8A968E', wordBreak: 'break-word' }}>{error}</div>
            <button onClick={onClose} style={{ marginTop: 16, padding: '10px 20px', borderRadius: 11, border: 'none', background: '#F2F5F3', color: '#1A2A21', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Закрыть</button>
          </div>
        )}
      </div>
    </div>
  )
}

function ContractsTab({ profile }: { profile: Profile | null }) {
  const qc = useQueryClient()
  const [signing, setSigning] = useState<ClientContract | null>(null)
  const { data: contracts = [], isLoading } = useQuery<ClientContract[]>({
    queryKey: ['cabinet-contracts', profile?.company_id],
    queryFn: async () => {
      if (!profile?.company_id) return []
      const { data, error } = await supabase
        .from('contract_documents')
        .select('id, number, signed_date, valid_until, amount, status, file_url, file_name, note, signed_at, sign_provider, sign_ref, sign_cms')
        .eq('company_id', profile.company_id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as ClientContract[]
    },
    enabled: !!profile?.company_id, staleTime: 30_000,
  })

  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'

  return (
    <div className="cab-tab-pad">
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: '#0E1E16', marginBottom: 20 }}>Договоры</div>
      {isLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{Array.from({ length: 3 }).map((_, i) => <div key={i} style={{ height: 96, borderRadius: 14, background: '#F2F5F3', animation: 'pulse 1.4s ease-in-out infinite' }} />)}</div>
      ) : !profile?.company_id ? (
        <div style={{ textAlign: 'center', paddingTop: 60, color: '#8A968E' }}><div style={{ fontSize: 15, fontWeight: 700, color: '#1A2A21', marginBottom: 4 }}>Компания не указана</div><div style={{ fontSize: 13 }}>Обратитесь к вашему менеджеру</div></div>
      ) : contracts.length === 0 ? (
        <div style={{ textAlign: 'center', paddingTop: 60, color: '#8A968E' }}><div style={{ fontSize: 15, fontWeight: 700, color: '#1A2A21', marginBottom: 4 }}>Договоров нет</div><div style={{ fontSize: 13 }}>Здесь появятся ваши договоры</div></div>
      ) : (
        contracts.map(c => {
          const st = CONTRACT_STATUS[c.status] ?? CONTRACT_STATUS.draft
          return (
            <div key={c.id} style={{ background: '#fff', borderRadius: 16, marginBottom: 10, border: '1px solid #EDF1EF', padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 800, color: '#0E1E16' }}>{c.number}</div>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: st.bg, color: st.fg }}>{st.label}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 13, color: '#5C6B63' }}>
                <span>Заключён: <b style={{ color: '#1A2A21' }}>{fmtDate(c.signed_date)}</b></span>
                {c.valid_until && <span>Действует до: <b style={{ color: '#1A2A21' }}>{fmtDate(c.valid_until)}</b></span>}
                {c.amount != null && <span>Сумма: <b style={{ color: 'var(--primary)' }}>{fmtShort(c.amount)}</b></span>}
              </div>
              {c.note && <div style={{ fontSize: 12, color: '#8A968E', marginTop: 8 }}>{c.note}</div>}
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {c.file_url && (
                  <a href={c.file_url} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 11, border: '1.5px solid #EDF1EF', background: '#fff', color: '#1A2A21', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>📄 Открыть договор</a>
                )}
                {c.status !== 'signed' && c.status !== 'cancelled' && (
                  <button
                    onClick={() => setSigning(c)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 11, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    Подписать через eGov
                  </button>
                )}
              </div>
              {c.status === 'signed' && (
                <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 12, background: '#F4FBF6', border: '1px solid #DCEFE2' }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#2E7D32', marginBottom: 6 }}>✓ Подписано электронной подписью (eGov Mobile)</div>
                  {c.signed_at && <div style={{ fontSize: 12, color: '#5C6B63', marginBottom: 8 }}>Дата подписи: {new Date(c.signed_at).toLocaleString('ru-RU')}</div>}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {c.sign_cms && (
                      <button onClick={() => downloadCms(c.sign_cms!, `Договор-${c.number}.p7s`)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: '1.5px solid #DCEFE2', background: '#fff', color: '#1A2A21', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>⬇ Скачать подпись (.p7s)</button>
                    )}
                    <a href="https://sigex.kz" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: '1.5px solid #DCEFE2', background: '#fff', color: 'var(--primary)', fontWeight: 700, fontSize: 12, textDecoration: 'none' }}>🔎 Проверить на SIGEX</a>
                  </div>
                  <div style={{ fontSize: 11, color: '#8A968E', marginTop: 8, lineHeight: 1.5 }}>
                    Для проверки подлинности загрузите на sigex.kz (или egov.kz) сам документ и файл подписи .p7s — сервис покажет ФИО/ИИН подписанта, сертификат и результат проверки ЭЦП.
                  </div>
                </div>
              )}
            </div>
          )
        })
      )}
      {signing && (
        <ContractSignModal
          contract={signing}
          onClose={() => setSigning(null)}
          onSigned={() => { setSigning(null); qc.invalidateQueries({ queryKey: ['cabinet-contracts'] }) }}
        />
      )}
    </div>
  )
}

// ─── Profile Tab ──────────────────────────────────────────────────────────────
function ProfileTab({ profile }: { profile: Profile | null }) {
  const { data: manager } = useQuery({ queryKey: ['cabinet-manager', profile?.manager_id], queryFn: async () => { if (!profile?.manager_id) return null; const { data } = await supabase.from('profiles').select('name, phone, email').eq('id', profile.manager_id).single(); return data }, enabled: !!profile?.manager_id, staleTime: 120_000 })
  const row = (label: string, val: string | null | undefined, href?: string) => val ? (
    <div style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid #EDF1EF', fontSize: 14 }}>
      <span style={{ color: '#8A968E', width: 130, flexShrink: 0, fontWeight: 600 }}>{label}</span>
      {href ? <a href={href} style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 500 }}>{val}</a> : <span style={{ color: '#1A2A21' }}>{val}</span>}
    </div>
  ) : null
  return (
    <div className="cab-tab-pad">
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: '#0E1E16', marginBottom: 24 }}>Профиль</div>
      <div style={{ maxWidth: 560 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ width: 72, height: 72, borderRadius: 36, background: 'var(--primary)', color: '#fff', fontSize: 26, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>{(profile?.name ?? 'U').slice(0, 1).toUpperCase()}</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#0E1E16' }}>{profile?.name ?? 'Клиент'}</div>
          {profile?.company && <div style={{ fontSize: 14, color: '#5C6B63', marginTop: 4 }}>{profile.company}</div>}
        </div>
        <div style={{ background: '#fff', borderRadius: 16, padding: '0 20px', marginBottom: 16, border: '1px solid #EDF1EF' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#8A968E', padding: '14px 0 8px', textTransform: 'uppercase', letterSpacing: '.6px' }}>Мои данные</div>
          {row('Телефон', profile?.phone, profile?.phone ? `tel:${profile.phone}` : undefined)}
          {row('Email', profile?.email, profile?.email ? `mailto:${profile.email}` : undefined)}
          {row('Компания', profile?.company)}
        </div>
        {manager && (
          <div style={{ background: '#fff', borderRadius: 16, padding: '0 20px', marginBottom: 16, border: '1px solid #EDF1EF' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#8A968E', padding: '14px 0 8px', textTransform: 'uppercase', letterSpacing: '.6px' }}>Мой менеджер</div>
            {row('Имя', manager.name)}{row('Телефон', manager.phone, `tel:${manager.phone}`)}{row('Email', manager.email, `mailto:${manager.email}`)}
          </div>
        )}
        <button onClick={async () => { await supabase.auth.signOut(); window.location.href = '/login' }} style={{ width: '100%', padding: '13px', borderRadius: 14, border: 'none', background: '#FF3B3015', color: '#FF3B30', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>Выйти из аккаунта</button>
      </div>
    </div>
  )
}

// ─── Main Cabinet Page ────────────────────────────────────────────────────────

export default function CabinetPage() {
  const { lang, setLang } = useLanguage()
  // ?tab=orders — прямые ссылки из каталога /shop («Мои заказы», «Профиль»)
  const [tab, setTab] = useState<Tab>(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null
    return t && ['overview', 'catalog', 'locations', 'users', 'orders', 'contracts', 'profile'].includes(t) ? t : 'overview'
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [cart, setCart] = useState<CartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches)

  useEffect(() => { const mq = window.matchMedia('(max-width: 767px)'); const fn = (e: MediaQueryListEvent) => setIsMobile(e.matches); mq.addEventListener('change', fn); return () => mq.removeEventListener('change', fn) }, [])
  useEffect(() => { function onOut(e: MouseEvent) { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false) }; if (menuOpen) document.addEventListener('mousedown', onOut); return () => document.removeEventListener('mousedown', onOut) }, [menuOpen])

  const cartCount = cart.reduce((s, item) => s + item.qty, 0)

  function addToCart(product: Product, unitPrice: number, step = 1) { setCart(prev => { const ex = prev.find(i => i.product.id === product.id); if (ex) return prev.map(i => i.product.id === product.id ? { ...i, qty: i.qty + step } : i); return [...prev, { product, qty: step, unitPrice }] }) }
  function removeFromCart(productId: string, step = 1) { setCart(prev => { const ex = prev.find(i => i.product.id === productId); if (!ex) return prev; if (ex.qty <= step) return prev.filter(i => i.product.id !== productId); return prev.map(i => i.product.id === productId ? { ...i, qty: i.qty - step } : i) }) }

  function repeatOrder(items: any[]) {
    if (!Array.isArray(items) || items.length === 0) return
    const newCart: CartItem[] = items.map((it: any) => ({
      product: {
        id: it.id ?? `repeat-${it.sku ?? Math.random()}`,
        sku: it.sku ?? '',
        name: it.name ?? 'Товар',
        section_name: null,
        price: it.price ?? null,
        price_tp: it.price ?? null,
        price_top: null,
        box_qty: null,
        vol: null,
        is_active: true,
        stock: null,
        reserved_qty: null,
        image_url: null,
      },
      qty: it.qty ?? 1,
      unitPrice: it.price ?? 0,
    }))
    setCart(newCart)
    setCartOpen(true)
  }
  const { data: session } = useQuery({ queryKey: ['cabinet-session'], queryFn: async () => { const { data } = await supabase.auth.getSession(); return data.session }, staleTime: 300_000 })
  const { data: profile } = useQuery<Profile | null>({ queryKey: ['cabinet-profile', session?.user?.id], queryFn: async () => { if (!session?.user?.id) return null; const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single(); return data as Profile }, enabled: !!session?.user?.id, staleTime: 60_000 })

  const NAV: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Обзор' }, { id: 'catalog', label: 'Каталог' },
    { id: 'locations', label: 'Мои точки' }, { id: 'users', label: 'Пользователи' },
    { id: 'orders', label: 'Заказы' }, { id: 'contracts', label: 'Договоры' }, { id: 'profile', label: 'Профиль' },
  ]
  const BOTTOM_NAV = [
    { id: 'overview'  as Tab, label: 'Обзор',   icon: <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x={3} y={3} width={7} height={7} rx={1}/><rect x={14} y={3} width={7} height={7} rx={1}/><rect x={3} y={14} width={7} height={7} rx={1}/><rect x={14} y={14} width={7} height={7} rx={1}/></svg> },
    { id: 'catalog'   as Tab, label: 'Каталог', icon: <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1={3} y1={6} x2={21} y2={6}/><path d="M16 10a4 4 0 01-8 0"/></svg> },
    { id: 'locations' as Tab, label: 'Точки',   icon: <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx={12} cy={10} r={3}/></svg> },
    { id: 'orders'    as Tab, label: 'Заказы',  icon: <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1={16} y1={13} x2={8} y2={13}/><line x1={16} y1={17} x2={8} y2={17}/></svg> },
    { id: 'contracts' as Tab, label: 'Договоры', icon: <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/><path d="M9 15l2 2 4-4"/></svg> },
    { id: 'profile'   as Tab, label: 'Профиль', icon: <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx={12} cy={7} r={4}/></svg> },
  ]

  const sidebarContent = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '0 0 16px' }}>
      <div style={{ paddingTop: 'calc(20px + env(safe-area-inset-top, 0px))', paddingLeft: '18px', paddingRight: '18px', paddingBottom: '18px', borderBottom: '1px solid rgba(255,255,255,.08)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: 'linear-gradient(135deg,#10A35B,#7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16 }}>N</div>
          <div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: '#fff' }}>nstore<span style={{ color: '#5FC78F' }}>·B2B</span></div><div style={{ fontSize: 10, color: '#8FA899', marginTop: 1 }}>Кабинет клиента</div></div>
        </div>
      </div>
      <nav style={{ padding: '12px 10px', flex: 1, overflowY: 'auto' }}>
        {NAV.map(n => (
          <button key={n.id} onClick={() => { setTab(n.id); setSidebarOpen(false) }}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 11, marginBottom: 2, fontSize: 14, fontWeight: tab === n.id ? 700 : 500, cursor: 'pointer', border: 'none', fontFamily: 'inherit', textAlign: 'left', background: tab === n.id ? 'var(--primary)' : 'transparent', color: tab === n.id ? '#fff' : '#A9C0B2', transition: 'all .15s' }}
            onMouseEnter={e => { if (tab !== n.id) (e.currentTarget as HTMLElement).style.background = 'rgba(169,192,178,.1)' }}
            onMouseLeave={e => { if (tab !== n.id) (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
            {n.label}
            {n.id === 'catalog' && cartCount > 0 && <span style={{ marginLeft: 'auto', background: '#fff', color: 'var(--primary)', borderRadius: 8, padding: '1px 7px', fontSize: 11, fontWeight: 800 }}>{cartCount}</span>}
          </button>
        ))}
      </nav>
      <div style={{ paddingLeft: '10px', paddingRight: '10px', paddingBottom: 'env(safe-area-inset-bottom, 0px)', flexShrink: 0 }}>
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button onClick={() => setMenuOpen(v => !v)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px', borderRadius: 10, border: 'none', background: menuOpen ? 'rgba(16,163,91,.18)' : 'rgba(169,192,178,.08)', cursor: 'pointer', textAlign: 'left' }}
            onMouseEnter={e => { if (!menuOpen) (e.currentTarget as HTMLElement).style.background = 'rgba(169,192,178,.15)' }}
            onMouseLeave={e => { if (!menuOpen) (e.currentTarget as HTMLElement).style.background = 'rgba(169,192,178,.08)' }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: 'linear-gradient(135deg,#10A35B,#7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 800 }}>{(profile?.name ?? 'U')[0].toUpperCase()}</div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile?.name ?? '...'}</div>
              {profile?.company && <div style={{ fontSize: 10, color: '#8FA899', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.company}</div>}
            </div>
            <span style={{ color: '#8FA899', fontSize: 10 }}>{menuOpen ? '▲' : '▼'}</span>
          </button>
          {menuOpen && (
            <div style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, right: 0, zIndex: 1001, background: '#fff', border: '1px solid #EDF1EF', borderRadius: 14, overflow: 'hidden', boxShadow: '0 12px 40px rgba(0,0,0,.18)' }}>
              <div style={{ padding: '6px 0', borderBottom: '1px solid #EDF1EF' }}>
                {([{ lang: 'kz' as Lang, label: 'Қазақша' }, { lang: 'ru' as Lang, label: 'Русский' }]).map(o => (
                  <button key={o.lang} onClick={() => setLang(o.lang)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 14px', border: 'none', background: lang === o.lang ? '#EAF6EE' : 'transparent', cursor: 'pointer', textAlign: 'left', fontSize: 13 }}>
                    <span>{o.label}</span>
                  </button>
                ))}
              </div>
              <div style={{ padding: '6px 0' }}>
                <button onClick={async () => { await supabase.auth.signOut(); window.location.href = '/login' }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 14px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', color: '#DC2626', fontSize: 13, fontWeight: 600 }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#FF3B3010')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span>Выйти</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <>
    <Helmet>
      <title>Личный кабинет — Nstore</title>
      <meta name="robots" content="noindex, nofollow" />
    </Helmet>
    <div style={{ display: 'flex', height: '100dvh', overflow: 'hidden', background: '#EEF1F0', fontFamily: "'Onest', system-ui, sans-serif" }}>
      <style>{`
        @media (max-width: 1024px) { .cab-kpi4 { grid-template-columns: repeat(2, 1fr) !important; } .cab-split { grid-template-columns: 1fr !important; } }
        @media (max-width: 640px)  { .cab-kpi4 { grid-template-columns: 1fr 1fr !important; } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }

        /* Responsive tab padding */
        .cab-tab-pad { padding: 28px 32px; overflow-y: auto; height: 100%; background: #F6F8F7; box-sizing: border-box; }
        @media (max-width: 767px) { .cab-tab-pad { padding: 16px 14px 24px; } }

        /* Sidebar: in-flow on desktop, slide-in overlay on mobile */
        .cab-sidebar { width: 230px; flex-shrink: 0; background: #0C1A13; position: relative; }
        @media (max-width: 767px) {
          .cab-sidebar { position: fixed; top: 0; left: 0; bottom: 0; z-index: 200;
            transform: translateX(-100%); transition: transform .25s cubic-bezier(.4,0,.2,1); }
          .cab-sidebar.open { transform: translateX(0); }
        }

        /* Mobile sidebar backdrop */
        .cab-mob-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.5);
          z-index: 199; backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); }
        .cab-mob-overlay.visible { display: block; }
        @media (min-width: 768px) { .cab-mob-overlay { display: none !important; } }

        /* Mobile top bar */
        .cab-mob-bar { display: flex; flex-shrink: 0; align-items: flex-end; background: #fff;
          border-bottom: 1px solid rgba(0,0,0,.08); box-sizing: border-box;
          height: calc(52px + env(safe-area-inset-top, 0px));
          padding-top: env(safe-area-inset-top, 0px);
          padding-left: 16px; padding-right: 16px; padding-bottom: 8px; gap: 12px; }
        @media (min-width: 768px) { .cab-mob-bar { display: none !important; } }

        /* Desktop accent bar */
        .cab-desk-bar { height: 4px; flex-shrink: 0; background: linear-gradient(90deg,#10A35B,#7C3AED); }
        @media (max-width: 767px) { .cab-desk-bar { display: none !important; } }

        /* Desktop cart button */
        .cab-desk-cart { position: absolute; top: 12px; right: 20px; z-index: 50; }
        @media (max-width: 767px) { .cab-desk-cart { display: none !important; } }

        /* Bottom tab bar: always in DOM, CSS hides on desktop */
        .cab-tabbar { display: flex; flex-shrink: 0;
          background: rgba(255,255,255,.95);
          backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px);
          border-top: 1px solid rgba(0,0,0,.06);
          padding-bottom: env(safe-area-inset-bottom, 0px); z-index: 100; }
        @media (min-width: 768px) { .cab-tabbar { display: none !important; } }

        .cab-tabbtn { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 3px; padding: 8px 2px 6px; border: none; background: transparent; cursor: pointer;
          font-family: inherit; position: relative; -webkit-tap-highlight-color: transparent; min-width: 0; }
        .cab-tabbtn:active { opacity: .7; }
        .cab-tabbtn .tlbl { font-size: 10px; font-weight: 500; white-space: nowrap; overflow: hidden;
          text-overflow: ellipsis; max-width: 64px; }
        .cab-tabbtn.on .tlbl { font-weight: 700; }
        .cab-cart-bdg { position: absolute; top: 5px; left: 50%; margin-left: 4px;
          background: #DC2626; color: #fff; border-radius: 50%;
          width: 15px; height: 15px; font-size: 9px; font-weight: 800;
          display: flex; align-items: center; justify-content: center; pointer-events: none; }
      `}</style>

      {/* Mobile sidebar backdrop */}
      <div className={`cab-mob-overlay${sidebarOpen ? ' visible' : ''}`} onClick={() => setSidebarOpen(false)} />

      {/* Sidebar — always rendered; CSS positions it correctly per viewport */}
      <aside className={`cab-sidebar${sidebarOpen ? ' open' : ''}`}>
        {sidebarContent}
      </aside>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, position: 'relative' }}>
        {/* Mobile top bar — white, native-app style; CSS hides on desktop */}
        <div className="cab-mob-bar">
          <button onClick={() => setSidebarOpen(v => !v)}
            style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg,#10A35B,#7C3AED)', border: 'none', cursor: 'pointer', color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            N
          </button>
          <div style={{ flex: 1, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: '#0E1E16' }}>
            {NAV.find(n => n.id === tab)?.label}
          </div>
          {cartCount > 0 && (
            <button onClick={() => setCartOpen(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, border: 'none', background: 'var(--primary)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
              Заявка {cartCount}
            </button>
          )}
          <button onClick={() => setSettingsOpen(true)}
            style={{ width: 34, height: 34, borderRadius: 10, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#10A35B,#7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 800, flexShrink: 0 }}>
            {(profile?.name ?? 'U')[0].toUpperCase()}
          </button>
        </div>

        {/* Desktop accent bar — CSS hides on mobile */}
        <div className="cab-desk-bar" />

        {/* Desktop cart button — CSS hides on mobile */}
        {cartCount > 0 && (
          <div className="cab-desk-cart">
            <button onClick={() => setCartOpen(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 12, border: 'none', background: 'var(--primary)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700, boxShadow: '0 4px 16px rgba(16,163,91,.3)' }}>
              Заявка <span style={{ background: '#fff', color: 'var(--primary)', borderRadius: 6, padding: '1px 7px', fontSize: 12, fontWeight: 800 }}>{cartCount}</span>
            </button>
          </div>
        )}

        <main style={{ flex: 1, overflow: 'hidden' }}>
          {tab === 'overview'  && <OverviewTab  profile={profile ?? null} isMobile={isMobile} />}
          {tab === 'catalog'   && <CatalogTab   profile={profile ?? null} cart={cart} onAdd={addToCart} onRemove={removeFromCart} isMobile={isMobile} />}
          {tab === 'locations' && <LocationsTab profile={profile ?? null} />}
          {tab === 'users'     && <UsersTab     profile={profile ?? null} />}
          {tab === 'orders'    && <OrdersTab    profile={profile ?? null} onRepeatOrder={repeatOrder} />}
          {tab === 'contracts' && <ContractsTab profile={profile ?? null} />}
          {tab === 'profile'   && <ProfileTab   profile={profile ?? null} />}
        </main>

        {/* Bottom tab bar — always rendered; CSS hides on desktop via @media */}
        <nav className="cab-tabbar">
          {BOTTOM_NAV.map(n => (
            <button key={n.id} className={`cab-tabbtn${tab === n.id ? ' on' : ''}`}
              onClick={() => { navigator.vibrate?.(8); setTab(n.id) }}
              style={{ color: tab === n.id ? 'var(--primary)' : '#8A968E' }}>
              {n.icon}
              <span className="tlbl">{n.label}</span>
              {n.id === 'catalog' && cartCount > 0 && (
                <span className="cab-cart-bdg">{cartCount > 9 ? '9+' : cartCount}</span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {cartOpen && <CartDrawer cart={cart} profile={profile ?? null} onClose={() => setCartOpen(false)} onAdd={addToCart} onRemove={removeFromCart} onOrderSuccess={() => { setCart([]); setTab('orders') }} />}

      {/* Account / settings sheet — opened from the mobile top-bar avatar */}
      {settingsOpen && (
        <div onMouseDown={e => { if (e.target === e.currentTarget) setSettingsOpen(false) }}
          style={{ position: 'fixed', inset: 0, zIndex: 1002, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth: 480, background: '#fff', borderRadius: '20px 20px 0 0', padding: '10px 18px calc(18px + env(safe-area-inset-bottom, 0px))', boxShadow: '0 -12px 40px rgba(0,0,0,.2)' }}>
            <div style={{ width: 38, height: 4, borderRadius: 4, background: '#E2E8E4', margin: '0 auto 16px' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg,#10A35B,#7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 18, fontWeight: 800 }}>{(profile?.name ?? 'U')[0].toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0E1E16', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile?.name ?? '...'}</div>
                {profile?.company && <div style={{ fontSize: 12, color: '#8A968E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.company}</div>}
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#8A968E', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8 }}>Язык</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
              {([{ code: 'kz' as Lang, label: 'Қазақша' }, { code: 'ru' as Lang, label: 'Русский' }]).map(o => (
                <button key={o.code} onClick={() => setLang(o.code)}
                  style={{ flex: 1, padding: '11px 14px', borderRadius: 12, border: lang === o.code ? '1.5px solid var(--primary)' : '1.5px solid #E2E8E4', background: lang === o.code ? '#EAF6EE' : '#fff', color: lang === o.code ? 'var(--primary)' : '#5C6B63', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  {o.label}
                </button>
              ))}
            </div>
            <button onClick={async () => { await supabase.auth.signOut(); window.location.href = '/login' }}
              style={{ width: '100%', padding: '13px', borderRadius: 14, border: 'none', background: '#FF3B3015', color: '#FF3B30', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>Выйти из аккаунта</button>
          </div>
        </div>
      )}
    </div>
    </>
  )
}
