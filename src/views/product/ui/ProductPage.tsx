'use client'
import { CATEGORY_NAME,productHref,sortForBrowse,type CatalogProduct } from '@/entities/catalog'
import { CardSkeleton,CartSheet,ProductCard,useCart,useFavorites,useShopData } from '@/features/shopping'
import { ProductDetails } from '@/widgets/product-details'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo,useState } from 'react'

function BenefitIcon({ type }: { type: 'delivery' | 'price' | 'docs' }) {
  if (type === 'delivery') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7zM7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM18 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" /></svg>
  if (type === 'price') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M17 7.5c0-2-2.2-3.5-5-3.5S7 5.4 7 7.5 9.1 11 12 11s5 1.4 5 3.5S14.8 18 12 18s-5-1.5-5-3.5" /></svg>
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l3 3v15H6zM15 3v4h4M9 11h6M9 15h6" /></svg>
}

export default function ProductPage({ product: initial, variants: initialVariants }: { product: CatalogProduct; variants: CatalogProduct[] }) {
  const router = useRouter()
  const data = useShopData()
  const product = data.byId.get(initial.id) ?? initial
  const variants = data.groups.find(group => group.variants.some(item => item.id === product.id))?.variants ?? initialVariants
  const byId = new Map([...initialVariants, ...data.products].map(item => [item.id, item]))
  const cart = useCart(data.customer?.id ?? null, byId, data.pricing)
  const fav = useFavorites(data.customer?.id ?? null)
  const [cartOpen, setCartOpen] = useState(false)
  const recommended = useMemo(() => sortForBrowse(data.groups.filter(group =>
    group.key !== product.groupKey && group.variants.some(item => item.category === product.category)
  )).slice(0, 8), [data.groups, product.category, product.groupKey])
  const favApi = useMemo(() => ({ has: fav.has, toggle: fav.toggle }), [fav.has, fav.toggle])

  return <div className="sh sh-product-page">
    <header className="sh-product-header"><Link href="/shop">← Каталог</Link><Link href="/" aria-label="nStore — главная">nStore</Link><button className="sh-btn navy" onClick={() => setCartOpen(true)}>Корзина · {cart.count}</button></header>
    <main className="sh-product-main">
      <nav aria-label="Хлебные крошки"><Link href="/">Главная</Link> / <Link href={`/shop?c=${product.category}`}>{CATEGORY_NAME[product.category]}</Link> / <span>{product.name}</span></nav>
      {data.error && <p role="status">Не удалось обновить цены. <button onClick={() => data.refetch()}>Повторить</button></p>}
      <ProductDetails key={product.id} product={product} variants={variants} pricing={data.pricing} cart={cart} isFav={fav.has(product.id)} onToggleFav={() => fav.toggle(product.id)} onPick={item => router.push(productHref(item))} onClose={() => router.push('/shop')} />

      <section className="sh-product-benefits" aria-label="Преимущества nStore">
        <article><span className="sh-benefit-icon"><BenefitIcon type="delivery" /></span><div><b>Доставка по Астане</b><span>Согласуем удобный день и время</span></div></article>
        <article><span className="sh-benefit-icon"><BenefitIcon type="price" /></span><div><b>Оптовые условия</b><span>Персональные цены для постоянных клиентов</span></div></article>
        <article><span className="sh-benefit-icon"><BenefitIcon type="docs" /></span><div><b>Документы для бизнеса</b><span>Счёт и закрывающие документы</span></div></article>
      </section>

      <section className="sh-recommendations" aria-labelledby="recommended-title">
        <div className="sh-recommendations-head">
          <div><span>Из этой же категории</span><h2 id="recommended-title">Похожие товары</h2></div>
          <Link href={`/shop?c=${product.category}`}>Смотреть все <span aria-hidden="true">→</span></Link>
        </div>
        {data.isLoading ? (
          <div className="sh-reco-grid">{Array.from({ length: 4 }, (_, index) => <CardSkeleton key={index} />)}</div>
        ) : recommended.length > 0 ? (
          <div className="sh-reco-grid">
            {recommended.map((group, index) => <ProductCard key={group.key} group={group} pricing={data.pricing} cart={cart} onOpen={item => router.push(productHref(item))} eager={index < 4} fav={favApi} />)}
          </div>
        ) : <p className="sh-reco-empty">Другие товары этой категории скоро появятся.</p>}
      </section>

      {!data.customer && <aside className="sh-business-callout">
        <div><span className="sh-business-kicker">Для кофеен, ресторанов и офисов</span><h2>Закупаете продукты регулярно?</h2><p>Зарегистрируйте компанию, чтобы получать оптовые условия, видеть историю заказов и быстро повторять закупки.</p></div>
        <div className="sh-business-actions"><Link className="sh-btn primary lg" href="/register">Стать клиентом</Link><Link href="/page/delivery">Условия доставки</Link></div>
      </aside>}
    </main>
    {cartOpen && <CartSheet cart={cart} customer={data.customer} onClose={() => setCartOpen(false)} onBrowse={() => router.push('/shop')} />}
  </div>
}
