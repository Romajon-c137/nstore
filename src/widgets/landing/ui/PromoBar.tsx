'use client'

export default function PromoBar({ p }: { p: Record<string, unknown> }) {
  return (
    <div style={{ background: (p.bgColor as string) || '#0E7C46', color: '#EAFBF1', fontSize: 13, fontWeight: 600, padding: '9px 24px', textAlign: 'center' }}>
      {(p.text as string) || ''}
    </div>
  )
}
