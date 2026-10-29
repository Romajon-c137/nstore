'use client'

import { fmtDate,fmtMoney,fmtRelative } from '@/shared/lib/format'
import { useNavigate } from '@/shared/lib/navigation'
import { supabase } from '@/shared/lib/supabase'
import { Metric,Text,Card as TremorCard,type Color } from '@/shared/ui/charts'
import { Button,InfoDot } from '@/shared/ui/ui'
import { useCRM } from '@/views/crm/context/CRMContext'
import { SearchInput,Segmented,useIsMobile } from '@/views/crm/shared/crmui'
import { useQuery } from '@tanstack/react-query'
import { lazy,Suspense,useEffect,useMemo,useRef,useState } from 'react'
import { createPortal } from 'react-dom'

// Компоненты tremor монолитны и тянут recharts (~230КБ gzip) — грузим их лениво,
// чтобы дашборд появлялся сразу, а графики догружались отдельным чанком.
const AreaChart = lazy(() => import('@/views/crm/tabs/dash/AreaChartLazy'))
const BarList = lazy(() => import('@/views/crm/tabs/dash/BarListLazy'))

/* ══════════════════════════════════════════════════════════════════
   TYPES
   ══════════════════════════════════════════════════════════════════ */
interface OrderItem { qty?: number; name?: string; price?: string | number }
interface Order {
  id: string
  title: string | null
  total: number | null
  order_status: string | null
  client_id: string | null
  client_name: string | null
  manager_id: string | null
  created_at: string
  completed_at: string | null
  items: OrderItem[] | null
}
interface TaskRow {
  id: string
  is_done: boolean | null
  client_id: string | null
  tags: string[] | null
  assignee_id: string | null
}
interface ManagerRow { id: string; name: string | null }
interface ClientRow { id: string; name: string | null; manager_id: string | null; relation_status: string | null }
interface KpiGoal { manager_id: string; rev_goal: number; orders_goal: number; clients_goal: number }
interface LostClient {
  client_id: string
  client_name: string | null
  manager_id: string | null
  manager_name: string | null
  last_order: string | null
  days_since: number | null
  orders_count: number
  total_spent: number
}

/* ── форматтеры вынесены в общий lib/format ── */

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  new:        { label: 'Новые',         color: 'var(--t2)', bg: 'var(--bg3)' },
  confirmed:  { label: 'Подтверждены',  color: '#0E7C46', bg: '#E6F6EE' },
  picking:    { label: 'Сборка',        color: '#6E2BD9', bg: '#F4EEFE' },
  delivering: { label: 'В доставке',    color: '#B25E00', bg: '#FFF1DD' },
  done:       { label: 'Выполнены',     color: '#0B6E3E', bg: '#E6F6EE' },
  cancelled:  { label: 'Отменены',      color: '#C0392B', bg: '#FCE9E5' },
}
const STATUS_ORDER = ['new', 'confirmed', 'picking', 'delivering', 'done', 'cancelled']

// Tremor named colors mirroring STATUS_META hues (for BarList)
const STATUS_TREMOR_COLOR: Record<string, Color> = {
  new: 'slate',
  confirmed: 'emerald',
  picking: 'violet',
  delivering: 'amber',
  done: 'green',
  cancelled: 'red',
}

const PERIODS = [
  { key: 7,  label: '7 дней'  },
  { key: 30, label: '30 дней' },
  { key: 90, label: '90 дней' },
  { key: 0,  label: 'Всё время' },
] as const

/* ── Mobile hook ── */

/* ── client key (orders link by id OR name) ── */
const clientKey = (o: { client_id: string | null; client_name: string | null }) =>
  o.client_id || (o.client_name ? `name:${o.client_name}` : null)

/* ══════════════════════════════════════════════════════════════════
   DATA
   ══════════════════════════════════════════════════════════════════ */
async function fetchAnalytics() {
  const yearAgo = new Date()
  yearAgo.setFullYear(yearAgo.getFullYear() - 1)
  const monthStart = new Date()
  monthStart.setDate(1)

  const [oRes, tRes, mRes, cRes, kRes, lRes, pTotRes, pImgRes, ctrRes] = await Promise.all([
    supabase.from('crm_tasks')
      .select('id,title,total,order_status,client_id,client_name,manager_id,created_at,completed_at,items')
      .eq('task_type', 'order')
      .gte('created_at', yearAgo.toISOString())
      .order('created_at', { ascending: false }),
    supabase.from('crm_tasks')
      .select('id,is_done,client_id,tags,assignee_id')
      .eq('task_type', 'task'),
    supabase.from('profiles').select('id,name').in('role', ['manager', 'admin']),
    supabase.from('profiles').select('id,name,manager_id,relation_status').eq('role', 'client'),
    supabase.from('kpi_goals').select('manager_id,rev_goal,orders_goal,clients_goal')
      .gte('month', monthStart.toISOString().slice(0, 10)),
    supabase.rpc('crm_lost_clients', { p_days: 4 }),
    supabase.from('products').select('id', { count: 'exact', head: true }),
    supabase.from('products').select('id', { count: 'exact', head: true }).not('image_url', 'is', null).neq('image_url', ''),
    supabase.from('contracts').select('created_at'),
  ])

  return {
    orders:   (oRes.data ?? []) as Order[],
    tasks:    (tRes.data ?? []) as TaskRow[],
    managers: (mRes.data ?? []) as ManagerRow[],
    clients:  (cRes.data ?? []) as ClientRow[],
    goals:    (kRes.data ?? []) as KpiGoal[],
    lost:     (lRes.data ?? []) as LostClient[],
    productsTotal:   pTotRes.count ?? 0,
    productsWithImg: pImgRes.count ?? 0,
    contracts: (ctrRes.data ?? []) as { created_at: string }[],
  }
}

