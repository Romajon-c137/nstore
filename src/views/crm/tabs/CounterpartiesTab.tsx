'use client'

/* Контрагенты = справочник 1С (по ключу Ref_Key). Наименование/телефон правятся здесь и уходят в 1С,
   контакты контрагента уходят в 1С как «Контактные лица». Карточки, объединённые в 1С, перепривязываются
   автоматически (по БИН / названию) — остальные админ перепривязывает вручную. */
import { supabase } from '@/shared/lib/supabase'
import { LoadingBox } from '@/shared/ui/ui'
import type { ClientStatus } from '@/views/crm/sales/api'
import { ErrorBox,Notice,StatusPill,TableWrap,dateRu,money,td,tdNum,th,thNum } from '@/views/crm/sales/ui'
import { Modal,Pagination,SearchInput,inputStyle,labelStyle,useIsMobile } from '@/views/crm/shared/crmui'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { useEffect,useState } from 'react'

/* ── API ── */
async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message === 'forbidden' ? 'Нет доступа' : error.message)
  return data as T
}
interface CpRow {
  ref: string; name: string; full_name: string | null; bin: string | null; phone: string | null
  channel: string; chain: string | null; manager: string | null; rev_12m: number | null; last_sale: string | null
  status: ClientStatus | null; debt: number | null; edit_pending: boolean; contacts: number; companies: number
}
interface CpList {
  total: number; items: CpRow[]; channels: string[]; chains: { id: number; name: string }[]
  is_admin: boolean; unlinked_companies: number; relink: number
}
interface CpContact {
  id: string; name: string | null; phone: string | null; email: string | null; role: string | null
  onec_contact_ref: string | null; onec_pending: boolean; onec_error: string | null; company: string | null
}
interface CpDetail {
  ref: string; name: string; full_name: string | null; bin: string | null; phone: string | null
  deleted: boolean; inactive: boolean; created_at_1c: string | null; channel: string | null; chain: string | null; manager: string | null
  rev_12m: number | null; orders_12m: number | null; last_sale: string | null; status: ClientStatus | null; debt: number | null; advance: number | null
  edit: { name: string | null; full_name: string | null; phone: string | null; pending: boolean; error: string | null } | null
  contacts: CpContact[]; companies: { id: string; name: string; linked_by: string | null }[]
}
interface CpFound { ref: string; name: string; bin: string | null; phone: string | null }

const PAGE = 50
const K = {
  all: ['counterparties'] as const,
  list: (q: string, ch: string, chain: number | null, page: number) => ['counterparties', 'list', q, ch, chain, page] as const,
  detail: (ref: string) => ['counterparties', 'detail', ref] as const,
}

const btn = (primary = false): React.CSSProperties => ({
  padding: '7px 12px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  border: primary ? 'none' : '1px solid var(--bd2)', background: primary ? 'var(--primary)' : 'var(--bg2)', color: primary ? '#fff' : 'var(--t2)',
})
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', padding: 0, color: 'var(--primary)', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }
const muted: React.CSSProperties = { fontSize: 11, color: 'var(--t3)' }
const telHref = (p: string) => 'tel:' + p.split(',')[0].replace(/[^\d+]/g, '').replace(/^8(?=7\d{9}$)/, '+7')

function useDebounced<T>(v: T, ms = 350) {
  const [d, setD] = useState(v)
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t) }, [v, ms])
  return d
}

