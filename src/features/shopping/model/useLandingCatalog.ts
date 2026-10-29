'use client'
import type { CatalogProduct } from '@/entities/catalog'
import { type DbProduct } from '@/entities/content'
import { useMemo } from 'react'
import { useCart,useShopData } from './hooks'

export function toLandingProduct(product: CatalogProduct): DbProduct {
  return { id: product.id, sku: product.sku, name: product.name, vol: product.package, price: product.price,
    box_qty: product.step, section_name: product.subcategory, description: product.description, image_url: product.image,
    is_active: true, stock: product.stock, reserved_qty: 0, sort_priority: product.priority }
}
export function useLandingCatalog() {
  const data = useShopData()
  const products = useMemo(() => data.products.map(toLandingProduct), [data.products])
  const shoppingCart = useCart(data.customer?.id ?? null, data.byId, data.pricing)
  const cart = shoppingCart.lines.map(line => ({ product: { ...toLandingProduct(line.product), price: line.unitPrice }, qty: line.qty }))
  return { ...data, products, cart,
    addToCart(product: DbProduct) { const item = data.byId.get(product.id); if (item) shoppingCart.inc(item) },
    removeFromCart(id: string) { const item = data.byId.get(id); if (item) shoppingCart.dec(item) },
  }
}
