'use client'

/* Клиенты и риски: кто уходит, кто давно не покупал, кто снижает объём, кому звонить сегодня. */
import { LoadingBox } from '@/shared/ui/ui'
import { fetchClients,salesKeys,STATUS_META,type ClientRow,type ClientStatus,type Filters } from '@/views/crm/sales/api'
import { Card,dateRu,downloadCsv,ErrorBox,money,moneyShort,Notice,num,StatusPill,TableWrap,td,tdNum,th,thNum } from '@/views/crm/sales/ui'
import { SearchInput,Segmented,useIsMobile } from '@/views/crm/shared/crmui'
import { useQuery } from '@tanstack/react-query'
import { useMemo,useState } from 'react'

type Mode = 'call' | 'risk' | 'long' | 'declining' | 'lost' | 'all'
type Sort = 'priority' | 'loss' | 'days' | 'rev'

const MODES: { value: Mode; label: string }[] = [
  { value: 'call', label: 'Позвонить сегодня' },
  { value: 'risk', label: 'Все в риске' },
  { value: 'long', label: 'Давно не покупали' },
  { value: 'declining', label: 'Падают' },
  { value: 'lost', label: 'Потерянные' },
  { value: 'all', label: 'Все клиенты' },
]

function pick(rows: ClientRow[], mode: Mode): ClientRow[] {
  switch (mode) {
    case 'call': return rows.filter(c => c.priority > 0 && (c.status === 'sleeping' || c.status === 'declining' || (c.status === 'lost' && c.days_since <= 180)))
    case 'risk': return rows.filter(c => ['sleeping', 'declining', 'lost', 'one_time'].includes(c.status))
    case 'long': return rows.filter(c => c.days_since >= 30).sort((a, b) => b.days_since - a.days_since)
    case 'declining': return rows.filter(c => c.status === 'declining')
    case 'lost': return rows.filter(c => c.status === 'lost')
    default: return rows
  }
}

