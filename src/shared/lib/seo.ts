// ─── SEO / GEO helpers ────────────────────────────────────────────────────────
// Единый источник правды для мета-тегов, structured data (JSON-LD) и слагов.
// Значения, помеченные TODO, стоит заменить на реальные данные компании —
// от их точности напрямую зависит локальное (гео) и генеративное (GEO) ранжирование.

export const SITE = 'https://nstore.kz'
export const BRAND = 'Nstore'

/** Данные организации для JSON-LD (Organization + LocalBusiness). */
export const ORG = {
  name: 'Nstore',
  legalName: 'Nstore',
  url: SITE,
  logo: `${SITE}/icons/icon-512.png`,
  image: `${SITE}/og-cover.png`, // брендовая обложка 1200×630
  description:
    'Оптовые поставки продуктов питания по Казахстану. B2B-дистрибьютор для HoReCa, магазинов и офисов в Астане: прямые цены, доставка по городу и стране.',
  telephone: '+7 700 720 00 06', // контактный телефон каталога
  salesPhone: '+7 700 522 00 06', // отдел оптовых продаж (B2B)
  email: 'sales.nstore@gmail.com',
  address: {
    country: 'KZ',
    region: 'Астана',
    city: 'Астана',
    street: 'ул. Керей Жанибек ханов, 50, офис 6',
    postalCode: '', // TODO: индекс при наличии
  },
  geo: { lat: 51.104899, lng: 71.450762 }, // координаты из карточки 2ГИС
  map2gis: 'https://2gis.kz/astana/firm/70000001045314236',
  areaServed: ['Астана', 'Казахстан'],
  priceRange: '₸₸',
  openingHours: ['Mo-Fr 09:00-18:00', 'Sa 09:00-12:00'],
  sameAs: [
    // Профили — усиливают доверие для поиска и ИИ-движков
    'https://2gis.kz/astana/firm/70000001045314236',
    'https://wa.me/77005220006',
    // TODO: добавить Instagram и др. соцсети при наличии
  ],
}

/** Транслитерация + очистка строки в URL-слаг (кириллица → латиница). */
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

export function slugify(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .toLowerCase()
    .split('')
    .map(ch => (ch in TRANSLIT ? TRANSLIT[ch] : ch))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

/** Стабильный слаг товара: название (+ артикул для уникальности). */
export function productSlug(p: { name: string; sku?: string | null }): string {
  const base = slugify(p.name)
  const sku = p.sku ? slugify(p.sku) : ''
  return sku ? `${base}-${sku}` : base
}

export const categorySlug = slugify

// ─── JSON-LD builders ─────────────────────────────────────────────────────────

export function organizationLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: ORG.name,
    legalName: ORG.legalName,
    url: ORG.url,
    logo: ORG.logo,
    description: ORG.description,
    email: ORG.email,
    telephone: ORG.telephone,
    contactPoint: contactPoints(),
    sameAs: ORG.sameAs,
  }
}

// Точки контакта: общий телефон каталога + отдел оптовых продаж (B2B)
function contactPoints() {
  return [
    {
      '@type': 'ContactPoint',
      telephone: ORG.telephone,
      contactType: 'customer service',
      areaServed: 'KZ',
      availableLanguage: ['ru', 'kk'],
    },
    {
      '@type': 'ContactPoint',
      telephone: ORG.salesPhone,
      contactType: 'sales',
      name: 'Оптовые продажи',
      areaServed: 'KZ',
      availableLanguage: ['ru', 'kk'],
    },
  ]
}

export function localBusinessLd() {
  return {
    '@context': 'https://schema.org',
    '@type': ['Organization', 'FoodEstablishment', 'GroceryStore', 'LocalBusiness'],
    '@id': `${SITE}/#business`,
    name: ORG.name,
    url: ORG.url,
    image: ORG.image,
    logo: ORG.logo,
    description: ORG.description,
    telephone: ORG.telephone,
    email: ORG.email,
    contactPoint: contactPoints(),
    priceRange: ORG.priceRange,
    currenciesAccepted: 'KZT',
    address: {
      '@type': 'PostalAddress',
      addressCountry: ORG.address.country,
      addressRegion: ORG.address.region,
      addressLocality: ORG.address.city,
      streetAddress: ORG.address.street || undefined,
      postalCode: ORG.address.postalCode || undefined,
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: ORG.geo.lat,
      longitude: ORG.geo.lng,
    },
    hasMap: ORG.map2gis,
    areaServed: ORG.areaServed.map(name => ({ '@type': 'AdministrativeArea', name })),
    openingHours: ORG.openingHours,
    sameAs: ORG.sameAs,
  }
}

export function websiteLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: ORG.name,
    url: SITE,
    inLanguage: ['ru', 'kk'],
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE}/?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  }
}

