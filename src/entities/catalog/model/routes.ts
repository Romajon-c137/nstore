import { productSlug } from '@/shared/lib/seo'
import type { CatalogProduct } from './types'
export const productHref = (product: CatalogProduct) => `/product/${encodeURIComponent(productSlug(product))}`
export function findProduct(products: CatalogProduct[], slug: string) {
  return products.find(product => productSlug(product) === slug || product.id === slug)
}
