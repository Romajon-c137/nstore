'use client'

import { useLanguage } from '@/shared/i18n/LanguageContext'
import { supabase } from '@/shared/lib/supabase'
import { useCRM } from '@/views/crm/context/CRMContext'
import { Avatar,Modal,avColor,initials,useIsMobile } from '@/views/crm/shared/crmui'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { useMemo,useState,type ChangeEvent,type ReactNode } from 'react'

/* ══════════════════════════════════════════
   TYPES & CONSTANTS
   ══════════════════════════════════════════ */
interface Company {
  id: string
  name: string
  legal_name: string | null
  market_segment: string | null
  phone: string | null
  email: string | null
  address: string | null
  created_by: string | null
  onec_counterparty_name: string | null
}

interface CompanyContact {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  market_segment: string | null
  _src: 'profile' | 'contact'
}

interface CompanyTask {
  id: string
  title: string | null
  task_type: string | null
  order_status: string | null
  is_done: boolean
  total: number | null
  created_at: string
}

interface FormData {
  name: string
  legal_name: string
  market_segment: string
  phone: string
  email: string
  address: string
  onec_counterparty_name: string
}

const MKT: Record<string, string> = {
  horeca: 'HoReCa', office: 'Office', wholesale: 'Оптовик',
  pharmacy: 'Аптека', shop: 'Магазин', autosalon: 'Автосалон',
}

const MKT_STYLE: Record<string, { bg: string; color: string }> = {
  horeca:    { bg: 'rgba(88,86,214,.15)',   color: 'var(--pur)' },
  office:    { bg: 'rgba(37,99,235,.15)',   color: 'var(--blue)' },
  wholesale: { bg: 'rgba(217,119,6,.15)',   color: 'var(--ora)' },
  pharmacy:  { bg: 'rgba(22,163,74,.15)',   color: 'var(--green)' },
  shop:      { bg: 'rgba(220,38,38,.15)',   color: 'var(--red)' },
  autosalon: { bg: 'rgba(8,145,178,.15)',   color: 'var(--teal)' },
}

const STATUS_LABEL: Record<string, string> = {
  new: 'Новый', confirmed: 'Подтвержд.', delivery: 'Доставка',
  done: 'Выполнен', cancelled: 'Отменён',
}
const STATUS_COLOR: Record<string, string> = {
  new: 'var(--teal)', confirmed: 'var(--blue)', delivery: 'var(--ora)',
  done: 'var(--green)', cancelled: 'var(--red)',
}

const SEGMENTS = ['all', 'horeca', 'office', 'wholesale', 'pharmacy', 'shop', 'autosalon']

/* ══════════════════════════════════════════
   SMALL UI PIECES
   ══════════════════════════════════════════ */
function MkTag({ seg }: { seg: string | null }) {
  if (!seg || !MKT[seg]) return <span style={{ fontSize: 10, color: 'var(--t3)' }}>Без сегмента</span>
  const s = MKT_STYLE[seg] ?? {}
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, padding: '2px 7px',
      borderRadius: 100, background: s.bg, color: s.color,
    }}>
      {MKT[seg]}
    </span>
  )
}

function ModalActions({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>{children}</div>
}

function BtnCancel({ onClick }: { onClick: () => void }) {
  const { tr } = useLanguage()
  return <button onClick={onClick} className="crm-btn" style={{ padding: '6px 16px', fontSize: 13 }}>{tr('cancel')}</button>
}
function BtnPrimary({ onClick, loading, children }: { onClick: () => void; loading?: boolean; children: ReactNode }) {
  return (
    <button onClick={onClick} disabled={loading} className="crm-btn crm-btn-primary" style={{ padding: '6px 16px', fontSize: 13, opacity: loading ? .6 : 1 }}>
      {children}
    </button>
  )
}
function BtnDanger({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
      background: 'rgba(220,38,38,.1)', color: 'var(--red)', border: 'none', fontFamily: 'inherit',
    }}>
      {children}
    </button>
  )
}

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--t3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

/* ══════════════════════════════════════════
   COMPANY FORM (create / edit)
   ══════════════════════════════════════════ */
