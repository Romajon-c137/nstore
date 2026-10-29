// ─── Счётчик фото у товаров в Supabase ───────────────────────────────────────
// Показывает: сколько активных товаров всего, у скольких есть фото, сколько без.
//
// ЗАПУСК (на машине с интернетом):
//   node scripts/count-images.mjs
//
// Читает только на чтение (анонимным ключом), в БД ничего не меняет.

const SUPA_URL = process.env.SUPA_URL || 'https://znhwajycjdluzoypjejh.supabase.co'
const SUPA_KEY =
  process.env.SUPA_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuaHdhanljamRsdXpveXBqZWpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NzU5MjQsImV4cCI6MjA5NTU1MTkyNH0.JfBN85sf_0Svi_jbRThH6KfdrpvMAPMA3wmCLu5X8JA'

async function count(qs) {
  const res = await fetch(`${SUPA_URL}/rest/v1/products?${qs}`, {
    method: 'HEAD',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Prefer: 'count=exact' },
  })
  if (!res.ok) throw new Error(`Supabase ${res.status}`)
  // Content-Range: 0-24/1197  → берём число после "/"
  const cr = res.headers.get('content-range') || '*/0'
  return parseInt(cr.split('/')[1] || '0', 10)
}

async function main() {
  const total = await count('select=id&is_active=eq.true')
  const withImg = await count('select=id&is_active=eq.true&image_url=not.is.null&image_url=neq.')
  const withoutImg = total - withImg
  const pct = total ? Math.round((withImg / total) * 100) : 0

  console.log('─────────────────────────────────────')
  console.log(`  Активных товаров:      ${total}`)
  console.log(`  С фото (image_url):    ${withImg}  (${pct}%)`)
  console.log(`  Без фото:              ${withoutImg}`)
  console.log('─────────────────────────────────────')

  if (withoutImg > 0) {
    const res = await fetch(
      `${SUPA_URL}/rest/v1/products?select=sku,name&is_active=eq.true&or=(image_url.is.null,image_url.eq.)&limit=10`,
      { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } },
    )
    const rows = await res.json()
    console.log('  Примеры товаров без фото:')
    rows.forEach(r => console.log(`   - ${r.sku || '(без арт.)'}  ${r.name}`))
  }
}

main().catch(e => { console.error('Ошибка:', e.message); process.exit(1) })
