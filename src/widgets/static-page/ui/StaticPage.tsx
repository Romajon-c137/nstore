'use client'

import { Link } from '@/shared/lib/navigation'
import { SITE,breadcrumbLd } from '@/shared/lib/seo'
import JsonLd from '@/shared/ui/JsonLd'
import { Helmet } from '@/shared/ui/Seo'
import type { ReactNode } from 'react'

/** Общий каркас статических страниц (О компании, Доставка, Политика и т.д.). */
export default function StaticPage({
  title,
  description,
  path,
  breadcrumb,
  jsonLd,
  children,
}: {
  title: string
  description: string
  path: string // напр. '/page/delivery'
  breadcrumb: string // напр. 'Доставка и оплата'
  jsonLd?: object | object[]
  children: ReactNode
}) {
  const canonical = SITE + path
  const extra = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : []
  return (
    <div style={{ minHeight: '100dvh', background: '#EEF1F0', fontFamily: "'Onest', system-ui, sans-serif", color: '#12201A' }}>
      <Helmet>
        <html lang="ru" />
        <title>{title}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonical} />
        <link rel="alternate" hrefLang="ru" href={canonical} />
        <link rel="alternate" hrefLang="kk" href={canonical} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={canonical} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
      </Helmet>
      <JsonLd data={[breadcrumbLd([{ name: 'Главная', url: SITE }, { name: breadcrumb, url: canonical }]), ...extra]} />

      <div className="lp-outer" style={{ maxWidth: 860, margin: '0 auto', padding: '20px 20px 80px' }}>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28, fontSize: 13 }}>
          <div style={{ width: 33, height: 33, borderRadius: 10, background: 'linear-gradient(135deg,#10A35B,#7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16 }}>N</div>
          <Link href="/" style={{ color: '#8FA197', textDecoration: 'none' }}>Главная</Link>
          <span style={{ color: '#8FA197' }}>/</span>
          <span style={{ color: '#12201A' }}>{breadcrumb}</span>
        </nav>
        <div style={{ background: '#fff', borderRadius: 20, padding: '36px 44px', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

// Общие подкомпоненты для контента
export const H1 = ({ children }: { children: ReactNode }) => (
  <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, marginBottom: 20 }}>{children}</h1>
)
export const H2 = ({ children }: { children: ReactNode }) => (
  <h2 style={{ fontSize: 17, fontWeight: 700, margin: '28px 0 12px' }}>{children}</h2>
)
export const P = ({ children }: { children: ReactNode }) => (
  <p style={{ fontSize: 14.5, lineHeight: 1.7, color: '#3D5246', marginBottom: 10 }}>{children}</p>
)
export const UL = ({ children }: { children: ReactNode }) => (
  <ul style={{ margin: '0 0 12px', paddingLeft: 22, fontSize: 14.5, lineHeight: 1.7, color: '#3D5246' }}>{children}</ul>
)