/* ══════════════ Список ══════════════ */
export default function CounterpartiesTab() {
  const mobile = useIsMobile()
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [channel, setChannel] = useState('')
  const [chain, setChain] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<string | null>(null)
  const [admin, setAdmin] = useState<'companies' | 'relink' | null>(null)
  useEffect(() => setPage(1), [dq, channel, chain])

  const list = useQuery({
    queryKey: K.list(dq, channel, chain, page),
    queryFn: () => call<CpList>('cp_list', { p_q: dq || null, p_channel: channel || null, p_chain: chain, p_limit: PAGE, p_offset: (page - 1) * PAGE }),
    staleTime: 60_000, placeholderData: (p) => p,
  })
  const d = list.data

  return (
    <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: mobile ? 10 : 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <SearchInput value={q} onChange={setQ} placeholder="Название, БИН или телефон" grow maxWidth={360} />
        <select value={channel} onChange={e => setChannel(e.target.value)} style={{ ...inputStyle, width: 'auto', minWidth: 140 }}>
          <option value="">Все каналы</option>
          {d?.channels.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={chain ?? ''} onChange={e => setChain(e.target.value ? Number(e.target.value) : null)} style={{ ...inputStyle, width: 'auto', minWidth: 130 }}>
          <option value="">Все сети</option>
          {d?.chains.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        {d?.is_admin && d.relink > 0 && <button style={{ ...btn(), color: 'var(--red)' }} onClick={() => setAdmin('relink')}>Перепривязать ({d.relink})</button>}
        {d?.is_admin && <button style={btn()} onClick={() => setAdmin('companies')}>Компании CRM без 1С ({d.unlinked_companies})</button>}
      </div>

      <div style={muted}>Список берётся из 1С (обновляется каждые 30 минут). Название и телефон правятся в карточке и уходят в 1С, как и контакты.</div>

      {list.isLoading ? <LoadingBox minHeight={260} label="Загружаю контрагентов…" />
        : list.error ? <ErrorBox error={list.error} onRetry={() => list.refetch()} />
        : d && (
          <>
            <TableWrap>
              <thead><tr>
                <th style={th}>Контрагент</th>
                {!mobile && <><th style={th}>Канал / сеть</th><th style={th}>Менеджер</th><th style={th}>Телефон</th></>}
                <th style={thNum}>Выручка 12 мес</th>
                {!mobile && <><th style={th}>Последняя закупка</th><th style={thNum}>Долг</th><th style={thNum}>Контакты</th></>}
              </tr></thead>
              <tbody>
                {d.items.map(r => (
                  <tr key={r.ref} onClick={() => setOpen(r.ref)} style={{ cursor: 'pointer' }}>
                    <td style={td}>
                      <div style={{ fontWeight: 700 }}>{r.name}{r.edit_pending && <span title="Правка ещё не дошла до 1С" style={{ ...muted, marginLeft: 6 }}>⏳</span>}</div>
                      <div style={muted}>{[r.bin && `БИН ${r.bin}`, mobile && r.channel].filter(Boolean).join(' · ')}</div>
                    </td>
                    {!mobile && <>
                      <td style={td}>
                        <div>{r.channel}</div>
                        {r.chain && <div style={{ ...muted, color: 'var(--primary)', fontWeight: 700 }}>{r.chain}</div>}
                      </td>
                      <td style={td}>{r.manager ?? '—'}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>{r.phone ? <a href={telHref(r.phone)} onClick={e => e.stopPropagation()} style={{ color: 'var(--t)' }}>{r.phone}</a> : '—'}</td>
                    </>}
                    <td style={tdNum}>{r.rev_12m ? money(r.rev_12m) : '—'}</td>
                    {!mobile && <>
                      <td style={td}>{r.last_sale ? <>{dateRu(r.last_sale)} {r.status && <StatusPill status={r.status} />}</> : '—'}</td>
                      <td style={{ ...tdNum, color: r.debt && r.debt > 0 ? 'var(--red)' : undefined }}>{r.debt ? money(r.debt) : '—'}</td>
                      <td style={tdNum}>{r.contacts || '—'}</td>
                    </>}
                  </tr>
                ))}
                {d.items.length === 0 && <tr><td style={td} colSpan={8}>Ничего не найдено.</td></tr>}
              </tbody>
            </TableWrap>
            <Pagination page={page} pages={Math.max(1, Math.ceil(d.total / PAGE))} total={d.total} onChange={setPage} />
          </>
        )}

      {open && <DetailModal refId={open} onClose={() => setOpen(null)} />}
      {admin === 'companies' && <UnlinkedCompaniesModal onClose={() => setAdmin(null)} />}
      {admin === 'relink' && <RelinkModal onClose={() => setAdmin(null)} />}
    </div>
  )
}

/* ══════════════ Карточка ══════════════ */
function DetailModal({ refId, onClose }: { refId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: K.detail(refId), queryFn: () => call<CpDetail>('cp_detail', { p_ref: refId }) })
  const [editing, setEditing] = useState(false)
  const [contact, setContact] = useState<Partial<CpContact> | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: K.all })
  const unlink = useMutation({ mutationFn: (id: string) => call('cp_contact_unlink', { p_id: id }), onSuccess: refresh })
  const d = q.data

  return (
    <Modal onClose={onClose} maxWidth={720}>
      {q.isLoading ? <LoadingBox minHeight={200} /> : q.error ? <ErrorBox error={q.error} /> : d && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{d.name}</div>
              {d.full_name && d.full_name !== d.name && <div style={{ fontSize: 13, color: 'var(--t2)' }}>{d.full_name}</div>}
              <div style={muted}>{[d.bin && `БИН ${d.bin}`, d.channel, d.chain && `сеть ${d.chain}`, d.manager].filter(Boolean).join(' · ')}</div>
            </div>
            <button style={btn()} onClick={() => setEditing(true)}>Изменить</button>
          </div>

          {d.deleted && <Notice tone="error">Карточка удалена в 1С (возможно, объединена с другой). Ссылки CRM будут перенесены автоматически или попадут в «Перепривязать».</Notice>}
          {d.edit?.pending && <Notice tone="info">Правка отправляется в 1С: {[d.edit.name, d.edit.full_name, d.edit.phone].filter(Boolean).join(' · ')}</Notice>}
          {d.edit?.error && !d.edit.pending && <Notice tone="error">1С не приняла правку: {d.edit.error}</Notice>}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
            <Info label="Телефон" value={d.phone ? <a href={telHref(d.phone)} style={{ color: 'var(--t)' }}>{d.phone}</a> : '—'} />
            <Info label="Выручка 12 мес" value={d.rev_12m ? money(d.rev_12m) : '—'} />
            <Info label="Заказов 12 мес" value={d.orders_12m ?? '—'} />
            <Info label="Последняя закупка" value={d.last_sale ? dateRu(d.last_sale) : '—'} />
            <Info label="Долг" value={d.debt ? <span style={{ color: 'var(--red)' }}>{money(d.debt)}</span> : '—'} />
            <Info label="Аванс" value={d.advance ? money(d.advance) : '—'} />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontWeight: 800, flex: 1 }}>Контакты ({d.contacts.length})</div>
              <button style={btn(true)} onClick={() => setContact({})}>+ Контакт</button>
            </div>
            {d.contacts.length === 0 ? <div style={muted}>Контактов нет. Добавленные здесь контакты уходят в 1С как «Контактные лица» контрагента.</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {d.contacts.map(c => (
                  <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{c.name || '—'} {c.role && <span style={muted}>· {c.role}</span>}</div>
                      <div style={muted}>
                        {[c.phone, c.email, c.company && `из компании «${c.company}»`].filter(Boolean).join(' · ')}
                      </div>
                      <div style={{ ...muted, color: c.onec_error ? 'var(--red)' : undefined }}>
                        {c.onec_error ? `1С: ${c.onec_error}` : c.onec_pending ? 'Отправляется в 1С…' : c.onec_contact_ref ? 'В 1С ✓' : ''}
                      </div>
                    </div>
                    <button style={linkBtn} onClick={() => setContact(c)}>Изменить</button>
                    <button style={{ ...linkBtn, color: 'var(--t3)' }} onClick={() => { if (confirm('Убрать контакт из этого контрагента? В 1С контактное лицо останется.')) unlink.mutate(c.id) }}>Убрать</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {d.companies.length > 0 && (
            <div>
              <div style={{ fontWeight: 800, marginBottom: 4 }}>Компании CRM, привязанные к этой карточке</div>
              <div style={{ fontSize: 13, color: 'var(--t2)' }}>{d.companies.map(c => c.name).join(', ')}</div>
            </div>
          )}

          {editing && <EditModal d={d} onClose={() => setEditing(false)} onSaved={refresh} />}
          {contact && <ContactModal refId={d.ref} c={contact} onClose={() => setContact(null)} onSaved={refresh} />}
        </div>
      )}
    </Modal>
  )
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ padding: '8px 10px', background: 'var(--bg3)', borderRadius: 10 }}>
      <div style={muted}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 14 }}>{value}</div>
    </div>
  )
}

