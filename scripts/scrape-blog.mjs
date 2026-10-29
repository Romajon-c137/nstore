// ─── Перенос блога со старого сайта (InSales) в Supabase ──────────────────────
//
// Проходит по статьям блога из sitemap старого сайта, вытаскивает заголовок,
// обложку, краткое описание и HTML статьи, складывает в таблицу blog_posts.
// Слаг сохраняется (последний сегмент URL), поэтому редирект
// /blogs/blog/<slug> → /blog/<slug> сработает один-в-один.
//
// ЗАПУСК (на машине с интернетом; запись в blog_posts требует service_role):
//   node scripts/scrape-blog.mjs --supa-key SERVICE_ROLE_КЛЮЧ [--dry-run] [--limit N]
//
// БЕЗОПАСНО: body_html очищается от <script>/<style>/<iframe> и on*-атрибутов.

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const getArg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const SITEMAP = getArg('--sitemap', 'migration/old-sitemap.xml')
const DRY = args.includes('--dry-run')
const LIMIT = parseInt(getArg('--limit', '0'), 10) || 0

const SUPA_URL = process.env.SUPA_URL || 'https://znhwajycjdluzoypjejh.supabase.co'
const SUPA_KEY = getArg('--supa-key', process.env.SUPA_KEY) ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuaHdhanljamRsdXpveXBqZWpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NzU5MjQsImV4cCI6MjA5NTU1MTkyNH0.JfBN85sf_0Svi_jbRThH6KfdrpvMAPMA3wmCLu5X8JA'
const UA = 'Mozilla/5.0 (compatible; NstoreMigration/1.0)'

const norm = s => String(s || '').trim()
const attr = (html, prop) => norm((html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)`, 'i')) || [])[1])

// Очистка HTML статьи от опасных элементов
function sanitize(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '')
    .trim()
}

// Из региона вытаскиваем только осмысленные блоки статьи (абзацы, заголовки,
// списки, картинки, цитаты, таблицы), отбрасывая layout-обёртки, хлебные крошки
// и виджеты InSales. Заголовки h1 не берём — заголовок статьи выводится отдельно.
function extractContentBlocks(region) {
  const blocks = []
  const re = /<(p|h2|h3|h4|ul|ol|blockquote|figure|table)(?:\s[^>]*)?>[\s\S]*?<\/\1>|<img\s[^>]*>/gi
  let m
  while ((m = re.exec(region))) {
    const chunk = m[0]
    // пропускаем пустые абзацы и служебные вставки
    if (/^<p[^>]*>\s*(&nbsp;)?\s*<\/p>$/i.test(chunk)) continue
    blocks.push(chunk)
  }
  return blocks.join('\n')
}

// Извлечение тела статьи: сначала контентный виджет/article/main, затем — только
// осмысленные блоки из него.
function extractBody(html) {
  let region = ''
  let m = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
  if (m) region = m[1]
  else if ((m = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i))) region = m[1]
  else region = html
  const content = sanitize(extractContentBlocks(region))
  // если осмысленного контента почти нет — отдаём очищенный регион целиком (лучше, чем пусто)
  return content.length > 200 ? content : sanitize(region)
}

export function extractPost(html, slug) {
  const title = attr(html, 'og:title') || norm((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]) || norm((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1])
  const excerpt = attr(html, 'og:description') || attr(html, 'description')
  const cover = attr(html, 'og:image')
  const body = extractBody(html)
  return { slug, title, excerpt: excerpt || null, cover_image: cover || null, body_html: body || null }
}

async function upsertPosts(rows) {
  const res = await fetch(`${SUPA_URL}/rest/v1/blog_posts?on_conflict=slug`, {
    method: 'POST',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  })
  if (!res.ok) throw new Error(`Supabase upsert ${res.status}: ${(await res.text()).slice(0, 180)}`)
}

async function main() {
  if (!existsSync(SITEMAP)) { console.error(`Не найден sitemap: ${SITEMAP}`); process.exit(1) }
  const xml = await readFile(SITEMAP, 'utf8')
  let urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => norm(m[1]))
    .filter(u => /\/blogs\//.test(u))
    .filter(u => !/\/blogs\/blog\/tags\//.test(u))   // теги пропускаем
    .filter(u => !/\/blogs\/blog$/.test(u))          // индекс блога пропускаем
    .filter(u => !/[0-9a-f]{40}$/.test(u))           // хеш-дубликаты пропускаем
  if (LIMIT) urls = urls.slice(0, LIMIT)
  console.log(`[blog] статей к переносу: ${urls.length}`)

  const rows = []
  for (const url of urls) {
    const slug = url.replace(/\/+$/, '').split('/').pop()
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (!res.ok) { console.warn(`   ! ${slug}: HTTP ${res.status}`); continue }
      const post = extractPost(await res.text(), slug)
      if (!post.title) { console.warn(`   ! ${slug}: без заголовка, пропуск`); continue }
      rows.push({ ...post, updated_at: new Date().toISOString() })
      console.log(`   ✓ ${slug} — «${post.title.slice(0, 50)}»${post.body_html ? '' : ' (без тела!)'}`)
    } catch (e) { console.warn(`   ! ${slug}: ${e.message}`) }
  }

  console.log(`[blog] распознано: ${rows.length}, с телом: ${rows.filter(r => r.body_html).length}`)
  if (DRY) { console.log('[blog] --dry-run: в БД не записано'); return }
  if (rows.length) await upsertPosts(rows)
  console.log(`[blog] готово: записано ${rows.length} статей в blog_posts`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error('[blog] ошибка:', e.message); process.exit(1) })
}
