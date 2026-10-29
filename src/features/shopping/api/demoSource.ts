/* Демо-источник для дизайн-ревью и локальной разработки без доступа к БД.
   Включается VITE_CATALOG_SOURCE=demo. ?guest=1 — посмотреть каталог гостем.
   Изображения — простые SVG-упаковки, чтобы сетка выглядела как с фото. */

import { type PastOrder } from '@/entities/catalog'
import type { CatalogSource,Customer } from '@/features/shopping/api/source'

import { publicDemoProducts } from '@/entities/catalog'

const params = () => new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)
const products = publicDemoProducts
const byName = (s: string) => products.find(x => x.name.includes(s))!

const CUSTOMER: Customer = { id: 'demo-client', name: 'Айгерим', company: 'Coffee Point', phone: '+7 700 000 00 00', companyId: null, isClient: true }

function order(id: string, daysAgo: number, items: [string, number][]): PastOrder {
  const lines = items.map(([s, qty]) => { const x = byName(s); return { productId: x.id, sku: x.sku, name: x.name, qty } })
  const total = lines.reduce((sum, l) => sum + (products.find(x => x.id === l.productId)!.price ?? 0) * l.qty, 0)
  return { id, createdAt: new Date(Date.now() - daysAgo * 864e5).toISOString(), total, status: daysAgo < 2 ? 'delivering' : 'done', lines }
}

const ORDERS: PastOrder[] = [
  order('o3', 1, [['Toreo', 3], ['2,5% 1 л', 24], ['Professional', 12], ['Карамель', 2], ['Стакан', 1]]),
  order('o2', 8, [['Toreo', 2], ['2,5% 1 л', 24], ['Ваниль', 1], ['Borjomi', 12]]),
  order('o1', 15, [['Toreo', 2], ['Professional', 12], ['Карамель', 1], ['Sencha', 4]]),
]

const wait = <T,>(v: T) => new Promise<T>(r => setTimeout(() => r(v), 250))

export const demoSource: CatalogSource = {
  minimumOrderTotal: 30_000,
  products: () => wait(products),
  customer: () => wait(params().has('client') ? CUSTOMER : null),
  pricing: c => wait({ customerId: c.id, priceList: 'wholesale', contractDiscountPct: 0, sectionDiscounts: {}, personalPrices: {} }),
  orders: () => wait(ORDERS),
  locations: () => wait([
    { id: 'l1', name: 'Coffee Point · Мега', address: 'Астана, Кабанбай батыра, 62' },
    { id: 'l2', name: 'Coffee Point · Хан Шатыр', address: 'Астана, Туран, 37' },
  ]),
  placeOrder: () => new Promise(r => setTimeout(() => r({ ok: true, orderNumber: 'NS-10482' }), 700)),
}
