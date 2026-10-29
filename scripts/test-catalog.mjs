import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

// Compile only the pure entity modules; no browser, credentials, or API requests.
const root = path.resolve(import.meta.dirname, '..', 'src')
const cache = new Map()
function load(name, parent = root) {
  let file = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(parent, name)
  if (!file.endsWith('.ts')) file += '.ts'
  if (cache.has(file)) return cache.get(file).exports
  const module = { exports: {} }
  cache.set(file, module)
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } })
  new Function('module', 'exports', 'require', outputText)(module, module.exports, dependency => load(dependency, path.dirname(file)))
  return module.exports
}
const { mapDjangoProduct } = load('@/entities/catalog/model/django-product')
const { productHref, findProduct } = load('@/entities/catalog/model/routes')
const { productSlug } = load('@/shared/lib/seo')
const product = { id: 'product-1', title: 'Кофе', slug: 'coffee', brand: 'Toreo', description: 'Описание товара', category: { id: 'coffee', name: 'Кофе', slug: 'coffee' }, variants: [] }
const variant = { id: 'variant-1', sku: '1001', barcode: '123', source_name: 'Кофе Toreo 1 кг', unit: 'шт', package_label: '1 кг', min_qty: '12', qty_step: '12', price: { amount: '8900.50' }, stock: '24', availability: 'sufficient', images: [{ url: '/secondary.jpg', is_primary: false }, { url: '/primary.jpg', is_primary: true }] }

test('Django card retains description, approved price, packaging and primary media', () => {
  const card = mapDjangoProduct(product, variant)
  assert.equal(card.description, product.description)
  assert.equal(card.price, 8900.5)
  assert.equal(card.minQty, 12)
  assert.equal(card.step, 12)
  assert.equal(card.stock, 24)
  assert.equal(card.image, '/primary.jpg')
  assert.equal(card.priceLists.wholesale, null, 'Never infer a hidden B2B price from public data')
})
test('Unknown prices and stock stay unknown, never become free or available', () => {
  const card = mapDjangoProduct(product, { ...variant, price: {}, stock: null, availability: 'unknown', images: [] })
  assert.equal(card.price, null)
  assert.equal(card.availability, 'unknown')
  assert.equal(card.image, null)
  assert.equal(mapDjangoProduct(product, { ...variant, price: { amount: 'not-a-number' } }).price, null)
})
test('New pages preserve the existing product slug format and resolve old ID links', () => {
  const card = mapDjangoProduct(product, variant)
  assert.equal(productHref(card), `/product/${productSlug({ name: variant.source_name, sku: variant.sku })}`)
  assert.equal(findProduct([card], productSlug(card)), card)
  assert.equal(findProduct([card], variant.id), card)
  assert.equal(findProduct([card], 'missing'), undefined)
})
