'use client'

import { useLanguage } from '@/shared/i18n/LanguageContext'
import { supabase } from '@/shared/lib/supabase'
import { useCRM } from '@/views/crm/context/CRMContext'
import { Modal,useIsMobile } from '@/views/crm/shared/crmui'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { useMemo,useState,type ChangeEvent,type ReactNode } from 'react'

/* ══════════════════════════════════════════
   TYPES & CONSTANTS
   ══════════════════════════════════════════ */
interface Contract {
  id: string
  company_id: string
  number: string
  signed_date: string | null
  valid_until: string | null
  amount: number | null
  status: string
  file_url: string | null
  file_name: string | null
  note: string | null
  created_at: string
  signed_at?: string | null
  sign_provider?: string | null
  sign_ref?: string | null
  sign_cms?: string | null
}

interface CompanyLite { id: string; name: string }

interface FormData {
  company_id: string
  number: string
  signed_date: string
  valid_until: string
  amount: string
  status: string
  file_url: string
  file_name: string
  note: string
}

const STATUS: Record<string, { label: string; bg: string; color: string }> = {
  draft:     { label: 'Черновик',   bg: 'rgba(120,120,128,.15)', color: 'var(--t2)'   },
  pending:   { label: 'На подписи', bg: 'rgba(217,119,6,.15)',   color: 'var(--ora)'  },
  signed:    { label: 'Подписан',   bg: 'rgba(22,163,74,.15)',   color: 'var(--green)'},
  cancelled: { label: 'Отменён',    bg: 'rgba(220,38,38,.15)',   color: 'var(--red)'  },
}
const STATUS_KEYS = ['draft', 'pending', 'signed', 'cancelled']

function fmtMoney(n: number | null) {
  if (n == null) return null
  return n.toLocaleString('ru-RU') + ' ₸'
}
function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Скачать CMS-подпись (base64) как файл .p7s
function downloadCms(base64Cms: string, filename: string) {
  try {
    const binStr = atob(base64Cms)
    const bytes = new Uint8Array(binStr.length)
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i)
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pkcs7-signature' }))
    const a = document.createElement('a')
    a.href = url; a.download = filename
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch { /* noop */ }
}

/* Загрузка файла договора: Cloudinary (auto/upload — поддерживает PDF) с
   фолбэком в Supabase Storage (публичный бакет board). */
async function uploadContractFile(file: File): Promise<string> {
  const env = { VITE_CLOUDINARY_CLOUD_NAME: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME, VITE_CLOUDINARY_UPLOAD_PRESET: process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET }
  const cloud = env.VITE_CLOUDINARY_CLOUD_NAME || 'dwbmwxm2l'
  const preset = env.VITE_CLOUDINARY_UPLOAD_PRESET || 'ZBKBCNlKYffDCvWY86Z7qCdlmmM'
  if (cloud && preset) {
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('upload_preset', preset)
      const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/auto/upload`, { method: 'POST', body: fd })
      const j = await res.json()
      if (j.secure_url) return j.secure_url as string
      console.warn('Cloudinary upload failed, falling back to Supabase Storage:', j.error?.message)
    } catch (e) {
      console.warn('Cloudinary upload error, falling back to Supabase Storage:', e)
    }
  }
  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase()
  const path = `contracts/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from('board').upload(path, file, { upsert: false, contentType: file.type })
  if (error) throw error
  return supabase.storage.from('board').getPublicUrl(path).data.publicUrl
}

/* ══════════════════════════════════════════
   SMALL UI PIECES
   ══════════════════════════════════════════ */
function StatusTag({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.draft
  return (
    <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 100, background: s.bg, color: s.color }}>
      {s.label}
    </span>
  )
}

function ModalActions({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>{children}</div>
}
function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--t3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</label>
      {children}
    </div>
  )
}

/* ══════════════════════════════════════════
   CONTRACT FORM (create / edit)
   ══════════════════════════════════════════ */
