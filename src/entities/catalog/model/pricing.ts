/* Коммерческая логика цен. Один вход — resolvePrice — для карточки, страницы
   товара, корзины и оформления. Порядок приоритета:
   персональная цена → прайс-лист договора (опт/топ) → скидка договора
   → скидка на раздел → оптовая ступень по количеству → базовая цена. */

import type { CatalogProduct,PricingContext,ResolvedPrice } from '@/entities/catalog/model/types'

export const GUEST_PRICING: PricingContext = {
  customerId: null,
  priceList: 'base',
  contractDiscountPct: 0,
  sectionDiscounts: {},
  personalPrices: {},
}

const pct = (v: number, p: number) => Math.round(v * (1 - p / 100))

export function resolvePrice(p: CatalogProduct, ctx: PricingContext, qty = 1): ResolvedPrice {
  const base = p.price
  const personal = ctx.personalPrices[p.id]
  if (personal != null) return { unitPrice: personal, compareAt: base && base > personal ? base : null, isPersonal: true }

  let price: number | null = base
  let isPersonal = false

  if (ctx.customerId) {
    if (ctx.priceList === 'top' && p.priceLists.top) {
      price = p.priceLists.top; isPersonal = true
    } else {
      price = ctx.priceList === 'wholesale' ? (p.priceLists.wholesale ?? base) : base
      if (price && ctx.contractDiscountPct) { price = pct(price, ctx.contractDiscountPct); isPersonal = true }
      else if (price && p.subcategory && ctx.sectionDiscounts[p.subcategory]) {
        price = pct(price, ctx.sectionDiscounts[p.subcategory]); isPersonal = true
      }
    }
  }

  // Оптовые ступени применяются, только если дают цену ниже уже найденной
  const tier = [...p.priceTiers].sort((a, b) => b.minQty - a.minQty).find(t => qty >= t.minQty)
  if (tier && (price == null || tier.price < price)) price = tier.price

  const compareAt = p.oldPrice && price && p.oldPrice > price
    ? p.oldPrice
    : isPersonal && base && price && base > price ? base : null
  return { unitPrice: price, compareAt, isPersonal }
}

/** Ближайшая к текущему количеству кратная величина (не меньше минимального заказа). */
export function clampQty(p: CatalogProduct, qty: number): number {
  if (qty <= 0) return 0
  const stepped = Math.ceil(qty / p.step) * p.step
  return Math.max(p.minQty, stepped)
}

export const fmtMoney = (n: number | null | undefined) =>
  n == null ? '—' : `${Math.round(n).toLocaleString('ru-RU').replace(/,/g, ' ')} ₸`

export function pluralGoods(n: number) {
  const d = n % 10, dd = n % 100
  if (d === 1 && dd !== 11) return `${n} товар`
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return `${n} товара`
  return `${n} товаров`
}
