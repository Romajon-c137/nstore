'use client'

import { fmtFull,fmtMoney } from '@/shared/lib/format'
import { supabase } from '@/shared/lib/supabase'
import { Metric,Text,Card as TremorCard } from '@/shared/ui/charts'
import { InfoDot } from '@/shared/ui/ui'
import { useCRM } from '@/views/crm/context/CRMContext'
import { Modal,inputStyle,labelStyle,useIsMobile } from '@/views/crm/shared/crmui'
import { type Channel,ChannelSettings,findChannel,loadChannels,saveChannels } from '@/views/crm/tabs/BatchesView'
import { useQuery,useQueryClient } from '@tanstack/react-query'
import { useMemo,useState } from 'react'

/* ══════════════════════════════════════════════════════════════════
   ПРОДУКТЫ — фин-аналитика нового товара ДО закупки (решение «брать?»).
   По КП производителя (цена, MOQ, валюта) + прогнозу продаж считаем
   landed cost, маржу, ROI, инвестицию в MOQ, окупаемость, целевую
   закупочную цену и вердикт Go/No-Go. Плюс аналитика по городам:
   объём, доставка, маржа и ROI по каждому городу.

   Отличие от «Партий»: там факт по купленному, тут прогноз до сделки.
   Каналы продаж и их издержки — те же пресеты, что в «Партиях».
   Данные — public.product_feasibility (admin-only). Экономика — здесь.
   ══════════════════════════════════════════════════════════════════ */

const COMPANY = 'JJCo'
const CURRENCIES = ['USD', 'CNY', 'EUR', 'RUB', 'KZT'] as const
type Currency = typeof CURRENCIES[number]
const TARGET_MARGIN = 0.30   // желаемая маржа для «целевой закупочной цены»

type Status = 'draft' | 'approved' | 'rejected'
const STATUS_LABEL: Record<Status, string> = { draft: 'На расчёте', approved: 'Одобрен', rejected: 'Отклонён' }
const STATUS_COLOR: Record<Status, string> = { draft: '#D97706', approved: 'var(--primary)', rejected: '#C0392B' }

export interface City { city: string; volume: number; delivery: number }
export interface Product {
  id: string
  name: string
  supplier: string
  status: Status
  currency: Currency
  fx_rate: number
  buy_price: number
  moq: number
  logistics_unit: number
  customs_pct: number
  vat_rate: number
  one_time: number
  sale_price: number      // с НДС
  channel: string
  monthly_volume: number
  cities: City[]
  note?: string | null
}