function ContractForm({ initial, companies, onSave, onDelete, onClose, loading }: {
  initial?: Contract
  companies: CompanyLite[]
  onSave: (d: FormData) => void
  onDelete?: () => void
  onClose: () => void
  loading: boolean
}) {
  const { tr } = useLanguage()
  const [fd, setFd] = useState<FormData>({
    company_id:  initial?.company_id ?? '',
    number:      initial?.number ?? '',
    signed_date: initial?.signed_date ?? '',
    valid_until: initial?.valid_until ?? '',
    amount:      initial?.amount != null ? String(initial.amount) : '',
    status:      initial?.status ?? 'draft',
    file_url:    initial?.file_url ?? '',
    file_name:   initial?.file_name ?? '',
    note:        initial?.note ?? '',
  })
  const [uploading, setUploading] = useState(false)

  const set = (k: keyof FormData) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setFd(prev => ({ ...prev, [k]: e.target.value }))

  async function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadContractFile(file)
      setFd(prev => ({ ...prev, file_url: url, file_name: file.name }))
    } catch {
      alert('Не удалось загрузить файл')
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 16 }}>
        {initial ? 'Редактировать договор' : 'Новый договор'}
      </h3>

      <FormField label="Компания *">
        <select className="crm-input" value={fd.company_id} onChange={set('company_id')}>
          <option value="">— выберите компанию —</option>
          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </FormField>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <FormField label="Номер договора *">
          <input className="crm-input" value={fd.number} onChange={set('number')} placeholder="№ 2026-001" />
        </FormField>
        <FormField label="Статус">
          <select className="crm-input" value={fd.status} onChange={set('status')}>
            {STATUS_KEYS.map(k => <option key={k} value={k}>{STATUS[k].label}</option>)}
          </select>
        </FormField>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <FormField label="Дата заключения">
          <input className="crm-input" type="date" value={fd.signed_date} onChange={set('signed_date')} />
        </FormField>
        <FormField label="Действует до">
          <input className="crm-input" type="date" value={fd.valid_until} onChange={set('valid_until')} />
        </FormField>
      </div>

      <FormField label="Сумма договора">
        <input className="crm-input" type="number" inputMode="numeric" value={fd.amount} onChange={set('amount')} placeholder="₸" />
      </FormField>

      <FormField label="Файл договора (PDF)">
        {fd.file_url ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <a href={fd.file_url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--blue)', fontWeight: 700, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              📄 {fd.file_name || 'Открыть файл'}
            </a>
            <button onClick={() => setFd(prev => ({ ...prev, file_url: '', file_name: '' }))} className="crm-btn" style={{ padding: '4px 10px', fontSize: 12 }}>Убрать</button>
          </div>
        ) : (
          <label className="crm-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '6px 14px', fontSize: 13 }}>
            {uploading ? 'Загрузка…' : '⬆ Загрузить файл'}
            <input type="file" accept=".pdf,.doc,.docx,image/*" hidden onChange={onPickFile} disabled={uploading} />
          </label>
        )}
      </FormField>

      <FormField label="Примечание">
        <textarea className="crm-input" value={fd.note} onChange={set('note')} rows={2} style={{ resize: 'vertical' }} placeholder="Комментарий к договору" />
      </FormField>

      {initial?.status === 'signed' && (
        <div style={{ marginTop: 4, marginBottom: 4, padding: '12px 14px', borderRadius: 10, background: 'rgba(22,163,74,.08)', border: '1px solid rgba(22,163,74,.2)' }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--green)', marginBottom: 6 }}>✓ Подписано ЭЦП (eGov Mobile)</div>
          {initial.signed_at && <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 8 }}>Дата подписи: {new Date(initial.signed_at).toLocaleString('ru-RU')}</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {initial.sign_cms && (
              <button type="button" onClick={() => downloadCms(initial.sign_cms!, `Договор-${initial.number}.p7s`)} className="crm-btn" style={{ padding: '6px 12px', fontSize: 12 }}>⬇ Скачать подпись (.p7s)</button>
            )}
            {initial.file_url && (
              <a href={initial.file_url} target="_blank" rel="noopener noreferrer" className="crm-btn" style={{ padding: '6px 12px', fontSize: 12, textDecoration: 'none' }}>📄 Документ</a>
            )}
            <a href="https://sigex.kz" target="_blank" rel="noopener noreferrer" className="crm-btn" style={{ padding: '6px 12px', fontSize: 12, textDecoration: 'none', color: 'var(--primary)' }}>🔎 Проверить на SIGEX</a>
          </div>
          <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 8, lineHeight: 1.5 }}>
            Подлинность: загрузите на sigex.kz (или egov.kz) документ и файл .p7s — сервис покажет ФИО/ИИН подписанта, сертификат и результат проверки ЭЦП.
          </div>
        </div>
      )}

      <ModalActions>
        {onDelete && (
          <button onClick={onDelete} style={{ padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: 'rgba(220,38,38,.1)', color: 'var(--red)', border: 'none', fontFamily: 'inherit' }}>
            {tr('delete')}
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={onClose} className="crm-btn" style={{ padding: '6px 16px', fontSize: 13 }}>{tr('cancel')}</button>
        <button onClick={() => onSave(fd)} disabled={loading} className="crm-btn crm-btn-primary" style={{ padding: '6px 16px', fontSize: 13, opacity: loading ? .6 : 1 }}>
          {initial ? tr('save') : 'Создать'}
        </button>
      </ModalActions>
    </>
  )
}

