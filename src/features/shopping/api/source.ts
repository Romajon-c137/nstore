/* ───────────────────────────────────────────────────────────────────────────
   Источник каталога. Компоненты получают данные только через CatalogSource,
   поэтому подключение 1С / внешнего API = новый адаптер здесь, без правок UI.

   Выбор адаптера: VITE_CATALOG_SOURCE = 'django' | 'supabase' (временно по умолчанию) | 'demo'.
   'demo' — фикстура для дизайн-ревью без доступа к БД; в прод-бандл
   не попадает, пока не выбрана (динамический import).
   ─────────────────────────────────────────────────────────────────────────── */

import { GUEST_PRICING,normalizeProduct,type CatalogProduct,type PastOrder,type PricingContext,type RawProduct } from '@/entities/catalog'
import { placeOrder,type PlaceOrderArgs,type PlaceOrderResult } from '@/entities/order'
import { djangoSource } from '@/features/shopping/api/djangoSource'
import { supabase } from '@/shared/lib/supabase'

export interface Customer {
  id: string
  name: string | null
  company: string | null
  phone: string | null
  email?: string | null
  companyId: string | null
  isClient: boolean
}

export interface CatalogSource {
  /** Временное правило источника; null означает отсутствие утверждённого минимума. */
  minimumOrderTotal: number | null
  /** Активные товары с ценой, разрешённой текущему покупателю/компании. */
  products(customer: Customer | null): Promise<CatalogProduct[]>
  /** Текущий пользователь (null — гость). */
  customer(): Promise<Customer | null>
  pricing(customer: Customer): Promise<PricingContext>
  orders(customer: Customer): Promise<PastOrder[]>
  /** Точки доставки клиента. */
  locations(customer: Customer): Promise<DeliveryPoint[]>
  placeOrder(args: PlaceOrderArgs): Promise<PlaceOrderResult>
}

export interface DeliveryPoint { id: string; name: string; address: string | null }

/* ── Supabase (таблица products ← sync_1c_products.py из 1С) ────────────── */

const BASE_FIELDS = 'id, sku, name, vol, price, box_qty, section_name, description, image_url, stock, reserved_qty, sort_priority'
const B2B_FIELDS = `${BASE_FIELDS}, price_tp, price_top`
const PAGE = 1000 // PostgREST отдаёт максимум 1000 строк за запрос

const supabaseSource: CatalogSource = {
  minimumOrderTotal: 30_000,
  async products(customer) {
    const withB2BPrices = !!customer?.isClient
    const rows: RawProduct[] = []
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('products')
        .select(withB2BPrices ? B2B_FIELDS : BASE_FIELDS)
        .eq('is_active', true)
        .order('name')
        .range(from, from + PAGE - 1)
      if (error) throw error
      rows.push(...((data ?? []) as unknown as RawProduct[]))
      if (!data || data.length < PAGE) break
    }
    return rows.map(normalizeProduct)
  },

  async customer() {
    const { data: { session } } = await supabase.auth.getSession()
    const uid = session?.user?.id
    if (!uid) return null
    const { data } = await supabase.from('profiles')
      .select('id, name, company, phone, company_id, role').eq('id', uid).maybeSingle()
    if (!data) return null
    return {
      id: data.id, name: data.name, company: data.company, phone: data.phone,
      companyId: data.company_id, isClient: (data.role ?? 'client') === 'client',
    }
  },

  async pricing(c) {
    if (!c.isClient) return GUEST_PRICING
    const [{ data: contract }, { data: discounts }] = await Promise.all([
      supabase.from('contracts').select('price_list, discount_pct').eq('user_id', c.id).maybeSingle(),
      supabase.from('discounts').select('section_id, discount').eq('user_id', c.id),
    ])
    return {
      customerId: c.id,
      // Розница (офис, сайт) по умолчанию; ТП / Топ — только если прайс указан в договоре
      priceList: contract?.price_list === 'price_top' ? 'top' : contract?.price_list === 'price_tp' ? 'wholesale' : 'base',
      contractDiscountPct: Number(contract?.discount_pct) || 0,
      sectionDiscounts: Object.fromEntries((discounts ?? []).map(d => [d.section_id, Number(d.discount) || 0])),
      personalPrices: {},
    }
  },

  async orders(c) {
    const { data, error } = await supabase.from('crm_tasks')
      .select('id, items, total, order_status, created_at')
      .eq('task_type', 'order').eq('client_id', c.id)
      .order('created_at', { ascending: false }).limit(30)
    if (error) throw error
    return (data ?? []).map(o => ({
      id: o.id, createdAt: o.created_at, total: o.total, status: o.order_status,
      lines: (Array.isArray(o.items) ? o.items : []).map((it: Record<string, unknown>) => ({
        productId: typeof it.id === 'string' ? it.id : null,
        sku: typeof it.sku === 'string' ? it.sku : null,
        name: String(it.name ?? 'Товар'),
        qty: Number(it.qty) || 1,
      })),
    }))
  },

  async locations(c) {
    if (!c.companyId) return []
    const { data } = await supabase.from('locations').select('id, name, address').eq('company_id', c.companyId)
    return (data ?? []) as DeliveryPoint[]
  },

  placeOrder,
}

let cached: Promise<CatalogSource> | null = null

export function getSource(): Promise<CatalogSource> {
  if (!cached) {
    const source = process.env.NEXT_PUBLIC_CATALOG_SOURCE
    cached = source === 'demo'
      ? import('@/features/shopping/api/demoSource').then(m => m.demoSource)
      : source === 'django'
        ? Promise.resolve(djangoSource)
        : Promise.resolve(supabaseSource)
  }
  return cached
}
