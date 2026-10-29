'use client'

import { DEFAULT_STEPS } from '@/entities/content';

export default function StepsBlock({ p }: { p: Record<string, unknown> }) {
  type StepItem = { title: string; desc: string }
  const items: StepItem[] = (p.items as StepItem[]) || DEFAULT_STEPS
  return (
    <div className="lp-section-pad">
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, marginBottom: 16 }}>{(p.title as string) || 'Как начать работу'}</div>
      <div className="lp-steps-row">
        {items.map((s, i) => (
          <div key={i} style={{ border: '1px solid #EDF1EF', borderRadius: 18, padding: 20 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, marginBottom: 12 }}>
              {i + 1}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1A2A21', marginBottom: 4 }}>{s.title}</div>
            <div style={{ fontSize: 12, color: '#7A867E', lineHeight: 1.5 }}>{s.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
