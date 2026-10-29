'use client'

/* Прогноз продаж 30/60/90 дн. (отдельно от факта) и план-факт по менеджерам. */
import { LoadingBox } from '@/shared/ui/ui'
import { useCRM } from '@/views/crm/context/CRMContext'
import { fetchForecast,fetchPlanFact,salesKeys,setPlan,type Filters,type Meta } from '@/views/crm/sales/api'
import { Bar,Card,Delta,ErrorBox,Kpi,Notice,TableWrap,dateRu,money,moneyShort,monthRu,td,tdNum,th,thNum } from '@/views/crm/sales/ui'
import { useIsMobile } from '@/views/crm/shared/crmui'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

const curMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }

export default function ForecastPlanView({ filters, isAdmin, managers }: { filters: Filters; isAdmin: boolean; managers: Meta['managers'] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <PlanFactBlock isAdmin={isAdmin} managers={managers} />
      <ForecastBlock filters={filters} />
    </div>
  )
}

/* ── План-факт ── */
function PlanFactBlock({ isAdmin, managers }: { isAdmin: boolean; managers: Meta['managers'] }) {
  const isMobile = useIsMobile()
  const qc = useQueryClient()
  const { toast } = useCRM()
  const [month, setMonth] = useState(curMonth())
  const [edit, setEdit] = useState<Record<string, string>>({})
  const pf = useQuery({ queryKey: salesKeys.planFact(month), queryFn: () => fetchPlanFact(month), staleTime: 60_000 })

  const save = useMutation({
    mutationFn: async () => {
      for (const [k, v] of Object.entries(edit)) {
        const amount = Number(v.replace(/\s/g, '').replace(',', '.'))
        if (v.trim() === '' || !Number.isFinite(amount) || amount < 0) throw new Error('План должен быть числом ≥ 0')
        await setPlan(month, k === 'company' ? null : k, amount)
      }
    },
    onSuccess: () => { setEdit({}); toast('План сохранён'); qc.invalidateQueries({ queryKey: salesKeys.planFact(month) }) },
    onError: (e: Error) => toast(e.message, 3500),
  })

  if (pf.isLoading) return <LoadingBox minHeight={200} />
  if (pf.error) return <ErrorBox error={pf.error} onRetry={() => pf.refetch()} />
  const d = pf.data!
  const c = d.company
  const plan = c?.plan ?? c?.plan_managers_sum ?? null
  const expected = plan ? Math.round((plan * d.days_elapsed) / d.days_in_month) : null
  const rows = [...d.managers]
  // менеджеры без продаж и без плана в этом месяце — чтобы можно было задать план
  if (isAdmin) for (const m of managers) if (!rows.find(r => r.ref === m.ref)) rows.push({ ref: m.ref, name: m.name, plan: null, fact: 0, prev_same: 0, pct: null, expected_to_date: null, deviation: null, run_rate: null })
  const planInput = (key: string, val: number | null) => (
    <input inputMode="numeric" value={edit[key] ?? (val != null ? String(Math.round(val)) : '')}
      onChange={e => setEdit(s => ({ ...s, [key]: e.target.value }))} placeholder="план, ₸"
      style={{ width: 120, padding: '5px 8px', borderRadius: 8, border: '1px solid var(--bd2)', background: 'var(--bg3)', color: 'var(--t)', fontSize: 13, fontFamily: 'inherit', textAlign: 'right' }} />
  )

  return (
    <Card title="План-факт" hint="Факт — продажи из 1С с начала месяца. «Темп» — сколько выйдет к концу месяца при текущей скорости продаж (оценка, не факт)."
      right={<input type="month" value={month.slice(0, 7)} onChange={e => e.target.value && setMonth(e.target.value + '-01')}
        style={{ padding: '5px 8px', borderRadius: 10, border: '1px solid var(--bd2)', background: 'var(--bg2)', color: 'var(--t)', fontFamily: 'inherit', fontSize: 13 }} />}>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,minmax(0,1fr))' : 'repeat(4,minmax(0,1fr))', gap: 10, marginBottom: 12 }}>
        <Kpi label="План месяца" value={plan != null ? moneyShort(plan) : 'не задан'}
          sub={<span style={{ fontSize: 11, color: 'var(--t3)' }}>{c?.plan != null ? 'план компании' : c?.plan_managers_sum != null ? 'сумма планов менеджеров' : isAdmin ? 'задайте ниже' : 'задаёт администратор'}</span>} />
        <Kpi label={`Факт (${d.days_elapsed} из ${d.days_in_month} дн.)`} value={moneyShort(c?.fact ?? 0)}
          sub={<Delta cur={c?.fact} prev={c?.prev_same} suffix="к пред. мес." />} />
        <Kpi label="Выполнение" value={plan ? `${Math.round((100 * (c?.fact ?? 0)) / plan)}%` : '—'}
          tone={plan && expected != null ? ((c?.fact ?? 0) >= expected ? 'green' : 'red') : undefined}
          sub={expected != null ? <span style={{ fontSize: 11, color: 'var(--t3)' }}>к этой дате нужно {moneyShort(expected)}</span> : undefined} />
        <Kpi label="Темп к концу месяца" value={moneyShort(c?.run_rate)} hint="Оценка: факт / прошедшие дни × дни месяца"
          sub={plan ? <span style={{ fontSize: 11, fontWeight: 700, color: (c?.run_rate ?? 0) >= plan ? 'var(--primary2)' : 'var(--red)' }}>{(c?.run_rate ?? 0) >= plan ? 'план выполняется' : `не хватит ${moneyShort(plan - (c?.run_rate ?? 0))}`}</span> : undefined} />
      </div>

      <TableWrap>
        <thead><tr>
          <th style={th}>Менеджер</th><th style={thNum}>План</th><th style={thNum}>Факт</th><th style={thNum}>Выполнение</th>
          <th style={thNum}>Отклонение к дате</th><th style={thNum}>Темп к концу</th><th style={thNum}>Пред. мес. (тот же срок)</th>
        </tr></thead>
        <tbody>
          {isAdmin && (
            <tr style={{ background: 'var(--fl2)' }}>
              <td style={{ ...td, fontWeight: 700 }}>Компания (общий план)</td>
              <td style={tdNum}>{planInput('company', c?.plan ?? null)}</td>
              <td style={tdNum} colSpan={5} />
            </tr>
          )}
          {rows.map(r => (
            <tr key={r.ref}>
              <td style={{ ...td, fontWeight: 600 }}>{r.name}</td>
              <td style={tdNum}>{isAdmin ? planInput(r.ref, r.plan) : money(r.plan)}</td>
              <td style={tdNum}>{money(r.fact)}</td>
              <td style={{ ...tdNum, minWidth: 110 }}>
                {r.pct != null ? <><div style={{ fontWeight: 700 }}>{r.pct}%</div><Bar value={Math.min(r.pct, 100)} max={100} color={r.deviation != null && r.deviation < 0 ? 'var(--red)' : 'var(--primary)'} /></> : '—'}
              </td>
              <td style={{ ...tdNum, color: r.deviation == null ? 'var(--t3)' : r.deviation < 0 ? 'var(--red)' : 'var(--primary2)', fontWeight: 700 }}>
                {r.deviation == null ? '—' : `${r.deviation > 0 ? '+' : ''}${moneyShort(r.deviation)}`}
              </td>
              <td style={tdNum}>{money(r.run_rate)}</td>
              <td style={tdNum}>{money(r.prev_same)} <Delta cur={r.fact} prev={r.prev_same} /></td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {isAdmin && Object.keys(edit).length > 0 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
          <button onClick={() => setEdit({})} style={btn2}>Отменить</button>
          <button onClick={() => save.mutate()} disabled={save.isPending} style={btn1}>{save.isPending ? 'Сохраняю…' : 'Сохранить план'}</button>
        </div>
      )}
      {d.managers.some(r => r.deviation != null && r.deviation < 0) && (
        <div style={{ marginTop: 10 }}>
          <Notice tone="warn">
            Отстают от плана: {d.managers.filter(r => r.deviation != null && r.deviation < 0).map(r => `${r.name} (${moneyShort(r.deviation!)})`).join(', ')}.
            Причины по клиентам — во вкладке «Клиенты и риски» с фильтром по менеджеру.
          </Notice>
        </div>
      )}
    </Card>
  )
}

/* ── Прогноз ── */
function ForecastBlock({ filters }: { filters: Filters }) {
  const isMobile = useIsMobile()
  const fc = useQuery({ queryKey: salesKeys.forecast(filters), queryFn: () => fetchForecast(filters), staleTime: 10 * 60_000 })
  if (fc.isLoading) return <LoadingBox minHeight={240} label="Считаю прогноз…" />
  if (fc.error) return <ErrorBox error={fc.error} onRetry={() => fc.refetch()} />
  const d = fc.data!

  // История (факт) + прогноз по месяцам на 90 дней — разными цветами
  const hist = d.history.slice(-12).map(h => ({ m: h.month, v: h.revenue, kind: 'fact' as const }))
  const fut = d.h90.by_month.map(f => ({ m: f.month, v: f.amount, kind: 'fc' as const }))
  const bars = [...hist.filter(h => !fut.find(f => f.m === h.m)), ...fut.map(f => ({ ...f, partFact: hist.find(h => h.m === f.m)?.v ?? 0 }))]
  const max = Math.max(1, ...bars.map(b => b.v + ('partFact' in b ? b.partFact : 0)))

  return (
    <Card title="Прогноз продаж" hint={d.method}>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(3,minmax(0,1fr))' : 'repeat(4,minmax(0,1fr))', gap: 10, marginBottom: 14 }}>
        <Kpi label="30 дней" value={moneyShort(d.h30.total)} sub={<span style={{ fontSize: 11, color: 'var(--t3)' }}>оценка</span>} />
        <Kpi label="60 дней" value={moneyShort(d.h60.total)} sub={<span style={{ fontSize: 11, color: 'var(--t3)' }}>оценка</span>} />
        <Kpi label="90 дней" value={moneyShort(d.h90.total)} sub={<span style={{ fontSize: 11, color: 'var(--t3)' }}>оценка</span>} />
        {!isMobile && <Kpi label="Точность на истории" value={d.mape != null ? `±${d.mape}%` : '—'} hint="Средняя ошибка прогноза на 30 дн., если бы его делали в конце каждого из последних месяцев" />}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 180, padding: '0 2px', overflowX: 'auto' }}>
        {bars.map(b => {
          const pf = 'partFact' in b ? b.partFact : 0
          return (
            <div key={b.m + b.kind} title={`${monthRu(b.m)}: ${b.kind === 'fc' ? `прогноз ${money(b.v)}${pf ? ` + факт ${money(pf)}` : ''}` : `факт ${money(b.v)}`}`}
              style={{ flex: '1 0 26px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: 150 }}>
                {b.kind === 'fc' && <div style={{ height: `${(b.v / max) * 100}%`, background: 'repeating-linear-gradient(45deg, var(--bd2), var(--bd2) 4px, var(--bg3) 4px, var(--bg3) 8px)', border: '1px dashed var(--t3)', borderBottom: pf ? 'none' : undefined, borderRadius: pf ? '6px 6px 0 0' : 6 }} />}
                {(b.kind === 'fact' || pf > 0) && <div style={{ height: `${((b.kind === 'fact' ? b.v : pf) / max) * 100}%`, background: 'var(--primary)', borderRadius: b.kind === 'fc' ? '0 0 6px 6px' : 6 }} />}
              </div>
              <span style={{ fontSize: 10, color: 'var(--t3)', whiteSpace: 'nowrap' }}>{monthRu(b.m)}</span>
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--t2)', margin: '8px 0 14px', flexWrap: 'wrap' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'var(--primary)', marginRight: 4 }} />Факт 1С</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, border: '1px dashed var(--t3)', background: 'var(--bg3)', marginRight: 4 }} />Прогноз (оценка)</span>
        <span>Темп: {moneyShort(d.h30.rate_per_day)} в день · сезонность по {d.h30.seasonal_years ?? 0} полн. годам</span>
      </div>

      {d.backtest.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)', marginBottom: 6 }}>Проверка метода на прошлых месяцах (прогноз на 30 дн. против факта)</div>
          <TableWrap>
            <thead><tr><th style={th}>Прогноз сделан на</th><th style={thNum}>Прогноз</th><th style={thNum}>Факт</th><th style={thNum}>Ошибка</th></tr></thead>
            <tbody>
              {d.backtest.map(b => (
                <tr key={b.asof}>
                  <td style={td}>{dateRu(b.asof)}</td>
                  <td style={tdNum}>{money(b.forecast)}</td>
                  <td style={tdNum}>{money(b.fact)}</td>
                  <td style={{ ...tdNum, color: b.error_pct != null && Math.abs(b.error_pct) > 20 ? 'var(--red)' : 'var(--t2)' }}>{b.error_pct != null ? `${b.error_pct > 0 ? '+' : ''}${b.error_pct}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </>
      )}
    </Card>
  )
}

const btn1: React.CSSProperties = { padding: '8px 14px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }
const btn2: React.CSSProperties = { padding: '8px 14px', borderRadius: 10, border: '1px solid var(--bd2)', background: 'var(--bg3)', color: 'var(--t)', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }
