'use client'

import { fmtFull,fmtMoney } from '@/shared/lib/format'
import { supabase } from '@/shared/lib/supabase'
import { Metric,Text,Card as TremorCard } from '@/shared/ui/charts'
import { InfoDot } from '@/shared/ui/ui'
import { useCRM } from '@/views/crm/context/CRMContext'
import { Modal,inputStyle,labelStyle,useIsMobile } from '@/views/crm/shared/crmui'
import { useQuery,useQueryClient } from '@tanstack/react-query'
import { useMemo,useRef,useState } from 'react'

/* ══════════════════════════════════════════════════════════════════
   ПАРТИИ — юнит-экономика поставки. Одна партия = список товаров +
   общие расходы (логистика/пошлина/НДС/прочее). По каждому товару:
   landed cost (себестоимость на складе) → цена продажи с НДС → минус
   выходной НДС и издержки канала → прибыль на единицу и ROI.

   ROI партии = прибыль ÷ вложенная себестоимость — главный показатель.
   Компания — плательщик НДС РК (16%). Каналы продаж и их издержки —
   настраиваемые пресеты (кнопка «Каналы»), канал задаётся на каждый товар.

   В БД (public.landed_cost_shipments) только вводимые поля; вся эконо-
   мика считается здесь. items — jsonb, поэтому канал/цена живут внутри.
   ══════════════════════════════════════════════════════════════════ */

const COMPANY = 'JJCo'
const CURRENCIES = ['USD', 'CNY', 'EUR', 'RUB', 'KZT'] as const
type Currency = typeof CURRENCIES[number]

export interface Item {
  product: string
  qty: number
  unit_price: number   // цена закупа за ед. в валюте партии
  sale_price: number   // цена продажи за ед. С НДС, ₸
  channel?: string     // канал продаж (имя пресета)
}
export interface Shipment {
  id: string
  name: string
  shipment_date: string
  supplier: string
  currency: Currency
  fx_rate: number
  logistics: number
  customs_duty: number
  vat_rate: number
  other_costs: number
  vat_in_cost: boolean
  payment_terms_days: number   // отсрочка от завода, дней
  sell_days: number            // план срока продажи партии, дней
  items: Item[]
  note?: string | null
}

/* ── каналы продаж (пресеты издержек, localStorage) ── */
// dso_days — отсрочка/консигнация клиента: через сколько дней он платит.
export interface Channel { name: string; fee_pct: number; delivery: number; returns_pct: number; dso_days?: number }
const DEFAULT_CHANNELS: Channel[] = [
  { name: 'Опт', fee_pct: 0, delivery: 0, returns_pct: 0, dso_days: 14 },
  { name: 'HoReCa', fee_pct: 0, delivery: 0, returns_pct: 1, dso_days: 7 },
  { name: 'Супермаркеты', fee_pct: 10, delivery: 0, returns_pct: 2, dso_days: 28 },
  { name: 'Офисы', fee_pct: 0, delivery: 0, returns_pct: 1, dso_days: 28 },
  { name: 'Еком (Kaspi)', fee_pct: 12, delivery: 0, returns_pct: 3, dso_days: 3 },
  { name: 'Розница', fee_pct: 2, delivery: 0, returns_pct: 1, dso_days: 0 },
]
const CH_KEY = 'landed_channels'
export function loadChannels(): Channel[] {
  try { const j = JSON.parse(localStorage.getItem(CH_KEY) || 'null'); return Array.isArray(j) && j.length ? j : DEFAULT_CHANNELS } catch { return DEFAULT_CHANNELS }
}
export function saveChannels(ch: Channel[]) { try { localStorage.setItem(CH_KEY, JSON.stringify(ch)) } catch { /* ignore */ } }
export function findChannel(channels: Channel[], name?: string): Channel {
  return channels.find(c => c.name === name) ?? channels[0] ?? DEFAULT_CHANNELS[0]
}

/* ── formatters (деньги/числа — из общего lib/format) ── */
function fmtPct(n: number): string { return (n * 100).toFixed(0) + '%' }
function fmtPct1(n: number): string { return (n * 100).toFixed(1).replace('.0', '') + '%' }
function fmtDate(s: string): string { return new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) }
function roiColor(roi: number): string { return roi >= 0.3 ? 'var(--primary)' : roi >= 0 ? '#D97706' : '#C0392B' }

/* ══════════════════════════════════════════════════════════════════
   MATH — единственный источник правды.
   ══════════════════════════════════════════════════════════════════ */