function CompanyForm({
  initial, onSave, onDelete, onClose, loading,
}: {
  initial?: Company
  onSave: (d: FormData) => void
  onDelete?: () => void
  onClose: () => void
  loading: boolean
}) {
  const { tr, lang } = useLanguage()
  const [fd, setFd] = useState<FormData>({
    name:                   initial?.name ?? '',
    legal_name:             initial?.legal_name ?? '',
    market_segment:         initial?.market_segment ?? '',
    phone:                  initial?.phone ?? '',
    email:                  initial?.email ?? '',
    address:                initial?.address ?? '',
    onec_counterparty_name: initial?.onec_counterparty_name ?? '',
  })

  const set = (k: keyof FormData) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFd(prev => ({ ...prev, [k]: e.target.value }))

  return (
    <>
      <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 16 }}>
        {initial ? tr('companyEditTitle') : tr('companyNewTitle')}
      </h3>

      <FormField label="Название *">
        <input className="crm-input" value={fd.name} onChange={set('name')} placeholder="ТОО Компания" />
      </FormField>
      <FormField label="Юр. название">
        <input className="crm-input" value={fd.legal_name} onChange={set('legal_name')} placeholder='ТОО "Компания"' />
      </FormField>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <FormField label="Сегмент">
          <select className="crm-input" value={fd.market_segment} onChange={set('market_segment')}>
            <option value="">—</option>
            {Object.entries(MKT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </FormField>
        <FormField label="Телефон">
          <input className="crm-input" type="tel" value={fd.phone} onChange={set('phone')} placeholder="+7 700..." />
        </FormField>
      </div>
      <FormField label="Email">
        <input className="crm-input" type="email" value={fd.email} onChange={set('email')} placeholder="info@company.kz" />
      </FormField>
      <FormField label="Адрес">
        <input className="crm-input" value={fd.address} onChange={set('address')} placeholder="ул. Абая 1, Астана" />
      </FormField>
      <FormField label="Имя в 1С">
        <input className="crm-input" value={fd.onec_counterparty_name} onChange={set('onec_counterparty_name')} placeholder="Точное наименование контрагента в 1С" />
      </FormField>

      <ModalActions>
        {onDelete && <BtnDanger onClick={onDelete}>{tr('delete')}</BtnDanger>}
        <div style={{ flex: 1 }} />
        <BtnCancel onClick={onClose} />
        <BtnPrimary onClick={() => onSave(fd)} loading={loading}>
          {initial ? tr('save') : (lang === 'kz' ? 'Жасау' : 'Создать')}
        </BtnPrimary>
      </ModalActions>
    </>
  )
}

/* ══════════════════════════════════════════
   COMPANY DETAIL MODAL
   ══════════════════════════════════════════ */
