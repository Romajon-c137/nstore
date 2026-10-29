'use client'

export default function TextBlock({ p }: { p: Record<string, unknown> }) {
  const align = (p.align as string) || 'left'
  return (
    <div className="lp-section-pad">
      <div style={{ fontSize: 15, color: '#5C6B63', lineHeight: 1.7, textAlign: align as 'left' | 'center' | 'right' }}>
        {(p.content as string) || ''}
      </div>
    </div>
  )
}
