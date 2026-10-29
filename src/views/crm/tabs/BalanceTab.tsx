'use client'

import { fmtFull,fmtMoney,fmtPct } from '@/shared/lib/format'
import { supabase } from '@/shared/lib/supabase'
import {
AreaChart,BarChart,BarList,
Metric,
SparkAreaChart,
Text,
Card as TremorCard,
type Color,
} from '@/shared/ui/charts'
import { InfoDot } from '@/shared/ui/ui'
import { useCRM } from '@/views/crm/context/CRMContext'
import { Segmented,useIsMobile } from '@/views/crm/shared/crmui'
import BatchesView from '@/views/crm/tabs/BatchesView'
import CashPlanView from '@/views/crm/tabs/CashPlanView'
import ProductsView from '@/views/crm/tabs/ProductsView'
import { useQuery,useQueryClient } from '@tanstack/react-query'
import { useMemo,useState } from 'react'

/* ══════════════════════════════════════════════════════════════════
   FINANCE (Balance): P&L + Cash Flow. Admin-only (RLS enforced).
   Data lives in public.finance_pnl (raw line items). Derived rows
   (gross margin, total opex, net profit) and the whole Cash Flow are
   COMPUTED here — never entered twice.
   ══════════════════════════════════════════════════════════════════ */

const COMPANY = 'JJCo'

interface PnlRow {
  category: string
  month: string
  amount: number
  updated_at?: string | null
  editor?: { name: string | null } | null
}

/* ── line-item catalog (order matches the source spreadsheet) ── */
const OPEX_KEYS = [
  'marketing', 'sales_exp', 'travel', 'rent', 'payroll', 'dividends', 'charity',
  'credit', 'kaspi', 'bank_fee', 'taxes', 'logistics', 'car_repair', 'car_exp',
  'fuel', 'other',
] as const

const LABELS: Record<string, string> = {
  sales: 'Продажа',
  cogs: 'Себестоимость',
  marketing: 'Расходы на маркетинг',
  sales_exp: 'Расходы по продажам',
  travel: 'Командировочные',
  rent: 'Аренда',
  payroll: 'ФОТ',
  dividends: 'Дивиденды',
  charity: 'Благотворительность',
  credit: 'Кредит',
  kaspi: 'Kaspi магазин',
  bank_fee: 'Комиссия банка',
  taxes: 'Расходы по налогам',
  logistics: 'Логистика',
  car_repair: 'Ремонт машин',
  car_exp: 'Расходы на машины',
  fuel: 'Бензин',
  other: 'Прочие расходы',
  inventory: 'Остаток товара на складе',
}

// Cash outflows that belong to the operating section of the cash-flow
// statement (everything in OPEX except financing items).
const OP_CASH_KEYS = OPEX_KEYS.filter(k => k !== 'credit' && k !== 'dividends')

// EBITDA ≈ gross margin minus operating expenses, i.e. before interest
// (credit), taxes and profit distribution (dividends).
const EBITDA_OPEX_KEYS = OPEX_KEYS.filter(k => k !== 'credit' && k !== 'dividends' && k !== 'taxes')

const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

/* ── форматтеры вынесены в общий lib/format ── */

/* ── data ── */
async function fetchPnl(): Promise<PnlRow[]> {
  // Try with the editor's name embedded; fall back gracefully if the
  // relationship can't be resolved so the table still loads.
  const withEditor = await supabase
    .from('finance_pnl')
    .select('category,month,amount,updated_at,editor:profiles!finance_pnl_updated_by_fkey(name)')
    .eq('company', COMPANY)
  if (!withEditor.error) return (withEditor.data ?? []) as unknown as PnlRow[]

  const plain = await supabase
    .from('finance_pnl')
    .select('category,month,amount,updated_at')
    .eq('company', COMPANY)
  if (plain.error) throw plain.error
  return (plain.data ?? []) as unknown as PnlRow[]
}

