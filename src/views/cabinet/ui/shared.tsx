'use client'

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect,useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Profile {
  id: string; name: string | null; email: string | null; phone: string | null
  company: string | null; company_id: string | null; location_id: string | null
  manager_id: string | null; market_segment: string | null; notes: string | null
}

export interface Product {
  id: string; sku: string; name: string; section_name: string | null
  price: number | null; price_tp: number | null; price_top: number | null
  box_qty: number | null; vol: string | null; is_active: boolean; stock: number | null
  reserved_qty: number | null; image_url: string | null
}

export interface CartItem { product: Product; qty: number; unitPrice: number }

export interface OrderRow {
  id: string; title: string; order_status: string | null; total: number | null
  items: any; client_name: string | null; address: string | null; created_at: string
  delivery_state?: string | null
}

/* Клиентский вид статуса заявки */
export function deliveryView(
  o: { order_status: string | null },
  base: Record<string, { label: string; bg: string; fg: string }>,
) {
  if (o.order_status === 'delivering') {
    const st = base['delivering']
    return { bg: st?.bg ?? '#E0F7FA', fg: st?.fg ?? '#00695C', label: 'В доставке' }
  }
  return base[o.order_status ?? '']
}

export interface Discount { id: string; section_id: string; discount: number; note: string | null }
export interface Contract { price_list: string | null; discount_pct: number | null }

export interface Location {
  id: string; name: string; address: string | null; phone: string | null
  owner_id: string | null; company_id: string | null; created_at: string
  lat: number | null; lon: number | null
}

export interface TeamMember {
  id: string; name: string | null; email: string | null; role: string | null
  phone: string | null; location_id: string | null
}

export type Tab = 'overview' | 'catalog' | 'locations' | 'users' | 'orders' | 'profile'

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function fmt(n: number | null) {
  if (!n && n !== 0) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + ' млн ₸'
  return n.toLocaleString('ru-RU') + ' ₸'
}

export function fmtShort(n: number | null) {
  if (!n && n !== 0) return '—'
  return n.toLocaleString('ru-RU') + ' ₸'
}

export function buildWaMessage(cart: CartItem[], profile: Profile | null) {
  const lines = cart.map((item, i) =>
    `${i + 1}. ${item.product.name}${item.product.sku ? ` (арт. ${item.product.sku})` : ''} — ${item.qty} шт × ${fmtShort(item.unitPrice)} = ${fmtShort(item.unitPrice * item.qty)}`
  )
  const total = cart.reduce((s, item) => s + item.unitPrice * item.qty, 0)
  return encodeURIComponent(`Заказ от ${profile?.name ?? profile?.company ?? 'Клиента'}:\n\n${lines.join('\n')}\n\nИтого: ${fmtShort(total)}`)
}

export const SECTION_PALETTE = ['#EAF6EE', '#FFF1DD', '#E7F3F4', '#F1ECE5', '#F4EEFE', '#E3F2FD', '#FFF8E1', '#FCE4EC']

export function sectionColor(sectionName: string, sections: string[]): string {
  const idx = sections.indexOf(sectionName)
  return SECTION_PALETTE[idx >= 0 ? idx % SECTION_PALETTE.length : 0]
}

// ─── Geocoding ────────────────────────────────────────────────────────────────

export async function geocodeAddress(address: string): Promise<{ lat: number; lon: number } | null> {
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

export function LocationsMap({ locations }: { locations: Location[] }) {
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