/* ══════════════════════════════════════════
   CONTRACT CARD
   ══════════════════════════════════════════ */
function ContractCard({ contract, companyName, onClick }: {
  contract: Contract; companyName: string; onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      style={{ background: 'var(--bg2)', border: '1px solid var(--bd2)', borderRadius: 'var(--r2)', padding: '12px 14px', cursor: 'pointer', transition: 'all .15s' }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'var(--primary)'; el.style.boxShadow = '0 0 0 1px rgba(46,158,107,.15),var(--shadow)' }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'var(--bd2)'; el.style.boxShadow = 'none' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {contract.number}
        </div>
        <StatusTag status={contract.status} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--t2)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {companyName}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--t3)' }}>
        <span>от {fmtDate(contract.signed_date)}</span>
        {contract.amount != null && <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{fmtMoney(contract.amount)}</span>}
        {contract.file_url && <span style={{ marginLeft: 'auto' }}>📄</span>}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════
   MAIN
   ══════════════════════════════════════════ */
type ModalState = null | { type: 'new' } | { type: 'edit'; contract: Contract }

export default function ContractsTab() {
  const { profile, toast } = useCRM()
  const { tr } = useLanguage()
  const queryClient = useQueryClient()
  const isMobile = useIsMobile()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [modal, setModal] = useState<ModalState>(null)

  const canEdit = profile?.role === 'admin' || profile?.role === 'manager'

  const { data: companies = [] } = useQuery({
    queryKey: ['companies-lite'],
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('id, name').order('name')
      if (error) throw error
      return (data ?? []) as CompanyLite[]
    },
    staleTime: 60_000,
  })
  const companyName = useMemo(() => {
    const m: Record<string, string> = {}
    companies.forEach(c => { m[c.id] = c.name })
    return m
  }, [companies])

  const { data: contracts = [], isLoading } = useQuery({
    queryKey: ['contract-documents'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contract_documents')
        .select('id, company_id, number, signed_date, valid_until, amount, status, file_url, file_name, note, created_at, signed_at, sign_provider, sign_ref, sign_cms')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as Contract[]
    },
    staleTime: 30_000,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['contract-documents'] })

  function toPayload(fd: FormData) {
    if (!fd.company_id) throw new Error('Выберите компанию')
    if (!fd.number.trim()) throw new Error('Введите номер договора')
    return {
      company_id:  fd.company_id,
      number:      fd.number.trim(),
      signed_date: fd.signed_date || null,
      valid_until: fd.valid_until || null,
      amount:      fd.amount.trim() ? Number(fd.amount) : null,
      status:      fd.status,
      file_url:    fd.file_url || null,
      file_name:   fd.file_name || null,
      note:        fd.note.trim() || null,
    }
  }

  const { mutate: createContract, isPending: creating } = useMutation({
    mutationFn: async (fd: FormData) => {
      const payload = toPayload(fd)
      const { error } = await supabase.from('contract_documents').insert({ ...payload, created_by: profile?.id ?? null })
      if (error) throw error
    },
    onSuccess: () => { refresh(); setModal(null); toast('Договор создан') },
    onError: (e: Error) => toast(e.message || tr('error')),
  })

  const { mutate: updateContract, isPending: updating } = useMutation({
    mutationFn: async ({ id, fd }: { id: string; fd: FormData }) => {
      const payload = toPayload(fd)
      const { error } = await supabase.from('contract_documents').update(payload).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { refresh(); setModal(null); toast('Сохранено') },
    onError: (e: Error) => toast(e.message || tr('error')),
  })

  const { mutate: deleteContract } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('contract_documents').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { refresh(); setModal(null); toast('Договор удалён') },
    onError: () => toast(tr('error')),
  })

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return contracts.filter(c => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false
      if (!q) return true
      return (c.number || '').toLowerCase().includes(q) || (companyName[c.company_id] || '').toLowerCase().includes(q)
    })
  }, [contracts, statusFilter, search, companyName])

  const segLabel = (s: string) => s === 'all' ? tr('all') : (STATUS[s]?.label ?? s)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: isMobile ? '12px 14px' : '12px 16px', background: 'var(--bg2)', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
        <input
          placeholder="Поиск по номеру или компании"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: 0, padding: '9px 12px', borderRadius: 10, border: '1.5px solid var(--bd)', background: 'var(--bg3)', color: 'var(--t)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
        />
        {canEdit && (
          <button
            onClick={() => setModal({ type: 'new' })}
            style={{ flexShrink: 0, border: 'none', background: 'var(--primary)', color: '#fff', cursor: 'pointer', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
              ...(isMobile ? { width: 40, height: 40, borderRadius: 12, fontSize: 22 } : { padding: '0 16px', height: 40, borderRadius: 10, fontSize: 13 }) }}
          >
            {isMobile ? '+' : '+ Договор'}
          </button>
        )}
      </div>

      {/* Status filter */}
      <div style={{ display: 'flex', gap: 6, padding: '0 14px 10px', background: 'var(--bg2)', borderBottom: '1px solid var(--bd)', flexShrink: 0, overflowX: 'auto', scrollbarWidth: 'none' }}>
        {['all', ...STATUS_KEYS].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            style={{ flexShrink: 0, padding: '6px 13px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', border: '1.5px solid var(--bd)', transition: 'all .15s',
              background: statusFilter === s ? 'var(--primary)' : 'var(--bg2)', color: statusFilter === s ? '#fff' : 'var(--t2)' }}
          >
            {segLabel(s)}
          </button>
        ))}
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {isLoading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 10 }}>
            {Array.from({ length: 6 }).map((_, i) => <div key={i} style={{ height: 96, background: 'var(--bg4)', borderRadius: 'var(--r2)' }} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--t3)' }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{search || statusFilter !== 'all' ? tr('notFound') : 'Договоров пока нет'}</div>
            {canEdit && !search && statusFilter === 'all' && (
              <button onClick={() => setModal({ type: 'new' })} className="crm-btn crm-btn-primary" style={{ marginTop: 12, padding: '6px 16px' }}>{tr('add')}</button>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 10 }}>
            {filtered.map(c => (
              <ContractCard
                key={c.id}
                contract={c}
                companyName={companyName[c.company_id] ?? '—'}
                onClick={() => canEdit ? setModal({ type: 'edit', contract: c }) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {modal?.type === 'new' && (
        <Modal onClose={() => setModal(null)} maxWidth={460}>
          <ContractForm companies={companies} onSave={fd => createContract(fd)} onClose={() => setModal(null)} loading={creating} />
        </Modal>
      )}
      {modal?.type === 'edit' && (
        <Modal onClose={() => setModal(null)} maxWidth={460}>
          <ContractForm
            initial={modal.contract}
            companies={companies}
            onSave={fd => updateContract({ id: modal.contract.id, fd })}
            onDelete={() => { if (confirm('Удалить договор?')) deleteContract(modal.contract.id) }}
            onClose={() => setModal(null)}
            loading={updating}
          />
        </Modal>
      )}
    </div>
  )
}
