'use client'

/* Обзор: KPI периода, причины изменения выручки, кому звонить сегодня, динамика, разрезы. */
import { LoadingBox } from '@/shared/ui/ui'
import { fetchClients,fetchOverview,fetchProducts,RISK_STATUSES,salesKeys,type DimRow,type Filters } from '@/views/crm/sales/api'
import { Bar,Card,Delta,ErrorBox,Kpi,money,moneyShort,monthRu,Notice,num,StatusPill,TableWrap,td,tdNum,th,thNum } from '@/views/crm/sales/ui'
import { useIsMobile } from '@/views/crm/shared/crmui'
import { useQuery } from '@tanstack/react-query'
import { lazy,Suspense,useMemo } from 'react'

const AreaChart = lazy(() => import('@/views/crm/tabs/dash/AreaChartLazy'))

type Go = (v: 'clients' | 'growth' | 'forecast' | 'sync') => void

const BRIDGE: { key: 'new' | 'returned' | 'growth' | 'decline' | 'lost'; label: string; hint: string }[] = [
  { key: 'new', label: 'Новые клиенты', hint: 'Первая покупка в выбранном периоде' },
  { key: 'returned', label: 'Вернувшиеся', hint: 'Не покупали в прошлом периоде, купили в текущем' },
  { key: 'growth', label: 'Рост действующих', hint: 'Покупали в обоих периодах, купили больше' },
  { key: 'decline', label: 'Снижение действующих', hint: 'Покупали в обоих периодах, купили меньше' },
  { key: 'lost', label: 'Не купили в периоде', hint: 'Покупали в прошлом периоде, в текущем — нет' },
]

