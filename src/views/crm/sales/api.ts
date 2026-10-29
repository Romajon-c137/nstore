/* ══════════════════════════════════════════════════════════════════
   Аналитика продаж — слой данных.
   Все расчёты на стороне Postgres (RPC sa_* над analytics.*, источник — 1С).
   Здесь только вызовы, типы и ключи кэша.
   ══════════════════════════════════════════════════════════════════ */
import { supabase } from '@/shared/lib/supabase'

export interface Filters {
  from: string            // YYYY-MM-DD
  to: string
  managers: string[]      // Ref сотрудника 1С
  channels: string[]      // группа контрагента верхнего уровня
  categories: string[]    // папка номенклатуры верхнего уровня
  client: { ref: string; name: string } | null
}

const arr = (a: string[]) => (a.length ? a : null)

const isTimeout = (m: string) => /statement timeout|lock timeout|canceling statement/i.test(m)

async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  // Таймаут бывает, пока база пересчитывает витрины (раз в 30 мин, ~30 с) — пробуем ещё дважды с паузой
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await supabase.rpc(fn, args)
    if (!error) return data as T
    if (isTimeout(error.message) && attempt < 2) { await new Promise(r => setTimeout(r, 4000 * (attempt + 1))); continue }
    if (error.message === 'forbidden') throw new Error('Нет доступа к аналитике продаж')
    if (isTimeout(error.message)) throw new Error('база занята обновлением данных из 1С, попробуйте через минуту')
    throw new Error(error.message)
  }
}

/* ── Типы ответов ── */
export interface Meta {
  managers: { ref: string; name: string; revenue_12m: number }[]
  channels: string[]
  categories: string[]
  data_from: string | null
  data_to: string | null
  sync: {
    last_run: { id: number; started_at: string; finished_at: string | null; status: string; error: string | null } | null
    last_ok_at: string | null
    months_total: number
    months_mismatch: string[]
    months_open: string[]
    debts_at: string | null
  }
  excluded: { groups: string[]; name_patterns: string[] }
  is_admin: boolean
}

export interface Kpi {
  revenue: number; revenue_net: number; margin: number; margin_pct: number | null
  sales: number; returns: number; orders: number; clients: number; avg_check: number | null
}
export interface DimRow { key: string; name: string; revenue: number; prev: number; margin: number; orders: number; clients: number }
export interface Overview {
  period: { from: string; to: string; prev_from: string; prev_to: string; days: number; granularity: 'day' | 'month' }
  kpi: { cur?: Kpi; prev?: Kpi; yoy?: Kpi } | null
  new_clients: number
  series: { t: string; revenue: number; margin: number; orders: number; clients: number; revenue_yoy: number | null }[]
  bridge: {
    prev: number; cur: number
    parts: Partial<Record<'new' | 'returned' | 'growth' | 'decline' | 'lost' | 'flat', { amount: number; clients: number }>>
    top_lost: { ref: string; name: string; prev: number; cur: number }[]
    top_decline: { ref: string; name: string; prev: number; cur: number }[]
  }
  breakdown: Partial<Record<'manager' | 'channel' | 'category' | 'client', DimRow[]>> | null
  cost_preliminary: boolean
}

export type ClientStatus = 'lost' | 'sleeping' | 'one_time' | 'declining' | 'new' | 'growing' | 'active'
export interface ClientRow {
  ref: string; name: string; channel: string; manager_ref: string | null; manager: string
  status: ClientStatus; first_sale: string; last_sale: string; last_order: number | null
  days_since: number; expected_next: string | null; overdue_days: number | null
  orders_total: number; orders_12m: number; orders_90: number; orders_prev90: number
  median_gap: number | null; avg_check: number | null
  rev_12m: number; rev_90: number; rev_prev90: number; margin_12m: number
  debt: number; loss_monthly: number; missed: number; priority: number
  dropped_categories: string[] | null; reason: string | null; action: string | null
}
export interface ClientsData {
  asof: string
  cached: boolean
  summary: Partial<Record<ClientStatus, { clients: number; loss_monthly: number; rev_12m: number }>> | null
  clients: ClientRow[]
}

export interface Opportunities {
  asof: string
  method: string
  cross_sell: {
    client_ref: string; name: string; channel: string; manager_ref: string | null; manager_name: string | null
    client_monthly: number; category: string; penetration_pct: number; buyers: number; channel_clients: number
    potential_monthly: number
  }[]
  by_category: { category: string; clients: number; potential_monthly: number }[]
  penetration: { channel: string; category: string; penetration_pct: number; buyers: number; channel_clients: number }[]
}

