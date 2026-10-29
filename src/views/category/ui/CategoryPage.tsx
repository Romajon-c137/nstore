import { ProductImage,fmtMoney,productHref,type CatalogProduct } from '@/entities/catalog'
import { Link } from '@/shared/lib/navigation'
import { SITE,breadcrumbLd,itemListLd } from '@/shared/lib/seo'
import JsonLd from '@/shared/ui/JsonLd'

const pageShell: React.CSSProperties = {
  minHeight: '100dvh',
  background: '#EEF1F0',
  fontFamily: "var(--font-onest), system-ui, sans-serif",
  color: '#12201A',
}

function showcaseOrder(a: CatalogProduct, b: CatalogProduct) {
  const priority = (a.priority ?? Infinity) - (b.priority ?? Infinity)
  if (priority) return priority
  const stock = Number((b.stock ?? 0) > 0) - Number((a.stock ?? 0) > 0)
  return stock || a.name.localeCompare(b.name, 'ru')
}

export default function CategoryPage({ slug, name, products }: { slug: string; name: string; products: CatalogProduct[] }) {
  const visible = [...products].sort(showcaseOrder)
  const canonical = `${SITE}/catalog/${slug}`
  const ldProducts = visible.map(product => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
    vol: product.package,
    price: product.price,
    section_name: product.subcategory,
    description: product.description,
    image_url: product.image,
    stock: product.stock,
  }))

  return (
    <div style={pageShell}>
      <JsonLd data={[
        itemListLd(ldProducts, canonical),
        breadcrumbLd([{ name: 'Главная', url: SITE }, { name, url: canonical }]),
      ]} />
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 20px 80px' }}>
        <nav aria-label="Хлебные крошки" style={{ fontSize: 13, color: '#5C6B63', marginBottom: 16, display: 'flex', gap: 6 }}>
          <Link href="/" style={{ color: '#5C6B63' }}>Главная</Link>
          <span>/</span>
          <span style={{ color: '#12201A' }}>{name}</span>
        </nav>
        <header style={{ marginBottom: 20 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: '#12201A' }}>{name} оптом</h1>
          <p style={{ fontSize: 14, color: '#5C6B63', marginTop: 6 }}>{visible.length} товаров · оптовые цены от дистрибьютора в Астане</p>
        </header>
        <ul className="lp-product-grid" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {visible.map(product => (
            <li key={product.id}>
              <Link href={productHref(product)} style={{ display: 'flex', flexDirection: 'column', border: '1px solid #EDF1EF', borderRadius: 18, padding: 11, background: '#fff', textDecoration: 'none', color: 'inherit', height: '100%' }}>
                <div style={{ marginBottom: 10 }}><ProductImage product={product} /></div>
                {product.sku && <div style={{ fontSize: 10, color: '#B0BCB5', fontWeight: 600, marginBottom: 3 }}>Арт. {product.sku}</div>}
                {product.package && <div style={{ fontSize: 11, color: '#8A968E', fontWeight: 600, marginBottom: 2 }}>{product.package}</div>}
                <h2 style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3, color: '#1A2A21', flex: 1, marginBottom: 8 }}>{product.name}</h2>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>{product.price == null ? '—' : fmtMoney(product.price)}</div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
