'use client'

import { Link } from '@/shared/lib/navigation'
import { ORG } from '@/shared/lib/seo'

const telHref = (phone: string) => 'tel:' + phone.replace(/[^\d+]/g, '')

export default function B2BBanner({ p }: { p: Record<string, unknown> }) {
  const phone = (p.phone as string) || ORG.salesPhone
  return (
    <div className="lp-section-pad">
      <div className="lp-b2b-banner" style={{ borderRadius: 22, background: 'linear-gradient(115deg,#3B1574,#5B21D6 55%,#7C3AED)', padding: '32px 34px', color: '#F3ECFF', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
        <div style={{ maxWidth: 620, flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', opacity: .8, marginBottom: 10 }}>ДЛЯ БИЗНЕСА</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26, lineHeight: 1.15 }}>{(p.title as string) || ''}</div>
          {!!p.desc && <div style={{ fontSize: 14, color: '#D9CBF5', marginTop: 10, lineHeight: 1.5 }}>{p.desc as string}</div>}
          <div style={{ fontSize: 14, color: '#EDE4FF', marginTop: 14 }}>
            Оптовые закупки:{' '}
            <a href={telHref(phone)} style={{ color: '#fff', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>{phone}</a>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', flexShrink: 0 }}>
          <Link href="/login" style={{ background: '#fff', color: '#5B21D6', border: 'none', borderRadius: 13, padding: '13px 22px', fontFamily: 'inherit', fontWeight: 700, fontSize: 14, cursor: 'pointer', textDecoration: 'none' }}>
            {(p.btnText as string) || 'Открыть опт B2B'}
          </Link>
          <a href={telHref(phone)} style={{ background: 'rgba(255,255,255,.12)', color: '#fff', border: '1px solid rgba(255,255,255,.35)', borderRadius: 13, padding: '13px 22px', fontFamily: 'inherit', fontWeight: 700, fontSize: 14, cursor: 'pointer', textDecoration: 'none' }}>Узнать условия</a>
        </div>
      </div>
    </div>
  )
}