export default function ClientsView({ filters, onClient }: { filters: Filters; onClient: (ref: string, name: string) => void }) {
  const isMobile = useIsMobile()
  const [mode, setMode] = useState<Mode>('call')
  const [sort, setSort] = useState<Sort>('priority')
  const [q, setQ] = useState('')
  const [byManager, setByManager] = useState(false)
  const qr = useQuery({ queryKey: salesKeys.clients(filters), queryFn: () => fetchClients(filters), staleTime: 5 * 60_000 })

  const rows = useMemo(() => {
    let r = pick(qr.data?.clients ?? [], mode)
    if (q.trim()) {
      const s = q.trim().toLowerCase()
      r = r.filter(c => c.name.toLowerCase().includes(s) || c.manager.toLowerCase().includes(s))
    }
    if (mode !== 'long' || sort !== 'priority') {
      const key: Record<Sort, (c: ClientRow) => number> = {
        priority: c => c.priority, loss: c => c.loss_monthly, days: c => c.days_since, rev: c => c.rev_12m,
      }
      r = [...r].sort((a, b) => key[sort](b) - key[sort](a))
    }
    return r
  }, [qr.data, mode, q, sort])

  const groups = useMemo(() => {
    if (!byManager) return null
    const m = new Map<string, ClientRow[]>()
    for (const c of rows) m.set(c.manager, [...(m.get(c.manager) ?? []), c])
    return [...m.entries()].sort((a, b) => b[1].reduce((s, c) => s + c.loss_monthly, 0) - a[1].reduce((s, c) => s + c.loss_monthly, 0))
  }, [rows, byManager])

  if (qr.isLoading) return <LoadingBox minHeight={300} label="Анализирую историю покупок клиентов…" />
  if (qr.error) return <ErrorBox error={qr.error} onRetry={() => qr.refetch()} />
  const d = qr.data!
  const sum = d.summary ?? {}

  const exportCsv = () => downloadCsv(`клиенты_${mode}_${d.asof}.csv`,
    ['Клиент', 'Канал', 'Менеджер', 'Статус', 'Последняя покупка', 'Дней без покупок', 'Обычный интервал, дн.', 'Заказов за 12 мес.',
     'Средний чек', 'Выручка 12 мес.', 'Выручка 90 дн.', 'Выручка пред. 90 дн.', 'Долг', 'Потери в месяц', 'Недополучено', 'Причина', 'Действие'],
    rows.map(c => [c.name, c.channel, c.manager, STATUS_META[c.status].label, c.last_sale, c.days_since, c.median_gap, c.orders_12m,
      c.avg_check, c.rev_12m, c.rev_90, c.rev_prev90, c.debt, c.loss_monthly, c.missed, c.reason, c.action]))

  const statusOrder: ClientStatus[] = ['sleeping', 'declining', 'lost', 'one_time', 'new', 'growing', 'active']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0,1fr))' : 'repeat(7, minmax(0,1fr))', gap: 8 }}>
        {statusOrder.map(s => (
          <div key={s} title={STATUS_META[s].hint} style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 12, padding: '8px 10px', minWidth: 0 }}>
            <StatusPill status={s} />
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4, color: 'var(--t)' }}>{num(sum[s]?.clients ?? 0)}</div>
            <div style={{ fontSize: 11, color: (sum[s]?.loss_monthly ?? 0) > 0 ? 'var(--red)' : 'var(--t3)' }}>
              {(sum[s]?.loss_monthly ?? 0) > 0 ? `−${moneyShort(sum[s]!.loss_monthly)}/мес` : `${moneyShort(sum[s]?.rev_12m ?? 0)} за 12 мес.`}
            </div>
          </div>
        ))}
      </div>

      <Notice>
        Статусы — на сегодня ({dateRu(d.asof)}), выбранный период на них не влияет; фильтры по менеджеру, каналу и категории работают. Считаются по фактической истории заказов каждого клиента: обычный интервал = медиана дней между заказами за 12 мес.,
        потери в месяц = среднемесячная выручка клиента до паузы (для «Снижает объём» — разница между прошлыми и последними 90 днями).
      </Notice>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ overflowX: 'auto', maxWidth: '100%' }}><Segmented options={MODES} value={mode} onChange={setMode} /></div>
        <SearchInput value={q} onChange={setQ} placeholder="Клиент или менеджер…" grow />
        <select value={sort} onChange={e => setSort(e.target.value as Sort)} aria-label="Сортировка"
          style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid var(--bd2)', background: 'var(--bg2)', color: 'var(--t)', fontSize: 13, fontFamily: 'inherit' }}>
          <option value="priority">По приоритету</option>
          <option value="loss">По потерям в месяц</option>
          <option value="days">По дням без покупок</option>
          <option value="rev">По выручке за 12 мес.</option>
        </select>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: 'var(--t2)', cursor: 'pointer' }}>
          <input type="checkbox" checked={byManager} onChange={e => setByManager(e.target.checked)} /> По менеджерам
        </label>
        <button onClick={exportCsv} disabled={!rows.length}
          style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid var(--bd2)', background: 'var(--bg3)', color: 'var(--t)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
          Выгрузить CSV
        </button>
      </div>

      {rows.length === 0 ? (
        <Card><div style={{ fontSize: 13, color: 'var(--t3)' }}>Клиентов по этим условиям нет.</div></Card>
      ) : groups ? (
        groups.map(([mgr, list]) => (
          <Card key={mgr} title={`${mgr} · ${list.length}`} right={<b style={{ color: 'var(--red)', fontSize: 13 }}>−{moneyShort(list.reduce((s, c) => s + c.loss_monthly, 0))}/мес</b>} pad={12}>
            <ClientList rows={list} isMobile={isMobile} onClient={onClient} />
          </Card>
        ))
      ) : (
        <Card pad={12} title={`${MODES.find(m => m.value === mode)!.label} · ${rows.length}`}>
          <ClientList rows={rows} isMobile={isMobile} onClient={onClient} />
        </Card>
      )}
    </div>
  )
}

