'use client'

/* ══════════════════════════════════════════════════════════════════
   CRM · Аналитика продаж (данные 1С через OData → Supabase analytics.*)
   Оболочка: фильтры, состояние синхронизации, вкладки.
   Части — в src/pages/crm/sales/.
   ══════════════════════════════════════════════════════════════════ */
import { useUrlQuery } from '@/shared/lib/navigation'
import { LoadingBox } from '@/shared/ui/ui'
import { fetchMeta,salesKeys,type Filters } from '@/views/crm/sales/api'
import ClientDrawer from '@/views/crm/sales/ClientDrawer'
import { ErrorBox,MultiSelect,Notice } from '@/views/crm/sales/ui'
import { Segmented,useIsMobile } from '@/views/crm/shared/crmui'
import { useQuery } from '@tanstack/react-query'
import { lazy,Suspense,useMemo,useState } from 'react'

const OverviewView      = lazy(() => import('@/views/crm/sales/OverviewView'))
const ClientsView       = lazy(() => import('@/views/crm/sales/ClientsView'))
const OpportunitiesView = lazy(() => import('@/views/crm/sales/OpportunitiesView'))
const ForecastPlanView  = lazy(() => import('@/views/crm/sales/ForecastPlanView'))
const SyncLogView       = lazy(() => import('@/views/crm/sales/SyncLogView'))
const ChainsView        = lazy(() => import('@/views/crm/sales/ChainsView'))

type View = 'overview' | 'clients' | 'chains' | 'growth' | 'forecast' | 'sync'
type Preset = 'mtd' | 'prev_month' | 'd30' | 'd90' | 'ytd' | 'y1' | 'custom'

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function presetRange(p: Preset): { from: string; to: string } {
  const t = new Date()
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate())
  switch (p) {
    case 'mtd': return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) }
    case 'prev_month': return {
      from: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      to: iso(new Date(today.getFullYear(), today.getMonth(), 0)),
    }
    case 'd30': return { from: iso(new Date(today.getTime() - 29 * 864e5)), to: iso(today) }
    case 'd90': return { from: iso(new Date(today.getTime() - 89 * 864e5)), to: iso(today) }
    case 'ytd': return { from: iso(new Date(today.getFullYear(), 0, 1)), to: iso(today) }
    case 'y1':
    default: return { from: iso(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate() + 1)), to: iso(today) }
  }
}

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'mtd', label: 'Этот месяц' },
  { value: 'prev_month', label: 'Прошлый месяц' },
  { value: 'd30', label: '30 дн.' },
  { value: 'd90', label: '90 дн.' },
  { value: 'ytd', label: 'С начала года' },
  { value: 'y1', label: '12 мес.' },
]

const dateInput: React.CSSProperties = {
  padding: '6px 8px', borderRadius: 10, border: '1px solid var(--bd2)', background: 'var(--bg2)',
  color: 'var(--t)', fontSize: 13, fontFamily: 'inherit', minWidth: 0,
}

/* Основная область CRM не прокручивается (overflow: hidden) — у каждой вкладки свой скролл-контейнер. */
function Scroll({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', background: 'var(--bg)' }}>
      {children}
    </div>
  )
}

function minutesAgo(s: string | null | undefined) {
  if (!s) return null
  return Math.round((Date.now() - new Date(s).getTime()) / 60000)
}

