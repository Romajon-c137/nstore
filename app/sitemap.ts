import type { MetadataRoute } from 'next'
import { getPublicProducts } from '@/entities/catalog/server'
import { productHref } from '@/entities/catalog'
import { categorySlug } from '@/shared/lib/seo'

const SITE = 'https://nstore.kz'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await getPublicProducts()
  const categories = [...new Set(products.map(product => product.subcategory).filter(Boolean))]
  const now = new Date()
  return [
    { url: SITE, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${SITE}/shop`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${SITE}/register`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE}/page/delivery`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE}/page/contacts`, changeFrequency: 'monthly', priority: 0.5 },
    ...categories.map(name => ({
      url: `${SITE}/catalog/${categorySlug(name)}`,
      lastModified: now,
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
    ...products.map(product => ({
      url: `${SITE}${productHref(product)}`,
      lastModified: now,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  ]
}