/* ── formatters ── */
function fmtPct(n: number): string { return (n * 100).toFixed(0) + '%' }
function fmtPct1(n: number): string { return (n * 100).toFixed(1).replace('.0', '') + '%' }
function roiColor(roi: number): string { return roi >= 0.3 ? 'var(--primary)' : roi >= 0 ? '#D97706' : '#C0392B' }
function num(v: unknown): number {
  const s = String(v ?? '').replace(/[^\d.,-]/g, '').replace(/,/g, '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/* ══════════════════════════════════════════════════════════════════
   MATH
   ══════════════════════════════════════════════════════════════════ */
export interface ProdCalc {
  fx: number
  landed: number        // себестоимость на складе за ед., ₸
  net: number           // цена без выходного НДС, ₸
  feeRet: number        // издержки канала на ед. (комиссия+возвраты), ₸
  contribution: number  // маржинальная прибыль на ед. (базовый канал, без города), ₸
  marginPct: number
  roi: number
  investment: number    // вложения в MOQ (+ разовые), ₸
  breakEven: number     // штук для окупаемости вложений
  paybackMonths: number // срок окупаемости, мес
  targetBuy: number     // целевая закупочная цена для TARGET_MARGIN, в валюте
  priced: boolean
}
export function calcProduct(p: Product, channels: Channel[]): ProdCalc {
  const fx = p.fx_rate || (p.currency === 'KZT' ? 1 : 0)
  const goodsUnit = p.buy_price * fx
  const customs = goodsUnit * ((p.customs_pct || 0) / 100)
  const landed = goodsUnit + (p.logistics_unit || 0) + customs
  const net = p.sale_price / (1 + (p.vat_rate || 0) / 100)
  const ch = findChannel(channels, p.channel)
  const feeRet = net * (((ch.fee_pct || 0) + (ch.returns_pct || 0)) / 100)
  const baseDelivery = ch.delivery || 0
  const contribution = net - landed - feeRet - baseDelivery
  const marginPct = net > 0 ? contribution / net : 0
  const roi = landed > 0 ? contribution / landed : 0
  const investment = (p.moq || 0) * landed + (p.one_time || 0)
  const breakEven = contribution > 0 ? investment / contribution : 0
  const paybackMonths = (contribution > 0 && p.monthly_volume > 0) ? investment / (contribution * p.monthly_volume) : 0
  const landedMax = net * (1 - TARGET_MARGIN) - feeRet - baseDelivery
  const targetBuy = fx > 0 ? Math.max(0, (landedMax - (p.logistics_unit || 0)) / (fx * (1 + (p.customs_pct || 0) / 100))) : 0
  return { fx, landed, net, feeRet, contribution, marginPct, roi, investment, breakEven, paybackMonths, targetBuy, priced: p.sale_price > 0 }
}
// Экономика города: доставка города вместо базовой доставки канала.
export interface CityCalc { contribution: number; profit: number; margin: number; roi: number }
function cityCalc(p: Product, calc: ProdCalc, channels: Channel[], city: City): CityCalc {
  const ch = findChannel(channels, p.channel)
  const feeRet = calc.net * (((ch.fee_pct || 0) + (ch.returns_pct || 0)) / 100)
  const contribution = calc.net - calc.landed - feeRet - (city.delivery || 0)
  return {
    contribution,
    profit: contribution * (city.volume || 0),
    margin: calc.net > 0 ? contribution / calc.net : 0,
    roi: calc.landed > 0 ? contribution / calc.landed : 0,
  }
}
// Вердикт Go/No-Go по марже и ROI.
function verdict(calc: ProdCalc): { label: string; color: string } {
  if (!calc.priced) return { label: 'Укажите цену', color: 'var(--t3)' }
  if (calc.marginPct >= 0.15 && calc.roi >= 0.2) return { label: 'GO — брать', color: 'var(--primary)' }
  if (calc.marginPct >= 0.08) return { label: 'На грани', color: '#D97706' }
  return { label: 'NO — невыгодно', color: '#C0392B' }
}

/* ── data ── */
async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('product_feasibility')
    .select('id,name,supplier,status,currency,fx_rate,buy_price,moq,logistics_unit,customs_pct,vat_rate,one_time,sale_price,channel,monthly_volume,cities,note')
    .eq('company', COMPANY)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map(r => ({ ...r, cities: Array.isArray(r.cities) ? r.cities : [] })) as unknown as Product[]
}

function emptyProduct(defChannel: string): Product {
  return {
    id: '', name: '', supplier: '', status: 'draft', currency: 'USD', fx_rate: 0,
    buy_price: 0, moq: 0, logistics_unit: 0, customs_pct: 0, vat_rate: 16, one_time: 0,
    sale_price: 0, channel: defChannel, monthly_volume: 0, cities: [], note: '',
  }
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
   PRODUCT FORM
   ══════════════════════════════════════════════════════════════════ */
function ProductForm({ initial, channels, onEditChannels, onClose, onSaved, onDeleted }: {
  initial: Product; channels: Channel[]; onEditChannels: () => void; onClose: () => void; onSaved: () => void; onDeleted?: () => void
}) {
  const { profile, toast } = useCRM()
  const [p, setP] = useState<Product>(initial)
  const [saving, setSaving] = useState(false)
  const c = calcProduct(p, channels)
  const v = verdict(c)

  const set = <K extends keyof Product>(k: K, val: Product[K]) => setP(prev => ({ ...prev, [k]: val }))
  const setNum = (k: keyof Product) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, num(e.target.value) as never)
  const setCity = (idx: number, k: keyof City, val: string | number) => setP(prev => ({ ...prev, cities: prev.cities.map((ct, i) => i === idx ? { ...ct, [k]: val } : ct) }))
  const addCity = () => setP(prev => ({ ...prev, cities: [...prev.cities, { city: '', volume: 0, delivery: 0 }] }))
  const delCity = (idx: number) => setP(prev => ({ ...prev, cities: prev.cities.filter((_, i) => i !== idx) }))

  const cityTotals = useMemo(() => {
    const vol = p.cities.reduce((a, ct) => a + (ct.volume || 0), 0)
    const profit = p.cities.reduce((a, ct) => a + cityCalc(p, c, channels, ct).profit, 0)
    return { vol, profit }
  }, [p, c, channels])

  async function save() {
    if (!p.name.trim()) { toast('Укажите название продукта'); return }
    setSaving(true)
    const cities = p.cities.filter(ct => (ct.city || '').trim() || ct.volume)
    const payload = {
      company: COMPANY, name: p.name.trim(), supplier: p.supplier.trim(), status: p.status,
      currency: p.currency, fx_rate: p.fx_rate, buy_price: p.buy_price, moq: p.moq,
      logistics_unit: p.logistics_unit, customs_pct: p.customs_pct, vat_rate: p.vat_rate,
      one_time: p.one_time, sale_price: p.sale_price, channel: p.channel, monthly_volume: p.monthly_volume,
      cities, note: p.note ?? '', updated_at: new Date().toISOString(), updated_by: profile?.id ?? null,
    }
    const res = p.id
      ? await supabase.from('product_feasibility').update(payload).eq('id', p.id)
      : await supabase.from('product_feasibility').insert(payload)
    setSaving(false)
    if (res.error) { toast('Ошибка сохранения: ' + res.error.message); return }
    toast(p.id ? 'Продукт обновлён' : 'Продукт сохранён'); onSaved()
  }
  async function remove() {
    if (!p.id || !confirm('Удалить продукт?')) return
    const { error } = await supabase.from('product_feasibility').delete().eq('id', p.id)
    if (error) { toast('Ошибка удаления: ' + error.message); return }
    toast('Продукт удалён'); onDeleted?.()
  }

  const small: React.CSSProperties = { ...inputStyle, padding: '7px 9px', fontSize: 12 }
  const th: React.CSSProperties = { padding: '7px 6px', textAlign: 'right', borderBottom: '1px solid var(--bd)', color: 'var(--t2)', fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap' }
  const cellInput: React.CSSProperties = { width: '100%', border: 'none', background: 'transparent', textAlign: 'right', padding: '7px 6px', fontSize: 12, fontFamily: 'inherit', color: 'var(--t)', outline: 'none' }

  return (
    <Modal onClose={onClose} maxWidth={980}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--t)' }}>{p.id ? 'Продукт' : 'Новый продукт'}</div>
        <div style={{ fontSize: 13, fontWeight: 800, color: v.color, border: `1.5px solid ${v.color}`, borderRadius: 999, padding: '3px 12px' }}>{v.label}</div>
      </div>

      {/* manufacturer data */}
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Данные производителя</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10, marginBottom: 10 }}>
        <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Название продукта</label>
          <input value={p.name} onChange={e => set('name', e.target.value)} placeholder="Наименование" style={small} /></div>
        <div><label style={labelStyle}>Поставщик</label>
          <input value={p.supplier} onChange={e => set('supplier', e.target.value)} placeholder="—" style={small} /></div>
        <div><label style={labelStyle}>Валюта</label>
          <select value={p.currency} onChange={e => set('currency', e.target.value as Currency)} style={small}>
            {CURRENCIES.map(cu => <option key={cu} value={cu}>{cu}</option>)}
          </select></div>
        <div><label style={labelStyle}>Курс к ₸</label>
          <input inputMode="decimal" defaultValue={p.fx_rate || ''} placeholder="1" onChange={setNum('fx_rate')} style={small} disabled={p.currency === 'KZT'} /></div>
        <div><label style={labelStyle}>Цена завода, {p.currency}</label>
          <input inputMode="decimal" defaultValue={p.buy_price || ''} placeholder="0" onChange={setNum('buy_price')} style={small} /></div>
        <div><label style={labelStyle}>MOQ (мин. заказ), шт</label>
          <input inputMode="decimal" defaultValue={p.moq || ''} placeholder="0" onChange={setNum('moq')} style={small} /></div>
        <div><label style={labelStyle}>Логистика на ед., ₸</label>
          <input inputMode="decimal" defaultValue={p.logistics_unit || ''} placeholder="0" onChange={setNum('logistics_unit')} style={small} /></div>
        <div><label style={labelStyle}>Пошлина, %</label>
          <input inputMode="decimal" defaultValue={p.customs_pct || ''} placeholder="0" onChange={setNum('customs_pct')} style={small} /></div>
        <div><label style={labelStyle}>Разовые (сертиф./листинг), ₸</label>
          <input inputMode="decimal" defaultValue={p.one_time || ''} placeholder="0" onChange={setNum('one_time')} style={small} /></div>
      </div>

      {/* sales assumptions */}
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.04em', margin: '6px 0 8px' }}>Прогноз продаж</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 10, marginBottom: 6 }}>
        <div><label style={labelStyle}>Цена продажи с НДС, ₸</label>
          <input inputMode="decimal" defaultValue={p.sale_price || ''} placeholder="0" onChange={setNum('sale_price')} style={small} /></div>
        <div><label style={labelStyle}>Канал</label>
          <select value={p.channel} onChange={e => set('channel', e.target.value)} style={small}>
            {channels.map(ch => <option key={ch.name} value={ch.name}>{ch.name}</option>)}
          </select></div>
        <div><label style={labelStyle}>Прогноз, шт/мес</label>
          <input inputMode="decimal" defaultValue={p.monthly_volume || ''} placeholder="0" onChange={setNum('monthly_volume')} style={small} /></div>
        <div><label style={labelStyle}>НДС, %</label>
          <input inputMode="decimal" defaultValue={p.vat_rate} onChange={setNum('vat_rate')} style={small} /></div>
      </div>

      {/* unit economics summary */}
      <div style={{ marginTop: 12, background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: 12, padding: 14, display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '6px 16px', fontSize: 13 }}>
        <span style={{ color: 'var(--t2)' }}>Себестоимость на складе (landed)</span><b style={{ textAlign: 'right', color: '#2563EB' }}>{fmtFull(c.landed)} ₸</b>
        {c.priced && <><span style={{ color: 'var(--t2)' }}>Маржинальная прибыль / ед</span><b style={{ textAlign: 'right', color: c.contribution >= 0 ? 'var(--primary)' : '#C0392B' }}>{fmtFull(c.contribution)} ₸ · маржа {fmtPct1(c.marginPct)}</b></>}
        {c.priced && <><span style={{ color: 'var(--t2)', fontWeight: 800 }}>ROI</span><b style={{ textAlign: 'right', color: roiColor(c.roi), fontWeight: 800, fontSize: 15 }}>{fmtPct(c.roi)}</b></>}
        <span style={{ color: 'var(--t2)' }}>Инвестиция в MOQ (+ разовые)</span><b style={{ textAlign: 'right', color: 'var(--t)' }}>{fmtFull(c.investment)} ₸</b>
        {c.priced && c.breakEven > 0 && <><span style={{ color: 'var(--t2)' }}>Окупаемость</span><b style={{ textAlign: 'right', color: 'var(--t)' }}>{fmtFull(c.breakEven)} шт{c.paybackMonths > 0 ? ` · ${c.paybackMonths.toFixed(1)} мес` : ''}</b></>}
        {c.priced && c.targetBuy > 0 && <><span style={{ color: 'var(--t2)' }}>Целевая закупка (для маржи {fmtPct(TARGET_MARGIN)})</span><b style={{ textAlign: 'right', color: 'var(--t)' }}>≤ {fmtFull(c.targetBuy)} {p.currency}</b></>}
      </div>

      {/* cities analytics */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '16px 0 6px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)' }}>Аналитика по городам ({p.cities.length})</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onEditChannels} style={{ background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--t2)', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Каналы</button>
          <button onClick={addCity} style={{ background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--t)', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>+ город</button>
        </div>
      </div>
      <div style={{ overflow: 'auto', maxHeight: 220, border: '1px solid var(--bd)', borderRadius: 10 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, minWidth: 640 }}>
          <thead><tr>
            <th style={{ ...th, textAlign: 'left' }}>Город</th>
            <th style={th}>Прогноз, шт</th>
            <th style={th}>Доставка ₸/ед</th>
            <th style={th}>Маржа</th>
            <th style={th}>ROI</th>
            <th style={th}>Прибыль</th>
            <th style={{ ...th, width: 28 }}></th>
          </tr></thead>
          <tbody>
            {p.cities.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 18, textAlign: 'center', color: 'var(--t3)', fontSize: 12 }}>Добавьте города, чтобы увидеть маржу и ROI по каждому.</td></tr>
            ) : p.cities.map((ct, idx) => {
              const cc = cityCalc(p, c, channels, ct)
              return (
                <tr key={idx}>
                  <td style={{ borderBottom: '1px solid var(--bd)', minWidth: 150 }}>
                    <input value={ct.city} onChange={e => setCity(idx, 'city', e.target.value)} placeholder="Город" style={{ ...cellInput, textAlign: 'left' }} /></td>
                  <td style={{ borderBottom: '1px solid var(--bd)', borderLeft: '1px solid var(--bd)' }}>
                    <input inputMode="decimal" defaultValue={ct.volume || ''} onChange={e => setCity(idx, 'volume', num(e.target.value))} style={cellInput} /></td>
                  <td style={{ borderBottom: '1px solid var(--bd)', borderLeft: '1px solid var(--bd)' }}>
                    <input inputMode="decimal" defaultValue={ct.delivery || ''} onChange={e => setCity(idx, 'delivery', num(e.target.value))} style={cellInput} /></td>
                  <td style={{ borderBottom: '1px solid var(--bd)', borderLeft: '1px solid var(--bd)', textAlign: 'right', padding: '7px 6px', color: c.priced ? (cc.contribution >= 0 ? 'var(--primary)' : '#C0392B') : 'var(--t3)', whiteSpace: 'nowrap' }}>{c.priced ? fmtPct1(cc.margin) : '—'}</td>
                  <td style={{ borderBottom: '1px solid var(--bd)', borderLeft: '1px solid var(--bd)', textAlign: 'right', padding: '7px 6px', color: c.priced ? roiColor(cc.roi) : 'var(--t3)', fontWeight: 800, whiteSpace: 'nowrap' }}>{c.priced ? fmtPct(cc.roi) : '—'}</td>
                  <td style={{ borderBottom: '1px solid var(--bd)', borderLeft: '1px solid var(--bd)', textAlign: 'right', padding: '7px 6px', color: c.priced ? (cc.profit >= 0 ? 'var(--primary)' : '#C0392B') : 'var(--t3)', fontWeight: 700, whiteSpace: 'nowrap' }}>{c.priced ? fmtFull(cc.profit) : '—'}</td>
                  <td style={{ borderBottom: '1px solid var(--bd)', textAlign: 'center' }}>
                    <button onClick={() => delCity(idx)} style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', fontSize: 15 }}>✕</button></td>
                </tr>
              )
            })}
          </tbody>
          {p.cities.length > 0 && (
            <tfoot><tr style={{ background: 'var(--bg3)' }}>
              <td style={{ padding: '8px 6px', fontWeight: 800, color: 'var(--t)' }}>Итого</td>
              <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, color: 'var(--t)' }}>{fmtFull(cityTotals.vol)}</td>
              <td colSpan={3}></td>
              <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 800, color: cityTotals.profit >= 0 ? 'var(--primary)' : '#C0392B' }}>{fmtFull(cityTotals.profit)}</td>
              <td></td>
            </tr></tfoot>
          )}
        </table>
      </div>

      {/* footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {p.id && onDeleted && <button onClick={remove} style={{ background: 'transparent', border: '1.5px solid #C0392B', color: '#C0392B', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Удалить</button>}
          <select value={p.status} onChange={e => set('status', e.target.value as Status)} style={{ ...small, width: 'auto' }}>
            {(Object.keys(STATUS_LABEL) as Status[]).map(st => <option key={st} value={st}>{STATUS_LABEL[st]}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} style={{ background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--t2)', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Отмена</button>
          <button onClick={save} disabled={saving} style={{ background: 'var(--primary)', border: 'none', color: '#fff', borderRadius: 10, padding: '9px 20px', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? .6 : 1, fontFamily: 'inherit' }}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ══════════════════════════════════════════════════════════════════
   MAIN VIEW
   ══════════════════════════════════════════════════════════════════ */
export default function ProductsView() {
  const { profile } = useCRM()
  const isMobile = useIsMobile()
  const qc = useQueryClient()
  const isAdmin = profile?.role === 'admin'
  const [editing, setEditing] = useState<Product | null>(null)
  const [channels, setChannels] = useState<Channel[]>(loadChannels)
  const [chOpen, setChOpen] = useState(false)
  const defChannel = channels[0]?.name ?? ''

  const { data = [], isLoading, isError } = useQuery({ queryKey: ['product-feasibility'], queryFn: fetchProducts, staleTime: 60_000 })

  const rows = useMemo(() => data.map(p => ({ p, c: calcProduct(p, channels), v: verdict(calcProduct(p, channels)) })), [data, channels])
  const agg = useMemo(() => {
    const go = rows.filter(r => r.v.label.startsWith('GO')).length
    const priced = rows.filter(r => r.c.priced)
    const avgRoi = priced.length ? priced.reduce((a, r) => a + r.c.roi, 0) / priced.length : 0
    return { count: rows.length, go, avgRoi, priced: priced.length > 0 }
  }, [rows])

  function persistChannels(next: Channel[]) { setChannels(next); saveChannels(next); setChOpen(false) }
  const refresh = () => { setEditing(null); qc.invalidateQueries({ queryKey: ['product-feasibility'] }) }

  if (!isAdmin) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>Раздел доступен только администраторам.</div>

  const btn = (bg: string, color: string, border?: string): React.CSSProperties => ({
    background: bg, color, border: border ?? 'none', borderRadius: 10, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  })
  const th: React.CSSProperties = { padding: '10px 10px', textAlign: 'right', borderBottom: '1px solid var(--bd)', color: 'var(--t2)', fontWeight: 700, whiteSpace: 'nowrap', fontSize: 11 }
  const td: React.CSSProperties = { padding: '10px 10px', textAlign: 'right', borderBottom: '1px solid var(--bd)', color: 'var(--t2)', whiteSpace: 'nowrap' }

  return (
    <div style={{ padding: isMobile ? 16 : '20px 28px', display: 'flex', flexDirection: 'column', gap: isMobile ? 14 : 20 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <button onClick={() => setChOpen(true)} style={btn('var(--bg2)', 'var(--t2)', '1px solid var(--bd)')}>Каналы</button>
        <button onClick={() => setEditing(emptyProduct(defChannel))} style={btn('var(--primary)', '#fff')}>+ Продукт</button>
      </div>

      {isLoading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>Загрузка…</div>}
      {isError && <div style={{ padding: 40, textAlign: 'center', color: '#C0392B' }}>Ошибка загрузки данных</div>}

      {!isLoading && !isError && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: isMobile ? 10 : 14 }}>
            <KPI i={0} label="Продуктов на расчёте" value={String(agg.count)} sub="в оценке"
              hint="Сколько новых товаров сейчас проходят оценку целесообразности закупки (до сделки). Это черновики и уже посчитанные кандидаты." />
            <KPI i={1} label="Проходят (GO)" value={String(agg.go)} sub="маржа ≥15% и ROI ≥20%" subColor="var(--primary)"
              hint="Сколько продуктов получили вердикт «GO — брать»: маржа ≥15% и ROI ≥20%. Такие товары выгодно заводить в ассортимент." />
            <KPI i={2} label="Средний ROI" value={agg.priced ? fmtPct(agg.avgRoi) : '—'} sub="по оценённым" subColor={roiColor(agg.avgRoi)}
              hint="Средний ROI по всем продуктам с указанной ценой продажи: прибыль на единицу ÷ себестоимость на складе. Общий ориентир привлекательности пула кандидатов." />
          </div>

          <Panel title="Продукты" hint="Кандидаты на закуп: по каждому — себестоимость на складе (landed), маржа, ROI, вложение в MOQ и вердикт Go/No-Go. Клик открывает полный расчёт с аналитикой по городам." right={<span style={{ fontSize: 11, color: 'var(--t3)' }}>клик — расчёт и аналитика по городам</span>}>
            {rows.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>Продуктов пока нет. Нажмите «+ Продукт» и внесите данные производителя.</div>
            ) : (
              <div style={{ overflowX: 'auto', border: '1px solid var(--bd)', borderRadius: 12 }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, minWidth: 800 }}>
                  <thead><tr>
                    <th style={{ ...th, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg3)', zIndex: 1 }}>Продукт</th>
                    <th style={th}>Статус</th>
                    <th style={{ ...th, color: '#2563EB' }}>Landed</th>
                    <th style={th}>Маржа</th>
                    <th style={th}>ROI</th>
                    <th style={th}>Инвестиция MOQ</th>
                    <th style={th}>Вердикт</th>
                  </tr></thead>
                  <tbody>
                    {rows.map(({ p, c, v }) => (
                      <tr key={p.id} onClick={() => setEditing(p)} style={{ cursor: 'pointer' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                        <td style={{ ...td, textAlign: 'left', color: 'var(--t)', fontWeight: 600, position: 'sticky', left: 0, background: 'var(--bg2)' }}>
                          {p.name || '(без названия)'}{p.supplier ? <span style={{ color: 'var(--t3)', fontWeight: 400 }}> · {p.supplier}</span> : null}
                        </td>
                        <td style={{ ...td, color: STATUS_COLOR[p.status], fontWeight: 700 }}>{STATUS_LABEL[p.status]}</td>
                        <td style={{ ...td, color: '#2563EB', fontWeight: 700 }}>{fmtFull(c.landed)}</td>
                        <td style={{ ...td, color: c.priced ? (c.contribution >= 0 ? 'var(--primary)' : '#C0392B') : 'var(--t3)' }}>{c.priced ? fmtPct1(c.marginPct) : '—'}</td>
                        <td style={{ ...td, color: c.priced ? roiColor(c.roi) : 'var(--t3)', fontWeight: 800, fontSize: 13 }}>{c.priced ? fmtPct(c.roi) : '—'}</td>
                        <td style={td}>{fmtMoney(c.investment)}</td>
                        <td style={{ ...td, color: v.color, fontWeight: 800 }}>{v.label}</td>
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
        <ProductForm initial={editing} channels={channels} onEditChannels={() => setChOpen(true)}
          onClose={() => setEditing(null)} onSaved={refresh} onDeleted={editing.id ? refresh : undefined} />
      )}
      {chOpen && <ChannelSettings channels={channels} onSave={persistChannels} onClose={() => setChOpen(false)} />}
    </div>
  )
}