export default function SalesTab() {
  const isMobile = useIsMobile()
  const [sp, setSp] = useUrlQuery()
  const view = (sp.get('v') as View) || 'overview'
  const setView = (v: View) => { const n = new URLSearchParams(sp); n.set('v', v); setSp(n, { replace: true }) }

  const [preset, setPreset] = useState<Preset>('mtd')
  const [range, setRange] = useState(() => presetRange('mtd'))
  const [managers, setManagers] = useState<string[]>([])
  const [channels, setChannels] = useState<string[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [client, setClient] = useState<Filters['client']>(null)
  const [drawer, setDrawer] = useState<{ ref: string; name: string } | null>(null)

  const filters: Filters = useMemo(
    () => ({ from: range.from, to: range.to, managers, channels, categories, client }),
    [range, managers, channels, categories, client])

  const meta = useQuery({ queryKey: salesKeys.meta(), queryFn: fetchMeta, staleTime: 5 * 60_000 })

  const pickPreset = (p: Preset) => { setPreset(p); if (p !== 'custom') setRange(presetRange(p)) }
  const openClient = (ref: string, name: string) => setDrawer({ ref, name })
  const filterClient = (ref: string, name: string) => { setClient({ ref, name }); setDrawer(null) }

  if (meta.isLoading) return <Scroll><LoadingBox minHeight={320} label="Загружаю аналитику продаж…" /></Scroll>
  if (meta.error) return <Scroll><div style={{ padding: 16 }}><ErrorBox error={meta.error} onRetry={() => meta.refetch()} /></div></Scroll>

  const m = meta.data!
  const lastOk = minutesAgo(m.sync.last_ok_at)
  const stale = lastOk == null || lastOk > 90
  const noData = !m.data_to

  const managerOpts = m.managers.map(x => ({ value: x.ref, label: x.name }))
  const channelOpts = m.channels.map(x => ({ value: x, label: x }))
  const categoryOpts = m.categories.map(x => ({ value: x, label: x }))
  const hasFilters = managers.length + channels.length + categories.length > 0 || !!client

  return (
    <Scroll>
    <div style={{ padding: isMobile ? '12px 12px calc(96px + env(safe-area-inset-bottom, 0px))' : '20px 24px 40px', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      {/* ── Заголовок + свежесть данных ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: isMobile ? 20 : 24, fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--t)' }}>Аналитика продаж</h1>
          <div style={{ fontSize: 12, color: 'var(--t3)', marginTop: 2 }}>
            Источник: 1С УНФ (регистр «Продажи»), только чтение · история с {m.data_from ? new Date(m.data_from).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }) : '—'}
          </div>
        </div>
        <button onClick={() => setView('sync')} title="Журнал синхронизации"
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit',
            border: '1px solid var(--bd2)', background: 'var(--bg2)', fontSize: 12, fontWeight: 700,
            color: stale || m.sync.months_mismatch.length ? 'var(--red)' : 'var(--t2)',
          }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: stale || m.sync.months_mismatch.length ? 'var(--red)' : 'var(--primary)' }} />
          {lastOk == null ? 'Синхронизации ещё не было' : lastOk < 60 ? `Данные 1С: ${lastOk} мин назад` : `Данные 1С: ${Math.round(lastOk / 60)} ч назад`}
          {m.sync.months_mismatch.length > 0 && ` · расхождений: ${m.sync.months_mismatch.length}`}
        </button>
      </div>

      {noData && (
        <Notice tone="warn">
          Данные из 1С ещё не загружены. Первая загрузка истории идёт по месяцам автоматически каждые 30 минут — состояние на вкладке «Синхронизация».
        </Notice>
      )}

      {/* ── Фильтры ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        <div style={{ overflowX: 'auto', margin: '0 -4px', padding: '0 4px' }}>
          <Segmented options={[...PRESETS, { value: 'custom' as Preset, label: 'Период…' }]} value={preset} onChange={pickPreset} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0,1fr) minmax(0,1fr)' : 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8 }}>
          {preset === 'custom' && (
            <>
              <input type="date" value={range.from} max={range.to} onChange={e => e.target.value && setRange(r => ({ ...r, from: e.target.value }))} style={dateInput} aria-label="С" />
              <input type="date" value={range.to} min={range.from} onChange={e => e.target.value && setRange(r => ({ ...r, to: e.target.value }))} style={dateInput} aria-label="По" />
            </>
          )}
          <MultiSelect label="Менеджер" options={managerOpts} value={managers} onChange={setManagers} />
          <MultiSelect label="Канал" options={channelOpts} value={channels} onChange={setChannels} />
          <MultiSelect label="Категория" options={categoryOpts} value={categories} onChange={setCategories} />
          {client && (
            <button onClick={() => setClient(null)} title="Снять фильтр по клиенту"
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', padding: '6px 10px', borderRadius: 10, border: '1px solid var(--primary)', background: 'var(--fl)', cursor: 'pointer', fontFamily: 'inherit', minWidth: 0 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase' }}>Клиент ×</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{client.name}</span>
            </button>
          )}
          {hasFilters && (
            <button onClick={() => { setManagers([]); setChannels([]); setCategories([]); setClient(null) }}
              style={{ padding: '6px 10px', borderRadius: 10, border: '1px solid var(--bd)', background: 'var(--bg3)', color: 'var(--t2)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              Сбросить фильтры
            </button>
          )}
        </div>
      </div>

      {/* ── Вкладки ── */}
      <div style={{ overflowX: 'auto', margin: '0 -4px', padding: '0 4px' }}>
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            { value: 'overview', label: 'Обзор' },
            { value: 'clients', label: 'Клиенты и риски' },
            { value: 'chains', label: 'Сети' },
            { value: 'growth', label: 'Точки роста' },
            { value: 'forecast', label: 'Прогноз и план' },
            { value: 'sync', label: 'Синхронизация' },
          ]}
        />
      </div>

      <Suspense fallback={<LoadingBox minHeight={240} />}>
        {view === 'overview' && <OverviewView filters={filters} onClient={openClient} onGo={setView} />}
        {view === 'clients' && <ClientsView filters={filters} onClient={openClient} />}
        {view === 'chains' && <ChainsView filters={filters} onClient={openClient} />}
        {view === 'growth' && <OpportunitiesView filters={filters} onClient={openClient} />}
        {view === 'forecast' && <ForecastPlanView filters={filters} isAdmin={m.is_admin} managers={m.managers} />}
        {view === 'sync' && <SyncLogView meta={m} isAdmin={m.is_admin} />}
      </Suspense>

      {drawer && <ClientDrawer client={drawer} onClose={() => setDrawer(null)} onFilter={filterClient} />}
    </div>
    </Scroll>
  )
}