function ClientList({ rows, isMobile, onClient }: { rows: ClientRow[]; isMobile: boolean; onClient: (ref: string, name: string) => void }) {
  const [limit, setLimit] = useState(60)
  const shown = rows.slice(0, limit)
  const more = rows.length > limit && (
    <button onClick={() => setLimit(l => l + 60)} style={{ marginTop: 8, width: '100%', padding: 8, borderRadius: 10, border: '1px solid var(--bd)', background: 'var(--bg3)', color: 'var(--t2)', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
      Показать ещё ({rows.length - limit})
    </button>
  )

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {shown.map(c => (
          <button key={c.ref} onClick={() => onClient(c.ref, c.name)}
            style={{ textAlign: 'left', background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: 12, padding: 10, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--t)', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</b>
              <StatusPill status={c.status} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--t2)' }}>
              {c.manager} · {c.channel} · последняя покупка {dateRu(c.last_sale)} ({c.days_since} дн.)
            </div>
            {c.reason && <div style={{ fontSize: 12, color: 'var(--t2)' }}>{c.reason}</div>}
            {c.action && <div style={{ fontSize: 12 }}><b>Действие:</b> {c.action}</div>}
            <div style={{ display: 'flex', gap: 12, fontSize: 12, flexWrap: 'wrap' }}>
              {c.loss_monthly > 0 && <b style={{ color: 'var(--red)' }}>−{moneyShort(c.loss_monthly)}/мес</b>}
              <span style={{ color: 'var(--t3)' }}>12 мес.: {moneyShort(c.rev_12m)}</span>
              {c.debt > 0 && <span style={{ color: 'var(--ora)' }}>долг {moneyShort(c.debt)}</span>}
            </div>
          </button>
        ))}
        {more}
      </div>
    )
  }

  return (
    <>
      <TableWrap maxHeight={640}>
        <thead><tr>
          <th style={th}>Клиент</th>
          <th style={th}>Статус</th>
          <th style={thNum}>Посл. покупка</th>
          <th style={thNum}>Интервал / чек</th>
          <th style={thNum}>90 дн. / пред. 90</th>
          <th style={thNum}>Долг</th>
          <th style={thNum}>Потери/мес</th>
          <th style={{ ...th, minWidth: 260 }}>Причина и действие</th>
        </tr></thead>
        <tbody>
          {shown.map(c => (
            <tr key={c.ref} onClick={() => onClient(c.ref, c.name)} style={{ cursor: 'pointer' }}>
              <td style={{ ...td, maxWidth: 220 }}>
                <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.name}>{c.name}</div>
                <div style={{ fontSize: 11, color: 'var(--t3)' }}>{c.manager} · {c.channel}</div>
              </td>
              <td style={td}><StatusPill status={c.status} /></td>
              <td style={tdNum}>{dateRu(c.last_sale)}<div style={{ fontSize: 11, color: c.overdue_days && c.overdue_days > 0 ? 'var(--red)' : 'var(--t3)' }}>{c.days_since} дн.{c.overdue_days && c.overdue_days > 0 ? ` (+${c.overdue_days})` : ''}</div></td>
              <td style={tdNum}>{c.median_gap != null ? `раз в ${Math.round(c.median_gap)} дн.` : '—'}<div style={{ fontSize: 11, color: 'var(--t3)' }}>{money(c.avg_check)}</div></td>
              <td style={tdNum}>{moneyShort(c.rev_90)}<div style={{ fontSize: 11, color: 'var(--t3)' }}>{moneyShort(c.rev_prev90)}</div></td>
              <td style={{ ...tdNum, color: c.debt > 0 ? 'var(--ora)' : 'var(--t3)' }}>{c.debt > 0 ? moneyShort(c.debt) : '—'}</td>
              <td style={{ ...tdNum, color: c.loss_monthly > 0 ? 'var(--red)' : 'var(--t3)', fontWeight: 700 }}>{c.loss_monthly > 0 ? moneyShort(c.loss_monthly) : '—'}</td>
              <td style={{ ...td, fontSize: 12 }}>
                {c.reason && <div style={{ color: 'var(--t2)' }}>{c.reason}</div>}
                {c.action && <div style={{ marginTop: 2 }}>{c.action}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {more}
    </>
  )
}
