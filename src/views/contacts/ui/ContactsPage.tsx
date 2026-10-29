'use client'

import { Link } from '@/shared/lib/navigation'
import { BRAND,ORG,SITE,breadcrumbLd,localBusinessLd } from '@/shared/lib/seo'
import JsonLd from '@/shared/ui/JsonLd'
import { Helmet } from '@/shared/ui/Seo'

const card: React.CSSProperties = { background: '#fff', borderRadius: 20, padding: '32px 40px', boxShadow: '0 1px 4px rgba(0,0,0,.06)' }
const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, padding: '14px 0', borderBottom: '1px solid #EEF1EF', fontSize: 15 }
const label: React.CSSProperties = { width: 200, color: '#8A968E', fontWeight: 600 }
const link: React.CSSProperties = { color: 'var(--primary)', fontWeight: 700, textDecoration: 'none' }

export default function ContactsPage() {
  const canonical = `${SITE}/page/contacts`
  const title = `Контакты — ${BRAND}, оптовый поставщик продуктов в Астане`
  const desc = `Контакты Nstore: телефоны отдела продаж и опта, email, WhatsApp, адрес склада в Астане. Доставка по Казахстану, B2B-условия для HoReCa и магазинов.`

  return (
    <div style={{ minHeight: '100dvh', background: '#EEF1F0', fontFamily: "'Onest', system-ui, sans-serif", color: '#12201A' }}>
      <Helmet>
        <html lang="ru" />
        <title>{title}</title>
        <meta name="description" content={desc} />
        <link rel="canonical" href={canonical} />
        <link rel="alternate" hrefLang="ru" href={canonical} />
        <link rel="alternate" hrefLang="kk" href={canonical} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={canonical} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={desc} />
      </Helmet>
      <JsonLd
        data={[
          localBusinessLd(),
          breadcrumbLd([
            { name: 'Главная', url: SITE },
            { name: 'Контакты', url: canonical },
          ]),
        ]}
      />

      <div className="lp-outer" style={{ maxWidth: 860, margin: '0 auto', padding: '20px 20px 80px' }}>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28, fontSize: 13 }}>
          <div style={{ width: 33, height: 33, borderRadius: 10, background: 'linear-gradient(135deg,#10A35B,#7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16 }}>N</div>
          <Link href="/" style={{ color: '#8FA197', textDecoration: 'none' }}>Главная</Link>
          <span style={{ color: '#8FA197' }}>/</span>
          <span style={{ color: '#12201A' }}>Контакты</span>
        </nav>

        <div style={card}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, marginBottom: 8 }}>Контакты</h1>
          <p style={{ fontSize: 15, color: '#5C6B63', lineHeight: 1.6, marginBottom: 24 }}>
            {BRAND} — оптовый поставщик продуктов питания в Астане. Работаем с кафе, ресторанами (HoReCa),
            магазинами и офисами, доставляем по всему Казахстану.
          </p>

          <div style={row}>
            <span style={label}>Телефон (каталог)</span>
            <a href={'tel:' + ORG.telephone.replace(/[^\d+]/g, '')} style={link}>{ORG.telephone}</a>
          </div>
          <div style={row}>
            <span style={label}>Отдел опта (B2B)</span>
            <a href={'tel:' + ORG.salesPhone.replace(/[^\d+]/g, '')} style={link}>{ORG.salesPhone}</a>
          </div>
          <div style={row}>
            <span style={label}>WhatsApp</span>
            <a href="https://wa.me/77005220006" target="_blank" rel="noopener noreferrer" style={link}>Написать в WhatsApp</a>
          </div>
          <div style={row}>
            <span style={label}>Email</span>
            <a href={'mailto:' + ORG.email} style={link}>{ORG.email}</a>
          </div>
          <div style={row}>
            <span style={label}>Город</span>
            <span>{ORG.address.city}, Казахстан</span>
          </div>
          <div style={row}>
            <span style={label}>Режим работы</span>
            <span>Пн–Пт 09:00–18:00, Сб 09:00–12:00</span>
          </div>
          <div style={{ ...row, borderBottom: 'none' }}>
            <span style={label}>На карте</span>
            <a href={ORG.map2gis} target="_blank" rel="noopener noreferrer" style={link}>Смотреть в 2ГИС</a>
          </div>

          <div style={{ marginTop: 28, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link href="/" style={{ padding: '13px 24px', borderRadius: 12, background: 'var(--primary)', color: '#fff', fontWeight: 700, fontSize: 15, textDecoration: 'none' }}>В каталог</Link>
            <Link href="/register" style={{ padding: '13px 24px', borderRadius: 12, background: '#F2F5F3', color: '#12201A', fontWeight: 700, fontSize: 15, textDecoration: 'none' }}>Стать партнёром</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
