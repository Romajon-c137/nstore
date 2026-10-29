'use client'

import { ORDER_STATUS_MAP } from '@/entities/order'
import { supabase } from '@/shared/lib/supabase'
import { BarChart,Card,Metric,Text } from '@/shared/ui/charts'
import { InfoDot } from '@/shared/ui/ui'
import { Location,OrderRow,Profile,deliveryView,fmt,fmtShort } from '@/views/cabinet/ui/shared'
import { useQuery } from '@tanstack/react-query'

export default function OverviewTab({ profile }: { profile: Profile | null }) {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const monthNames = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

  const { data: orders = [] } = useQuery<OrderRow[]>({
    queryKey: ['cabinet-orders', profile?.id],
    queryFn: async () => {
      if (!profile?.id) return []
      const { data } = await supabase.from('crm_tasks').select('id, title, order_status, delivery_state, total, items, client_name, address, created_at').eq('task_type', 'order').or(`client_id.eq.${profile.id},manager_id.eq.${profile.id}`).order('created_at', { ascending: false }).limit(50)
      return (data ?? []) as OrderRow[]
    },
    enabled: !!profile?.id, staleTime: 30_000,
  })

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ['cabinet-locations', profile?.company_id],
    queryFn: async () => {
      if (!profile?.company_id) return []
      const { data } = await supabase.from('locations').select('*').eq('company_id', profile.company_id)
      return (data ?? []) as Location[]
    },
    enabled: !!profile?.company_id, staleTime: 60_000,
  })

  type BalanceData = { available: boolean; balance: number | null; currency: string }
  const { data: balanceData, isLoading: balanceLoading } = useQuery<BalanceData | null>({
    queryKey: ['cabinet-balance', profile?.company_id],
    queryFn: async () => {
      if (!profile?.company_id) return null
      const { data, error } = await supabase.functions.invoke('get-company-balance')
      if (error) return null
      return data as BalanceData
    },
    enabled: !!profile?.company_id, staleTime: 300_000,
  })

  const monthOrders = orders.filter(o => o.created_at >= monthStart)
  const monthTotal = monthOrders.reduce((s, o) => s + (o.total ?? 0), 0)
  const inProgress = orders.filter(o => o.order_status && !['done', 'cancelled'].includes(o.order_status)).length
  const delivering = orders.filter(o => o.order_status === 'delivering').length
  const avgOrder = orders.length > 0 ? Math.round(orders.reduce((s, o) => s + (o.total ?? 0), 0) / orders.length) : 0

  const bars = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    const start = d.toISOString()
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString()
    const total = orders.filter(o => o.created_at >= start && o.created_at < end).reduce((s, o) => s + (o.total ?? 0), 0)
    return { month: monthNames[d.getMonth()], 'Закупки': total }
  })


  return (
    <div style={{ padding: '28px 32px 48px', overflowY: 'auto', height: '100%', background: '#F6F8F7' }} className="cab-ov-pad">
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: '#0E1E16' }}>Обзор закупок</div>
        <div style={{ fontSize: 13, color: '#7A877F', marginTop: 3 }}>{monthNames[now.getMonth()]} {now.getFullYear()} · сводка</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }} className="cab-kpi4">
        {[{ label: 'Закупки за месяц', value: fmt(monthTotal), sub: `${monthOrders.length} заказов`, subColor: 'var(--primary)', hint: 'Сумма всех ваших заказов за текущий календарный месяц. Показывает, сколько закуплено с 1-го числа.' }, { label: 'Активные точки', value: String(locations.length), sub: 'торговых точек', subColor: '#8A968E', hint: 'Количество ваших торговых точек (магазинов/складов), привязанных к компании и получающих поставки.' }, { label: 'Заказов в работе', value: String(inProgress), sub: delivering > 0 ? `${delivering} в доставке` : 'обрабатываются', subColor: delivering > 0 ? '#7C3AED' : '#8A968E', hint: 'Заказы, которые ещё не выполнены и не отменены: обрабатываются, собираются или едут к вам. В скобках — сколько уже в доставке.' }, { label: 'Средний чек', value: fmtShort(avgOrder), sub: 'за все время', subColor: '#8A968E', hint: 'Средняя сумма одного заказа за всё время (общая сумма ÷ число заказов). Ориентир типичного размера закупки.' }].map((card, i) => (
          <Card key={i} className="!rounded-2xl !p-[18px]">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Text>{card.label}</Text>
              <InfoDot hint={card.hint} />
            </div>
            <Metric className="mt-1 font-display !text-xl">{card.value}</Metric>
            <p className="mt-1 text-xs font-semibold" style={{ color: card.subColor }}>{card.sub}</p>
          </Card>
        ))}
      </div>
      <div style={{ marginBottom: 20 }}>
        <Card className="!rounded-2xl">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#0E1E16' }}>Динамика закупок</span>
            <InfoDot hint="Сумма ваших закупок помесячно за последние 6 месяцев. Помогает увидеть тренд: растут закупки или снижаются." />
          </div>
          <BarChart
            data={bars}
            index="month"
            categories={['Закупки']}
            colors={['emerald']}
            valueFormatter={fmtShort}
            showLegend={false}
            yAxisWidth={56}
            className="mt-2 h-40"
          />
        </Card>
      </div>
      {locations.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #EDF1EF', borderRadius: 16, overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #EDF1EF' }}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontSize: 14, fontWeight: 700, color: '#0E1E16' }}>Мои точки</span><InfoDot hint="Ваши торговые точки, на которые оформляются поставки. Здесь — название, телефон и статус каждой точки." /></div></div>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', fontSize: 11, fontWeight: 700, color: '#8A968E', padding: '10px 20px', borderBottom: '1px solid #F2F5F3', minWidth: 480, textTransform: 'uppercase', letterSpacing: '.4px' }}><span>Точка</span><span>Телефон</span><span>Статус</span></div>
            {locations.map(loc => (
              <div key={loc.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', alignItems: 'center', fontSize: 13, padding: '13px 20px', borderBottom: '1px solid #F4F7F5', minWidth: 480 }}>
                <div><div style={{ fontWeight: 600, color: '#0E1E16' }}>{loc.name}</div>{loc.address && <div style={{ fontSize: 11, color: '#8A968E', marginTop: 2 }}>{loc.address}</div>}</div>
                <span style={{ color: '#5C6B63' }}>{loc.phone ?? '—'}</span>
                <span style={{ background: '#EAF6EE', color: 'var(--primary)', borderRadius: 7, padding: '3px 9px', fontSize: 11, fontWeight: 700, width: 'fit-content' }}>Активна</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {orders.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #EDF1EF', borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #EDF1EF' }}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontSize: 14, fontWeight: 700, color: '#0E1E16' }}>Последние заказы</span><InfoDot hint="5 ваших самых свежих заказов с суммой, датой и текущим статусом доставки. Полный список — на вкладке «Заказы»." /></div></div>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', fontSize: 11, fontWeight: 700, color: '#8A968E', padding: '10px 20px', borderBottom: '1px solid #F2F5F3', minWidth: 540, textTransform: 'uppercase', letterSpacing: '.4px' }}><span>Заказ</span><span>Сумма</span><span>Дата</span><span>Статус</span></div>
            {orders.slice(0, 5).map(o => { const st = deliveryView(o, ORDER_STATUS_MAP); return (
              <div key={o.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', alignItems: 'center', fontSize: 13, padding: '12px 20px', borderBottom: '1px solid #F4F7F5', minWidth: 540 }}>
                <span style={{ fontWeight: 600, color: '#0E1E16', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.client_name ?? o.title}</span>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12, color: 'var(--primary)' }}>{fmtShort(o.total)}</span>
                <span style={{ color: '#5C6B63', fontSize: 12 }}>{new Date(o.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}</span>
                {st ? <span style={{ background: st.bg, color: st.fg, borderRadius: 7, padding: '3px 9px', fontSize: 11, fontWeight: 700, width: 'fit-content' }}>{st.label}</span> : <span>—</span>}
              </div>
            )})}
          </div>
        </div>
      )}
      {profile?.company_id && (() => {
        const b = balanceData
        let label: string
        let labelColor: string
        let sub: string

        if (balanceLoading || !b) {
          label = 'Загрузка...'
          labelColor = '#8A968E'
          sub = ''
        } else if (!b.available) {
          label = 'Данные из 1С будут подключены'
          labelColor = '#8A968E'
          sub = 'Обратитесь к менеджеру для уточнения'
        } else if (b.balance === null) {
          label = 'Нет данных в 1С'
          labelColor = '#8A968E'
          sub = 'Контрагент не найден в реестре взаиморасчётов'
        } else if (b.balance > 0) {
          label = `Задолженность: ${b.balance.toLocaleString('ru-RU')} ₸`
          labelColor = '#D97706'
          sub = 'Сумма текущей задолженности перед поставщиком'
        } else if (b.balance < 0) {
          label = `Переплата: ${Math.abs(b.balance).toLocaleString('ru-RU')} ₸`
          labelColor = 'var(--primary)'
          sub = 'Сумма зачтена в счёт следующих поставок'
        } else {
          label = 'Задолженности нет'
          labelColor = 'var(--primary)'
          sub = 'Все взаиморасчёты закрыты'
        }

        return (
          <div style={{ background: '#fff', border: '1px solid #EDF1EF', borderRadius: 16, padding: '18px 20px', marginTop: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0E1E16', marginBottom: 12 }}>Баланс / задолженность</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: '#F4F7F5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 10h14M10 3l7 7-7 7" stroke="#8A968E" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: labelColor }}>{label}</div>
                {sub && <div style={{ fontSize: 12, color: '#8A968E', marginTop: 2 }}>{sub}</div>}
              </div>
            </div>
          </div>
        )
      })()}
      {orders.length === 0 && locations.length === 0 && (
        <div style={{ textAlign: 'center', paddingTop: 60, color: '#8A968E' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1A2A21', marginBottom: 4 }}>Нет данных</div>
          <div style={{ fontSize: 13 }}>Оформите первый заказ, чтобы увидеть аналитику</div>
        </div>
      )}
    </div>
  )
}
