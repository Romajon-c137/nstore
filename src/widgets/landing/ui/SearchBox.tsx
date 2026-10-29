'use client'

import { fmt,type DbProduct } from '@/entities/content'
import { useLandingCatalog } from '@/features/shopping'
import { useEffect,useRef,useState } from 'react'

export default function SearchBox({ onPick }: { onPick: (p: DbProduct) => void }) {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // debounce ввода
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])

  const { products, isLoading: isFetching } = useLandingCatalog()
  const words = debounced.toLocaleLowerCase('ru-RU').split(/\s+/).filter(Boolean)
  const results = words.length ? products.filter(product => words.every(word => `${product.name} ${product.sku ?? ''}`.toLocaleLowerCase('ru-RU').includes(word))).slice(0, 8) : []

  return (
    <div ref={ref} className="lp-search" style={{ position: 'relative' }}>
      <span style={{ color: '#8A968E', fontSize: 18 }}>⌕</span>
      <input
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Молоко, кофе, соусы, напитки…"
        style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, fontSize: 15, fontFamily: 'inherit', color: '#12201A', minWidth: 0 }}
      />
      {q && <span onClick={() => setQ('')} style={{ cursor: 'pointer', color: '#8A968E', fontSize: 18, flexShrink: 0 }}>×</span>}
      {open && debounced.length >= 2 && (
        <div style={{ position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0, background: '#fff', border: '1px solid #EDF1EF', borderRadius: 14, boxShadow: '0 12px 40px rgba(16,40,28,.15)', overflow: 'hidden', zIndex: 50, maxHeight: 380, overflowY: 'auto' }}>
          {isFetching && results.length === 0 ? (
            <div style={{ padding: 16, fontSize: 14, color: '#8A968E', textAlign: 'center' }}>Поиск…</div>
          ) : results.length === 0 ? (
            <div style={{ padding: 16, fontSize: 14, color: '#8A968E', textAlign: 'center' }}>Ничего не найдено</div>
          ) : results.map(p => (
            <div key={p.id} onClick={() => { onPick(p); setOpen(false); setQ('') }}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #F4F7F5' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#F7FAF8')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <div style={{ width: 38, height: 38, borderRadius: 8, background: '#fff', border: '1px solid #EDF1EF', flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {p.image_url && <img src={p.image_url} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 3, boxSizing: 'border-box' }} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1A2A21', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                {p.vol && <div style={{ fontSize: 11, color: '#8A968E' }}>{p.vol}</div>}
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, color: 'var(--primary)', flexShrink: 0 }}>
                {p.price != null ? fmt(p.price) : '—'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
