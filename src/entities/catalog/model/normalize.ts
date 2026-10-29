/* Нормализация сырых товаров учётной системы в CatalogProduct.
   Чистые функции без зависимостей от Supabase — их же использует
   любой будущий адаптер (1С HTTP-сервис, REST API, выгрузка YML). */

import { categorize } from '@/entities/catalog/model/categories'
import type { Availability,CatalogGroup,CatalogProduct } from '@/entities/catalog/model/types'

/** Сырая строка товара — минимальный общий знаменатель источников. */
export interface RawProduct {
  id: string
  sku: string | null
  name: string
  vol?: string | null
  price?: number | null
  sort_priority?: number | null
  price_tp?: number | null
  price_top?: number | null
  old_price?: number | null
  box_qty?: number | null
  min_qty?: number | null
  section_name?: string | null
  description?: string | null
  image_url?: string | null
  images?: string[] | null
  stock?: number | null
  reserved_qty?: number | null
  barcode?: string | null
  brand?: string | null
  unit?: string | null
  is_popular?: boolean | null
  expected_date?: string | null
  attributes?: Record<string, string> | null
  source_availability?: 'sufficient' | 'insufficient' | 'absent' | 'unknown' | null
}

const LOW_STOCK = 5

/* Второе слово, которое описывает товар, а не бренд: «Toreo Espresso» → «Toreo». */
const BRAND_STOP = /^(Espresso|Coffee|Specialty|Classic|Original|Gold|Premium|Crema|Milk|Tea|Shake|Latte|Barista|Sauce|Syrup|Extra|Grande|Black|Green|Red|White|Lungo|Ristretto|Decaffeinato|Decaf|Intenso|Arabica)$/i

const VOL_RE = /(\d+(?:[.,]\d+)?)\s*(мл|ml|л|l|литр[а-я]*|кг|kg|гр?|gr?|шт|пак[а-я]*|капсул[а-я]*|стик[а-я]*)\.?(?![a-zа-я])/gi
const FAT_RE = /(\d+(?:[.,]\d+)?)\s*%/g

export function extractBrand(name: string): string | null {
  // «Aroy-D кокосовое молоко», «Кофе Toreo Espresso» → первая латинская серия слов
  const m = name.match(/[A-Z][A-Za-z&'’.\-]*(?![\w\d])(?:\s+[A-Z][A-Za-z&'’.\-]*(?![\w\d]))?/)
  if (!m) return null
  const words = m[0].replace(/[.\-]+$/, '').trim().split(/\s+/)
  if (BRAND_STOP.test(words[0])) return null
  if (words.length > 1 && BRAND_STOP.test(words[1])) words.pop()
  const brand = words.join(' ')
  return brand.length >= 2 ? brand : null
}

function fmtNum(s: string) { return s.replace('.', ',') }

function normUnit(u: string) {
  const x = u.toLowerCase()
  if (x === 'ml' || x === 'мл') return 'мл'
  if (x === 'l' || x === 'л' || x.startsWith('литр')) return 'л'
  if (x === 'kg' || x === 'кг') return 'кг'
  if (x === 'g' || x === 'gr' || x === 'г' || x === 'гр') return 'г'
  if (x.startsWith('пак')) return 'пак.'
  if (x.startsWith('капсул')) return 'капс.'
  if (x.startsWith('стик')) return 'стик.'
  return 'шт'
}

/** 1000 г → 1 кг, 1500 мл → 1,5 л. */
function scaled(v: number, unit: string) {
  if (unit === 'г' && v >= 1000) { v /= 1000; unit = 'кг' }
  if (unit === 'мл' && v >= 1000) { v /= 1000; unit = 'л' }
  return `${fmtNum(String(+v.toFixed(2)))} ${unit}`
}

/** «1 л • 2,5%», «зерно • 1 кг». */
export function extractPackage(name: string, vol: string | null | undefined): string | null {
  const parts: string[] = []
  const n = name.toLowerCase()
  if (/зерн/.test(n)) parts.push('зерно')
  else if (/молот/.test(n)) parts.push('молотый')
  else if (/капсул/.test(n) && !/\d+\s*капсул/.test(n)) parts.push('капсулы')

  // Объём/вес и штучность отдельно: «350 мл • 1000 шт»
  const found = [...`${vol ?? ''} ${name}`.matchAll(VOL_RE)].map(m => scaled(parseFloat(m[1].replace(',', '.')), normUnit(m[2])))
  const isMeasure = (x: string) => / (мл|л|г|кг)$/.test(x)
  const m = found.find(isMeasure)
  const c = found.find(x => !isMeasure(x))
  if (m) parts.push(m)
  if (c) parts.push(c)
  if (!found.length && vol?.trim()) parts.push(vol.trim())

  const fat = [...name.matchAll(FAT_RE)].pop()
  if (fat) parts.push(`${fmtNum(fat[1])}%`)
  return parts.length ? parts.join(' • ') : null
}

/** Литры/килограммы в числах — для фильтров и будущей логистики. */
function measure(pkg: string | null): { weight: number | null; volume: number | null } {
  const m = pkg?.match(/(\d+(?:,\d+)?)\s(мл|л|г|кг)/)
  if (!m) return { weight: null, volume: null }
  const v = parseFloat(m[1].replace(',', '.'))
  if (m[2] === 'мл') return { weight: null, volume: v / 1000 }
  if (m[2] === 'л') return { weight: null, volume: v }
  if (m[2] === 'г') return { weight: v / 1000, volume: null }
  return { weight: v, volume: null }
}

