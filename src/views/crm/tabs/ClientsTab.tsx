'use client'

import { useLanguage } from '@/shared/i18n/LanguageContext'
import { supabase } from '@/shared/lib/supabase'
import { Button } from '@/shared/ui/ui'
import { useCRM } from '@/views/crm/context/CRMContext'
import { Avatar,Modal,Pagination,SearchInput,Segmented,inputStyle,labelStyle,useCompaniesList,useIsMobile } from '@/views/crm/shared/crmui'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { useEffect,useMemo,useState } from 'react'

// ─── Types ──────────────────────────────────────────────────────────────────────────────

interface Contact {
  id: string
  name: string
  phone: string | null
  email: string | null
  company_id: string | null
  notes: string | null
  relation_status: string | null
  created_at: string
  last_contacted_at: string | null
  company_name?: string | null
}

interface Company {
  id: string
  name: string
}

interface FormData {
  name: string
  phone: string
  email: string
  company_id: string
  notes: string
  relation_status: string
}

// B2B application profile
interface B2BApplication {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  company: string | null
  company_id: string | null
  market_segment: string | null
  relation_status: string | null
  created_at: string
  company_name?: string | null
}

const PAGE_SIZE = 50

const STATUS_COLORS: Record<string, string> = {
  active: '#2E9E6B', potential: '#FF9500', inactive: '#8E8EA0', hot: '#FF3B30',
}

const RELATION_STATUS_MAP: Record<string, { label: string; bg: string; fg: string }> = {
  cold:   { label: 'Новая заявка', bg: '#E3F2FD', fg: '#1565C0' },
  warm:   { label: 'В работе',     bg: '#FFF8E1', fg: '#F57C00' },
  active: { label: 'Одобрен',      bg: '#E8F5E9', fg: '#2E7D32' },
  lost:   { label: 'Отказ',        bg: '#FFEBEE', fg: '#C62828' },
}

const SEGMENT_LABELS: Record<string, string> = {
  horeca:    'HoReCa',
  shop:      'Магазин',
  wholesale: 'Опт',
  office:    'Офис',
  pharmacy:  'Аптека',
}

const EMPTY: FormData = { name: '', phone: '', email: '', company_id: '', notes: '', relation_status: '' }

const CONTACT_FILTERS = [
  { value: '',   label: 'Все' },
  { value: '7',  label: '7 дней' },
  { value: '14', label: '14 дней' },
  { value: '30', label: '30 дней' },
  { value: '60', label: '60+ дней' },
] as const

const STALE_DAYS_THRESHOLD = 60

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────

function statusInfo(s: string | null, statuses: { value: string; label: string; color: string }[]) {
  return statuses.find(x => x.value === s) ?? null
}

function ruPlural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

function formatRelativeTime(dateStr: string | null): string {
  const days = daysSince(dateStr)
  if (days === null) return 'Никогда'
  if (days <= 0) return 'Сегодня'
  if (days === 1) return 'Вчера'
  if (days < 7) return `${days} ${ruPlural(days, 'день', 'дня', 'дней')} назад`
  if (days < 30) {
    const weeks = Math.floor(days / 7)
    return `${weeks} ${ruPlural(weeks, 'неделю', 'недели', 'недель')} назад`
  }
  if (days < 365) {
    const months = Math.floor(days / 30)
    return `${months} ${ruPlural(months, 'месяц', 'месяца', 'месяцев')} назад`
  }
  const years = Math.floor(days / 365)
  return `${years} ${ruPlural(years, 'год', 'года', 'лет')} назад`
}

// ─── B2B Applications Section ─────────────────────────────────────────────────────────────

