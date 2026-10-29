'use client'

import { fmtMoney,frequent,IconHeart,IconRepeat,pluralGoods,ProductImage,purchaseStats,reorderItems,resolvePrice,type CatalogGroup,type CatalogProduct,type PastOrder,type PricingContext } from '@/entities/catalog'
import type { Cart } from '@/features/shopping/model/hooks'
import { ProductCard,type FavApi } from '@/features/shopping/ui/ProductCard'
import { Link } from '@/shared/lib/navigation'
import { useMemo,useState } from 'react'

type Tab = 'recent' | 'favorites' | 'frequent'
const TABS: { id: Tab; label: string }[] = [
  { id: 'recent', label: 'Недавние' },
  { id: 'favorites', label: 'Избранное' },
  { id: 'frequent', label: 'Часто заказываете' },
]

const DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
const single = (p: CatalogProduct): CatalogGroup => ({ key: p.id, title: p.name, variants: [p] })

export function MyPurchases({ isClient, orders, byId, fav, pricing, cart, onOpen, onToast }: {
  isClient: boolean; orders: PastOrder[]; byId: Map<string, CatalogProduct>; fav: FavApi & { ids: string[] }
  pricing: PricingContext; cart: Cart; onOpen: (p: CatalogProduct) => void; onToast: (t: string) => void
}) {
  const usual = useMemo(() => frequent(purchaseStats(orders, byId)), [orders, byId])
  const favorites = useMemo(() => fav.ids.flatMap(id => byId.get(id) ?? []), [fav.ids, byId])
  const [tab, setTab] = useState<Tab>(orders.length ? 'recent' : 'favorites')

  function addOrder(o: PastOrder) {
    const { items, missing } = reorderItems(o, byId)
    const n = cart.addMany(items)
    onToast(missing ? `Добавлено ${pluralGoods(n)} · ${missing} нет в каталоге` : `Заказ повторён · ${pluralGoods(n)} в корзине`)
  }
  function addList(list: { product: CatalogProduct; qty: number }[]) {
    onToast(`Добавлено в корзину: ${pluralGoods(cart.addMany(list))}`)
  }

  if (!isClient && !fav.ids.length) {
    return (
      <div className="sh-empty">
        <div className="sh-empty-ico"><IconRepeat size={28} /></div>
        <div className="big">Закупки в пару нажатий</div>
        <div>Войдите — и здесь появятся история заказов,<br />частые товары и оптовые цены.</div>
        <Link href="/login" className="sh-btn navy" style={{ textDecoration: 'none' }}>Войти</Link>
      </div>
    )
  }

  const empty = (title: string, text: string, icon?: boolean) => (
    <div className="sh-empty">
      {icon && <IconHeart size={32} />}
      <div className="big">{title}</div><div>{text}</div>
    </div>
  )

  return (
    <>
      <div className="sh-tabs" role="tablist">
        {TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`sh-tab${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      {tab === 'recent' && (orders.length === 0 ? empty('Заказов пока нет', 'Здесь появятся ваши прошлые заказы') : (
        <div className="sh-orders">
          {orders.slice(0, 6).map(o => (
            <section key={o.id} className="sh-order">
              <h3 className="sh-order-date">{DATE.format(new Date(o.createdAt)).replace(' г.', '')}</h3>
              <div className="sh-order-lines">
                {o.lines.map((l, i) => {
                  const p = (l.productId && byId.get(l.productId)) || null
                  const price = p ? resolvePrice(p, pricing, l.qty).unitPrice : null
                  return (
                    <button key={i} className="sh-oline" onClick={() => p && onOpen(p)} disabled={!p}>
                      <span className="sh-line-img">{p ? <ProductImage product={p} /> : null}</span>
                      <span className="sh-oline-mid">
                        <span className="sh-line-name">{l.name}</span>
                        <span className="sh-line-sub">{p?.package ? `${p.package}  × ${l.qty}` : `× ${l.qty}`}</span>
                      </span>
                      <span className="sh-oline-sum">{price != null ? fmtMoney(price * l.qty) : p ? '' : 'нет в каталоге'}</span>
                    </button>
                  )
                })}
              </div>
              <button className="sh-btn soft lg" onClick={() => addOrder(o)}>Добавить всё в корзину</button>
            </section>
          ))}
        </div>
      ))}

      {tab === 'favorites' && (favorites.length === 0
        ? empty('Пока пусто', 'Отмечайте товары сердечком', true)
        : <>
            <div className="sh-grid">{favorites.map(p => <ProductCard key={p.id} group={single(p)} pricing={pricing} cart={cart} onOpen={onOpen} fav={fav} />)}</div>
            {favorites.length > 1 && <button className="sh-btn soft lg sh-addall" onClick={() => addList(favorites.map(p => ({ product: p, qty: p.minQty })))}>Добавить всё в корзину</button>}
          </>)}

      {tab === 'frequent' && (usual.length === 0
        ? empty('Здесь появятся ваши товары', 'после нескольких заказов')
        : <>
            <div className="sh-grid">{usual.map(u => <ProductCard key={u.product.id} group={single(u.product)} pricing={pricing} cart={cart} onOpen={onOpen} fav={fav} />)}</div>
            {usual.length > 1 && <button className="sh-btn soft lg sh-addall" onClick={() => addList(usual.map(u => ({ product: u.product, qty: u.qty })))}>Добавить всё в корзину</button>}
          </>)}
    </>
  )
}
