'use client'

import { byShowcase,fmt,getSectionStyle,PAGE_SIZE,ProductImageArea,type CartItem,type DbProduct } from '@/entities/content'
import { Link } from '@/shared/lib/navigation'
import { productSlug } from '@/shared/lib/seo'
import type { CSSProperties } from 'react'
import { useEffect,useState } from 'react'

export default function ProductsBlock({ p, products, cart, onAdd, onRemove, activeSection }: {
  p: Record<string, unknown>
  products: DbProduct[]
  cart: CartItem[]
  onAdd: (product: DbProduct) => void
  onRemove: (productId: string) => void
  activeSection: string
}) {
  const sectionProp = (p.section as string) || ''
  const manual = p.mode === 'manual'
  const productIds = Array.isArray(p.productIds) ? (p.productIds as string[]) : []
  const columns = typeof p.columns === 'number' && p.columns >= 2 && p.columns <= 6 ? p.columns : 6
  const initialCount = typeof p.count === 'number' && p.count > 0 ? p.count : PAGE_SIZE
  const [visible, setVisible] = useState(initialCount)

  // Reset pagination when filter changes
  useEffect(() => { setVisible(initialCount) }, [activeSection, initialCount])

  let filtered: DbProduct[]
  if (manual) {
    // Curated showcase: show hand-picked products in the chosen order (as selected)
    const byId = new Map(products.map(pr => [pr.id, pr]))
    filtered = productIds.map(id => byId.get(id)).filter(Boolean) as DbProduct[]
  } else {
    const filter = activeSection || sectionProp
    filtered = (filter ? products.filter(pr => pr.section_name === filter) : products)
      .filter(pr => pr.price != null)                                // скрываем товары без цены
      .sort(byShowcase)                                              // приоритет из CRM → в наличии → по имени
  }
  // Manual selections are usually short — show them all; sections paginate
  const shown = manual ? filtered : filtered.slice(0, visible)
  const remaining = manual ? 0 : filtered.length - visible

  function getCartQty(productId: string) {
    return cart.find(item => item.product.id === productId)?.qty ?? 0
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 28px 14px', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, margin: 0 }}>{(p.title as string) || 'Популярное'}</h2>
        <div style={{ fontSize: 13, color: '#8A968E' }}>{filtered.length} товаров</div>
      </div>
      <div className="lp-product-grid" style={{ ['--lp-cols' as string]: columns } as CSSProperties}>
        {shown.map((pr, i) => {
          const style = getSectionStyle(pr.section_name, i)
          const qty = getCartQty(pr.id)
          const available = (pr.stock ?? 0) - (pr.reserved_qty ?? 0)
          const inStock = available > 0

          return (
            <article
              key={pr.id}
              style={{ border: '1px solid #EDF1EF', borderRadius: 18, padding: 11, display: 'flex', flexDirection: 'column', background: '#fff', opacity: inStock ? 1 : .75, cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(16,40,28,.08)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
            >
              {/* Image */}
              <div style={{ marginBottom: 10 }}>
                <Link href={`/product/${productSlug(pr)}`} aria-label={pr.name}><ProductImageArea product={pr} style={style} /></Link>
              </div>

              {/* Meta */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                {pr.sku && <div style={{ fontSize: 10, color: '#B0BCB5', fontWeight: 600 }}>Арт. {pr.sku}</div>}
                {pr.box_qty != null && <div style={{ fontSize: 10, color: '#B0BCB5', fontWeight: 600 }}>Кейс {pr.box_qty} шт</div>}
              </div>
              {pr.vol && <div style={{ fontSize: 11, color: '#8A968E', fontWeight: 600, marginBottom: 2 }}>{pr.vol}</div>}
              <h3 style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3, color: '#1A2A21', flex: 1, marginBottom: 8, margin: '0 0 8px' }}><Link href={`/product/${productSlug(pr)}`}>{pr.name}</Link></h3>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15 }}>
                  {pr.price != null ? fmt(pr.price) : '—'}
                </div>
                {qty === 0 ? (
                  <button
                    onClick={e => { e.stopPropagation(); onAdd(pr) }}
                    style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--primary)', color: '#fff', border: 'none', fontSize: 20, fontWeight: 700, cursor: 'pointer', lineHeight: 1, flexShrink: 0 }}
                  >+</button>
                ) : (
                  <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <button onClick={() => onRemove(pr.id)} style={{ width: 30, height: 30, borderRadius: 8, border: '1.5px solid #EDF1EF', background: '#fff', cursor: 'pointer', fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#DC2626' }}>−</button>
                    <span style={{ fontSize: 14, fontWeight: 700, minWidth: 16, textAlign: 'center' }}>{qty}</span>
                    <button onClick={() => onAdd(pr)} style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: 'var(--primary)', cursor: 'pointer', fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>+</button>
                  </div>
                )}
              </div>
            </article>
          )
        })}
      </div>
      {remaining > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 28px 8px' }}>
          <button
            onClick={() => setVisible(v => v + PAGE_SIZE)}
            style={{ background: '#F2F5F3', border: 'none', borderRadius: 13, padding: '12px 26px', fontFamily: 'inherit', fontSize: 14, fontWeight: 700, color: '#1C2A22', cursor: 'pointer' }}
          >
            Показать ещё ({shown.length} из {filtered.length})
          </button>
        </div>
      )}


    </>
  )
}
