'use client'

import { Link,useParams } from '@/shared/lib/navigation'
import { BRAND,SITE,articleLd,breadcrumbLd } from '@/shared/lib/seo'
import { supabase } from '@/shared/lib/supabase'
import JsonLd from '@/shared/ui/JsonLd'
import { Helmet } from '@/shared/ui/Seo'
import { useQuery } from '@tanstack/react-query'
import DOMPurify from 'dompurify'

type Post = {
  slug: string
  title: string
  excerpt: string | null
  body_html: string | null
  cover_image: string | null
  published_at: string | null
}

const shell: React.CSSProperties = {
  minHeight: '100dvh',
  background: '#EEF1F0',
  fontFamily: "'Onest', system-ui, sans-serif",
  color: '#12201A',
}

export default function BlogPostPage() {
  const { slug = '' } = useParams<{ slug: string }>()

  const { data: post, isLoading } = useQuery<Post | null>({
    queryKey: ['blog-post', slug],
    queryFn: async () => {
      const { data } = await supabase
        .from('blog_posts')
        .select('slug, title, excerpt, body_html, cover_image, published_at')
        .eq('slug', slug)
        .eq('is_active', true)
        .maybeSingle()
      return (data as Post) ?? null
    },
    staleTime: 300_000,
  })

  if (isLoading) {
    return (
      <div style={{ ...shell, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 26, height: 26, border: '2.5px solid #D4DAD6', borderTopColor: '#10A35B', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
      </div>
    )
  }

  if (!post) {
    return (
      <div style={{ ...shell, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, textAlign: 'center', padding: 24 }}>
        <Helmet>
          <title>Статья не найдена — {BRAND}</title>
          <meta name="robots" content="noindex" />
        </Helmet>
        <h1 style={{ fontFamily: "'Unbounded',sans-serif", fontSize: 22, fontWeight: 700 }}>Статья не найдена</h1>
        <Link href="/blog" style={{ color: '#10A35B', fontWeight: 700 }}>← Все статьи</Link>
      </div>
    )
  }

  const canonical = `${SITE}/blog/${post.slug}`
  const title = `${post.title} | Блог ${BRAND}`
  const desc = (post.excerpt || post.title).slice(0, 300)

  return (
    <div style={shell}>
      <Helmet>
        <html lang="ru" />
        <title>{title}</title>
        <meta name="description" content={desc} />
        <link rel="canonical" href={canonical} />
        <meta property="og:type" content="article" />
        <meta property="og:url" content={canonical} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={desc} />
        {post.cover_image && <meta property="og:image" content={post.cover_image} />}
      </Helmet>
      <JsonLd
        data={[
          articleLd(post),
          breadcrumbLd([
            { name: 'Главная', url: SITE },
            { name: 'Блог', url: `${SITE}/blog` },
            { name: post.title, url: canonical },
          ]),
        ]}
      />

      <div className="lp-outer" style={{ maxWidth: 780, margin: '0 auto', padding: '20px 20px 80px' }}>
        <nav style={{ fontSize: 13, color: '#5C6B63', marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <Link href="/" style={{ color: '#5C6B63' }}>Главная</Link>
          <span>/</span>
          <Link href="/blog" style={{ color: '#5C6B63' }}>Блог</Link>
          <span>/</span>
          <span style={{ color: '#12201A' }}>{post.title}</span>
        </nav>

        <article style={{ background: '#fff', borderRadius: 20, padding: '36px 44px', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
          <h1 style={{ fontFamily: "'Unbounded',sans-serif", fontSize: 26, fontWeight: 800, lineHeight: 1.25, marginBottom: 18 }}>{post.title}</h1>
          {post.cover_image && (
            <img src={post.cover_image} alt={post.title} style={{ width: '100%', borderRadius: 14, marginBottom: 22, objectFit: 'cover' }} />
          )}
          {post.body_html
            ? <div className="blog-body" style={{ fontSize: 15, lineHeight: 1.75, color: '#2A3A31' }} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(post.body_html) }} />
            : post.excerpt && <p style={{ fontSize: 15, lineHeight: 1.75, color: '#2A3A31' }}>{post.excerpt}</p>}

          <div style={{ marginTop: 30, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link href="/" style={{ padding: '13px 24px', borderRadius: 12, background: '#10A35B', color: '#fff', fontWeight: 700, fontSize: 15, textDecoration: 'none' }}>В каталог</Link>
            <Link href="/blog" style={{ padding: '13px 24px', borderRadius: 12, background: '#F2F5F3', color: '#12201A', fontWeight: 700, fontSize: 15, textDecoration: 'none' }}>Все статьи</Link>
          </div>
        </article>
      </div>
    </div>
  )
}