/* ── parse price strings like "1 160" → 1160 ── */
const parsePrice = (p: string | number | undefined) =>
  typeof p === 'number' ? p : Number(String(p ?? '').replace(/\s/g, '')) || 0

/* ══════════════════════════════════════════════════════════════════
   SMALL UI
   ══════════════════════════════════════════════════════════════════ */
function Card({ children, pad = 18 }: { children: React.ReactNode; pad?: number }) {
  return <div style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 16, padding: pad }}>{children}</div>
}

function KPICard({ label, value, sub, subColor, accent, active, onClick, hint }: {
  label: string; value: string; sub: string; subColor: string
  accent?: string; active?: boolean; onClick?: () => void; hint?: string
}) {
  return (
    <TremorCard
      onClick={onClick}
      decoration={accent && !active ? 'left' : undefined}
      decorationColor="rose"
      className={`!rounded-2xl !p-4 ${onClick ? 'cursor-pointer transition-shadow hover:shadow-tremor-card' : ''}`}
      style={active ? { background: accent ?? '#10A35B', borderColor: accent ?? '#10A35B', boxShadow: `0 4px 18px ${(accent ?? '#10A35B')}33` } : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Text className={active ? '!text-white/80' : ''}>{label}</Text>
        {hint && <InfoDot hint={hint} />}
      </div>
      <Metric className={`mt-2 font-display !text-xl ${active ? '!text-white' : ''}`}>{value}</Metric>
      <p className="mt-1 text-xs font-semibold" style={{ color: active ? 'rgba(255,255,255,.85)' : subColor }}>{sub}</p>
    </TremorCard>
  )
}

function SectionTitle({ children, right, hint }: { children: React.ReactNode; right?: React.ReactNode; hint?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--t)' }}>{children}</span>
        {hint && <InfoDot hint={hint} />}
      </div>
      {right}
    </div>
  )
}

/* ── Revenue timeline (adaptive buckets) ── */
function RevenueTimeline({ orders, periodDays }: { orders: Order[]; periodDays: number }) {
  const buckets = useMemo(() => {
    const now = new Date()
    const valid = orders.filter(o => o.order_status !== 'cancelled' && o.total)
    let bucketCount: number, bucketDays: number, mode: 'day' | 'week' | 'month'
    if (periodDays === 7)       { bucketCount = 7;  bucketDays = 1;  mode = 'day' }
    else if (periodDays === 30) { bucketCount = 10; bucketDays = 3;  mode = 'day' }
    else if (periodDays === 90) { bucketCount = 13; bucketDays = 7;  mode = 'week' }
    else                        { bucketCount = 12; bucketDays = 30; mode = 'month' }

    const out: { label: string; value: number }[] = []
    for (let i = bucketCount - 1; i >= 0; i--) {
      const end = new Date(now); end.setDate(now.getDate() - i * bucketDays); end.setHours(23, 59, 59, 999)
      const start = new Date(end); start.setDate(end.getDate() - bucketDays + 1); start.setHours(0, 0, 0, 0)
      const value = valid
        .filter(o => { const d = new Date(o.created_at); return d >= start && d <= end })
        .reduce((s, o) => s + (o.total ?? 0), 0)
      const label =
        mode === 'day'   ? start.toLocaleDateString('ru-RU', { day: '2-digit', month: bucketDays > 1 ? '2-digit' : undefined }) :
        mode === 'week'  ? start.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) :
                           start.toLocaleDateString('ru-RU', { month: 'short' })
      out.push({ label, value })
    }
    return out
  }, [orders, periodDays])

  const empty = buckets.every(b => b.value === 0)
  const chartData = buckets.map(b => ({ date: b.label, 'Оборот': b.value }))

  return (
    <Card pad={20}>
      <SectionTitle right={<span style={{ fontSize: 11, color: 'var(--t3)' }}>оборот, ₸</span>}
        hint="Оборот по интервалам внутри периода (день, неделя или месяц — подбирается автоматически по длине периода). Показывает тренд продаж во времени.">Динамика оборота</SectionTitle>
      {empty ? (
        <div style={{ height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)', fontSize: 13 }}>Нет данных за период</div>
      ) : (
        <Suspense fallback={<div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)', fontSize: 13 }}>Загрузка графика…</div>}>
          <AreaChart
            className="mt-2 h-40"
            data={chartData}
            index="date"
            categories={['Оборот']}
            colors={['emerald']}
            valueFormatter={fmtMoney}
            showLegend={false}
            showYAxis={false}
            showGridLines={false}
            startEndOnly={chartData.length > 8}
            curveType="monotone"
            showGradient
          />
        </Suspense>
      )}
    </Card>
  )
}

