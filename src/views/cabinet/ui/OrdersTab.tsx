'use client'

import { ORDER_STATUS_MAP } from '@/entities/order'
import { supabase } from '@/shared/lib/supabase'
import { OrderRow,Profile,deliveryView,fmtShort } from '@/views/cabinet/ui/shared'
import { useQuery } from '@tanstack/react-query'
import { useMemo,useState } from 'react'

export default function OrdersTab({ profile, onRepeatOrder }: { profile: Profile | null; onRepeatOrder: (items: any[]) => void }) {
  const { data: orders = [], isLoading } = useQuery<OrderRow[]>({
    queryKey: ['cabinet-orders', profile?.id],
    queryFn: async () => { if (!profile?.id) return []; const { data, error } = await supabase.from('crm_tasks').select('id, title, order_status, delivery_state, total, items, client_name, address, created_at').eq('task_type', 'order').or(`client_id.eq.${profile.id},manager_id.eq.${profile.id}`).order('created_at', { ascending: false }).limit(50); if (error) throw error; return (data ?? []) as OrderRow[] },
    enabled: !!profile?.id, staleTime: 30_000,
  })
  const [expanded, setExpanded] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Статусы, реально встречающиеся среди заказов клиента — только их показываем в фильтре
  const availableStatuses = useMemo(() => {
    const present = new Set(orders.map(o => o.order_status ?? '').filter(s => ORDER_STATUS_MAP[s]))
    return Object.keys(ORDER_STATUS_MAP).filter(s => present.has(s))
  }, [orders])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return orders.filter(o => {
      if (statusFilter !== 'all' && (o.order_status ?? '') !== statusFilter) return false
      if (!q) return true
      const inHead = `${o.client_name ?? ''} ${o.title ?? ''}`.toLowerCase().includes(q)
      const inItems = Array.isArray(o.items) && o.items.some((it: any) => `${it.name ?? ''} ${it.sku ?? ''}`.toLowerCase().includes(q))
      return inHead || inItems
    })
  }, [orders, query, statusFilter])

  const chip = (id: string, label: string) => {
    const active = statusFilter === id
    return (
      <button key={id} onClick={() => setStatusFilter(id)}
        style={{ padding: '6px 13px', borderRadius: 20, border: active ? '1px solid var(--primary)' : '1px solid #EDF1EF', background: active ? 'var(--primary)' : '#fff', color: active ? '#fff' : '#5C6B63', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap', flexShrink: 0 }}>
        {label}
      </button>
    )
  }

  return (
    <div style={{ padding: '28px 32px', overflowY: 'auto', height: '100%', background: '#F6F8F7' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: '#0E1E16', marginBottom: 20 }}>История заказов</div>
      {!isLoading && orders.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#A6B0A9', fontSize: 15, pointerEvents: 'none' }}>🔍</span>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Поиск по номеру заказа или товару"
              style={{ width: '100%', boxSizing: 'border-box', padding: '11px 38px 11px 40px', borderRadius: 12, border: '1px solid #EDF1EF', background: '#fff', fontSize: 14, color: '#1A2A21', outline: 'none', fontFamily: 'inherit' }}
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Очистить"
                style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 22, height: 22, borderRadius: 11, border: 'none', background: '#F2F5F3', color: '#8A968E', cursor: 'pointer', fontSize: 13, lineHeight: 1 }}>×</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
            {chip('all', 'Все')}
            {availableStatuses.map(s => chip(s, ORDER_STATUS_MAP[s].label))}
          </div>
        </div>
      )}
      {isLoading ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{Array.from({ length: 4 }).map((_, i) => <div key={i} style={{ height: 72, borderRadius: 14, background: '#F2F5F3', animation: 'pulse 1.4s ease-in-out infinite' }} />)}</div>
        : orders.length === 0 ? <div style={{ textAlign: 'center', paddingTop: 60, color: '#8A968E' }}><div style={{ fontSize: 40, marginBottom: 12 }}>📋</div><div style={{ fontSize: 15, fontWeight: 700, color: '#1A2A21', marginBottom: 4 }}>Заказов нет</div><div style={{ fontSize: 13 }}>Оформите заказ в каталоге</div></div>
        : filtered.length === 0 ? <div style={{ textAlign: 'center', paddingTop: 40, color: '#8A968E' }}><div style={{ fontSize: 15, fontWeight: 700, color: '#1A2A21', marginBottom: 4 }}>Ничего не найдено</div><div style={{ fontSize: 13 }}>Измените запрос или сбросьте фильтр</div></div>
        : filtered.map(o => { const st = deliveryView(o, ORDER_STATUS_MAP); const open = expanded === o.id; const hasItems = o.items && Array.isArray(o.items) && o.items.length > 0; return (
          <div key={o.id} style={{ background: '#fff', borderRadius: 16, marginBottom: 10, border: '1px solid #EDF1EF', overflow: 'hidden' }}>
            <div onClick={() => setExpanded(open ? null : o.id)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px', cursor: 'pointer' }}>
              <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 700, color: '#0E1E16', marginBottom: 3 }}>{o.client_name ?? o.title}</div><div style={{ fontSize: 12, color: '#8A968E' }}>{new Date(o.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })}</div></div>
              <div style={{ textAlign: 'right' }}><div style={{ fontSize: 15, fontWeight: 800, color: 'var(--primary)', marginBottom: 4 }}>{fmtShort(o.total)}</div>{st && <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: st.bg, color: st.fg }}>{st.label}</span>}</div>
              <span style={{ color: '#A6B0A9', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
            </div>
            {open && hasItems && (
              <div style={{ borderTop: '1px solid #EDF1EF', padding: '12px 20px 16px' }}>
                {o.items.map((it: any, i: number) => (
                  <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, padding: '5px 0', borderBottom: i < o.items.length - 1 ? '1px solid #F4F7F5' : 'none' }}>
                    <span style={{ flex: 1, color: '#1A2A21' }}>{it.name}</span>
                    <span style={{ color: '#8A968E' }}>{it.qty} шт</span>
                    <span style={{ fontWeight: 700, color: '#0E1E16' }}>{((it.price ?? 0) * (it.qty ?? 1)).toLocaleString('ru-RU')} ₸</span>
                  </div>
                ))}
                <button
                  onClick={e => { e.stopPropagation(); onRepeatOrder(o.items) }}
                  style={{ width: '100%', marginTop: 12, padding: '11px 0', borderRadius: 11, border: 'none', background: 'var(--primary)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  ↻ Повторить заказ
                </button>
              </div>
            )}
          </div>
        )})}
    </div>
  )
}
