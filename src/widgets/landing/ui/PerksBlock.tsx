'use client'

import { DEFAULT_PERKS } from '@/entities/content';

export default function PerksBlock({ p }: { p: Record<string, unknown> }) {
  type PerkItem = { title: string; desc: string }
  const items = (p.items as PerkItem[]) || DEFAULT_PERKS
  return (
    <div className="lp-section-pad">
      <div className="lp-trust-grid">
        {items.map((t, i) => (
          <div key={i} style={{ border: '1px solid #EDF1EF', borderRadius: 18, padding: 18, display: 'flex', gap: 13, alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1A2A21' }}>{t.title}</div>
              <div style={{ fontSize: 12, color: '#7A867E', marginTop: 3, lineHeight: 1.45 }}>{t.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