export default function OverviewView({ filters, onClient, onGo }: { filters: Filters; onClient: (ref: string, name: string) => void; onGo: Go }) {
  const isMobile = useIsMobile()
  const ov = useQuery({ queryKey: salesKeys.overview(filters), queryFn: () => fetchOverview(filters), staleTime: 5 * 60_000 })
  const cl = useQuery({ queryKey: salesKeys.clients(filters), queryFn: () => fetchClients(filters), staleTime: 5 * 60_000 })
  const pr = useQuery({ queryKey: salesKeys.products(filters), queryFn: () => fetchProducts(filters), staleTime: 5 * 60_000 })

  // Под угрозой: пропустившие заказ, снижающие объём, разовые и ушедшие не позднее 180 дн. назад
  const risk = useMemo(() => (cl.data?.clients ?? [])
    .filter(c => RISK_STATUSES.includes(c.status) && (c.status !== 'lost' || c.days_since <= 180))
    .reduce((a, c) => ({ n: a.n + 1, loss: a.loss + c.loss_monthly }), { n: 0, loss: 0 }), [cl.data])

  const callToday = useMemo(() => (cl.data?.clients ?? [])
    .filter(c => c.priority > 0 && (c.status === 'sleeping' || c.status === 'declining' || (c.status === 'lost' && c.days_since <= 180)))
    .slice(0, 8), [cl.data])

  if (ov.isLoading) return <LoadingBox minHeight={300} label="Считаю показатели…" />
  if (ov.error) return <ErrorBox error={ov.error} onRetry={() => ov.refetch()} />
  const d = ov.data!
  const cur = d.kpi?.cur, prev = d.kpi?.prev, yoy = d.kpi?.yoy

  const chart = d.series.map(s => ({
    t: d.period.granularity === 'day' ? new Date(s.t + 'T00:00:00').toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) : monthRu(s.t),
    'Выручка': s.revenue, 'Год назад': s.revenue_yoy ?? undefined,
  }))
  const parts = d.bridge.parts
  const bridgeMax = Math.max(1, ...BRIDGE.map(b => Math.abs(parts[b.key]?.amount ?? 0)))
  const periodLabel = `${d.period.days} дн.`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      {d.cost_preliminary && (
        <Notice tone="warn">
          В периоде есть месяцы без проведённого «Закрытия месяца» в 1С — себестоимость и маржа по ним предварительные.
        </Notice>
      )}

      {/* ── KPI ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0,1fr) minmax(0,1fr)' : 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10 }}>
        <Kpi label="Выручка" hint="Сумма продаж с НДС за вычетом возвратов, по данным 1С"
          value={moneyShort(cur?.revenue ?? 0)}
          sub={<><Delta cur={cur?.revenue} prev={prev?.revenue} suffix="к пред." /><Delta cur={cur?.revenue} prev={yoy?.revenue} suffix="к году" /></>} />
        <Kpi label="Маржа" hint="Выручка без НДС минус себестоимость без НДС (1С)"
          value={moneyShort(cur?.margin ?? 0)}
          sub={<><span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)' }}>{cur?.margin_pct != null ? `${cur.margin_pct}%` : '—'}</span><Delta cur={cur?.margin} prev={prev?.margin} suffix="к пред." /></>} />
        <Kpi label="Заказы" value={num(cur?.orders ?? 0)} hint="Документы продажи с суммой больше нуля"
          sub={<Delta cur={cur?.orders} prev={prev?.orders} suffix="к пред." />} />
        <Kpi label="Средний чек" value={moneyShort(cur?.avg_check)} hint="Продажи без возвратов / число заказов"
          sub={<Delta cur={cur?.avg_check} prev={prev?.avg_check} suffix="к пред." />} />
        <Kpi label="Активные клиенты" value={num(cur?.clients ?? 0)} hint="Клиенты с хотя бы одной покупкой в периоде"
          sub={<><Delta cur={cur?.clients} prev={prev?.clients} suffix="к пред." /><span style={{ fontSize: 11, color: 'var(--t3)' }}>новых: {d.new_clients}</span></>} />
        <Kpi label="Возвраты" value={moneyShort(cur?.returns ?? 0)} tone={(cur?.returns ?? 0) > 0 ? 'ora' : undefined}
          sub={<Delta cur={cur?.returns} prev={prev?.returns} invert suffix="к пред." />} />
        <Kpi label="Выручка под угрозой" tone="red"
          hint="Среднемесячная выручка клиентов, которые пропустили заказ, снижают объём, сделали разовый заказ или ушли не позднее 180 дн. назад — по их фактической истории"
          value={cl.isLoading ? '…' : `${moneyShort(risk.loss)}/мес`}
          sub={<button onClick={() => onGo('clients')} style={linkBtn}>{risk.n} клиентов в риске →</button>} />
      </div>

      {/* ── Почему изменилась выручка + кому звонить ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0,1fr)' : 'minmax(0,1fr) minmax(0,1.2fr)', gap: 14 }}>
        <Card title="Почему изменилась выручка" hint={`Сравнение с предыдущими ${periodLabel} (${d.period.prev_from} — ${d.period.prev_to}) по каждому клиенту`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--t2)', marginBottom: 10 }}>
            <span>Было: <b style={{ color: 'var(--t)' }}>{moneyShort(d.bridge.prev)}</b></span>
            <span>Стало: <b style={{ color: 'var(--t)' }}>{moneyShort(d.bridge.cur)}</b></span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {BRIDGE.map(b => {
              const p = parts[b.key]
              const amt = p?.amount ?? 0
              return (
                <div key={b.key} title={b.hint}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3, gap: 8 }}>
                    <span style={{ color: 'var(--t2)' }}>{b.label} <span style={{ color: 'var(--t3)' }}>· {p?.clients ?? 0}</span></span>
                    <b style={{ color: amt < 0 ? 'var(--red)' : amt > 0 ? 'var(--primary2)' : 'var(--t3)', whiteSpace: 'nowrap' }}>{amt > 0 ? '+' : ''}{moneyShort(amt)}</b>
                  </div>
                  <Bar value={amt} max={bridgeMax} color={amt < 0 ? 'var(--red)' : 'var(--primary)'} />
                </div>
              )
            })}
          </div>
          {(d.bridge.top_lost.length > 0 || d.bridge.top_decline.length > 0) && (
            <div style={{ marginTop: 14, borderTop: '1px solid var(--bd)', paddingTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', marginBottom: 6 }}>Больше всего потеряли на</div>
              {[...d.bridge.top_lost.map(x => ({ ...x, k: 'не купил' })), ...d.bridge.top_decline.map(x => ({ ...x, k: 'меньше' }))]
                .sort((a, b) => (b.prev - b.cur) - (a.prev - a.cur)).slice(0, 6).map(x => (
                  <button key={x.ref} onClick={() => onClient(x.ref, x.name)} style={rowBtn}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{x.name} <span style={{ color: 'var(--t3)' }}>· {x.k}</span></span>
                    <b style={{ color: 'var(--red)', whiteSpace: 'nowrap' }}>−{moneyShort(x.prev - x.cur)}</b>
                  </button>
                ))}
            </div>
          )}
        </Card>

        <Card title="Позвонить сегодня" hint="Клиенты с наибольшей выручкой под угрозой: пропустили ожидаемый заказ, снижают объём или ушли не позднее 180 дн. назад"
          right={<button onClick={() => onGo('clients')} style={linkBtn}>Все клиенты в риске →</button>}>
          {cl.isLoading ? <LoadingBox minHeight={160} /> : cl.error ? <ErrorBox error={cl.error} /> : callToday.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--t3)', padding: '20px 0' }}>Клиентов в риске нет.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {callToday.map(c => (
                <button key={c.ref} onClick={() => onClient(c.ref, c.name)}
                  style={{ ...rowBtn, flexDirection: 'column', alignItems: 'stretch', gap: 3, padding: '9px 4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{c.name}</span>
                    <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                      <StatusPill status={c.status} />
                      <b style={{ color: 'var(--red)', fontSize: 12, whiteSpace: 'nowrap' }}>{moneyShort(c.loss_monthly)}/мес</b>
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--t2)', textAlign: 'left' }}>{c.reason}</span>
                  <span style={{ fontSize: 12, color: 'var(--t)', textAlign: 'left' }}><b>{c.manager}:</b> {c.action}</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── Динамика ── */}
      <Card title="Динамика выручки" hint="Факт по данным 1С; пунктир сравнения — тот же период год назад">
        {chart.length === 0 ? <div style={{ fontSize: 13, color: 'var(--t3)' }}>Нет продаж в периоде.</div> : (
          <Suspense fallback={<LoadingBox minHeight={220} />}>
            <AreaChart className="h-56" data={chart} index="t" categories={['Выручка', 'Год назад']} colors={['emerald', 'gray']}
              valueFormatter={(v: number) => moneyShort(v)} showLegend showGridLines={false} curveType="monotone"
              startEndOnly={chart.length > 14} showYAxis={!isMobile} yAxisWidth={72} connectNulls />
          </Suspense>
        )}
      </Card>

      {/* ── Разрезы ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0,1fr)' : 'minmax(0,1fr) minmax(0,1fr)', gap: 14 }}>
        <DimTable title="Менеджеры" rows={d.breakdown?.manager ?? []} withMargin />
        <DimBars title="Каналы продаж" rows={d.breakdown?.channel ?? []} />
        <DimBars title="Категории" rows={d.breakdown?.category ?? []} />
        <DimTable title="Топ клиентов" rows={d.breakdown?.client ?? []} onRow={r => onClient(r.key, r.name)} />
        <DimTable title="Топ товаров" rows={pr.data ?? []} qtyMode loading={pr.isLoading} />
      </div>
    </div>
  )
}

function DimTable({ title, rows, withMargin, onRow, qtyMode, loading }: {
  title: string; rows: DimRow[]; withMargin?: boolean; onRow?: (r: DimRow) => void; qtyMode?: boolean; loading?: boolean
}) {
  return (
    <Card title={title} pad={12}>
      {loading ? <LoadingBox minHeight={120} /> : rows.length === 0 ? <div style={{ fontSize: 13, color: 'var(--t3)' }}>Нет данных.</div> : (
        <TableWrap maxHeight={420}>
          <thead><tr>
            <th style={th}>Название</th>
            <th style={thNum}>Выручка</th>
            <th style={thNum}>К пред.</th>
            {withMargin && <th style={thNum}>Маржа</th>}
            <th style={thNum}>{qtyMode ? 'Кол-во' : 'Заказы'}</th>
            {!qtyMode && <th style={thNum}>Клиенты</th>}
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} onClick={onRow ? () => onRow(r) : undefined} style={{ cursor: onRow ? 'pointer' : undefined }}>
                <td style={{ ...td, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>{r.name}</td>
                <td style={tdNum}>{money(r.revenue)}</td>
                <td style={tdNum}><Delta cur={r.revenue} prev={r.prev} /></td>
                {withMargin && <td style={tdNum}>{r.revenue ? `${moneyShort(r.margin)}` : '—'}</td>}
                <td style={tdNum}>{num(r.orders)}</td>
                {!qtyMode && <td style={tdNum}>{num(r.clients)}</td>}
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </Card>
  )
}

function DimBars({ title, rows }: { title: string; rows: DimRow[] }) {
  const total = rows.reduce((s, r) => s + Math.max(0, r.revenue), 0)
  const max = Math.max(1, ...rows.map(r => r.revenue))
  return (
    <Card title={title} pad={12}>
      {rows.length === 0 ? <div style={{ fontSize: 13, color: 'var(--t3)' }}>Нет данных.</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, maxHeight: 420, overflowY: 'auto' }}>
          {rows.map(r => (
            <div key={r.key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, marginBottom: 3 }}>
                <span style={{ color: 'var(--t)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                <span style={{ display: 'flex', gap: 8, whiteSpace: 'nowrap' }}>
                  <b>{moneyShort(r.revenue)}</b>
                  <span style={{ color: 'var(--t3)' }}>{total ? Math.round((100 * Math.max(0, r.revenue)) / total) : 0}%</span>
                  <Delta cur={r.revenue} prev={r.prev} />
                </span>
              </div>
              <Bar value={r.revenue} max={max} />
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

const linkBtn: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, color: 'var(--primary2)', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
}
const rowBtn: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, width: '100%',
  padding: '6px 4px', background: 'none', border: 'none', borderBottom: '1px solid var(--bd)',
  cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--t)', minWidth: 0,
}
