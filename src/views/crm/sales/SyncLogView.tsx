'use client'

/* Журнал синхронизации 1С → аналитика и сверка месяцев с оборотами регистра «Продажи». */
import { LoadingBox } from '@/shared/ui/ui'
import { useCRM } from '@/views/crm/context/CRMContext'
import { fetchSyncLog,salesKeys,syncNow,type Meta } from '@/views/crm/sales/api'
import { Card,ErrorBox,Notice,TableWrap,money,monthRu,td,tdNum,th,thNum } from '@/views/crm/sales/ui'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'

const RUN_STATUS: Record<string, { label: string; color: string }> = {
  ok: { label: 'Успешно', color: 'var(--primary2)' },
  partial: { label: 'Частично', color: 'var(--ora)' },
  error: { label: 'Ошибка', color: 'var(--red)' },
  running: { label: 'Выполняется', color: 'var(--blue)' },
}
const MONTH_STATUS: Record<string, { label: string; color: string }> = {
  ok: { label: 'Сходится с 1С', color: 'var(--primary2)' },
  mismatch: { label: 'Расхождение', color: 'var(--red)' },
  unchecked: { label: 'Не сверено', color: 'var(--ora)' },
  error: { label: 'Ошибка', color: 'var(--red)' },
}
const dt = (s: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')

export default function SyncLogView({ meta, isAdmin }: { meta: Meta; isAdmin: boolean }) {
  const qc = useQueryClient()
  const { toast } = useCRM()
  const log = useQuery({ queryKey: salesKeys.syncLog(), queryFn: fetchSyncLog, refetchInterval: 30_000 })
  const run = useMutation({
    mutationFn: syncNow,
    onSuccess: () => { toast('Синхронизация запущена, обновится через 1–2 мин'); setTimeout(() => qc.invalidateQueries({ queryKey: salesKeys.all }), 90_000) },
    onError: (e: Error) => toast(e.message, 3500),
  })

  if (log.isLoading) return <LoadingBox minHeight={240} />
  if (log.error) return <ErrorBox error={log.error} onRetry={() => log.refetch()} />
  const d = log.data!
  const synced = d.months.filter(m => m.synced_at)
  const totalRows = synced.reduce((s, m) => s + (m.rows ?? 0), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <Card title="Как работает синхронизация" right={isAdmin && (
        <button onClick={() => run.mutate()} disabled={run.isPending}
          style={{ padding: '7px 12px', borderRadius: 10, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
          {run.isPending ? 'Запускаю…' : 'Синхронизировать сейчас'}
        </button>)}>
        <div style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.55 }}>
          Каждые 30 минут функция читает из 1С (OData, только GET) движения регистра «Продажи» за текущий и прошлый месяц, а также по очереди перепроверяет
          два самых давно сверенных месяца истории. Каждый месяц после загрузки сверяется с оборотами регистра в 1С. Справочники (контрагенты, сотрудники,
          номенклатура) и долги покупателей обновляются при каждом запуске. Из аналитики исключены: группы {meta.excluded?.groups?.join(', ') || '—'};
          контрагенты с названием, содержащим {meta.excluded?.name_patterns?.join(', ') || '—'}.
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10, fontSize: 13 }}>
          <span>Загружено месяцев: <b>{synced.length}</b></span>
          <span>Строк продаж: <b>{totalRows.toLocaleString('ru-RU')}</b></span>
          <span>Долги обновлены: <b>{dt(meta.sync.debts_at)}</b></span>
        </div>
      </Card>

      {meta.sync.months_open.length > 0 && (
        <Notice tone="warn">
          Без «Закрытия месяца» в 1С (себестоимость предварительная): {meta.sync.months_open.map(monthRu).join(', ')}.
        </Notice>
      )}

      <Card title="Сверка по месяцам" pad={12} hint="Сумма загруженных строк против оборотов регистра «Продажи» в 1С за тот же месяц. Допуск — 1 ₸.">
        <TableWrap maxHeight={420}>
          <thead><tr>
            <th style={th}>Месяц</th><th style={thNum}>Строк</th><th style={thNum}>Загружено</th><th style={thNum}>В 1С</th>
            <th style={thNum}>Разница</th><th style={th}>Закрыт</th><th style={th}>Статус</th><th style={th}>Обновлён</th>
          </tr></thead>
          <tbody>
            {d.months.map(m => {
              const st = MONTH_STATUS[m.status ?? ''] ?? { label: m.status ?? '—', color: 'var(--t3)' }
              return (
                <tr key={m.month}>
                  <td style={td}>{monthRu(m.month)}</td>
                  <td style={tdNum}>{m.rows?.toLocaleString('ru-RU') ?? '—'}</td>
                  <td style={tdNum}>{money(m.amount)}</td>
                  <td style={tdNum}>{money(m.onec_amount)}</td>
                  <td style={{ ...tdNum, color: m.diff ? 'var(--red)' : 'var(--t3)' }}>{m.diff == null ? '—' : money(m.diff)}</td>
                  <td style={td}>{m.closed == null ? '—' : m.closed ? 'да' : <span style={{ color: 'var(--ora)' }}>нет</span>}</td>
                  <td style={{ ...td, color: st.color, fontWeight: 700 }} title={m.error ?? undefined}>{st.label}</td>
                  <td style={td}>{dt(m.synced_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </TableWrap>
      </Card>

      <Card title="Журнал запусков" pad={12}>
        <TableWrap maxHeight={420}>
          <thead><tr><th style={th}>Начало</th><th style={th}>Статус</th><th style={th}>Месяцы</th><th style={thNum}>Время</th><th style={th}>Ошибка</th></tr></thead>
          <tbody>
            {d.runs.map(r => {
              const st = RUN_STATUS[r.status] ?? { label: r.status, color: 'var(--t3)' }
              return (
                <tr key={r.id}>
                  <td style={td}>{dt(r.started_at)}<div style={{ fontSize: 11, color: 'var(--t3)' }}>{r.mode === 'manual' ? 'вручную' : 'по расписанию'}</div></td>
                  <td style={{ ...td, color: st.color, fontWeight: 700 }}>{st.label}</td>
                  <td style={{ ...td, fontSize: 12 }}>
                    {(r.months ?? []).map(m => `${monthRu(m.month)}: ${m.rows} стр.${m.status === 'ok' ? '' : ` (${MONTH_STATUS[m.status]?.label ?? m.status})`}`).join('; ') || '—'}
                    {r.skipped?.length ? <div style={{ color: 'var(--ora)' }}>Отложено: {r.skipped.map(monthRu).join(', ')}</div> : null}
                  </td>
                  <td style={tdNum}>{r.ms ? `${Math.round(r.ms / 1000)} с` : '—'}</td>
                  <td style={{ ...td, fontSize: 12, color: 'var(--red)', maxWidth: 360, wordBreak: 'break-word' }}>{r.error ?? ''}</td>
                </tr>
              )
            })}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  )
}