// Google Product Taxonomy strings for schema.org Product.category.
// Required by Merchant listings — free-text Russian names are rejected.
// Source: https://www.google.com/basepages/producttype/taxonomy-with-ids.en-US.txt
// "НеАктуальные" maps to undefined (internal label, not a real category).
// Any section_name not in the map also yields undefined (safe fallback).
const GOOGLE_CATEGORY: Record<string, string | undefined> = {
  'Альтернативное молоко': 'Food, Beverages & Tobacco > Beverages > Non-Dairy Milk',
  'Вода':                  'Food, Beverages & Tobacco > Beverages > Water',
  'Кофе':                  'Food, Beverages & Tobacco > Beverages > Coffee',
  'Кофе капсулы':          'Food, Beverages & Tobacco > Beverages > Coffee',
  'Лечебная вода':         'Food, Beverages & Tobacco > Beverages > Water > Flat Mineral Water',
  'Молоко':                'Food, Beverages & Tobacco > Beverages > Milk',
  'Напитки':               'Food, Beverages & Tobacco > Beverages',
  'НеАктуальные':          undefined,
  'Прочее':                'Food, Beverages & Tobacco',
  'Сахар и заменители':    'Food, Beverages & Tobacco > Food Items > Cooking & Baking Ingredients > Sugar & Sweeteners',
  'Сиропы':                'Food, Beverages & Tobacco > Food Items > Condiments & Sauces > Syrup',
  'Сливки':                'Food, Beverages & Tobacco > Food Items > Dairy Products > Cream',
  'Снеки':                 'Food, Beverages & Tobacco > Food Items > Snack Foods',
  'Соуса':                 'Food, Beverages & Tobacco > Food Items > Condiments & Sauces',
  'Сухие смеси':           'Food, Beverages & Tobacco > Beverages > Powdered Beverage Mixes',
  'Чай':                   'Food, Beverages & Tobacco > Beverages > Tea & Infusions',
  'Шоколад':               'Food, Beverages & Tobacco > Food Items > Candy & Chocolate',
}

type LdProduct = {
  id: string
  sku?: string | null
  name: string
  vol?: string | null
  price?: number | null
  section_name?: string | null
  description?: string | null
  image_url?: string | null
  stock?: number | null
}

export function productLd(p: LdProduct) {
  const url = `${SITE}/product/${productSlug(p)}`
  const availability =
    p.stock != null && p.stock > 0
      ? 'https://schema.org/InStock'
      : 'https://schema.org/PreOrder'
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    sku: p.sku || undefined,
    description:
      p.description ||
      `${p.name}${p.vol ? `, ${p.vol}` : ''} — оптом от дистрибьютора Nstore в Астане. Доставка по Казахстану.`,
    image: p.image_url || ORG.image,
    category: p.section_name ? GOOGLE_CATEGORY[p.section_name] : undefined,
    brand: { '@type': 'Brand', name: ORG.name },
    url,
    offers: {
      '@type': 'Offer',
      url,
      priceCurrency: 'KZT',
      price: p.price != null ? p.price : undefined,
      availability,
      seller: { '@type': 'Organization', name: ORG.name },
      areaServed: ORG.areaServed,
    },
  }
}

export function itemListLd(products: LdProduct[], listUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    url: listUrl,
    numberOfItems: products.length,
    itemListElement: products.slice(0, 100).map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE}/product/${productSlug(p)}`,
      name: p.name,
    })),
  }
}

// Часто задаваемые вопросы. Факты — общие и проверяемые (со старого сайта).
// TODO: уточнить конкретику (мин. сумма заказа, зоны/сроки доставки, отсрочка).
export const FAQ_ITEMS: { q: string; a: string }[] = [
  {
    q: 'Вы работаете оптом или в розницу?',
    a: 'И оптом, и в розницу. Для оптовых и B2B-клиентов (кафе, рестораны, магазины, офисы) действуют отдельные цены и условия в личном кабинете.',
  },
  {
    q: 'Откуда и куда доставляете?',
    a: 'Склад находится в Астане. Доставляем по Астане и по всему Казахстану, доступен самовывоз со склада.',
  },
  {
    q: 'Как оформить заказ?',
    a: 'Выберите товары в каталоге и оформите заявку через WhatsApp или в B2B-кабинете. Менеджер подтвердит наличие и условия доставки.',
  },
  {
    q: 'Работаете ли вы с юридическими лицами и даёте ли документы?',
    a: 'Да. Компания является плательщиком НДС, работает с юридическими и физическими лицами и предоставляет сопроводительные документы и сертификаты на продукцию.',
  },
]

export function faqLd(items: { q: string; a: string }[] = FAQ_ITEMS) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(i => ({
      '@type': 'Question',
      name: i.q,
      acceptedAnswer: { '@type': 'Answer', text: i.a },
    })),
  }
}

type LdArticle = {
  slug: string
  title: string
  excerpt?: string | null
  cover_image?: string | null
  published_at?: string | null
}

export function articleLd(a: LdArticle) {
  const url = `${SITE}/blog/${a.slug}`
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: a.title,
    description: a.excerpt || undefined,
    image: a.cover_image || ORG.image,
    datePublished: a.published_at || undefined,
    author: { '@type': 'Organization', name: ORG.name },
    publisher: {
      '@type': 'Organization',
      name: ORG.name,
      logo: { '@type': 'ImageObject', url: ORG.logo },
    },
    mainEntityOfPage: url,
    url,
  }
}

export function breadcrumbLd(crumbs: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: c.url,
    })),
  }
}
