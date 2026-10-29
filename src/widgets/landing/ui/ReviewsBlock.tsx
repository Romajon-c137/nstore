'use client'

export default function ReviewsBlock({ p }: { p: Record<string, unknown> }) {
  type ReviewItem = { text: string; author: string }
  const items = (p.items as ReviewItem[]) || []
  return (
    <div className="lp-section-pad">
      {!!p.title && <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, marginBottom: 16 }}>{p.title as string}</div>}
      <div className="lp-trust-grid">
        {items.map((r, i) => (
          <div key={i} style={{ background: '#F9F5FF', border: '1px solid #EDE3FB', borderRadius: 18, padding: '16px 18px' }}>
            <div style={{ fontSize: 14, color: '#12201A', lineHeight: 1.6, marginBottom: 10 }}>{r.text}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#5C6B63' }}>— {r.author}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
