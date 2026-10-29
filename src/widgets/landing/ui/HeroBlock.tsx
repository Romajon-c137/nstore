'use client'

import { useNavigate } from '@/shared/lib/navigation';

type LinkVal = { kind?: string; href?: string; label?: string }
type PromoItem = { title: string; desc: string; bg: string; color: string; image?: string; link?: LinkVal }

export default function HeroBlock({ p }: { p: Record<string, unknown> }) {
  const navigate = useNavigate()
  const promos: PromoItem[] = (p.promos as PromoItem[]) || [
    { title: 'Кофе недели', desc: 'Свежая обжарка от 3 990 ₸/кг', bg: '#F4EEFE', color: '#5B21D6' },
    { title: 'Соусы Азии', desc: 'Терияки, соевый, устричный', bg: '#FFF4E6', color: '#B25E00' },
  ]

  function go(link?: LinkVal) {
    const href = link?.href
    if (!href) return
    if (/^https?:\/\//.test(href)) window.location.href = href
    else navigate(href)
  }
  function clickable(link?: LinkVal): React.CSSProperties {
    return link?.href ? { cursor: 'pointer' } : {}
  }

  const bannerLink = p.link as LinkVal | undefined
  const bannerImg = (p.image as string) || ''

  return (
    <div className="lp-promo-row">
      {/* ── Main banner ── */}
      <div
        onClick={() => go(bannerLink)}
        style={{
          borderRadius: 20,
          background: bannerImg
            ? `linear-gradient(110deg, rgba(14,124,70,.86), rgba(22,184,106,.62)), url(${bannerImg}) center/cover no-repeat`
            : 'linear-gradient(110deg,#0E7C46,#10A35B 60%,#16B86A)',
          padding: '24px 26px', color: '#EAFBF1', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 168,
          ...clickable(bannerLink),
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.05em', opacity: .85 }}>{(p.subtitle as string) || ''}</div>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 28, lineHeight: 1.15 }}>{(p.title as string) || ''}</div>
          <button
            onClick={e => { e.stopPropagation(); go(bannerLink) }}
            style={{ marginTop: 14, background: '#fff', color: '#0E7C46', border: 'none', borderRadius: 11, padding: '10px 18px', fontFamily: 'inherit', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
          >{(p.btnText as string) || 'Смотреть'}</button>
        </div>
      </div>

      {/* ── Promo cards ── */}
      {promos.slice(0, 2).map((pr, i) => {
        const hasImg = !!pr.image
        return (
          <div
            key={i}
            onClick={() => go(pr.link)}
            style={{
              borderRadius: 20, padding: 20, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 168,
              background: hasImg
                ? `linear-gradient(180deg, rgba(0,0,0,.05), rgba(0,0,0,.45)), url(${pr.image}) center/cover no-repeat`
                : pr.bg,
              ...clickable(pr.link),
            }}
          >
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, color: hasImg ? '#fff' : pr.color, lineHeight: 1.2, textShadow: hasImg ? '0 1px 6px rgba(0,0,0,.4)' : 'none' }}>{pr.title}</div>
            <div style={{ fontSize: 13, color: hasImg ? 'rgba(255,255,255,.92)' : '#6E5B8F', textShadow: hasImg ? '0 1px 6px rgba(0,0,0,.4)' : 'none' }}>{pr.desc}</div>
          </div>
        )
      })}
    </div>
  )
}
