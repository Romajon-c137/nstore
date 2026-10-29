import type { Category,CategoryId } from '@/entities/catalog/model/types'

/* Витринные категории nStore. Порядок = порядок вкладок.
   Исходные разделы 1С (≈70 штук, см. migration/redirect-map.md) сводятся
   к 9 понятным группам правилами ниже — клиенту не нужно знать структуру учёта. */
export const CATEGORIES: Category[] = [
  { id: 'coffee',    name: 'Кофе' },
  { id: 'milk',      name: 'Молоко' },
  { id: 'syrups',    name: 'Сиропы' },
  { id: 'sauces',    name: 'Соусы' },
  { id: 'drinks',    name: 'Напитки' },
  { id: 'tea',       name: 'Чай' },
  { id: 'supplies',  name: 'Расходники' },
  { id: 'equipment', name: 'Оборудование' },
  { id: 'other',     name: 'Другое' },
]

export const CATEGORY_NAME: Record<CategoryId, string> =
  Object.fromEntries(CATEGORIES.map(c => [c.id, c.name])) as Record<CategoryId, string>

/* Правила проверяются по порядку: первое совпадение побеждает.
   Порядок важен: «стакан для кофе» — расходник, «сироп для чая» — сироп,
   «молочный шоколад» — не молоко. */
const RULES: [CategoryId, RegExp][] = [
  ['equipment', /кофемашин|кофеварк|гейзерн|кофемолк|оборудован|блендер|питчер|холодильн|диспенсер|темпер/],
  ['supplies',  /стакан|крышк|трубочк|салфет|бумажн|перчат|бытов|химия|моющ|пакет(?!ик)|размешив|контейнер|канц|губк|полотенц|упаковк|одноразов/],
  ['other',     /шоколад|печень|конфет|батончик|снек|сладост|хлебц|сухар|десерт|паста орех|ореховая паста|арахисовая паста|макарон|бакале|крупа|консерв|сахар|сыр(?!оп)/],
  ['syrups',    /сироп|топпинг/],
  ['sauces',    /соус|кетчуп|майонез|маринад|заправк|уксус|горчиц|табаско|томатн|приправ|специ|карри|перец|паприк/],
  ['milk',      /молок|молоч|сливк|сгущ/],
  ['tea',       /чай|ройбуш|пуэр|улун|oolong|матча|matcha/],
  ['coffee',    /кофе|coffee|растворим|молот|эспрессо|espresso|nespresso|арабик|робуст|decaf|зерно|капсул|чалд|дрип|3\s*в\s*1/],
  ['drinks',    /напит|вода|минерал|сок|лимонад|газир|энергет|кола|cola|нектар|морс|какао|смесь|коктейл|шейк|shake|латте|tassay|borjomi/],
]

export function categorize(section: string | null, name: string): CategoryId {
  for (const text of [section, name]) {
    if (!text) continue
    const t = text.toLowerCase()
    for (const [id, re] of RULES) if (re.test(t)) return id
  }
  return 'other'
}