function fmtDateTime(s: string): string {
  return new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/* ══════════════════════════════════════════════════════════════════
   SMALL UI
   ══════════════════════════════════════════════════════════════════ */
function KPI({ label, value, sub, subColor, i = 0, hint }: { label: string; value: string; sub?: string; subColor?: string; i?: number; hint?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative', zIndex: open ? 60 : undefined, animation: 'fadeInUp .5s ease both', animationDelay: `${i * 70}ms` }}>
      <TremorCard className="!rounded-2xl !p-4" style={{ height: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Text>{label}</Text>
          {hint && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Пояснение"
              onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o) } }}
              style={{ width: 16, height: 16, borderRadius: '50%', border: `1px solid ${open ? 'var(--primary)' : 'var(--t3)'}`, color: open ? 'var(--primary)' : 'var(--t3)', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, userSelect: 'none' }}
            >i</span>
          )}
        </div>
        <Metric className="mt-2 font-display !text-xl">{value}</Metric>
        {sub && <p className="mt-1 text-xs font-semibold" style={{ color: subColor ?? 'var(--t2)' }}>{sub}</p>}
      </TremorCard>
      {hint && open && (
        <>
          {/* click-outside catcher */}
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 55 }} />
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 70, marginTop: 6, background: 'var(--t)', color: 'var(--bg2)', fontSize: 12, lineHeight: 1.5, fontWeight: 500, padding: '10px 12px', borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,.28)' }}>
            {hint}
          </div>
        </>
      )}
    </div>
  )
}

function Panel({ title, right, children, i = 0, hint }: { title: string; right?: React.ReactNode; children: React.ReactNode; i?: number; hint?: string }) {
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 16, padding: 18, animation: 'fadeInUp .5s ease both', animationDelay: `${i * 70}ms` }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 10 }}>
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
   EDITABLE / DERIVED TABLE
   ══════════════════════════════════════════════════════════════════ */
type Kind = 'input' | 'formula' | 'section'
type Tone = 'pos' | 'cost' | 'signed' | 'stock'
interface RowDef { key: string; label: string; kind: Kind; emphasis?: boolean; tone?: Tone; compute?: (m: string) => number }

// User-customisable heatmap palette (persisted in localStorage).
interface Palette { pos: string; cost: string; stock: string; neg: string }
const DEFAULT_PALETTE: Palette = { pos: 'var(--primary)', cost: '#D97706', stock: '#2563EB', neg: '#C0392B' }
const PALETTE_KEY = 'fin_heatmap_palette'
function loadPalette(): Palette {
  try { return { ...DEFAULT_PALETTE, ...JSON.parse(localStorage.getItem(PALETTE_KEY) || '{}') } } catch { return DEFAULT_PALETTE }
}
function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const n = parseInt(full, 16)
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}
// Per-cell heatmap tint: colour by row meaning, intensity by magnitude
// relative to the biggest value in the same row.
function tintBg(tone: Tone | undefined, v: number, rowMax: number, pal: Palette): string | undefined {
  if (!tone || !v || rowMax <= 0) return undefined
  const hex = tone === 'signed' ? (v >= 0 ? pal.pos : pal.neg) : pal[tone]
  const a = Math.min(0.20, (Math.abs(v) / rowMax) * 0.20)
  return `rgba(${hexToRgb(hex)},${a.toFixed(3)})`
}
const TONE_SPARK: Record<Tone, Color> = { pos: 'emerald', cost: 'amber', stock: 'blue', signed: 'emerald' }