/** Ключ группы: название без фасовки и жирности. Совпал ключ — это варианты одного товара. */
function groupKeyOf(name: string, brand: string | null): { key: string; label: string | null } {
  const removed: string[] = []
  let base = name.replace(FAT_RE, m => { removed.push(m.replace(/\s+/g, '')); return ' ' })
  base = base.replace(VOL_RE, (_m, num: string, unit: string) => { removed.push(scaled(parseFloat(num.replace(',', '.')), normUnit(unit))); return ' ' })
  base = base.toLowerCase().replace(/ё/g, 'е').replace(/[(),/«»"]+/g, ' ').replace(/\s+/g, ' ').trim()
  return { key: `${(brand ?? '').toLowerCase()}|${base}`, label: removed.length ? removed.reverse().join(' • ') : null }
}

function availabilityOf(stock: number, expected: string | null, source?: RawProduct['source_availability']): Availability {
  if (source === 'unknown') return 'unknown'
  if (source === 'absent') return expected ? 'preorder' : 'out'
  if (source === 'insufficient') return 'low'
  if (stock > LOW_STOCK) return 'in_stock'
  if (stock > 0) return 'low'
  return expected ? 'preorder' : 'out'
}

/** Чистит названия из 1С: буквальные «\t», табы, повторные пробелы, хвостовые запятые. */
export function cleanName(name: string) {
  return name.replace(/\\[tnr]/g, ' ').replace(/\s+/g, ' ').replace(/[\s,;]+$/, '').trim()
}

export function normalizeProduct(raw: RawProduct): CatalogProduct {
  const r = { ...raw, name: cleanName(raw.name), vol: raw.vol ? cleanName(raw.vol) : raw.vol }
  const brand = r.brand?.trim() || extractBrand(r.name)
  const pkg = extractPackage(r.name, r.vol)
  const stock = Math.max(0, (r.stock ?? 0) - (r.reserved_qty ?? 0))
  const { key, label } = groupKeyOf(r.name, brand)
  const images = (r.images?.length ? r.images : r.image_url ? [r.image_url] : []).filter(Boolean)
  const step = r.box_qty && r.box_qty > 0 ? r.box_qty : 1
  const attrs: Record<string, string> = { ...(r.attributes ?? {}) }
  if (brand && !attrs['Бренд']) attrs['Бренд'] = brand
  if (pkg && !attrs['Фасовка']) attrs['Фасовка'] = pkg
  if (step > 1 && !attrs['В коробке']) attrs['В коробке'] = `${step} шт`
  if (r.sku && !attrs['Артикул']) attrs['Артикул'] = r.sku

  return {
    id: r.id,
    sku: r.sku ?? '',
    name: r.name,
    brand,
    category: categorize(r.section_name ?? null, r.name),
    subcategory: r.section_name ?? null,
    description: r.description ?? null,
    image: images[0] ?? null,
    images,
    unit: r.unit?.trim() || 'шт',
    package: pkg,
    price: r.price ?? null,
    oldPrice: r.old_price ?? null,
    priceLists: { wholesale: r.price_tp ?? null, top: r.price_top ?? null },
    priceTiers: [],
    stock,
    availability: availabilityOf(stock, r.expected_date ?? null, r.source_availability),
    expectedDate: r.expected_date ?? null,
    warehouses: [],
    barcode: r.barcode ?? null,
    ...measure(pkg),
    step,
    minQty: Math.max(step, r.min_qty ?? 0),
    attributes: attrs,
    documents: [],
    keywords: [r.section_name ?? '', brand ?? ''].filter(Boolean),
    // приоритет из CRM тоже выводит товар в «Популярное»
    isPopular: !!r.is_popular || r.sort_priority != null,
    priority: r.sort_priority ?? null,
    groupKey: key,
    variantLabel: label,
  }
}

/** Название группы: «Молоко Ekoniva 2,5% 1 л» → «Молоко Ekoniva». */
export function baseTitle(name: string) {
  return name.replace(FAT_RE, ' ').replace(VOL_RE, ' ').replace(/\(\s*\)/g, ' ').replace(/\s{2,}/g, ' ').replace(/[\s,]+$/, '').trim()
}

/** Склеивает варианты (жирность/объём) в одну карточку.
    Не склеиваем, если подписи вариантов совпадают — значит, это разные товары. */
export function groupProducts(products: CatalogProduct[]): CatalogGroup[] {
  const byKey = new Map<string, CatalogProduct[]>()
  for (const p of products) {
    const k = `${p.category}|${p.groupKey}`
    const arr = byKey.get(k)
    if (arr) arr.push(p); else byKey.set(k, [p])
  }
  const groups: CatalogGroup[] = []
  for (const [key, arr] of byKey) {
    const labels = new Set(arr.map(p => p.variantLabel))
    if (arr.length > 1 && arr.length <= 8 && !labels.has(null) && labels.size === arr.length) {
      arr.sort((a, b) => (a.volume ?? a.weight ?? 0) - (b.volume ?? b.weight ?? 0) || (a.variantLabel ?? '').localeCompare(b.variantLabel ?? '', 'ru', { numeric: true }))
      groups.push({ key, title: baseTitle(arr[0].name), variants: arr })
    } else {
      for (const p of arr) groups.push({ key: p.id, title: p.name, variants: [p] })
    }
  }
  return groups
}
