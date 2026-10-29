'use client'

import { useLanguage } from '@/shared/i18n/LanguageContext'
import type { Lang } from '@/shared/i18n/translations'
import { useEffect,useRef,useState } from 'react'

const OPTIONS: { lang: Lang; short: string; label: string }[] = [
  { lang: 'kz', short: 'ҚАЗ', label: 'Қазақша' },
  { lang: 'ru', short: 'РУ',  label: 'Русский'  },
]

export default function LangSwitch() {
  const { lang, setLang } = useLanguage()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const current = OPTIONS.find(o => o.lang === lang)!

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '4px 8px 4px 6px',
          borderRadius: 8, border: '1px solid var(--bd)',
          background: 'var(--bg3)', cursor: 'pointer',
          fontSize: 13, color: 'var(--t)', fontWeight: 600,
          transition: 'border-color .15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
        onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--bd)')}
      >
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.03em' }}>{current.short}</span>
        <span style={{ fontSize: 11, color: 'var(--t2)' }}>▾</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 999,
          background: 'var(--bg2)', border: '1px solid var(--bd)',
          borderRadius: 10, overflow: 'hidden',
          boxShadow: '0 8px 24px rgba(0,0,0,.14)',
          minWidth: 130,
        }}>
          {OPTIONS.map(o => (
            <button
              key={o.lang}
              onClick={() => { setLang(o.lang); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '9px 14px',
                border: 'none', background: lang === o.lang ? 'var(--primary)15' : 'transparent',
                cursor: 'pointer', textAlign: 'left',
                borderLeft: lang === o.lang ? '3px solid var(--primary)' : '3px solid transparent',
                transition: 'background .12s',
              }}
              onMouseEnter={e => { if (lang !== o.lang) e.currentTarget.style.background = 'var(--bg3)' }}
              onMouseLeave={e => { if (lang !== o.lang) e.currentTarget.style.background = 'transparent' }}
            >
              <span style={{ fontSize: 12, fontWeight: 800, width: 30 }}>{o.short}</span>
              <span style={{ fontSize: 13, fontWeight: lang === o.lang ? 700 : 500, color: lang === o.lang ? 'var(--primary)' : 'var(--t)' }}>
                {o.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
