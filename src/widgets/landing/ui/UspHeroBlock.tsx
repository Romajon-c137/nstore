'use client'

import { DEFAULT_HERO_STATS } from '@/entities/content';

export default function UspHeroBlock({ p }: { p: Record<string, unknown> }) {
  type StatItem = { value: string; label: string }
  const stats: StatItem[] = (p.stats as StatItem[]) || DEFAULT_HERO_STATS
  return (
    <div className="lp-section-pad">
      <div className="lp-usp-hero" style={{ borderRadius: 24, background: 'linear-gradient(120deg,#0E1E16,#12291D 55%,#0E7C46)', color: '#EAFBF1', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ maxWidth: 640 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 32, lineHeight: 1.15, marginBottom: 12 }}>
            {(p.title as string) || 'Продукты питания оптом и в розницу'}
          </div>
          <div style={{ fontSize: 15, color: '#B9D6C4', lineHeight: 1.6 }}>
            {(p.subtitle as string) || 'Прямые поставки от дистрибьютора — свежесть, цены и сроки под контролем'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a href="#lp-catalog" style={{ background: '#fff', color: '#0E7C46', border: 'none', borderRadius: 13, padding: '14px 24px', fontFamily: 'inherit', fontWeight: 700, fontSize: 15, cursor: 'pointer', textDecoration: 'none' }}>
            {(p.primaryBtnText as string) || 'Смотреть каталог'}
          </a>
          <a href="#lp-partner-form" style={{ background: 'rgba(255,255,255,.12)', color: '#fff', border: '1px solid rgba(255,255,255,.35)', borderRadius: 13, padding: '14px 24px', fontFamily: 'inherit', fontWeight: 700, fontSize: 15, cursor: 'pointer', textDecoration: 'none' }}>
            {(p.secondaryBtnText as string) || 'Стать партнёром B2B'}
          </a>
        </div>

        <div className="lp-stats-row">
          {stats.map((s, i) => (
            <div key={i} style={{ background: 'rgba(255,255,255,.08)', borderRadius: 16, padding: '16px 18px' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 24 }}>{s.value}</div>
              <div style={{ fontSize: 12, color: '#B9D6C4', marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