export interface ForecastH {
  total: number; rate_per_day: number; seasonal_years: number | null
  by_month: { month: string; amount: number }[]
  seasonal_index: Record<string, number>
}
export interface Forecast {
  asof: string; method: string
  h30: ForecastH; h60: ForecastH; h90: ForecastH
  history: { month: string; revenue: number }[]
  backtest: { asof: string; forecast: number; fact: number; error_pct: number | null }[]
  mape: number | null
}

export interface PlanFact {
  month: string; days_in_month: number; days_elapsed: number
  company: { plan: number | null; plan_managers_sum: number | null; fact: number; prev_same: number; run_rate: number | null } | null
  managers: {
    ref: string; name: string; plan: number | null; fact: number; prev_same: number
    pct: number | null; expected_to_date: number | null; deviation: number | null; run_rate: number | null
  }[]
}

export interface ClientDetail {
  client: { ref: string; name: string; full_name: string | null; phone: string | null; bin: string | null; channel: string } | null
  debt: { debt: number; advance: number; at: string } | null
  months: { month: string; revenue: number; orders: number }[]
  categories: { category: string; rev_90: number; rev_prev90: number; rev_12m: number }[]
  orders: { day: string; amount: number; lines: number; manager: string }[]
}

export interface SyncLog {
  runs: {
    id: number; started_at: string; finished_at: string | null; status: string; mode: string | null; error: string | null
    dims: Record<string, number> | null
    months: { month: string; rows: number; amount: number; status: string; fetched: number; ms: number }[] | null
    skipped: string[] | null; ms: number | null
  }[]
  months: {
    month: string; synced_at: string | null; rows: number | null; amount: number | null; onec_amount: number | null
    diff: number | null; closed: boolean | null; status: string | null; error: string | null
  }[]
}

/* ── Вызовы ── */
export const fetchMeta = () => call<Meta>('sa_meta')

export const fetchOverview = (f: Filters) => call<Overview>('sa_overview', {
  p_from: f.from, p_to: f.to, p_managers: arr(f.managers), p_channels: arr(f.channels),
  p_categories: arr(f.categories), p_client: f.client?.ref ?? null,
})

// Риски и точки роста считаются на сегодня (статус клиента — «как сейчас»); период на них не влияет.
export const fetchClients = (f: Filters) => call<ClientsData>('sa_clients', {
  p_asof: null, p_managers: arr(f.managers), p_channels: arr(f.channels),
  p_categories: arr(f.categories), p_client: f.client?.ref ?? null,
})

export const fetchOpportunities = (f: Filters) => call<Opportunities>('sa_opportunities', {
  p_asof: null, p_managers: arr(f.managers), p_channels: arr(f.channels), p_categories: arr(f.categories),
})

export const fetchProducts = (f: Filters) => call<DimRow[]>('sa_products', {
  p_from: f.from, p_to: f.to, p_managers: arr(f.managers), p_channels: arr(f.channels),
  p_categories: arr(f.categories), p_client: f.client?.ref ?? null,
})

export const fetchForecast = (f: Filters) => call<Forecast>('sa_forecast', {
  p_asof: f.to, p_managers: arr(f.managers), p_channels: arr(f.channels),
  p_categories: arr(f.categories), p_client: f.client?.ref ?? null,
})

export const fetchPlanFact = (month: string) => call<PlanFact>('sa_plan_fact', { p_month: month })
export const setPlan = (month: string, manager: string | null, amount: number) =>
  call<void>('sa_plan_set', { p_month: month, p_manager: manager, p_amount: amount })

export const fetchClientDetail = (ref: string) => call<ClientDetail>('sa_client_detail', { p_client: ref })
export const fetchSyncLog = () => call<SyncLog>('sa_sync_log')
export const syncNow = () => call<number>('sa_sync_now')

/* ── Ключи кэша ── */
export const salesKeys = {
  all: ['sales-analytics'] as const,
  meta: () => [...salesKeys.all, 'meta'] as const,
  overview: (f: Filters) => [...salesKeys.all, 'overview', f] as const,
  clients: (f: Filters) => [...salesKeys.all, 'clients', f.managers, f.channels, f.categories, f.client?.ref ?? null] as const,
  opportunities: (f: Filters) => [...salesKeys.all, 'opps', f.managers, f.channels, f.categories] as const,
  products: (f: Filters) => [...salesKeys.all, 'products', f] as const,
  forecast: (f: Filters) => [...salesKeys.all, 'forecast', f] as const,
  planFact: (m: string) => [...salesKeys.all, 'plan', m] as const,
  client: (ref: string) => [...salesKeys.all, 'client', ref] as const,
  syncLog: () => [...salesKeys.all, 'sync'] as const,
}

