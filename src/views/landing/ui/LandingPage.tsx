'use client'

import { DEFAULT_BLOCKS,type DbProduct,type PageBlock } from '@/entities/content'
import { fetchRoleRoute } from '@/entities/session'
import { useLandingCatalog } from '@/features/shopping'
import { useNavigate } from '@/shared/lib/navigation'
import { categorySlug,faqLd,itemListLd,localBusinessLd,organizationLd,productSlug,websiteLd } from '@/shared/lib/seo'
import { supabase } from '@/shared/lib/supabase'
import JsonLd from '@/shared/ui/JsonLd'
import { Helmet } from '@/shared/ui/Seo'
import { Spinner } from '@/shared/ui/ui'
import { B2BBanner,CartDrawer,CategoriesChips,CatGrid,FooterBlock,FormBlock,Header,HeroBlock,PerksBlock,ProductsBlock,PromoBar,PromoSaleBlock,ReviewsBlock,StepsBlock,TermsBlock,TextBlock,UspHeroBlock } from '@/widgets/landing'
import { useQuery } from '@tanstack/react-query'
import { useEffect,useMemo,useState } from 'react'

// ─── Main component ───────────────────────────────────────────────────────────

export default function LandingPage() {
  const navigate = useNavigate()
  const [checking, setChecking] = useState(true)
  const [activeSection, setActiveSection] = useState('')
  const catalog = useLandingCatalog()
  const { products, cart, addToCart, removeFromCart } = catalog
  const [cartOpen, setCartOpen] = useState(false)
  const openProduct = (p: DbProduct) => navigate(`/product/${productSlug(p)}`)

  const cartCount = cart.reduce((s, item) => s + item.qty, 0)

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_CATALOG_SOURCE === 'django' || process.env.NEXT_PUBLIC_CATALOG_SOURCE === 'demo') { setChecking(false); return }
    let active = true
    // Страховка: что бы ни случилось с авторизацией — каталог покажем максимум через 3.5с
    const safety = setTimeout(() => { if (active) setChecking(false) }, 3500)

    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        if (!active) return
        if (session?.user) {
          try {
            const route = await fetchRoleRoute(session.user.id)
            if (active) navigate(route, { replace: true })
          } catch {
            if (active) setChecking(false) // не смогли определить роль — показываем каталог
          }
        } else {
          setChecking(false)
        }
      })
      .catch(() => { if (active) setChecking(false) })

    return () => { active = false; clearTimeout(safety) }
  }, [navigate])

  const { data: blocks = DEFAULT_BLOCKS } = useQuery<PageBlock[]>({
    queryKey: ['page-blocks-home'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('page_blocks')
        .select('id, block_type, props, sort_order')
        .eq('page', 'home')
        .eq('is_active', true)
        .order('sort_order')
      if (error || !data?.length) return DEFAULT_BLOCKS
      return data as PageBlock[]
    },
    staleTime: 0,
    enabled: !checking && process.env.NEXT_PUBLIC_CATALOG_SOURCE !== 'django' && process.env.NEXT_PUBLIC_CATALOG_SOURCE !== 'demo',
  })

  const sectionCounts = useMemo(() => products.reduce<Record<string, number>>((counts, product) => {
    if (product.section_name) counts[product.section_name] = (counts[product.section_name] ?? 0) + 1
    return counts
  }, {}), [products])

  // Список разделов из БД (section_name), по убыванию количества товаров
  const sections = Object.keys(sectionCounts).sort((a, b) => (sectionCounts[b] ?? 0) - (sectionCounts[a] ?? 0))

  if (checking || catalog.isLoading) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#EEF1F0' }}>
        <Spinner track="#E4E9E6" />
      </div>
    )
  }

  function renderBlock(block: PageBlock) {
    const { block_type: type, props: p } = block
    const key = block.id
    switch (type) {
      case 'promo_bar':        return <PromoBar key={key} p={p} />
      case 'header':           return <Header key={key} p={p} onPickProduct={openProduct} />
      case 'categories_chips': return sections.length > 0 ? <CategoriesChips key={key} sections={sections} activeSection={activeSection} setActiveSection={setActiveSection} p={p} /> : null
      case 'usp_hero':         return <UspHeroBlock key={key} p={p} />
      case 'hero':             return <HeroBlock key={key} p={p} />
      case 'products':         return <ProductsBlock key={key} p={p} products={products} cart={cart} onAdd={addToCart} onRemove={removeFromCart} activeSection={activeSection} />
      case 'cat_grid':         return <CatGrid key={key} p={p} onSectionSelect={setActiveSection} counts={sectionCounts} />
      case 'terms':            return <TermsBlock key={key} p={p} />
      case 'b2b_banner':       return <B2BBanner key={key} p={p} />
      case 'steps':            return <StepsBlock key={key} p={p} />
      case 'perks':            return <PerksBlock key={key} p={p} />
      case 'text':             return <TextBlock key={key} p={p} />
      case 'reviews':          return <ReviewsBlock key={key} p={p} />
      case 'form':             return <FormBlock key={key} p={p} />
      case 'footer':           return <FooterBlock key={key} p={p} />
      case 'promo_sale':       return <PromoSaleBlock key={key} p={p} />
      default:                 return null
    }
  }

  // Якоря для CTA-кнопок hero-блока ("Смотреть каталог" / "Стать партнёром")
  const ANCHOR_IDS: Partial<Record<string, string>> = { products: 'lp-catalog', form: 'lp-partner-form', terms: 'lp-terms' }

  const SITE = 'https://nstore.kz'
  const HOME_TITLE = 'Nstore — оптовые поставки продуктов питания в Астане | B2B дистрибьютор'
  const HOME_DESC  = 'Оптовые поставки продуктов питания по Казахстану. Работаем с HoReCa, магазинами и офисами в Астане. Прямые цены от дистрибьютора, доставка по городу и стране.'

  return (
    <>
    <Helmet>
      <title>{HOME_TITLE}</title>
      <meta name="description" content={HOME_DESC} />
      <meta name="keywords" content="оптовые продукты питания Астана, B2B поставки продуктов Казахстан, дистрибьютор продуктов питания, каталог оптовых продуктов, товары для HoReCa" />
      <link rel="canonical" href={SITE + '/'} />
      <link rel="alternate" hrefLang="ru" href={SITE + '/'} />
      <link rel="alternate" hrefLang="kk" href={SITE + '/'} />
      <link rel="alternate" hrefLang="x-default" href={SITE + '/'} />
      <meta property="og:type"        content="website" />
      <meta property="og:site_name"   content="Nstore" />
      <meta property="og:locale"      content="ru_RU" />
      <meta property="og:url"         content={SITE + '/'} />
      <meta property="og:title"       content={HOME_TITLE} />
      <meta property="og:description" content={HOME_DESC} />
      <meta property="og:image"       content={SITE + '/og-cover.png'} />
      <meta name="twitter:card"       content="summary_large_image" />
      <meta name="twitter:title"      content={HOME_TITLE} />
      <meta name="twitter:description" content={HOME_DESC} />
      <meta name="twitter:image"      content={SITE + '/og-cover.png'} />
    </Helmet>
    <JsonLd data={[organizationLd(), localBusinessLd(), websiteLd(), faqLd()]} />
    {products.length > 0 && <JsonLd data={itemListLd(products, SITE + '/')} />}
    {sections.length > 0 && (
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: 'Каталог Nstore',
          url: SITE + '/',
          hasPart: sections.map(s => ({
            '@type': 'CollectionPage',
            name: s,
            url: `${SITE}/catalog/${categorySlug(s)}`,
          })),
        }}
      />
    )}
    <div style={{ minHeight: '100dvh', background: '#EEF1F0', fontFamily: "'Onest', system-ui, sans-serif", color: '#12201A' }}>
      <div className="lp-outer" style={{ maxWidth: 1480, margin: '0 auto', padding: '20px 20px 80px' }}>
        <div className="lp-card">
          {blocks.map(block => (
            <div
              key={block.id}
              id={ANCHOR_IDS[block.block_type]}
              /* header: обёртка display:contents, чтобы sticky-контейнером стал .lp-card, а не сама обёртка */
              style={block.block_type === 'header' ? { display: 'contents' } : undefined}
            >
              {renderBlock(block)}
            </div>
          ))}
        </div>
      </div>

      {cartCount > 0 && (
        <button
          onClick={() => setCartOpen(true)}
          style={{ position: 'fixed', bottom: 28, right: 28, zIndex: 999, display: 'flex', alignItems: 'center', gap: 10, background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 16, padding: '14px 22px', fontFamily: 'inherit', fontWeight: 700, fontSize: 15, cursor: 'pointer', boxShadow: '0 8px 32px rgba(16,163,91,.4)' }}
        >
          Корзина
          <span style={{ background: '#fff', color: 'var(--primary)', borderRadius: 8, padding: '2px 9px', fontSize: 13, fontWeight: 800 }}>{cartCount}</span>
        </button>
      )}

      {cartOpen && (
        <CartDrawer cart={cart} onClose={() => setCartOpen(false)} onAdd={addToCart} onRemove={removeFromCart} />
      )}


    </div>
    </>
  )
}
