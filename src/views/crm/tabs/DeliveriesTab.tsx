'use client'

/* ══════════════════════════════════════════════════════════════════
   CRM · Доставки (водители, мобильный/PWA)
   Водитель получает бумажную накладную на складе «Алаш», сам выбирает
   доставки по адресу: «Беру» → «Доставлено» (обязательно фото подписанной
   накладной) или «Возврат» (причина). Статус и фото уходят в 1С.
   ══════════════════════════════════════════════════════════════════ */
import { LoadingBox } from '@/shared/ui/ui'
import { useCRM } from '@/views/crm/context/CRMContext'
import { DriversPanel,ReportPanel } from '@/views/crm/deliveries/AdminPanels'
import {
doAction,
fetchHistory,
fetchList,
photoUrl,STATUS_META,
uploadPhoto,
type DAction,
type DItem,
type DStatus,
} from '@/views/crm/deliveries/api'
import { ErrorBox,money,Notice } from '@/views/crm/sales/ui'
import { inputStyle,labelStyle,Modal,SearchInput,Segmented,useIsMobile } from '@/views/crm/shared/crmui'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { useMemo,useRef,useState } from 'react'

type View = 'free' | 'mine' | 'done' | 'all' | 'report' | 'drivers'
type Days = 'today' | 'yesterday' | 'd3' | 'd14'

const DAY_OPTS: { value: Days; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'yesterday', label: 'Вчера' },
  { value: 'd3', label: '3 дня' },
  { value: 'd14', label: '2 недели' },
]

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const time = (s: string | null) => (s ? new Date(s).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '')
const dayLabel = (s: string) => {
  const d = new Date(s), t = new Date()
  const k = Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 864e5)
  if (k === 0) return 'Сегодня'
  if (k === 1) return 'Вчера'
  if (k === -1) return 'Завтра'
  return d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })
}
const telHref = (p: string) => 'tel:' + p.replace(/[^\d+]/g, '').replace(/^8(?=7\d{9}$)/, '+7')

function Scroll({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', background: 'var(--bg)' }}>
      {children}
    </div>
  )
}

const btn = (tone: 'primary' | 'ghost' | 'danger' | 'info'): React.CSSProperties => ({
  padding: '10px 14px', borderRadius: 11, fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
  border: tone === 'ghost' ? '1px solid var(--bd2)' : 'none', minHeight: 42, flex: 1,
  background: tone === 'primary' ? 'var(--primary)' : tone === 'danger' ? 'rgba(220,38,38,.12)' : tone === 'info' ? '#0891B2' : 'var(--bg2)',
  color: tone === 'primary' || tone === 'info' ? '#fff' : tone === 'danger' ? '#DC2626' : 'var(--t2)',
})

function Pill({ status }: { status: DStatus }) {
  const m = STATUS_META[status]
  return <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 20, color: m.color, background: m.bg, whiteSpace: 'nowrap' }}>{m.label}</span>
}

function OnecBadge({ it }: { it: DItem }) {
  if (!it.onec) return null
  const map = { ok: ['1С ✓', 'var(--primary)'], pending: ['1С: в очереди', 'var(--t3)'], error: ['1С: ошибка', '#DC2626'] } as const
  const [l, c] = map[it.onec]
  return <span title={it.onec_error ?? ''} style={{ fontSize: 11, fontWeight: 700, color: c }}>{l}</span>
}

/* ── Фото накладной (просмотр) ── */
function PhotoView({ path, onClose }: { path: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['dl-photo', path], queryFn: () => photoUrl(path), staleTime: 5 * 60_000 })
  return (
    <Modal onClose={onClose} maxWidth={720}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <b style={{ color: 'var(--t)' }}>Подписанная накладная</b>
        <button onClick={onClose} style={{ ...btn('ghost'), flex: 'none', minHeight: 0, padding: '6px 12px' }}>Закрыть</button>
      </div>
      {q.isLoading && <LoadingBox minHeight={200} />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data && <a href={q.data} target="_blank" rel="noreferrer"><img src={q.data} alt="Накладная" style={{ width: '100%', borderRadius: 10, display: 'block' }} /></a>}
    </Modal>
  )
}

