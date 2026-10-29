'use client'

import { supabase } from '@/shared/lib/supabase'
import { Button } from '@/shared/ui/ui'
import { geocodeAddress,Location,LocationsMap,Profile } from '@/views/cabinet/ui/shared'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { useRef,useState } from 'react'

export default function LocationsTab({ profile }: { profile: Profile | null }) {
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', address: '', phone: '', lat: null as number | null, lon: null as number | null })
  const [formError, setFormError] = useState('')
  const [geocodeStatus, setGeocodeStatus] = useState<'idle' | 'loading' | 'found' | 'notfound'>('idle')
  const geocodeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [inviteLocId, setInviteLocId] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [inviteCopied, setInviteCopied] = useState(false)

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
      if (coords) { setForm(f => ({ ...f, lat: coords.lat, lon: coords.lon })); setGeocodeStatus('found') }
      else setGeocodeStatus('notfound')
    }, 1000)
  }

  const createMut = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Введите название точки')
      if (!form.address.trim()) throw new Error('Введите адрес доставки')
      const { error } = await supabase.from('locations').insert({
        owner_id: profile?.id, company_id: profile?.company_id,
        name: form.name.trim(), address: form.address.trim(),
        phone: form.phone.trim() || null, lat: form.lat, lon: form.lon,
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

  const createInviteMut = useMutation({
    mutationFn: async (locationId: string) => {
      const token = crypto.randomUUID()
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      const { error } = await supabase.from('invites').insert({
        owner_id: profile?.id, location_id: locationId,
        token, role: 'client', used: false, expires_at: expiresAt,
      })
      if (error) throw error
      return token
    },
    onSuccess: (token, locationId) => {
      setInviteLocId(locationId)
      setInviteLink(`${window.location.origin}/register?invite=${token}`)
    },
    onError: (e: any) => alert('Ошибка: ' + e.message),
  })

  function copyInviteLink() {
    if (!inviteLink) return
    navigator.clipboard.writeText(inviteLink)
    setInviteCopied(true)
    setTimeout(() => setInviteCopied(false), 2500)
  }

  function closeInvite() { setInviteLocId(null); setInviteLink(null); setInviteCopied(false) }

  const inputSt: React.CSSProperties = { width: '100%', padding: '11px 14px', borderRadius: 10, border: '1.5px solid #E2E8E4', background: '#F8FAF9', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }
  const hasCoords = locations.some(l => l.lat && l.lon)

  return (
    <div style={{ padding: '28px 32px', overflowY: 'auto', height: '100%', background: '#F6F8F7' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: '#0E1E16' }}>Мои точки</div>
        <Button size="sm" font="inherit" onClick={() => { setCreating(true); setFormError(''); setGeocodeStatus('idle') }}
          style={{ height: 42, borderRadius: 12, paddingLeft: 18, paddingRight: 18 }}>
          + Добавить точку
        </Button>
      </div>

      {/* Map */}
      {!isLoading && hasCoords && <LocationsMap key={locations.length} locations={locations} />}

      {/* Invite modal */}
      {inviteLocId && inviteLink && (
        <>
          <div onClick={closeInvite} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, backdropFilter: 'blur(2px)' }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: '100%', maxWidth: 460, background: '#fff', borderRadius: 20, padding: '28px', zIndex: 1001, boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#0E1E16' }}>👥 Пригласить сотрудника</div>
              <button onClick={closeInvite} style={{ width: 32, height: 32, borderRadius: 9, border: '1.5px solid #EDF1EF', background: '#F9FAFB', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>
            <div style={{ fontSize: 13, color: '#5C6B63', marginBottom: 16, lineHeight: 1.6 }}>
              Отправьте эту ссылку сотруднику. После перехода по ссылке он зарегистрируется и автоматически будет привязан к этой точке. Ссылка действует <b>7 дней</b>.
            </div>
            <div style={{ background: '#F4F7F5', borderRadius: 10, padding: '12px 14px', marginBottom: 16, wordBreak: 'break-all', fontSize: 12, color: '#374B3E', border: '1px solid #EDF1EF', fontFamily: 'monospace' }}>
              {inviteLink}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={copyInviteLink} style={{ flex: 1, padding: '12px', borderRadius: 12, border: 'none', background: inviteCopied ? 'var(--primary)' : '#EAF6EE', color: inviteCopied ? '#fff' : 'var(--primary)', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .2s' }}>
                {inviteCopied ? '✓ Скопировано!' : '📋 Скопировать'}
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`Здравствуйте! Вас приглашают в B2B кабинет nstore. Пройдите регистрацию по ссылке: ${inviteLink}`)}`}
                target="_blank" rel="noopener noreferrer"
                style={{ flex: 1, padding: '12px', borderRadius: 12, border: '1.5px solid #25D36630', background: '#25D36615', color: '#128C7E', fontWeight: 700, fontSize: 13, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                💬 WhatsApp
              </a>
            </div>
          </div>
        </>
      )}

      {/* Create modal */}
      {creating && (
        <>
          <div onClick={() => setCreating(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, backdropFilter: 'blur(2px)' }} />
          <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: '100%', maxWidth: 460, background: '#fff', borderRadius: 20, padding: '28px 28px 24px', zIndex: 1001, boxShadow: '0 20px 60px rgba(0,0,0,.2)', maxHeight: '90dvh', overflowY: 'auto' }}>
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
              <input value={form.address} onChange={e => handleAddressChange(e.target.value)} placeholder="г. Астана, ул. Достык, 5" style={inputSt} />
            </div>
            <div style={{ marginBottom: 14, minHeight: 20 }}>
              {geocodeStatus === 'loading' && <span style={{ fontSize: 11, color: '#8A968E' }}>📍 Определяем координаты...</span>}
              {geocodeStatus === 'found' && <span style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 600 }}>✓ Адрес найден на карте ({form.lat?.toFixed(4)}, {form.lon?.toFixed(4)})</span>}
              {geocodeStatus === 'notfound' && <span style={{ fontSize: 11, color: '#F57C00' }}>⚠ Не удалось определить координаты — точка будет без метки на карте</span>}
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
          <div style={{ fontSize: 40, marginBottom: 12 }}>📍</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1A2A21', marginBottom: 4 }}>Нет точек</div>
          <div style={{ fontSize: 13 }}>Нажмите "+ Добавить точку" чтобы создать первую</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {locations.map(loc => (
            <div key={loc.id} style={{ background: '#fff', border: '1px solid #EDF1EF', borderRadius: 16, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: '#EAF6EE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>📍</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0E1E16' }}>{loc.name}</div>
                {loc.address && <div style={{ fontSize: 13, color: '#5C6B63', marginTop: 2 }}>{loc.address}</div>}
                {loc.phone && <div style={{ fontSize: 13, color: '#8A968E', marginTop: 2 }}>{loc.phone}</div>}
                {loc.lat && loc.lon && <div style={{ fontSize: 10, color: '#A6B0A9', marginTop: 3 }}>📌 {loc.lat.toFixed(4)}, {loc.lon.toFixed(4)}</div>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
                <span style={{ background: '#EAF6EE', color: 'var(--primary)', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700 }}>Активна</span>
                <button
                  onClick={() => createInviteMut.mutate(loc.id)}
                  disabled={createInviteMut.isPending}
                  style={{ padding: '6px 12px', borderRadius: 8, border: '1.5px solid #7C3AED30', background: '#F4EEFE', color: '#7C3AED', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                >
                  👥 Пригласить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
