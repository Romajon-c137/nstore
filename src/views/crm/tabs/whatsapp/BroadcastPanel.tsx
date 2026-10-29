'use client'

import { supabase } from '@/shared/lib/supabase'
import { Button,Spinner } from '@/shared/ui/ui'
import { useCRM } from '@/views/crm/context/CRMContext'
import { inputStyle,labelStyle } from '@/views/crm/shared/crmui'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { useMemo,useState } from 'react'

// ─── Constants ────────────────────────────────────────────────────────────────

const SEGMENTS = [
  { value: '', label: 'Все сегменты' },
  { value: 'horeca', label: 'HoReCa' },
  { value: 'office', label: 'Офис' },
  { value: 'wholesale', label: 'Опт' },
  { value: 'pharmacy', label: 'Аптека' },
  { value: 'shop', label: 'Магазин' },
  { value: 'autosalon', label: 'Автосалон' },
]

const FILTER_DAYS = [
  { value: '', label: 'Все контакты' },
  { value: '7', label: '7 дней' },
  { value: '14', label: '14 дней' },
  { value: '30', label: '30 дней' },
  { value: '60', label: '60 дней' },
]

const STATUS_LABELS: Record<string, { label: string; bg: string; fg: string }> = {
  running: { label: 'Выполняется', bg: '#FFF8E1', fg: '#F57C00' },
  done:    { label: 'Завершена',   bg: '#E8F5E9', fg: '#2E7D32' },
  failed:  { label: 'Ошибка',      bg: '#FFEBEE', fg: '#C62828' },
}

interface Broadcast {
  id: string
  segment: string | null
  filter_days: number | null
  message: string
  recipients_count: number
  sent_count: number
  failed_count: number
  status: string
  created_at: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BroadcastPanel() {
  const qc = useQueryClient()
  const { toast, profile } = useCRM()
  const canSend = profile?.role === 'admin' || profile?.role === 'manager'

  const [segment, setSegment] = useState('')
  const [filterDays, setFilterDays] = useState('')
  const [message, setMessage] = useState('')

  // Предпросмотр — сколько контактов получат рассылку с текущими фильтрами
  const { data: recipientsCount, isFetching: countLoading } = useQuery({
    queryKey: ['wa-broadcast-preview', segment, filterDays],
    queryFn: async () => {
      let q = supabase
        .from('contacts')
        .select(segment ? 'id, companies!inner(market_segment)' : 'id', { count: 'exact', head: true })
        .not('phone', 'is', null)

      if (segment) q = q.eq('companies.market_segment', segment)
      if (filterDays) {
        const cutoff = new Date(Date.now() - Number(filterDays) * 86400000).toISOString()
        q = q.or(`last_contacted_at.is.null,last_contacted_at.lt.${cutoff}`)
      }

      const { count, error } = await q
      if (error) throw error
      return count ?? 0
    },
    staleTime: 15_000,
  })

  // История рассылок
  const { data: history = [], isLoading: historyLoading } = useQuery<Broadcast[]>({
    queryKey: ['wa-broadcasts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wa_broadcasts')
        .select('id, segment, filter_days, message, recipients_count, sent_count, failed_count, status, created_at')
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return (data ?? []) as Broadcast[]
    },
    staleTime: 15_000,
    refetchInterval: 15_000,
  })

  const sendMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('broadcast-whatsapp', {
        body: {
          segment: segment || null,
          filter_days: filterDays ? Number(filterDays) : null,
          message: message.trim(),
        },
      })
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      setMessage('')
      qc.invalidateQueries({ queryKey: ['wa-broadcasts'] })
      toast(`Рассылка отправлена: ${data?.sent_count ?? 0} из ${data?.recipients_count ?? 0}`)
    },
    onError: (e: any) => toast(e.message ?? 'Ошибка отправки рассылки'),
  })

  const segmentLabel = useMemo(() => SEGMENTS.find(s => s.value === segment)?.label ?? 'Все сегменты', [segment])

  const handleSend = () => {
    const text = message.trim()
    if (!text || sendMut.isPending) return
    const confirmed = window.confirm(
      `Отправить сообщение ${recipientsCount ?? 0} контактам (${segmentLabel})?`
    )
    if (!confirmed) return
    sendMut.mutate()
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── Форма рассылки ── */}
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 14, padding: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--t)', marginBottom: 14 }}>Новая рассылка</div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={labelStyle}>Сегмент</label>
              <select value={segment} onChange={e => setSegment(e.target.value)} style={inputStyle}>
                {SEGMENTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={labelStyle}>Не писали</label>
              <select value={filterDays} onChange={e => setFilterDays(e.target.value)} style={inputStyle}>
                {FILTER_DAYS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Текст сообщения</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Введите текст рассылки…"
              rows={5}
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, color: 'var(--t2)', display: 'flex', alignItems: 'center', gap: 6 }}>
              {countLoading ? <Spinner size={14} /> : (
                <>Получат сообщение: <strong style={{ color: 'var(--t)' }}>{recipientsCount ?? 0}</strong> контактов</>
              )}
            </div>
            {canSend ? (
              <Button
                onClick={handleSend}
                disabled={!message.trim() || sendMut.isPending || !recipientsCount}
                loading={sendMut.isPending}
              >
                Отправить рассылку
              </Button>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--t3)' }}>Только просмотр — отправка недоступна</span>
            )}
          </div>
        </div>

        {/* ── История рассылок ── */}
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--t)', marginBottom: 10 }}>История рассылок</div>

          {historyLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
              <Spinner size={20} />
            </div>
          ) : history.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--t3)', fontSize: 13, padding: '24px 0' }}>Рассылок пока не было</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {history.map(b => {
                const st = STATUS_LABELS[b.status] ?? STATUS_LABELS.done
                const segLabel = b.segment ? (SEGMENTS.find(s => s.value === b.segment)?.label ?? b.segment) : 'Все сегменты'
                return (
                  <div key={b.id} style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 12, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: st.bg, color: st.fg }}>
                        {st.label}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--t2)', fontWeight: 600 }}>{segLabel}</span>
                      {b.filter_days != null && (
                        <span style={{ fontSize: 11, color: 'var(--t3)' }}>· не писали {b.filter_days} дн.</span>
                      )}
                      <span style={{ fontSize: 11, color: 'var(--t3)', marginLeft: 'auto' }}>
                        {new Date(b.created_at).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--t)', marginBottom: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {b.message}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--t3)' }}>
                      Отправлено {b.sent_count} из {b.recipients_count}
                      {b.failed_count > 0 && <span style={{ color: '#C62828' }}> · {b.failed_count} ошибок</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
