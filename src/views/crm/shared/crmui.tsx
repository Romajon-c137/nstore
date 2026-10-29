'use client'

import { supabase } from '@/shared/lib/supabase'
import { useQuery } from '@tanstack/react-query'
import { useEffect,useState } from 'react'
import { createPortal } from 'react-dom'

/* ── Mobile hook (shared) ── */
export function useIsMobile() {
  const [v, setV] = useState(false)
  useEffect(() => {
    const fn = () => setV(window.innerWidth <= 768)
    fn()
    window.addEventListener('resize', fn)
    return () => window.removeEventListener('resize', fn)
  }, [])
  return v
}

/* ── Segmented control (shared standard) ──
   Единый стиль сегментных переключателей / фильтров-пилюль во всех вкладках CRM.
   Активный сегмент — зелёная пилюля (#10A35B, белый текст), остальные прозрачные. */
export function Segmented<T extends string | number>({ options, value, onChange, full = false }: {
  options: { value: T; label: React.ReactNode; count?: number }[]
  value: T
  onChange: (v: T) => void
  full?: boolean
}) {
  return (
    <div style={{
      display: full ? 'flex' : 'inline-flex', gap: 4,
      background: 'var(--bg3)', borderRadius: 11, padding: 3, flexShrink: 0, maxWidth: '100%',
    }}>
      {options.map(o => {
        const active = o.value === value
        return (
          <button
            key={String(o.value)}
            onClick={() => onChange(o.value)}
            style={{
              flex: full ? 1 : undefined,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: active ? 'var(--primary)' : 'transparent',
              color: active ? '#fff' : 'var(--t2)',
              fontWeight: 700, fontSize: 13, fontFamily: 'inherit', whiteSpace: 'nowrap',
              transition: 'all .15s',
            }}
          >
            {o.label}
            {o.count != null && (
              <span style={{
                fontSize: 11, fontWeight: 800, padding: '1px 6px', borderRadius: 20,
                background: active ? 'rgba(255,255,255,.25)' : 'var(--bg2)',
                color: active ? '#fff' : 'var(--t3)',
              }}>{o.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ── Search input (shared standard) ──
   Единое окно поиска: серый фон var(--bg3), высота 38, иконка-лупа слева, крестик очистки. */
export function SearchInput({ value, onChange, placeholder = 'Поиск…', grow = false, maxWidth = 320 }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  grow?: boolean
  maxWidth?: number
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: 10,
      padding: '0 12px', height: 38, boxSizing: 'border-box',
      flex: grow ? '1 1 200px' : undefined, maxWidth: grow ? maxWidth : undefined, minWidth: 0,
    }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--t3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
      </svg>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, fontSize: 13, fontFamily: 'inherit', color: 'var(--t)', minWidth: 0 }}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t3)', fontSize: 16, lineHeight: 1, padding: 0, flexShrink: 0 }}
        >×</button>
      )}
    </div>
  )
}

/* ── Avatar colour / initials (shared) ── */
const AC = ['#2E9E6B', '#34C759', '#FF3B30', '#FF9500', '#5AC8FA', '#007AFF', '#5856D6']
export function avColor(id: string): string {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffff
  return AC[h % AC.length]
}
export function initials(name: string | null): string {
  const p = (name || '?').trim().split(/\s+/)
  return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : (name || '?').slice(0, 2).toUpperCase()
}

/* ── Avatar (shared) — circle by default, pass radius for rounded square ── */
export function Avatar({ id, name, size = 40, radius }: { id: string; name: string | null; size?: number; radius?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: radius ?? size / 2, flexShrink: 0,
      background: avColor(id), color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: size * 0.36,
    }}>
      {initials(name)}
    </div>
  )
}

/* ── Modal (shared) ── */
export function Modal({ onClose, children, maxWidth = 480 }: { onClose: () => void; children: React.ReactNode; maxWidth?: number }) {
  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: 'var(--bg2)', borderRadius: 16, width: '100%', maxWidth, maxHeight: '90dvh', overflowY: 'auto', boxShadow: '0 24px 80px rgba(0,0,0,.3)', padding: 24 }}>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/* ── Shared form field styles ── */
export const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 9, border: '1.5px solid var(--bd)',
  background: 'var(--bg3)', color: 'var(--t)', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit',
}
export const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--t2)', marginBottom: 4, display: 'block' }

/* ── Pagination (shared, mobile-friendly) ── */
export function Pagination({ page, pages, total, onChange }: {
  page: number; pages: number; total?: number; onChange: (updater: (p: number) => number) => void
}) {
  const btn = (disabled: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 38, padding: '0 16px', borderRadius: 12, flexShrink: 0,
    border: '1.5px solid var(--bd)', background: 'var(--bg2)', color: 'var(--t)',
    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .4 : 1,
    fontSize: 13, fontWeight: 700, fontFamily: 'inherit', transition: 'opacity .15s',
  })
  const chevron = (dir: 'l' | 'r') => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      {dir === 'l' ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}
    </svg>
  )
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 14px', background: 'var(--bg2)', borderTop: '1px solid var(--bd)', flexShrink: 0 }}>
      <button disabled={page === 0} onClick={() => onChange(p => p - 1)} style={btn(page === 0)}>
        {chevron('l')} Назад
      </button>
      <div style={{ textAlign: 'center', minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--t)' }}>{page + 1} / {pages}</div>
        {total != null && <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 1 }}>{total.toLocaleString('ru-RU')}</div>}
      </div>
      <button disabled={page >= pages - 1} onClick={() => onChange(p => p + 1)} style={btn(page >= pages - 1)}>
        Вперёд {chevron('r')}
      </button>
    </div>
  )
}

/* ── Shared companies dropdown list ── */
export interface CompanyLite { id: string; name: string }
export function useCompaniesList() {
  return useQuery<CompanyLite[]>({
    queryKey: ['companies-list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('companies').select('id, name').eq('hidden', false).order('name')
      if (error) throw error
      return data ?? []
    },
    staleTime: 60_000,
  })
}