/* ── Status funnel (clickable) ── */
function StatusFunnel({ orders, statusFilter, onPick }: {
  orders: Order[]; statusFilter: string; onPick: (s: string) => void
}) {
  const bars = STATUS_ORDER.map(id => ({
    key: id,
    name: STATUS_META[id].label,
    value: orders.filter(o => o.order_status === id).length,
    color: STATUS_TREMOR_COLOR[id],
  }))
  return (
    <Card pad={20}>
      <SectionTitle right={<span style={{ fontSize: 11, color: 'var(--t3)' }}>клик — фильтр</span>}
        hint="Количество заявок в каждом статусе воронки — от новых до выполненных и отменённых. Клик по строке фильтрует весь дашборд по этому статусу.">Заявки по статусам</SectionTitle>
      {orders.length === 0 ? (
        <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>Нет заявок за период</div>
      ) : (
        <Suspense fallback={<div style={{ height: 120 }} />}>
          <BarList
            data={bars}
            sortOrder="none"
            showAnimation
            onValueChange={bar => onPick(statusFilter === bar.key ? '' : String(bar.key))}
            className="mt-2 cursor-pointer"
          />
        </Suspense>
      )}
    </Card>
  )
}

/* ══════════════════════════════════════════════════════════════════
   NEW ORDER MODAL (preserved)
   ══════════════════════════════════════════════════════════════════ */
function NewOrderModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ client_name: '', client_phone: '', address: '', total: '', note: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.client_name.trim()) { setError('Введите имя клиента'); return }
    setSaving(true)
    const { error: err } = await supabase.from('crm_tasks').insert({
      task_type: 'order', order_status: 'new', title: form.client_name, client_name: form.client_name,
      client_phone: form.client_phone || null, address: form.address || null,
      total: form.total ? parseInt(form.total) : null, note: form.note || null,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    onClose()
  }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--bg2)', borderRadius: 20, width: '100%', maxWidth: 480, padding: 28, boxShadow: '0 24px 80px rgba(0,0,0,.25)', maxHeight: '90dvh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, color: 'var(--t)' }}>Новая заявка</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--t2)', lineHeight: 1 }}>×</button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[
            { key: 'client_name', label: 'Клиент *', placeholder: 'Имя клиента', type: 'text' },
            { key: 'client_phone', label: 'Телефон', placeholder: '+7 (___) ___-__-__', type: 'tel' },
            { key: 'address', label: 'Адрес', placeholder: 'Адрес доставки', type: 'text' },
            { key: 'total', label: 'Сумма (₸)', placeholder: '0', type: 'number' },
          ].map(f => (
            <div key={f.key}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{f.label}</div>
              <input type={f.type} placeholder={f.placeholder} value={form[f.key as keyof typeof form]}
                onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1.5px solid var(--bd)', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', color: 'var(--t)' }}
                onFocus={e => (e.target.style.borderColor = 'var(--primary)')} onBlur={e => (e.target.style.borderColor = 'var(--bd)')} />
            </div>
          ))}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Примечание</div>
            <textarea placeholder="Дополнительная информация..." value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))} rows={2}
              style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1.5px solid var(--bd)', fontSize: 13, fontFamily: 'inherit', outline: 'none', resize: 'none', boxSizing: 'border-box', color: 'var(--t)' }}
              onFocus={e => (e.target.style.borderColor = 'var(--primary)')} onBlur={e => (e.target.style.borderColor = 'var(--bd)')} />
          </div>
          {error && <div style={{ fontSize: 12, color: '#C0392B', fontWeight: 600 }}>{error}</div>}
          <Button type="submit" full loading={saving} style={{ marginTop: 4 }}>
            {saving ? 'Сохранение...' : 'Создать заявку'}
          </Button>
        </form>
      </div>
    </div>,
    document.body,
  )
}

/* ══════════════════════════════════════════════════════════════════
   ADMIN: KPI GOALS (monthly plan per manager)
   ══════════════════════════════════════════════════════════════════ */
function KpiGoalsModal({ managers, adminId, onClose, onSaved, toast }: {
  managers: ManagerRow[]
  adminId: string | null
  onClose: () => void
  onSaved: () => void
  toast: (msg: string) => void
}) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7)) // YYYY-MM
  const monthDate = `${month}-01`
  const [rows, setRows] = useState<Record<string, { rev: string; orders: string; clients: string }>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Load existing goals for the selected month
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data } = await supabase.from('kpi_goals')
        .select('manager_id,rev_goal,orders_goal,clients_goal')
        .eq('month', monthDate)
      if (cancelled) return
      const map: Record<string, { rev: string; orders: string; clients: string }> = {}
      managers.forEach(m => { map[m.id] = { rev: '', orders: '', clients: '' } })
      ;(data ?? []).forEach(g => {
        const row = g as { manager_id: string; rev_goal: number; orders_goal: number; clients_goal: number }
        map[row.manager_id] = {
          rev: row.rev_goal ? String(row.rev_goal) : '',
          orders: row.orders_goal ? String(row.orders_goal) : '',
          clients: row.clients_goal ? String(row.clients_goal) : '',
        }
      })
      setRows(map)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [monthDate, managers])

  const setField = (id: string, key: 'rev' | 'orders' | 'clients', val: string) =>
    setRows(p => ({ ...p, [id]: { ...(p[id] ?? { rev: '', orders: '', clients: '' }), [key]: val.replace(/[^\d]/g, '') } }))

  async function save() {
    setSaving(true)
    const payload = managers.map(m => ({
      manager_id: m.id,
      month: monthDate,
      rev_goal: Number(rows[m.id]?.rev) || 0,
      orders_goal: Number(rows[m.id]?.orders) || 0,
      clients_goal: Number(rows[m.id]?.clients) || 0,
      created_by: adminId,
      updated_at: new Date().toISOString(),
    }))
    const { error } = await supabase.from('kpi_goals').upsert(payload, { onConflict: 'manager_id,month' })
    setSaving(false)
    if (error) { toast('Ошибка: ' + error.message); return }
    toast('Планы сохранены')
    onSaved()
    onClose()
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 10px', borderRadius: 8, border: '1.5px solid var(--bd)',
    fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
    color: 'var(--t)', background: 'var(--bg2)',
  }
  const gridCols = 'minmax(0,1.4fr) repeat(3, minmax(0,1fr))'

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--bg2)', borderRadius: 20, width: '100%', maxWidth: 560, padding: 24, boxShadow: '0 24px 80px rgba(0,0,0,.25)', maxHeight: '90dvh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, color: 'var(--t)' }}>Планы менеджеров</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--t2)', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)' }}>Месяц</span>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ ...inputStyle, width: 'auto' }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 8, fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.04em', paddingBottom: 8, borderBottom: '1px solid var(--bd)' }}>
          <span>Менеджер</span><span>Оборот ₸</span><span>Заявки</span><span>Клиенты</span>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, paddingTop: 4 }}>
          {loading ? (
            <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>Загрузка…</div>
          ) : managers.length === 0 ? (
            <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>Нет менеджеров</div>
          ) : managers.map(m => (
            <div key={m.id} style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 8, alignItems: 'center', padding: '6px 0' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name || '—'}</span>
              <input inputMode="numeric" placeholder="0" value={rows[m.id]?.rev ?? ''} onChange={e => setField(m.id, 'rev', e.target.value)} style={inputStyle} />
              <input inputMode="numeric" placeholder="0" value={rows[m.id]?.orders ?? ''} onChange={e => setField(m.id, 'orders', e.target.value)} style={inputStyle} />
              <input inputMode="numeric" placeholder="0" value={rows[m.id]?.clients ?? ''} onChange={e => setField(m.id, 'clients', e.target.value)} style={inputStyle} />
            </div>
          ))}
        </div>

        <Button onClick={save} full loading={saving} disabled={loading} style={{ marginTop: 16 }}>
          {saving ? 'Сохранение…' : 'Сохранить планы'}
        </Button>
      </div>
    </div>,
    document.body,
  )
}

