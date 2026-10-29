'use client'

import { fmtMoney,IconHeart,IconPlus,productHref,ProductImage,resolvePrice,Stepper,type CatalogGroup,type CatalogProduct,type PricingContext } from '@/entities/catalog'
import type { Cart } from '@/features/shopping/model/hooks'
import Link from 'next/link'
import { memo,useState } from 'react'

const DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })

export function availabilityBadge(p: CatalogProduct): { cls: string; text: string } | null {
  if (p.availability === 'unknown') return { cls: 'low', text: 'Наличие не подтверждено' }
  if (p.availability === 'low') return { cls: 'low', text: `Осталось ${p.stock}` }
  if (p.availability === 'preorder' || p.availability === 'out') {
    return { cls: 'pre', text: p.expectedDate ? `Под заказ · ${DATE.format(new Date(p.expectedDate)).replace('.', '')}` : 'Под заказ' }
  }
  return null
}

/** Подпись под ценой: «за шт.» и кратность, если продаём коробками. */
export function unitNote(p: CatalogProduct) {
  return `за ${p.unit}.${p.step > 1 ? ` · по ${p.step} ${p.unit}` : ''}`
}

function pickDefault(g: CatalogGroup, qtyOf: (id: string) => number) {
  return g.variants.find(v => qtyOf(v.id) > 0) ?? g.variants.find(v => v.stock > 0) ?? g.variants[0]
}

export interface FavApi { has: (id: string) => boolean; toggle: (id: string) => void }

export const ProductCard = memo(function ProductCard({ group, pricing, cart, onOpen, eager, preferId, fav, tag }: {
  group: CatalogGroup; pricing: PricingContext; cart: Cart; onOpen: (p: CatalogProduct) => void; eager?: boolean
  /** Вариант, показанный по умолчанию (напр. тот, что клиент обычно заказывает). */
  preferId?: string
  /** Сердечко «в избранное» в углу карточки. */
  fav?: FavApi
  /** Метка секции («Популярное»); «Хит» ставится по флагу товара. */
  tag?: string
}) {
  const [picked, setPicked] = useState<string | null>(preferId ?? null)
  const p = group.variants.find(v => v.id === picked) ?? pickDefault(group, cart.qtyOf)
  const qty = cart.qtyOf(p.id)
  const { unitPrice, compareAt } = resolvePrice(p, pricing, qty || p.minQty)
  const stock = availabilityBadge(p)
  const label = stock ?? (p.isPopular ? { cls: 'hit', text: 'Хит' } : tag ? { cls: 'hit', text: tag } : null)
  const isFav = fav?.has(p.id) ?? false

  return (
    <article className="sh-card" data-product-id={p.id}>
      {label && <span className={`sh-badge ${label.cls}`}>{label.text}</span>}
      {fav && (
        <button className={`sh-card-fav${isFav ? ' on' : ''}`} onClick={() => fav.toggle(p.id)} aria-pressed={isFav} aria-label={isFav ? 'Убрать из избранного' : 'В избранное'}>
          <IconHeart filled={isFav} size={18} />
        </button>
      )}
      <Link className="sh-card-img" href={productHref(p)} aria-label={p.name} tabIndex={-1}>
        <ProductImage product={p} eager={eager} />
      </Link>
      <div className="sh-card-body">
        <Link className="sh-card-name" href={productHref(p)}>{group.title}</Link>
        {group.variants.length > 1 ? (
          <div className="sh-vars" role="radiogroup" aria-label="Вариант">
            {group.variants.map(v => (
              <button key={v.id} role="radio" aria-checked={v.id === p.id}
                className={`sh-var${v.id === p.id ? ' on' : ''}`} onClick={() => setPicked(v.id)}>
                {v.variantLabel}
              </button>
            ))}
          </div>
        ) : (
          <div className="sh-card-spec">{p.package ?? p.brand ?? ' '}</div>
        )}
        <div className="sh-card-price">
          <div>
            <span className="sh-price">{unitPrice != null ? fmtMoney(unitPrice) : 'По запросу'}</span>
            {compareAt && <span className="sh-old">{fmtMoney(compareAt)}</span>}
          </div>
          <span className="sh-unit">{unitNote(p)}</span>
        </div>
        <div className="sh-card-cta">
          {qty > 0 ? (
            <Stepper size="sm" qty={qty} unit={p.step > 1 ? `${qty / p.step} кор.` : undefined} onInc={() => cart.inc(p)} onDec={() => cart.dec(p)} />
          ) : (
            <button className="sh-btn primary sm" disabled={unitPrice == null} onClick={() => cart.inc(p)} aria-label={`В корзину: ${p.name}`}>
              <IconPlus size={16} /><span className="sh-cta-text">В корзину</span>
            </button>
          )}
        </div>
      </div>
    </article>
  )
})

/** Строка товара — список поиска на телефоне. */
export function ProductRow({ product: p, pricing, cart, onOpen }: {
  product: CatalogProduct; pricing: PricingContext; cart: Cart; onOpen: (p: CatalogProduct) => void
}) {
  const qty = cart.qtyOf(p.id)
  const { unitPrice } = resolvePrice(p, pricing, qty || p.minQty)
  return (
    <div className="sh-prow">
      <Link className="sh-prow-img" href={productHref(p)} tabIndex={-1} aria-label={p.name}><ProductImage product={p} /></Link>
      <div className="sh-prow-mid">
        <Link className="sh-card-name" style={{ minHeight: 0 }} href={productHref(p)}>{p.name}</Link>
        <div className="sh-card-spec">{p.package ?? p.brand ?? ''}</div>
        <div className="sh-prow-bottom">
          <span className="sh-price">{unitPrice != null ? fmtMoney(unitPrice) : 'По запросу'}</span>
          {qty > 0
            ? <Stepper size="sm" qty={qty} onInc={() => cart.inc(p)} onDec={() => cart.dec(p)} />
            : <button className="sh-plus" disabled={unitPrice == null} onClick={() => cart.inc(p)} aria-label={`В корзину: ${p.name}`}><IconPlus size={18} /></button>}
        </div>
      </div>
    </div>
  )
}

export function CardSkeleton() {
  return <div className="sh-skel" style={{ aspectRatio: '3 / 4.6' }} />
}
