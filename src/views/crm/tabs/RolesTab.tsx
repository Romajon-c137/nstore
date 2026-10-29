'use client'

import { useCurrentUser } from '@/entities/session'
import { supabase } from '@/shared/lib/supabase'
import { Button,InfoDot } from '@/shared/ui/ui'
import { Segmented,useIsMobile } from '@/views/crm/shared/crmui'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { useMemo,useState } from 'react'
import { createPortal } from 'react-dom'

/* ── Mobile hook ── */

/* ── Types ── */
interface Profile {
  id: string
  name: string | null
  role: string
  email: string | null
  phone: string | null
  company: string | null
  notes: string | null
  market_segment: string | null
  relation_status: string | null
  company_id: string | null
  location_id: string | null
  manager_id: string | null
  parent_id: string | null
  created_at: string | null
}

interface RolePerm {
  id: string
  role: RoleKey
  module: string
  access_level: AccessLevel
}

type RoleKey = 'admin' | 'manager' | 'logist' | 'client'
type AccessLevel = 'full' | 'view' | 'none'

/* ── Constants ── */
const ROLE_STYLES: Record<RoleKey, { label: string; bg: string; fg: string; desc: string }> = {
  admin:   { label: 'Админ',    bg: 'rgba(220,38,38,.12)',  fg: '#DC2626', desc: 'Полный доступ ко всем модулям' },
  manager: { label: 'Менеджер', bg: 'rgba(16,163,91,.12)',  fg: 'var(--primary)', desc: 'Заявки, клиенты, задачи, WA'  },
  logist:  { label: 'Логист',   bg: 'rgba(8,145,178,.12)',  fg: '#0891B2', desc: 'Логистика, точки, просмотр'   },
  client:  { label: 'Клиент',   bg: 'rgba(124,58,237,.10)', fg: '#7C3AED', desc: 'Только личный кабинет B2B'    },
}

const MODULES: { key: string; label: string }[] = [
  { key: 'dash',      label: 'Дашборд'   },
  { key: 'sales',     label: 'Аналитика продаж' },
  { key: 'deliveries', label: 'Доставки (водители)' },
  { key: 'orders',    label: 'Заявки'    },
  { key: 'board',     label: 'Доска'     },
  { key: 'clients',   label: 'Клиенты'   },
  { key: 'locations', label: 'Точки'     },
  { key: 'companies', label: 'Компании'  },
  { key: 'logistics', label: 'Логистика' },
  { key: 'whatsapp',  label: 'WhatsApp'  },
  { key: 'content',   label: 'Контент'   },
  { key: 'products1c', label: 'Товары 1С' },
  { key: 'balance',   label: 'Финансы'   },
  { key: 'roles',     label: 'Роли'      },
]

const ACCESS_CYCLE: AccessLevel[] = ['full', 'view', 'none']

const SEGMENTS = [
  { id: 'horeca',    label: 'HoReCa'    },
  { id: 'office',    label: 'Офис'      },
  { id: 'wholesale', label: 'Опт'       },
  { id: 'pharmacy',  label: 'Аптека'    },
  { id: 'shop',      label: 'Магазин'   },
  { id: 'autosalon', label: 'Автосалон' },
]

const RELATION_STATUSES = [
  { id: 'cold',   label: 'Холодный', color: '#0891B2' },
  { id: 'warm',   label: 'Тёплый',   color: '#D97706' },
  { id: 'active', label: 'Активный', color: 'var(--primary)' },
  { id: 'lost',   label: 'Потерян',  color: '#DC2626' },
]

/* ── AccessBadge — shows level as styled pill ── */
function AccessBadge({ level, editable, onClick }: { level: AccessLevel; editable?: boolean; onClick?: () => void }) {
  const cfg = {
    full: { label: 'Полный', bg: '#E6F6EE', color: '#0E7C46', border: '#B6E8CE' },
    view: { label: 'Просмотр', bg: '#F0F4FF', color: '#3B5FC0', border: '#C0CFFF' },
    none: { label: 'Нет',    bg: 'var(--bg3)', color: 'var(--t3)', border: 'var(--bd)' },
  }[level]
  return (
    <button
      onClick={onClick}
      style={{
        padding: '5px 11px', borderRadius: 20, fontSize: 11, fontWeight: 700,
        background: cfg.bg, color: cfg.color, border: `1.5px solid ${cfg.border}`,
        cursor: editable ? 'pointer' : 'default',
        fontFamily: 'inherit', whiteSpace: 'nowrap',
        minHeight: 32, display: 'inline-flex', alignItems: 'center',
        WebkitTapHighlightColor: 'transparent',
      }}
      title={editable ? 'Нажмите чтобы изменить' : undefined}
    >
      {cfg.label}
    </button>
  )
}