function CompanyDetailModal({ company, onClose, onEdit, canEdit }: {
  company: Company
  onClose: () => void
  onEdit: () => void
  canEdit: boolean
}) {
  const { tr } = useLanguage()
  const [activeTab, setActiveTab] = useState<'contacts' | 'tasks'>('contacts')

  // Contacts query
  const { data: contacts = [], isLoading: cLoading } = useQuery({
    queryKey: ['company-contacts', company.id],
    queryFn: async (): Promise<CompanyContact[]> => {
      const [pRes, cRes] = await Promise.all([
        supabase.from('profiles').select('id,name,phone,email,market_segment').eq('company_id', company.id),
        supabase.from('contacts').select('id,name,phone,email').eq('company_id', company.id),
      ])
      const profiles = (pRes.data ?? []).map(p => ({ ...p, _src: 'profile' as const }))
      const cnts     = (cRes.data ?? []).map(c => ({ ...c, market_segment: null, _src: 'contact' as const }))
      return [...profiles, ...cnts]
    },
    staleTime: 30_000,
  })

  // Tasks query
  const contactIds = contacts.map(c => c.id).sort().join(',')
  const { data: tasks = [], isLoading: tLoading } = useQuery({
    queryKey: ['company-tasks', company.id, contactIds],
    queryFn: async (): Promise<CompanyTask[]> => {
      // Карточки, привязанные к компании напрямую (company_id) ИЛИ через её контактов (client_id)
      const ors = [`company_id.eq.${company.id}`]
      if (contacts.length) ors.push(`client_id.in.(${contacts.map(c => c.id).join(',')})`)
      const { data, error } = await supabase
        .from('crm_tasks')
        .select('id,title,task_type,order_status,is_done,total,created_at')
        .or(ors.join(','))
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data ?? []
    },
    staleTime: 30_000,
  })

  const mk = company.market_segment

  return (
    <Modal onClose={onClose} maxWidth={430}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
        <Avatar id={company.id} name={company.name} size={48} radius={14} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 2 }}>{company.name}</div>
          {company.legal_name && <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 4 }}>{company.legal_name}</div>}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <MkTag seg={mk} />
            {company.phone && <a href={`tel:${company.phone}`} style={{ fontSize: 11, color: 'var(--teal)', fontWeight: 700, textDecoration: 'none' }}>{company.phone}</a>}
            {company.email && <a href={`mailto:${company.email}`} style={{ fontSize: 11, color: 'var(--blue)', fontWeight: 700, textDecoration: 'none' }}>{company.email}</a>}
          </div>
          {company.address && <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 3 }}>{company.address}</div>}
        </div>
        {canEdit && (
          <button onClick={onEdit} className="crm-btn" style={{ fontSize: 11, flexShrink: 0 }}>{tr('edit')}</button>
        )}
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 2, background: 'var(--bg3)', borderRadius: 10, padding: 3, marginBottom: 14 }}>
        {(['contacts', 'tasks'] as const).map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            style={{
              flex: 1, padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              border: 'none', fontFamily: 'inherit', transition: 'all .15s',
              background: activeTab === t ? 'var(--bg2)' : 'transparent',
              color: activeTab === t ? 'var(--t)' : 'var(--t2)',
              boxShadow: activeTab === t ? 'var(--shadow)' : 'none',
            }}
          >
            {t === 'contacts'
              ? `${tr('companyContacts')}${cLoading ? '' : ` (${contacts.length})`}`
              : `${tr('companyTasks')}${tLoading || activeTab !== 'tasks' ? '' : ` (${tasks.length})`}`}
          </button>
        ))}
      </div>

      {/* Panel */}
      <div style={{ minHeight: 120 }}>
        {activeTab === 'contacts' && (
          cLoading
            ? <div style={{ color: 'var(--t3)', fontSize: 13, textAlign: 'center', padding: 24 }}>{tr('loading')}</div>
            : contacts.length === 0
              ? <div style={{ color: 'var(--t3)', fontSize: 13, textAlign: 'center', padding: 24 }}>{tr('companyNoContacts')}</div>
              : contacts.map(c => (
                <div key={c.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                  borderRadius: 'var(--r)', background: 'var(--bg3)', marginBottom: 6,
                  border: '1px solid transparent', cursor: 'default',
                }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', background: avColor(c.id),
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 800, color: '#fff', flexShrink: 0,
                  }}>
                    {initials(c.name)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>{c.name || '—'}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 1, flexWrap: 'wrap' }}>
                      {c.phone && <span style={{ fontSize: 11, color: 'var(--teal)' }}>{c.phone}</span>}
                      {c.email && <span style={{ fontSize: 11, color: 'var(--blue)' }}>{c.email}</span>}
                      {c._src === 'contact' && <span style={{ fontSize: 9, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase' }}>контакт</span>}
                    </div>
                  </div>
                </div>
              ))
        )}
        {activeTab === 'tasks' && (
          tLoading
            ? <div style={{ color: 'var(--t3)', fontSize: 13, textAlign: 'center', padding: 24 }}>{tr('loading')}</div>
            : tasks.length === 0
              ? <div style={{ color: 'var(--t3)', fontSize: 13, textAlign: 'center', padding: 24 }}>{tr('companyNoTasks')}</div>
              : tasks.map(t => (
                <div key={t.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                  borderRadius: 'var(--r)', background: 'var(--bg3)', marginBottom: 6,
                  opacity: t.is_done ? .55 : 1,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, textDecoration: t.is_done ? 'line-through' : 'none' }}>
                      {t.title || '—'}
                    </div>
                    {t.order_status && (
                      <span style={{
                        fontSize: 10, fontWeight: 800, padding: '1px 5px', borderRadius: 100,
                        background: (STATUS_COLOR[t.order_status] ?? 'var(--t3)') + '22',
                        color: STATUS_COLOR[t.order_status] ?? 'var(--t3)',
                        marginTop: 2, display: 'inline-block',
                      }}>
                        {STATUS_LABEL[t.order_status] ?? t.order_status}
                      </span>
                    )}
                  </div>
                  {t.total && (
                    <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--primary)', whiteSpace: 'nowrap' }}>
                      {t.total >= 1000 ? Math.round(t.total / 1000) + 'K ₸' : t.total + ' ₸'}
                    </span>
                  )}
                </div>
              ))
        )}
      </div>

      <ModalActions>
        <button onClick={onClose} className="crm-btn" style={{ padding: '6px 20px', fontSize: 13 }}>{tr('cancel')}</button>
      </ModalActions>
    </Modal>
  )
}

