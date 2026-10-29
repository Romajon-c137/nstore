'use client'

import { Link } from '@/shared/lib/navigation'

const linkStyle: React.CSSProperties = { color: 'inherit', textDecoration: 'none' }

export default function FooterBlock({ p }: { p: Record<string, unknown> }) {
  const city = (p.city as string) || 'Астана'
  const phone = (p.phone as string) || ''
  const email = (p.email as string) || ''
  const telHref = 'tel:' + phone.replace(/[^\d+]/g, '')

  return (
    <div style={{ marginTop: 24, background: '#0E1E16', color: '#C8D4CD', padding: '38px 28px 28px' }}>
      <div className="lp-footer-grid">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ width: 33, height: 33, borderRadius: 10, background: 'linear-gradient(135deg,#10A35B,#7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16 }}>N</div>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, letterSpacing: '-0.02em', color: '#fff' }}>nstore</span>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: '#8FA197', maxWidth: 280 }}>
            Витрина и опт в одном месте. Свежие продукты с доставкой по городу и оптовые поставки для бизнеса.
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Покупателям</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 13 }}>
            <a href="#lp-catalog" style={linkStyle}>Каталог</a>
            <Link href="/page/delivery" style={linkStyle}>Доставка и оплата</Link>
            <Link href="/page/exchange" style={linkStyle}>Возврат</Link>
            <Link href="/page/about-us" style={linkStyle}>О компании</Link>
            <Link href="/blog" style={linkStyle}>Блог</Link>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Бизнесу</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 13 }}>
            <Link href="/cabinet" style={linkStyle}>Опт B2B</Link>
            <a href="#lp-partner-form" style={linkStyle}>Стать партнёром</a>
            <Link href="/page/contacts" style={linkStyle}>Контакты</Link>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 12 }}>Контакты</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 13 }}>
            <span>{city}</span>
            {phone && <a href={telHref} style={linkStyle}>{phone}</a>}
            {email && <a href={`mailto:${email}`} style={linkStyle}>{email}</a>}
            <span style={{ color: '#8FA197' }}>Пн–Пт 09:00–18:00</span>
            <span style={{ color: '#8FA197' }}>Сб 09:00–12:00</span>
          </div>
        </div>
      </div>
      <div style={{ borderTop: '1px solid #243A2E', marginTop: 26, paddingTop: 16, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, fontSize: 12, color: '#7C8E84' }}>
        <span>© 2026 Nstore. Все права защищены.</span>
        <span>
          <Link href="/page/privacy" style={linkStyle}>Политика конфиденциальности</Link>
          {' · '}
          <Link href="/page/privacy" style={linkStyle}>Публичная оферта</Link>
        </span>
      </div>
    </div>
  )
}