function FinanceTable({
  rows, months, getVal, editable, onSave, palette,
}: {
  rows: RowDef[]
  months: string[]
  getVal: (cat: string, m: string) => number
  editable: boolean
  onSave: (cat: string, m: string, value: number) => void
  palette: Palette
}) {
  const nameW = 210
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--bd)', borderRadius: 14, background: 'var(--bg2)' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, minWidth: nameW + 100 + months.length * 100 }}>
        <thead>
          <tr>
            <th style={{ position: 'sticky', left: 0, zIndex: 2, background: 'var(--bg3)', textAlign: 'left', padding: '10px 12px', minWidth: nameW, borderBottom: '1px solid var(--bd)', color: 'var(--t2)', fontWeight: 700 }}>Статья</th>
            <th style={{ padding: '10px 10px', textAlign: 'center', borderBottom: '1px solid var(--bd)', borderLeft: '1px solid var(--bd)', color: 'var(--t2)', fontWeight: 700, whiteSpace: 'nowrap' }}>Тренд</th>
            {months.map(m => {
              const mi = parseInt(m.slice(5, 7), 10) - 1
              return (
                <th key={m} style={{ padding: '10px 10px', textAlign: 'right', borderBottom: '1px solid var(--bd)', borderLeft: '1px solid var(--bd)', color: 'var(--t2)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {MONTH_SHORT[mi]}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            if (row.kind === 'section') {
              return (
                <tr key={row.key}>
                  <td colSpan={months.length + 2} style={{ padding: '8px 12px', background: 'var(--bg3)', fontSize: 11, fontWeight: 800, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--t3)', borderBottom: '1px solid var(--bd)' }}>{row.label}</td>
                </tr>
              )
            }
            const isFormula = row.kind === 'formula'
            const rowBg = row.emphasis ? 'var(--bg3)' : 'transparent'
            const vals = months.map(m => (row.compute ? row.compute(m) : getVal(row.key, m)))
            const rowMax = Math.max(...vals.map(Math.abs), 0)
            const sparkData = months.map((m, ci) => ({ m: MONTH_SHORT[parseInt(m.slice(5, 7), 10) - 1], v: Math.round(vals[ci]) }))
            return (
              <tr key={row.key} style={{ background: rowBg }}>
                <td style={{ position: 'sticky', left: 0, zIndex: 1, background: row.emphasis ? 'var(--bg3)' : 'var(--bg2)', padding: '8px 12px', borderBottom: '1px solid var(--bd)', fontWeight: row.emphasis ? 800 : 600, color: 'var(--t)', whiteSpace: 'nowrap' }}>{row.label}</td>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--bd)', borderLeft: '1px solid var(--bd)', textAlign: 'center' }}>
                  {rowMax > 0
                    ? <SparkAreaChart data={sparkData} index="m" categories={['v']} colors={[TONE_SPARK[row.tone ?? 'signed']]} className="h-8 w-24" />
                    : <span style={{ color: 'var(--t3)' }}>—</span>}
                </td>
                {months.map((m, ci) => {
                  const v = vals[ci]
                  const neg = v < 0
                  const tint = tintBg(row.tone, v, rowMax, palette)
                  if (editable && !isFormula) {
                    return (
                      <td key={m} style={{ padding: 0, borderBottom: '1px solid var(--bd)', borderLeft: '1px solid var(--bd)', background: tint }}>
                        <input
                          key={`${row.key}:${m}:${v}`}
                          defaultValue={v ? String(Math.round(v * 100) / 100) : ''}
                          inputMode="decimal"
                          onBlur={e => {
                            const num = Number(e.target.value.replace(/\s/g, '').replace(',', '.')) || 0
                            if (num !== v) onSave(row.key, m, num)
                          }}
                          style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'right', padding: '8px 10px', fontSize: 12, fontFamily: 'inherit', color: 'var(--t)', outline: 'none' }}
                        />
                      </td>
                    )
                  }
                  return (
                    <td key={m} style={{ padding: '8px 10px', textAlign: 'right', borderBottom: '1px solid var(--bd)', borderLeft: '1px solid var(--bd)', background: tint, color: neg ? '#C0392B' : (row.emphasis ? 'var(--t)' : 'var(--t2)'), fontWeight: row.emphasis ? 800 : 500, fontFamily: isFormula ? 'var(--font-display)' : 'inherit', whiteSpace: 'nowrap' }}>
                      {fmtFull(v)}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ── Palette editor (user-defined heatmap colours) ── */
function PaletteEditor({ palette, onChange, onReset }: { palette: Palette; onChange: (k: keyof Palette, v: string) => void; onReset: () => void }) {
  const [open, setOpen] = useState(false)
  const items: { k: keyof Palette; label: string }[] = [
    { k: 'pos', label: 'Доход' },
    { k: 'cost', label: 'Расход' },
    { k: 'stock', label: 'Склад' },
    { k: 'neg', label: 'Убыток' },
  ]
  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: 8, padding: '5px 10px', fontSize: 11, fontWeight: 700, color: 'var(--t2)', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ display: 'inline-flex', gap: 2 }}>
          {items.map(it => <span key={it.k} style={{ width: 8, height: 8, borderRadius: 2, background: palette[it.k] }} />)}
        </span>
        Цвета
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 55 }} />
          <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 70, marginTop: 6, background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 12, padding: 12, boxShadow: '0 12px 32px rgba(0,0,0,.25)', width: 200 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>Цвета подсветки</div>
            {items.map(it => (
              <div key={it.k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 0' }}>
                <span style={{ fontSize: 13, color: 'var(--t)' }}>{it.label}</span>
                <input type="color" value={palette[it.k]} onChange={e => onChange(it.k, e.target.value)}
                  style={{ width: 34, height: 24, border: '1px solid var(--bd)', borderRadius: 6, background: 'none', cursor: 'pointer', padding: 0 }} />
              </div>
            ))}
            <button onClick={onReset}
              style={{ marginTop: 8, width: '100%', background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: 8, padding: '6px', fontSize: 12, fontWeight: 600, color: 'var(--t2)', cursor: 'pointer', fontFamily: 'inherit' }}>
              Сбросить
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   MAIN
   ══════════════════════════════════════════════════════════════════ */
export default function BalanceTab() {
  const { profile, toast } = useCRM()
  const isMobile = useIsMobile()
  const qc = useQueryClient()
  const isAdmin = profile?.role === 'admin'

  const [view, setView] = useState<'pnl' | 'cashflow' | 'batches' | 'products' | 'cashplan'>('pnl')
  const isFinance = view === 'pnl' || view === 'cashflow'   // виды на данных finance_pnl
  const [year, setYear] = useState(2025)

  const { data = [], isLoading, isError } = useQuery({
    queryKey: ['finance-pnl'],
    queryFn: fetchPnl,
    staleTime: 60_000,
  })

  // Optimistic overrides applied on blur so formulas update instantly.
  const [overrides, setOverrides] = useState<Record<string, number>>({})

  // User-customisable heatmap palette (persisted in localStorage)
  const [palette, setPalette] = useState<Palette>(loadPalette)
  const setColor = (k: keyof Palette, v: string) => setPalette(p => { const next = { ...p, [k]: v }; try { localStorage.setItem(PALETTE_KEY, JSON.stringify(next)) } catch { /* ignore */ } return next })
  const resetPalette = () => { try { localStorage.removeItem(PALETTE_KEY) } catch { /* ignore */ } setPalette(DEFAULT_PALETTE) }

  // stored map: `${category}:${YYYY-MM}` -> amount
  const stored = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of data) m[`${r.category}:${r.month.slice(0, 7)}`] = Number(r.amount)
    return m
  }, [data])

  // most recent edit (when + who)
  const lastUpdate = useMemo(() => {
    let best: { at: string; by: string | null } | null = null
    for (const r of data) {
      if (r.updated_at && (!best || r.updated_at > best.at)) best = { at: r.updated_at, by: r.editor?.name ?? null }
    }
    return best
  }, [data])

  const getVal = (cat: string, mon: string) => {
    const k = `${cat}:${mon}`
    return overrides[k] ?? stored[k] ?? 0
  }

  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`), [year])

  async function saveCell(cat: string, mon: string, value: number) {
    const key = `${cat}:${mon}`
    setOverrides(p => ({ ...p, [key]: value }))
    const { error } = await supabase.from('finance_pnl').upsert({
      company: COMPANY, category: cat, month: `${mon}-01`, amount: value,
      updated_at: new Date().toISOString(), updated_by: profile?.id ?? null,
    }, { onConflict: 'company,category,month' })
    if (error) { toast('Ошибка сохранения: ' + error.message); return }
    qc.invalidateQueries({ queryKey: ['finance-pnl'] })
  }

  /* ── derived per-month computations ── */
  const gross = (m: string) => getVal('sales', m) - getVal('cogs', m)
  const totalOpex = (m: string) => OPEX_KEYS.reduce((s, k) => s + getVal(k, m), 0)
  const net = (m: string) => gross(m) - totalOpex(m)
  const ebitda = (m: string) => gross(m) - EBITDA_OPEX_KEYS.reduce((s, k) => s + getVal(k, m), 0)

  const invDelta = (m: string) => {
    const [y, mm] = m.split('-').map(Number)
    const prev = mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, '0')}`
    const cur = getVal('inventory', m)
    const pv = stored[`inventory:${prev}`] ?? overrides[`inventory:${prev}`] ?? 0
    if (!cur || !pv) return 0
    return cur - pv
  }
  const purchases = (m: string) => getVal('cogs', m) + invDelta(m)
  const opCashOut = (m: string) => OP_CASH_KEYS.reduce((s, k) => s + getVal(k, m), 0)
  const operating = (m: string) => getVal('sales', m) - purchases(m) - opCashOut(m)
  const financing = (m: string) => -(getVal('credit', m) + getVal('dividends', m))
  const netCash = (m: string) => operating(m) + financing(m)

  /* ── PNL table rows ── */
  const pnlRows: RowDef[] = useMemo(() => [
    { key: 'sales', label: LABELS.sales, kind: 'input', tone: 'pos' },
    { key: 'cogs', label: LABELS.cogs, kind: 'input', tone: 'cost' },
    { key: 'gross', label: 'Гроссмаржа', kind: 'formula', emphasis: true, tone: 'pos', compute: gross },
    { key: 'sec_opex', label: 'Операционные расходы', kind: 'section' },
    ...OPEX_KEYS.map(k => ({ key: k, label: LABELS[k], kind: 'input' as const, tone: 'cost' as const })),
    { key: 'total_opex', label: 'Итого расходы', kind: 'formula', emphasis: true, tone: 'cost', compute: totalOpex },
    { key: 'sec_stock', label: 'Склад', kind: 'section' },
    { key: 'inventory', label: LABELS.inventory, kind: 'input', tone: 'stock' },
    { key: 'net', label: 'ИТОГО чистая прибыль', kind: 'formula', emphasis: true, tone: 'signed', compute: net },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [overrides, stored])

  /* ── CashFlow table rows (all derived except the underlying inputs) ── */
  const cfRows: RowDef[] = useMemo(() => [
    { key: 'sec_op', label: 'Операционная деятельность', kind: 'section' },
    { key: 'cf_sales', label: 'Поступления от продаж', kind: 'formula', tone: 'pos', compute: m => getVal('sales', m) },
    { key: 'cf_purch', label: 'Закуп товара (с учётом склада)', kind: 'formula', tone: 'cost', compute: m => -purchases(m) },
    { key: 'cf_opex', label: 'Операционные расходы', kind: 'formula', tone: 'cost', compute: m => -opCashOut(m) },
    { key: 'cf_op', label: 'Операционный поток', kind: 'formula', emphasis: true, tone: 'signed', compute: operating },
    { key: 'sec_fin', label: 'Финансовая деятельность', kind: 'section' },
    { key: 'cf_credit', label: 'Погашение кредита', kind: 'formula', tone: 'cost', compute: m => -getVal('credit', m) },
    { key: 'cf_div', label: 'Дивиденды', kind: 'formula', tone: 'cost', compute: m => -getVal('dividends', m) },
    { key: 'cf_fin', label: 'Финансовый поток', kind: 'formula', emphasis: true, tone: 'signed', compute: financing },
    { key: 'cf_net', label: 'Чистый денежный поток', kind: 'formula', emphasis: true, tone: 'signed', compute: netCash },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [overrides, stored])

  /* ── chart series for the selected year ── */
  const pnlSeries = useMemo(() => months.map(m => ({
    date: MONTH_SHORT[parseInt(m.slice(5, 7), 10) - 1],
    Выручка: Math.round(getVal('sales', m)),
    Себестоимость: Math.round(getVal('cogs', m)),
    'Чистая прибыль': Math.round(net(m)),
  })), [months, overrides, stored]) // eslint-disable-line react-hooks/exhaustive-deps

  // cumulative revenue & net profit within the selected year (YTD)
  const ytdSeries = useMemo(() => {
    let cs = 0, cn = 0
    return months.filter(m => getVal('sales', m) > 0).map(m => {
      cs += getVal('sales', m); cn += net(m)
      return { date: MONTH_SHORT[parseInt(m.slice(5, 7), 10) - 1], 'Выручка ∑': Math.round(cs), 'Прибыль ∑': Math.round(cn) }
    })
  }, [months, overrides, stored]) // eslint-disable-line react-hooks/exhaustive-deps

  const cfSeries = useMemo(() => months.map(m => ({
    date: MONTH_SHORT[parseInt(m.slice(5, 7), 10) - 1],
    'Операционный': Math.round(operating(m)),
    'Финансовый': Math.round(financing(m)),
    'Чистый поток': Math.round(netCash(m)),
  })), [months, overrides, stored]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── period aggregates ── */
  const agg = useMemo(() => {
    const sum = (f: (m: string) => number) => months.reduce((s, m) => s + f(m), 0)
    const sales = sum(m => getVal('sales', m))
    const grossT = sum(gross)
    const netT = sum(net)
    const opexT = sum(totalOpex)
    const ebitdaT = sum(ebitda)

    // months that actually have data (avoid comparing 6 vs 12 months)
    const dataMonths = months.filter(m => getVal('sales', m) > 0)

    // YoY revenue growth vs the same months of the previous year
    const prevSales = dataMonths.reduce((s, m) => s + getVal('sales', `${year - 1}-${m.slice(5, 7)}`), 0)
    const yoy = prevSales > 0 ? (sales - prevSales) / prevSales : null

    // Inventory turnover / DIO for the period
    const invVals = dataMonths.map(m => getVal('inventory', m)).filter(v => v > 0)
    const avgInv = invVals.length ? invVals.reduce((a, b) => a + b, 0) / invVals.length : 0
    const cogsT = dataMonths.reduce((s, m) => s + getVal('cogs', m), 0)
    const daysPeriod = dataMonths.length * 30.44
    const dio = (avgInv > 0 && cogsT > 0) ? avgInv / (cogsT / daysPeriod) : 0
    const turnover = dio > 0 ? 365 / dio : 0

    // Break-even revenue = fixed (operating) costs / gross-margin ratio
    const grossPct = sales ? grossT / sales : 0
    const breakEven = grossPct > 0 ? opexT / grossPct : 0
    const safety = sales > 0 && breakEven > 0 ? (sales - breakEven) / sales : null

    return {
      sales, gross: grossT, net: netT, opex: opexT, ebitda: ebitdaT,
      grossPct,
      netPct: sales ? netT / sales : 0,
      ebitdaPct: sales ? ebitdaT / sales : 0,
      yoy, avgInv, dio, turnover, breakEven, safety,
      opCash: sum(operating), finCash: sum(financing), netCash: sum(netCash),
    }
  }, [months, year, overrides, stored]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── opex breakdown for the period (BarList) ── */
  const opexBreakdown = useMemo(() => OPEX_KEYS
    .map(k => ({ name: LABELS[k], value: Math.round(months.reduce((s, m) => s + getVal(k, m), 0)) }))
    .filter(x => x.value > 0)
    .sort((a, b) => b.value - a.value), [months, overrides, stored]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isAdmin) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>Раздел доступен только администраторам.</div>
  }

  const pad = isMobile ? 16 : '20px 28px'
  const moneyFmt = (v: number) => fmtMoney(v)

  return (
    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: isMobile ? '12px 16px' : '16px 28px', borderBottom: '1px solid var(--bd)', background: 'var(--bg2)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Segmented
            value={view}
            onChange={setView}
            options={[{ value: 'pnl', label: 'PNL' }, { value: 'cashflow', label: 'CF' }, { value: 'batches', label: 'Партии' }, { value: 'products', label: 'Продукты' }, { value: 'cashplan', label: 'Платежи' }]}
          />
          {isFinance && (
            <Segmented
              value={year}
              onChange={setYear}
              options={[2023, 2024, 2025, 2026].map(y => ({ value: y, label: String(y) }))}
            />
          )}
        </div>
      </div>

      {view === 'batches' && <BatchesView />}
      {view === 'products' && <ProductsView />}
      {view === 'cashplan' && <CashPlanView />}

      {isFinance && isLoading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>Загрузка…</div>}
      {isFinance && isError && <div style={{ padding: 40, textAlign: 'center', color: '#C0392B' }}>Ошибка загрузки данных</div>}

      {isFinance && !isLoading && !isError && (
        <div key={`${view}-${year}`} style={{ padding: pad, display: 'flex', flexDirection: 'column', gap: isMobile ? 14 : 20 }}>
          {view === 'pnl' ? (
            <>
              {/* KPI */}
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,minmax(0,1fr))' : 'repeat(4,minmax(0,1fr))', gap: isMobile ? 10 : 14 }}>
                <KPI i={0} label={`Выручка · ${year}`} value={fmtMoney(agg.sales)} sub="за период"
                  hint="Все деньги, полученные от продаж за период, до вычета любых расходов. Это весь оборот («грязный» доход)." />
                <KPI i={1} label="Гроссмаржа" value={fmtMoney(agg.gross)} sub={`маржа ${fmtPct(agg.grossPct)}`} subColor="#10A35B"
                  hint="Валовая прибыль: выручка минус себестоимость товара (закупочная цена). Сколько остаётся с продаж ДО операционных расходов (аренда, зарплаты и т.д.). Маржа % — какая доля выручки остаётся." />
                <KPI i={2} label="Чистая прибыль" value={fmtMoney(agg.net)} sub={agg.net >= 0 ? '▲ прибыль' : '▼ убыток'} subColor={agg.net >= 0 ? 'var(--primary)' : '#C0392B'}
                  hint="Что осталось после вычета ВСЕХ расходов: себестоимость, зарплаты, аренда, налоги, кредит и прочее. Реальный заработок компании за период." />
                <KPI i={3} label="Рентабельность" value={fmtPct(agg.netPct)} sub={`расходы ${fmtMoney(agg.opex)}`} subColor="#7C3AED"
                  hint="Чистая прибыль ÷ выручка. Сколько прибыли приносит каждый тенге продаж. Например, 12.6% = с каждых 100 ₸ выручки остаётся ~12.6 ₸ прибыли." />
                <KPI i={4} label="EBITDA" value={fmtMoney(agg.ebitda)} sub={`операц. маржа ${fmtPct(agg.ebitdaPct)}`} subColor="#0891B2"
                  hint="Прибыль от основной деятельности до вычета кредита, налогов и амортизации. Показывает, насколько эффективен сам бизнес без влияния займов и налогов. Операц. маржа = EBITDA ÷ выручка." />
                <KPI i={5} label="Рост выручки YoY" value={agg.yoy === null ? '—' : `${agg.yoy >= 0 ? '+' : ''}${fmtPct(agg.yoy)}`} sub={`vs ${year - 1}`} subColor={agg.yoy === null ? 'var(--t3)' : agg.yoy >= 0 ? 'var(--primary)' : '#C0392B'}
                  hint={`YoY (год к году): насколько выросла или упала выручка по сравнению с теми же месяцами ${year - 1} года. Например, +19.4% = продажи выросли почти на пятую часть.`} />
                <KPI i={6} label="Оборот склада (DIO)" value={agg.dio ? `${Math.round(agg.dio)} дн` : '—'} sub={agg.turnover ? `${agg.turnover.toFixed(1)} об/год` : 'нет данных'} subColor="#B25E00"
                  hint="DIO — сколько в среднем дней товар лежит на складе до продажи. Чем меньше дней и больше оборотов в год, тем быстрее деньги возвращаются в бизнес." />
                <KPI i={7} label="Точка безубыточности" value={agg.breakEven ? fmtMoney(agg.breakEven) : '—'} sub={agg.safety === null ? 'нет данных' : `запас прочности ${agg.safety >= 0 ? '+' : ''}${fmtPct(agg.safety)}`} subColor={agg.safety === null ? 'var(--t3)' : agg.safety >= 0 ? 'var(--primary)' : '#C0392B'}
                  hint="Сколько нужно продать за период, чтобы покрыть все расходы и выйти в ноль. Ниже этой выручки — убыток. «Запас прочности» показывает, на сколько текущие продажи выше точки безубыточности." />
              </div>

              {/* Charts — compact 2×2 grid */}
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0,1fr)' : 'repeat(2,minmax(0,1fr))', gap: isMobile ? 12 : 16 }}>
                <Panel i={7} title="Выручка · Себестоимость · Прибыль" hint="Три ключевые линии по месяцам: сколько продали (выручка), сколько стоил товар (себестоимость) и что осталось чистыми. Видно, как разрыв между выручкой и затратами формирует прибыль.">
                  <AreaChart className="h-40" data={pnlSeries} index="date"
                    categories={['Выручка', 'Себестоимость', 'Чистая прибыль']}
                    colors={['emerald', 'amber', 'violet']} valueFormatter={moneyFmt}
                    showLegend showYAxis={false} showGridLines={false} startEndOnly curveType="monotone" />
                </Panel>
                <Panel i={8} title="Чистая прибыль по месяцам" hint="Чистая прибыль (после всех расходов) в разбивке по месяцам. Столбцы ниже нуля — убыточные месяцы. Помогает увидеть сезонность и провалы.">
                  <BarChart className="h-40" data={pnlSeries} index="date" categories={['Чистая прибыль']}
                    colors={['emerald']} valueFormatter={moneyFmt} showLegend={false} showYAxis={false} showGridLines={false} startEndOnly />
                </Panel>
                <Panel i={9} title={`Накопительно (YTD) · ${year}`} hint="YTD (year-to-date) — нарастающий итог с начала года: выручка и прибыль суммируются от месяца к месяцу. Показывает общий результат года по мере его накопления.">
                  {ytdSeries.length === 0
                    ? <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)', fontSize: 13 }}>Нет данных за год</div>
                    : <AreaChart className="h-40" data={ytdSeries} index="date" categories={['Выручка ∑', 'Прибыль ∑']}
                        colors={['emerald', 'violet']} valueFormatter={moneyFmt} showLegend showYAxis={false} showGridLines={false} startEndOnly curveType="monotone" />}
                </Panel>
                <Panel i={10} title="Структура расходов" hint="Операционные расходы за период по статьям (аренда, ФОТ, маркетинг и т.д.), отсортированы по величине. Показывает, куда уходит больше всего денег." right={<span style={{ fontSize: 11, color: 'var(--t3)' }}>за {year}</span>}>
                  {opexBreakdown.length === 0
                    ? <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)', fontSize: 13 }}>Нет данных</div>
                    : <div style={{ maxHeight: 170, overflowY: 'auto' }}><BarList data={opexBreakdown} color="emerald" valueFormatter={moneyFmt} sortOrder="descending" className="mt-1" /></div>}
                </Panel>
              </div>

              {/* P&L table */}
              <Panel i={11} title={`Отчёт о прибылях и убытках · ${year}`} hint="P&L по месяцам: белые ячейки редактируются, выделенные строки (Гроссмаржа, Итого расходы, Чистая прибыль) считаются автоматически. Подсветка ячеек — тепловая карта: ярче = крупнее сумма в строке." right={
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {lastUpdate && <span style={{ fontSize: 11, color: 'var(--t3)' }}>Обновлено {fmtDateTime(lastUpdate.at)}{lastUpdate.by ? ` · ${lastUpdate.by}` : ' · импорт'}</span>}
                  <PaletteEditor palette={palette} onChange={setColor} onReset={resetPalette} />
                </div>
              }>
                <FinanceTable rows={pnlRows} months={months} getVal={getVal} editable={isAdmin} onSave={saveCell} palette={palette} />
              </Panel>
            </>
          ) : (
            <>
              {/* Cash Flow KPI */}
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(1,minmax(0,1fr))' : 'repeat(3,minmax(0,1fr))', gap: isMobile ? 10 : 14 }}>
                <KPI i={0} label={`Операционный поток · ${year}`} value={fmtMoney(agg.opCash)} sub={agg.opCash >= 0 ? '▲ положительный' : '▼ отрицательный'} subColor={agg.opCash >= 0 ? 'var(--primary)' : '#C0392B'}
                  hint="Сколько «живых» денег принесла основная деятельность: поступления от продаж минус закуп товара и операционные расходы. Положительный — операции сами себя окупают." />
                <KPI i={1} label="Финансовый поток" value={fmtMoney(agg.finCash)} sub="кредит + дивиденды" subColor="#7C3AED"
                  hint="Движение денег по кредитам и выплатам собственникам (погашение кредита, дивиденды). Обычно отрицательный — деньги уходят на обслуживание долга." />
                <KPI i={2} label="Чистый денежный поток" value={fmtMoney(agg.netCash)} sub={agg.netCash >= 0 ? '▲ приток' : '▼ отток'} subColor={agg.netCash >= 0 ? 'var(--primary)' : '#C0392B'}
                  hint="Итоговое изменение денег за период: операционный + финансовый поток. Показывает, стало ли денег в кассе больше (приток) или меньше (отток)." />
              </div>

              <Panel i={3} title="Денежные потоки по месяцам" hint="Три потока по месяцам: операционный (от продаж), финансовый (кредит/дивиденды) и чистый (их сумма). Показывает, за счёт чего в кассе прибавляется или убавляется.">
                <AreaChart className="h-64" data={cfSeries} index="date"
                  categories={['Операционный', 'Финансовый', 'Чистый поток']}
                  colors={['emerald', 'rose', 'blue']} valueFormatter={moneyFmt}
                  showLegend showYAxis={false} showGridLines={false} curveType="monotone" />
              </Panel>

              <Panel i={4} title="Чистый денежный поток по месяцам" hint="Итоговое изменение денег в кассе по месяцам (операционный + финансовый поток). Столбцы ниже нуля — месяцы, когда денег утекло больше, чем пришло.">
                <BarChart className="h-56" data={cfSeries} index="date" categories={['Чистый поток']}
                  colors={['blue']} valueFormatter={moneyFmt} showLegend={false} showYAxis={false} showGridLines={false} />
              </Panel>

              {/* Cash Flow table */}
              <Panel i={5} title={`Отчёт о движении денежных средств · ${year}`} hint="Cash Flow полностью рассчитан из данных P&L: поступления от продаж, закуп товара (с поправкой на изменение склада), операционные расходы, кредит и дивиденды. Показывает реальное движение денег, а не бухгалтерскую прибыль." right={
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <span style={{ fontSize: 11, color: 'var(--t3)' }}>рассчитано из PNL</span>
                  <PaletteEditor palette={palette} onChange={setColor} onReset={resetPalette} />
                </div>
              }>
                <FinanceTable rows={cfRows} months={months} getVal={getVal} editable={false} onSave={saveCell} palette={palette} />
              </Panel>
            </>
          )}
        </div>
      )}
    </div>
  )
}
