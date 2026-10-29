import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const origin = process.env.TEST_ORIGIN || 'http://localhost:3100'
const executablePath = process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync)
assert.ok(executablePath, 'Set CHROME_PATH to run browser checks')
const browser = await puppeteer.launch({ executablePath, headless: true })
const page = await browser.newPage()
await page.evaluateOnNewDocument(() => localStorage.setItem('nstore-install-dismissed-at', String(Date.now())))
const errors = []
page.on('pageerror', error => errors.push(error.message))
const output = path.resolve(import.meta.dirname, '../.next/qa')
await mkdir(output, { recursive: true })
try {
  await page.setViewport({ width: 1440, height: 1000 })
  await page.goto(`${origin}/shop?guest=1`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.sh-card-name', { timeout: 15000 })
  const productUrl = await page.$eval('.sh-card-name', element => element.getAttribute('href'))
  const productId = await page.$eval('.sh-card', element => element.getAttribute('data-product-id'))
  // Older synthetic fixtures may still use button cards; the final migrated
  // storefront must expose proper links.
  assert.ok(productUrl?.startsWith('/product/'), 'Catalog product must have an href')
  assert.ok(productId, 'Catalog product exposes its source id for the legacy link check')
  await page.screenshot({ path: path.join(output, 'catalog-desktop.png'), fullPage: true })
  await page.click('.sh-card-name')
  await page.waitForSelector('h1.sh-pd-name')
  assert.match(new URL(page.url()).pathname, /^\/product\//)
  assert.equal(await page.$('[role="dialog"]'), null, 'Product is a page, not a dialog')
  await page.waitForFunction(() => !document.querySelector('.sh-pd-buy button.sh-btn')?.disabled)
  await page.click('.sh-pd-buy button.sh-btn')
  await page.waitForFunction(() => Object.keys(localStorage).some(key => key.startsWith('nstore-shop-cart:') && JSON.parse(localStorage.getItem(key)).length > 0))
  const persisted = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('nstore-shop-cart:')).map(key => [key, localStorage.getItem(key)])))
  await page.screenshot({ path: path.join(output, 'product-desktop.png'), fullPage: true })
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('h1.sh-pd-name')
  assert.deepEqual(await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('nstore-shop-cart:')).map(key => [key, localStorage.getItem(key)]))), persisted)
  assert.equal(await page.$('[role="dialog"]'), null)
  const body = await (await fetch(`${origin}${productUrl}`)).text()
  assert.ok(body.includes('application/ld+json'), 'SSR product structured data')
  assert.ok(body.includes('sh-pd-name'), 'Product content rendered by server')
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
  await page.reload({ waitUntil: 'networkidle0' })
  await page.screenshot({ path: path.join(output, 'product-mobile.png'), fullPage: true })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'No horizontal overflow on mobile')
  await page.goto(`${origin}/shop?guest=1&p=${encodeURIComponent(productId)}`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => location.pathname.startsWith('/product/'), { timeout: 15000 })
  await page.goto(`${origin}/`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.lp-product-grid a[href^="/product/"]', { timeout: 15000 })
  await page.click('.lp-product-grid a[href^="/product/"]')
  await page.waitForSelector('h1.sh-pd-name')
  assert.equal(await page.$('.sh-pd-sheet[role="dialog"]'), null)
  await page.goto(`${origin}/opt`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('tbody a[href^="/product/"]', { timeout: 15000 })
  assert.equal(await page.$$eval('thead th', cells => cells.length), 4)
  const redirect = await fetch(`${origin}/crm/clients`, { redirect: 'manual' })
  const redirectBody = await redirect.text()
  assert.ok(redirect.headers.get('location') === '/crm/partners' || redirectBody.includes('/crm/partners'), 'CRM legacy route redirects (HTTP or streamed Next redirect)')
  await page.goto(`${origin}/crm/dash`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => location.pathname === '/login', { timeout: 15000 })
  await page.goto(`${origin}/cabinet`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => location.pathname === '/login', { timeout: 15000 })
  const missing = await fetch(`${origin}/product/not-a-real-product`)
  const missingBody = await missing.text()
  assert.ok(missing.status === 404 || missingBody.includes('NEXT_HTTP_ERROR_FALLBACK;404'), 'Unknown product has Next notFound semantics')
  assert.deepEqual(errors, [], 'No uncaught browser errors')
  console.log(JSON.stringify({ result: 'passed', productUrl, checks: ['catalog links', 'standalone product', 'cart persistence', 'SSR content and JSON-LD', 'mobile layout', 'legacy product URL', 'landing product links', 'wholesale price list', 'CRM redirect', 'CRM and cabinet guards', 'unknown product'], screenshots: output }, null, 2))
} finally { await browser.close() }
