'use client'

import { fmtFull,fmtMoney } from '@/shared/lib/format'
import { supabase } from '@/shared/lib/supabase'
import { Metric,Text,Card as TremorCard } from '@/shared/ui/charts'
import { InfoDot } from '@/shared/ui/ui'
import { useCRM } from '@/views/crm/context/CRMContext'
import { Modal,inputStyle,labelStyle,useIsMobile } from '@/views/crm/shared/crmui'
import { useQuery,useQueryClient } from '@tanstack/react-query'
import { useMemo,useState } from 'react'

/* ══════════════════════════════════════════════════════════════════
   ПЛАТЕЖИ — платёжный календарь (crm/balance → вид «Платежи»).
   Ручные плановые платежи/поступления (аренда, ФОТ, налоги, кредит…) —
   разовые и ежемесячные — из public.cash_plan_entries. Платежи
   поставщикам подтягиваются из «Партий» автоматически (дата + отсрочка).
   Строим накопительный остаток по неделям и подсвечиваем кассовые разрывы.

   Живой план: по мере поступления данных правишь записи — календарь
   пересчитывается. Стартовый остаток — в localStorage.
   ══════════════════════════════════════════════════════════════════ */

const COMPANY = 'JJCo'
const HORIZON_WEEKS = 12
const OPENING_KEY = 'cashplan_opening'

type Dir = 'in' | 'out'
const OUT_CATS = ['Поставщик', 'Аренда', 'ФОТ', 'Налоги', 'Кредит', 'Дивиденды', 'Прочее']
const IN_CATS = ['Продажи', 'Возврат', 'Прочее']

interface Entry {
  id: string
  due_date: string
  direction: Dir
  category: string
  name: string
  amount: number
  recurring_day: number   // 0 разовый; 1..31 ежемесячно
  recurring_until?: string | null   // дата окончания повтора (закрытие кредита); null = бессрочно
  note?: string | null
}
interface Occ { date: string; dir: Dir; name: string; category: string; amount: number; entryId?: string; auto?: boolean }

/* ── date helpers ── */
function iso(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
function parse(s: string): Date { return new Date(s + 'T00:00:00') }
function addDays(s: string, n: number): string { const d = parse(s); d.setDate(d.getDate() + n); return iso(d) }
function mondayOf(d: Date): Date { const x = new Date(d); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); x.setHours(0, 0, 0, 0); return x }
function ddmm(s: string): string { const d = parse(s); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}` }
const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
function dayMon(s: string): string { const d = parse(s); return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}` }
function num(v: unknown): number { const s = String(v ?? '').replace(/[^\d.,-]/g, '').replace(/,/g, '.'); const n = Number(s); return Number.isFinite(n) ? n : 0 }

function loadOpening(): number { return num(localStorage.getItem(OPENING_KEY)) }
function saveOpening(v: number) { try { localStorage.setItem(OPENING_KEY, String(v)) } catch { /* ignore */ } }

/* ── data ── */
async function fetchEntries(): Promise<Entry[]> {
  const { data, error } = await supabase
    .from('cash_plan_entries')
    .select('id,due_date,direction,category,name,amount,recurring_day,recurring_until,note')
    .eq('company', COMPANY)
  if (error) throw error
  return (data ?? []) as unknown as Entry[]
}
interface Payable { name: string; due: string; amount: number }
async function fetchPayables(): Promise<Payable[]> {
  const { data, error } = await supabase
    .from('landed_cost_shipments')
    .select('name,shipment_date,currency,fx_rate,payment_terms_days,items')
    .eq('company', COMPANY)
  if (error) return []
  return (data ?? []).map(s => {
    const fx = s.fx_rate || (s.currency === 'KZT' ? 1 : 0)
    const items = Array.isArray(s.items) ? s.items : []
    const goods = items.reduce((a: number, it: { unit_price?: number; qty?: number }) => a + (it.unit_price || 0) * (it.qty || 0), 0) * fx
    return { name: s.name || 'Партия', due: addDays(s.shipment_date, s.payment_terms_days || 0), amount: goods }
  }).filter(p => p.amount > 0)
}

