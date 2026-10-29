// ─── Перенос фото товаров со старого сайта БЕЗ YML (скрап по sitemap) ─────────
//
// Когда YML-фида нет: проходим по товарным URL из sitemap старого сайта,
// вытаскиваем фото (JSON-LD Product.image или og:image) и артикул со страницы,
// матчим с товарами Supabase по артикулу (или по названию) и проставляем
// image_url.
//
// ЗАПУСК (на машине с доступом в интернет — НЕ в песочнице):
//   node scripts/scrape-images-from-sitemap.mjs [--sitemap migration/old-sitemap.xml] [--cloudinary] [--dry-run] [--limit N] [--concurrency 5]
//
// Опции:
//   --dry-run       только показать, что нашлось/сматчилось, без записи в БД
//   --cloudinary    перезалить фото в Cloudinary (иначе — прямая ссылка на CDN InSales)
//   --limit N       обработать только первые N товаров (для теста)
//   --concurrency   число параллельных запросов (по умолчанию 5)
//   --cloud <name>  ваш Cloudinary Cloud name (или env CLOUDINARY_CLOUD_NAME)
//   --preset <name> unsigned upload preset (или env CLOUDINARY_UPLOAD_PRESET)
//   --api-key <k>   Cloudinary API Key   — включает НАДЁЖНУЮ подписанную загрузку
//   --api-secret <s> Cloudinary API Secret (пресет не нужен). НЕ коммитить секрет!
//   --supa-key <k>  Supabase service_role ключ — нужен для записи в products
//                   (обходит RLS). Секрет! Только в команде/env, не в коде.
//
// БЕЗОПАСНО: обновляет только существующие товары (по sku). Новых не создаёт.

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const args = process.argv.slice(2)
const getArg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const SITEMAP = getArg('--sitemap', 'migration/old-sitemap.xml')
const DRY = args.includes('--dry-run')
const USE_CLOUDINARY = args.includes('--cloudinary')
const LIMIT = parseInt(getArg('--limit', '0'), 10) || 0
const CONCURRENCY = parseInt(getArg('--concurrency', '5'), 10) || 5

const SUPA_URL = process.env.SUPA_URL || 'https://znhwajycjdluzoypjejh.supabase.co'
// Для записи в products нужен service_role ключ (обходит RLS). Приоритет: аргумент → env → anon (только чтение).
const SUPA_KEY =
  getArg('--supa-key', process.env.SUPA_KEY) ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuaHdhanljamRsdXpveXBqZWpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NzU5MjQsImV4cCI6MjA5NTU1MTkyNH0.JfBN85sf_0Svi_jbRThH6KfdrpvMAPMA3wmCLu5X8JA'
// Cloud name и upload preset (для unsigned-режима). Приоритет: аргумент → env → дефолт.
const CLOUD_NAME = getArg('--cloud', process.env.CLOUDINARY_CLOUD_NAME || 'dwbmwxm2l')
const CLOUD_PRESET = getArg('--preset', process.env.CLOUDINARY_UPLOAD_PRESET || 'ml_default')
// Подписанный режим (надёжнее, не требует unsigned-пресета): API Key + Secret.
const CLOUD_API_KEY = getArg('--api-key', process.env.CLOUDINARY_API_KEY || '')
const CLOUD_API_SECRET = getArg('--api-secret', process.env.CLOUDINARY_API_SECRET || '')
const CLOUD_SIGNED = !!(CLOUD_API_KEY && CLOUD_API_SECRET)
const UA = 'Mozilla/5.0 (compatible; NstoreMigration/1.0)'

const norm = (s) => String(s || '').trim()
const normName = (s) => norm(s).toLowerCase().replace(/[«»"'`]/g, '').replace(/\s+/g, ' ').replace(/[.,]/g, '')

// ── Извлечение из HTML страницы товара: { sku, name, image } ──────────────────
export function extractFromHtml(html) {
  let sku = '', name = '', image = ''
  // 1) JSON-LD Product (самый надёжный источник)
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1].trim())
      const arr = Array.isArray(data) ? data : (data['@graph'] || [data])
      for (const node of arr) {
        const t = node && node['@type']
        const isProduct = t === 'Product' || (Array.isArray(t) && t.includes('Product'))
        if (isProduct) {
          sku = sku || norm(node.sku || node.mpn)
          name = name || norm(node.name)
          const img = Array.isArray(node.image) ? node.image[0] : node.image
          image = image || norm(typeof img === 'object' ? img?.url : img)
        }
      }
    } catch { /* невалидный JSON-LD — пропускаем */ }
  }
  // 2) og:image / og:title (fallback)
  if (!image) image = norm((html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) || [])[1])
  if (!name) name = norm((html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || [])[1])
  // 3) Артикул из текста страницы (fallback)
  if (!sku) sku = norm((html.match(/Артикул[:\s]*<[^>]*>?\s*([A-Za-z0-9._\-\/]+)/i) || [])[1])
  return { sku, name, image }
}

