// ─── Импорт фотографий товаров со старого сайта (InSales) в Supabase ──────────
//
// Зачем: на старом nstore.kz (InSales) у товаров есть фото, на новом — почти нет.
// Товары в обеих системах совпадают по АРТИКУЛУ (sku = Артикул из 1С), поэтому
// картинки можно перенести, сматчив по sku.
//
// Источник картинок — YML-фид (экспорт «Яндекс.Маркет» в админке InSales):
//   Продвижение → Экспорт → Яндекс.Маркет → скопировать ссылку на YML.
// В фиде у каждого <offer> есть <vendorCode> (= артикул) и <picture> (ссылки).
//
// ЗАПУСК (на машине с доступом в интернет — НЕ в песочнице Claude):
//   node scripts/import-images-from-yml.mjs <YML_URL> [--cloudinary] [--dry-run]
//
//   <YML_URL>       ссылка на YML-фид старого сайта
//   --dry-run       ничего не пишет в БД, только показывает сколько сматчилось
//   --cloudinary    перезаливает фото в Cloudinary (чтобы не зависеть от InSales),
//                   иначе в image_url кладётся прямая ссылка на CDN InSales
//
// БЕЗОПАСНО: обновляет ТОЛЬКО существующие товары (по sku). Новых не создаёт.

const args = process.argv.slice(2)
const YML_URL = args.find(a => !a.startsWith('--'))
const DRY = args.includes('--dry-run')
const USE_CLOUDINARY = args.includes('--cloudinary')

const SUPA_URL = process.env.SUPA_URL || 'https://znhwajycjdluzoypjejh.supabase.co'
const SUPA_KEY =
  process.env.SUPA_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuaHdhanljamRsdXpveXBqZWpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NzU5MjQsImV4cCI6MjA5NTU1MTkyNH0.JfBN85sf_0Svi_jbRThH6KfdrpvMAPMA3wmCLu5X8JA'
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'dwbmwxm2l'
const CLOUD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || 'ZBKBCNlKYffDCvWY86Z7qCdlmmM'

if (!YML_URL) {
  console.error('Укажите ссылку на YML-фид: node scripts/import-images-from-yml.mjs <YML_URL> [--cloudinary] [--dry-run]')
  process.exit(1)
}

const norm = s => String(s || '').trim()

// ── 1. Скачать и распарсить YML (без внешних зависимостей) ────────────────────
function parseOffers(xml) {
  const offers = []
  const re = /<offer\b[^>]*>([\s\S]*?)<\/offer>/g
  let m
  while ((m = re.exec(xml))) {
    const body = m[1]
    const vendorCode = norm((body.match(/<vendorCode>([\s\S]*?)<\/vendorCode>/) || [])[1])
    const name = norm((body.match(/<name>([\s\S]*?)<\/name>/) || [])[1])
    const pics = [...body.matchAll(/<picture>([\s\S]*?)<\/picture>/g)]
      .map(p => norm(p[1]))
      .filter(Boolean)
    if (pics.length) offers.push({ vendorCode, name, picture: pics[0], pictures: pics })
  }
  return offers
}

// ── 2. Cloudinary: перезалить фото по удалённой ссылке ────────────────────────
async function toCloudinary(url) {
  const body = new URLSearchParams({ file: url, upload_preset: CLOUD_PRESET })
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, { method: 'POST', body })
  if (!res.ok) throw new Error(`Cloudinary ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json()).secure_url
}

// ── 3. Supabase: получить существующие sku и обновить image_url ───────────────
async function fetchExistingSkus() {
  const skus = new Set()
  const step = 1000
  for (let from = 0; ; from += step) {
    const res = await fetch(
      `${SUPA_URL}/rest/v1/products?select=sku&sku=not.is.null&limit=${step}&offset=${from}`,
      { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } },
    )
    if (!res.ok) throw new Error(`Supabase select ${res.status}`)
    const chunk = await res.json()
    chunk.forEach(r => r.sku && skus.add(norm(r.sku)))
    if (chunk.length < step) break
  }
  return skus
}

async function upsertImages(rows) {
  // resolution=merge-duplicates + on_conflict=sku → обновляет существующие, не создаёт новые
  const res = await fetch(`${SUPA_URL}/rest/v1/products?on_conflict=sku`, {
    method: 'POST',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  })
  if (!res.ok) throw new Error(`Supabase upsert ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

async function main() {
  console.log(`[images] YML: ${YML_URL}`)
  const xml = await (await fetch(YML_URL)).text()
  const offers = parseOffers(xml)
  console.log(`[images] офферов в фиде: ${offers.length}, с артикулом: ${offers.filter(o => o.vendorCode).length}`)

  const existing = await fetchExistingSkus()
  console.log(`[images] товаров в Supabase (с sku): ${existing.size}`)

  // Матч по артикулу
  const matched = offers.filter(o => o.vendorCode && existing.has(o.vendorCode))
  const unmatched = offers.filter(o => o.vendorCode && !existing.has(o.vendorCode)).length
  console.log(`[images] сматчено по артикулу: ${matched.length}, не найдено в БД: ${unmatched}, без артикула в фиде: ${offers.filter(o => !o.vendorCode).length}`)

  if (DRY) {
    console.log('[images] --dry-run: примеры совпадений:')
    matched.slice(0, 10).forEach(o => console.log(`   ${o.vendorCode}  ${o.name.slice(0, 40)}  →  ${o.picture}`))
    return
  }

  const rows = []
  let done = 0
  for (const o of matched) {
    let imageUrl = o.picture
    if (USE_CLOUDINARY) {
      try { imageUrl = await toCloudinary(o.picture) } catch (e) { console.warn(`   ! ${o.vendorCode}: ${e.message}`); continue }
    }
    rows.push({ sku: o.vendorCode, image_url: imageUrl, updated_at: new Date().toISOString() })
    if (rows.length >= 200) { await upsertImages(rows.splice(0)); done += 200; process.stdout.write(`\r[images] обновлено: ${done}`) }
  }
  if (rows.length) { await upsertImages(rows); done += rows.length }
  console.log(`\n[images] готово: обновлено ${done} товаров${USE_CLOUDINARY ? ' (фото перезалиты в Cloudinary)' : ' (ссылки на CDN InSales)'}`)
}

main().catch(e => { console.error('[images] ошибка:', e.message); process.exit(1) })