/* ── «Доставлено»: фото обязательно ── */
function DeliverModal({ it, onClose, onDone }: { it: DItem; onClose: () => void; onDone: (photo: string, note: string) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const inp = useRef<HTMLInputElement>(null)

  const pick = (f: File | undefined) => {
    if (!f) return
    if (preview) URL.revokeObjectURL(preview)
    setFile(f); setPreview(URL.createObjectURL(f)); setErr(null)
  }
  const submit = async () => {
    if (!file) { setErr('Сфотографируйте подписанную накладную'); return }
    setBusy(true); setErr(null)
    try {
      const path = await uploadPhoto(it.ref, file)
      await onDone(path, note.trim())
    } catch (e) {
      setErr((e as Error).message); setBusy(false)
    }
  }

  return (
    <Modal onClose={() => !busy && onClose()} maxWidth={460}>
      <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--t)', marginBottom: 2 }}>Доставлено · {it.number}</div>
      <div style={{ fontSize: 13, color: 'var(--t3)', marginBottom: 14 }}>{it.client} · {money(it.amount)}</div>

      <input ref={inp} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => pick(e.target.files?.[0])} />
      {preview ? (
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <img src={preview} alt="" style={{ width: '100%', maxHeight: 340, objectFit: 'contain', borderRadius: 12, background: 'var(--bg3)' }} />
          <button onClick={() => inp.current?.click()} disabled={busy} style={{ ...btn('ghost'), position: 'absolute', right: 8, bottom: 8, flex: 'none', minHeight: 0, padding: '6px 10px', fontSize: 12 }}>Переснять</button>
        </div>
      ) : (
        <button onClick={() => inp.current?.click()} style={{ width: '100%', height: 170, borderRadius: 14, border: '2px dashed var(--bd2)', background: 'var(--bg3)', color: 'var(--t2)', fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>
          Сфотографировать подписанную накладную
        </button>
      )}

      <label style={labelStyle}>Комментарий (необязательно)</label>
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Например: принял охранник" style={{ ...inputStyle, marginBottom: 12, fontSize: 15 }} />

      {err && <div style={{ marginBottom: 10 }}><Notice tone="error">{err}</Notice></div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onClose} disabled={busy} style={btn('ghost')}>Отмена</button>
        <button onClick={submit} disabled={busy || !file} style={{ ...btn('primary'), opacity: busy || !file ? 0.6 : 1 }}>{busy ? 'Отправляю…' : 'Подтвердить'}</button>
      </div>
    </Modal>
  )
}

/* ── «Возврат»: причина обязательна ── */
function ReturnModal({ it, onClose, onDone }: { it: DItem; onClose: () => void; onDone: (note: string) => Promise<void> }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const reasons = ['Клиент закрыт', 'Отказ от товара', 'Нет денег / оплаты', 'Не дозвонился', 'Неверный адрес']
  const submit = async () => {
    if (!note.trim()) { setErr('Укажите причину'); return }
    setBusy(true); setErr(null)
    try { await onDone(note.trim()) } catch (e) { setErr((e as Error).message); setBusy(false) }
  }
  return (
    <Modal onClose={() => !busy && onClose()} maxWidth={440}>
      <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--t)', marginBottom: 12 }}>Возврат · {it.number}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {reasons.map(r => (
          <button key={r} onClick={() => setNote(r)} style={{ padding: '7px 10px', borderRadius: 20, border: '1px solid var(--bd2)', background: note === r ? 'var(--fl)' : 'var(--bg2)', color: 'var(--t)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{r}</button>
        ))}
      </div>
      <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder="Причина возврата" style={{ ...inputStyle, fontSize: 15, resize: 'vertical', marginBottom: 12 }} />
      {err && <div style={{ marginBottom: 10 }}><Notice tone="error">{err}</Notice></div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onClose} disabled={busy} style={btn('ghost')}>Отмена</button>
        <button onClick={submit} disabled={busy} style={{ ...btn('danger'), opacity: busy ? 0.6 : 1 }}>{busy ? 'Сохраняю…' : 'Оформить возврат'}</button>
      </div>
    </Modal>
  )
}

function History({ refId }: { refId: string }) {
  const q = useQuery({ queryKey: ['dl-history', refId], queryFn: () => fetchHistory(refId) })
  if (q.isLoading) return <div style={{ fontSize: 12, color: 'var(--t3)' }}>Загрузка истории…</div>
  if (!q.data?.length) return null
  const L: Record<string, string> = { taken: 'взял', released: 'отказался', delivered: 'доставил', returned: 'возврат', reset: 'сброс' }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: 'var(--t3)' }}>
      {q.data.map((e, i) => (
        <div key={i}>{new Date(e.at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {e.who ?? '—'} {L[e.status] ?? e.status}{e.note ? ` — ${e.note}` : ''}</div>
      ))}
    </div>
  )
}

