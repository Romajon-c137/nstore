'use client'

import { Link } from '@/shared/lib/navigation'
import { BRAND,breadcrumbLd,SITE } from '@/shared/lib/seo'
import { supabase } from '@/shared/lib/supabase'
import JsonLd from '@/shared/ui/JsonLd'
import { Helmet } from '@/shared/ui/Seo'
import { useQuery } from '@tanstack/react-query'

export type BlogPost = {
  slug: string
  title: string
  excerpt: string | null
  cover_image: string | null
  published_at: string | null
}

const shell: React.CSSProperties = {
  minHeight: '100dvh',
  background: '#EEF1F0',
  fontFamily: "'Onest', system-ui, sans-serif",
  color: '#12201A',
}

export default function BlogListPage() {
  const { data: posts = [], isLoading } = useQuery<BlogPost[]>({
    queryKey: ['blog-posts'],
    queryFn: async () => {
      const { data } = await supabase
        .from('blog_posts')
        .select('slug, title, excerpt, cover_image, published_at')
        .eq('is_active', true)
        .order('published_at', { ascending: false })
      return (data ?? []) as BlogPost[]
    },
    staleTime: 300_000,
  })

  const canonical = `${SITE}/blog`
  const title = `Блог Nstore — статьи о продуктах, доставке и оптовых закупках`
  const desc = `Блог оптового дистрибьютора Nstore: обзоры товаров, новости, советы по закупкам для HoReCa и магазинов в Астане и по Казахстану.`

  return (
    <div style={shell}>
      <Helmet>
        <html lang="ru" />
        <title>{title}</title>
        <meta name="description" content={desc} />
        <link rel="canonical" href={canonical} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={canonical} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={desc} />
      </Helmet>
      <JsonLd
        data={[
          { '@context': 'https://schema.org', '@type': 'Blog', name: `Блог ${BRAND}`, url: canonical },
          breadcrumbLd([{ name: 'Главная', url: SITE }, { name: 'Блог', url: canonical }]),
        ]}
      />

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '20px 20px 80px' }}>
        <nav style={{ fontSize: 13, color: '#5C6B63', marginBottom: 16, display: 'flex', gap: 6 }}>
          <Link href="/" style={{ color: '#5C6B63' }}>Главная</Link>
          <span>/</span>
          <span style={{ color: '#12201A' }}>Блог</span>
        </nav>

        <header style={{ marginBottom: 22 }}>
          <h1 style={{ fontFamily: "'Unbounded',sans-serif", fontSize: 28, fontWeight: 700 }}>Блог</h1>
          <p style={{ fontSize: 14, color: '#5C6B63', marginTop: 6 }}>Обзоры продуктов, новости и советы по закупкам</p>
        </header>

        {isLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#8A968E' }}>Загрузка…</div>
        ) : posts.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#8A968E' }}>Скоро здесь появятся статьи.</div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 18, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {posts.map(post => (
              <li key={post.slug}>
                <Link href={`/blog/${post.slug}`} style={{ display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 18, overflow: 'hidden', border: '1px solid #EDF1EF', textDecoration: 'none', color: 'inherit', height: '100%' }}>
                  <div style={{ height: 160, background: '#F2F5F3', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {post.cover_image
                      ? <img src={post.cover_image} alt={post.title} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <span style={{ fontSize: 34, opacity: .4 }}>📰</span>}
                  </div>
                  <div style={{ padding: '14px 16px 18px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <h2 style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.35, color: '#12201A', margin: '0 0 6px' }}>{post.title}</h2>
                    {post.excerpt && <p style={{ fontSize: 13, color: '#5C6B63', lineHeight: 1.5, margin: 0 }}>{post.excerpt.slice(0, 140)}</p>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
