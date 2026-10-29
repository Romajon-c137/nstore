'use client'

import { CATEGORY_NAME,clampQty,fmtMoney,IconBack,IconHeart,IconPlus,ProductImage,resolvePrice,Stepper,type CatalogProduct,type PricingContext } from '@/entities/catalog'
import { availabilityBadge,unitNote,type Cart } from '@/features/shopping'
import { useEffect,useState } from 'react'

type Tab = 'desc' | 'attrs' | 'docs'

export function ProductDetails({ product, variants, pricing, cart, isFav, onToggleFav, onPick, onClose }: {
  product: CatalogProduct; variants: CatalogProduct[]; pricing: PricingContext; cart: Cart
  isFav: boolean; onToggleFav: () => void; onPick: (p: CatalogProduct) => void; onClose: () => void
}) {
  const p = product
  const inCart = cart.qtyOf(p.id)
  const [qty, setQty] = useState(inCart || p.minQty)
  useEffect(() => setQty(cart.qtyOf(p.id) || p.minQty), [p.id]) // eslint-disable-line react-hooks/exhaustive-deps



  const { unitPrice, compareAt, isPersonal } = resolvePrice(p, pricing, qty)
  const stock = availabilityBadge(p)
  const attrs = Object.entries(p.attributes)
  const tabs = ([['desc', 'Описание', !!p.description], ['attrs', 'Характеристики', attrs.length > 0], ['docs', 'Документы', p.documents.length > 0]] as const)
    .filter(t => t[2])
  const [tab, setTab] = useState<Tab>(tabs[0]?.[0] ?? 'attrs')
  const changed = qty !== inCart

  function commit() { cart.setQty(p, qty) }

  const heart = (
    <button className={`sh-fav${isFav ? ' on' : ''}`} onClick={onToggleFav} aria-pressed={isFav} aria-label={isFav ? 'Убрать из избранного' : 'В избранное'}>
      <IconHeart filled={isFav} />
    </button>
  )

  return (
    <>
      <article className="sh-product-detail" aria-label={p.name}>
        <div className="sh-pd-bar sh-mob">
          <button className="sh-back" onClick={onClose} aria-label="Назад"><IconBack size={22} /></button>
          {heart}
        </div>
        <div className="sh-pd">
          <div className="sh-pd-media">
            <ProductImage product={p} eager />
            <div className="sh-desk" style={{ position: 'absolute', top: 16, right: 16 }}>{heart}</div>
          </div>

          <div className="sh-pd-info">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <h1 className="sh-pd-name" style={{ flex: 1 }}>{p.name}</h1>
            </div>
            {p.package && <div className="sh-pd-spec">{p.package}</div>}
            <div className="sh-pd-brand">{[p.brand, CATEGORY_NAME[p.category]].filter(Boolean).join(' · ')}</div>

            {variants.length > 1 && (
              <div className="sh-vars" role="radiogroup" aria-label="Фасовка" style={{ marginTop: 14 }}>
                {variants.map(v => (
                  <button key={v.id} role="radio" aria-checked={v.id === p.id} className={`sh-var lg${v.id === p.id ? ' on' : ''}`} onClick={() => onPick(v)}>
                    {v.variantLabel}
                  </button>
                ))}
              </div>
            )}

            <div className="sh-pd-price">
              <div>
                <span className="sh-price">{unitPrice != null ? fmtMoney(unitPrice) : 'Цена по запросу'}</span>
                {compareAt && <span className="sh-old" style={{ marginLeft: 8 }}>{fmtMoney(compareAt)}</span>}
                <div className="sh-unit">{unitNote(p)}</div>
              </div>
              <span className={`sh-stock${stock ? ' warn' : ''}`}>{stock ? stock.text : 'В наличии'}</span>
            </div>
            <div className="sh-pd-note">
              {isPersonal ? 'Ваша цена по договору' : pricing.customerId ? 'Оптовая цена' : 'Оптовые цены — после входа'}
              {p.minQty > p.step && ` · минимум ${p.minQty} ${p.unit}`}
            </div>
            {p.priceTiers.length > 0 && (
              <div className="sh-vars" style={{ marginTop: 10 }}>
                {p.priceTiers.map(t => <span key={t.minQty} className="sh-var">от {t.minQty} {p.unit} — {fmtMoney(t.price)}</span>)}
              </div>
            )}

            <div className="sh-pd-buy">
              <Stepper
                qty={qty}
                unit={p.step > 1 ? `${qty / p.step} кор.` : undefined}
                tone="light"
                onInc={() => setQty(q => clampQty(p, Math.max(q + p.step, p.minQty)))}
                onDec={() => setQty(q => (q - p.step < p.minQty ? (inCart ? 0 : p.minQty) : q - p.step))}
              />
              <button className="sh-btn primary lg" disabled={unitPrice == null || (!changed && inCart > 0)} onClick={commit}>
                {qty === 0 ? 'Убрать из корзины'
                  : inCart > 0 ? (changed ? `Обновить · ${fmtMoney((unitPrice ?? 0) * qty)}` : 'В корзине')
                  : <><IconPlus size={18} /> В корзину</>}
              </button>
            </div>

            {tabs.length > 0 && (
              <>
                <div className="sh-ptabs" role="tablist">
                  {tabs.map(([id, title]) => (
                    <button key={id} role="tab" aria-selected={tab === id} className={`sh-ptab${tab === id ? ' on' : ''}`} onClick={() => setTab(id)}>{title}</button>
                  ))}
                </div>
                <div className="sh-ptab-body">
                  {tab === 'desc' && p.description}
                  {tab === 'attrs' && (
                    <dl className="sh-kv">
                      {attrs.map(([k, v]) => <div key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></div>)}
                    </dl>
                  )}
                  {tab === 'docs' && p.documents.map(d => (
                    <a key={d.url} href={d.url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', color: 'var(--sh-primary)', fontWeight: 600, marginBottom: 8 }}>{d.title}</a>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </article>
    </>
  )
}
