import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPublicProduct } from '@/entities/catalog/server'
import { findProduct, productHref } from '@/entities/catalog'
import { ProductPage } from '@/views/product'
import JsonLd from '@/shared/ui/JsonLd'
type Props = { params: Promise<{ slug: string }> }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const product = findProduct(await getPublicProduct(slug), slug)
  if (!product) return { title: 'Товар не найден — nStore', robots: { index: false } }
  const title = `${product.name} — купить в nStore`
  const description = product.description || `${product.name}. Оптовые поставки для HoReCa и офисов по Казахстану.`
  return { title, description, alternates: { canonical: productHref(product) }, openGraph: { title, description, images: product.image ? [product.image] : [] } }
}
export default async function Page({ params }: Props) {
  const { slug } = await params
  const products = await getPublicProduct(slug)
  const product = findProduct(products, slug)
  if (!product) notFound()
  const variants = products.filter(item => item.groupKey === product.groupKey)
  return <>
    <JsonLd data={{ '@context': 'https://schema.org', '@type': 'Product', name: product.name, sku: product.sku, image: product.images, description: product.description ?? product.name,
      offers: product.price == null ? undefined : { '@type': 'Offer', price: product.price, priceCurrency: 'KZT', availability: `https://schema.org/${product.stock > 0 ? 'InStock' : 'PreOrder'}`, url: `https://nstore.kz${productHref(product)}` } }} />
    <ProductPage product={product} variants={variants} />
  </>
}
