import { GUEST_PRICING,mapDjangoProduct,type DjangoProduct as ApiProduct,type PastOrder,type PricingContext } from '@/entities/catalog'
import { type PlaceOrderArgs,type PlaceOrderResult } from '@/entities/order'
import type { CatalogSource,Customer,DeliveryPoint } from '@/features/shopping/api/source'
import { DjangoApiError,djangoApi,djangoJson } from '@/shared/lib/djangoApi'

interface Page<T> {
  count: number
  next: string | null
  results: T[]
}

interface ApiCompany { id: string; name: string; role: 'owner' | 'buyer' | 'viewer' | null; can_order: boolean }
interface ApiUser {
  id: string
  email: string
  first_name: string
  last_name: string
  phone: string
  companies: ApiCompany[]
}

interface ApiAddress { id: string; label: string; city: string; line: string }
interface ApiOrderLine {
  variant: string | null
  sku: string
  title: string
  quantity: string | number
}
interface ApiOrder {
  id: string
  number: string
  status: string
  total: string | number | null
  created_at: string
  lines: ApiOrderLine[]
}

function decimal(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function allPages<T>(path: string): Promise<T[]> {
  const rows: T[] = []
  let next: string | null = path
  while (next) {
    const page: Page<T> = await djangoApi<Page<T>>(next)
    rows.push(...page.results)
    next = page.next
  }
  return rows
}

function currentCustomer(user: ApiUser): Customer {
  const company = user.companies.find(item => item.can_order)
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email
  return {
    id: user.id,
    name,
    company: company?.name ?? null,
    phone: user.phone || null,
    email: user.email,
    companyId: company?.id ?? null,
    isClient: true,
  }
}

function pricingFor(customer: Customer): PricingContext {
  // Django already resolves the permitted public/B2B price in every variant.
  return { ...GUEST_PRICING, customerId: customer.id }
}

function orderFingerprint(args: PlaceOrderArgs): string {
  const value = JSON.stringify({
    company: args.client.companyId ?? null,
    contact: [args.client.id, args.client.name, args.client.phone],
    address: args.address,
    lines: args.items.map(item => [item.id, item.qty]),
  })
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function uuid(): string {
  return crypto.randomUUID()
}

function checkoutKey(args: PlaceOrderArgs): string {
  const fingerprint = orderFingerprint(args)
  try {
    const saved = JSON.parse(sessionStorage.getItem('nstore-django-checkout') ?? 'null') as { fingerprint?: string; key?: string } | null
    if (saved?.fingerprint === fingerprint && saved.key) return saved.key
    const key = uuid()
    sessionStorage.setItem('nstore-django-checkout', JSON.stringify({ fingerprint, key }))
    return key
  } catch {
    return uuid()
  }
}

function clearCheckoutKey() {
  try { sessionStorage.removeItem('nstore-django-checkout') } catch { /* storage can be unavailable */ }
}

function guestToken(): string {
  const storageKey = 'nstore-django-guest-token'
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved) return saved
    const token = uuid()
    localStorage.setItem(storageKey, token)
    return token
  } catch {
    return uuid()
  }
}

async function placeOrder(args: PlaceOrderArgs): Promise<PlaceOrderResult> {
  const key = checkoutKey(args)
  const order = await djangoJson<ApiOrder>('/api/v1/checkout/', 'POST', {
    company_id: args.client.companyId ?? null,
    contact_name: args.client.name || 'Покупатель',
    contact_phone: args.client.phone || '',
    contact_email: args.client.email || '',
    delivery_method: args.address ? 'delivery' : 'pickup',
    delivery_address: args.address ?? '',
    lines: args.items.map(item => ({ variant_id: item.id, quantity: String(item.qty) })),
  }, {
    'Idempotency-Key': key,
    'X-Guest-Token': guestToken(),
  })
  clearCheckoutKey()
  return { ok: true, orderNumber: order.number || null }
}

export const djangoSource: CatalogSource = {
  // R-06 не закрыт: старый минимум 30 000 ₸ нельзя переносить в Django как правило.
  minimumOrderTotal: null,
  async products(customer) {
    const params = new URLSearchParams({ page_size: '1000' })
    if (customer?.companyId) params.set('company', customer.companyId)
    const products = await allPages<ApiProduct>(`/api/v1/catalog/products/?${params}`)
    return products.flatMap(product => product.variants.map(variant => mapDjangoProduct(product, variant)))
  },

  async customer() {
    try {
      return currentCustomer(await djangoApi<ApiUser>('/api/v1/auth/me/'))
    } catch (error) {
      if (error instanceof DjangoApiError && (error.status === 401 || error.status === 403)) return null
      throw error
    }
  },

  async pricing(customer) {
    return pricingFor(customer)
  },

  async orders() {
    const orders = await allPages<ApiOrder>('/api/v1/orders/?page_size=30')
    return orders.map<PastOrder>(order => ({
      id: order.id,
      createdAt: order.created_at,
      total: decimal(order.total),
      status: order.status,
      lines: order.lines.map(line => ({
        productId: line.variant,
        sku: line.sku || null,
        name: line.title,
        qty: decimal(line.quantity) ?? 0,
      })),
    }))
  },

  async locations() {
    const addresses = await allPages<ApiAddress>('/api/v1/auth/addresses/?page_size=100')
    return addresses.map<DeliveryPoint>(address => ({
      id: address.id,
      name: address.label,
      address: [address.city, address.line].filter(Boolean).join(', ') || null,
    }))
  },

  placeOrder,
}