/* ── Карточка накладной ── */
function InvoiceCard({ it, meId, isAdmin, canAct, busy, onAction, onDeliver, onReturn, onPhoto }: {
  it: DItem; meId: string | null; isAdmin: boolean; canAct: boolean; busy: boolean
  onAction: (a: DAction) => void; onDeliver: () => void; onReturn: () => void; onPhoto: (p: string) => void
}) {
  const [open, setOpen] = useState(false)
  const mine = it.driver_id === meId
  const qty = it.lines.reduce((s, l) => s + (l.qty || 0), 0)
  const addrIsClient = !it.address || it.address === it.client

  return (
    <div style={{ background: 'var(--bg2)', border: `1px solid ${mine && it.status === 'taken' ? '#0891B2' : 'var(--bd)'}`, borderRadius: 14, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t3)', fontVariantNumeric: 'tabular-nums' }}>{it.number} · {time(it.date)}</span>
          <Pill status={it.status} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--t)', lineHeight: 1.25, wordBreak: 'break-word' }}>{it.client ?? '—'}</div>
        {!addrIsClient && (
          <div style={{ fontSize: 14, color: 'var(--t)', display: 'flex', gap: 6, alignItems: 'flex-start', wordBreak: 'break-word' }}>
            <span style={{ color: 'var(--t3)', flexShrink: 0 }}>📍</span>{it.address}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 13, color: 'var(--t2)' }}>
          <b style={{ color: 'var(--t)' }}>{money(it.amount)}</b>
          <span>{it.lines.length} поз. · {qty.toLocaleString('ru-RU')} шт.</span>
          {it.driver && it.status !== 'waiting' && <span style={{ color: '#0891B2', fontWeight: 700 }}>🚚 {mine ? 'Я' : it.driver}{it.vehicle ? ` · ${it.vehicle}` : ''}</span>}
          {isAdmin && <OnecBadge it={it} />}
        </div>
      </div>

      {it.phone && (
        <a href={telHref(it.phone)} onClick={e => e.stopPropagation()} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, background: 'rgba(16,163,91,.12)', color: 'var(--primary)', fontWeight: 800, fontSize: 14, textDecoration: 'none' }}>
          📞 {it.phone}
        </a>
      )}

      {open && (
        <div style={{ borderTop: '1px solid var(--bd)', paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {it.comment && it.comment !== it.address && <div style={{ fontSize: 13, color: 'var(--t2)' }}>💬 {it.comment}</div>}
          {it.manager && <div style={{ fontSize: 12, color: 'var(--t3)' }}>Менеджер: {it.manager}</div>}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {it.lines.map(l => (
              <div key={l.n} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: '1px dashed var(--bd)', fontSize: 13 }}>
                <span style={{ flex: 1, minWidth: 0, color: 'var(--t)' }}>{l.name ?? '—'}{l.article && <span style={{ color: 'var(--t3)' }}> · {l.article}</span>}</span>
                <b style={{ color: 'var(--t)', whiteSpace: 'nowrap' }}>{l.qty.toLocaleString('ru-RU')} шт</b>
                <span style={{ color: 'var(--t3)', whiteSpace: 'nowrap', minWidth: 78, textAlign: 'right' }}>{money(l.sum)}</span>
              </div>
            ))}
          </div>
          {it.note && <div style={{ fontSize: 13, color: it.status === 'returned' ? '#DC2626' : 'var(--t2)' }}>Примечание: {it.note}</div>}
          <History refId={it.ref} />
          {isAdmin && it.onec === 'error' && it.onec_error && <Notice tone="error">1С: {it.onec_error}</Notice>}
        </div>
      )}

      {/* Действия */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {it.photo_path && <button onClick={() => onPhoto(it.photo_path!)} style={{ ...btn('ghost'), flex: 'none' }}>🧾 Фото</button>}
        {canAct && it.status === 'waiting' && <button disabled={busy} onClick={() => onAction('take')} style={btn('info')}>Беру в доставку</button>}
        {canAct && it.status === 'taken' && (mine || isAdmin) && (
          <>
            <button disabled={busy} onClick={onDeliver} style={btn('primary')}>Доставлено</button>
            <button disabled={busy} onClick={onReturn} style={{ ...btn('danger'), flex: 'none' }}>Возврат</button>
            <button disabled={busy} onClick={() => onAction('release')} style={{ ...btn('ghost'), flex: 'none' }} title="Вернуть в свободные">Отказаться</button>
          </>
        )}
        {isAdmin && (it.status === 'delivered' || it.status === 'returned') && (
          <button disabled={busy} onClick={() => confirm('Сбросить статус накладной в «Ожидает»?') && onAction('reset')} style={{ ...btn('ghost'), flex: 'none', fontSize: 12 }}>Сбросить</button>
        )}
      </div>
    </div>
  )
}

