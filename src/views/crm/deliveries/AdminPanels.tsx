'use client'

/* Доставки: привязка водителей к 1С (admin) и итоги месяца по экспедиторам (admin/manager). */
import { LoadingBox } from '@/shared/ui/ui'
import { useCRM } from '@/views/crm/context/CRMContext'
import { fetchDrivers,fetchReport,setDriver } from '@/views/crm/deliveries/api'
import { downloadCsv,ErrorBox,money,Notice,TableWrap,td,tdNum,th,thNum } from '@/views/crm/sales/ui'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

const sel: React.CSSProperties = {
  width: '100%', padding: '9px 10px', borderRadius: 10, border: '1px solid var(--bd2)', background: 'var(--bg2)',
  color: 'var(--t)', fontSize: 14, fontFamily: 'inherit', minWidth: 0,
}

export function DriversPanel() {
  const { toast } = useCRM()
  const qc = useQueryClient()
  const q = useQuery({ queryKey: ['dl-drivers'], queryFn: fetchDrivers })
  const save = useMutation({
    mutationFn: (v: { profile: string; driver: string | null; vehicle: string | null }) => setDriver(v.profile, v.driver, v.vehicle),
    onSuccess: () => { toast('Сохранено'); qc.invalidateQueries({ queryKey: ['dl-drivers'] }); qc.invalidateQueries({ queryKey: ['dl-list'] }) },
    onError: e => toast((e as Error).message, 5000),
  })

  if (q.isLoading) return <LoadingBox minHeight={200} />
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />
  const d = q.data!

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Notice>
        Укажите, кем каждый водитель CRM числится в 1С. При «Беру в доставку» в накладной 1С заполняются «Водитель» и «Автомобиль»
        (Подписи и другие реквизиты → Перевозка) — по ним считается месяц. Без привязки водитель не сможет взять накладную.
        Новый водитель регистрируется на сайте, затем во вкладке «Роли» ему ставят роль «Логист» — и он появится здесь.
      </Notice>
      {d.users.length === 0 && <div style={{ color: 'var(--t3)', fontSize: 14 }}>Нет пользователей с ролью «Логист».</div>}
      {d.users.map(u => (
        <div key={u.profile_id} style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 14, padding: 12, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', alignItems: 'end' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, color: 'var(--t)', fontSize: 15 }}>{u.name}</div>
            <div style={{ fontSize: 12, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[u.phone, u.email].filter(Boolean).join(' · ')}</div>
            {!u.driver_ref && <div style={{ fontSize: 12, color: '#DC2626', fontWeight: 700, marginTop: 2 }}>не привязан</div>}
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--t3)', fontWeight: 700 }}>
            Водитель в 1С
            <select style={sel} value={u.driver_ref ?? ''} disabled={save.isPending}
              onChange={e => save.mutate({ profile: u.profile_id, driver: e.target.value || null, vehicle: u.vehicle_ref })}>
              <option value="">— не выбран —</option>
              {d.drivers.map(x => <option key={x.ref} value={x.ref}>{x.name}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--t3)', fontWeight: 700 }}>
            Автомобиль
            <select style={sel} value={u.vehicle_ref ?? ''} disabled={save.isPending}
              onChange={e => save.mutate({ profile: u.profile_id, driver: u.driver_ref, vehicle: e.target.value || null })}>
              <option value="">— не выбран —</option>
              {d.vehicles.map(x => <option key={x.ref} value={x.ref}>{x.name}</option>)}
            </select>
          </label>
        </div>
      ))}
    </div>
  )
}

const monthIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`

export function ReportPanel() {
  const [month, setMonth] = useState(() => monthIso(new Date()))
  const q = useQuery({ queryKey: ['dl-report', month], queryFn: () => fetchReport(month) })
  const rows = q.data ?? []
  const tot = rows.reduce((a, r) => ({ delivered: a.delivered + r.delivered, sum: a.sum + Number(r.delivered_sum), returned: a.returned + r.returned }), { delivered: 0, sum: 0, returned: 0 })
  const shift = (k: number) => { const [y, m] = month.split('-').map(Number); setMonth(monthIso(new Date(y, m - 1 + k, 1))) }
  const label = new Date(month + 'T00:00:00').toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
  const navBtn: React.CSSProperties = { padding: '6px 12px', borderRadius: 10, border: '1px solid var(--bd2)', background: 'var(--bg2)', color: 'var(--t2)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button style={navBtn} onClick={() => shift(-1)}>‹</button>
        <b style={{ color: 'var(--t)', fontSize: 15, minWidth: 130, textAlign: 'center' }}>{label}</b>
        <button style={navBtn} onClick={() => shift(1)}>›</button>
        <span style={{ flex: 1 }} />
        {rows.length > 0 && (
          <button style={navBtn} onClick={() => downloadCsv(`dostavki_${month.slice(0, 7)}.csv`,
            ['Водитель', 'Автомобиль', 'Доставлено', 'Сумма', 'Клиентов', 'Возвраты', 'В пути'],
            rows.map(r => [r.driver, r.vehicle, r.delivered, Number(r.delivered_sum), r.clients, r.returned, r.in_progress]))}>CSV</button>
        )}
      </div>
      {q.isLoading ? <LoadingBox minHeight={160} /> : q.error ? <ErrorBox error={q.error} onRetry={() => q.refetch()} /> : rows.length === 0 ? (
        <div style={{ color: 'var(--t3)', fontSize: 14, padding: '20px 0' }}>За этот месяц доставок через CRM нет.</div>
      ) : (
        <TableWrap>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Водитель (1С)</th><th style={th}>Автомобиль</th><th style={thNum}>Доставлено</th>
              <th style={thNum}>Сумма</th><th style={thNum}>Клиентов</th><th style={thNum}>Возвраты</th><th style={thNum}>В пути</th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.driver}>
                  <td style={td}>{r.driver}</td><td style={td}>{r.vehicle ?? '—'}</td>
                  <td style={tdNum}><b>{r.delivered}</b></td><td style={tdNum}>{money(Number(r.delivered_sum))}</td>
                  <td style={tdNum}>{r.clients}</td><td style={tdNum}>{r.returned}</td><td style={tdNum}>{r.in_progress}</td>
                </tr>
              ))}
              <tr>
                <td style={{ ...td, fontWeight: 800 }}>Итого</td><td style={td} />
                <td style={{ ...tdNum, fontWeight: 800 }}>{tot.delivered}</td><td style={{ ...tdNum, fontWeight: 800 }}>{money(tot.sum)}</td>
                <td style={tdNum} /><td style={{ ...tdNum, fontWeight: 800 }}>{tot.returned}</td><td style={tdNum} />
              </tr>
            </tbody>
          </table>
        </TableWrap>
      )}
      <div style={{ fontSize: 12, color: 'var(--t3)' }}>Месяц — по дате доставки/возврата. Те же данные в 1С: отчёт по расходным накладным с отбором по полю «Водитель».</div>
    </div>
  )
}
