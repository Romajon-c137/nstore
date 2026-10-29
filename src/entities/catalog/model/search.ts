/* Мгновенный поиск и фильтры — на клиенте, каталог целиком в памяти (~1–2 тыс. позиций). */

import { CATEGORY_NAME } from '@/entities/catalog/model/categories'
import { resolvePrice } from '@/entities/catalog/model/pricing'
import type { CatalogGroup,CatalogProduct,CategoryId,PricingContext } from '@/entities/catalog/model/types'

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}%,.]+/gu, ' ').trim()

const haystacks = new WeakMap<CatalogProduct, string>()
function hay(p: CatalogProduct) {
  let h = haystacks.get(p)
  if (!h) {
    h = norm([p.name, p.brand, p.sku, p.barcode, CATEGORY_NAME[p.category], p.subcategory, p.package, ...p.keywords].filter(Boolean).join(' '))
    haystacks.set(p, h)
  }
  return h
}

/* «rjat» → «кофе»: запрос, набранный в неверной раскладке */
const EN = 'qwertyuiop[]asdfghjkl;\'zxcvbnm,.`'
const RU = 'йцукенгшщзхъфывапролджэячсмитьбюё'
function swapLayout(s: string) {
  return s.split('').map(ch => { const i = EN.indexOf(ch); return i >= 0 ? RU[i] : ch }).join('')
}

function matchesTokens(p: CatalogProduct, tokens: string[]) {
  const h = hay(p)
  return tokens.every(t => h.includes(t))
}

export function searchGroups(groups: CatalogGroup[], query: string): CatalogGroup[] {
  const q = norm(query)
  if (!q) return groups
  const run = (qq: string) => {
    const tokens = qq.split(' ').filter(Boolean)
    return groups.filter(g => g.variants.some(v => matchesTokens(v, tokens)))
  }
  let res = run(q)
  if (!res.length && /[a-z]/.test(q)) res = run(norm(swapLayout(q)))
  // Сначала — совпадение в начале названия / бренда
  return res.sort((a, b) => rank(b.variants[0], q) - rank(a.variants[0], q))
}

function rank(p: CatalogProduct, q: string) {
  const name = norm(p.name)
  if (p.sku && norm(p.sku) === q) return 3
  if (name.startsWith(q) || (p.brand && norm(p.brand).startsWith(q))) return 2
  return name.includes(q) ? 1 : 0
}

/* ── Фильтры ───────────────────────────────────────────────────────────── */

export interface Filters {
  brands: string[]
  categories: CategoryId[]
  packages: string[]
  priceMin: number | null
  priceMax: number | null
  inStockOnly: boolean
}

export const EMPTY_FILTERS: Filters = { brands: [], categories: [], packages: [], priceMin: null, priceMax: null, inStockOnly: false }

export function activeFilterCount(f: Filters) {
  return f.brands.length + f.categories.length + f.packages.length
    + (f.priceMin != null || f.priceMax != null ? 1 : 0) + (f.inStockOnly ? 1 : 0)
}

/** Фасовка без уточнений («зерно • 1 кг» → «1 кг») — для группировки в фильтре. */
export function packageSize(p: CatalogProduct) {
  return p.package?.split(' • ').find(x => /\d/.test(x) && !x.includes('%')) ?? null
}

export function applyFilters(groups: CatalogGroup[], f: Filters, pricing: PricingContext): CatalogGroup[] {
  if (!activeFilterCount(f)) return groups
  const ok = (p: CatalogProduct) => {
    if (f.brands.length && (!p.brand || !f.brands.includes(p.brand))) return false
    if (f.categories.length && !f.categories.includes(p.category)) return false
    if (f.packages.length) { const s = packageSize(p); if (!s || !f.packages.includes(s)) return false }
    if (f.inStockOnly && p.stock <= 0) return false
    if (f.priceMin != null || f.priceMax != null) {
      const price = resolvePrice(p, pricing).unitPrice
      if (price == null) return false
      if (f.priceMin != null && price < f.priceMin) return false
      if (f.priceMax != null && price > f.priceMax) return false
    }
    return true
  }
  return groups.flatMap(g => {
    const variants = g.variants.filter(ok)
    return variants.length ? [{ ...g, variants }] : []
  })
}

/** Приоритет карточки из CRM: наименьший среди вариантов; без приоритета — Infinity. */
export function groupPriority(g: CatalogGroup) {
  return Math.min(...g.variants.map(v => v.priority ?? Infinity))
}

/** Порядок «Все товары»: приоритет из CRM → в наличии → с фото → по названию. */
export function sortForBrowse(groups: CatalogGroup[]) {
  const score = (g: CatalogGroup) => {
    const p = g.variants[0]
    return (g.variants.some(v => v.stock > 0) ? 0 : 2) + (p.image ? 0 : 1)
  }
  return [...groups].sort((a, b) =>
    groupPriority(a) - groupPriority(b) || score(a) - score(b) || a.variants[0].name.localeCompare(b.variants[0].name, 'ru'))
}