export default function DeliveriesTab() {
  const isMobile = useIsMobile()
  const { can, toast } = useCRM()
  const qc = useQueryClient()
  const canAct = can('deliveries') === 'full'

  const [view, setView] = useState<View>('free')
  const [days, setDays] = useState<Days>('today')
  const [q, setQ] = useState('')
  const [deliverIt, setDeliverIt] = useState<DItem | null>(null)
  const [returnIt, setReturnIt] = useState<DItem | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)

  // Загружаем всё окно синхронизации (−14…+7 дней) одним запросом, фильтруем на клиенте
  const range = useMemo(() => { const t = new Date(); return { from: iso(addDays(t, -14)), to: iso(addDays(t, 7)) } }, [])
  const key = ['dl-list', range.from, range.to]
  const list = useQuery({ queryKey: key, queryFn: () => fetchList(range.from, range.to), refetchInterval: 30_000, staleTime: 15_000 })

  const act = useMutation({
    mutationFn: (v: { ref: string; action: DAction; photo?: string; note?: string }) => doAction(v.ref, v.action, v.photo, v.note),
    onSuccess: (_d, v) => {
      navigator.vibrate?.(15)
      toast({ take: 'Накладная ваша — в пути', release: 'Вернули в свободные', deliver: 'Доставлено ✓', return: 'Возврат оформлен', reset: 'Статус сброшен' }[v.action])
      if (v.action === 'take') setView('mine')
    },
    onError: (e) => toast((e as Error).message, 5000),
    onSettled: (_d, _e, v) => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ['dl-history', v.ref] }) },
  })

  const data = list.data
  const me = data?.me
  const isAdmin = me?.role === 'admin'
  const isList = view !== 'report' && view !== 'drivers'

  const dayFrom = useMemo(() => {
    const t = new Date(); const d0 = new Date(t.getFullYear(), t.getMonth(), t.getDate())
    return { today: d0, yesterday: addDays(d0, -1), d3: addDays(d0, -2), d14: addDays(d0, -14) }[days]
  }, [days])
  const dayTo = days === 'yesterday' ? addDays(dayFrom, 1) : null

  const inDays = (it: DItem) => {
    const d = new Date(it.date)
    return d >= dayFrom && (!dayTo || d < dayTo)
  }

  const counts = useMemo(() => {
    const c = { free: 0, mine: 0, done: 0, all: 0 }
    for (const it of data?.items ?? []) {
      if (!inDays(it)) continue
      c.all++
      if (it.status === 'waiting') c.free++
      if (it.status === 'taken' && it.driver_id === me?.uid) c.mine++
      if (it.status === 'delivered' || it.status === 'returned') c.done++
    }
    // «Мои» в пути показываем всегда, даже если накладная старше выбранного периода
    c.mine = (data?.items ?? []).filter(it => it.status === 'taken' && it.driver_id === me?.uid).length
    return c
  }, [data, me, dayFrom, dayTo]) // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (data?.items ?? []).filter(it => {
      if (view === 'mine') { if (!(it.status === 'taken' && it.driver_id === me?.uid)) return false }
      else {
        if (!inDays(it)) return false
        if (view === 'free' && it.status !== 'waiting') return false
        if (view === 'done' && !(it.status === 'delivered' || it.status === 'returned')) return false
      }
      if (!s) return true
      return [it.number, it.client, it.address, it.phone, it.comment, it.driver].some(v => v?.toLowerCase().includes(s))
    })
  }, [data, view, q, me, dayFrom, dayTo]) // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const m = new Map<string, DItem[]>()
    for (const it of items) { const k = dayLabel(it.date); m.set(k, [...(m.get(k) ?? []), it]) }
    return [...m.entries()]
  }, [items])

  const syncAgo = data?.last_sync ? Math.round((Date.now() - new Date(data.last_sync).getTime()) / 60000) : null

  if (list.isLoading) return <Scroll><LoadingBox minHeight={320} label="Загружаю накладные…" /></Scroll>
  if (list.error) return <Scroll><div style={{ padding: 16 }}><ErrorBox error={list.error} onRetry={() => list.refetch()} /></div></Scroll>

  return (
    <Scroll>
      <div style={{ padding: isMobile ? '12px 12px calc(96px + env(safe-area-inset-bottom, 0px))' : '20px 24px 40px', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 920, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: isMobile ? 20 : 24, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--t)' }}>Доставки</h1>
            <div style={{ fontSize: 12, color: syncAgo == null || syncAgo > 40 ? '#DC2626' : 'var(--t3)', marginTop: 2 }}>
              Склад «Алаш» · накладные из 1С {syncAgo == null ? 'ещё не загружались' : syncAgo < 1 ? 'только что' : `${syncAgo} мин назад`}
            </div>
          </div>
          <button onClick={() => list.refetch()} disabled={list.isFetching} style={{ ...btn('ghost'), flex: 'none', minHeight: 0, padding: '7px 12px', fontSize: 13 }}>
            {list.isFetching ? '…' : '↻ Обновить'}
          </button>
        </div>

        <div style={{ overflowX: 'auto', margin: '0 -4px', padding: '0 4px' }}>
          <Segmented<View> value={view} onChange={setView} options={[
            { value: 'free', label: 'Свободные', count: counts.free },
            { value: 'mine', label: 'Мои в пути', count: counts.mine },
            { value: 'done', label: 'Закрытые', count: counts.done },
            { value: 'all', label: 'Все', count: counts.all },
            ...(isAdmin || me?.role === 'manager' ? [{ value: 'report' as View, label: 'Итоги месяца' }] : []),
            ...(isAdmin ? [{ value: 'drivers' as View, label: 'Водители' }] : []),
          ]} />
        </div>
        {me?.role === 'logist' && !me.onec_driver && (
          <Notice tone="warn">Вы ещё не привязаны к водителю в 1С — взять накладную не получится. Попросите администратора: Доставки → Водители.</Notice>
        )}
        {me?.onec_driver && isList && (
          <div style={{ fontSize: 12, color: 'var(--t3)' }}>В 1С вы: <b style={{ color: 'var(--t2)' }}>{me.onec_driver}</b>{me.onec_vehicle ? ` · ${me.onec_vehicle}` : ''}</div>
        )}
        {view === 'report' && <ReportPanel />}
        {view === 'drivers' && <DriversPanel />}
        {isList && <>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {view !== 'mine' && (
            <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
              <Segmented<Days> value={days} onChange={setDays} options={DAY_OPTS} />
            </div>
          )}
          <SearchInput value={q} onChange={setQ} placeholder="Клиент, адрес, № накладной, телефон" grow maxWidth={420} />
        </div>

        {view === 'free' && days === 'today' && counts.free === 0 && (data?.items.length ?? 0) > 0 && (
          <Notice>На сегодня свободных накладных нет. Посмотрите «Вчера» или «3 дня».</Notice>
        )}

        {groups.length === 0 ? (
          <div style={{ padding: '40px 12px', textAlign: 'center', color: 'var(--t3)', fontSize: 14 }}>
            {view === 'mine' ? 'У вас нет накладных в пути. Возьмите доставку во вкладке «Свободные».' : 'Накладных нет'}
          </div>
        ) : groups.map(([label, arr]) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.04em', display: 'flex', justifyContent: 'space-between' }}>
              <span>{label}</span><span>{arr.length} · {money(arr.reduce((s, x) => s + x.amount, 0))}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(380px, 1fr))', gap: 8 }}>
              {arr.map(it => (
                <InvoiceCard key={it.ref} it={it} meId={me?.uid ?? null} isAdmin={isAdmin} canAct={canAct}
                  busy={act.isPending && act.variables?.ref === it.ref}
                  onAction={a => act.mutate({ ref: it.ref, action: a })}
                  onDeliver={() => setDeliverIt(it)} onReturn={() => setReturnIt(it)} onPhoto={setPhoto} />
              ))}
            </div>
          </div>
        ))}
        </>}
      </div>

      {deliverIt && (
        <DeliverModal it={deliverIt} onClose={() => setDeliverIt(null)}
          onDone={async (p, note) => { await act.mutateAsync({ ref: deliverIt.ref, action: 'deliver', photo: p, note }); setDeliverIt(null) }} />
      )}
      {returnIt && (
        <ReturnModal it={returnIt} onClose={() => setReturnIt(null)}
          onDone={async note => { await act.mutateAsync({ ref: returnIt.ref, action: 'return', note }); setReturnIt(null) }} />
      )}
      {photo && <PhotoView path={photo} onClose={() => setPhoto(null)} />}
    </Scroll>
  )
}
