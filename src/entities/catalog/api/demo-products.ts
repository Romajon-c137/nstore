import { normalizeProduct,type RawProduct } from '../model/normalize'

type Shape = 'bag' | 'carton' | 'bottle' | 'jar' | 'box' | 'can' | 'cups' | 'machine'

function pack(shape: Shape, color: string, label: string): string {
  const t = label.slice(0, 10)
  const body: Record<Shape, string> = {
    bag:     `<path d="M70 40h60l8 20v110a8 8 0 0 1-8 8H70a8 8 0 0 1-8-8V60z" fill="${color}"/><rect x="62" y="40" width="76" height="14" fill="#000" opacity=".12"/>`,
    carton:  `<path d="M68 52l16-22h32l16 22v118a6 6 0 0 1-6 6H74a6 6 0 0 1-6-6z" fill="#fff" stroke="#E3E8E5" stroke-width="2"/><rect x="68" y="96" width="64" height="46" fill="${color}"/>`,
    bottle:  `<rect x="90" y="24" width="20" height="22" rx="3" fill="#2B2B2B"/><path d="M84 46h32l8 26v98a8 8 0 0 1-8 8H84a8 8 0 0 1-8-8V72z" fill="${color}"/>`,
    jar:     `<rect x="70" y="50" width="60" height="14" rx="4" fill="#3A3A3A"/><rect x="66" y="64" width="68" height="110" rx="14" fill="${color}"/>`,
    box:     `<rect x="58" y="56" width="84" height="116" rx="6" fill="${color}"/><rect x="58" y="56" width="84" height="18" fill="#000" opacity=".1"/>`,
    can:     `<rect x="76" y="44" width="48" height="128" rx="10" fill="${color}"/><rect x="76" y="44" width="48" height="10" rx="5" fill="#C9CED1"/>`,
    cups:    `<path d="M70 70h60l-8 104H78z" fill="#fff" stroke="#E3E8E5" stroke-width="2"/><path d="M66 60h68v12H66z" fill="${color}"/><path d="M74 100h52l-3 34H77z" fill="${color}" opacity=".85"/>`,
    machine: `<rect x="56" y="40" width="88" height="132" rx="12" fill="#2E3532"/><rect x="72" y="58" width="56" height="26" rx="4" fill="#9FB3A8"/><rect x="88" y="104" width="24" height="20" rx="3" fill="#C9CED1"/><rect x="66" y="150" width="68" height="8" rx="3" fill="${color}"/>`,
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><ellipse cx="100" cy="182" rx="46" ry="5" fill="#000" opacity=".06"/>${body[shape]}<text x="100" y="${shape === 'carton' ? 124 : 118}" font-family="Arial" font-weight="700" font-size="11" fill="#fff" text-anchor="middle">${t}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

let n = 0
function p(name: string, section: string, price: number, extra: Partial<RawProduct> & { shape?: Shape; color?: string; img?: boolean } = {}): RawProduct {
  n += 1
  const { shape = 'box', color = '#10A35B', img = true, ...rest } = extra
  const brand = name.match(/[A-Z][A-Za-z\-]+/)?.[0] ?? section
  return {
    id: `demo-${n}`, sku: String(1000 + n), name, section_name: section,
    price, price_tp: Math.round(price * 0.92 / 10) * 10, stock: 40, reserved_qty: 0,
    box_qty: 1, image_url: img ? pack(shape, color, brand) : null, ...rest,
  }
}

const RAW: RawProduct[] = [
  p('Кофе в зернах Toreo Espresso Grande 80/20 1 кг', 'Зерновой кофе', 8900, { shape: 'bag', color: '#4A2C1A', is_popular: true, description: 'Купаж арабики и робусты для эспрессо и молочных напитков. Плотное тело, ноты шоколада и ореха.' }),
  p('Кофе в зернах Bushido Specialty 1 кг', 'Зерновой кофе', 14500, { shape: 'bag', color: '#1F1F1F', is_popular: true }),
  p('Кофе молотый Bushido Specialty 227 гр', 'Молотый кофе', 4200, { shape: 'bag', color: '#1F1F1F' }),
  p('Кофе растворимый Carte Noire 190 гр', 'Растворимый кофе', 5600, { shape: 'jar', color: '#2A1B14' }),
  p('Кофе в капсулах Ristora Lungo 10 шт', 'Кофе в капсулах', 2300, { shape: 'box', color: '#7A1E2C', stock: 0, expected_date: '2026-10-14' }),
  p('Молоко Ekoniva 2,5% 1 л', 'Молочные продукты', 690, { shape: 'carton', color: '#2F7DD1', box_qty: 12, is_popular: true }),
  p('Молоко Ekoniva 3,2% 1 л', 'Молочные продукты', 740, { shape: 'carton', color: '#1E5FAF', box_qty: 12 }),
  p('Молоко Ekoniva 3,2% 0,5 л', 'Молочные продукты', 420, { shape: 'carton', color: '#1E5FAF', box_qty: 20 }),
  p('Молоко для бариста Ekoniva Professional 3,5% 1 л', 'Молочные продукты', 890, { shape: 'carton', color: '#0F3F7A', box_qty: 12, is_popular: true }),
  p('Сливки питьевые Хорошее дело 10% 1 л', 'Сливки', 1650, { shape: 'carton', color: '#E0A526', box_qty: 12 }),
  p('Сливки питьевые Хорошее дело 33% 1 л', 'Сливки', 2950, { shape: 'carton', color: '#C9861A', box_qty: 12 }),
  p('Растительное молоко Alpro овсяное 1 л', 'Растительное молоко', 1850, { shape: 'carton', color: '#5B8C3A' }),
  p('Кокосовое молоко Aroy-D 400 мл', 'Растительное молоко', 990, { shape: 'can', color: '#3E7D3A' }),
  p('Сироп Barinoff Карамель 1 л', 'Сиропы', 3200, { shape: 'bottle', color: '#B8641C', is_popular: true }),
  p('Сироп Barinoff Ваниль 1 л', 'Сиропы', 3200, { shape: 'bottle', color: '#E2C27A' }),
  p('Сироп Barinoff Лесной орех 1 л', 'Сиропы', 3200, { shape: 'bottle', color: '#8A5A2B' }),
  p('Сироп Barinoff Солёная карамель 1 л', 'Сиропы', 3400, { shape: 'bottle', color: '#A0522D', stock: 3 }),
  p('Топпинг Osnova Шоколад 1 кг', 'Сиропы, топпинги', 3900, { shape: 'bottle', color: '#3B2416' }),
  p('Соус соевый Kikkoman 1 л', 'Азиатские соусы', 4100, { shape: 'bottle', color: '#B31B1B' }),
  p('Соус Aroy-D Шрирача 510 гр', 'Азиатские соусы', 1490, { shape: 'bottle', color: '#D2381C' }),
  p('Соус Aroy-D Сладкий чили 550 гр', 'Азиатские соусы', 1390, { shape: 'bottle', color: '#E2572B' }),
  p('Соус для салата Shoprite Цезарь 473 мл', 'Заправки для салатов', 2100, { shape: 'bottle', color: '#F0E2B6' }),
  p('Соус Tabasco Original 60 мл', 'Tabasco', 2600, { shape: 'bottle', color: '#9B1C14' }),
  // Высокое крупное фото (как у реальных бутылок в 1С) — проверка, что карточка не растягивается
  p('Минеральная вода Acqua Panna 0,75 л', 'Минеральная вода', 840, { box_qty: 12, is_popular: true, img: false,
    image_url: `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1800" viewBox="0 0 600 1800"><rect width="600" height="1800" fill="#fff"/><rect x="230" y="40" width="140" height="160" rx="16" fill="#D9542B"/><path d="M200 200h200l60 260v1240a60 60 0 0 1-60 60H200a60 60 0 0 1-60-60V460z" fill="#CFE3E6"/><rect x="150" y="900" width="300" height="420" fill="#F4F1EA"/><text x="300" y="1130" font-family="Arial" font-weight="700" font-size="64" fill="#D9542B" text-anchor="middle">PANNA</text></svg>')}` }),
  p('Минеральная вода Borjomi 0,5 л', 'Минеральная вода', 650, { shape: 'bottle', color: '#2C6E9B', box_qty: 12, is_popular: true }),
  p('Вода Tassay негазированная 0,5 л', 'Вода', 260, { shape: 'bottle', color: '#5AB4E5', box_qty: 12 }),
  p('Лимонад Natakhtari Тархун 0,5 л', 'Газированные напитки', 520, { shape: 'bottle', color: '#3BA34A', box_qty: 20 }),
  p('Coca-Cola 1 л', 'Газированные напитки', 690, { shape: 'bottle', color: '#C8102E', box_qty: 12 }),
  p('Смесь Osnova Milk Shake Ваниль 500 гр', 'Основа', 3600, { shape: 'jar', color: '#E8D3A0' }),
  p('Матча латте Osnova 500 гр', 'Основа', 5400, { shape: 'jar', color: '#7FA34A' }),
  p('Чай черный Twinings English Breakfast 100 гр', 'Черный чай', 3900, { shape: 'box', color: '#14213D' }),
  p('Чай зеленый Althaus Sencha Senpai 20 пакетиков', 'Зеленый чай', 2400, { shape: 'box', color: '#5E8C31', is_popular: true }),
  p('Чай фруктовый Althaus Red Fruit Flash 250 гр', 'Фруктовый чай', 6900, { shape: 'box', color: '#B0213B' }),
  p('Стакан бумажный 350 мл 1000 шт', 'Бумажная продукция', 18500, { shape: 'cups', color: '#10A35B' }),
  p('Крышка для стакана 90 мм 1000 шт', 'Бумажная продукция', 9800, { shape: 'cups', color: '#2E3532' }),
  p('Салфетки бумажные 100 шт', 'Бумажная продукция', 450, { shape: 'box', color: '#9AA8A0', img: false }),
  p('Кофемашина De\'Longhi Magnifica S', 'Кофемашины', 289000, { shape: 'machine', color: '#10A35B', stock: 2 }),
  p('Гейзерная кофеварка Bialetti Moka 6 чашек', 'Гейзерные кофеварки', 21900, { shape: 'machine', color: '#B0B7B3', stock: 0 }),
  p('Шоколад Fazer молочный 200 гр', 'Плиточный шоколад', 1890, { shape: 'box', color: '#1C2D6B' }),
  p('Печенье Merba Chocolate Chip 175 гр', 'Печенье, десерты', 1350, { shape: 'box', color: '#8B4A1F' }),
  p('Оливковое масло La Pedriza 1000 мл', 'Масло', 7900, { shape: 'bottle', color: '#6B7F2A' }),
]


export const publicDemoProducts = RAW.map(normalizeProduct)