/* ══════════════════════════════════════════
   COMPANY CARD
   ══════════════════════════════════════════ */
function CompanyCard({ company, contactCount, onClick }: {
  company: Company
  contactCount: number
  onClick: () => void
}) {
  const mk = company.market_segment

  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--bg2)', border: '1px solid var(--bd2)', borderRadius: 'var(--r2)',
        padding: '10px 14px', cursor: 'pointer', transition: 'all .15s',
        display: 'flex', alignItems: 'center', gap: 10,
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLDivElement
        el.style.borderColor = 'var(--primary)'
        el.style.boxShadow = '0 0 0 1px rgba(46,158,107,.15),var(--shadow)'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement
        el.style.borderColor = 'var(--bd2)'
        el.style.boxShadow = 'none'
      }}
    >
      <Avatar id={company.id} name={company.name} size={36} radius={10} />

      {/* Main info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {company.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
          <MkTag seg={mk} />
          {company.phone && (
            <span style={{ fontSize: 11, color: 'var(--t3)' }}>{company.phone}</span>
          )}
        </div>
      </div>

      {/* Contact count badge */}
      <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 32 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: contactCount > 0 ? 'var(--blue)' : 'var(--t3)', lineHeight: 1 }}>
          {contactCount}
        </div>
        <div style={{ fontSize: 9, color: 'var(--t3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 2 }}>
          конт.
        </div>
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════ */
type ModalState =
  | null
  | { type: 'new' }
  | { type: 'edit'; company: Company }
  | { type: 'detail'; company: Company }

export default function CompaniesTab() {
  const { profile, toast } = useCRM()
  const { tr, lang } = useLanguage()
  const queryClient = useQueryClient()
  const isMobile = useIsMobile()

  const [search, setSearch] = useState('')
  const [segment, setSegment] = useState('all')
  const [modal, setModal] = useState<ModalState>(null)

  const segLabel = (s: string) => s === 'all' ? tr('all') : (MKT[s] ?? s)

  const canEdit = profile?.role === 'admin' || profile?.role === 'manager'

  /* ── Data queries ── */
  const { data: companies = [], isLoading } = useQuery({
    queryKey: ['companies'],
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('*').order('name')
      if (error) throw error
      return (data ?? []) as Company[]
    },
    staleTime: 60_000,
  })

  // Contact counts (profiles + contacts tables)
  const { data: contactCounts = {} } = useQuery({
    queryKey: ['company-contact-counts'],
    queryFn: async () => {
      const [pRes, cRes] = await Promise.all([
        supabase.from('profiles').select('company_id').not('company_id', 'is', null),
        supabase.from('contacts').select('company_id').not('company_id', 'is', null),
      ])
      const map: Record<string, number> = {}
      ;[...(pRes.data ?? []), ...(cRes.data ?? [])].forEach(r => {
        if (r.company_id) map[r.company_id] = (map[r.company_id] ?? 0) + 1
      })
      return map
    },
    staleTime: 120_000,
  })

  /* ── Mutations ── */
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['companies'] })
    queryClient.invalidateQueries({ queryKey: ['company-contact-counts'] })
  }

  const { mutate: createCompany, isPending: creating } = useMutation({
    mutationFn: async (fd: FormData) => {
      if (!fd.name.trim()) throw new Error('Введите название')
      await supabase.from('companies').insert({
        name:                   fd.name.trim(),
        legal_name:             fd.legal_name.trim() || null,
        market_segment:         fd.market_segment || null,
        phone:                  fd.phone.trim() || null,
        email:                  fd.email.trim() || null,
        address:                fd.address.trim() || null,
        onec_counterparty_name: fd.onec_counterparty_name.trim() || null,
        created_by:             profile?.id ?? null,
      })
    },
    onSuccess: () => { refresh(); setModal(null); toast(lang === 'kz' ? 'Компания жасалды' : 'Компания создана') },
    onError: (e: Error) => toast(e.message || tr('error')),
  })

  const { mutate: updateCompany, isPending: updating } = useMutation({
    mutationFn: async ({ id, fd }: { id: string; fd: FormData }) => {
      await supabase.from('companies').update({
        name:                   fd.name.trim(),
        legal_name:             fd.legal_name.trim() || null,
        market_segment:         fd.market_segment || null,
        phone:                  fd.phone.trim() || null,
        email:                  fd.email.trim() || null,
        address:                fd.address.trim() || null,
        onec_counterparty_name: fd.onec_counterparty_name.trim() || null,
      }).eq('id', id)
    },
    onSuccess: () => { refresh(); setModal(null); toast(lang === 'kz' ? 'Сақталды' : 'Сохранено') },
    onError: () => toast(tr('error')),
  })

  const { mutate: deleteCompany } = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('companies').delete().eq('id', id)
    },
    onSuccess: () => { refresh(); setModal(null); toast(lang === 'kz' ? 'Компания жойылды' : 'Компания удалена') },
    onError: () => toast(tr('error')),
  })

  /* ── Filtering ── */
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return companies.filter(co => {
      if (segment !== 'all' && co.market_segment !== segment) return false
      if (!q) return true
      return (
        (co.name || '').toLowerCase().includes(q) ||
        (co.legal_name || '').toLowerCase().includes(q) ||
        (co.address || '').toLowerCase().includes(q)
      )
    })
  }, [companies, segment, search])

  /* ── Render ── */
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: isMobile ? '12px 14px' : '12px 16px',
        background: 'var(--bg2)', borderBottom: '1px solid var(--bd)', flexShrink: 0,
      }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <input
            placeholder={tr('companiesSearch')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '9px 12px 9px 32px', borderRadius: 10, border: '1.5px solid var(--bd)', background: 'var(--bg3)', color: 'var(--t)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        {canEdit && (
          <button
            onClick={() => setModal({ type: 'new' })}
            title={tr('companiesAdd')}
            style={{ flexShrink: 0, border: 'none', background: 'var(--primary)', color: '#fff', cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
              ...(isMobile
                ? { width: 40, height: 40, borderRadius: 12, fontSize: 22 }
                : { padding: '0 16px', height: 40, borderRadius: 10, fontSize: 13 }) }}
          >
            {isMobile ? '+' : tr('companiesAdd')}
          </button>
        )}
      </div>

      {/* Segment filter bar */}
      <div style={{
        display: 'flex', gap: 6, padding: '0 14px 10px',
        background: 'var(--bg2)', borderBottom: '1px solid var(--bd)', flexShrink: 0,
        overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch',
      }}>
        {SEGMENTS.map(s => (
          <button
            key={s}
            onClick={() => setSegment(s)}
            style={{
              flexShrink: 0, padding: '6px 13px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit', border: '1.5px solid var(--bd)', transition: 'all .15s',
              background: segment === s ? 'var(--primary)' : 'var(--bg2)',
              color: segment === s ? '#fff' : 'var(--t2)',
            }}
          >
            {segLabel(s)}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {isLoading && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 10 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ height: 130, background: 'var(--bg4)', borderRadius: 'var(--r2)' }} />
            ))}
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--t3)' }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              {search || segment !== 'all' ? tr('notFound') : tr('companiesNoData')}
            </div>
            {canEdit && !search && segment === 'all' && (
              <button onClick={() => setModal({ type: 'new' })} className="crm-btn crm-btn-primary" style={{ marginTop: 12, padding: '6px 16px' }}>
                {tr('add')}
              </button>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 10 }}>
          {filtered.map(co => (
            <CompanyCard
              key={co.id}
              company={co}
              contactCount={contactCounts[co.id] ?? 0}
              onClick={() => setModal({ type: 'detail', company: co })}
            />
          ))}
        </div>
      </div>

      {/* ── MODALS ── */}
      {modal?.type === 'new' && (
        <Modal onClose={() => setModal(null)} maxWidth={430}>
          <CompanyForm
            onSave={fd => createCompany(fd)}
            onClose={() => setModal(null)}
            loading={creating}
          />
        </Modal>
      )}

      {modal?.type === 'edit' && (
        <Modal onClose={() => setModal(null)} maxWidth={430}>
          <CompanyForm
            initial={modal.company}
            onSave={fd => updateCompany({ id: modal.company.id, fd })}
            onDelete={() => {
              if (confirm('Удалить компанию? Контакты останутся.'))
                deleteCompany(modal.company.id)
            }}
            onClose={() => setModal(null)}
            loading={updating}
          />
        </Modal>
      )}

      {modal?.type === 'detail' && (
        <CompanyDetailModal
          company={modal.company}
          onClose={() => setModal(null)}
          onEdit={() => setModal({ type: 'edit', company: modal.company })}
          canEdit={canEdit}
        />
      )}
    </div>
  )
}
