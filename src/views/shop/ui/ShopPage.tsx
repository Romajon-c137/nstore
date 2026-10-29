'use client'

/* ───────────────────────────────────────────────────────────────────────────
   Каталог nStore — /shop
   «Открыл → нашёл → добавил → заказал».

   Экраны (состояние в URL — ссылкой можно поделиться, «Назад» работает):
   • Главная            /shop            категории, фильтры и компактная сетка всех товаров
   • Категория          ?c=coffee[&s=…]  подразделы чипсами + сетка
   • Поиск              ?q=…             на телефоне — список строк
   • Все товары         ?view=all        вкладка «Каталог» на телефоне
   • Повторить заказ    ?view=mine       недавние заказы, избранное, частые
   • Товар              ?p=<id>          поверх любого экрана
   ─────────────────────────────────────────────────────────────────────────── */

import { activeFilterCount,applyFilters,CATEGORIES,CATEGORY_NAME,CategoryIcon,EMPTY_FILTERS,fmtMoney,frequent,groupPriority,HeroArt,IconArrowRight,IconBack,IconCart,IconCatalog,IconFilter,IconHome,IconOrders,IconRepeat,IconSearch,IconUser,IconX,pluralGoods,productHref,purchaseStats,searchGroups,sortForBrowse,Toast,type CatalogGroup,type CatalogProduct,type CategoryId,type Filters } from '@/entities/catalog'
import { CardSkeleton,CartSheet,FiltersSheet,MyPurchases,ProductCard,ProductRow,useCart,useFavorites,useMedia,useShopData } from '@/features/shopping'
import { Link,useUrlQuery } from '@/shared/lib/navigation'
import { Helmet } from '@/shared/ui/Seo'
import { useRouter } from 'next/navigation'
import { useCallback,useDeferredValue,useEffect,useMemo,useRef,useState } from 'react'

const PAGE = 40
type View = 'home' | 'all' | 'mine'

