'use client'

import { invalidateOrders } from '@/entities/order'
import { fmtMoney as fmtMoneyBase } from '@/shared/lib/format'
import { supabase } from '@/shared/lib/supabase'
import { Spinner } from '@/shared/ui/ui'
import { useCRM } from '@/views/crm/context/CRMContext'
import { useIsMobile } from '@/views/crm/shared/crmui'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect,useRef,useState } from 'react'

/* ── Fix default marker icons broken by bundlers ── */
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import iconUrl from 'leaflet/dist/images/marker-icon.png'
import shadowUrl from 'leaflet/dist/images/marker-shadow.png'
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl })

/* ── Types ── */
interface Logist { id: string; name: string | null; email: string }

interface DeliveryOrder {
  id: string
  title: string
  client_name: string | null
  client_phone: string | null
  address: string | null
  items: { name: string; qty: number; price: number; unit?: string }[] | null
  total: number | null
  order_status: string | null
  delivery_state: string | null
  logist_id: string | null
  invoice_no: string | null
  due_date: string | null
  created_at: string
  delivering_at: string | null
  sort_order: number | null
  location_id: string | null
}

interface SavedLocation { id: string; address: string | null; lat: number | null; lon: number | null }

interface Stop {
  id: string
  n: number
  addr: string
  client: string
  phone: string | null
  info: string
  invoiceNo: string | null
  orderDate: string
  deliveringAt: string | null
  latLon?: [number, number]
}

/* ── Constants ── */
const PIN_COLOR = '#F5A623'

function initials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?'
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}
function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/* ── Helpers ── */
/** null → скрыть сумму (вызовы полагаются на это). */
function fmtMoney(n: number | null): string | null {
  return n ? fmtMoneyBase(n) : null
}

function summarizeItems(o: DeliveryOrder): string {
  const parts: string[] = []
  if (Array.isArray(o.items) && o.items.length) {
    const qty = o.items.reduce((s, it) => s + (Number(it.qty) || 0), 0)
    parts.push(`${o.items.length} поз${qty ? ` · ${qty} шт` : ''}`)
  }
  const money = fmtMoney(o.total)
  if (money) parts.push(money)
  return parts.join(' · ')
}

/* ── Nominatim geocoder ── */
async function geocode(addr: string): Promise<[number, number] | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1`
    const res = await fetch(url, { headers: { 'Accept-Language': 'ru' } })
    const data = await res.json()
    if (!data[0]) return null
    return [parseFloat(data[0].lat), parseFloat(data[0].lon)]
  } catch {
    return null
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/* ── SVG circle marker ── */
function makeIcon(color: string, n: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
    <circle cx="16" cy="16" r="14" fill="${color}" stroke="#fff" stroke-width="2"/>
    <text x="16" y="21" text-anchor="middle" fill="#fff" font-size="13" font-weight="700" font-family="sans-serif">${n}</text>
  </svg>`
  return L.divIcon({ html: svg, className: '', iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -18] })
}

