// ─── Генератор 301-редиректов для переезда со старого сайта (InSales) ─────────
//
// Строит карту редиректов старый URL → новый URL для vercel.json, чтобы при
// переезде домена nstore.kz не потерять позиции в Google/Yandex.
//
// Источники:
//   • Товары   — из YML-фида берём пару «URL старой страницы ↔ артикул», новый
//     URL строим из товаров Supabase по тому же артикулу (sku).
//   • Категории/страницы/блог — из migration/redirect-map.json (проверяемый
//     человеком файл; черновик уже сгенерирован по sitemap).
//   • Всё, чему не нашлось пары, попадает в unmapped.txt.
//
// ЗАПУСК (на машине с интернетом):
//   node scripts/build-redirects.mjs --yml "<YML_URL|файл>" [--sitemap migration/old-sitemap.xml] [--map migration/redirect-map.json] [--products products.json]
//
// Результат:
//   redirects.generated.json  — массив redirects для вставки в vercel.json
//   unmapped.txt              — старые URL без пары

import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const args = process.argv.slice(2)
const getArg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const YML = getArg('--yml')
const SITEMAP = getArg('--sitemap') || 'migration/old-sitemap.xml'
const MAP_FILE = getArg('--map') || 'migration/redirect-map.json'
const PRODUCTS_FILE = getArg('--products')

const SUPA_URL = process.env.SUPA_URL || 'https://znhwajycjdluzoypjejh.supabase.co'
const SUPA_KEY =
  process.env.SUPA_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuaHdhanljamRsdXpveXBqZWpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NzU5MjQsImV4cCI6MjA5NTU1MTkyNH0.JfBN85sf_0Svi_jbRThH6KfdrpvMAPMA3wmCLu5X8JA'

// ── Транслит/слаг (идентично src/lib/seo.ts) ──────────────────────────────────
const TRANSLIT = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' }
const slugify = (s) => !s ? '' : String(s).toLowerCase().split('').map(c => c in TRANSLIT ? TRANSLIT[c] : c).join('').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)
const productSlug = (p) => p.sku ? `${slugify(p.name)}-${slugify(p.sku)}` : slugify(p.name)
const norm = (s) => String(s || '').trim()
const pathOf = (u) => { try { return new URL(u).pathname } catch { return norm(u).startsWith('/') ? norm(u) : null } }

async function loadText(src) {
  if (!src) return ''
  if (existsSync(src)) return readFile(src, 'utf8')
  return (await fetch(src)).text()
}
async function loadJson(src, fallback) {
  if (!src || !existsSync(src)) return fallback
  return JSON.parse(await readFile(src, 'utf8'))
}

// YML offer → { url, sku }
function parseYmlOffers(xml) {
  const out = []
  const re = /<offer\b[^>]*>([\s\S]*?)<\/offer>/g
  let m
  while ((m = re.exec(xml))) {
    const body = m[1]
    const sku = norm((body.match(/<vendorCode>([\s\S]*?)<\/vendorCode>/) || [])[1])
    const url = norm((body.match(/<url>([\s\S]*?)<\/url>/) || [])[1])
    if (sku && url) out.push({ sku, url })
  }
  return out
}

async function loadNewProducts() {
  if (PRODUCTS_FILE) return JSON.parse(await readFile(PRODUCTS_FILE, 'utf8'))
  const out = []
  const step = 1000
  for (let from = 0; ; from += step) {
    const res = await fetch(`${SUPA_URL}/rest/v1/products?select=sku,name&is_active=eq.true&limit=${step}&offset=${from}`,
      { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } })
    if (!res.ok) throw new Error(`Supabase ${res.status}`)
    const chunk = await res.json()
    out.push(...chunk)
    if (chunk.length < step) break
  }
  return out
}

async function main() {
  const map = await loadJson(MAP_FILE, { categories: {}, pages: {}, blogFallback: null })
  const sitemapLocs = SITEMAP && existsSync(SITEMAP)
    ? [...(await loadText(SITEMAP)).matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map(m => pathOf(norm(m[1]))).filter(Boolean)
    : []

  const redirects = []
  const unmapped = []
  const seen = new Set()
  const add = (source, destination) => { if (source && destination && source !== destination && !seen.has(source)) { seen.add(source); redirects.push({ source, destination, permanent: true }) } }

  // ── Товары (нужен YML) ──────────────────────────────────────────────────────
  if (YML) {
    const offers = parseYmlOffers(await loadText(YML))
    const products = await loadNewProducts()
    const bySku = new Map(products.filter(p => p.sku).map(p => [norm(p.sku), p]))
    console.log(`[redirects] YML офферов: ${offers.length}, товаров в Supabase: ${products.length}`)
    for (const o of offers) {
      const src = pathOf(o.url)
      const p = bySku.get(o.sku)
      if (!src) continue
      if (!p) { unmapped.push(`ТОВАР без пары (sku=${o.sku}): ${src}`); continue }
      add(src, `/product/${productSlug(p)}`)
    }
  } else {
    console.log('[redirects] YML не указан — редиректы товаров пропущены (запустите с --yml).')
  }

  // ── Категории (из карты) ────────────────────────────────────────────────────
  for (const [oldSlug, newSlug] of Object.entries(map.categories || {})) {
    if (newSlug) add(`/collection/${oldSlug}`, newSlug.startsWith('/') ? newSlug : `/catalog/${newSlug}`)
  }

  // ── Страницы (из карты) ─────────────────────────────────────────────────────
  for (const [oldSlug, target] of Object.entries(map.pages || {})) {
    if (target) add(`/page/${oldSlug}`, target.startsWith('/') ? target : `/page/${target}`)
  }

  // ── Блог: сохраняем слаг (/blogs/blog/<slug> → /blog/<slug>) ─────────────────
  for (const path of sitemapLocs) {
    if (!path.startsWith('/blogs/')) continue
    if (path === '/blogs/blog' || path === '/blogs') { add(path, '/blog'); continue }
    if (path.includes('/tags/')) { add(path, '/blog'); continue }
    if (/[0-9a-f]{40}\/?$/.test(path)) { add(path, '/blog'); continue } // хеш-дубликаты
    const slug = path.replace(/\/+$/, '').split('/').pop()
    add(path, `/blog/${slug}`)
  }

  // ── Отчёт о непокрытом ──────────────────────────────────────────────────────
  for (const path of sitemapLocs) {
    if (seen.has(path) || path === '/') continue
    if (path.startsWith('/collection/')) {
      const s = path.split('/')[2]
      if (!map.categories?.[s]) unmapped.push(`КАТЕГОРИЯ без пары: ${path}`)
    } else if (path.startsWith('/page/')) {
      const s = path.split('/')[2]
      if (!(s in (map.pages || {}))) unmapped.push(`СТРАНИЦА без пары: ${path}`)
    } else if (path.startsWith('/blogs/') && !map.blogFallback) {
      unmapped.push(`БЛОГ без пары: ${path}`)
    } else if (path.startsWith('/product/') && !YML) {
      unmapped.push(`ТОВАР (нужен YML): ${path}`)
    }
  }

  await writeFile('redirects.generated.json', JSON.stringify(redirects, null, 2), 'utf8')
  await writeFile('unmapped.txt', unmapped.join('\n') + '\n', 'utf8')
  console.log(`[redirects] сгенерировано: ${redirects.length}, без пары: ${unmapped.length}`)
  console.log('[redirects] вставьте redirects.generated.json в "redirects" файла vercel.json')
}

main().catch(e => { console.error('[redirects] ошибка:', e.message); process.exit(1) })