/* ── Currency rates (НБ РК) ── */
interface FxRate { currency: string; rate: number; change: number; as_of: string | null }
function CurrencyRates() {
  const { data } = useQuery({
    queryKey: ['fx-rates'],
    queryFn: async () => {
      const { data } = await supabase.from('fx_rates').select('currency,rate,change,as_of')
      const map: Record<string, FxRate> = {}
      ;(data ?? []).forEach((r) => { map[(r as FxRate).currency] = r as FxRate })
      return map
    },
    staleTime: 30 * 60_000,
    refetchInterval: 60 * 60_000,
  })

  const items = [
    { code: 'USD', sym: '$', d: data?.USD },
    { code: 'RUB', sym: '₽', d: data?.RUB },
  ].filter(x => x.d) as { code: string; sym: string; d: FxRate }[]
  if (!items.length) return null

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {items.map(it => {
        // change = курс сегодня − вчера. Вырос → зелёный, упал → красный.
        const ch = Number(it.d.change) || 0
        const col = ch > 0 ? '#0E7C46' : ch < 0 ? '#C0392B' : 'var(--t3)'
        const arrow = ch > 0 ? '▲' : ch < 0 ? '▼' : ''
        const rateCol = ch !== 0 ? col : 'var(--t)'
        return (
          <div key={it.code} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 12, padding: '7px 12px' }}>
            <div style={{ width: 26, height: 26, borderRadius: 8, background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 14, color: 'var(--t)', flexShrink: 0 }}>{it.sym}</div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--t3)', fontWeight: 700, letterSpacing: '.4px' }}>{it.code}/KZT</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: rateCol, fontFamily: 'var(--font-display)', lineHeight: 1.1 }}>
                {Number(it.d.rate).toLocaleString('ru-RU')} ₸
              </div>
            </div>
            {arrow && <span style={{ fontSize: 10, color: col, fontWeight: 700, whiteSpace: 'nowrap' }}>{arrow} {Math.abs(ch).toFixed(2)}</span>}
          </div>
        )
      })}
      <span style={{ fontSize: 10, color: 'var(--t3)' }}>
        НБ РК{items[0].d.as_of ? ` · ${items[0].d.as_of.split('-').reverse().join('.')}` : ''}
      </span>
    </div>
  )
}