function EditModal({ d, onClose, onSaved }: { d: CpDetail; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(d.edit?.name ?? d.name)
  const [full, setFull] = useState(d.edit?.full_name ?? d.full_name ?? '')
  const [phone, setPhone] = useState(d.edit?.phone ?? d.phone ?? '')
  const m = useMutation({
    mutationFn: () => call('cp_edit', {
      p_ref: d.ref, p_name: name !== d.name ? name : null, p_full_name: full !== (d.full_name ?? '') ? full : null, p_phone: phone !== (d.phone ?? '') ? phone : null,
    }),
    onSuccess: () => { onSaved(); onClose() },
  })
  return (
    <Modal onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>Изменить контрагента</div>
        <div style={muted}>Изменения уходят в карточку контрагента в 1С (в течение 10 минут).</div>
        <label><span style={labelStyle}>Наименование</span><input style={inputStyle} value={name} onChange={e => setName(e.target.value)} /></label>
        <label><span style={labelStyle}>Полное наименование</span><input style={inputStyle} value={full} onChange={e => setFull(e.target.value)} /></label>
        <label><span style={labelStyle}>Телефон</span><input style={inputStyle} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+7 7__ ___ __ __" /></label>
        {m.error && <Notice tone="error">{(m.error as Error).message}</Notice>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={btn()} onClick={onClose}>Отмена</button>
          <button style={btn(true)} disabled={m.isPending || !name.trim()} onClick={() => m.mutate()}>{m.isPending ? 'Сохраняю…' : 'Сохранить'}</button>
        </div>
      </div>
    </Modal>
  )
}

function ContactModal({ refId, c, onClose, onSaved }: { refId: string; c: Partial<CpContact>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: c.name ?? '', phone: c.phone ?? '', email: c.email ?? '', role: c.role ?? '' })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF(p => ({ ...p, [k]: e.target.value }))
  const m = useMutation({
    mutationFn: () => call('cp_contact_save', { p_id: c.id ?? null, p_ref: refId, p_name: f.name, p_phone: f.phone, p_email: f.email, p_role: f.role }),
    onSuccess: () => { onSaved(); onClose() },
  })
  return (
    <Modal onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>{c.id ? 'Контакт' : 'Новый контакт'}</div>
        <label><span style={labelStyle}>Имя</span><input style={inputStyle} value={f.name} onChange={set('name')} /></label>
        <label><span style={labelStyle}>Должность / роль</span><input style={inputStyle} value={f.role} onChange={set('role')} placeholder="Бариста, закупщик, управляющий…" /></label>
        <label><span style={labelStyle}>Телефон</span><input style={inputStyle} value={f.phone} onChange={set('phone')} /></label>
        <label><span style={labelStyle}>Email</span><input style={inputStyle} value={f.email} onChange={set('email')} /></label>
        {m.error && <Notice tone="error">{(m.error as Error).message}</Notice>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={btn()} onClick={onClose}>Отмена</button>
          <button style={btn(true)} disabled={m.isPending} onClick={() => m.mutate()}>{m.isPending ? 'Сохраняю…' : 'Сохранить'}</button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Выбор карточки 1С ── */
function CounterpartyPicker({ initial, onPick }: { initial: string; onPick: (r: CpFound) => void }) {
  const [q, setQ] = useState(initial)
  const dq = useDebounced(q)
  const s = useQuery({ queryKey: ['counterparties', 'search', dq], queryFn: () => call<CpFound[]>('cp_search', { p_q: dq }), enabled: dq.trim().length >= 2 })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <input autoFocus style={inputStyle} value={q} onChange={e => setQ(e.target.value)} placeholder="Найти контрагента 1С: название или БИН" />
      <div style={{ maxHeight: 260, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {s.isFetching && <div style={muted}>Ищу…</div>}
        {s.data?.map(r => (
          <button key={r.ref} onClick={() => onPick(r)} style={{ textAlign: 'left', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--bd)', background: 'var(--bg2)', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--t)' }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{r.name}</div>
            <div style={muted}>{[r.bin && `БИН ${r.bin}`, r.phone].filter(Boolean).join(' · ')}</div>
          </button>
        ))}
        {s.data?.length === 0 && <div style={muted}>Не найдено.</div>}
      </div>
    </div>
  )
}

/* ══════════════ Админ: компании CRM без пары в 1С ══════════════ */
interface Unlinked { id: string; name: string; legal_name: string | null; phone: string | null; contacts: number; refs: number }
function UnlinkedCompaniesModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [pick, setPick] = useState<Unlinked | null>(null)
  const list = useQuery({ queryKey: ['counterparties', 'unlinked', dq], queryFn: () => call<Unlinked[]>('cp_companies_unlinked', { p_q: dq || null }) })
  const link = useMutation({
    mutationFn: ({ id, ref }: { id: string; ref: string }) => call('cp_company_link', { p_company: id, p_ref: ref }),
    onSuccess: () => { setPick(null); qc.invalidateQueries({ queryKey: K.all }); qc.invalidateQueries({ queryKey: ['companies-list'] }) },
  })
  return (
    <Modal onClose={onClose} maxWidth={680}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>Компании CRM без пары в 1С</div>
        <div style={muted}>Скрыты из CRM: у них нет карточки контрагента в 1С. Привяжите нужные — их контакты уйдут в 1С. Остальные (лиды WhatsApp, частные лица) можно не трогать.</div>
        {pick ? (
          <>
            <div style={{ fontWeight: 700 }}>«{pick.name}» → контрагент 1С:</div>
            <CounterpartyPicker initial={pick.name} onPick={r => link.mutate({ id: pick.id, ref: r.ref })} />
            {link.error && <Notice tone="error">{(link.error as Error).message}</Notice>}
            <button style={btn()} onClick={() => setPick(null)}>Назад</button>
          </>
        ) : (
          <>
            <SearchInput value={q} onChange={setQ} placeholder="Поиск компании" grow maxWidth={680} />
            {list.isLoading ? <LoadingBox minHeight={160} /> : list.error ? <ErrorBox error={list.error} /> : (
              <div style={{ maxHeight: 420, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {list.data?.map(c => (
                  <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', border: '1px solid var(--bd)', borderRadius: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{c.name}</div>
                      <div style={muted}>{[c.legal_name, c.phone, c.contacts ? `контактов: ${c.contacts}` : null].filter(Boolean).join(' · ')}</div>
                    </div>
                    <button style={linkBtn} onClick={() => setPick(c)}>Привязать к 1С</button>
                  </div>
                ))}
                {list.data?.length === 0 && <div style={muted}>Нет компаний без привязки.</div>}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

/* ══════════════ Админ: перепривязка после объединения в 1С ══════════════ */
interface RelinkRow { old_ref: string; old_name: string | null; created_at: string; companies: number; contacts: number; chain: string | null }
function RelinkModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [pick, setPick] = useState<RelinkRow | null>(null)
  const list = useQuery({ queryKey: ['counterparties', 'relink'], queryFn: () => call<RelinkRow[]>('cp_relink_list') })
  const res = useMutation({
    mutationFn: ({ old, nw }: { old: string; nw: string | null }) => call('cp_relink_resolve', { p_old: old, p_new: nw }),
    onSuccess: () => { setPick(null); qc.invalidateQueries({ queryKey: K.all }) },
  })
  return (
    <Modal onClose={onClose} maxWidth={640}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>Карточки, удалённые или объединённые в 1С</div>
        <div style={muted}>На них были ссылки CRM (компании, контакты, сеть), а однозначную замену по БИН или названию найти не удалось. Укажите, на какую карточку перенести.</div>
        {pick ? (
          <>
            <div style={{ fontWeight: 700 }}>«{pick.old_name}» → перенести на:</div>
            <CounterpartyPicker initial={pick.old_name ?? ''} onPick={r => res.mutate({ old: pick.old_ref, nw: r.ref })} />
            <button style={btn()} onClick={() => setPick(null)}>Назад</button>
          </>
        ) : list.isLoading ? <LoadingBox minHeight={140} /> : list.error ? <ErrorBox error={list.error} /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {list.data?.map(r => (
              <div key={r.old_ref} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', border: '1px solid var(--bd)', borderRadius: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{r.old_name}</div>
                  <div style={muted}>{[r.companies && `компаний: ${r.companies}`, r.contacts && `контактов: ${r.contacts}`, r.chain && `сеть ${r.chain}`].filter(Boolean).join(' · ')}</div>
                </div>
                <button style={linkBtn} onClick={() => setPick(r)}>Перенести</button>
                <button style={{ ...linkBtn, color: 'var(--t3)' }} onClick={() => res.mutate({ old: r.old_ref, nw: null })}>Пропустить</button>
              </div>
            ))}
            {list.data?.length === 0 && <div style={muted}>Всё перепривязано.</div>}
          </div>
        )}
        {res.error && <Notice tone="error">{(res.error as Error).message}</Notice>}
      </div>
    </Modal>
  )
}
