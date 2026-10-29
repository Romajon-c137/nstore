import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '..', 'src')
const levels = ['app', 'views', 'widgets', 'features', 'entities', 'shared']
async function walk(dir) {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]))).flat()
}
const errors = []
for (const file of await walk(root)) {
  if (!/\.[jt]sx?$/.test(file)) continue
  const relative = path.relative(root, file).replaceAll('\\', '/')
  const [layer, slice] = relative.split('/')
  const text = await readFile(file, 'utf8')
  for (const [, target] of text.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"](@\/[^'"]+)['"]/g)) {
    const [targetLayer, targetSlice] = target.slice(2).split('/')
    if (!levels.includes(targetLayer)) continue
    if (levels.indexOf(targetLayer) < levels.indexOf(layer) || (layer !== 'shared' && layer !== 'app' && targetLayer === layer && targetSlice !== slice)) errors.push(`${relative} → ${target}`)
    const externalSlice = targetLayer !== 'shared' && (targetLayer !== layer || targetSlice !== slice)
    if (externalSlice && target.slice(2).split('/').length > 2 && !target.endsWith('/server')) errors.push(`${relative}: use public API instead of ${target}`)
  }
  if (/react-router-dom|import\.meta\.env/.test(text)) errors.push(`${relative}: obsolete Vite/router dependency`)
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1 }
else console.log('FSD dependency boundaries and Next.js migration checks passed')
