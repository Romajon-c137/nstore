/* ───────────────────────────────────────────────────────────────────────────
   Каталог nStore — доменные типы.
   Интерфейс работает ТОЛЬКО с этими типами. Откуда пришли товары
   (Supabase, 1С, внешний API, демо-фикстура) решает адаптер в source.ts —
   UI об этом не знает, поэтому смена источника не трогает компоненты.
   ─────────────────────────────────────────────────────────────────────────── */

export type CategoryId =
  | 'coffee' | 'milk' | 'syrups' | 'sauces' | 'drinks'
  | 'tea' | 'supplies' | 'equipment' | 'other'

export interface Category { id: CategoryId; name: string }

export type Availability = 'in_stock' | 'low' | 'preorder' | 'out' | 'unknown'

/** Оптовая ступень: от minQty шт — цена price. */
export interface PriceTier { minQty: number; price: number }

/** Остаток на конкретном складе (на будущее — несколько складов). */
export interface WarehouseStock { warehouseId: string; name: string; qty: number }

export interface ProductDocument { title: string; url: string }

export interface CatalogProduct {
  id: string
  sku: string
  name: string
  brand: string | null
  category: CategoryId
  /** Исходный раздел учётной системы (1С «Родитель»). */
  subcategory: string | null
  description: string | null
  image: string | null
  images: string[]
  /** Единица продажи: «шт», «кг», «уп». */
  unit: string
  /** Короткая фасовка для карточки: «1 л • 2,5%», «зерно • 1 кг». */
  package: string | null
  /** Базовая (публичная) цена. Персональная считается в pricing.ts. */
  price: number | null
  oldPrice: number | null
  /** Прайс-листы, доступные клиентам с договором. */
  priceLists: { wholesale: number | null; top: number | null }
  priceTiers: PriceTier[]
  /** Доступный остаток (stock − резерв). */
  stock: number
  availability: Availability
  /** Ожидаемая дата поступления для «под заказ» (ISO). */
  expectedDate: string | null
  warehouses: WarehouseStock[]
  barcode: string | null
  weight: number | null
  volume: number | null
  /** Кратность заказа (шт в коробке). */
  step: number
  /** Минимальный заказ, шт. */
  minQty: number
  attributes: Record<string, string>
  documents: ProductDocument[]
  keywords: string[]
  isPopular: boolean
  /** Приоритет показа из CRM: 1 — первым; null — обычный порядок. */
  priority: number | null
  /** Ключ группы вариантов: товары с одинаковым ключом — одна карточка. */
  groupKey: string
  /** Подпись варианта внутри группы: «2,5%», «1 л». */
  variantLabel: string | null
}

/** Карточка каталога: один товар или группа вариантов. */
export interface CatalogGroup {
  key: string
  /** Название карточки (для группы — без фасовки). */
  title: string
  variants: CatalogProduct[]
}

/* ── Клиент и коммерческие условия ─────────────────────────────────────── */

export interface PricingContext {
  /** null — гость (публичные цены). */
  customerId: string | null
  priceList: 'base' | 'wholesale' | 'top'
  /** Скидка по договору, %. */
  contractDiscountPct: number
  /** Скидки по разделам: subcategory → %. */
  sectionDiscounts: Record<string, number>
  /** Персональные цены: productId → цена (приоритет над всем). */
  personalPrices: Record<string, number>
}

export interface ResolvedPrice {
  /** Цена за единицу с учётом количества и условий клиента. */
  unitPrice: number | null
  /** Зачёркнутая цена, если клиенту дали лучше базовой. */
  compareAt: number | null
  isPersonal: boolean
}

/* ── История закупок (B2B) ─────────────────────────────────────────────── */

export interface PastOrderLine { productId: string | null; sku: string | null; name: string; qty: number }

export interface PastOrder {
  id: string
  createdAt: string
  total: number | null
  status: string | null
  lines: PastOrderLine[]
}

export interface CartLine { productId: string; qty: number }
