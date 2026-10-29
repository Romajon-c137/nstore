'use client'

import { useNavigate } from '@/shared/lib/navigation';

type LinkVal = { kind?: string; href?: string; label?: string }

export default function PromoSaleBlock({ p }: { p: Record<string, unknown> }) {
  const navigate = useNavigate()
  const title       = (p.title as string)       || 'Акция'
  const description = (p.description as string) || ''
  const discount    = (p.discount_pct as number) || 0
  const endDate     = (p.end_date as string)     || ''
  const image       = (p.image as string)        || ''
  const link        = p.link as LinkVal | undefined

  const endStr = endDate
    ? new Date(endDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
    : ''

  function go() {
    const href = link?.href
    if (!href) return
    if (/^https?:\/\//.test(href)) window.location.href = href
    else navigate(href)
  }

  return (
    <div
      onClick={go}
      style={{
        background: image
          ? `linear-gradient(130deg, rgba(91,33,214,.88) 0%, rgba(124,58,237,.78) 55%, rgba(157,95,245,.7) 100%), url(${image}) center/cover no-repeat`
          : 'linear-gradient(130deg, #5B21D6 0%, #7C3AED 55%, #9D5FF5 100%)',
        padding: '28px 32px',
        display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap',
        cursor: link?.href ? 'pointer' : 'default',
      }}
    >
      {discount > 0 && (
        <div style={{
          flexShrink: 0, width: 100, height: 100, borderRadius: '50%',
          background: '#fff', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 6px 24px rgba(0,0,0,.25)',
        }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26, color: '#7C3AED', lineHeight: 1 }}>
            −{discount}%
          </div>
        </div>
      )}
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, color: '#fff', marginBottom: 8, lineHeight: 1.2 }}>
          {title}
        </div>
        {description && (
          <div style={{ fontSize: 14, color: 'rgba(255,255,255,.85)', marginBottom: endStr ? 10 : 0, lineHeight: 1.5 }}>
            {description}
          </div>
        )}
        {endStr && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,.15)', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700, color: '#fff' }}>
            До {endStr}
          </div>
        )}
      </div>
    </div>
  )
}
