'use client'

import { Link } from '@/shared/lib/navigation'
import { BRAND } from '@/shared/lib/seo'
import { Helmet } from '@/shared/ui/Seo'

export default function NotFoundPage() {
  return (
    <div style={{ minHeight: '100dvh', background: '#EEF1F0', fontFamily: "'Onest', system-ui, sans-serif", color: '#12201A', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, textAlign: 'center', padding: 24 }}>
      <Helmet>
        <title>Страница не найдена — {BRAND}</title>
        <meta name="robots" content="noindex, follow" />
      </Helmet>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 64, color: 'var(--primary)', lineHeight: 1 }}>404</div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22 }}>Страница не найдена</h1>
      <p style={{ fontSize: 15, color: '#5C6B63', maxWidth: 420 }}>
        Возможно, страница переехала или её больше нет. Загляните в каталог — там оптовые
        продукты питания с доставкой по Казахстану.
      </p>
      <Link href="/" style={{ marginTop: 6, padding: '13px 26px', borderRadius: 12, background: 'var(--primary)', color: '#fff', fontWeight: 700, fontSize: 15, textDecoration: 'none' }}>
        В каталог
      </Link>
    </div>
  )
}
