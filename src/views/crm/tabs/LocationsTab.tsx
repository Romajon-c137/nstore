'use client'

import { useLanguage } from '@/shared/i18n/LanguageContext'
import { supabase } from '@/shared/lib/supabase'
import { useCRM } from '@/views/crm/context/CRMContext'
import { Avatar,Modal,inputStyle,labelStyle,useCompaniesList,type CompanyLite } from '@/views/crm/shared/crmui'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect,useMemo,useRef,useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Location {
  id: string
  name: string
  address: string | null
  phone: string | null
  company_id: string | null
  created_at: string
  company_name?: string | null
  profiles_count?: number
  lat?: number | null
  lon?: number | null
}

type Company = CompanyLite

interface FormData {
  name: string
  address: string
  phone: string
  company_id: string
  lat: string
  lon: string
}

const EMPTY: FormData = { name: '', address: '', phone: '', company_id: '', lat: '', lon: '' }


// ─── Mini Map ─────────────────────────────────────────────────────────────────

function makeLocIcon(name: string) {
  const label = name.length > 12 ? name.slice(0, 11) + '…' : name
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28">
    <circle cx="14" cy="14" r="12" fill="#10A35B" stroke="#fff" stroke-width="2.5"/>
    <circle cx="14" cy="14" r="4" fill="#fff"/>
  </svg>`
  const html = `
    <div style="position:relative;display:flex;flex-direction:column;align-items:center;">
      ${svg}
      <div style="margin-top:2px;background:rgba(14,30,22,.75);color:#fff;font-size:9px;font-weight:700;padding:2px 5px;border-radius:4px;white-space:nowrap;max-width:90px;overflow:hidden;text-overflow:ellipsis;line-height:1.3;">${label}</div>
    </div>`
  return L.divIcon({ html, className: '', iconSize: [28, 44], iconAnchor: [14, 14], popupAnchor: [0, 4] })
}

function LocationsMiniMap({ locations }: { locations: Location[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)

  const withCoords = locations.filter(l => l.lat != null && l.lon != null)

  useEffect(() => {
    if (!containerRef.current) return
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }

    const map = L.map(containerRef.current, { center: [51.1811, 71.4460], zoom: 12, zoomControl: true, scrollWheelZoom: false })
    mapRef.current = map

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://openstreetmap.org">OSM</a>',
      maxZoom: 19,
    }).addTo(map)

    const coords: [number, number][] = []
    withCoords.forEach(loc => {
      const c: [number, number] = [loc.lat!, loc.lon!]
      coords.push(c)
      L.marker(c, { icon: makeLocIcon(loc.name) })
        .bindPopup(`<b>${loc.name}</b><br/><span style="font-size:12px;color:#5C6B63">${loc.address ?? ''}</span>`)
        .addTo(map)
    })

    if (coords.length > 1) map.fitBounds(L.latLngBounds(coords), { padding: [48, 48] })

    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null } }
  }, [withCoords.map(l => l.id + (l.lat ?? '')).join(',')])

  if (withCoords.length === 0) return null

  return (
    <div style={{ padding: '0 20px 16px', isolation: 'isolate' }}>
      <div style={{ borderRadius: 16, overflow: 'hidden', border: '1.5px solid var(--bd)', isolation: 'isolate' }}>
        <div ref={containerRef} style={{ height: 300, width: '100%' }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12, color: 'var(--t3)' }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--primary)', display: 'inline-block' }} />
        {withCoords.length} из {locations.length} точек с координатами · нажмите на точку для деталей
      </div>
    </div>
  )
}

// ─── Location Form ────────────────────────────────────────────────────────────

function LocationForm({
  initial, companies, onSave, onCancel, saving,
}: {
  initial: FormData
  companies: Company[]
  onSave: (d: FormData) => void
  onCancel: () => void
  saving: boolean
}) {
  const { tr } = useLanguage()
  const [d, setD] = useState<FormData>(initial)
  const set = (k: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setD(prev => ({ ...prev, [k]: e.target.value }))

  const inp = inputStyle
  const lbl = labelStyle

  return (
    <form onSubmit={e => { e.preventDefault(); onSave(d) }}>
      <div style={{ display: 'grid', gap: 14 }}>

        <div>
          <label style={lbl}>Название точки *</label>
          <input style={inp} value={d.name} onChange={set('name')} required placeholder="Кофейня Центр" />
        </div>

        <div>
          <label style={lbl}>Адрес</label>
          <input style={inp} value={d.address} onChange={set('address')} placeholder="ул. Абая 20" />
        </div>

        <div>
          <label style={lbl}>Координаты (из Google Maps)</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input style={inp} value={d.lat} onChange={set('lat')} placeholder="Широта  51.1801" />
            <input style={inp} value={d.lon} onChange={set('lon')} placeholder="Долгота  71.4460" />
          </div>
          <div style={{ fontSize: 11, color: '#8A968E', marginTop: 5 }}>
            Google Maps → правая кнопка мыши → скопировать координаты
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={lbl}>Телефон</label>
            <input style={inp} value={d.phone} onChange={set('phone')} placeholder="+7 700 000 0000" />
          </div>
          <div>
            <label style={lbl}>Компания</label>
            <select style={inp} value={d.company_id} onChange={set('company_id')}>
              <option value="">— без компании —</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
          <button type="button" onClick={onCancel}
            style={{ padding: '8px 18px', borderRadius: 9, border: '1.5px solid var(--bd)', background: 'var(--bg3)', color: 'var(--t)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            {tr('cancel')}
          </button>
          <button type="submit" disabled={saving}
            style={{ padding: '8px 20px', borderRadius: 9, border: 'none', background: 'var(--primary)', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, opacity: saving ? .6 : 1 }}>
            {saving ? tr('loading') : tr('save')}
          </button>
        </div>
      </div>
    </form>
  )
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

function LocationDetailModal({
  loc, companies, onEdit, onDelete, onClose,
}: {
  loc: Location
  companies: Company[]
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const { tr } = useLanguage()
  const { data: clients = [] } = useQuery({
    queryKey: ['location-clients', loc.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, phone, email, role')
        .eq('location_id', loc.id)
        .order('name')
        .limit(30)
      if (error) throw error
      return data ?? []
    },
    staleTime: 30_000,
  })

  const { data: recentOrders = [] } = useQuery({
    queryKey: ['location-orders', loc.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crm_tasks')
        .select('id, title, order_status, total, created_at, client_name')
        .eq('location_id', loc.id)
        .eq('task_type', 'order')
        .order('created_at', { ascending: false })
        .limit(10)
      if (error) throw error
      return data ?? []
    },
    staleTime: 30_000,
  })

  const company = companies.find(c => c.id === loc.company_id)

  const STATUS_COLOR: Record<string, string> = { new: '#FF9500', confirmed: '#007AFF', done: '#2E9E6B' }
  const STATUS_LABEL: Record<string, string> = { new: 'Новый', confirmed: 'Подтверждён', done: 'Выполнен' }

  const row: React.CSSProperties = { display: 'flex', gap: 8, fontSize: 13, padding: '7px 0', borderBottom: '1px solid var(--bd)' }
  const key: React.CSSProperties = { color: 'var(--t2)', width: 90, flexShrink: 0, fontWeight: 600 }

  return (
    <Modal onClose={onClose}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 20 }}>
        <Avatar id={loc.id} name={loc.name} size={52} radius={14} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 2 }}>{loc.name}</div>
          {loc.address && <div style={{ fontSize: 13, color: 'var(--t3)' }}>{loc.address}</div>}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--t3)', padding: 4 }}>×</button>
      </div>

      {/* Info */}
      <div style={{ marginBottom: 18 }}>
        {loc.phone && <div style={row}><span style={key}>Телефон</span><a href={`tel:${loc.phone}`} style={{ color: 'var(--primary)', textDecoration: 'none' }}>{loc.phone}</a></div>}
        {company && <div style={row}><span style={key}>Компания</span><span>{company.name}</span></div>}
        <div style={row}><span style={key}>Добавлена</span><span style={{ color: 'var(--t3)' }}>{new Date(loc.created_at).toLocaleDateString('ru-RU')}</span></div>
      </div>

      {/* Clients */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.5px' }}>
          {tr('locationClients')} ({clients.length})
        </div>
        {clients.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--t3)' }}>{tr('locationNoClients')}</div>
        ) : clients.slice(0, 5).map(cl => (
          <div key={cl.id} style={{ display: 'flex', gap: 10, fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--bd)' }}>
            <span style={{ flex: 1, color: 'var(--t)' }}>{cl.name}</span>
            {cl.phone && <span style={{ color: 'var(--t3)' }}>{cl.phone}</span>}
          </div>
        ))}
        {clients.length > 5 && <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 6 }}>+{clients.length - 5} ещё</div>}
      </div>

      {/* Recent orders */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.5px' }}>
          {tr('locationOrders')}
        </div>
        {recentOrders.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--t3)' }}>{tr('locationNoOrders')}</div>
        ) : recentOrders.map((o: any) => (
          <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--bd)', fontSize: 13 }}>
            <span style={{ flex: 1, color: 'var(--t)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.client_name ?? o.title}</span>
            {o.order_status && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: (STATUS_COLOR[o.order_status] ?? '#8E8EA0') + '20', color: STATUS_COLOR[o.order_status] ?? '#8E8EA0' }}>
                {STATUS_LABEL[o.order_status] ?? o.order_status}
              </span>
            )}
            {o.total && <span style={{ fontWeight: 700, color: 'var(--primary)', flexShrink: 0 }}>{o.total.toLocaleString('ru-RU')} ₸</span>}
          </div>
        ))}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onEdit} style={{ flex: 1, padding: '9px 16px', borderRadius: 10, border: '1.5px solid var(--bd)', background: 'var(--bg3)', color: 'var(--t)', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
          {tr('edit')}
        </button>
        <button onClick={onDelete} style={{ padding: '9px 16px', borderRadius: 10, border: 'none', background: '#FF3B3015', color: '#FF3B30', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
          {tr('delete')}
        </button>
      </div>
    </Modal>
  )
}

// ─── Location Card ────────────────────────────────────────────────────────────

function LocationCard({ loc, onClick }: { loc: Location; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--bg2)', borderRadius: 14, padding: '16px', cursor: 'pointer',
        border: '1.5px solid var(--bd)', transition: 'box-shadow .15s, transform .1s',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 24px rgba(0,0,0,.1)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none' }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Avatar id={loc.id} name={loc.name} size={44} radius={12} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--t)', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{loc.name}</div>
          {loc.address && (
            <div style={{ fontSize: 12, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {loc.address}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {loc.company_name && (
          <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, background: 'var(--primary)1A', color: 'var(--primary)' }}>
            {loc.company_name}
          </span>
        )}
        {loc.phone && (
          <span style={{ fontSize: 12, color: 'var(--t3)' }}>{loc.phone}</span>
        )}
        {(loc.profiles_count ?? 0) > 0 && (
          <span style={{ fontSize: 11, color: 'var(--t3)', marginLeft: 'auto' }}>
            {loc.profiles_count}
          </span>
        )}
        <span style={{ fontSize: 10, fontWeight: 700, marginLeft: 'auto', padding: '2px 7px', borderRadius: 6,
          background: loc.lat != null ? '#E6F6EE' : '#F2F5F3',
          color: loc.lat != null ? '#0E7C46' : '#B0BCB5' }}>
          {loc.lat != null ? 'GPS' : '—'}
        </span>
      </div>
    </div>
  )
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

export default function LocationsTab() {
  const qc = useQueryClient()
  const { toast } = useCRM()
  const { tr } = useLanguage()

  const [search, setSearch]     = useState('')
  const [selected, setSelected] = useState<Location | null>(null)
  const [editing, setEditing]   = useState<Location | null>(null)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving]     = useState(false)

  const { data: companies = [] } = useCompaniesList()

  const { data: locations = [], isLoading, isError } = useQuery<Location[]>({
    queryKey: ['locations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('locations')
        .select(`id, name, address, phone, company_id, created_at, lat, lon, companies(name)`)
        .order('name')
      if (error) throw error

      const ids = (data ?? []).map((l: any) => l.id)
      let counts: Record<string, number> = {}
      if (ids.length > 0) {
        const { data: pData } = await supabase
          .from('profiles')
          .select('location_id')
          .in('location_id', ids)
        ;(pData ?? []).forEach((p: any) => {
          counts[p.location_id] = (counts[p.location_id] ?? 0) + 1
        })
      }

      return (data ?? []).map((l: any) => ({
        ...l,
        company_name: l.companies?.name ?? null,
        profiles_count: counts[l.id] ?? 0,
      })) as Location[]
    },
    staleTime: 30_000,
  })

  const createMut = useMutation({
    mutationFn: async (d: FormData) => {
      setSaving(true)
      const lat = d.lat.trim() ? parseFloat(d.lat.trim()) : null
      const lon = d.lon.trim() ? parseFloat(d.lon.trim()) : null
      const { error } = await supabase.from('locations').insert({
        name: d.name.trim(),
        address: d.address.trim() || null,
        phone: d.phone.trim() || null,
        company_id: d.company_id || null,
        ...(lat != null && lon != null ? { lat, lon } : {}),
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations'] })
      setCreating(false)
      setSaving(false)
      toast(tr('locationAdded'))
    },
    onError: (e: any) => { setSaving(false); toast(e.message) },
  })

  const updateMut = useMutation({
    mutationFn: async ({ id, d }: { id: string; d: FormData }) => {
      setSaving(true)
      const lat = d.lat.trim() ? parseFloat(d.lat.trim()) : null
      const lon = d.lon.trim() ? parseFloat(d.lon.trim()) : null
      const { error } = await supabase.from('locations').update({
        name: d.name.trim(),
        address: d.address.trim() || null,
        phone: d.phone.trim() || null,
        company_id: d.company_id || null,
        lat: lat ?? null,
        lon: lon ?? null,
      }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations'] })
      setEditing(null)
      setSelected(null)
      setSaving(false)
      toast(tr('locationUpdated'))
    },
    onError: (e: any) => { setSaving(false); toast(e.message) },
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('locations').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['locations'] })
      setSelected(null)
      toast(tr('locationDeleted'))
    },
    onError: (e: any) => toast(e.message),
  })

  const handleDelete = (id: string) => {
    if (!confirm(tr('locationDeleteConfirm'))) return
    deleteMut.mutate(id)
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return locations
    return locations.filter(l =>
      l.name.toLowerCase().includes(q) ||
      (l.address ?? '').toLowerCase().includes(q) ||
      (l.company_name ?? '').toLowerCase().includes(q)
    )
  }, [locations, search])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, overflowX: 'hidden', background: 'var(--bg)' }}>

      {/* Top bar */}
      <div style={{ padding: '16px 20px', background: 'var(--bg2)', borderBottom: '1px solid var(--bd)', flexShrink: 0, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={tr('locationsSearch')}
            style={{ width: '100%', padding: '8px 12px 8px 32px', borderRadius: 10, border: '1.5px solid var(--bd)', background: 'var(--bg3)', color: 'var(--t)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ fontSize: 13, color: 'var(--t3)' }}>
          {filtered.length !== locations.length ? `${filtered.length} из ${locations.length}` : `${locations.length} точек`}
        </div>

        <button onClick={() => setCreating(true)}
          style={{ padding: '8px 16px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
          {tr('locationsAdd')}
        </button>
      </div>

      {/* Scrollable content: map + locations scroll together */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <LocationsMiniMap locations={locations} />
        <div style={{ padding: '0 20px 16px' }}>
        {isLoading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ height: 110, borderRadius: 14, background: 'var(--bg2)', animation: 'pulse 1.4s ease-in-out infinite', animationDelay: `${i * .08}s` }} />
            ))}
          </div>
        ) : isError ? (
          <div style={{ paddingTop: 60, textAlign: 'center', color: '#FF3B30', fontSize: 14 }}>Ошибка загрузки точек</div>
        ) : filtered.length === 0 ? (
          <div style={{ paddingTop: 60, textAlign: 'center', color: 'var(--t3)', fontSize: 14 }}>
            {tr('locationsNoData')}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {filtered.map(loc => (
              <LocationCard key={loc.id} loc={loc} onClick={() => setSelected(loc)} />
            ))}
          </div>
        )}
        </div>
      </div>

      {/* Detail modal */}
      {selected && !editing && (
        <LocationDetailModal
          loc={selected}
          companies={companies}
          onEdit={() => setEditing(selected)}
          onDelete={() => handleDelete(selected.id)}
          onClose={() => setSelected(null)}
        />
      )}

      {/* Edit modal */}
      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <Avatar id={editing.id} name={editing.name} size={40} radius={12} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{tr('locationEditTitle')}</div>
              <div style={{ fontSize: 12, color: 'var(--t3)' }}>{editing.name}</div>
            </div>
            {editing.lat != null && editing.lon != null ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#E6F6EE', borderRadius: 8, padding: '5px 10px', fontSize: 11, fontWeight: 700, color: '#0E7C46' }}>
                {editing.lat.toFixed(4)}, {editing.lon.toFixed(4)}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#FFF1DD', borderRadius: 8, padding: '5px 10px', fontSize: 11, fontWeight: 700, color: '#B25E00' }}>
                Нет координат
              </div>
            )}
          </div>
          <LocationForm
            initial={{ name: editing.name, address: editing.address ?? '', phone: editing.phone ?? '', company_id: editing.company_id ?? '', lat: editing.lat?.toString() ?? '', lon: editing.lon?.toString() ?? '' }}
            companies={companies}
            onSave={d => updateMut.mutate({ id: editing.id, d })}
            onCancel={() => setEditing(null)}
            saving={saving}
          />
        </Modal>
      )}

      {/* Create modal */}
      {creating && (
        <Modal onClose={() => setCreating(false)}>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 20 }}>{tr('locationNewTitle')}</div>
          <LocationForm
            initial={EMPTY}
            companies={companies}
            onSave={d => createMut.mutate(d)}
            onCancel={() => setCreating(false)}
            saving={saving}
          />
        </Modal>
      )}
    </div>
  )
}