const EMPTY_ENTRY: Entry = { id: '', due_date: iso(new Date()), direction: 'out', category: 'Прочее', name: '', amount: 0, recurring_day: 0, recurring_until: null, note: '' }

/* ── occurrences within horizon ── */
function expand(entries: Entry[], payables: Payable[], from: Date, to: Date): Occ[] {
  const fromS = iso(from), toS = iso(to)
  const out: Occ[] = []
  const within = (d: string) => d >= fromS && d <= toS
  for (const e of entries) {
    if (e.recurring_day && e.recurring_day >= 1) {
      // ежемесячно: пройтись по месяцам горизонта (но не позже recurring_until)
      const until = e.recurring_until || null
      const cur = new Date(from.getFullYear(), from.getMonth(), 1)
      while (cur <= to) {
        const dim = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate()
        const day = Math.min(e.recurring_day, dim)
        const d = iso(new Date(cur.getFullYear(), cur.getMonth(), day))
        if (within(d) && (!until || d <= until)) out.push({ date: d, dir: e.direction, name: e.name, category: e.category, amount: e.amount, entryId: e.id })
        cur.setMonth(cur.getMonth() + 1)
      }
    } else if (within(e.due_date)) {
      out.push({ date: e.due_date, dir: e.direction, name: e.name, category: e.category, amount: e.amount, entryId: e.id })
    }
  }
  for (const p of payables) if (within(p.due)) out.push({ date: p.due, dir: 'out', name: 'Партия · ' + p.name, category: 'Поставщик', amount: p.amount, auto: true })
  return out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
}

/* ══════════════════════════════════════════════════════════════════
   SMALL UI
   ══════════════════════════════════════════════════════════════════ */