/* ── Skeleton ── */
function Skeleton({ isMobile }: { isMobile: boolean }) {
  return (
    <div style={{ padding: isMobile ? 16 : '24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,minmax(0,1fr))' : 'repeat(6,minmax(0,1fr))', gap: 12 }}>
        {[...Array(6)].map((_, i) => <div key={i} style={{ height: 92, background: 'var(--bg2)', borderRadius: 16, animation: 'pulse 1.5s infinite' }} />)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0,1fr)' : 'minmax(0,1.6fr) minmax(0,1fr)', gap: 16 }}>
        <div style={{ height: 210, background: 'var(--bg2)', borderRadius: 16, animation: 'pulse 1.5s infinite' }} />
        <div style={{ height: 210, background: 'var(--bg2)', borderRadius: 16, animation: 'pulse 1.5s infinite' }} />
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   MAIN
   ══════════════════════════════════════════════════════════════════ */
export default function DashTab() {
  const { profile, toast } = useCRM()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const lostRef = useRef<HTMLDivElement>(null)

  const [period, setPeriod]         = useState<number>(30)
  const [managerFilter, setManager] = useState<string>('')
  const [statusFilter, setStatus]   = useState<string>('')
  const [search, setSearch]         = useState('')
  const [showNewOrder, setShowNew]  = useState(false)
  const [showGoals, setShowGoals]   = useState(false)
  const [genLoading, setGenLoading] = useState(false)
  const isAdmin = profile?.role === 'admin'

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard-analytics'],
    queryFn: fetchAnalytics,
    staleTime: 60_000,
    refetchInterval: 180_000,
  })

  // Default manager filter to self for managers
  useEffect(() => {
    if (profile?.role === 'manager' && profile.id) setManager(profile.id)
  }, [profile?.role, profile?.id])

  const all = data
  const managerName = (id: string | null) => all?.managers.find(m => m.id === id)?.name || 'Без менеджера'

  /* ── filtered orders ── */
  const orders = useMemo(() => {
    if (!all) return []
    const since = period === 0 ? 0 : Date.now() - period * 86400000
    return all.orders.filter(o => {
      if (period !== 0 && new Date(o.created_at).getTime() < since) return false
      if (managerFilter && o.manager_id !== managerFilter) return false
      if (statusFilter && o.order_status !== statusFilter) return false
      return true
    })
  }, [all, period, managerFilter, statusFilter])

  /* ── metrics ── */
  const m = useMemo(() => {
    const live = orders.filter(o => o.order_status !== 'cancelled')
    const done = orders.filter(o => o.order_status === 'done')
    const revenue = live.reduce((s, o) => s + (o.total ?? 0), 0)
    const activeClients = new Set(live.map(clientKey).filter(Boolean)).size
    return {
      revenue,
      ordersCount: orders.length,
      avgCheck: live.length ? revenue / live.length : 0,
      activeClients,
      doneCount: done.length,
      conversion: orders.length ? Math.round(done.length / orders.length * 100) : 0,
      ordersPerClient: activeClients ? live.length / activeClients : 0,
    }
  }, [orders])

  /* ── lost clients (respect manager filter) ── */
  const lost = useMemo(() => {
    if (!all) return []
    return managerFilter ? all.lost.filter(l => l.manager_id === managerFilter) : all.lost
  }, [all, managerFilter])

  // client_ids that already have an open reactivation task
  const reactSet = useMemo(() => {
    const s = new Set<string>()
    all?.tasks.forEach(t => { if (!t.is_done && t.tags?.includes('reactivation') && t.client_id) s.add(t.client_id) })
    return s
  }, [all])

  /* ── managers leaderboard ── */
  const managerStats = useMemo(() => {
    if (!all) return []
    const goalMap = new Map(all.goals.map(g => [g.manager_id, g]))
    const rows = all.managers.map(mgr => {
      const mo = orders.filter(o => o.manager_id === mgr.id && o.order_status !== 'cancelled')
      const rev = mo.reduce((s, o) => s + (o.total ?? 0), 0)
      const clients = new Set(mo.map(clientKey).filter(Boolean)).size
      const goal = goalMap.get(mgr.id)
      return { id: mgr.id, name: mgr.name || '—', orders: mo.length, rev, clients, avg: mo.length ? rev / mo.length : 0, goal: goal?.rev_goal ?? 0 }
    })
    return rows.sort((a, b) => b.rev - a.rev)
  }, [all, orders])

  /* ── top clients ── */
  const topClients = useMemo(() => {
    const map = new Map<string, { name: string; rev: number; count: number }>()
    orders.filter(o => o.order_status !== 'cancelled').forEach(o => {
      const k = clientKey(o); if (!k) return
      const name = o.client_name || all?.clients.find(c => c.id === o.client_id)?.name || 'Клиент'
      const cur = map.get(k) ?? { name, rev: 0, count: 0 }
      cur.rev += o.total ?? 0; cur.count += 1; map.set(k, cur)
    })
    return [...map.values()].sort((a, b) => b.rev - a.rev).slice(0, 6)
  }, [orders, all])

  /* ── top products (from order items) ── */
  const topProducts = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; rev: number; orders: number }>()
    orders.filter(o => o.order_status !== 'cancelled').forEach(o => {
      (o.items ?? []).forEach(it => {
        const name = (it.name ?? '').trim(); if (!name) return
        const qty = Number(it.qty) || 0
        const cur = map.get(name) ?? { name, qty: 0, rev: 0, orders: 0 }
        cur.qty += qty
        cur.rev += qty * parsePrice(it.price)
        cur.orders += 1
        map.set(name, cur)
      })
    })
    return [...map.values()].sort((a, b) => b.qty - a.qty).slice(0, 7)
  }, [orders])

  /* ── DB stats ── */
  const dbStats = useMemo(() => {
    if (!all) return { total: 0, withImg: 0, imgPct: 0, contractsPeriod: 0, contractsTotal: 0 }
    const since = period === 0 ? 0 : Date.now() - period * 86400000
    const contractsPeriod = all.contracts.filter(c => period === 0 || new Date(c.created_at).getTime() >= since).length
    return {
      total: all.productsTotal,
      withImg: all.productsWithImg,
      imgPct: all.productsTotal ? Math.round(all.productsWithImg / all.productsTotal * 100) : 0,
      contractsPeriod,
      contractsTotal: all.contracts.length,
    }
  }, [all, period])

  /* ── recent orders (search) ── */
  const recent = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q
      ? orders.filter(o => (o.client_name ?? '').toLowerCase().includes(q) || (o.title ?? '').toLowerCase().includes(q) || o.id.toLowerCase().includes(q))
      : orders
    return list.slice(0, 6)
  }, [orders, search])

  /* ── actions ── */
  async function generateReminders() {
    setGenLoading(true)
    const { data: cnt, error } = await supabase.rpc('crm_generate_lost_reminders', { p_days: 4 })
    setGenLoading(false)
    if (error) { toast('Ошибка: ' + error.message); return }
    toast(cnt > 0 ? `Создано задач: ${cnt}` : 'Новых задач нет — всё уже назначено')
    refetch()
  }
  async function remindOne(l: LostClient) {
    if (!l.manager_id) { toast('У клиента нет закреплённого менеджера'); return }
    const { error } = await supabase.from('crm_tasks').insert({
      task_type: 'task', priority: 'high', is_done: false,
      title: 'Связаться с клиентом: ' + (l.client_name || 'без имени'),
      description: `Клиент не делал заказ ${l.days_since ?? '?'} дн. (последний заказ ${fmtDate(l.last_order)}). Позвонить и реактивировать.`,
      assignee_id: l.manager_id, manager_id: l.manager_id, client_id: l.client_id,
      tags: ['reactivation'], due_date: new Date().toISOString().slice(0, 10),
    })
    if (error) { toast('Ошибка: ' + error.message); return }
    toast('Задача создана менеджеру')
    refetch()
  }

  const filtersActive = period !== 30 || !!managerFilter || !!statusFilter

  /* ── layout helpers ── */
  const pad = isMobile ? 16 : '24px 28px'
  const kpiCols = isMobile ? 'repeat(2,minmax(0,1fr))' : 'repeat(6,minmax(0,1fr))'
  const twoCol = isMobile ? 'minmax(0,1fr)' : 'minmax(0,1.6fr) minmax(0,1fr)'

  /* ── filter bar ── */
  const filterBar = all && (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <Segmented value={period} onChange={setPeriod} options={PERIODS.map(p => ({ value: p.key, label: p.label }))} />
      <select value={managerFilter} onChange={e => setManager(e.target.value)}
        style={{ padding: '8px 12px', borderRadius: 10, border: '1.5px solid var(--bd)', background: 'var(--bg2)', fontSize: 13, fontFamily: 'inherit', color: 'var(--t)', cursor: 'pointer' }}>
        <option value="">Все менеджеры</option>
        {all.managers.map(mgr => <option key={mgr.id} value={mgr.id}>{mgr.name || '—'}</option>)}
      </select>
      {filtersActive && (
        <button onClick={() => { setPeriod(30); setManager(''); setStatus('') }}
          style={{ padding: '8px 12px', borderRadius: 10, border: '1.5px solid var(--bd)', background: 'var(--bg2)', fontSize: 12, fontWeight: 600, color: '#C0392B', cursor: 'pointer', fontFamily: 'inherit' }}>
          Сбросить ✕
        </button>
      )}
    </div>
  )

  return (
    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: isMobile ? '12px 16px' : '16px 28px', borderBottom: '1px solid var(--bd)', background: 'var(--bg2)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, flex: '1 1 100%' }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Поиск заявки…" grow maxWidth={99999} />
          <Button onClick={() => setShowNew(true)} style={{ height: 38, borderRadius: 10, fontSize: 12 }}>
            + Заявка
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      {all && <div style={{ padding: isMobile ? '12px 16px' : '14px 28px', background: 'var(--bg2)', borderBottom: '1px solid var(--bd)' }}>{filterBar}</div>}

      <div style={{ padding: isMobile ? '12px 16px 0' : '14px 28px 0' }}><CurrencyRates /></div>

      {profile?.name && (
        <div style={{ padding: isMobile ? '10px 16px 0' : '14px 28px 0' }}>
          <div style={{ fontSize: 13, color: 'var(--t2)' }}>
            Привет, <b style={{ color: 'var(--primary)' }}>{profile.name}</b>
          </div>
          <div style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 700, marginTop: 3, lineHeight: 1.45, maxWidth: 620 }}>
            Упрощаем закупки продуктов и соединяем производителей с бизнесом — <b style={{ fontWeight: 800 }}>быстрее, проще, эффективнее</b>, помогая бизнесу расти.
          </div>
        </div>
      )}

      {isLoading && <Skeleton isMobile={isMobile} />}

      {isError && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#C0392B' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Ошибка загрузки данных</div>
          <Button size="sm" onClick={() => refetch()} style={{ borderRadius: 10, paddingLeft: 20, paddingRight: 20 }}>Повторить</Button>
        </div>
      )}

      {all && (
        <div style={{ padding: pad, display: 'flex', flexDirection: 'column', gap: isMobile ? 14 : 20 }}>
          {/* KPI */}
          <div style={{ display: 'grid', gridTemplateColumns: kpiCols, gap: isMobile ? 10 : 14 }}>
            <KPICard label="Оборот" value={fmtMoney(m.revenue)} sub={`${m.ordersCount} заявок`} subColor="#10A35B"
              hint="Сумма всех заявок за выбранный период, кроме отменённых. Главный индикатор объёма продаж и роста." />
            <KPICard label="Средний чек" value={fmtMoney(m.avgCheck)} sub={`${m.doneCount} выполнено`} subColor="#7C3AED"
              hint="Оборот ÷ число активных заявок (без отменённых). Чем выше, тем крупнее средний заказ — цель для допродаж." />
            <KPICard label="Активные клиенты" value={String(m.activeClients)} sub="заказывали в период" subColor="#2563EB"
              hint="Уникальные клиенты, сделавшие хотя бы одну заявку за период. Отражает реальный охват базы." />
            <KPICard label="Конверсия" value={`${m.conversion}%`} sub={m.conversion >= 50 ? '▲ хороший' : m.ordersCount ? '▼ низкий' : '— нет данных'} subColor={m.conversion >= 50 ? 'var(--primary)' : '#C0392B'}
              hint="Доля выполненных заявок от всех созданных (выполнено ÷ всего). Ниже 50% — заявки теряются на пути к отгрузке." />
            <KPICard label="Заявок на клиента" value={m.ordersPerClient ? m.ordersPerClient.toFixed(1) : '—'} sub="в среднем за период" subColor="#0891B2"
              hint="Заявки ÷ активные клиенты. Выше — клиенты заказывают чаще, лояльность и повторные продажи растут." />
            <KPICard label="Пропавшие клиенты" value={String(lost.length)} sub={lost.length ? 'нужен обзвон' : 'все на связи'} subColor="#C0392B" accent="#E5484D"
              hint="Клиенты без заказа более 4 дней. Требуют обзвона и реактивации — клик по карточке открывает список."
              active={false} onClick={() => lostRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
          </div>

          {/* Charts */}
          <div style={{ display: 'grid', gridTemplateColumns: twoCol, gap: isMobile ? 12 : 18 }}>
            <RevenueTimeline orders={orders} periodDays={period} />
            <StatusFunnel orders={orders} statusFilter={statusFilter} onPick={setStatus} />
          </div>

          {/* Managers + Top clients */}
          <div style={{ display: 'grid', gridTemplateColumns: twoCol, gap: isMobile ? 12 : 18, alignItems: 'start' }}>
            {/* Managers leaderboard */}
            <Card pad={20}>
              <SectionTitle right={
                isAdmin
                  ? <button onClick={() => setShowGoals(true)}
                      style={{ background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: 8, padding: '5px 10px', fontSize: 11, fontWeight: 700, color: 'var(--primary)', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                      ⚙ Планы
                    </button>
                  : <span style={{ fontSize: 11, color: 'var(--t3)' }}>клик — фильтр</span>
              } hint="Оборот каждого менеджера за период (без отменённых заявок), отсортирован по убыванию. Клик по строке фильтрует дашборд по менеджеру. «Планы» задаёт месячные цели.">Менеджеры</SectionTitle>
              {managerStats.length === 0 ? (
                <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>Нет менеджеров</div>
              ) : (
                <Suspense fallback={<div style={{ height: 120 }} />}>
                  <BarList
                    data={managerStats.map(s => ({ key: s.id, name: s.name, value: s.rev }))}
                    color="emerald"
                    valueFormatter={fmtMoney}
                    sortOrder="none"
                    showAnimation
                    onValueChange={bar => setManager(managerFilter === bar.key ? '' : String(bar.key))}
                    className="mt-2"
                  />
                </Suspense>
              )}
            </Card>

            {/* Top clients */}
            <Card pad={0}>
              <div style={{ padding: '16px 18px 12px' }}><SectionTitle hint="Клиенты с наибольшим оборотом за период — сумма всех их заявок, кроме отменённых. Показывает, кто приносит больше всего выручки.">Топ клиентов</SectionTitle></div>
              {topClients.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>Нет данных за период</div>
              ) : topClients.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 18px', borderTop: '1px solid var(--bd)' }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--t3)', width: 16 }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>{c.count} заказов</div>
                  </div>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, color: '#0E7C46' }}>{fmtMoney(c.rev)}</span>
                </div>
              ))}
            </Card>
          </div>

          {/* Top products + DB stats */}
          <div style={{ display: 'grid', gridTemplateColumns: twoCol, gap: isMobile ? 12 : 18, alignItems: 'start' }}>
            {/* Top products */}
            <Card pad={20}>
              <SectionTitle right={<span style={{ fontSize: 11, color: 'var(--t3)' }}>шт. в заказах</span>}
                hint="Товары, которые чаще всего попадают в заявки за период, по суммарному количеству штук. Помогает видеть ходовые позиции для закупа.">Топ товары по заказам</SectionTitle>
              {topProducts.length === 0 ? (
                <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>Нет позиций за период</div>
              ) : (
                <Suspense fallback={<div style={{ height: 120 }} />}>
                  <BarList
                    data={topProducts.map(p => ({ name: p.name, value: p.qty }))}
                    color="emerald"
                    valueFormatter={(v: number) => `${v} шт`}
                    sortOrder="none"
                    showAnimation
                    className="mt-2"
                  />
                </Suspense>
              )}
            </Card>

            {/* DB stats */}
            <Card pad={0}>
              <div style={{ padding: '16px 18px 12px' }}><SectionTitle hint="Состояние каталога и договоров: сколько всего товаров, какая доля с фото (влияет на продажи) и сколько новых договоров заключено за период.">База данных</SectionTitle></div>
              {[
                { label: 'Товаров в базе', value: dbStats.total.toLocaleString('ru'), sub: 'всего позиций', color: 'var(--t)' },
                { label: 'С фотографией', value: `${dbStats.withImg}`, sub: `${dbStats.imgPct}% каталога${dbStats.imgPct < 50 ? ' · мало фото' : ''}`, color: dbStats.imgPct < 50 ? '#C0392B' : '#0E7C46' },
                { label: 'Новых договоров', value: `${dbStats.contractsPeriod}`, sub: `за период · всего ${dbStats.contractsTotal}`, color: '#7C3AED' },
              ].map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderTop: '1px solid var(--bd)' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--t)' }}>{s.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>{s.sub}</div>
                  </div>
                  <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, color: s.color }}>{s.value}</span>
                </div>
              ))}
            </Card>
          </div>

          {/* Lost clients panel */}
          <div ref={lostRef}>
            <Card pad={0}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '16px 18px', borderBottom: lost.length ? '1px solid var(--bd)' : 'none', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--t)' }}>Пропавшие клиенты</span>
                      <InfoDot hint="Клиенты, не делавшие заказ более 4 дней (проверка автоматически, ежедневно). Кнопка справа создаёт менеджерам задачи на обзвон и реактивацию." />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--t2)' }}>нет заказа больше 4 дней · автопроверка ежедневно</div>
                  </div>
                </div>
                {lost.length > 0 && (
                  <button onClick={generateReminders} disabled={genLoading}
                    style={{ background: '#E5484D', color: '#fff', border: 'none', borderRadius: 10, padding: '9px 16px', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: genLoading ? 'not-allowed' : 'pointer', opacity: genLoading ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                    {genLoading ? 'Создаю…' : `Задачи менеджерам (${lost.filter(l => l.manager_id && !reactSet.has(l.client_id)).length})`}
                  </button>
                )}
              </div>

              {lost.length === 0 ? (
                <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>Все клиенты на связи</div>
              ) : lost.map(l => {
                const hasTask = reactSet.has(l.client_id)
                const urgent = (l.days_since ?? 0) >= 7
                return (
                  <div key={l.client_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 18px', borderTop: '1px solid var(--bd)', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.client_name || 'Без имени'}</div>
                      <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 1 }}>
                        {l.manager_name || 'без менеджера'} · {l.orders_count} зак. · {fmtMoney(l.total_spent)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'center', flexShrink: 0 }}>
                      <div style={{ fontSize: 10, color: 'var(--t3)' }}>послед. заказ</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)' }}>{fmtDate(l.last_order)}</div>
                    </div>
                    <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 800, padding: '4px 10px', borderRadius: 8, background: urgent ? '#FCE9E5' : '#FFF1DD', color: urgent ? '#C0392B' : '#B25E00' }}>
                      {l.days_since ?? '?'} дн.
                    </span>
                    {hasTask ? (
                      <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, color: '#0E7C46', padding: '7px 12px' }}>задача стоит</span>
                    ) : (
                      <button onClick={() => remindOne(l)} disabled={!l.manager_id}
                        style={{ flexShrink: 0, background: l.manager_id ? 'var(--primary)' : 'var(--t3)', color: '#fff', border: 'none', borderRadius: 9, padding: '7px 14px', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: l.manager_id ? 'pointer' : 'not-allowed' }}>
                        Задача
                      </button>
                    )}
                  </div>
                )
              })}
            </Card>
          </div>

          {/* Recent orders */}
          <Card pad={0}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--bd)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--t)' }}>Последние заявки {search && <span style={{ fontSize: 11, color: '#7C3AED', marginLeft: 6 }}>· поиск</span>}</span>
                <InfoDot hint="Свежие заявки за выбранный период, новые сверху. Поиск в шапке фильтрует по клиенту, названию или номеру заявки." />
              </div>
              <span onClick={() => navigate('/crm/board')} style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 600, cursor: 'pointer' }}>Все →</span>
            </div>
            {recent.length === 0 ? (
              <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>{search ? 'Ничего не найдено' : 'Нет заявок за период'}</div>
            ) : recent.map((o, i) => {
              const st = STATUS_META[o.order_status ?? 'new'] ?? STATUS_META.new
              return (
                <div key={o.id} onClick={() => navigate('/crm/board')}
                  style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0,1fr) auto' : '80px minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr) 0.7fr', alignItems: 'center', gap: 8, fontSize: 12, padding: '11px 18px', borderTop: i === 0 ? 'none' : '1px solid var(--bd)', cursor: 'pointer' }}>
                  {!isMobile && <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 10, color: '#7C3AED' }}>#{o.id.slice(-6).toUpperCase()}</span>}
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ fontWeight: 600, color: 'var(--t)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.client_name ?? o.title ?? '—'}</div>
                    {isMobile && <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 1 }}>{managerName(o.manager_id)} · {fmtRelative(o.created_at)}</div>}
                  </div>
                  {!isMobile && <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 11 }}>{o.total ? fmtMoney(o.total) : '—'}</span>}
                  {!isMobile && <span style={{ fontSize: 11, color: 'var(--t2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{managerName(o.manager_id)}</span>}
                  <span style={{ textAlign: isMobile ? 'right' : 'left' }}>
                    <span style={{ background: st.bg, color: st.color, borderRadius: 6, padding: '3px 8px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{st.label}</span>
                    {isMobile && o.total ? <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 11, marginTop: 3 }}>{fmtMoney(o.total)}</div> : null}
                  </span>
                  {!isMobile && <span style={{ fontSize: 11, color: 'var(--t3)', textAlign: 'right' }}>{fmtRelative(o.created_at)}</span>}
                </div>
              )
            })}
          </Card>
        </div>
      )}

      {showNewOrder && <NewOrderModal onClose={() => { setShowNew(false); refetch() }} />}
      {showGoals && all && isAdmin && (
        <KpiGoalsModal
          managers={all.managers}
          adminId={profile?.id ?? null}
          onClose={() => setShowGoals(false)}
          onSaved={refetch}
          toast={toast}
        />
      )}
    </div>
  )
}
