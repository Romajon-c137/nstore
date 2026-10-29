/* Регулярные закупки: что клиент заказывает часто, что покупал недавно,
   и как собрать прошлый заказ заново по актуальным ценам и остаткам. */

import type { CatalogProduct,PastOrder,PastOrderLine } from '@/entities/catalog/model/types';

export interface Usual { product: CatalogProduct; qty: number; times: number; lastAt: string }

function resolveLine(l: PastOrderLine, byId: Map<string, CatalogProduct>, bySku: Map<string, CatalogProduct>) {
  return (l.productId && byId.get(l.productId)) || (l.sku && bySku.get(l.sku)) || null
}

function skuIndex(byId: Map<string, CatalogProduct>) {
  const m = new Map<string, CatalogProduct>()
  for (const p of byId.values()) if (p.sku) m.set(p.sku, p)
  return m
}

/** Товары из истории: times — в скольких заказах встречался, qty — последнее количество. */
export function purchaseStats(orders: PastOrder[], byId: Map<string, CatalogProduct>): Usual[] {
  const bySku = skuIndex(byId)
  const stats = new Map<string, Usual>()
  for (const o of orders) { // orders отсортированы от новых к старым
    for (const l of o.lines) {
      const product = resolveLine(l, byId, bySku)
      if (!product) continue
      const s = stats.get(product.id)
      if (s) s.times += 1
      else stats.set(product.id, { product, qty: l.qty, times: 1, lastAt: o.createdAt })
    }
  }
  return [...stats.values()]
}

export const frequent = (stats: Usual[]) =>
  stats.filter(s => s.times >= 2).sort((a, b) => b.times - a.times || b.lastAt.localeCompare(a.lastAt))

export const recent = (stats: Usual[]) => [...stats].sort((a, b) => b.lastAt.localeCompare(a.lastAt))

/** Позиции заказа, которые можно добавить сейчас (товар есть в каталоге). */
export function reorderItems(order: PastOrder, byId: Map<string, CatalogProduct>) {
  const bySku = skuIndex(byId)
  const items: { product: CatalogProduct; qty: number }[] = []
  let missing = 0
  for (const l of order.lines) {
    const product = resolveLine(l, byId, bySku)
    if (product) items.push({ product, qty: l.qty }); else missing += 1
  }
  return { items, missing }
}