function B2BApplicationsSection() {
  const qc = useQueryClient()
  const { toast } = useCRM()
  const [collapsed, setCollapsed] = useState(false)

  const { data: apps = [], isLoading } = useQuery<B2BApplication[]>({
    queryKey: ['b2b-applications'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select(`id, name, email, phone, company, company_id, market_segment, relation_status, created_at`)
        .in('relation_status', ['cold', 'warm'])
        .eq('role', 'client')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as B2BApplication[]
    },
    staleTime: 30_000,
  })

  const statusMut = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from('profiles')
        .update({ relation_status: status })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, { status }) => {
      qc.invalidateQueries({ queryKey: ['b2b-applications'] })
      const msgs: Record<string, string> = {
        warm:   'Заявка переведена в "В работе"',
        active: 'Клиент одобрен — доступ к кабинету открыт',
        lost:   'Заявка отклонена',
      }
      toast(msgs[status] ?? 'Статус обновлён')
    },
    onError: (e: any) => toast(e.message),
  })

  const coldCount = apps.filter(a => a.relation_status === 'cold').length
  const warmCount = apps.filter(a => a.relation_status === 'warm').length

  if (!isLoading && apps.length === 0) return null

  return (
    <div style={{ margin: '12px 20px 0', borderRadius: 14, border: '1.5px solid #BBDEFB', background: '#F8FBFF', overflow: 'hidden' }}>
      {/* Header */}
      <button
        onClick={() => setCollapsed(v => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ fontWeight: 700, fontSize: 14, color: '#0E1E16', flex: 1 }}>
          Заявки B2B клиентов
        </span>
        {coldCount > 0 && (
          <span style={{ background: '#1565C0', color: '#fff', borderRadius: 20, padding: '2px 9px', fontSize: 11, fontWeight: 800 }}>
            {coldCount} новых
          </span>
        )}
        {warmCount > 0 && (
          <span style={{ background: '#F57C00', color: '#fff', borderRadius: 20, padding: '2px 9px', fontSize: 11, fontWeight: 800 }}>
            {warmCount} в работе
          </span>
        )}
        <span style={{ color: '#8A968E', fontSize: 12 }}>{collapsed ? '▼' : '▲'}</span>
      </button>

      {!collapsed && (
        <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {isLoading ? (
            <div style={{ height: 60, borderRadius: 10, background: '#E3F2FD', animation: 'pulse 1.4s infinite' }} />
          ) : apps.map(app => {
            const st = RELATION_STATUS_MAP[app.relation_status ?? 'cold']
            return (
              <div
                key={app.id}
                style={{ background: '#fff', borderRadius: 12, border: '1px solid #E3F2FD', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}
              >
                {/* Avatar */}
                <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(135deg,#1565C0,#7C3AED)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>
                  {(app.name ?? app.email ?? '?')[0].toUpperCase()}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: '#0E1E16' }}>{app.name ?? '—'}</span>
                    {st && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: st.bg, color: st.fg }}>{st.label}</span>}
                    {app.market_segment && <span style={{ fontSize: 10, color: '#8A968E', background: '#F4F7F5', padding: '2px 7px', borderRadius: 20 }}>{SEGMENT_LABELS[app.market_segment] ?? app.market_segment}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: '#5C6B63', marginTop: 3 }}>
                    {app.company && <span style={{ fontWeight: 600 }}>{app.company}</span>}
                    {app.phone && <span style={{ color: '#8A968E' }}> · {app.phone}</span>}
                    {app.email && <span style={{ color: '#8A968E' }}> · {app.email}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#A6B0A9', marginTop: 2 }}>
                    Зарегистрирован {new Date(app.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {app.relation_status === 'cold' && (
                    <button
                      onClick={() => statusMut.mutate({ id: app.id, status: 'warm' })}
                      disabled={statusMut.isPending}
                      style={{ padding: '6px 11px', borderRadius: 8, border: '1.5px solid #FFA726', background: '#FFF8E1', color: '#E65100', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                    >
                      В работу
                    </button>
                  )}
                  <button
                    onClick={() => statusMut.mutate({ id: app.id, status: 'active' })}
                    disabled={statusMut.isPending}
                    style={{ padding: '6px 11px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                  >
                    Одобрить
                  </button>
                  <button
                    onClick={() => statusMut.mutate({ id: app.id, status: 'lost' })}
                    disabled={statusMut.isPending}
                    style={{ padding: '6px 11px', borderRadius: 8, border: '1.5px solid #FFCDD2', background: '#FFEBEE', color: '#C62828', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                  >
                    Отказ
                  </button>
                  {app.phone && (
                    <a
                      href={`https://wa.me/${app.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Здравствуйте, ${app.name ?? ''}! Мы получили вашу заявку на подключение к nstore B2B. Свяжитесь с нами для уточнения деталей.`)}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ padding: '6px 11px', borderRadius: 8, border: '1.5px solid #25D36630', background: '#F0FFF4', color: '#128C7E', fontSize: 12, fontWeight: 700, textDecoration: 'none', display: 'flex', alignItems: 'center' }}
                    >
                      WhatsApp
                    </a>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Subcomponents ─────────────────────────────────────────────────────────────────────

function StatusBadge({ status, statuses }: { status: string | null; statuses: { value: string; label: string; color: string }[] }) {
  if (!status) return null
  const info = statusInfo(status, statuses)
  if (!info) return <span style={{ fontSize: 11, color: 'var(--t3)' }}>{status}</span>
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 20,
      background: info.color + '1A', color: info.color,
      flexShrink: 0, whiteSpace: 'nowrap',
    }}>
      {info.label}
    </span>
  )
}

// ─── Contact Form ─────────────────────────────────────────────────────────────────────────

function ContactForm({
  initial, companies, statuses, onSave, onCancel, saving,
}: {
  initial: FormData
  companies: Company[]
  statuses: { value: string; label: string; color: string }[]
  onSave: (d: FormData) => void
  onCancel: () => void
  saving: boolean
}) {
  const { tr } = useLanguage()
  const [d, setD] = useState<FormData>(initial)
  const set = (k: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setD(prev => ({ ...prev, [k]: e.target.value }))

  const inp = inputStyle
  const lbl = labelStyle

  return (
    <form onSubmit={e => { e.preventDefault(); onSave(d) }}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div>
          <label style={lbl}>Имя *</label>
          <input style={inp} value={d.name} onChange={set('name')} required placeholder="Иван Иванов" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={lbl}>Телефон</label>
            <input style={inp} value={d.phone} onChange={set('phone')} placeholder="+7 700 000 0000" />
          </div>
          <div>
            <label style={lbl}>Email</label>
            <input style={inp} value={d.email} onChange={set('email')} type="email" placeholder="ivan@cafe.kz" />
          </div>
        </div>

        <div>
          <label style={lbl}>Компания</label>
          <select style={inp} value={d.company_id} onChange={set('company_id')}>
            <option value="">— без компании —</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div>
          <label style={lbl}>{tr('status')}</label>
          <select style={inp} value={d.relation_status} onChange={set('relation_status')}>
            <option value="">— не указан —</option>
            {statuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        <div>
          <label style={lbl}>Заметки</label>
          <textarea style={{ ...inp, minHeight: 72, resize: 'vertical' }} value={d.notes} onChange={set('notes')} placeholder="Любая дополнительная информация..." />
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
          <button type="button" onClick={onCancel}
            style={{ padding: '9px 18px', borderRadius: 9, border: '1.5px solid var(--bd)', background: 'var(--bg3)', color: 'var(--t)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            {tr('cancel')}
          </button>
          <button type="submit" disabled={saving}
            style={{ padding: '9px 20px', borderRadius: 9, border: 'none', background: 'var(--primary)', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, opacity: saving ? .6 : 1 }}>
            {saving ? tr('saving') : tr('save')}
          </button>
        </div>
      </div>
    </form>
  )
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────────────────

function ContactDetailModal({
  contact, companies, statuses, onEdit, onDelete, onClose,
}: {
  contact: Contact
  companies: Company[]
  statuses: { value: string; label: string; color: string }[]
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const { tr } = useLanguage()
  const { data: tasks } = useQuery({
    queryKey: ['contact-orders', contact.id, contact.name, contact.phone],
    queryFn: async () => {
      const ors: string[] = []
      if (contact.name)  ors.push(`client_name.eq.${contact.name}`)
      if (contact.phone) ors.push(`client_phone.eq.${contact.phone}`)
      if (!ors.length) return []
      const { data, error } = await supabase
        .from('crm_tasks')
        .select('id, title, order_status, total, created_at')
        .eq('task_type', 'order')
        .or(ors.join(','))
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return data ?? []
    },
    staleTime: 30_000,
  })

  const company = companies.find(c => c.id === contact.company_id)
  const row: React.CSSProperties = { display: 'flex', gap: 8, fontSize: 13, padding: '7px 0', borderBottom: '1px solid var(--bd)' }
  const key: React.CSSProperties = { color: 'var(--t2)', width: 110, flexShrink: 0, fontWeight: 600 }

  return (
    <Modal onClose={onClose}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 20 }}>
        <Avatar id={contact.id} name={contact.name} size={52} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>{contact.name}</div>
          {contact.relation_status && <StatusBadge status={contact.relation_status} statuses={statuses} />}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--t3)', padding: 4 }}>×</button>
      </div>

      <div style={{ marginBottom: 20 }}>
        {contact.phone && <div style={row}><span style={key}>Телефон</span><a href={`tel:${contact.phone}`} style={{ color: 'var(--primary)', textDecoration: 'none' }}>{contact.phone}</a></div>}
        {contact.email && <div style={row}><span style={key}>Email</span><a href={`mailto:${contact.email}`} style={{ color: 'var(--primary)', textDecoration: 'none' }}>{contact.email}</a></div>}
        {company && <div style={row}><span style={key}>Компания</span><span style={{ color: 'var(--t)' }}>{company.name}</span></div>}
        {contact.notes && <div style={{ ...row, flexDirection: 'column', gap: 4 }}><span style={key}>Заметки</span><span style={{ color: 'var(--t)', lineHeight: 1.5 }}>{contact.notes}</span></div>}
        <div style={row}><span style={key}>Добавлен</span><span style={{ color: 'var(--t3)' }}>{new Date(contact.created_at).toLocaleDateString('ru-RU')}</span></div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t2)', marginBottom: 8 }}>Заказы</div>
        {!tasks ? (
          <div style={{ color: 'var(--t3)', fontSize: 13 }}>Загрузка...</div>
        ) : tasks.length === 0 ? (
          <div style={{ color: 'var(--t3)', fontSize: 13 }}>Нет заказов</div>
        ) : tasks.map(t => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--bd)', fontSize: 13 }}>
            <span style={{ flex: 1, color: 'var(--t)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title ?? '—'}</span>
            {t.order_status && <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 20, background: 'var(--bg4)', color: 'var(--t2)' }}>{t.order_status}</span>}
            {t.total != null && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>{t.total.toLocaleString('ru-RU')} ₸</span>}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={onEdit} style={{ flex: 1, padding: '10px 16px', borderRadius: 10, border: '1.5px solid var(--bd)', background: 'var(--bg3)', color: 'var(--t)', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
          {tr('edit')}
        </button>
        <button onClick={onDelete} style={{ padding: '10px 16px', borderRadius: 10, border: 'none', background: '#FF3B3015', color: '#FF3B30', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
          {tr('delete')}
        </button>
      </div>
    </Modal>
  )
}

// ─── Contact Card (mobile) ────────────────────────────────────────────────────────────────────

function ContactCard({ contact, statuses, onClick }: { contact: Contact; statuses: { value: string; label: string; color: string }[]; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--bg2)', borderRadius: 14, padding: '14px 16px',
        border: '1px solid var(--bd)', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 14,
        transition: 'background .12s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg2)')}
    >
      <Avatar id={contact.id} name={contact.name} size={44} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--t)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>
          {contact.name}
        </div>
        <div style={{ fontSize: 12, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {contact.phone ?? contact.email ?? contact.company_name ?? '—'}
        </div>
      </div>
      {contact.relation_status && <StatusBadge status={contact.relation_status} statuses={statuses} />}
    </div>
  )
}

// ─── Main Tab ──────────────────────────────────────────────────────────────────────────────

export default function ClientsTab() {
  const isMobile = useIsMobile()
  const qc = useQueryClient()
  const { toast } = useCRM()
  const { tr, lang } = useLanguage()

  const STATUSES = useMemo(() => [
    { value: 'active',    label: lang === 'kz' ? 'Белсенді'      : 'Активный',       color: STATUS_COLORS.active    },
    { value: 'potential', label: lang === 'kz' ? 'Потенциалды'   : 'Потенциальный',  color: STATUS_COLORS.potential },
    { value: 'inactive',  label: lang === 'kz' ? 'Белсенді емес' : 'Неактивный',     color: STATUS_COLORS.inactive  },
    { value: 'hot',       label: lang === 'kz' ? 'Ыстық'         : 'Горячий',        color: STATUS_COLORS.hot       },
  ], [lang])

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [companyFilter] = useState('')
  const [contactFilter, setContactFilter] = useState('')
  const [page, setPage] = useState(0)

  const [selected, setSelected]   = useState<Contact | null>(null)
  const [editing, setEditing]     = useState<Contact | null>(null)
  const [creating, setCreating]   = useState(false)
  const [savingId, setSavingId]   = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(0) }, 350)
    return () => clearTimeout(t)
  }, [search])

  const { data: companies = [] } = useCompaniesList()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['contacts', debouncedSearch, statusFilter, companyFilter, contactFilter, page],
    queryFn: async () => {
      let q = supabase
        .from('contacts')
        .select(`id, name, phone, email, company_id, notes, relation_status, created_at, last_contacted_at, companies(name)`, { count: 'exact' })
        .order('name')
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

      if (debouncedSearch) {
        q = q.or(`name.ilike.%${debouncedSearch}%,phone.ilike.%${debouncedSearch}%,email.ilike.%${debouncedSearch}%`)
      }
      if (statusFilter) q = q.eq('relation_status', statusFilter)
      if (companyFilter) q = q.eq('company_id', companyFilter)
      if (contactFilter) {
        const cutoff = new Date(Date.now() - Number(contactFilter) * 86400000).toISOString()
        q = q.or(`last_contacted_at.is.null,last_contacted_at.lt.${cutoff}`)
      }

      const { data, error, count } = await q
      if (error) throw error

      const contacts: Contact[] = (data ?? []).map((r: any) => ({
        ...r,
        company_name: r.companies?.name ?? null,
      }))
      return { contacts, total: count ?? 0 }
    },
    staleTime: 30_000,
    placeholderData: prev => prev,
  })

  const contacts = data?.contacts ?? []
  const total    = data?.total ?? 0
  const pages    = Math.ceil(total / PAGE_SIZE)

  const createMut = useMutation({
    mutationFn: async (d: FormData) => {
      const { error } = await supabase.from('contacts').insert({
        name: d.name.trim(),
        phone: d.phone.trim() || null,
        email: d.email.trim() || null,
        company_id: d.company_id || null,
        notes: d.notes.trim() || null,
        relation_status: d.relation_status || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
      setCreating(false)
      toast(tr('clientAdded'))
    },
    onError: (e: any) => toast(e.message),
  })

  const updateMut = useMutation({
    mutationFn: async ({ id, d }: { id: string; d: FormData }) => {
      setSavingId(id)
      const { error } = await supabase.from('contacts').update({
        name: d.name.trim(),
        phone: d.phone.trim() || null,
        email: d.email.trim() || null,
        company_id: d.company_id || null,
        notes: d.notes.trim() || null,
        relation_status: d.relation_status || null,
      }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
      setEditing(null)
      setSelected(null)
      setSavingId(null)
      toast(tr('clientUpdated'))
    },
    onError: (e: any) => { setSavingId(null); toast(e.message) },
  })

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('contacts').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['contacts'] })
      setSelected(null)
      toast(tr('clientDeleted'))
    },
    onError: (e: any) => toast(e.message),
  })

  const handleDelete = (id: string) => {
    if (!confirm(tr('clientDeleteConfirm'))) return
    deleteMut.mutate(id)
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, overflowX: 'hidden', background: 'var(--bg)' }}>

      {/* ── B2B Applications ── */}
      <B2BApplicationsSection />

      {/* ── Search & filters ── */}
      <div style={{ padding: isMobile ? '12px 14px 10px' : '16px 20px 12px', background: 'var(--bg2)', borderBottom: '1px solid var(--bd)', flexShrink: 0, marginTop: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <SearchInput value={search} onChange={setSearch} placeholder={`Поиск по ${total} контактам...`} grow maxWidth={99999} />

          {!isMobile && (
            <select
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(0) }}
              style={{ padding: '8px 11px', borderRadius: 10, border: '1.5px solid var(--bd)', background: 'var(--bg3)', color: 'var(--t)', fontSize: 13, cursor: 'pointer' }}
            >
              <option value="">{tr('clientsAllStatus')}</option>
              {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          )}

          <Button onClick={() => setCreating(true)} title={tr('clientsAdd')}
            style={{ flexShrink: 0, height: isMobile ? 40 : 38, width: isMobile ? 40 : undefined, padding: isMobile ? 0 : '0 16px', borderRadius: isMobile ? 12 : 10, fontSize: isMobile ? 22 : 13, lineHeight: 1 }}>
            {isMobile ? '+' : tr('clientsAdd')}
          </Button>
        </div>

        <div style={{ marginTop: 10, overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', paddingBottom: 2 }}>
          <Segmented
            value={statusFilter}
            onChange={v => { setStatusFilter(v); setPage(0) }}
            options={[{ value: '', label: tr('all') }, ...STATUSES.map(s => ({ value: s.value, label: s.label }))]}
          />
        </div>

        <div style={{ marginTop: 8, overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', paddingBottom: 2 }}>
          <Segmented
            value={contactFilter}
            onChange={v => { setContactFilter(v); setPage(0) }}
            options={CONTACT_FILTERS.map(f => ({ value: f.value, label: f.label }))}
          />
        </div>
      </div>

      {/* ── Contacts list ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '10px 12px 60px' : '0 20px 16px' }}>
        {isLoading && !data ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 12 }}>
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} style={{ height: isMobile ? 72 : 54, borderRadius: 10, background: 'var(--bg2)', animation: 'pulse 1.4s ease-in-out infinite', animationDelay: `${i * .07}s` }} />
            ))}
          </div>
        ) : isError ? (
          <div style={{ paddingTop: 60, textAlign: 'center', color: '#FF3B30', fontSize: 14 }}>{tr('error')}</div>
        ) : contacts.length === 0 ? (
          <div style={{ paddingTop: 60, textAlign: 'center', color: 'var(--t3)', fontSize: 14 }}>
            {debouncedSearch || statusFilter || companyFilter ? tr('notFound') : tr('clientsNoData')}
          </div>
        ) : isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {contacts.map(c => (
              <ContactCard key={c.id} contact={c} statuses={STATUSES} onClick={() => setSelected(c)} />
            ))}
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 1.5fr 1.2fr 1.3fr 1fr', gap: 8, padding: '12px 12px 8px', fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.6px' }}>
              <span>Имя</span><span>Телефон</span><span>Компания</span><span>Статус</span><span>Последний контакт</span><span>Добавлен</span>
            </div>

            {contacts.map(c => {
              const days = daysSince(c.last_contacted_at)
              const isStale = days === null || days >= STALE_DAYS_THRESHOLD
              return (
                <div
                  key={c.id}
                  onClick={() => setSelected(c)}
                  style={{
                    display: 'grid', gridTemplateColumns: '2fr 1.2fr 1.5fr 1.2fr 1.3fr 1fr',
                    gap: 8, padding: '11px 12px', borderRadius: 10,
                    background: isStale ? '#FF3B3014' : 'var(--bg2)', marginBottom: 4,
                    border: isStale ? '1px solid #FF3B3030' : '1px solid transparent',
                    cursor: 'pointer', alignItems: 'center',
                    transition: 'background .12s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = isStale ? '#FF3B301F' : 'var(--bg3)')}
                  onMouseLeave={e => (e.currentTarget.style.background = isStale ? '#FF3B3014' : 'var(--bg2)')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <Avatar id={c.id} name={c.name} size={32} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                  </div>
                  <span style={{ fontSize: 13, color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.phone ?? '—'}</span>
                  <span style={{ fontSize: 12, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.company_name ?? '—'}</span>
                  <div>
                    <StatusBadge status={c.relation_status} statuses={STATUSES} />
                    {!c.relation_status && <span style={{ fontSize: 12, color: 'var(--t3)' }}>—</span>}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: isStale ? 700 : 400, color: isStale ? '#FF3B30' : 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {formatRelativeTime(c.last_contacted_at)}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--t3)' }}>
                    {new Date(c.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}
                  </span>
                </div>
              )
            })}
          </>
        )}
      </div>

      {pages > 1 && <Pagination page={page} pages={pages} total={total} onChange={setPage} />}

      {selected && !editing && (
        <ContactDetailModal
          contact={selected} companies={companies} statuses={STATUSES}
          onEdit={() => setEditing(selected)}
          onDelete={() => handleDelete(selected.id)}
          onClose={() => setSelected(null)}
        />
      )}

      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <Avatar id={editing.id} name={editing.name} size={40} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 800 }}>{tr('clientEditTitle')}</div>
              <div style={{ fontSize: 12, color: 'var(--t3)' }}>{editing.name}</div>
            </div>
          </div>
          <ContactForm
            initial={{
              name: editing.name, phone: editing.phone ?? '', email: editing.email ?? '',
              company_id: editing.company_id ?? '', notes: editing.notes ?? '',
              relation_status: editing.relation_status ?? '',
            }}
            companies={companies} statuses={STATUSES}
            onSave={d => updateMut.mutate({ id: editing.id, d })}
            onCancel={() => setEditing(null)}
            saving={savingId === editing.id}
          />
        </Modal>
      )}

      {creating && (
        <Modal onClose={() => setCreating(false)}>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 20 }}>{tr('clientNewTitle')}</div>
          <ContactForm
            initial={EMPTY} companies={companies} statuses={STATUSES}
            onSave={d => createMut.mutate(d)}
            onCancel={() => setCreating(false)}
            saving={createMut.isPending}
          />
        </Modal>
      )}
    </div>
  )
}