export default function ShopPage() {
  const [params, setParams] = useUrlQuery()
  const router = useRouter()
  const category = (params.get('c') as CategoryId | null) ?? null
  const sub = params.get('s')
  const viewParam = params.get('view')
  const view: View = viewParam === 'mine' ? 'mine' : viewParam === 'all' ? 'all' : 'home'
  const openId = params.get('p')

  const narrow = useMedia('(max-width: 1023px)')
  const data = useShopData()
  const { customer, isClient, pricing, groups, byId } = data
  const cart = useCart(customer?.id ?? null, byId, pricing)
  const fav = useFavorites(customer?.id ?? null)

  const [query, setQuery] = useState(params.get('q') ?? '')
  const q = useDeferredValue(query.trim())
  const [searchOpen, setSearchOpen] = useState(false)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [cartOpen, setCartOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const searchRef = useRef<HTMLInputElement>(null)

  /* ── URL ── */
  const patch = useCallback((next: Record<string, string | null>, replace = false) => {
    setParams(prev => {
      const p = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(next)) { if (v) p.set(k, v); else p.delete(k) }
      return p
    }, { replace })
  }, [setParams])

  useEffect(() => { patch({ q: q || null }, true) }, [q, patch])

  const top = () => window.scrollTo({ top: 0 })
  const goCategory = (c: CategoryId | null) => {
    patch({ c, s: null, view: c ? null : view === 'home' ? null : 'all' })
    setFilters(f => ({ ...f, categories: [] }))
    setLimit(PAGE); top()
  }
  const goView = (v: View) => { patch({ view: v === 'home' ? null : v, c: null, s: null }); setQuery(''); setSearchOpen(false); top() }
  const goBack = () => { setQuery(''); setSearchOpen(false); if (window.history.state?.idx > 0) window.history.back(); else goView('home') }
  const openProduct = useCallback((p: CatalogProduct) => router.push(productHref(p)), [router])


  /* ── Выборки ── */
  const counts = useMemo(() => {
    const m = new Map<CategoryId, number>()
    for (const g of groups) m.set(g.variants[0].category, (m.get(g.variants[0].category) ?? 0) + 1)
    return m
  }, [groups])
  const visibleCats = CATEGORIES.filter(c => counts.get(c.id))

  // Подразделы категории — из разделов 1С («Зерновой кофе» → «Зерновой»)
  const subs = useMemo(() => {
    if (!category) return []
    const c = new Map<string, number>()
    for (const g of groups) { const p = g.variants[0]; if (p.category === category && p.subcategory) c.set(p.subcategory, (c.get(p.subcategory) ?? 0) + 1) }
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s]) => s)
  }, [groups, category])

  const searching = !!q
  const browsing = searching || !!category || view === 'all'
  const scope = useMemo(() => {
    let base = category ? groups.filter(g => g.variants[0].category === category) : groups
    if (category && sub) base = base.filter(g => g.variants.some(v => v.subcategory === sub))
    return q ? searchGroups(base, q) : sortForBrowse(base)
  }, [groups, category, sub, q])
  const results = useMemo(() => applyFilters(scope, filters, pricing), [scope, filters, pricing])
  useEffect(() => setLimit(PAGE), [q, filters, sub])

  // На главной «Все товары» фильтруются чипсами прямо в секции
  const [homeCat, setHomeCat] = useState<CategoryId | null>(null)
  const homeAll = useMemo(() => (homeCat ? results.filter(g => g.variants[0].category === homeCat) : results), [results, homeCat])

  const groupOf = useMemo(() => {
    const m = new Map<string, CatalogGroup>()
    for (const g of groups) for (const v of g.variants) m.set(v.id, g)
    return m
  }, [groups])

  const usual = useMemo(() => {
    const seen = new Set<string>()
    return frequent(purchaseStats(data.orders, byId)).flatMap(u => {
      const g = groupOf.get(u.product.id)
      if (!g || seen.has(g.key)) return []
      seen.add(g.key); return [{ g, product: u.product as CatalogProduct | undefined }]
    }).slice(0, 5)
  }, [data.orders, byId, groupOf])
  const { popular, often } = useMemo(() => {
    const taken = new Set(usual.map(u => u.g.key))
    const picks = pickPopular(groups.filter(g => !taken.has(g.key)), 10)
    return {
      popular: picks.slice(0, 5),
      // Клиенту — его частые товары, гостю — следующие популярные позиции
      often: usual.length ? usual : picks.slice(5, 10).map(g => ({ g, product: undefined })),
    }
  }, [groups, usual])

  /* ── Бесконечная лента ── */
  const sentinel = useRef<HTMLDivElement>(null)
  const shown = view === 'home' && !browsing ? homeAll : results
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setLimit(l => l + PAGE) }, { rootMargin: '800px' })
    io.observe(el)
    return () => io.disconnect()
  }, [shown.length, view, browsing])

  /* ── Корзина «подпрыгивает» при добавлении ── */
  const [bump, setBump] = useState(false)
  const prevTotal = useRef(cart.total)
  useEffect(() => {
    if (cart.total > prevTotal.current) { setBump(true); const t = setTimeout(() => setBump(false), 360); prevTotal.current = cart.total; return () => clearTimeout(t) }
    prevTotal.current = cart.total
  }, [cart.total])

  useEffect(() => {
    const product = openId ? byId.get(openId) : null
    if (product) router.replace(productHref(product))
  }, [openId, byId, router])
  const profileHref = !customer ? '/login' : isClient ? '/cabinet?tab=profile' : '/crm'
  const filterN = activeFilterCount(filters)
  const hideToast = useCallback(() => setToast(null), [])
  const isHome = view === 'home' && !browsing
  const favApi = useMemo(() => ({ has: fav.has, toggle: fav.toggle }), [fav.has, fav.toggle])

  const title = searching ? 'Поиск' : category ? CATEGORY_NAME[category] : view === 'mine' ? 'Повторить заказ' : 'Все товары'
  const showSearchRow = isHome || searching || searchOpen

  const grid = (list: CatalogGroup[], opts: { eager?: boolean; hearts?: boolean } = {}) => (
    <div className="sh-grid">
      {list.map((g, i) => <ProductCard key={g.key} group={g} pricing={pricing} cart={cart} onOpen={openProduct} eager={opts.eager && i < 10} fav={opts.hearts ? favApi : undefined} />)}
    </div>
  )
  const more = (list: CatalogGroup[]) => list.length > limit && <div ref={sentinel} style={{ height: 1 }} />
  const filtersBtn = (
    <button className="sh-pill" onClick={() => setFiltersOpen(true)} aria-label="Фильтры">
      <IconFilter size={18} /><span className="sh-pill-text">Фильтры</span>{filterN > 0 && <span className="badge">{filterN}</span>}
    </button>
  )
  const chips = (items: { id: string | null; label: string }[], active: string | null, onPick: (id: string | null) => void) => (
    <div className="sh-chiprow" role="tablist">
      {items.map(it => (
        <button key={it.id ?? 'all'} role="tab" aria-selected={active === it.id} className={`sh-chip${active === it.id ? ' on' : ''}`} onClick={() => onPick(it.id)}>{it.label}</button>
      ))}
    </div>
  )
  const catChips = (active: CategoryId | null, onPick: (c: CategoryId | null) => void) =>
    chips([{ id: null, label: 'Все' }, ...visibleCats.map(c => ({ id: c.id, label: c.name }))], active, id => onPick(id as CategoryId | null))

  const searchBox = (
    <div className="sh-search" role="search">
      <IconSearch />
      <input
        ref={searchRef}
        type="search"
        value={query}
        onChange={e => { setQuery(e.target.value); if (view === 'mine') patch({ view: null }) }}
        placeholder="Найти кофе, молоко, сироп..."
        aria-label="Поиск товаров"
        enterKeyHint="search"
        autoComplete="off"
      />
      {query && <button className="sh-search-clear" onClick={() => { setQuery(''); searchRef.current?.focus() }} aria-label="Очистить поиск"><IconX size={16} /></button>}
    </div>
  )

  const cartBadge = cart.count > 0 && <span className="sh-badge-n">{cart.count > 99 ? '99+' : cart.count}</span>

  return (
    <div className={`sh${cart.count ? ' has-cart' : ''}`}>
      <Helmet>
        <title>Каталог — nStore · оптовые поставки для HoReCa и офисов</title>
        <meta name="description" content="Кофе, молоко, сиропы, соусы, напитки, чай и расходники для кофеен, ресторанов и офисов. Оптовые цены, доставка по Астане и Казахстану." />
        <link rel="canonical" href="https://nstore.kz/shop" />
      </Helmet>

      {/* ── Шапка ── */}
      <header className="sh-head">
        <div className="sh-head-in">
          {/* Мобильный: на внутренних экранах — «назад» + заголовок */}
          {narrow && !isHome ? (
            <>
              <button className="sh-back" onClick={goBack} aria-label="Назад"><IconBack size={22} /></button>
              <h1 className="sh-head-title">{title}</h1>
              {!showSearchRow && view !== 'mine' && (
                <button className="sh-icon-btn" onClick={() => { setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 50) }} aria-label="Поиск"><IconSearch size={22} /></button>
              )}
            </>
          ) : (
            <>
              <Link href="/shop" className="sh-logo" aria-label="nStore — каталог" onClick={() => goView('home')}>nStore</Link>
              <span className="sh-tagline sh-desk">Напитки · Кофе · Соусы · Молоко<br />для вашего бизнеса</span>
              {!narrow && <div style={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0 }}>{searchBox}</div>}
              <div className="sh-head-actions">
                <button className={`sh-ghost sh-desk${view === 'mine' ? ' on' : ''}`} onClick={() => goView(view === 'mine' ? 'home' : 'mine')}>
                  <IconRepeat size={20} /> Повторить заказ
                </button>
                <Link href={profileHref} className="sh-ghost sh-desk">
                  <IconUser size={20} /> {customer ? (customer.name ?? customer.company ?? 'Профиль') : 'Войти'}
                </Link>
                <button className={`sh-cart-btn${bump ? ' sh-bump' : ''}`} onClick={() => setCartOpen(true)} aria-label={`Корзина, ${pluralGoods(cart.count)}`}>
                  <span className="sh-cart-ico"><IconCart size={22} />{cartBadge}</span>
                  <span className="sh-cart-txt sh-desk"><b>Корзина</b><span>{fmtMoney(cart.total)}</span></span>
                </button>
              </div>
            </>
          )}
        </div>
        {narrow && showSearchRow && <div className="sh-head-search">{searchBox}</div>}
      </header>

      <main className="sh-main">
        {/* ── Плитки категорий (главная и категории на desktop; главная на телефоне) ── */}
        {(isHome || (!narrow && !searching && view !== 'mine')) && !data.isLoading && (
          <nav className="sh-tiles" aria-label="Категории">
            {visibleCats.map(c => (
              <button key={c.id} className={`sh-tile${category === c.id ? ' on' : ''}`} onClick={() => goCategory(category === c.id ? null : c.id)} aria-pressed={category === c.id}>
                <CategoryIcon id={c.id} />
                <span>{c.name}</span>
              </button>
            ))}
          </nav>
        )}

        {data.error ? (
          <div className="sh-empty">
            <div className="big">Не удалось загрузить каталог</div>
            <div>Проверьте соединение и попробуйте ещё раз</div>
            <button className="sh-btn navy" onClick={() => data.refetch()}>Повторить</button>
          </div>
        ) : data.isLoading ? (
          <section className="sh-sec">
            <div className="sh-tiles">{Array.from({ length: 9 }, (_, i) => <div key={i} className="sh-skel" style={{ height: 68, borderRadius: 16 }} />)}</div>
            <div className="sh-grid" style={{ marginTop: 24 }}>{Array.from({ length: 10 }, (_, i) => <CardSkeleton key={i} />)}</div>
          </section>
        ) : view === 'mine' && !searching ? (
          <section className="sh-sec">
            <div className="sh-sec-head sh-desk"><h1 className="sh-sec-title">Повторить заказ</h1></div>
            <MyPurchases isClient={isClient} orders={data.orders} byId={byId} fav={{ ...favApi, ids: fav.ids }} pricing={pricing} cart={cart} onOpen={openProduct} onToast={setToast} />
          </section>
        ) : browsing || isHome ? (
          <section className="sh-sec">
            <div className="sh-sec-head">
              <h1 className="sh-sec-title sh-desk">{title}</h1>
              <span className="sh-sec-sub sh-desk">{pluralGoods(results.length)}</span>
              <div className="sh-sec-chips">
                {searching
                  ? chips([{ id: null, label: 'Все' }, ...visibleCats.filter(c => results.some(g => g.variants[0].category === c.id)).map(c => ({ id: c.id, label: c.name }))],
                      category, id => patch({ c: id, s: null }, true))
                  : category
                    ? subs.length > 1 && chips([{ id: null, label: 'Все' }, ...subs.map(s => ({ id: s, label: subLabel(s, category) }))], sub, id => patch({ s: id }, true))
                    : catChips(null, c => goCategory(c))}
              </div>
              {filtersBtn}
            </div>
            {results.length === 0 ? (
              <div className="sh-empty">
                <div className="big">{q ? `Ничего не нашли по «${q}»` : 'Нет товаров по фильтрам'}</div>
                <div>Попробуйте другое слово, бренд или артикул</div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 16 }}>
                  {filterN > 0 && <button className="sh-chip on" onClick={() => setFilters(EMPTY_FILTERS)}>Сбросить фильтры</button>}
                  {visibleCats.slice(0, 5).map(c => <button key={c.id} className="sh-chip" onClick={() => { setQuery(''); goCategory(c.id) }}>{c.name}</button>)}
                </div>
              </div>
            ) : searching && narrow ? (
              <div className="sh-plist">
                {results.slice(0, limit).flatMap(g => g.variants).map(p => <ProductRow key={p.id} product={p} pricing={pricing} cart={cart} onOpen={openProduct} />)}
                <div className="sh-plist-foot">Найдено {pluralGoods(results.length)}</div>
              </div>
            ) : grid(results.slice(0, limit), { eager: true, hearts: true })}
            {more(results)}
          </section>
        ) : (
          <>
            <section className="sh-hero">
              <div className="sh-hero-txt">
                <h2>Качественные продукты<br />для вашего бизнеса</h2>
                <p>Поставляем кофе, молоко, сиропы, соусы и напитки<br className="sh-desk" /> для HoReCa и офисов.</p>
                <Link href="/page/about-us" className="sh-hero-btn sh-mob">О нашем магазине <IconArrowRight size={16} /></Link>
              </div>
              <HeroArt />
            </section>

            {popular.length > 0 && (
              <section className="sh-sec">
                <div className="sh-sec-head">
                  <h2 className="sh-sec-title">Популярное</h2>
                  <span className="sp" />
                  <button className="sh-link" onClick={() => goView('all')}>Смотреть все <IconArrowRight size={16} /></button>
                </div>
                <div className="sh-row">
                  {popular.map((g, i) => <ProductCard key={g.key} group={g} pricing={pricing} cart={cart} onOpen={openProduct} eager tag={i < 2 ? 'Популярное' : undefined} />)}
                </div>
              </section>
            )}

            {often.length > 0 && (
              <section className="sh-sec">
                <div className="sh-sec-head">
                  <h2 className="sh-sec-title">{usual.length ? 'Часто заказываете' : 'Часто заказывают'}</h2>
                  <span className="sp" />
                  {usual.length > 0 && (
                    <button className="sh-link" onClick={() => {
                      const n = cart.addMany(usual.flatMap(u => u.product ? [{ product: u.product, qty: u.product.minQty }] : []))
                      setToast(`Добавлено в корзину: ${pluralGoods(n)}`)
                    }}>Добавить всё</button>
                  )}
                </div>
                <div className="sh-row">
                  {often.map(({ g, product }) => <ProductCard key={g.key} group={g} preferId={product?.id} pricing={pricing} cart={cart} onOpen={openProduct} eager />)}
                </div>
              </section>
            )}

            <section className="sh-sec">
              <div className="sh-sec-head">
                <h2 className="sh-sec-title">Все товары</h2>
                <span className="sp" />
                {filtersBtn}
              </div>
              <div style={{ marginBottom: 16 }}>{catChips(homeCat, c => { setHomeCat(c); setLimit(PAGE) })}</div>
              {grid(homeAll.slice(0, limit), { hearts: true })}
              {more(homeAll)}
            </section>
          </>
        )}
      </main>

      {/* ── Плавающая корзина ── */}
      {cart.count > 0 && !cartOpen && (
        <button className={`sh-cartbar${bump ? ' sh-bump' : ''}`} onClick={() => setCartOpen(true)}>
          <IconCart size={22} />
          <span className="l"><small>Корзина · {pluralGoods(cart.count)}</small><b>{fmtMoney(cart.total)}</b></span>
          <IconArrowRight size={20} />
        </button>
      )}

      {/* ── Мобильная навигация ── */}
      <nav className="sh-tabbar sh-mob" aria-label="Навигация">
        <div className="sh-tabbar-in">
          <button className={isHome ? 'on' : ''} onClick={() => goView('home')}><IconHome size={22} />Главная</button>
          <button className={view === 'all' || (!!category && view !== 'mine') ? 'on' : ''} onClick={() => goView('all')}><IconCatalog size={22} />Каталог</button>
          <button onClick={() => setCartOpen(true)}><span className="sh-cart-ico"><IconCart size={22} />{cartBadge}</span>Корзина</button>
          <button className={view === 'mine' ? 'on' : ''} onClick={() => goView('mine')}><IconOrders size={22} />Заказы</button>
          <Link href={profileHref}><IconUser size={22} />{customer ? 'Профиль' : 'Войти'}</Link>
        </div>
      </nav>

      {/* ── Слои ── */}

      {cartOpen && <CartSheet cart={cart} customer={customer} onClose={() => setCartOpen(false)} onBrowse={() => { setCartOpen(false); goView('all') }} />}
      {filtersOpen && (
        <FiltersSheet scope={scope} value={filters} pricing={pricing} showCategory={!category}
          onApply={setFilters} onClose={() => setFiltersOpen(false)} />
      )}
      {toast && <Toast text={toast} onDone={hideToast} />}
    </div>
  )
}