/* ── Field ── */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.05em' }}>
        {label}
      </div>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 14px', borderRadius: 12,
  border: '1.5px solid var(--bd)', fontSize: 14, fontFamily: 'inherit',
  outline: 'none', boxSizing: 'border-box', color: 'var(--t)', background: 'var(--bg2)',
  WebkitAppearance: 'none', appearance: 'none',
}

/* ── Edit User Modal ── */
function EditUserModal({ user, managers, onClose, permMap, isAdmin }: {
  user: Profile
  managers: Profile[]
  onClose: () => void
  permMap: Record<string, Record<string, AccessLevel>>
  isAdmin: boolean
}) {
  const qc  = useQueryClient()
  const isMobile = useIsMobile()

  const [form, setForm] = useState({
    name:            user.name ?? '',
    phone:           user.phone ?? '',
    company:         user.company ?? '',
    notes:           user.notes ?? '',
    market_segment:  user.market_segment ?? '',
    relation_status: user.relation_status ?? '',
    manager_id:      user.manager_id ?? '',
    role:            user.role as RoleKey,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')
  const [tab, setTab]       = useState<'info' | 'role'>('info')

  const { mutate } = useMutation({
    mutationFn: async () => {
      setSaving(true)
      const { error } = await supabase.from('profiles').update({
        name:            form.name || null,
        phone:           form.phone || null,
        company:         form.company || null,
        notes:           form.notes || null,
        market_segment:  form.market_segment || null,
        relation_status: form.relation_status || null,
        manager_id:      form.manager_id || null,
        role:            form.role,
      }).eq('id', user.id)
      setSaving(false)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles-roles'] })
      onClose()
    },
    onError: (e: any) => { setSaving(false); setErr(e.message) },
  })

  const set = (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(p => ({ ...p, [key]: e.target.value }))

  const roleStyle = ROLE_STYLES[form.role] ?? ROLE_STYLES.client
  const createdAt = user.created_at
    ? new Date(user.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : '—'

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 3000,
        display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
        padding: isMobile ? 0 : 16,
      }}
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: 'var(--bg2)',
        borderRadius: isMobile ? '20px 20px 0 0' : 20,
        width: '100%', maxWidth: isMobile ? '100%' : 560,
        boxShadow: '0 32px 80px rgba(0,0,0,.3)',
        overflow: 'hidden',
        maxHeight: isMobile ? '92dvh' : '90dvh',
        display: 'flex', flexDirection: 'column',
      }}>

        {/* Header */}
        <div style={{ padding: isMobile ? '20px 20px 0' : '24px 28px 0', flexShrink: 0 }}>
          {/* Mobile drag handle */}
          {isMobile && (
            <div style={{ width: 40, height: 4, background: '#D9DFD9', borderRadius: 99, margin: '0 auto 16px' }} />
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                background: `linear-gradient(135deg, ${roleStyle.fg}, #10A35B)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontWeight: 800, fontSize: 17,
              }}>
                {(form.name || user.email || '?')[0].toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--t)' }}>{form.name || '—'}</div>
                <div style={{ fontSize: 12, color: 'var(--t2)' }}>{user.email}</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                  <span style={{ background: roleStyle.bg, color: roleStyle.fg, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
                    {ROLE_STYLES[form.role]?.label ?? form.role}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--t3)' }}>с {createdAt}</span>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'var(--bg3)', border: 'none', borderRadius: 10,
                minWidth: 40, minHeight: 40, fontSize: 20, cursor: 'pointer',
                color: 'var(--t2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                WebkitTapHighlightColor: 'transparent',
              }}
            >×</button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--bd)' }}>
            {(['info', 'role'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  flex: 1, padding: '12px 16px', border: 'none', background: 'transparent',
                  cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                  color: tab === t ? 'var(--primary)' : 'var(--t3)',
                  borderBottom: `2px solid ${tab === t ? 'var(--primary)' : 'transparent'}`,
                  marginBottom: -1, transition: 'all .15s',
                  minHeight: 44, WebkitTapHighlightColor: 'transparent',
                }}
              >
                {t === 'info' ? 'Данные' : 'Роль и доступ'}
              </button>
            ))}
          </div>
        </div>

        {/* Body — scrollable */}
        <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '20px 20px' : '24px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>

          {tab === 'info' && (
            <>
              <Field label="Email (логин)">
                <div style={{ ...inputStyle, background: 'var(--bg3)', color: 'var(--t3)', display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'none' }}>
                  <span style={{ fontSize: 13 }}>{user.email ?? '—'}</span>
                </div>
              </Field>

              <Field label="ID">
                <div style={{ ...inputStyle, background: 'var(--bg3)', color: 'var(--t3)', fontFamily: 'monospace', fontSize: 10, wordBreak: 'break-all' }}>
                  {user.id}
                </div>
              </Field>

              <Field label="Имя / ФИО">
                <input value={form.name} onChange={set('name')} placeholder="Имя пользователя"
                  style={inputStyle}
                  onFocus={e => (e.target.style.borderColor = 'var(--primary)')}
                  onBlur={e => (e.target.style.borderColor = 'var(--bd)')} />
              </Field>

              <Field label="Телефон">
                <input type="tel" value={form.phone} onChange={set('phone')}
                  placeholder="+7 (___) ___-__-__" style={inputStyle}
                  onFocus={e => (e.target.style.borderColor = 'var(--primary)')}
                  onBlur={e => (e.target.style.borderColor = 'var(--bd)')} />
              </Field>

              <Field label="Компания">
                <input value={form.company} onChange={set('company')}
                  placeholder="Название компании" style={inputStyle}
                  onFocus={e => (e.target.style.borderColor = 'var(--primary)')}
                  onBlur={e => (e.target.style.borderColor = 'var(--bd)')} />
              </Field>

              <Field label="Сегмент рынка">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {SEGMENTS.map(s => (
                    <button key={s.id} type="button"
                      onClick={() => setForm(p => ({ ...p, market_segment: p.market_segment === s.id ? '' : s.id }))}
                      style={{
                        padding: '9px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600,
                        cursor: 'pointer', fontFamily: 'inherit', minHeight: 40,
                        border: `2px solid ${form.market_segment === s.id ? 'var(--primary)' : 'var(--bd)'}`,
                        background: form.market_segment === s.id ? '#E6F6EE' : 'var(--bg3)',
                        color: form.market_segment === s.id ? 'var(--primary)' : 'var(--t2)',
                        WebkitTapHighlightColor: 'transparent',
                      }}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Статус отношений">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {RELATION_STATUSES.map(s => (
                    <button key={s.id} type="button"
                      onClick={() => setForm(p => ({ ...p, relation_status: p.relation_status === s.id ? '' : s.id }))}
                      style={{
                        flex: '1 1 calc(50% - 4px)', minWidth: 100, padding: '10px 8px',
                        borderRadius: 10, fontSize: 13, fontWeight: 700,
                        cursor: 'pointer', fontFamily: 'inherit', minHeight: 44,
                        border: `2px solid ${form.relation_status === s.id ? s.color : 'transparent'}`,
                        background: form.relation_status === s.id ? s.color + '18' : 'var(--bg3)',
                        color: form.relation_status === s.id ? s.color : 'var(--t3)',
                        WebkitTapHighlightColor: 'transparent',
                      }}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </Field>

              {managers.length > 0 && (
                <Field label="Закреплённый менеджер">
                  <select value={form.manager_id} onChange={set('manager_id')}
                    style={{ ...inputStyle, cursor: 'pointer' }}>
                    <option value="">— Не назначен —</option>
                    {managers.filter(m => m.id !== user.id).map(m => (
                      <option key={m.id} value={m.id}>{m.name ?? m.email ?? m.id}</option>
                    ))}
                  </select>
                </Field>
              )}

              <Field label="Заметки">
                <textarea value={form.notes} onChange={set('notes')}
                  placeholder="Дополнительная информация..."
                  rows={3}
                  style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }}
                  onFocus={e => (e.target.style.borderColor = 'var(--primary)')}
                  onBlur={e => (e.target.style.borderColor = 'var(--bd)')} />
              </Field>
            </>
          )}

          {tab === 'role' && (
            <>
              {!isAdmin && (
                <div style={{ padding: '12px 14px', background: '#FFF8E1', borderRadius: 12, fontSize: 13, color: '#B45309', fontWeight: 600 }}>
                  Только администратор может менять роль
                </div>
              )}

              <Field label="Роль пользователя">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {(Object.keys(ROLE_STYLES) as RoleKey[]).map(r => {
                    const s = ROLE_STYLES[r]
                    const sel = form.role === r
                    return (
                      <button key={r} type="button"
                        onClick={() => isAdmin && setForm(p => ({ ...p, role: r }))}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '14px 16px', borderRadius: 14,
                          border: `2px solid ${sel ? s.fg : 'transparent'}`,
                          background: sel ? s.bg : 'var(--bg3)',
                          cursor: isAdmin ? 'pointer' : 'not-allowed',
                          textAlign: 'left', fontFamily: 'inherit',
                          opacity: !isAdmin && !sel ? 0.5 : 1,
                          minHeight: 56, WebkitTapHighlightColor: 'transparent',
                        }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: s.fg, flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, color: sel ? s.fg : 'var(--t2)' }}>{s.label}</div>
                          <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>{s.desc}</div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </Field>

              <Field label={`Доступ к разделам — ${ROLE_STYLES[form.role]?.label ?? form.role}`}>
                <div style={{ background: 'var(--bg3)', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--bd)' }}>
                  {MODULES.map((mod, i) => {
                    const level = permMap[form.role]?.[mod.key] ?? 'none'
                    return (
                      <div key={mod.key} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '11px 14px',
                        borderBottom: i < MODULES.length - 1 ? '1px solid var(--bd)' : 'none',
                      }}>
                        <span style={{ fontSize: 13, color: 'var(--t2)', fontWeight: 500 }}>{mod.label}</span>
                        <AccessBadge level={level} />
                      </div>
                    )
                  })}
                </div>
              </Field>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: isMobile ? '14px 20px calc(16px + var(--sab))' : '16px 28px 24px', borderTop: '1px solid var(--bd)', flexShrink: 0, background: 'var(--bg2)' }}>
          {err && <div style={{ fontSize: 12, color: '#DC2626', fontWeight: 600, marginBottom: 10 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 10 }}>
            <Button variant="secondary" size="lg" onClick={onClose} style={{ borderRadius: 14 }}>
              Отмена
            </Button>
            <Button size="lg" onClick={() => mutate()} loading={saving} style={{ flex: 1, borderRadius: 14 }}>
              {saving ? 'Сохранение...' : 'Сохранить'}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ── Permissions accordion row (mobile matrix) ── */
function PermAccordion({ roleKey, permMap, isAdmin, onCycle }: {
  roleKey: RoleKey
  permMap: Record<string, Record<string, AccessLevel>>
  isAdmin: boolean
  onCycle: (role: RoleKey, module: string) => void
}) {
  const [open, setOpen] = useState(false)
  const s = ROLE_STYLES[roleKey]
  return (
    <div style={{ border: '1px solid var(--bd)', borderRadius: 14, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 16px', background: 'var(--bg3)', border: 'none', cursor: 'pointer',
          fontFamily: 'inherit', minHeight: 52, WebkitTapHighlightColor: 'transparent',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ background: s.bg, color: s.fg, borderRadius: 8, padding: '4px 12px', fontSize: 12, fontWeight: 700 }}>{s.label}</span>
          <span style={{ fontSize: 12, color: 'var(--t2)' }}>{s.desc}</span>
        </div>
        <span style={{ color: 'var(--t2)', fontSize: 16, transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none' }}>▾</span>
      </button>
      {open && (
        <div>
          {MODULES.map((mod) => {
            const level = permMap[roleKey]?.[mod.key] ?? 'none'
            return (
              <div key={mod.key} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '11px 16px', background: 'var(--bg2)',
                borderTop: '1px solid var(--bd)',
              }}>
                <span style={{ fontSize: 13, color: 'var(--t2)', fontWeight: 500 }}>{mod.label}</span>
                <AccessBadge
                  level={level}
                  editable={isAdmin}
                  onClick={isAdmin ? () => onCycle(roleKey, mod.key) : undefined}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ── Main Component ── */
export default function RolesTab() {
  const { user: authUser } = useCurrentUser()
  const isMobile = useIsMobile()
  const qc = useQueryClient()
  const [editUser, setEditUser] = useState<Profile | null>(null)
  const [view, setView] = useState<'matrix' | 'users'>('matrix')

  const { data: myProfile } = useQuery<Profile | null>({
    queryKey: ['my-profile', authUser?.id],
    queryFn: async () => {
      if (!authUser?.id) return null
      const { data } = await supabase.from('profiles').select('*').eq('id', authUser.id).maybeSingle()
      return data
    },
    enabled: !!authUser?.id,
  })
  const isAdmin = myProfile?.role === 'admin'

  const { data: profiles = [], isLoading } = useQuery<Profile[]>({
    queryKey: ['profiles-roles'],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id,name,role,email,phone,company,notes,market_segment,relation_status,company_id,location_id,manager_id,parent_id,created_at')
        .order('created_at', { ascending: false })
      return data ?? []
    },
    staleTime: 60_000,
  })

  const { data: permsData = [] } = useQuery<RolePerm[]>({
    queryKey: ['role-permissions'],
    queryFn: async () => {
      const { data } = await supabase.from('role_permissions').select('id,role,module,access_level')
      return (data ?? []) as RolePerm[]
    },
    staleTime: 60_000,
  })

  const permMap = useMemo(() => {
    const m: Record<string, Record<string, AccessLevel>> = {}
    for (const p of permsData) {
      if (!m[p.role]) m[p.role] = {}
      m[p.role][p.module] = p.access_level
    }
    return m
  }, [permsData])

  const { mutate: updatePerm } = useMutation({
    mutationFn: async ({ role, module, access_level }: { role: RoleKey; module: string; access_level: AccessLevel }) => {
      const { error } = await supabase
        .from('role_permissions')
        .upsert({ role, module, access_level, updated_at: new Date().toISOString() }, { onConflict: 'role,module' })
      if (error) throw error
    },
    onMutate: async ({ role, module, access_level }) => {
      await qc.cancelQueries({ queryKey: ['role-permissions'] })
      const prev = qc.getQueryData<RolePerm[]>(['role-permissions'])
      qc.setQueryData<RolePerm[]>(['role-permissions'], old =>
        (old ?? []).map(p => p.role === role && p.module === module ? { ...p, access_level } : p)
      )
      return { prev }
    },
    onError: (_e, _v, ctx: any) => qc.setQueryData(['role-permissions'], ctx?.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ['role-permissions'] }),
  })

  const cycleAccess = (role: RoleKey, module: string) => {
    if (!isAdmin) return
    const cur  = permMap[role]?.[module] ?? 'none'
    const next = ACCESS_CYCLE[(ACCESS_CYCLE.indexOf(cur) + 1) % ACCESS_CYCLE.length]
    updatePerm({ role, module, access_level: next })
  }

  const managers = useMemo(() => profiles.filter(p => ['admin', 'manager'].includes(p.role)), [profiles])
  const byRole   = (r: string) => profiles.filter(p => p.role === r)

  const relMap: Record<string, { label: string; color: string }> = {
    cold:   { label: 'Холодный', color: '#0891B2' },
    warm:   { label: 'Тёплый',   color: '#D97706' },
    active: { label: 'Активный', color: 'var(--primary)' },
    lost:   { label: 'Потерян',  color: '#DC2626' },
  }
  const segMap: Record<string, string> = {
    horeca: 'HoReCa', office: 'Офис', wholesale: 'Опт',
    pharmacy: 'Аптека', shop: 'Магазин', autosalon: 'Автосалон',
  }

  const pad = isMobile ? '16px' : '28px'

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}>

      {/* Header */}
      <div style={{ background: 'var(--bg2)', padding: `16px ${pad}`, borderBottom: '1px solid var(--bd)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Info row: RBAC badge + i button + subtitle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: 'linear-gradient(135deg, rgba(16,163,91,.15), rgba(124,58,237,.12))',
            border: '1px solid rgba(16,163,91,.3)',
            borderRadius: 8, padding: '3px 10px',
            fontSize: 11, fontWeight: 800, letterSpacing: '.06em',
            color: 'var(--primary)',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--primary)', display: 'inline-block', boxShadow: '0 0 0 2px rgba(16,163,91,.25)' }} />
            RBAC
          </span>
          {/* i info button (общий стандарт) */}
          <InfoDot hint="RBAC (Role-Based Access Control): права из матрицы применяются автоматически ко всем пользователям. Защита в 4 слоя — скрытие недоступных вкладок, блокировка прямых URL, политики RLS в базе Supabase и режим «только просмотр» без кнопок записи." />
          <span style={{ fontSize: 13, color: 'var(--t2)' }}>
            {profiles.length} пользователей
            {isAdmin && <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--primary)', fontWeight: 700 }}>• Режим администратора</span>}
          </span>
        </div>
        {/* Tab switcher */}
        <Segmented
          value={view}
          onChange={setView}
          options={[{ value: 'matrix', label: 'Матрица' }, { value: 'users', label: 'Пользователи' }]}
        />
      </div>

      <div style={{ padding: `20px ${pad} 60px`, display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── MATRIX ── */}
        {view === 'matrix' && <div style={{ background: 'var(--bg2)', borderRadius: 20, border: '1px solid var(--bd)', overflow: 'hidden', boxShadow: '0 4px 20px rgba(12,26,19,.06)' }}>
          <div style={{ padding: `18px ${pad}`, borderBottom: '1px solid var(--bd)' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--t)' }}>
              Матрица прав доступа
            </div>
            <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 3 }}>
              {isAdmin ? 'Нажмите уровень доступа для изменения' : 'Что может делать каждая роль'}
            </div>
          </div>

          <div style={{ padding: `16px ${pad}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {isMobile ? (
              /* Mobile: accordion per role */
              (Object.keys(ROLE_STYLES) as RoleKey[]).map(r => (
                <PermAccordion key={r} roleKey={r} permMap={permMap} isAdmin={isAdmin} onCycle={cycleAccess} />
              ))
            ) : (
              /* Desktop: full table */
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--bd)' }}>
                      <th style={{ textAlign: 'left', padding: '10px 16px 10px 0', fontWeight: 700, color: 'var(--t2)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', minWidth: 160 }}>
                        Раздел
                      </th>
                      {(Object.keys(ROLE_STYLES) as RoleKey[]).map(r => {
                        const s = ROLE_STYLES[r]
                        return (
                          <th key={r} style={{ textAlign: 'center', padding: '10px 12px', minWidth: 100 }}>
                            <span style={{ background: s.bg, color: s.fg, borderRadius: 8, padding: '4px 12px', fontWeight: 700, fontSize: 12 }}>{s.label}</span>
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {MODULES.map((mod, i) => (
                      <tr key={mod.key} style={{ borderBottom: i < MODULES.length - 1 ? '1px solid var(--bd)' : 'none' }}>
                        <td style={{ padding: '10px 16px 10px 0', fontWeight: 600, color: 'var(--t)' }}>
                          {mod.label}
                        </td>
                        {(Object.keys(ROLE_STYLES) as RoleKey[]).map(r => (
                          <td key={r} style={{ textAlign: 'center', padding: '6px 12px' }}>
                            <AccessBadge
                              level={permMap[r]?.[mod.key] ?? 'none'}
                              editable={isAdmin}
                              onClick={isAdmin ? () => cycleAccess(r, mod.key) : undefined}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div style={{ padding: `12px ${pad}`, borderTop: '1px solid var(--bd)', display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 12, color: 'var(--t2)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ background: '#E6F6EE', color: '#0E7C46', border: '1.5px solid #B6E8CE', borderRadius: 20, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>Полный</span></span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ background: '#F0F4FF', color: '#3B5FC0', border: '1.5px solid #C0CFFF', borderRadius: 20, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>Просмотр</span></span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ background: 'var(--bg3)', color: 'var(--t3)', border: '1.5px solid var(--bd)', borderRadius: 20, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>— Нет</span></span>
          </div>
        </div>}

        {/* ── USERS ── */}
        {view === 'users' && <div style={{ background: 'var(--bg2)', borderRadius: 20, border: '1px solid var(--bd)', overflow: 'hidden', boxShadow: '0 4px 20px rgba(12,26,19,.06)' }}>
          <div style={{ padding: `18px ${pad}`, borderBottom: '1px solid var(--bd)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--t)' }}>Пользователи</div>
            <span style={{ fontSize: 13, color: 'var(--t2)' }}>{profiles.length} чел.</span>
          </div>

          {isLoading && (
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[...Array(3)].map((_, i) => (
                <div key={i} style={{ height: 72, background: 'var(--bg3)', borderRadius: 12 }} />
              ))}
            </div>
          )}

          {!isLoading && profiles.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--t2)' }}>
              <div style={{ fontWeight: 700 }}>Нет пользователей</div>
            </div>
          )}

          {!isLoading && (Object.keys(ROLE_STYLES) as RoleKey[]).map(r => {
            const users = byRole(r)
            if (!users.length) return null
            const s = ROLE_STYLES[r]
            return (
              <div key={r}>
                <div style={{ padding: `10px ${pad}`, background: 'var(--bg3)', borderTop: '1px solid var(--bd)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ background: s.bg, color: s.fg, borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 700 }}>{s.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--t3)' }}>{users.length} чел.</span>
                </div>

                {users.map((u) => {
                  const rel  = u.relation_status ? relMap[u.relation_status] : null
                  const seg  = u.market_segment ? segMap[u.market_segment] : null
                  const mgr  = managers.find(m => m.id === u.manager_id)
                  const isMe = u.id === authUser?.id

                  return (
                    <div key={u.id}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 12,
                        padding: `14px ${pad}`,
                        borderBottom: '1px solid var(--bd)',
                        background: isMe ? '#FAFFF8' : 'transparent',
                      }}
                    >
                      {/* Avatar */}
                      <div style={{
                        width: 40, height: 40, borderRadius: 11, flexShrink: 0,
                        background: `linear-gradient(135deg, ${s.fg}, #10A35B)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', fontWeight: 800, fontSize: 14, position: 'relative',
                      }}>
                        {(u.name || u.email || '?')[0].toUpperCase()}
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 3 }}>
                          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--t)' }}>{u.name ?? '—'}</span>
                          {isMe && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: '#E6F6EE', color: 'var(--primary)' }}>Вы</span>}
                          {rel && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: rel.color + '18', color: rel.color }}>{rel.label}</span>}
                          {seg && <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20, background: 'var(--bg3)', color: 'var(--t2)' }}>{seg}</span>}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {u.email && <span style={{ fontSize: 12, color: 'var(--t2)' }}>{u.email}</span>}
                          {u.phone && <span style={{ fontSize: 12, color: 'var(--t2)' }}>{u.phone}</span>}
                          {u.company && <span style={{ fontSize: 12, color: 'var(--t2)' }}>{u.company}</span>}
                          {mgr && <span style={{ fontSize: 12, color: 'var(--t2)' }}>{mgr.name ?? 'менеджер'}</span>}
                        </div>
                        {u.notes && (
                          <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 4, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {u.notes}
                          </div>
                        )}
                      </div>

                      {/* Edit button */}
                      <button
                        onClick={() => setEditUser(u)}
                        style={{
                          background: 'var(--bg3)', border: 'none', borderRadius: 10,
                          padding: isMobile ? '10px 14px' : '8px 16px',
                          fontSize: 12, fontWeight: 700, cursor: 'pointer',
                          color: 'var(--t2)', fontFamily: 'inherit', flexShrink: 0,
                          minHeight: 40, minWidth: isMobile ? 44 : undefined,
                          WebkitTapHighlightColor: 'transparent',
                          transition: 'all .15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--primary)'; e.currentTarget.style.color = '#fff' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg3)'; e.currentTarget.style.color = 'var(--t2)' }}
                      >
                        {isMobile ? 'Ред.' : 'Редактировать'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>}

      </div>

      {editUser && (
        <EditUserModal
          user={editUser}
          managers={managers}
          onClose={() => setEditUser(null)}
          permMap={permMap}
          isAdmin={isAdmin}
        />
      )}
    </div>
  )
}