function KPI({ label, value, sub, subColor, hint }: { label: string; value: string; sub?: string; subColor?: string; hint?: string }) {
  return (
    <TremorCard className="!rounded-2xl !p-4" style={{ height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Text>{label}</Text>
        {hint && <InfoDot hint={hint} />}
      </div>
      <Metric className="mt-2 font-display !text-xl">{value}</Metric>
      {sub && <p className="mt-1 text-xs font-semibold" style={{ color: subColor ?? 'var(--t2)' }}>{sub}</p>}
    </TremorCard>
  )
}
function Panel({ title, right, children, hint }: { title: string; right?: React.ReactNode; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 16, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--t)' }}>{title}</span>
          {hint && <InfoDot hint={hint} />}
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   ENTRY FORM
   ══════════════════════════════════════════════════════════════════ */
function EntryForm({ initial, onClose, onSaved, onDeleted }: { initial: Entry; onClose: () => void; onSaved: () => void; onDeleted?: () => void }) {
  const { profile, toast } = useCRM()
  const [e, setE] = useState<Entry>(initial)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof Entry>(k: K, v: Entry[K]) => setE(p => ({ ...p, [k]: v }))
  const cats = e.direction === 'in' ? IN_CATS : OUT_CATS

  async function save() {
    if (!e.name.trim()) { toast('Укажите название'); return }
    setSaving(true)
    const payload = {
      company: COMPANY, due_date: e.due_date, direction: e.direction, category: e.category,
      name: e.name.trim(), amount: e.amount, recurring_day: e.recurring_day,
      recurring_until: e.recurring_day ? (e.recurring_until || null) : null, note: e.note ?? '',
      updated_at: new Date().toISOString(), updated_by: profile?.id ?? null,
    }
    const res = e.id
      ? await supabase.from('cash_plan_entries').update(payload).eq('id', e.id)
      : await supabase.from('cash_plan_entries').insert(payload)
    setSaving(false)
    if (res.error) { toast('Ошибка сохранения: ' + res.error.message); return }
    toast(e.id ? 'Платёж обновлён' : 'Платёж добавлен'); onSaved()
  }
  async function remove() {
    if (!e.id || !confirm('Удалить запись?')) return
    const { error } = await supabase.from('cash_plan_entries').delete().eq('id', e.id)
    if (error) { toast('Ошибка удаления: ' + error.message); return }
    toast('Удалено'); onDeleted?.()
  }
  const small: React.CSSProperties = { ...inputStyle, padding: '8px 10px', fontSize: 13 }

  return (
    <Modal onClose={onClose} maxWidth={480}>
      <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--t)', marginBottom: 14 }}>{e.id ? 'Платёж' : 'Новый платёж'}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 12 }}>
        <div><label style={labelStyle}>Тип</label>
          <select value={e.direction} onChange={ev => { const d = ev.target.value as Dir; setE(p => ({ ...p, direction: d, category: (d === 'in' ? IN_CATS : OUT_CATS)[0] })) }} style={small}>
            <option value="out">Платёж (−)</option>
            <option value="in">Поступление (+)</option>
          </select></div>
        <div><label style={labelStyle}>Категория</label>
          <select value={e.category} onChange={ev => set('category', ev.target.value)} style={small}>
            {cats.map(c => <option key={c} value={c}>{c}</option>)}
          </select></div>
        <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Название</label>
          <input value={e.name} onChange={ev => set('name', ev.target.value)} placeholder="напр. Аренда склада" style={small} /></div>
        <div><label style={labelStyle}>Сумма, ₸</label>
          <input inputMode="decimal" defaultValue={e.amount || ''} placeholder="0" onChange={ev => set('amount', num(ev.target.value))} style={small} /></div>
        <div><label style={labelStyle}>Повтор</label>
          <select value={e.recurring_day ? 'monthly' : 'once'} onChange={ev => set('recurring_day', ev.target.value === 'monthly' ? (parse(e.due_date).getDate()) : 0)} style={small}>
            <option value="once">Разовый</option>
            <option value="monthly">Ежемесячно</option>
          </select></div>
        {e.recurring_day ? (
          <>
            <div><label style={labelStyle}>Число месяца</label>
              <input inputMode="decimal" defaultValue={e.recurring_day} onChange={ev => set('recurring_day', Math.min(31, Math.max(1, Math.round(num(ev.target.value)))))} style={small} /></div>
            <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Повторять до (напр. закрытие кредита) — необязательно</label>
              <input type="date" value={e.recurring_until ?? ''} onChange={ev => set('recurring_until', ev.target.value || null)} style={small} /></div>
          </>
        ) : (
          <div><label style={labelStyle}>Дата</label>
            <input type="date" value={e.due_date} onChange={ev => set('due_date', ev.target.value)} style={small} /></div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 20 }}>
        {e.id && onDeleted ? <button onClick={remove} style={{ background: 'transparent', border: '1.5px solid #C0392B', color: '#C0392B', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Удалить</button> : <span />}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--t2)', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Отмена</button>
          <button onClick={save} disabled={saving} style={{ background: 'var(--primary)', border: 'none', color: '#fff', borderRadius: 10, padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? .6 : 1, fontFamily: 'inherit' }}>{saving ? 'Сохранение…' : 'Сохранить'}</button>
        </div>
      </div>
    </Modal>
  )
}

/* ══════════════════════════════════════════════════════════════════
   MAIN VIEW
   ══════════════════════════════════════════════════════════════════ */
export default function CashPlanView() {
  const { profile } = useCRM()
  const isMobile = useIsMobile()
  const qc = useQueryClient()
  const isAdmin = profile?.role === 'admin'
  const [opening, setOpening] = useState<number>(loadOpening)
  const [editing, setEditing] = useState<Entry | null>(null)

  const entriesQ = useQuery({ queryKey: ['cash-plan-entries'], queryFn: fetchEntries, staleTime: 60_000 })
  const payablesQ = useQuery({ queryKey: ['cash-plan-payables'], queryFn: fetchPayables, staleTime: 60_000 })
  const entries = entriesQ.data ?? []
  const payables = payablesQ.data ?? []
  const isLoading = entriesQ.isLoading || payablesQ.isLoading

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const weekStarts = useMemo(() => {
    const m = mondayOf(today)
    return Array.from({ length: HORIZON_WEEKS }, (_, i) => { const d = new Date(m); d.setDate(d.getDate() + i * 7); return d })
  }, [today])
  const horizonEnd = useMemo(() => { const d = new Date(weekStarts[HORIZON_WEEKS - 1]); d.setDate(d.getDate() + 6); return d }, [weekStarts])

  const occ = useMemo(() => expand(entries, payables, today, horizonEnd), [entries, payables, today, horizonEnd])

  // weekly rollup with running balance
  const weeks = useMemo(() => {
    let bal = opening
    return weekStarts.map((ws, i) => {
      const wsS = iso(ws)
      const weS = i < HORIZON_WEEKS - 1 ? iso(weekStarts[i + 1]) : iso(new Date(horizonEnd.getTime() + 86400000))
      const inSum = occ.filter(o => o.dir === 'in' && o.date >= wsS && o.date < weS).reduce((a, o) => a + o.amount, 0)
      const outSum = occ.filter(o => o.dir === 'out' && o.date >= wsS && o.date < weS).reduce((a, o) => a + o.amount, 0)
      bal += inSum - outSum
      return { start: wsS, inSum, outSum, net: inSum - outSum, balance: bal }
    })
  }, [occ, weekStarts, opening, horizonEnd])

  const kpi = useMemo(() => {
    const minW = weeks.reduce((m, w) => w.balance < m.balance ? w : m, weeks[0] ?? { balance: opening, start: iso(today) })
    const gap = weeks.find(w => w.balance < 0)
    const in30 = occ.filter(o => o.dir === 'in' && o.date <= addDays(iso(today), 30)).reduce((a, o) => a + o.amount, 0)
    const out30 = occ.filter(o => o.dir === 'out' && o.date <= addDays(iso(today), 30)).reduce((a, o) => a + o.amount, 0)
    return { min: minW, gap, in30, out30 }
  }, [weeks, occ, opening, today])

  function setOpen(v: number) { setOpening(v); saveOpening(v) }
  const refresh = () => { setEditing(null); qc.invalidateQueries({ queryKey: ['cash-plan-entries'] }) }

  if (!isAdmin) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>Раздел доступен только администраторам.</div>

  const btn = (bg: string, color: string, border?: string): React.CSSProperties => ({ background: bg, color, border: border ?? 'none', borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' })
  const th: React.CSSProperties = { padding: '9px 10px', textAlign: 'right', borderBottom: '1px solid var(--bd)', color: 'var(--t2)', fontWeight: 700, whiteSpace: 'nowrap', fontSize: 11 }
  const td: React.CSSProperties = { padding: '9px 10px', textAlign: 'right', borderBottom: '1px solid var(--bd)', color: 'var(--t2)', whiteSpace: 'nowrap' }

  return (
    <div style={{ padding: isMobile ? 16 : '20px 28px', display: 'flex', flexDirection: 'column', gap: isMobile ? 14 : 20 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'flex-end' }}>
        <div>
          <label style={labelStyle}>Стартовый остаток, ₸</label>
          <input inputMode="decimal" defaultValue={opening || ''} placeholder="0" onChange={e => setOpen(num(e.target.value))} style={{ ...inputStyle, padding: '7px 10px', fontSize: 13, width: 160 }} />
        </div>
        <button onClick={() => setEditing({ ...EMPTY_ENTRY })} style={btn('var(--primary)', '#fff')}>+ Платёж</button>
      </div>

      {isLoading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>Загрузка…</div>}

      {!isLoading && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,minmax(0,1fr))' : 'repeat(4,minmax(0,1fr))', gap: isMobile ? 10 : 14 }}>
            <KPI label="Остаток сейчас" value={fmtMoney(opening)} sub="на счетах"
              hint="Стартовый остаток денег на счетах — вводится вручную сверху. От него считается весь прогноз остатка по неделям." />
            <KPI label="Мин. остаток (12 нед)" value={fmtMoney(kpi.min.balance)} sub={`нед. ${ddmm(kpi.min.start)}`} subColor={kpi.min.balance < 0 ? '#C0392B' : 'var(--primary)'}
              hint="Самая нижняя точка остатка денег за 12 недель горизонта и неделя, когда она наступает. Если ниже нуля — в этот момент денег не хватит." />
            <KPI label="Ближайший разрыв" value={kpi.gap ? ddmm(kpi.gap.start) : '—'} sub={kpi.gap ? `дефицит ${fmtMoney(kpi.gap.balance)}` : 'разрывов нет'} subColor={kpi.gap ? '#C0392B' : 'var(--primary)'}
              hint="Первая неделя, когда остаток становится отрицательным (кассовый разрыв). Сигнал заранее подготовить деньги или сдвинуть платежи." />
            <KPI label="К оплате за 30 дн" value={fmtMoney(kpi.out30)} sub={`поступления ${fmtMoney(kpi.in30)}`} subColor="#D97706"
              hint="Сумма всех запланированных платежей на ближайшие 30 дней (в подписи — ожидаемые поступления за тот же срок). Показывает нагрузку на кассу." />
          </div>

          <Panel title="Платёжный календарь · 12 недель" hint="Прогноз денег по неделям: поступления, платежи, итог за неделю и накопительный остаток на конец недели. Красные строки — недели с кассовым разрывом (остаток ниже нуля)." right={<span style={{ fontSize: 11, color: 'var(--t3)' }}>красным — кассовый разрыв</span>}>
            <div style={{ overflowX: 'auto', border: '1px solid var(--bd)', borderRadius: 12 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, minWidth: 520 }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: 'left' }}>Неделя с</th>
                  <th style={th}>Поступления</th>
                  <th style={th}>Платежи</th>
                  <th style={th}>Итого</th>
                  <th style={th}>Остаток на конец</th>
                </tr></thead>
                <tbody>
                  {weeks.map(w => (
                    <tr key={w.start} style={{ background: w.balance < 0 ? 'rgba(192,57,43,.08)' : 'transparent' }}>
                      <td style={{ ...td, textAlign: 'left', color: 'var(--t)', fontWeight: 600 }}>{ddmm(w.start)}</td>
                      <td style={{ ...td, color: w.inSum ? 'var(--primary)' : 'var(--t3)' }}>{w.inSum ? fmtFull(w.inSum) : '—'}</td>
                      <td style={{ ...td, color: w.outSum ? '#D97706' : 'var(--t3)' }}>{w.outSum ? fmtFull(w.outSum) : '—'}</td>
                      <td style={{ ...td, color: w.net >= 0 ? 'var(--primary)' : '#C0392B' }}>{w.net ? fmtFull(w.net) : '—'}</td>
                      <td style={{ ...td, color: w.balance < 0 ? '#C0392B' : 'var(--t)', fontWeight: 800 }}>{fmtFull(w.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Предстоящие платежи" hint="Список всех платежей и поступлений на горизонте по датам. Ручные записи можно открыть и изменить кликом; строки «Партия» подтягиваются автоматически из «Партий» (дата закупки + отсрочка поставщика)." right={<span style={{ fontSize: 11, color: 'var(--t3)' }}>клик — изменить · «Партия» тянется из закупок</span>}>
            {occ.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>Нет запланированных платежей. Нажмите «+ Платёж» — добавьте аренду, ФОТ, налоги, кредит.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {occ.map((o, i) => {
                  const clickable = !o.auto && o.entryId
                  return (
                    <div key={i} onClick={() => { if (clickable) { const en = entries.find(e => e.id === o.entryId); if (en) setEditing(en) } }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 4px', borderBottom: '1px solid var(--bd)', cursor: clickable ? 'pointer' : 'default' }}>
                      <span style={{ width: 54, fontSize: 12, color: 'var(--t3)', flexShrink: 0 }}>{dayMon(o.date)}</span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--t)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {o.name}
                        <span style={{ fontSize: 11, color: 'var(--t3)', marginLeft: 6 }}>{o.category}{o.auto ? ' · авто' : ''}</span>
                      </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: o.dir === 'in' ? 'var(--primary)' : '#D97706', whiteSpace: 'nowrap' }}>
                        {o.dir === 'in' ? '+' : '−'}{fmtFull(o.amount)} ₸
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>
        </>
      )}

      {editing && (
        <EntryForm initial={editing} onClose={() => setEditing(null)} onSaved={refresh} onDeleted={editing.id ? refresh : undefined} />
      )}
    </div>
  )
}