async function fetchProducts() {
  const out = []
  const step = 1000
  for (let from = 0; ; from += step) {
    const res = await fetch(`${SUPA_URL}/rest/v1/products?select=sku,name&is_active=eq.true&limit=${step}&offset=${from}`,
      { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } })
    if (!res.ok) throw new Error(`Supabase select ${res.status}`)
    const chunk = await res.json()
    out.push(...chunk)
    if (chunk.length < step) break
  }
  return out
}

async function toCloudinary(url) {
  let body
  if (CLOUD_SIGNED) {
    // Подписанная загрузка: подписываем timestamp секретом (SHA-1), пресет не нужен.
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = createHash('sha1').update(`timestamp=${timestamp}${CLOUD_API_SECRET}`).digest('hex')
    body = new URLSearchParams({ file: url, api_key: CLOUD_API_KEY, timestamp: String(timestamp), signature })
  } else {
    body = new URLSearchParams({ file: url, upload_preset: CLOUD_PRESET })
  }
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, { method: 'POST', body })
  if (!res.ok) throw new Error(`Cloudinary ${res.status}: ${(await res.text()).slice(0, 160)}`)
  return (await res.json()).secure_url
}

// PATCH только обновляет существующий товар по sku — ничего не вставляет.
async function patchImage(sku, imageUrl) {
  const res = await fetch(`${SUPA_URL}/rest/v1/products?sku=eq.${encodeURIComponent(sku)}`, {
    method: 'PATCH',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ image_url: imageUrl, updated_at: new Date().toISOString() }),
  })
  if (!res.ok) throw new Error(`Supabase patch ${res.status}: ${(await res.text()).slice(0, 160)}`)
}

// Простой пул параллельных задач
async function pool(items, size, worker) {
  const results = []
  let i = 0
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await worker(items[idx], idx) }
  })
  await Promise.all(runners)
  return results
}

async function main() {
  if (!existsSync(SITEMAP)) { console.error(`Не найден sitemap: ${SITEMAP}`); process.exit(1) }
  const xml = await readFile(SITEMAP, 'utf8')
  let urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => norm(m[1])).filter(u => /\/product\//.test(u))
  if (LIMIT) urls = urls.slice(0, LIMIT)
  console.log(`[scrape] товарных URL: ${urls.length}, параллельно: ${CONCURRENCY}`)

  const products = await fetchProducts()
  const bySku = new Map(products.filter(p => p.sku).map(p => [norm(p.sku), p]))
  const byName = new Map(products.map(p => [normName(p.name), p]))
  console.log(`[scrape] товаров в Supabase: ${products.length}`)

  let fetched = 0, matched = 0, noImage = 0, noMatch = 0
  const found = await pool(urls, CONCURRENCY, async (url) => {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (!res.ok) return null
      const { sku, name, image } = extractFromHtml(await res.text())
      fetched++
      if (!image) { noImage++; return null }
      const p = (sku && bySku.get(sku)) || byName.get(normName(name))
      if (!p) { noMatch++; return null }
      matched++
      return { sku: p.sku, image }
    } catch { return null }
  })

  const hits = found.filter(Boolean)
  console.log(`[scrape] загружено страниц: ${fetched}, с фото: ${fetched - noImage}, сматчено: ${matched}, без фото: ${noImage}, без пары: ${noMatch}`)

  if (DRY) {
    hits.slice(0, 10).forEach(h => console.log(`   ${h.sku}  →  ${h.image}`))
    return
  }

  let done = 0, cloudErrors = 0, writeErrors = 0
  await pool(hits, CONCURRENCY, async (h) => {
    let imageUrl = h.image
    if (USE_CLOUDINARY) {
      try { imageUrl = await toCloudinary(h.image) }
      catch (e) { if (cloudErrors++ < 3) console.warn(`   ! Cloudinary: ${e.message}`); return }
    }
    try {
      await patchImage(h.sku, imageUrl)
      if (++done % 50 === 0) process.stdout.write(`\r[scrape] обновлено: ${done}`)
    } catch (e) {
      if (writeErrors++ < 3) console.warn(`   ! Supabase: ${e.message}`)
    }
  })
  const mode = USE_CLOUDINARY ? ` (Cloudinary${CLOUD_SIGNED ? ', signed' : ', unsigned'})` : ' (ссылки CDN InSales)'
  console.log(`\n[scrape] готово: обновлено ${done} товаров${mode}`)
}

// Запуск только при прямом вызове (не при импорте в тестах).
// pathToFileURL корректно работает и на Windows (обратные слэши, диск C:).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error('[scrape] ошибка:', e.message); process.exit(1) })
}
