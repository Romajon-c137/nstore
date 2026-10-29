'use client'

import { type DbProduct } from '@/entities/content';
import { Link } from '@/shared/lib/navigation';
import SearchBox from '@/widgets/landing/ui/SearchBox';

export default function Header({ p, onPickProduct }: { p: Record<string, unknown>; onPickProduct: (p: DbProduct) => void }) {
  return (
    <div className="lp-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <div style={{ width: 38, height: 38, borderRadius: 12, background: 'linear-gradient(135deg,#10A35B,#7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20 }}>N</div>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em' }}>nstore</span>
      </div>
      <button className="lp-city-btn" style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#F2F5F3', border: 'none', borderRadius: 12, padding: '10px 15px', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, color: '#1C2A22', cursor: 'pointer', flexShrink: 0 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--primary)', flexShrink: 0 }}></span>
        {(p.city as string) || 'Астана'}
      </button>
      <SearchBox onPick={onPickProduct} />
      <Link href="/shop" style={{ display: 'flex', alignItems: 'center', background: '#F2F5F3', borderRadius: 13, padding: '0 16px', height: 46, color: '#1C2A22', fontWeight: 700, fontSize: 14, textDecoration: 'none', flexShrink: 0, marginLeft: 'auto' }}>
        Каталог
      </Link>
      <Link href="/login" style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--primary)', borderRadius: 13, padding: '0 18px', height: 46, color: '#fff', fontWeight: 700, fontSize: 14, textDecoration: 'none', flexShrink: 0 }}>
        {(p.loginText as string) || 'Войти'}
      </Link>
    </div>
  )
}
