import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const map = JSON.parse(fs.readFileSync(path.join(__dirname, 'redirect-map.json'), 'utf8'));
const redirects = [];

// 1. Категории: /collection/<slug> → /catalog/<target>
for (const [old, target] of Object.entries(map.categories)) {
  redirects.push({
    source: '/collection/' + old,
    destination: '/catalog/' + target,
    permanent: true,
  });
}

// 2. Страницы: /page/<slug> → target (null = пропустить, страница есть на новом сайте)
for (const [old, target] of Object.entries(map.pages)) {
  if (target === null) continue;
  redirects.push({
    source: '/page/' + old,
    destination: target,
    permanent: true,
  });
}

// 3. Блог: конкретные посты идут до catch-all
const blog = map.blog;
for (const [slug, dest] of Object.entries(blog)) {
  if (slug.startsWith('_')) continue; // пропускаем служебные _note-ключи
  if (slug.startsWith('postavka-v-ofisy')) {
    // Этот пост лежит под /blogs/<slug>, а не /blogs/blog/<slug>
    redirects.push({ source: '/blogs/' + slug, destination: dest, permanent: true });
  } else {
    redirects.push({ source: '/blogs/blog/' + slug, destination: dest, permanent: true });
  }
}

// 4. Catch-all: всё остальное под /blogs/* → главная
redirects.push({ source: '/blogs/:path*', destination: '/', permanent: true });

const outPath = path.join(__dirname, 'redirects.generated.json');
fs.writeFileSync(outPath, JSON.stringify(redirects, null, 2));
console.log('Готово: ' + redirects.length + ' редиректов → ' + outPath);