/* ── Статусы клиентов: подписи и цвета ── */
export const STATUS_META: Record<ClientStatus, { label: string; fg: string; bg: string; hint: string }> = {
  sleeping:  { label: 'Пропустил заказ', fg: '#B25E00', bg: 'rgba(217,119,6,.12)',
               hint: 'Пауза дольше 1,5 обычных интервалов между заказами' },
  declining: { label: 'Снижает объём',   fg: '#C2410C', bg: 'rgba(234,88,12,.12)',
               hint: 'Выручка за 90 дн. на 30%+ ниже прошлых 90 дн. или заказов стало меньше' },
  lost:      { label: 'Потерян',         fg: '#DC2626', bg: 'rgba(220,38,38,.12)',
               hint: 'Нет покупок дольше 3 обычных интервалов (не меньше 90 дн.)' },
  one_time:  { label: 'Разовый',         fg: '#7C3AED', bg: 'rgba(124,58,237,.10)',
               hint: 'Один заказ и нет повторного больше 45 дн.' },
  new:       { label: 'Новый',           fg: '#2563EB', bg: 'rgba(37,99,235,.10)',  hint: 'Первая покупка за последние 60 дн.' },
  growing:   { label: 'Растёт',          fg: '#0E7C46', bg: 'rgba(16,163,91,.12)',  hint: 'Выручка за 90 дн. на 30%+ выше прошлых 90 дн.' },
  active:    { label: 'Стабилен',        fg: 'var(--t2)', bg: 'var(--bg3)',        hint: 'Покупает в обычном ритме' },
}
export const RISK_STATUSES: ClientStatus[] = ['sleeping', 'declining', 'lost', 'one_time']

/* ── Сети клиентов (несколько контрагентов = одна сеть) ── */
export interface ChainRow {
  id: number; name: string; pattern: string | null
  points: number; active: number; active_prev: number; lost: number
  rev: number; rev_prev: number; orders: number; last_day: string | null
}
export interface ChainsResp { from: string; to: string; prev_from: string; prev_to: string; items: ChainRow[]; is_admin: boolean }
export type PointStatus = 'active' | 'sleeping' | 'lost' | 'never'
export interface ChainPoint {
  ref: string; name: string; bin: string | null; phone: string | null; manager: string | null; source: 'manual' | 'pattern'
  rev: number; rev_prev: number; orders: number; last_day: string | null; first_day: string | null; status: PointStatus
}
export interface ChainDetail {
  chain: { id: number; name: string; pattern: string | null; note: string | null }
  points: ChainPoint[]
  months: { month: string; rev: number; points: number }[]
  products: { name: string; category: string | null; qty: number; rev: number; points: number }[]
  categories: { name: string; rev: number; points: number }[]
}
export interface ChainCandidate { ref: string; name: string; bin: string | null; phone: string | null; in_chain: string | null; excluded: boolean | null; rev: number | null; why: 'search' | 'same_phone' }

export const fetchChains = (from: string, to: string) => call<ChainsResp>('sa_chains', { p_from: from, p_to: to })
export const fetchChainDetail = (id: number, from: string, to: string) => call<ChainDetail>('sa_chain_detail', { p_chain: id, p_from: from, p_to: to })
export const fetchChainSuggest = (id: number, q: string | null) => call<ChainCandidate[]>('sa_chain_suggest', { p_chain: id, p_q: q })
export const saveChain = (id: number | null, name: string, pattern: string | null) => call<{ id: number; added: number }>('sa_chain_save', { p_id: id, p_name: name, p_pattern: pattern })
export const setChainMembers = (id: number, refs: string[], on: boolean) => call<{ changed: number }>('sa_chain_members', { p_chain: id, p_refs: refs, p_on: on })
export interface ChainsSync { pending: number; errors: number; last_error: string | null; last_push: string | null; last_run: { status: string; stats: Record<string, unknown>; error: string | null; finished_at: string } | null }
export const fetchChainsSync = () => call<ChainsSync>('sa_chains_sync', {})
export const chainKeys = {
  sync: () => [...salesKeys.all, 'chains-sync'] as const,
  list: (from: string, to: string) => [...salesKeys.all, 'chains', from, to] as const,
  detail: (id: number, from: string, to: string) => [...salesKeys.all, 'chain', id, from, to] as const,
}
