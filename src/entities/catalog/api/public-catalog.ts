import { categorySlug } from '@/shared/lib/seo'
import { cache } from 'react'
import 'server-only'
import { mapDjangoProduct,type DjangoProduct } from '../model/django-product'
import { normalizeProduct,type RawProduct } from '../model/normalize'
import { findProduct } from '../model/routes'
import type { CatalogProduct } from '../model/types'

interface DjangoPage<T> { results: T[]; next: string | null }
interface DjangoCategory { name: string; slug: string }

class CatalogApiError extends Error {
  constructor(readonly status: number) {
    super(`Catalog API: ${status}`)
  }
}

function djangoOrigin() {
  return (process.env.DJANGO_API_ORIGIN || 'http://127.0.0.1:8000').replace(/\/$/, '')
}

async function djangoFetch<T>(path: string): Promise<T> {
  const origin = djangoOrigin()
  const url = new URL(path, origin)
  const response = await fetch(`${origin}${url.pathname}${url.search}`, {
    cache: 'no-store', signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new CatalogApiError(response.status)
  return response.json() as Promise<T>
}

async function djangoPages(path: string): Promise<DjangoProduct[]> {
  const products: DjangoProduct[] = []
  let next: string | null = path
  while (next) {
    const page: DjangoPage<DjangoProduct> = await djangoFetch(next)
    products.push(...page.results)
    next = page.next
  }
  return products
}

function mapDjangoProducts(products: DjangoProduct[]) {
  return products.flatMap(product => product.variants.map(variant => mapDjangoProduct(product, variant)))
}

/** Only anonymous public prices may be rendered in HTML. */
export const getPublicProducts = cache(async (): Promise<CatalogProduct[]> => {
  const source = process.env.NEXT_PUBLIC_CATALOG_SOURCE
  if (source === 'demo') {
    const { publicDemoProducts } = await import('./demo-products')
    return publicDemoProducts
  }
  if (source === 'django') {
    return mapDjangoProducts(await djangoPages('/api/v1/catalog/products/?page_size=1000'))
  }
  const origin = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!origin || !key) throw new Error('Настройте источник каталога в .env.local (см. .env.example)')
  const products: CatalogProduct[] = []
  for (let from = 0; ; from += 1000) {
    const fields = 'id,sku,name,vol,price,box_qty,section_name,description,image_url,stock,reserved_qty,sort_priority'
    const response = await fetch(`${origin}/rest/v1/products?select=${fields}&is_active=eq.true&order=name,id&offset=${from}&limit=1000`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store', signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`Catalog API: ${response.status}`)
    const rows: RawProduct[] = await response.json()
    products.push(...rows.map(normalizeProduct))
    if (rows.length < 1000) break
  }
  return products
})

/** One storefront product group in one backend request. */
export const getPublicProduct = cache(async (slug: string): Promise<CatalogProduct[]> => {
  if (process.env.NEXT_PUBLIC_CATALOG_SOURCE !== 'django') {
    const products = await getPublicProducts()
    const product = findProduct(products, slug)
    return product ? products.filter(item => item.groupKey === product.groupKey) : []
  }
  try {
    const product = await djangoFetch<DjangoProduct>(`/api/v1/catalog/products/lookup/?slug=${encodeURIComponent(slug)}`)
    return mapDjangoProducts([product])
  } catch (error) {
    if (error instanceof CatalogApiError && error.status === 404) return []
    throw error
  }
})

/** Resolve the public category slug and fetch only that category. */
export const getPublicCategory = cache(async (slug: string): Promise<{ name: string; products: CatalogProduct[] } | null> => {
  if (process.env.NEXT_PUBLIC_CATALOG_SOURCE !== 'django') {
    const products = (await getPublicProducts()).filter(product => categorySlug(product.subcategory) === slug)
    return products.length ? { name: products[0].subcategory!, products } : null
  }
  const categories = await djangoFetch<DjangoCategory[]>('/api/v1/catalog/categories/')
  const category = categories.find(item => categorySlug(item.name) === slug || item.slug === slug)
  if (!category) return null
  const path = `/api/v1/catalog/products/?page_size=1000&category__slug=${encodeURIComponent(category.slug)}`
  return { name: category.name, products: mapDjangoProducts(await djangoPages(path)) }
})
