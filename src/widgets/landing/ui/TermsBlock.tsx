'use client'

import { DEFAULT_TERMS } from '@/entities/content';

export default function TermsBlock({ p }: { p: Record<string, unknown> }) {
  type TermItem = { title: string; desc: string }
  const items: TermItem[] = (p.items as TermItem[]) || DEFAULT_TERMS
  return (
    <div className="lp-section-pad">
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, marginBottom: 16 }}>{(p.title as string) || 'Условия работы'}</div>
      <div className="lp-trust-grid">
        {items.map((t, i) => (
          <div key={i} style={{ border: '1px solid #EDF1EF', borderRadius: 18, padding: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1A2A21' }}>{t.title}</div>
            <div style={{ fontSize: 12, color: '#7A867E', marginTop: 5, lineHeight: 1.5 }}>{t.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
