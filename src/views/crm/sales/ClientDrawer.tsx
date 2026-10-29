'use client'

/* Карточка клиента: помесячная выручка, категории (что выпало), последние заказы, долг. */
import { LoadingBox } from '@/shared/ui/ui'
import { fetchClientDetail,salesKeys } from '@/views/crm/sales/api'
import { Bar,ErrorBox,TableWrap,dateRu,money,moneyShort,monthRu,td,tdNum,th,thNum } from '@/views/crm/sales/ui'
import { useIsMobile } from '@/views/crm/shared/crmui'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'

export default function ClientDrawer({ client, onClose, onFilter }: {
  client: { ref: string; name: string }
  onClose: () => void
  onFilter: (ref: string, name: string) => void
}) {
  const isMobile = useIsMobile()
  const q = useQuery({ queryKey: salesKeys.client(client.ref), queryFn: () => fetchClientDetail(client.ref), staleTime: 5 * 60_000 })
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  const d = q.data
  const max = Math.max(1, ...(d?.months ?? []).map(m => m.revenue))

  return createPortal(
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
      <aside onClick={e => e.stopPropagation()} role="dialog" aria-label={client.name}
        style={{ width: isMobile ? '100%' : 560, maxWidth: '100%', height: '100%', background: 'var(--bg)', overflowY: 'auto', padding: 16, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--t)' }}>{client.name}</h2>
            {d?.client && (
              <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>
                {d.client.channel}{d.client.bin ? ` · БИН/ИИН ${d.client.bin}` : ''}{d.client.phone ? ' · ' : ''}
                {d.client.phone && <a href={`tel:${d.client.phone}`} style={{ color: 'var(--primary2)' }}>{d.client.phone}</a>}
              </div>
            )}
          </div>
          <button onClick={onClose} aria-label="Закрыть" style={{ border: 'none', background: 'var(--bg3)', borderRadius: 10, width: 34, height: 34, cursor: 'pointer', fontSize: 18, color: 'var(--t2)' }}>×</button>
        </div>
        <button onClick={() => onFilter(client.ref, client.name)}
          style={{ alignSelf: 'flex-start', padding: '6px 10px', borderRadius: 10, border: '1px solid var(--primary)', background: 'var(--fl)', color: 'var(--primary2)', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
          Показать аналитику только по этому клиенту
        </button>

        {q.isLoading ? <LoadingBox minHeight={240} /> : q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : d && (
          <>
            {d.debt && (d.debt.debt > 0 || d.debt.advance > 0) && (
              <div style={{ display: 'flex', gap: 16, fontSize: 13, background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 12, padding: 10 }}>
                {d.debt.debt > 0 && <span>Долг клиента: <b style={{ color: 'var(--ora)' }}>{money(d.debt.debt)}</b></span>}
                {d.debt.advance > 0 && <span>Аванс: <b>{money(d.debt.advance)}</b></span>}
              </div>
            )}

            <section style={box}>
              <div style={h}>Выручка по месяцам (24 мес.)</div>
              {d.months.length === 0 ? <div style={{ fontSize: 13, color: 'var(--t3)' }}>Нет продаж.</div> : (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120 }}>
                  {d.months.map(m => (
                    <div key={m.month} title={`${monthRu(m.month)}: ${money(m.revenue)}, заказов ${m.orders}`}
                      style={{ flex: 1, minWidth: 6, height: `${Math.max(2, (Math.max(0, m.revenue) / max) * 100)}%`, background: 'var(--primary)', borderRadius: 3 }} />
                  ))}
                </div>
              )}
              {d.months.length > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--t3)', marginTop: 4 }}><span>{monthRu(d.months[0].month)}</span><span>{monthRu(d.months[d.months.length - 1].month)}</span></div>}
            </section>

            <section style={box}>
              <div style={h}>Категории: последние 90 дн. против предыдущих 90</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {d.categories.map(c => {
                  const dropped = c.rev_prev90 > 0 && c.rev_90 <= 0
                  return (
                    <div key={c.category}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, gap: 8 }}>
                        <span style={{ fontWeight: 600, color: dropped ? 'var(--red)' : 'var(--t)' }}>{c.category}{dropped ? ' · перестал брать' : ''}</span>
                        <span style={{ whiteSpace: 'nowrap', color: 'var(--t2)' }}>{moneyShort(c.rev_90)} / {moneyShort(c.rev_prev90)}</span>
                      </div>
                      <Bar value={c.rev_12m} max={Math.max(1, ...d.categories.map(x => x.rev_12m))} color={dropped ? 'var(--red)' : 'var(--primary)'} />
                    </div>
                  )
                })}
                {d.categories.length === 0 && <div style={{ fontSize: 13, color: 'var(--t3)' }}>Нет покупок за 12 мес.</div>}
              </div>
            </section>

            <section style={box}>
              <div style={h}>Последние заказы</div>
              <TableWrap>
                <thead><tr><th style={th}>Дата</th><th style={thNum}>Сумма</th><th style={thNum}>Строк</th><th style={th}>Менеджер</th></tr></thead>
                <tbody>
                  {d.orders.map((o, i) => (
                    <tr key={i}><td style={td}>{dateRu(o.day)}</td><td style={tdNum}>{money(o.amount)}</td><td style={tdNum}>{o.lines}</td><td style={td}>{o.manager}</td></tr>
                  ))}
                </tbody>
              </TableWrap>
            </section>
          </>
        )}
      </aside>
    </div>,
    document.body,
  )
}

const box: React.CSSProperties = { background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 14, padding: 12 }
const h: React.CSSProperties = { fontSize: 12, fontWeight: 800, color: 'var(--t2)', textTransform: 'uppercase', marginBottom: 8 }