export interface ShipCalc {
  fx: number
  goods: number       // стоимость всех товаров в ₸
  vat: number         // импортный НДС (к зачёту, если vat_in_cost=false)
  extras: number      // логистика + пошлина + прочее (+НДС если vat_in_cost)
  cost: number        // ИТОГОВАЯ себестоимость партии (вложено), ₸
  qty: number         // всего единиц
}
export function calcShipment(s: Shipment): ShipCalc {
  const fx = s.fx_rate || (s.currency === 'KZT' ? 1 : 0)
  const goods = s.items.reduce((sum, it) => sum + (it.unit_price || 0) * (it.qty || 0), 0) * fx
  const vat = (goods + (s.customs_duty || 0)) * ((s.vat_rate || 0) / 100)
  const extras = (s.logistics || 0) + (s.customs_duty || 0) + (s.other_costs || 0) + (s.vat_in_cost ? vat : 0)
  const cost = goods + extras
  const qty = s.items.reduce((a, it) => a + (it.qty || 0), 0)
  return { fx, goods, vat, extras, cost, qty }
}
// Landed cost за единицу товара (расходы партии распределены по стоимости).
function itemUnitCost(it: Item, c: ShipCalc): number {
  const itemGoods = (it.unit_price || 0) * (it.qty || 0) * c.fx
  const share = c.goods > 0 ? itemGoods / c.goods : 0
  const itemCost = itemGoods + c.extras * share
  return it.qty > 0 ? itemCost / it.qty : 0
}
// Юнит-экономика единицы товара: от цены с НДС к чистой прибыли.
export interface UnitEcon { net: number; landed: number; fees: number; delivery: number; ret: number; profit: number; marginPct: number; roi: number }
function itemEcon(it: Item, landed: number, vatRate: number, ch: Channel): UnitEcon {
  const gross = it.sale_price || 0
  const net = gross / (1 + (vatRate || 0) / 100)          // цена без выходного НДС
  const fees = net * ((ch.fee_pct || 0) / 100)            // комиссия канала
  const ret = net * ((ch.returns_pct || 0) / 100)         // резерв на возвраты
  const delivery = ch.delivery || 0                       // доставка до клиента, ₸/ед
  const profit = net - landed - fees - delivery - ret     // маржинальная прибыль на ед.
  const marginPct = net > 0 ? profit / net : 0
  const roi = landed > 0 ? profit / landed : 0
  return { net, landed, fees, delivery, ret, profit, marginPct, roi }
}
// Экономика всей партии. dso — средневзвешенная отсрочка клиентов (дней).
export interface BatchEcon { invested: number; profit: number; roi: number; revNet: number; marginPct: number; dso: number; priced: boolean }
function batchEcon(s: Shipment, c: ShipCalc, channels: Channel[]): BatchEcon {
  let profit = 0, revNet = 0, dsoWeighted = 0, priced = false
  for (const it of s.items) {
    if (it.sale_price) priced = true
    const ch = findChannel(channels, it.channel)
    const e = itemEcon(it, itemUnitCost(it, c), s.vat_rate, ch)
    const rev = e.net * (it.qty || 0)
    profit += e.profit * (it.qty || 0)
    revNet += rev
    dsoWeighted += rev * (ch.dso_days || 0)
  }
  const roi = c.cost > 0 ? profit / c.cost : 0
  const marginPct = revNet > 0 ? profit / revNet : 0
  const dso = revNet > 0 ? dsoWeighted / revNet : 0
  return { invested: c.cost, profit, roi, revNet, marginPct, dso, priced }
}

// Финансы через денежный цикл (CCC). Товар отдаётся клиенту и оплачивается
// через DSO дней (консигнация), поставщику платим через DPO (отсрочка).
// CCC = дни продажи + DSO − DPO — на столько заморожены свои деньги.
// Если CCC ≤ 0, весь цикл финансирует поставщик — свои деньги ≈ только расходы.
export interface Finance {
  terms: number        // DPO — отсрочка от завода, дней
  sellDays: number     // дни продажи (DIO)
  dso: number          // DSO — отсрочка клиентов, дней
  ccc: number          // денежный цикл, дней
  cashGap: number      // дни заморозки своих денег = max(0, ccc)
  ownCash: number      // собственные вложения, ₸
  cashRoi: number      // ROI на свои деньги
  annualRoi: number    // годовой ROI на себестоимость (по операц. циклу)
  financed: boolean    // цикл финансирует поставщик (CCC ≤ 0)
  hasInputs: boolean
}
function financeCalc(s: Shipment, c: ShipCalc, be: BatchEcon): Finance {
  const terms = s.payment_terms_days || 0
  const sellDays = s.sell_days || 0
  const dso = be.dso
  const ccc = sellDays + dso - terms
  const cashGap = Math.max(0, ccc)
  const goodsFronted = terms === 0 || cashGap > 0        // товар оплачен своими деньгами?
  const ownCash = (c.extras) + (goodsFronted ? c.goods : 0)
  const cashRoi = ownCash > 0 ? be.profit / ownCash : 0
  const cycle = sellDays + dso                            // операц. цикл: закуп → деньги
  const annualRoi = cycle > 0 ? be.roi * 365 / cycle : 0
  const financed = terms > 0 && sellDays > 0 && ccc <= 0
  return { terms, sellDays, dso, ccc, cashGap, ownCash, cashRoi, annualRoi, financed, hasInputs: sellDays > 0 }
}

/* ── data ── */
async function fetchShipments(): Promise<Shipment[]> {
  const { data, error } = await supabase
    .from('landed_cost_shipments')
    .select('id,name,shipment_date,supplier,currency,fx_rate,logistics,customs_duty,vat_rate,other_costs,vat_in_cost,payment_terms_days,sell_days,items,note')
    .eq('company', COMPANY)
    .order('shipment_date', { ascending: false })
  if (error) throw error
  return (data ?? []).map(r => ({ ...r, items: Array.isArray(r.items) ? r.items : [] })) as unknown as Shipment[]
}

const EMPTY_ITEM: Item = { product: '', qty: 0, unit_price: 0, sale_price: 0, channel: '' }
function emptyShipment(defChannel: string): Shipment {
  return {
    id: '', name: '', shipment_date: new Date().toISOString().slice(0, 10), supplier: '',
    currency: 'KZT', fx_rate: 1, logistics: 0, customs_duty: 0, vat_rate: 16,
    other_costs: 0, vat_in_cost: true, payment_terms_days: 0, sell_days: 0,
    items: [{ ...EMPTY_ITEM, channel: defChannel }], note: '',
  }
}

