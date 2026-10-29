'use client'

import { useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PageBlock {
  id: string
  block_type: string
  props: Record<string, unknown>
  sort_order: number
}

export interface DbProduct {
  id: string
  sku: string | null
  name: string
  vol: string | null
  price: number | null
  box_qty: number | null
  section_name: string | null
  description: string | null
  image_url: string | null
  is_active: boolean
  stock: number | null
  reserved_qty: number | null
  /** Приоритет показа из CRM: 1 — первым; null — обычный порядок. */
  sort_priority?: number | null
}

export interface CartItem {
  product: DbProduct
  qty: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const WA_NUMBER = '77005220006'

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const fmt = (n: number) => n.toLocaleString('ru-RU').replace(/,/g, ' ') + ' ₸'

export const SECTION_STYLE: Record<string, { tile: string; band: string }> = {
  'Молочное':  { tile: '#EAF6EE', band: 'var(--primary)' },
  'Кофе и чай':{ tile: '#F1ECE5', band: '#6B4226' },
  'Напитки':   { tile: '#FFF1DD', band: '#F19A00' },
  'Соусы':     { tile: '#ECEAE6', band: '#3A2C1E' },
  'Вода':      { tile: '#E7F3F4', band: '#1B7E8C' },
  'Снеки':     { tile: '#F0F4E8', band: '#8AA63C' },
}
export const SECTION_FALLBACKS = Object.values(SECTION_STYLE)

export function getSectionStyle(name: string | null, idx = 0) {
  if (name && SECTION_STYLE[name]) return SECTION_STYLE[name]
  return SECTION_FALLBACKS[idx % SECTION_FALLBACKS.length]
}

export function buildWaMessage(cart: CartItem[]) {
  const lines = cart.map((item, i) => {
    const total = (item.product.price ?? 0) * item.qty
    const sku = item.product.sku ? ` (арт. ${item.product.sku})` : ''
    return `${i + 1}. ${item.product.name}${sku} — ${item.qty} шт × ${fmt(item.product.price ?? 0)} = ${fmt(total)}`
  })
  const totalSum = cart.reduce((s, item) => s + (item.product.price ?? 0) * item.qty, 0)
  return encodeURIComponent(`Здравствуйте! Хочу оформить заказ:\n\n${lines.join('\n')}\n\nИтого: ${fmt(totalSum)}`)
}

// ─── Default fallback blocks ──────────────────────────────────────────────────

export const DEFAULT_PERKS = [
  { title: 'Доставка сегодня', desc: 'Заказы до 18:00 — привезём в этот же день' },
  { title: 'Удобная оплата', desc: 'Картой онлайн, при получении или по счёту' },
  { title: 'Свежесть', desc: 'Холодовая цепь и контроль сроков годности' },
  { title: 'Лёгкий возврат', desc: 'Вернём деньги, если товар не подошёл' },
]

export const DEFAULT_CATS = [
  { name: 'Молочное', count: '320 товаров' },
  { name: 'Кофе и чай', count: '180 товаров' },
  { name: 'Напитки', count: '240 товаров' },
  { name: 'Соусы', count: '95 товаров' },
  { name: 'Вода', count: '60 товаров' },
  { name: 'Снеки', count: '150 товаров' },
]

export const DEFAULT_CHIPS = ['Все товары', 'Молочное', 'Кофе и чай', 'Напитки', 'Соусы', 'Вода', 'Снеки']

export const DEFAULT_HERO_STATS = [
  { value: '1197+', label: 'товаров в каталоге' },
  { value: '500+',  label: 'клиентов' },
  { value: '7 лет',  label: 'на рынке' },
]

export const DEFAULT_TERMS = [
  { title: 'Доставка по Астане',              desc: 'Бесплатно при заказе от 30 000 ₸, иначе 1 500 ₸. Оформление до 09:00 — доставка в тот же день' },
  { title: 'Доставка по Казахстану и СНГ',    desc: 'Отправляем в любой регион, стоимость доставки оплачивает покупатель' },
  { title: 'Оплата',                          desc: 'Наличными курьеру или по QR (Kaspi), безналичный расчёт, перевод на Kaspi' },
  { title: 'Самовывоз',                       desc: 'г. Астана, ул. Керей Жанибек ханов, д. 50, офис №6' },
]

export const DEFAULT_STEPS = [
  { title: 'Заявка',   desc: 'Оставьте заявку на сайте или напишите менеджеру' },
  { title: 'Договор',  desc: 'Согласуем условия и подпишем договор поставки' },
  { title: 'Поставка', desc: 'Открываем доступ в B2B-кабинет и начинаем поставки' },
]

export const SEGMENT_LABELS: Record<string, string> = {
  horeca: 'HoReCa', shop: 'Магазин', wholesale: 'Опт', office: 'Офис', pharmacy: 'Аптека',
}

export const DEFAULT_BLOCKS: PageBlock[] = [
  { id: 'd1',  block_type: 'header',          props: { city: 'Астана' }, sort_order: 0 },
  { id: 'd0',  block_type: 'promo_bar',       props: { text: 'Бесплатная доставка от 30 000 ₸ по городу · оптовикам — отдельные цены в B2B-кабинете', bgColor: '#0E7C46' }, sort_order: 1 },
  { id: 'd4',  block_type: 'hero',            props: { title: '−20% на молоко и сливки', subtitle: 'СВЕЖАЯ МОЛОЧКА КАЖДОЕ УТРО', btnText: 'Смотреть', promos: [{title:'Кофе недели',desc:'Свежая обжарка от 3 990 ₸/кг',bg:'#F4EEFE',color:'#5B21D6'},{title:'Соусы Азии',desc:'Терияки, соевый, устричный',bg:'#FFF4E6',color:'#B25E00'}] }, sort_order: 3 },
  { id: 'd2',  block_type: 'categories_chips',props: { items: DEFAULT_CHIPS }, sort_order: 4 },
  { id: 'd5',  block_type: 'products',        props: { title: 'Популярное', columns: 6, count: 12 }, sort_order: 5 },
  { id: 'd6',  block_type: 'cat_grid',        props: { title: 'Категории', items: DEFAULT_CATS }, sort_order: 6 },
  { id: 'd7',  block_type: 'terms',           props: { items: DEFAULT_TERMS }, sort_order: 7 },
  { id: 'd8',  block_type: 'b2b_banner',      props: { title: 'Закупаете для кафе, магазина или офиса?', desc: 'Оптовые цены, отсрочка платежа и персональный менеджер в B2B-кабинете.', btnText: 'Открыть опт B2B' }, sort_order: 8 },
  { id: 'd9',  block_type: 'steps',           props: { items: DEFAULT_STEPS }, sort_order: 9 },
  { id: 'd10', block_type: 'perks',           props: { items: DEFAULT_PERKS }, sort_order: 10 },
  { id: 'd11', block_type: 'form',            props: { title: 'Стать партнёром', btnText: 'Отправить заявку', showCompany: true, showSegment: true, showComment: true }, sort_order: 11 },
  { id: 'd12', block_type: 'footer',          props: { city: 'Астана', phone: '+7 700 720 0006', email: 'sales.nstore@gmail.com' }, sort_order: 12 },
]

export const PRODUCT_FIELDS = 'id, sku, name, vol, price, box_qty, section_name, description, image_url, is_active, stock, reserved_qty, sort_priority'

/** Порядок витрины: приоритет из CRM (1 — первым) → в наличии → исходный порядок (по имени). */
export function byShowcase(a: DbProduct, b: DbProduct) {
  const pa = a.sort_priority ?? Infinity, pb = b.sort_priority ?? Infinity
  if (pa !== pb) return pa - pb
  const sa = (a.stock ?? 0) - (a.reserved_qty ?? 0) > 0, sb = (b.stock ?? 0) - (b.reserved_qty ?? 0) > 0
  return Number(sb) - Number(sa)
}

export const PAGE_SIZE = 12

export const FORM_INPUT_STYLE = { height: 46, border: '1px solid #D4DAD6', borderRadius: 11, padding: '0 14px', fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const, width: '100%' }

export function pluralTovar(n: number): string {
  const d = n % 10, dd = n % 100
  if (d === 1 && dd !== 11) return `${n} товар`
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return `${n} товара`
  return `${n} товаров`
}

// ─── Product image area (shared between card and modal) ───────────────────────

export function ProductImageArea({ product, style, height }: { product: DbProduct; style: { tile: string; band: string }; height?: number }) {
  const [imgError, setImgError] = useState(false)
  const inStock = ((product.stock ?? 0) - (product.reserved_qty ?? 0)) > 0

  return (
    <div style={{ position: 'relative', borderRadius: 13, aspectRatio: height ? undefined : '1/1', height: height, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {product.image_url && !imgError ? (
        <img
          src={product.image_url}
          alt={`${product.name}${product.vol ? `, ${product.vol}` : ''}${product.section_name ? ` — ${product.section_name}` : ''} оптом в Астане`}
          loading="lazy"
          decoding="async"
          onError={() => setImgError(true)}
          style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 8, boxSizing: 'border-box' }}
        />
      ) : (
        <div style={{ width: 40, height: 80, background: 'rgba(255,255,255,.9)', borderRadius: '10px 10px 12px 12px', position: 'relative', boxShadow: '0 5px 12px rgba(0,0,0,.07)' }}>
          <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', width: 14, height: 16, background: 'rgba(255,255,255,.9)', borderRadius: '3px 3px 0 0' }} />
          <div style={{ position: 'absolute', bottom: 12, left: 5, right: 5, height: 20, borderRadius: 4, background: style.band }} />
        </div>
      )}
      {!inStock && (
        <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6 }}>
          Под заказ
        </div>
      )}
    </div>
  )
}
