import { normalizeProduct } from './normalize'

export interface DjangoVariant {
  id: string
  sku: string
  barcode: string
  source_name: string
  unit: string
  package_label: string
  package_qty: string
  min_qty: string
  qty_step: string
  price: { amount?: string | number | null; currency?: string; price_list?: string | null }
  stock: string | number | null
  availability: 'sufficient' | 'insufficient' | 'absent' | 'unknown'
  images: { url: string | null; is_primary: boolean }[]
}

export interface DjangoProduct {
  id: string
  title: string
  slug: string
  brand: string
  description?: string
  category: { id: string; name: string; slug: string } | null
  variants: DjangoVariant[]
}

function decimal(value: string | number | null | undefined) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Shared by SSR and the authenticated browser catalog; prices are resolved by Django. */
export function mapDjangoProduct(product: DjangoProduct, variant: DjangoVariant) {
  const images = [...variant.images].sort((a, b) => Number(b.is_primary) - Number(a.is_primary)).flatMap(image => image.url ?? [])
  const packageQty = decimal(variant.package_qty)
  const packageLabel = variant.package_label && packageQty && packageQty > 1
    ? `${variant.package_label} · ${packageQty} шт`
    : variant.package_label
  return normalizeProduct({
    id: variant.id, sku: variant.sku, name: variant.source_name || product.title,
    description: product.description ?? null, brand: product.brand,
    section_name: product.category?.name ?? null, price: decimal(variant.price?.amount),
    stock: decimal(variant.stock), source_availability: variant.availability,
    box_qty: decimal(variant.qty_step), min_qty: decimal(variant.min_qty),
    unit: variant.unit, barcode: variant.barcode, vol: packageLabel,
    images, image_url: images[0] ?? null,
  })
}