/* ══════════════════════════════════════════════════════════════════
   IMPORT — Excel/CSV накладной → товары одной партии.
   ══════════════════════════════════════════════════════════════════ */
type Field = 'product' | 'sku' | 'supplier' | 'currency' | 'fx_rate' | 'qty' | 'unit_price' | 'amount' | 'sale_price'
const HEADER_ALIASES: [Field, string[]][] = [
  ['sku', ['артикул', 'sku', 'код товара', 'код']],
  ['product', ['товары (работы, услуги)', 'товары', 'товар', 'наименование', 'номенклатура', 'работы, услуги', 'product', 'name']],
  ['supplier', ['поставщик', 'контрагент', 'supplier']],
  ['currency', ['валюта', 'currency']],
  ['fx_rate', ['курс', 'fx_rate', 'fx']],
  ['qty', ['количество', 'кол-во', 'колво', 'кол', 'qty', 'quantity']],
  ['unit_price', ['цена за единицу', 'цена за ед', 'цена', 'price']],
  ['amount', ['сумма', 'итого', 'всего', 'total', 'amount']],
  ['sale_price', ['цена продажи', 'продажа', 'розница', 'sale_price', 'sale']],
]
function normHead(h: unknown): string { return String(h ?? '').toLowerCase().replace(/\s+/g, ' ').trim() }
function matchField(h: unknown): Field | null {
  const n = normHead(h)
  if (!n) return null
  if (n.includes('ндс')) return null
  for (const [f, al] of HEADER_ALIASES) if (al.includes(n)) return f
  for (const [f, al] of HEADER_ALIASES) if (al.some(a => n.startsWith(a))) return f
  return null
}
function num(v: unknown): number {
  const s = String(v ?? '').replace(/[^\d.,-]/g, '').replace(/,/g, '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}
function splitCsvLine(l: string): string[] {
  const out: string[] = []
  let cur = '', q = false
  for (let i = 0; i < l.length; i++) {
    const c = l[i]
    if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c }
    else if (c === '"') q = true
    else if (c === ',' || c === ';' || c === '\t') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out.map(s => s.trim())
}
async function readFileMatrix(file: File): Promise<string[][]> {
  const isCsv = /\.csv$/i.test(file.name) || file.type.includes('csv')
  if (isCsv) {
    const text = await file.text()
    return text.split(/\r?\n/).filter(l => l.trim()).map(splitCsvLine)
  }
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  return XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '' })
}
interface ParsedInvoice { items: Item[]; supplier?: string; currency?: Currency; fx_rate?: number }
function parseInvoice(matrix: string[][], defChannel: string): ParsedInvoice {
  if (!matrix.length) return { items: [] }
  let headerIdx = 0, best = 0, headerMap: (Field | null)[] = []
  for (let i = 0; i < Math.min(matrix.length, 15); i++) {
    const map = (matrix[i] ?? []).map(matchField)
    const score = map.filter(Boolean).length
    if (score > best) { best = score; headerIdx = i; headerMap = map }
  }
  if (best < 2) return { items: [] }
  const col = (f: Field) => headerMap.indexOf(f)
  const items: Item[] = []
  let supplier = '', currency: Currency | undefined, fx: number | undefined
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const r = matrix[i]
    if (!r || r.every(c => !String(c ?? '').trim())) continue
    const at = (f: Field) => { const k = col(f); return k >= 0 ? r[k] : undefined }
    const name = String(at('product') ?? '').trim()
    const sku = String(at('sku') ?? '').trim()
    if (!name && !sku) continue
    if (/^(итого|всего|в том числе|подытог)/i.test(name)) continue
    const qty = num(at('qty'))
    let unit = num(at('unit_price'))
    const amount = num(at('amount'))
    if (!unit && amount && qty) unit = amount / qty
    if (!supplier) supplier = String(at('supplier') ?? '').trim()
    const curRaw = String(at('currency') ?? '').toUpperCase().trim()
    if (!currency && (CURRENCIES as readonly string[]).includes(curRaw)) currency = curRaw as Currency
    if (!fx) { const f = num(at('fx_rate')); if (f) fx = f }
    items.push({ product: sku ? (name ? `${sku} — ${name}` : sku) : name, qty, unit_price: unit, sale_price: num(at('sale_price')), channel: defChannel })
  }
  return { items, supplier, currency, fx_rate: fx }
}

/* ══════════════════════════════════════════════════════════════════
   SMALL UI
   ══════════════════════════════════════════════════════════════════ */
