// Generates /product/<old-slug> → /product/<new-slug> redirects for Vercel migration.
// Reuses extractFromHtml() from scrape-images-from-sitemap.mjs (same SKU extraction logic).
//
// USAGE:
//   node scripts/scrape-product-redirects.mjs --dry-run --limit 20
//   node scripts/scrape-product-redirects.mjs [--out migration/product-redirects.generated.json] [--unmapped migration/product-unmapped.txt]
//
// OPTIONS:
//   --dry-run         print results, write nothing
//   --limit N         process only first N product URLs
//   --concurrency N   parallel requests (default 3 — be gentle on old site)
//   --sitemap PATH    path to sitemap (default migration/old-sitemap.xml)
//   --out PATH        output JSON file for Vercel redirects
//   --unmapped PATH   output txt file for unmatched URLs

import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { extractFromHtml } from './scrape-images-from-sitemap.mjs'

// Slugify + productSlug — exact copy of logic in src/lib/seo.ts (TS can't be imported directly)
const TRANSLIT = {
  а:'a', б:'b', в:'v', г:'g', д:'d', е:'e', ё:'e', ж:'zh', з:'z',
  и:'i', й:'y', к:'k', л:'l', м:'m', н:'n', о:'o', п:'p', р:'r',
  с:'s', т:'t', у:'u', ф:'f', х:'h', ц:'ts', ч:'ch', ш:'sh', щ:'sch',
  ъ:'', ы:'y', ь:'', э:'e', ю:'yu', я:'ya',
}
function slugify(s) {
  if (!s) return ''
  return String(s).toLowerCase()
    .split('').map(c => (c in TRANSLIT ? TRANSLIT[c] : c)).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}
function productSlug(p) {
  const base = slugify(p.name)
  const sku  = p.sku ? slugify(String(p.sku)) : ''
  return sku ? `${base}-${sku}` : base
}

const args    = process.argv.slice(2)
const getArg  = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const DRY         = args.includes('--dry-run')
const LIMIT       = parseInt(getArg('--limit', '0'), 10) || 0
const CONCURRENCY = parseInt(getArg('--concurrency', '3'), 10) || 3
const SITEMAP     = getArg('--sitemap', 'migration/old-sitemap.xml')
const OUT_JSON    = getArg('--out',     'migration/product-redirects.generated.json')
const UNMAPPED    = getArg('--unmapped','migration/product-unmapped.txt')

const SUPA_URL = 'https://znhwajycjdluzoypjejh.supabase.co'
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuaHdhanljamRsdXpveXBqZWpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NzU5MjQsImV4cCI6MjA5NTU1MTkyNH0.JfBN85sf_0Svi_jbRThH6KfdrpvMAPMA3wmCLu5X8JA'
const UA = 'Mozilla/5.0 (compatible; NstoreMigration/1.0)'
const norm = s => String(s || '').trim()

async function fetchProducts() {
  const out = []
  const step = 1000
  for (let from = 0; ; from += step) {
    const res = await fetch(
      `${SUPA_URL}/rest/v1/products?select=sku,name&is_active=eq.true&limit=${step}&offset=${from}`,
      { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } }
    )
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`)
    const chunk = await res.json()
    out.push(...chunk)
    if (chunk.length < step) break
  }
  return out
}

async function pool(items, size, worker) {
  const results = []
  let i = 0
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const idx = i++; results[idx] = await worker(items[idx]) }
  })
  await Promise.all(runners)
  return results
}

async function main() {
  const xml = await readFile(SITEMAP, 'utf8')
  let urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map(m => norm(m[1]))
    .filter(u => /\/product\//.test(u))
  if (LIMIT) urls = urls.slice(0, LIMIT)
  console.log(`[redirects] товарных URL: ${urls.length} | concurrency: ${CONCURRENCY} | dry-run: ${DRY}`)

  const products = await fetchProducts()
  // Strip leading zeros from both map keys and lookup keys so e.g. "0056" matches "56"
  const normSku = s => s.toLowerCase().replace(/^0+(\d)/, '$1')
  const bySku = new Map()
  for (const p of products.filter(p => p.sku)) {
    bySku.set(normSku(norm(p.sku)), p)
  }
  console.log(`[redirects] товаров в Supabase: ${products.length} (с артикулом: ${bySku.size})`)

  const results = await pool(urls, CONCURRENCY, async (url) => {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (!res.ok) return { url, error: `HTTP ${res.status}` }
      const { sku } = extractFromHtml(await res.text())
      const oldSlug = new URL(url).pathname.replace(/^\/product\//, '')
      if (!sku) return { url, oldSlug, sku: null, matched: false }
      const p = bySku.get(normSku(sku))
      if (!p) return { url, oldSlug, sku, matched: false }
      const newSlug = productSlug(p)
      return { url, oldSlug, sku, matched: true, newSlug, changed: oldSlug !== newSlug }
    } catch (e) {
      return { url, error: e.message }
    }
  })

  const redirects = []
  const unmapped  = []
  let unchanged   = 0

  for (const r of results) {
    if (!r) continue
    if (r.error)    { unmapped.push(`${r.url}\t[error: ${r.error}]`); continue }
    if (!r.matched) { unmapped.push(`${r.url}\t${r.sku || 'no-sku'}`); continue }
    if (!r.changed) { unchanged++; continue }
    redirects.push({ source: `/product/${r.oldSlug}`, destination: `/product/${r.newSlug}`, permanent: true })
  }

  console.log(
    `[redirects] редиректов: ${redirects.length} | без изменений: ${unchanged} | не найдено: ${unmapped.length}`
  )

  if (DRY) {
    console.log('\n── Redirects ──────────────────────────────')
    redirects.forEach(r => console.log(`  ${r.source}`))
    console.log(`       → (destination /product/<new-slug> shown below)`)
    redirects.forEach(r => console.log(`  ${r.source}  →  ${r.destination}`))
    if (unmapped.length) {
      console.log('\n── Unmapped ───────────────────────────────')
      unmapped.forEach(u => console.log(' ', u))
    }
    return
  }

  await writeFile(OUT_JSON, JSON.stringify(redirects, null, 2), 'utf8')
  await writeFile(UNMAPPED, unmapped.join('\n') + (unmapped.length ? '\n' : ''), 'utf8')
  console.log(`[redirects] → ${OUT_JSON} (${redirects.length} entries)`)
  console.log(`[redirects] → ${UNMAPPED} (${unmapped.length} entries)`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error('[redirects] ошибка:', e.message); process.exit(1) })
}