/* ── Map component ── */
function LeafletMap({ stops, height }: { stops: Stop[]; height: number }) {
  const containerRef   = useRef<HTMLDivElement>(null)
  const mapRef         = useRef<L.Map | null>(null)
  const routeLayerRef  = useRef<L.GeoJSON | null>(null)
  const coordsCacheRef = useRef<([number, number] | null)[]>([])
  const [routeBuilt, setRouteBuilt] = useState(false)
  const [routeInfo,  setRouteInfo]  = useState<{ distance: string; duration: string } | null>(null)
  const [building,   setBuilding]   = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!containerRef.current) return

    if (mapRef.current) {
      mapRef.current.remove()
      mapRef.current = null
      routeLayerRef.current = null
      coordsCacheRef.current = []
      setRouteBuilt(false)
      setRouteInfo(null)
    }

    const map = L.map(containerRef.current, { center: [51.1811, 71.4460], zoom: 12 })
    mapRef.current = map

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)

    ;(async () => {
      const coords: ([number, number] | null)[] = []
      const validCoords: [number, number][] = []

      for (let i = 0; i < stops.length; i++) {
        if (cancelled) return
        let c: [number, number] | null = stops[i].latLon ?? null
        if (!c && stops[i].addr) {
          if (i > 0) await sleep(1100)
          c = await geocode(stops[i].addr)
        }
        coords.push(c)
        if (c) {
          validCoords.push(c)
          const marker = L.marker(c, { icon: makeIcon(PIN_COLOR, stops[i].n) })
          marker.bindPopup(`
            <b>Точка ${stops[i].n}: ${stops[i].client}</b><br/>
            ${stops[i].addr}<br/>
            ${stops[i].info}<br/>
            <span style="color:#B25E00">В доставке</span>
          `)
          if (!cancelled) marker.addTo(map)
        }
      }

      if (!cancelled && validCoords.length > 0) {
        map.fitBounds(L.latLngBounds(validCoords), { padding: [40, 40] })
      }
      coordsCacheRef.current = coords
    })()

    return () => {
      cancelled = true
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops.map(s => s.id + s.addr).join('|')])

  async function buildRoute() {
    if (!mapRef.current) return
    setBuilding(true)
    try {
      if (routeLayerRef.current) {
        mapRef.current.removeLayer(routeLayerRef.current)
        routeLayerRef.current = null
      }

      let coords = coordsCacheRef.current
      if (coords.length === 0) {
        for (let i = 0; i < stops.length; i++) {
          let c: [number, number] | null = stops[i].latLon ?? null
          if (!c && stops[i].addr) {
            if (i > 0) await sleep(1100)
            c = await geocode(stops[i].addr)
          }
          coords.push(c)
        }
        coordsCacheRef.current = coords
      }

      const valid = coords.filter(Boolean) as [number, number][]
      if (valid.length < 2) { alert('Недостаточно точек с адресами для маршрута'); setBuilding(false); return }

      const waypoints = valid.map(([lat, lon]) => `${lon},${lat}`).join(';')
      const res = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${waypoints}?overview=full&geometries=geojson`
      )
      const data = await res.json()
      if (data.code !== 'Ok' || !data.routes[0]) throw new Error('Маршрут не найден')

      const route = data.routes[0]
      const layer = L.geoJSON(route.geometry, {
        style: { color: 'var(--primary)', weight: 5, opacity: 0.85 },
      }).addTo(mapRef.current)

      routeLayerRef.current = layer
      mapRef.current.fitBounds(layer.getBounds(), { padding: [40, 40] })
      setRouteBuilt(true)
      setRouteInfo({
        distance: `${(route.distance / 1000).toFixed(1)} км`,
        duration: `${Math.round(route.duration / 60)} мин`,
      })
    } catch (e: any) {
      alert(e.message || 'Не удалось построить маршрут')
    }
    setBuilding(false)
  }

  function clearRoute() {
    if (routeLayerRef.current && mapRef.current) {
      mapRef.current.removeLayer(routeLayerRef.current)
      routeLayerRef.current = null
    }
    setRouteBuilt(false)
    setRouteInfo(null)
  }

  return (
    <div style={{ position: 'relative', borderRadius: 16, border: '1px solid var(--bd)', overflow: 'hidden', isolation: 'isolate' }}>
      <div ref={containerRef} style={{ height, width: '100%' }} />
      <div style={{
        position: 'absolute', bottom: 12, left: 12, right: 12, zIndex: 1000,
        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
        pointerEvents: 'none',
      }}>
        <button onClick={buildRoute} disabled={building} style={{
          pointerEvents: 'all', padding: '10px 18px', borderRadius: 12, border: 'none',
          background: building ? 'var(--t3)' : 'var(--primary)', color: '#fff',
          fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12,
          cursor: building ? 'not-allowed' : 'pointer',
          boxShadow: '0 4px 16px rgba(0,0,0,.25)', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {building ? (
            <><Spinner size={14} color="#fff" track="rgba(255,255,255,.4)" />Строю маршрут…</>
          ) : 'Построить маршрут'}
        </button>
        {routeBuilt && (
          <button onClick={clearRoute} style={{
            pointerEvents: 'all', padding: '10px 14px', borderRadius: 12, border: 'none',
            background: 'rgba(255,255,255,.95)', color: 'var(--t2)',
            fontWeight: 700, fontSize: 12, cursor: 'pointer', boxShadow: '0 4px 16px rgba(0,0,0,.15)',
          }}>✕ Очистить</button>
        )}
        {routeInfo && (
          <div style={{
            pointerEvents: 'none', padding: '10px 14px', borderRadius: 12,
            background: 'rgba(255,255,255,.95)', boxShadow: '0 4px 16px rgba(0,0,0,.15)',
            fontSize: 12, fontWeight: 700, color: 'var(--t)', display: 'flex', gap: 12,
          }}>
            <span>{routeInfo.distance}</span>
            <span>{routeInfo.duration}</span>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Vertical drag-reorder (pointer, тач + мышь) ── */
function useReorder(getIds: () => string[], onReorder: (ids: string[]) => void, readonly?: boolean) {
  const argsRef = useRef({ getIds, onReorder, readonly }); argsRef.current = { getIds, onReorder, readonly }
  const [dragId, setDragId] = useState<string | null>(null)
  const [overIdx, setOverIdx] = useState(-1)
  const st = useRef({ id: null as string | null, overIdx: -1 })
  const move = useRef<(e: PointerEvent) => void>(() => {})
  const up = useRef<(e: PointerEvent) => void>(() => {})

  const init = useRef(false)
  if (!init.current) {
    init.current = true
    const detach = () => {
      window.removeEventListener('pointermove', move.current as EventListener)
      window.removeEventListener('pointerup', up.current as EventListener)
      window.removeEventListener('pointercancel', up.current as EventListener)
      document.body.style.userSelect = ''
      document.body.style.touchAction = ''
    }
    move.current = (e: PointerEvent) => {
      if (!st.current.id) return
      e.preventDefault()
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      const row = el?.closest('[data-stop-idx]') as HTMLElement | null
      if (row) {
        const idx = Number(row.getAttribute('data-stop-idx'))
        const r = row.getBoundingClientRect()
        const target = e.clientY < r.top + r.height / 2 ? idx : idx + 1
        st.current.overIdx = target
        setOverIdx(target)
      }
    }
    up.current = () => {
      const s = st.current
      if (s.id && s.overIdx >= 0) {
        const ids = argsRef.current.getIds()
        const from = ids.indexOf(s.id)
        if (from >= 0) {
          let to = s.overIdx
          const next = [...ids]
          next.splice(from, 1)
          if (to > from) to -= 1
          to = Math.max(0, Math.min(to, next.length))
          next.splice(to, 0, s.id)
          if (next.join(',') !== ids.join(',')) argsRef.current.onReorder(next)
        }
      }
      detach()
      st.current = { id: null, overIdx: -1 }
      setDragId(null)
      setOverIdx(-1)
    }
  }

  const handleProps = (id: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (argsRef.current.readonly) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      e.stopPropagation()
      st.current = { id, overIdx: -1 }
      setDragId(id)
      document.body.style.userSelect = 'none'
      document.body.style.touchAction = 'none'
      window.addEventListener('pointermove', move.current as EventListener, { passive: false })
      window.addEventListener('pointerup', up.current as EventListener)
      window.addEventListener('pointercancel', up.current as EventListener)
    },
  })

  return { dragId, overIdx, handleProps }
}

/* ── История действий по заявке ── */
interface TaskEvent { id: string; action: string; from_val: string | null; to_val: string | null; actor_id: string | null; created_at: string }

function eventText(e: TaskEvent, nameOf: (id: string | null) => string): string {
  const S: Record<string, string> = { new: 'Новая', confirmed: 'Подтверждена', picking: 'Сборка', delivering: 'Передана на доставку', review: 'Проверка', done: 'Выполнена', cancelled: 'Отменена' }
  const D: Record<string, string> = { waiting: 'Ожидает', going: 'В пути' }
  switch (e.action) {
    case 'created': return 'Создана заявка'
    case 'order_status':
      if (e.to_val === 'delivering') return 'Передана на доставку'
      if (e.to_val === 'review') return 'Курьер отметил доставку (на проверке)'
      if (e.to_val === 'done') return 'Доставка подтверждена менеджером'
      return `Статус: ${S[e.to_val ?? ''] ?? e.to_val}`
    case 'delivery_state': return `Доставка: ${D[e.to_val ?? ''] ?? e.to_val}`
    case 'logist': return e.to_val ? `Назначен логист: ${nameOf(e.to_val)}` : 'Логист снят'
    case 'cash': return e.to_val === 'received' ? 'Наличные получены' : 'Наличные: не получены'
    default: return e.action
  }
}

function HistoryList({ taskId }: { taskId: string }) {
  const { data: events = [], isLoading } = useQuery<TaskEvent[]>({
    queryKey: ['task-events', taskId],
    queryFn: async () => {
      const { data } = await supabase.from('crm_task_events')
        .select('id,action,from_val,to_val,actor_id,created_at')
        .eq('task_id', taskId).order('created_at', { ascending: false }).limit(50)
      return (data ?? []) as TaskEvent[]
    },
    staleTime: 10_000,
  })
  const ids = [...new Set(events.map(e => e.actor_id).filter(Boolean))] as string[]
  const { data: actors = [] } = useQuery<{ id: string; name: string | null; email: string }[]>({
    queryKey: ['event-actors', ids.slice().sort().join(',')],
    queryFn: async () => {
      if (!ids.length) return []
      const { data } = await supabase.from('profiles').select('id,name,email').in('id', ids)
      return data ?? []
    },
    enabled: ids.length > 0,
  })
  const nameOf = (id: string | null) => { const a = actors.find(x => x.id === id); return a ? (a.name ?? a.email) : '—' }

  if (isLoading) return <div style={{ fontSize: 12, color: 'var(--t3)', padding: '6px 2px' }}>Загрузка истории…</div>
  if (!events.length) return <div style={{ fontSize: 12, color: 'var(--t3)', padding: '6px 2px' }}>Пока нет событий.</div>
  return (
    <div style={{ marginTop: 8, borderTop: '1px dashed var(--bd)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {events.map(e => (
        <div key={e.id} style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--t2)' }}>
          <span style={{ color: 'var(--t3)', flexShrink: 0, minWidth: 92 }}>{fmtTime(e.created_at)}</span>
          <span style={{ flex: 1 }}>{eventText(e, nameOf)}</span>
          {e.actor_id && <span style={{ color: 'var(--t3)', flexShrink: 0 }}>{nameOf(e.actor_id)}</span>}
        </div>
      ))}
    </div>
  )
}

/* ── Main Component ── */
export default function LogisticsTab() {
  const isMobile = useIsMobile()
  const qc = useQueryClient()
  const { toast, can, profile } = useCRM()
  const isReadonly = can('logistics') === 'view'
  const [showMap, setShowMap] = useState(false)
  const [route, setRoute] = useState<string>('all') // 'all' | logistId | 'none'

  // Логист по умолчанию видит свои доставки (можно переключиться на другого)
  const appliedDefault = useRef(false)
  useEffect(() => {
    if (!appliedDefault.current && profile?.role === 'logist' && profile.id) {
      setRoute(profile.id)
      appliedDefault.current = true
    }
  }, [profile])
  const [logistMenu, setLogistMenu] = useState<string | null>(null) // id заявки с открытым меню логиста
  const [histFor, setHistFor] = useState<string | null>(null)       // id заявки с открытой историей

  const { data: logists = [] } = useQuery<Logist[]>({
    queryKey: ['logists'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('id,name,email').eq('role', 'logist').order('name')
      return data ?? []
    },
    staleTime: 300_000,
  })

  const { data: orders = [], isLoading } = useQuery<DeliveryOrder[]>({
    queryKey: ['logistics-delivering'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crm_tasks')
        .select('id,title,client_name,client_phone,address,items,total,order_status,delivery_state,logist_id,invoice_no,due_date,created_at,delivering_at,sort_order,location_id')
        .eq('task_type', 'order')
        .eq('order_status', 'delivering')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as DeliveryOrder[]
    },
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  })

  // Точки доставки, сохранённые для клиента (locations.lat/lon уже кэшированы геокодингом
  // в LocationsTab) — используем их вместо повторного геокодинга через Nominatim
  const locationIds = [...new Set(orders.map(o => o.location_id).filter(Boolean))] as string[]
  const { data: savedLocations = [] } = useQuery<SavedLocation[]>({
    queryKey: ['delivery-locations', locationIds.slice().sort().join(',')],
    queryFn: async () => {
      const { data } = await supabase.from('locations').select('id,address,lat,lon').in('id', locationIds)
      return (data ?? []) as SavedLocation[]
    },
    enabled: locationIds.length > 0,
    staleTime: 60_000,
  })
  const locationById = new Map(savedLocations.map(l => [l.id, l] as const))

  const KEY = ['logistics-delivering'] as const

  const patch = useMutation({
    mutationFn: async ({ id, fields }: { id: string; fields: Record<string, unknown> }) => {
      const { error } = await supabase.from('crm_tasks').update(fields).eq('id', id)
      if (error) throw error
    },
    onMutate: async ({ id, fields }) => {
      await qc.cancelQueries({ queryKey: KEY })
      const prev = qc.getQueryData<DeliveryOrder[]>(KEY)
      const leaving = fields.order_status && fields.order_status !== 'delivering'
      qc.setQueryData<DeliveryOrder[]>(KEY, old =>
        (old ?? [])
          .map(o => (o.id === id ? { ...o, ...fields } as DeliveryOrder : o))
          .filter(o => !(o.id === id && leaving))
      )
      return { prev }
    },
    onError: (_e, _v, ctx: any) => { qc.setQueryData(KEY, ctx?.prev); toast('Ошибка обновления') },
    onSuccess: (_r, { fields }) => {
      if (fields.order_status && fields.order_status !== 'delivering') {
        invalidateOrders(qc)
        toast('Передано менеджеру на проверку')
      }
    },
  })

  const reorderMut = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id, i) => supabase.from('crm_tasks').update({ sort_order: i }).eq('id', id)))
    },
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: KEY })
      const prev = qc.getQueryData<DeliveryOrder[]>(KEY)
      qc.setQueryData<DeliveryOrder[]>(KEY, old => {
        const pos = new Map(ids.map((id, i) => [id, i] as const))
        return [...(old ?? [])].map(o => (pos.has(o.id) ? { ...o, sort_order: pos.get(o.id)! } : o))
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      })
      return { prev }
    },
    onError: (_e, _v, ctx: any) => { qc.setQueryData(KEY, ctx?.prev); toast('Ошибка сортировки') },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['board-orders'] }) },
  })

  // Маршруты: Все + логисты + Без логиста
  const hasUnassigned = orders.some(o => !o.logist_id)
  const routeTabs: { id: string; label: string }[] = [
    { id: 'all', label: 'Все' },
    ...logists.map(l => ({ id: l.id, label: l.name ?? l.email.split('@')[0] })),
    ...(hasUnassigned ? [{ id: 'none', label: 'Без логиста' }] : []),
  ]

  const filtered = orders.filter(o =>
    route === 'all' ? true : route === 'none' ? !o.logist_id : o.logist_id === route
  )

  const stops: Stop[] = filtered.map((o, i) => {
    const loc = o.location_id ? locationById.get(o.location_id) : null
    const latLon: [number, number] | undefined = (loc?.lat != null && loc?.lon != null) ? [loc.lat, loc.lon] : undefined
    return {
      id: o.id,
      n: i + 1,
      addr: o.address || loc?.address || '',
      client: o.client_name ?? o.title ?? `Клиент ${i + 1}`,
      phone: o.client_phone,
      info: summarizeItems(o) || '—',
      invoiceNo: o.invoice_no,
      orderDate: o.created_at,
      deliveringAt: o.delivering_at,
      latLon,
    }
  })

  const { dragId, overIdx, handleProps } = useReorder(
    () => filtered.map(o => o.id),
    (ids) => reorderMut.mutate(ids),
    isReadonly,
  )

  const logistById = new Map(logists.map(l => [l.id, l.name ?? l.email.split('@')[0]] as const))
  const pad = isMobile ? '14px' : '28px'

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}>

      {/* Header */}
      <div style={{ background: 'var(--bg2)', padding: `16px ${pad}`, borderBottom: '1px solid var(--bd)' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: isMobile ? 18 : 22, color: 'var(--t)' }}>
          Доставка · {new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} · {orders.length} {orders.length === 1 ? 'доставка' : orders.length >= 2 && orders.length <= 4 ? 'доставки' : 'доставок'}
        </div>
        {routeTabs.length > 1 && (
          <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
            {routeTabs.map(t => {
              const cnt = t.id === 'all' ? orders.length : t.id === 'none' ? orders.filter(o => !o.logist_id).length : orders.filter(o => o.logist_id === t.id).length
              const sel = route === t.id
              const face = t.id === 'all' ? 'Все' : t.id === 'none' ? '—' : initials(t.label)
              return (
                <button key={t.id} onClick={() => setRoute(t.id)} title={`${t.label} · ${cnt}`} style={{
                  position: 'relative', width: 42, height: 42, borderRadius: '50%', border: 'none', cursor: 'pointer',
                  background: sel ? 'var(--primary)' : 'var(--bg3)', color: sel ? '#fff' : 'var(--t2)',
                  fontFamily: 'inherit', fontWeight: 700, fontSize: t.id === 'all' ? 12 : 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  boxShadow: sel ? '0 0 0 3px rgba(16,163,91,.25)' : 'none', transition: 'all .15s',
                }}>
                  {face}
                  <span style={{
                    position: 'absolute', top: -3, right: -3, minWidth: 18, height: 18, padding: '0 4px', borderRadius: 9,
                    background: sel ? '#0E7C46' : '#5B21D6', color: '#fff', fontSize: 10, fontWeight: 800,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--bg2)',
                  }}>{cnt}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ padding: `16px ${pad} 60px`, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {isLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '60px 0' }}>
            <Spinner size={26} />
            <span style={{ color: 'var(--t3)', fontSize: 14 }}>Загрузка…</span>
          </div>
        ) : orders.length === 0 ? (
          <div style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 16, padding: '40px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--t)', marginBottom: 6 }}>Нет заявок в доставке</div>
            <div style={{ fontSize: 13, color: 'var(--t3)', lineHeight: 1.5 }}>
              Перетащите заявку в колонку «В доставке» на доске (CRM · Доска) — она появится здесь автоматически.
            </div>
          </div>
        ) : (
          <>
            {isMobile && (
              <button onClick={() => setShowMap(p => !p)} style={{
                padding: '11px', borderRadius: 12, border: '1.5px solid var(--bd)',
                background: showMap ? 'var(--bg)' : 'var(--bg2)', color: 'var(--t2)',
                fontFamily: 'inherit', fontWeight: 700, fontSize: 13, cursor: 'pointer',
              }}>
                {showMap ? 'Скрыть карту' : 'Показать карту'}
              </button>
            )}

            {(!isMobile || showMap) && stops.length > 0 && <LeafletMap stops={stops} height={isMobile ? 300 : 420} />}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t2)', marginBottom: 2 }}>
                Точки доставки
              </div>
              {stops.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--t3)', padding: '10px 2px' }}>В этом маршруте пока нет заявок.</div>
              ) : stops.map((s, idx) => {
                const o = filtered[idx]
                const lname = o.logist_id ? (logistById.get(o.logist_id) ?? '?') : null
                const menuOpen = logistMenu === s.id
                const histOpen = histFor === s.id
                return (
                  <div key={s.id}>
                    {dragId && overIdx === idx && <div style={{ height: 3, borderRadius: 3, background: 'var(--primary)', margin: '3px 0' }} />}
                    <div data-stop-idx={idx} style={{
                      background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 14, padding: '12px 14px',
                      opacity: dragId === s.id ? 0.4 : 1, position: 'relative',
                      borderLeft: `4px solid ${PIN_COLOR}`,
                    }}>
                      {/* Верхняя строка: ручка · № · накладная · статус · логист */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {!isReadonly && (
                          <div {...handleProps(s.id)} title="Перетащить" style={{ cursor: 'grab', color: 'var(--t3)', fontSize: 16, lineHeight: 1, touchAction: 'none', userSelect: 'none' }}>⠿</div>
                        )}
                        <div style={{ width: 26, height: 26, borderRadius: '50%', background: PIN_COLOR, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 12 }}>{s.n}</div>
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: '#7C3AED', letterSpacing: '.02em' }}>
                          {s.invoiceNo || `#${s.id.slice(-6).toUpperCase()}`}
                        </span>
                        <span style={{ background: '#FFF1DD', color: '#B25E00', borderRadius: 7, padding: '3px 9px', fontSize: 11, fontWeight: 700, marginLeft: 'auto', flexShrink: 0 }}>В доставке</span>
                        {/* Логист — компактная иконка-аватар */}
                        <div style={{ position: 'relative', flexShrink: 0 }}>
                          <button
                            onClick={() => !isReadonly && setLogistMenu(menuOpen ? null : s.id)}
                            title={lname ? `Логист: ${lname}` : 'Назначить логиста'}
                            style={{
                              width: 28, height: 28, borderRadius: '50%', border: 'none', cursor: isReadonly ? 'default' : 'pointer',
                              background: lname ? '#5B21D6' : 'var(--bg3)', color: lname ? '#fff' : 'var(--t3)',
                              fontWeight: 700, fontSize: lname ? 11 : 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                          >{lname ? initials(lname) : '+'}</button>
                          {menuOpen && !isReadonly && (
                            <div style={{ position: 'absolute', top: 32, right: 0, zIndex: 20, background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,.18)', minWidth: 170, overflow: 'hidden' }}>
                              {logists.length === 0 && <div style={{ padding: '9px 12px', fontSize: 12, color: 'var(--t3)' }}>Нет логистов</div>}
                              {logists.map(l => {
                                const sel = o.logist_id === l.id
                                return (
                                  <button key={l.id} onClick={() => { patch.mutate({ id: s.id, fields: { logist_id: l.id } }); setLogistMenu(null) }}
                                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', background: sel ? 'var(--bg3)' : 'transparent', color: 'var(--t)', fontSize: 13, fontWeight: sel ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                                    {l.name ?? l.email.split('@')[0]}
                                  </button>
                                )
                              })}
                              {o.logist_id && (
                                <button onClick={() => { patch.mutate({ id: s.id, fields: { logist_id: null } }); setLogistMenu(null) }}
                                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', borderTop: '1px solid var(--bd)', background: 'transparent', color: '#DC2626', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                                  Снять логиста
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Адрес — главное */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--t)', lineHeight: 1.35 }}>{s.addr || 'Адрес не указан'}</div>
                        {s.latLon && (
                          <span title="Координаты сохранены — без повторного геокодинга" style={{ background: '#E6F6EE', color: '#0E7C46', borderRadius: 6, padding: '2px 6px', fontSize: 10, fontWeight: 800, flexShrink: 0 }}>GPS</span>
                        )}
                      </div>

                      {/* Клиент · телефон · дата справа */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 3 }}>
                        <span style={{ fontSize: 13, color: 'var(--t2)', fontWeight: 600 }}>{s.client}</span>
                        {s.phone && <a href={`tel:${s.phone}`} style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 700, textDecoration: 'none' }}>{s.phone}</a>}
                        {s.phone && (
                          <a href={`https://wa.me/${s.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
                            title="Написать в WhatsApp" onClick={e => e.stopPropagation()}
                            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: '50%', background: '#25D366', flexShrink: 0 }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.611-.916-2.206-.242-.58-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479s1.065 2.876 1.213 3.074c.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347M12.05 21.785h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.002-5.45 4.437-9.884 9.888-9.884a9.82 9.82 0 016.987 2.898 9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                          </a>
                        )}
                        <span style={{ fontSize: 11, color: 'var(--t3)', marginLeft: 'auto', flexShrink: 0 }}>{fmtDate(s.orderDate)}</span>
                      </div>

                      {/* Состав */}
                      {s.info && s.info !== '—' && <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 3 }}>{s.info}</div>}

                      {/* Действия */}
                      {!isReadonly && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center' }}>
                          <button onClick={() => patch.mutate({ id: s.id, fields: { order_status: 'review' } })}
                            title="Отметить доставленным"
                            style={{ width: 34, height: 34, borderRadius: '50%', border: '1.5px solid #2563EB', background: '#EFF6FF', color: '#2563EB', fontSize: 17, fontWeight: 800, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            ✓
                          </button>
                          <button onClick={() => setHistFor(histOpen ? null : s.id)}
                            style={{ marginLeft: 'auto', padding: '6px 10px', borderRadius: 9, border: '1px solid var(--bd)', background: 'transparent', color: 'var(--t2)', fontFamily: 'inherit', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                            {histOpen ? 'Скрыть историю' : 'История'}
                          </button>
                        </div>
                      )}

                      {histOpen && <HistoryList taskId={s.id} />}
                    </div>
                  </div>
                )
              })}
              {dragId && overIdx >= stops.length && <div style={{ height: 3, borderRadius: 3, background: 'var(--primary)', margin: '3px 0' }} />}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