/** «Зерновой кофе» в категории «Кофе» → «Зерновой». */
function subLabel(section: string, c: CategoryId) {
  const word = CATEGORY_NAME[c].toLowerCase().slice(0, 4)
  const short = section.split(/\s+/).filter(w => !w.toLowerCase().startsWith(word)).join(' ').trim()
  const s = short || section
  return s[0].toUpperCase() + s.slice(1)
}

/** «Популярное»: сначала товары с приоритетом из CRM (по номеру), затем флаг из
    учётной системы, иначе — товары в наличии с фото, по одному из каждой категории. */
function pickPopular(groups: CatalogGroup[], n: number): CatalogGroup[] {
  const prioritized = groups.filter(g => groupPriority(g) < Infinity).sort((a, b) => groupPriority(a) - groupPriority(b))
  const flagged = groups.filter(g => !prioritized.includes(g) && g.variants.some(v => v.isPopular))
  const rest = groups.filter(g => !prioritized.includes(g) && !flagged.includes(g) && g.variants[0].image && g.variants.some(v => v.stock > 0))
  const roundRobin = (pool: CatalogGroup[]) => {
    const byCat = new Map<CategoryId, CatalogGroup[]>()
    for (const g of pool) { const c = g.variants[0].category; byCat.set(c, [...(byCat.get(c) ?? []), g]) }
    const order = CATEGORIES.map(c => byCat.get(c.id) ?? [])
    const out: CatalogGroup[] = []
    for (let i = 0; order.some(l => l[i]); i++) for (const l of order) if (l[i]) out.push(l[i])
    return out
  }
  return [...prioritized, ...roundRobin(flagged), ...roundRobin(rest)].slice(0, n)
}