function KPI({ label, value, sub, subColor, i = 0, hint }: { label: string; value: string; sub?: string; subColor?: string; i?: number; hint?: string }) {
  return (
    <div style={{ animation: 'fadeInUp .5s ease both', animationDelay: `${i * 70}ms` }}>
      <TremorCard className="!rounded-2xl !p-4" style={{ height: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Text>{label}</Text>
          {hint && <InfoDot hint={hint} />}
        </div>
        <Metric className="mt-2 font-display !text-xl">{value}</Metric>
        {sub && <p className="mt-1 text-xs font-semibold" style={{ color: subColor ?? 'var(--t2)' }}>{sub}</p>}
      </TremorCard>
    </div>
  )
}
function Panel({ title, right, children, i = 0, hint }: { title: string; right?: React.ReactNode; children: React.ReactNode; i?: number; hint?: string }) {
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 16, padding: 18, animation: 'fadeInUp .5s ease both', animationDelay: `${i * 70}ms` }}>
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
   CHANNEL SETTINGS — пресеты каналов продаж (издержки в % и ₸).
   ══════════════════════════════════════════════════════════════════ */
export function ChannelSettings({ channels, onSave, onClose }: { channels: Channel[]; onSave: (c: Channel[]) => void; onClose: () => void }) {
  const [list, setList] = useState<Channel[]>(channels)
  const set = (i: number, k: keyof Channel, v: string | number) => setList(p => p.map((c, idx) => idx === i ? { ...c, [k]: v } : c))
  const add = () => setList(p => [...p, { name: 'Новый канал', fee_pct: 0, delivery: 0, returns_pct: 0, dso_days: 0 }])
  const del = (i: number) => setList(p => p.filter((_, idx) => idx !== i))
  const small: React.CSSProperties = { ...inputStyle, padding: '6px 8px', fontSize: 12 }
  const th: React.CSSProperties = { padding: '6px 6px', textAlign: 'right', color: 'var(--t2)', fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap' }
  return (
    <Modal onClose={onClose} maxWidth={560}>
      <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--t)', marginBottom: 4 }}>Каналы продаж</div>
      <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 14 }}>Издержки и условия оплаты по каналам — участвуют в прибыли, ROI и денежном цикле. «% с продажи» = комиссия маркетплейса, эквайринг, ретро-бонус. «DSO» = через сколько дней платит клиент (консигнация/реализация).</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 520 }}>
          <thead><tr>
            <th style={{ ...th, textAlign: 'left' }}>Канал</th>
            <th style={th}>% с продажи</th>
            <th style={th}>Доставка ₸/ед</th>
            <th style={th}>Возвраты %</th>
            <th style={th}>DSO дней</th>
            <th style={{ ...th, width: 28 }}></th>
          </tr></thead>
          <tbody>
            {list.map((c, i) => (
              <tr key={i}>
                <td style={{ padding: '3px 4px' }}><input value={c.name} onChange={e => set(i, 'name', e.target.value)} style={{ ...small, textAlign: 'left' }} /></td>
                <td style={{ padding: '3px 4px' }}><input inputMode="decimal" defaultValue={c.fee_pct} onChange={e => set(i, 'fee_pct', num(e.target.value))} style={{ ...small, textAlign: 'right' }} /></td>
                <td style={{ padding: '3px 4px' }}><input inputMode="decimal" defaultValue={c.delivery || ''} placeholder="0" onChange={e => set(i, 'delivery', num(e.target.value))} style={{ ...small, textAlign: 'right' }} /></td>
                <td style={{ padding: '3px 4px' }}><input inputMode="decimal" defaultValue={c.returns_pct || ''} placeholder="0" onChange={e => set(i, 'returns_pct', num(e.target.value))} style={{ ...small, textAlign: 'right' }} /></td>
                <td style={{ padding: '3px 4px' }}><input inputMode="decimal" defaultValue={c.dso_days || ''} placeholder="0" onChange={e => set(i, 'dso_days', num(e.target.value))} style={{ ...small, textAlign: 'right' }} /></td>
                <td style={{ textAlign: 'center' }}><button onClick={() => del(i)} style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', fontSize: 15 }}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={add} style={{ marginTop: 10, background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--t)', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>+ канал</button>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
        <button onClick={onClose} style={{ background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--t2)', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Отмена</button>
        <button onClick={() => onSave(list.filter(c => c.name.trim()))} style={{ background: 'var(--primary)', border: 'none', color: '#fff', borderRadius: 10, padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Сохранить</button>
      </div>
    </Modal>
  )
}

/* ══════════════════════════════════════════════════════════════════
   SHIPMENT FORM — создание / редактирование / импорт одной партии.
   ══════════════════════════════════════════════════════════════════ */
function ShipmentForm({ initial, channels, onEditChannels, onClose, onSaved, onDeleted }: {
  initial: Shipment; channels: Channel[]; onEditChannels: () => void; onClose: () => void; onSaved: () => void; onDeleted?: () => void
}) {
  const { profile, toast } = useCRM()
  const [s, setS] = useState<Shipment>(initial)
  const [saving, setSaving] = useState(false)
  const c = calcShipment(s)
  const be = batchEcon(s, c, channels)
  const fin = financeCalc(s, c, be)

  const set = <K extends keyof Shipment>(k: K, v: Shipment[K]) => setS(p => ({ ...p, [k]: v }))
  const setNum = (k: keyof Shipment) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, num(e.target.value) as never)
  const setItem = (idx: number, k: keyof Item, v: string | number) => setS(p => ({ ...p, items: p.items.map((it, i) => i === idx ? { ...it, [k]: v } : it) }))
  const addItem = () => setS(p => ({ ...p, items: [...p.items, { ...EMPTY_ITEM, channel: channels[0]?.name ?? '' }] }))
  const delItem = (idx: number) => setS(p => ({ ...p, items: p.items.filter((_, i) => i !== idx) }))

  async function save() {
    const items = s.items.filter(it => (it.product || '').trim() || it.qty || it.unit_price)
    if (!items.length) { toast('Добавьте хотя бы один товар'); return }
    setSaving(true)
    const payload = {
      company: COMPANY, name: s.name.trim(), shipment_date: s.shipment_date, supplier: s.supplier.trim(),
      currency: s.currency, fx_rate: s.fx_rate, logistics: s.logistics, customs_duty: s.customs_duty,
      vat_rate: s.vat_rate, other_costs: s.other_costs, vat_in_cost: s.vat_in_cost,
      payment_terms_days: s.payment_terms_days, sell_days: s.sell_days,
      items, note: s.note ?? '', updated_at: new Date().toISOString(), updated_by: profile?.id ?? null,
    }
    const res = s.id
      ? await supabase.from('landed_cost_shipments').update(payload).eq('id', s.id)
      : await supabase.from('landed_cost_shipments').insert(payload)
    setSaving(false)
    if (res.error) { toast('Ошибка сохранения: ' + res.error.message); return }
    toast(s.id ? 'Партия обновлена' : 'Партия сохранена'); onSaved()
  }
  async function remove() {
    if (!s.id || !confirm('Удалить партию?')) return
    const { error } = await supabase.from('landed_cost_shipments').delete().eq('id', s.id)
    if (error) { toast('Ошибка удаления: ' + error.message); return }
    toast('Партия удалена'); onDeleted?.()
  }

  const small: React.CSSProperties = { ...inputStyle, padding: '7px 9px', fontSize: 12 }
  const th: React.CSSProperties = { padding: '7px 6px', textAlign: 'right', borderBottom: '1px solid var(--bd)', color: 'var(--t2)', fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap' }
  const cellInput: React.CSSProperties = { width: '100%', border: 'none', background: 'transparent', textAlign: 'right', padding: '7px 6px', fontSize: 12, fontFamily: 'inherit', color: 'var(--t)', outline: 'none' }

  return (
    <Modal onClose={onClose} maxWidth={960}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--t)' }}>{s.id ? 'Партия' : 'Новая партия'}</div>
        <div style={{ fontSize: 13, color: 'var(--t2)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <span>Вложено <b style={{ color: 'var(--t)' }}>{fmtFull(c.cost)} ₸</b></span>
          {be.priced && <span>Прибыль <b style={{ color: be.profit >= 0 ? 'var(--primary)' : '#C0392B' }}>{fmtFull(be.profit)} ₸</b></span>}
          {be.priced && <span>ROI <b style={{ color: roiColor(be.roi), fontSize: 15 }}>{fmtPct(be.roi)}</b></span>}
        </div>
      </div>

      {/* header fields */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10, marginBottom: 10 }}>
        <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Название партии</label>
          <input value={s.name} onChange={e => set('name', e.target.value)} placeholder="№ счёта или описание" style={small} /></div>
        <div><label style={labelStyle}>Дата</label>
          <input type="date" value={s.shipment_date} onChange={e => set('shipment_date', e.target.value)} style={small} /></div>
        <div><label style={labelStyle}>Поставщик</label>
          <input value={s.supplier} onChange={e => set('supplier', e.target.value)} placeholder="—" style={small} /></div>
        <div><label style={labelStyle}>Валюта</label>
          <select value={s.currency} onChange={e => set('currency', e.target.value as Currency)} style={small}>
            {CURRENCIES.map(cu => <option key={cu} value={cu}>{cu}</option>)}
          </select></div>
        <div><label style={labelStyle}>Курс к ₸</label>
          <input inputMode="decimal" defaultValue={s.fx_rate || ''} placeholder="1" onChange={setNum('fx_rate')} style={small} disabled={s.currency === 'KZT'} /></div>
      </div>

      {/* shared costs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 10, marginBottom: 6 }}>
        <div><label style={labelStyle}>Логистика, ₸</label>
          <input inputMode="decimal" defaultValue={s.logistics || ''} placeholder="0" onChange={setNum('logistics')} style={small} /></div>
        <div><label style={labelStyle}>Пошлина, ₸</label>
          <input inputMode="decimal" defaultValue={s.customs_duty || ''} placeholder="0" onChange={setNum('customs_duty')} style={small} /></div>
        <div><label style={labelStyle}>Прочее, ₸</label>
          <input inputMode="decimal" defaultValue={s.other_costs || ''} placeholder="0" onChange={setNum('other_costs')} style={small} /></div>
        <div><label style={labelStyle}>НДС, %</label>
          <input inputMode="decimal" defaultValue={s.vat_rate} onChange={setNum('vat_rate')} style={small} /></div>
      </div>

      {/* включать ли импортный НДС в себестоимость (если не возмещаем) */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0 6px', fontSize: 12, color: 'var(--t2)', cursor: 'pointer' }}>
        <input type="checkbox" checked={s.vat_in_cost} onChange={e => set('vat_in_cost', e.target.checked)} style={{ cursor: 'pointer' }} />
        Включить НДС в себестоимость <span style={{ color: 'var(--t3)' }}>(если НДС не возмещаем)</span>
      </label>

      {/* payment terms & turnover */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 10, marginTop: 6 }}>
        <div><label style={labelStyle}>Отсрочка завода, дней</label>
          <input inputMode="decimal" defaultValue={s.payment_terms_days || ''} placeholder="0" onChange={setNum('payment_terms_days')} style={small} /></div>
        <div><label style={labelStyle}>План продажи, дней</label>
          <input inputMode="decimal" defaultValue={s.sell_days || ''} placeholder="0" onChange={setNum('sell_days')} style={small} /></div>
      </div>

      {/* items */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '14px 0 6px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)' }}>Товары ({s.items.length})</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onEditChannels} style={{ background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--t2)', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Каналы</button>
          <button onClick={addItem} style={{ background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--t)', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>+ строка</button>
        </div>
      </div>
      <div style={{ overflow: 'auto', maxHeight: 280, border: '1px solid var(--bd)', borderRadius: 10 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, minWidth: 820 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>Товар</th>
              <th style={th}>Кол-во</th>
              <th style={th}>Закуп {s.currency}</th>
              <th style={th}>Канал</th>
              <th style={th}>Цена с НДС</th>
              <th style={{ ...th, color: '#2563EB' }}>С/с ед.</th>
              <th style={th}>Приб/ед</th>
              <th style={th}>ROI</th>
              <th style={{ ...th, width: 28 }}></th>
            </tr>
          </thead>
          <tbody>
            {s.items.map((it, idx) => {
              const lu = itemUnitCost(it, c)
              const e = itemEcon(it, lu, s.vat_rate, findChannel(channels, it.channel))
              return (
                <tr key={idx}>
                  <td style={{ borderBottom: '1px solid var(--bd)', minWidth: 180 }}>
                    <input value={it.product} onChange={ev => setItem(idx, 'product', ev.target.value)} placeholder="Наименование" style={{ ...cellInput, textAlign: 'left' }} /></td>
                  <td style={{ borderBottom: '1px solid var(--bd)', borderLeft: '1px solid var(--bd)' }}>
                    <input inputMode="decimal" defaultValue={it.qty || ''} onChange={ev => setItem(idx, 'qty', num(ev.target.value))} style={cellInput} /></td>
                  <td style={{ borderBottom: '1px solid var(--bd)', borderLeft: '1px solid var(--bd)' }}>
                    <input inputMode="decimal" defaultValue={it.unit_price || ''} onChange={ev => setItem(idx, 'unit_price', num(ev.target.value))} style={cellInput} /></td>
                  <td style={{ borderBottom: '1px solid var(--bd)', borderLeft: '1px solid var(--bd)' }}>
                    <select value={it.channel ?? ''} onChange={ev => setItem(idx, 'channel', ev.target.value)} style={{ ...cellInput, textAlign: 'left' }}>
                      {channels.map(ch => <option key={ch.name} value={ch.name}>{ch.name}</option>)}
                    </select></td>
                  <td style={{ borderBottom: '1px solid var(--bd)', borderLeft: '1px solid var(--bd)' }}>
                    <input inputMode="decimal" defaultValue={it.sale_price || ''} onChange={ev => setItem(idx, 'sale_price', num(ev.target.value))} style={cellInput} /></td>
                  <td style={{ borderBottom: '1px solid var(--bd)', borderLeft: '1px solid var(--bd)', textAlign: 'right', padding: '7px 6px', color: '#2563EB', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmtFull(lu)}</td>
                  <td style={{ borderBottom: '1px solid var(--bd)', borderLeft: '1px solid var(--bd)', textAlign: 'right', padding: '7px 6px', color: it.sale_price ? (e.profit >= 0 ? 'var(--primary)' : '#C0392B') : 'var(--t3)', fontWeight: 700, whiteSpace: 'nowrap' }}>{it.sale_price ? fmtFull(e.profit) : '—'}</td>
                  <td style={{ borderBottom: '1px solid var(--bd)', borderLeft: '1px solid var(--bd)', textAlign: 'right', padding: '7px 6px', color: it.sale_price ? roiColor(e.roi) : 'var(--t3)', fontWeight: 800, whiteSpace: 'nowrap' }}>{it.sale_price ? fmtPct(e.roi) : '—'}</td>
                  <td style={{ borderBottom: '1px solid var(--bd)', textAlign: 'center' }}>
                    <button onClick={() => delItem(idx)} style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', fontSize: 15 }}>✕</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* summary */}
      <div style={{ marginTop: 14, background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: 12, padding: 14, display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '6px 16px', fontSize: 13 }}>
        <span style={{ color: 'var(--t2)' }}>Товары в ₸ ({fmtFull(c.qty)} шт)</span><b style={{ textAlign: 'right', color: 'var(--t)' }}>{fmtFull(c.goods)}</b>
        <span style={{ color: 'var(--t2)' }}>Расходы (логистика/пошлина/прочее)</span><b style={{ textAlign: 'right', color: 'var(--t)' }}>{fmtFull(c.extras - (s.vat_in_cost ? c.vat : 0))}</b>
        {s.vat_in_cost && <><span style={{ color: 'var(--t2)' }}>НДС {fmtFull(s.vat_rate)}% (в себестоимости)</span><b style={{ textAlign: 'right', color: 'var(--t)' }}>{fmtFull(c.vat)}</b></>}
        <span style={{ color: 'var(--t2)', fontWeight: 800 }}>Себестоимость партии (вложено)</span><b style={{ textAlign: 'right', color: 'var(--t)', fontWeight: 800 }}>{fmtFull(c.cost)} ₸</b>
        {be.priced && <><span style={{ color: 'var(--t2)' }}>Маржинальная прибыль</span><b style={{ textAlign: 'right', color: be.profit >= 0 ? 'var(--primary)' : '#C0392B', fontWeight: 700 }}>{fmtFull(be.profit)} ₸ · маржа {fmtPct1(be.marginPct)}</b></>}
        {be.priced && <><span style={{ color: 'var(--t2)', fontWeight: 800 }}>ROI партии</span><b style={{ textAlign: 'right', color: roiColor(be.roi), fontWeight: 800, fontSize: 15 }}>{fmtPct(be.roi)}</b></>}
      </div>

      {/* finance: отсрочка → ROI на свои деньги + оборачиваемость */}
      {be.priced && fin.hasInputs && (
        <div style={{ marginTop: 10, background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: 12, padding: 14, display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '6px 16px', fontSize: 13 }}>
          <span style={{ color: 'var(--t2)' }}>Денежный цикл (продажа {fmtFull(fin.sellDays)} + DSO {fmtFull(fin.dso)} − DPO {fmtFull(fin.terms)})</span><b style={{ textAlign: 'right', color: fin.ccc <= 0 ? 'var(--primary)' : '#D97706' }}>{fin.ccc <= 0 ? '0' : fmtFull(fin.ccc)} дн</b>
          <span style={{ color: 'var(--t2)' }}>Годовой ROI (цикл {fmtFull(fin.sellDays + fin.dso)} дн)</span><b style={{ textAlign: 'right', color: roiColor(fin.annualRoi) }}>{fmtPct(fin.annualRoi)}</b>
          <span style={{ color: 'var(--t2)' }}>Свои вложения {fin.financed ? '(цикл за счёт поставщика)' : ''}</span><b style={{ textAlign: 'right', color: 'var(--t)' }}>{fmtFull(fin.ownCash)} ₸</b>
          <span style={{ color: 'var(--t2)', fontWeight: 800 }}>ROI на свои деньги</span><b style={{ textAlign: 'right', color: roiColor(fin.cashRoi), fontWeight: 800, fontSize: 15 }}>{fin.ownCash > 0 ? fmtPct(fin.cashRoi) : '∞'}</b>
          <span style={{ gridColumn: 'span 2', marginTop: 4, fontSize: 12, fontWeight: 600, color: fin.financed ? 'var(--primary)' : '#D97706' }}>
            {fin.financed
              ? `✓ Отсрочка завода (${fmtFull(fin.terms)} дн) покрывает весь цикл продажа+оплата клиента — свои деньги почти не заморожены.`
              : `⚠ Кассовый разрыв ${fmtFull(fin.cashGap)} дн: клиент платит через ${fmtFull(fin.dso)} дн, а заводу — через ${fmtFull(fin.terms)}. Ускорь продажу или увеличь отсрочку, иначе фронтишь товар.`}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 18 }}>
        {s.id && onDeleted
          ? <button onClick={remove} style={{ background: 'transparent', border: '1.5px solid #C0392B', color: '#C0392B', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Удалить</button>
          : <span />}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--t2)', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Отмена</button>
          <button onClick={save} disabled={saving} style={{ background: 'var(--primary)', border: 'none', color: '#fff', borderRadius: 10, padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? .6 : 1, fontFamily: 'inherit' }}>
            {saving ? 'Сохранение…' : 'Сохранить партию'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ══════════════════════════════════════════════════════════════════
   MAIN VIEW — список партий (ROI в центре).
   ══════════════════════════════════════════════════════════════════ */
export default function BatchesView() {
  const { profile, toast } = useCRM()
  const isMobile = useIsMobile()
  const qc = useQueryClient()
  const isAdmin = profile?.role === 'admin'
  const fileRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<Shipment | null>(null)
  const [channels, setChannels] = useState<Channel[]>(loadChannels)
  const [chOpen, setChOpen] = useState(false)
  const defChannel = channels[0]?.name ?? ''

  const { data = [], isLoading, isError } = useQuery({
    queryKey: ['landed-cost-shipments'],
    queryFn: fetchShipments,
    staleTime: 60_000,
  })

  const rows = useMemo(() => data.map(s => {
    const c = calcShipment(s)
    return { s, c, be: batchEcon(s, c, channels) }
  }), [data, channels])

  const agg = useMemo(() => {
    const invested = rows.reduce((a, r) => a + r.c.cost, 0)
    const profit = rows.reduce((a, r) => a + (r.be.priced ? r.be.profit : 0), 0)
    const priced = rows.some(r => r.be.priced)
    return { count: rows.length, invested, profit, roi: invested > 0 ? profit / invested : 0, priced }
  }, [rows])

  async function openImport(file: File) {
    try {
      const matrix = await readFileMatrix(file)
      const parsed = parseInvoice(matrix, defChannel)
      const items = parsed.items.filter(it => (it.product || '').trim())
      if (!items.length) { toast('Не удалось распознать таблицу. Нужны колонки «Товар», «Количество», «Цена».'); return }
      const draft = emptyShipment(defChannel)
      draft.items = items
      draft.name = file.name.replace(/\.(xlsx|xls|csv)$/i, '')
      if (parsed.supplier) draft.supplier = parsed.supplier
      if (parsed.currency) { draft.currency = parsed.currency; draft.fx_rate = parsed.fx_rate || (parsed.currency === 'KZT' ? 1 : 0) }
      setEditing(draft)
    } catch { toast('Не удалось прочитать файл') }
  }

  function persistChannels(next: Channel[]) { setChannels(next); saveChannels(next); setChOpen(false) }
  const refresh = () => { setEditing(null); qc.invalidateQueries({ queryKey: ['landed-cost-shipments'] }) }

  if (!isAdmin) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>Раздел доступен только администраторам.</div>

  const btn = (bg: string, color: string, border?: string): React.CSSProperties => ({
    background: bg, color, border: border ?? 'none', borderRadius: 10, padding: '8px 14px',
    fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  })
  const th: React.CSSProperties = { padding: '10px 10px', textAlign: 'right', borderBottom: '1px solid var(--bd)', color: 'var(--t2)', fontWeight: 700, whiteSpace: 'nowrap', fontSize: 11 }
  const td: React.CSSProperties = { padding: '10px 10px', textAlign: 'right', borderBottom: '1px solid var(--bd)', color: 'var(--t2)', whiteSpace: 'nowrap' }

  return (
    <div style={{ padding: isMobile ? 16 : '20px 28px', display: 'flex', flexDirection: 'column', gap: isMobile ? 14 : 20 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <button onClick={() => setChOpen(true)} style={btn('var(--bg2)', 'var(--t2)', '1px solid var(--bd)')}>Каналы</button>
        <button onClick={() => fileRef.current?.click()} style={btn('var(--bg2)', 'var(--t2)', '1px solid var(--bd)')}>Импорт Excel/CSV</button>
        <button onClick={() => setEditing(emptyShipment(defChannel))} style={btn('var(--primary)', '#fff')}>+ Партия</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) openImport(f); e.target.value = '' }} />
      </div>

      {isLoading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>Загрузка…</div>}
      {isError && <div style={{ padding: 40, textAlign: 'center', color: '#C0392B' }}>Ошибка загрузки данных</div>}

      {!isLoading && !isError && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(3,minmax(0,1fr))' : 'repeat(3,minmax(0,1fr))', gap: isMobile ? 10 : 14 }}>
            <KPI i={0} label="Вложено (себестоимость)" value={fmtMoney(agg.invested)} sub={`${agg.count} парт.`} subColor="#D97706"
              hint="Суммарная landed cost всех партий: закуп товара по курсу + логистика, пошлина, НДС и прочие расходы. Это деньги, вложенные в товар на складе." />
            <KPI i={1} label="Прибыль всего" value={agg.priced ? fmtMoney(agg.profit) : '—'} sub={agg.priced ? 'маржинальная' : 'укажите цену'} subColor={agg.profit >= 0 ? 'var(--primary)' : '#C0392B'}
              hint="Маржинальная прибыль по всем партиям с указанной ценой продажи: выручка без НДС минус себестоимость, комиссии канала, доставка и резерв на возвраты." />
            <KPI i={2} label="ROI" value={agg.priced ? fmtPct(agg.roi) : '—'} sub="прибыль ÷ вложено" subColor={roiColor(agg.roi)}
              hint="Рентабельность вложений: прибыль ÷ вложенная себестоимость. Главный показатель эффективности закупа. Ориентир: ≥30% — хорошо, <0% — убыток." />
          </div>

          <Panel i={3} title="Партии" hint="Список поставок: по каждой — вложенная себестоимость, маржинальная прибыль, маржа и ROI. Клик по строке открывает партию с полной юнит-экономикой по каждому товару." right={<span style={{ fontSize: 11, color: 'var(--t3)' }}>клик — открыть и проверить юнит-экономику</span>}>
            {rows.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>
                Партий пока нет. Нажмите «+ Партия» или импортируйте накладную Excel/CSV.
              </div>
            ) : (
              <div style={{ overflowX: 'auto', border: '1px solid var(--bd)', borderRadius: 12 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, minWidth: 760 }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg3)', zIndex: 1 }}>Партия</th>
                      <th style={th}>Дата</th>
                      <th style={th}>Позиций</th>
                      <th style={{ ...th, color: '#D97706' }}>Вложено</th>
                      <th style={th}>Прибыль</th>
                      <th style={th}>Маржа</th>
                      <th style={th}>ROI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ s, c, be }) => (
                      <tr key={s.id} onClick={() => setEditing(s)} style={{ cursor: 'pointer' }}
                        onMouseEnter={ev => (ev.currentTarget.style.background = 'var(--bg3)')}
                        onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}>
                        <td style={{ ...td, textAlign: 'left', color: 'var(--t)', fontWeight: 600, position: 'sticky', left: 0, background: 'var(--bg2)' }}>
                          {s.name || '(без названия)'}{s.supplier ? <span style={{ color: 'var(--t3)', fontWeight: 400 }}> · {s.supplier}</span> : null}
                        </td>
                        <td style={td}>{fmtDate(s.shipment_date)}</td>
                        <td style={td}>{s.items.length}</td>
                        <td style={{ ...td, color: '#D97706', fontWeight: 700 }}>{fmtFull(c.cost)}</td>
                        <td style={{ ...td, color: be.priced ? (be.profit >= 0 ? 'var(--primary)' : '#C0392B') : 'var(--t3)', fontWeight: 700 }}>{be.priced ? fmtFull(be.profit) : '—'}</td>
                        <td style={{ ...td, color: be.priced ? (be.profit >= 0 ? 'var(--primary)' : '#C0392B') : 'var(--t3)' }}>{be.priced ? fmtPct1(be.marginPct) : '—'}</td>
                        <td style={{ ...td, color: be.priced ? roiColor(be.roi) : 'var(--t3)', fontWeight: 800, fontSize: 13 }}>{be.priced ? fmtPct(be.roi) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}

      {editing && (
        <ShipmentForm
          initial={editing}
          channels={channels}
          onEditChannels={() => setChOpen(true)}
          onClose={() => setEditing(null)}
          onSaved={refresh}
          onDeleted={editing.id ? refresh : undefined}
        />
      )}
      {chOpen && <ChannelSettings channels={channels} onSave={persistChannels} onClose={() => setChOpen(false)} />}
    </div>
  )
}
