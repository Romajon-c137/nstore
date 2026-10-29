'use client'

/* Точки роста: рейтинг возможностей увеличить продажи + кросс-продажи по категориям. */
import { LoadingBox } from '@/shared/ui/ui'
import { fetchClients,fetchOpportunities,salesKeys,type Filters } from '@/views/crm/sales/api'
import { Bar,Card,ErrorBox,Notice,TableWrap,downloadCsv,moneyShort,num,td,tdNum,th,thNum } from '@/views/crm/sales/ui'
import { useIsMobile } from '@/views/crm/shared/crmui'
import { useQuery } from '@tanstack/react-query'
import { useMemo,useState } from 'react'

export default function OpportunitiesView({ filters, onClient }: { filters: Filters; onClient: (ref: string, name: string) => void }) {
  const isMobile = useIsMobile()
  const op = useQuery({ queryKey: salesKeys.opportunities(filters), queryFn: () => fetchOpportunities(filters), staleTime: 5 * 60_000 })
  const cl = useQuery({ queryKey: salesKeys.clients(filters), queryFn: () => fetchClients(filters), staleTime: 5 * 60_000 })
  const [cat, setCat] = useState<string | null>(null)

  const ranking = useMemo(() => {
    const rows = cl.data?.clients ?? []
    const agg = (f: (c: (typeof rows)[number]) => boolean) => rows.filter(f).reduce((a, c) => ({ n: a.n + 1, v: a.v + c.loss_monthly }), { n: 0, v: 0 })
    const sleeping = agg(c => c.status === 'sleeping')
    const declining = agg(c => c.status === 'declining')
    const lostRecent = agg(c => c.status === 'lost' && c.days_since <= 180)
    const oneTime = agg(c => c.status === 'one_time')
    const cross = (op.data?.cross_sell ?? []).reduce((a, x) => ({ n: a.n + 1, v: a.v + x.potential_monthly }), { n: 0, v: 0 })
    return [
      { key: 'sleeping', title: 'Вернуть к обычному ритму заказов', desc: 'Клиенты пропустили ожидаемый заказ — звонок сегодня обычно возвращает заказ сразу.', ...sleeping },
      { key: 'declining', title: 'Остановить снижение объёма', desc: 'Покупают, но меньше, чем 3–6 мес. назад; часть категорий выпала.', ...declining },
      { key: 'cross', title: 'Кросс-продажи категорий', desc: 'Категории, которые берут похожие клиенты того же канала, а этот — нет.', ...cross },
      { key: 'lost', title: 'Вернуть недавно ушедших (до 180 дн.)', desc: 'Клиенты с историей регулярных покупок, переставшие заказывать.', ...lostRecent },
      { key: 'one_time', title: 'Довести разовых до повторного заказа', desc: 'Сделали один заказ и не вернулись.', ...oneTime },
    ].sort((a, b) => b.v - a.v)
  }, [cl.data, op.data])

  if (op.isLoading || cl.isLoading) return <LoadingBox minHeight={300} label="Ищу точки роста…" />
  if (op.error) return <ErrorBox error={op.error} onRetry={() => op.refetch()} />
  if (cl.error) return <ErrorBox error={cl.error} onRetry={() => cl.refetch()} />
  const d = op.data!
  const max = Math.max(1, ...ranking.map(r => r.v))
  const list = cat ? d.cross_sell.filter(x => x.category === cat) : d.cross_sell
  const catMax = Math.max(1, ...d.by_category.map(c => c.potential_monthly))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <Card title="Рейтинг возможностей роста" hint="Потенциал — оценка ежемесячной выручки по фактической истории клиентов; это ориентир для приоритизации, а не прогноз">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {ranking.map((r, i) => (
            <div key={r.key} style={{ display: 'grid', gridTemplateColumns: '28px minmax(0,1fr) auto', gap: 10, alignItems: 'center' }}>
              <div style={{ width: 28, height: 28, borderRadius: 14, background: i === 0 ? 'var(--primary)' : 'var(--bg3)', color: i === 0 ? '#fff' : 'var(--t2)', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13 }}>{i + 1}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--t)' }}>{r.title} <span style={{ color: 'var(--t3)', fontWeight: 600 }}>· {r.n} кл.</span></div>
                <div style={{ fontSize: 12, color: 'var(--t2)', margin: '2px 0 5px' }}>{r.desc}</div>
                <Bar value={r.v} max={max} />
              </div>
              <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--primary2)', whiteSpace: 'nowrap' }}>+{moneyShort(r.v)}<span style={{ fontSize: 11, color: 'var(--t3)' }}>/мес</span></div>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0,1fr)' : 'minmax(0,1fr) minmax(0,2fr)', gap: 14 }}>
        <Card title="Категории для допродажи" pad={12} hint="Сумма потенциала кросс-продаж по категории. Нажмите, чтобы отфильтровать клиентов.">
          {d.by_category.length === 0 ? <div style={{ fontSize: 13, color: 'var(--t3)' }}>Подходящих категорий не найдено.</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {d.by_category.map(c => (
                <button key={c.category} onClick={() => setCat(x => (x === c.category ? null : c.category))}
                  style={{ textAlign: 'left', background: cat === c.category ? 'var(--fl)' : 'none', border: '1px solid ' + (cat === c.category ? 'var(--primary)' : 'transparent'), borderRadius: 10, padding: '6px 8px', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--t)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, marginBottom: 4 }}>
                    <b>{c.category}</b><span style={{ whiteSpace: 'nowrap' }}>{num(c.clients)} кл. · <b style={{ color: 'var(--primary2)' }}>+{moneyShort(c.potential_monthly)}</b></span>
                  </div>
                  <Bar value={c.potential_monthly} max={catMax} />
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card pad={12} title={`Кому предложить${cat ? `: ${cat}` : ''} · ${list.length}`}
          right={<button disabled={!list.length} onClick={() => downloadCsv(`кросс-продажи_${d.asof}.csv`,
            ['Клиент', 'Канал', 'Менеджер', 'Категория', 'Проникновение в канале, %', 'Оборот клиента в мес.', 'Потенциал в мес.'],
            list.map(x => [x.name, x.channel, x.manager_name, x.category, x.penetration_pct, x.client_monthly, x.potential_monthly]))}
            style={{ padding: '6px 10px', borderRadius: 10, border: '1px solid var(--bd2)', background: 'var(--bg3)', color: 'var(--t)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Выгрузить CSV</button>}>
          {list.length === 0 ? <div style={{ fontSize: 13, color: 'var(--t3)' }}>Нет кандидатов.</div> : (
            <TableWrap maxHeight={560}>
              <thead><tr>
                <th style={th}>Клиент</th><th style={th}>Предложить</th><th style={thNum}>Берут в канале</th>
                <th style={thNum}>Оборот/мес</th><th style={thNum}>Потенциал/мес</th>
              </tr></thead>
              <tbody>
                {list.slice(0, 200).map(x => (
                  <tr key={x.client_ref + x.category} onClick={() => onClient(x.client_ref, x.name)} style={{ cursor: 'pointer' }}>
                    <td style={{ ...td, maxWidth: 220 }}>
                      <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--t3)' }}>{x.manager_name ?? '—'} · {x.channel}</div>
                    </td>
                    <td style={td}>{x.category}</td>
                    <td style={tdNum}>{x.penetration_pct}%<div style={{ fontSize: 11, color: 'var(--t3)' }}>{x.buyers} из {x.channel_clients}</div></td>
                    <td style={tdNum}>{moneyShort(x.client_monthly)}</td>
                    <td style={{ ...tdNum, fontWeight: 700, color: 'var(--primary2)' }}>+{moneyShort(x.potential_monthly)}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      </div>

      <Notice>{d.method}</Notice>
    </div>
  )
}
