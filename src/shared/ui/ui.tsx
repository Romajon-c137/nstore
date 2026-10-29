'use client'

/* ══════════════════════════════════════════════════════════════════
   Лёгкие общие UI-примитивы (без внешних зависимостей), пригодны и в
   CRM, и в кабинете, и на лендинге. Заменяют скопированную разметку
   спиннеров и пустых состояний.
   ══════════════════════════════════════════════════════════════════ */

import { useLayoutEffect,useRef,useState } from 'react'
import { createPortal } from 'react-dom'

/** Крутящийся индикатор загрузки. Использует глобальный @keyframes spin. */
export function Spinner({ size = 28, color = 'var(--primary)', track = 'var(--bd, #E4E9E6)', style }: {
  size?: number
  color?: string
  track?: string
  style?: React.CSSProperties
}) {
  return (
    <div
      style={{
        width: size, height: size, flexShrink: 0,
        border: `${Math.max(2, Math.round(size / 10))}px solid ${track}`,
        borderTopColor: color, borderRadius: '50%',
        animation: 'spin .7s linear infinite',
        ...style,
      }}
    />
  )
}

/** Центрированный спиннер на всю доступную область (для загрузки экрана/вкладки). */
export function LoadingBox({ size = 28, minHeight = 200, label }: { size?: number; minHeight?: number; label?: string }) {
  return (
    <div style={{ flex: 1, minHeight, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <Spinner size={size} />
      {label && <span style={{ color: 'var(--t3)', fontSize: 14 }}>{label}</span>}
    </div>
  )
}

/** Пустое состояние: приглушённый текст по центру с отступами. */
export function EmptyState({ children, pad = '30px 20px' }: { children: React.ReactNode; pad?: string }) {
  return (
    <div style={{ padding: pad, textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>
      {children}
    </div>
  )
}

/* ── InfoDot (shared standard) ──
   Неприметная кликабельная кнопка «i» рядом с заголовком метрики/таблицы.
   По клику показывает короткое пояснение: что это, как считается, зачем.
   Всплывашка рендерится через портал с fixed-позицией — не обрезается
   контейнерами Tremor и не ломает раскладку карточек. */
export function InfoDot({ hint, label = 'Пояснение', size = 15 }: { hint: string; label?: string; size?: number }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const place = () => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const W = 250
      const left = Math.max(10, Math.min(r.left, window.innerWidth - W - 10))
      setPos({ top: r.bottom + 6, left })
    }
    place()
    window.addEventListener('scroll', () => setOpen(false), { once: true, capture: true })
    window.addEventListener('resize', () => setOpen(false), { once: true })
  }, [open])

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', flexShrink: 0, lineHeight: 0 }}>
      <span
        role="button"
        tabIndex={0}
        aria-label={label}
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setOpen(o => !o) } }}
        style={{
          width: size, height: size, borderRadius: '50%',
          border: `1px solid ${open ? 'var(--primary)' : 'var(--t3)'}`,
          color: open ? 'var(--primary)' : 'var(--t3)',
          fontSize: Math.round(size * 0.68), fontWeight: 700, fontStyle: 'italic',
          fontFamily: 'Georgia, "Times New Roman", serif',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', userSelect: 'none', lineHeight: 1,
          opacity: open ? 1 : 0.55, transition: 'opacity .15s, color .15s, border-color .15s',
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.opacity = '0.9' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.opacity = '0.55' }}
      >i</span>
      {open && pos && createPortal(
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 2147483646 }} />
          <div
            role="tooltip"
            style={{
              position: 'fixed', top: pos.top, left: pos.left, zIndex: 2147483647,
              width: 250, maxWidth: 'calc(100vw - 20px)',
              background: 'var(--t)', color: 'var(--bg2)',
              fontSize: 12, lineHeight: 1.5, fontWeight: 500, fontStyle: 'normal',
              padding: '10px 12px', borderRadius: 10,
              boxShadow: '0 12px 32px rgba(0,0,0,.28)', textAlign: 'left',
            }}
          >{hint}</div>
        </>,
        document.body,
      )}
    </span>
  )
}

/* ── Button (shared standard) ──
   Единая кнопка. Варианты: primary (зелёная), secondary (серая),
   danger (красная), ghost (прозрачная с рамкой). Ховер — на самом
   элементе (как в остальном инлайн-коде), без зависимости от CSS. */
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg' | 'form'

const BTN_PALETTE: Record<ButtonVariant, { bg: string; fg: string; hover: string; border: string; font: string }> = {
  primary:   { bg: 'var(--primary)', fg: '#fff',      hover: 'var(--primary2)',       border: 'none',               font: 'var(--font-display)' },
  secondary: { bg: 'var(--bg3)',     fg: 'var(--t)',  hover: 'var(--bd2)',            border: '1px solid var(--bd)', font: 'inherit' },
  danger:    { bg: '#DC2626',        fg: '#fff',      hover: '#B91C1C',               border: 'none',               font: 'var(--font-display)' },
  ghost:     { bg: 'transparent',    fg: 'var(--t2)', hover: 'rgba(120,130,125,.12)', border: '1px solid var(--bd)', font: 'inherit' },
}
const BTN_SIZE: Record<ButtonSize, { h: number; px: number; fs: number }> = {
  sm:   { h: 32, px: 12, fs: 12 },
  md:   { h: 40, px: 16, fs: 13 },
  lg:   { h: 48, px: 20, fs: 14 },
  form: { h: 46, px: 18, fs: 14 }, // публичный сайт (лендинг/кабинет)
}

export function Button({
  variant = 'primary', size = 'md', full = false, loading = false, font,
  disabled, children, style, onMouseEnter, onMouseLeave, ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  full?: boolean
  loading?: boolean
  /** Переопределить шрифт (напр. 'inherit' для лендинга/кабинета на Onest). */
  font?: 'display' | 'inherit'
}) {
  const pal = BTN_PALETTE[variant]
  const sz = BTN_SIZE[size]
  const off = disabled || loading
  const fontFamily = font === 'inherit' ? 'inherit' : font === 'display' ? 'var(--font-display)' : pal.font
  return (
    <button
      disabled={off}
      onMouseEnter={e => { if (!off) e.currentTarget.style.background = pal.hover; onMouseEnter?.(e) }}
      onMouseLeave={e => { if (!off) e.currentTarget.style.background = pal.bg; onMouseLeave?.(e) }}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        height: sz.h, padding: `0 ${sz.px}px`, width: full ? '100%' : undefined,
        background: pal.bg, color: pal.fg, border: pal.border, borderRadius: 12,
        fontFamily, fontWeight: 700, fontSize: sz.fs,
        cursor: off ? 'not-allowed' : 'pointer', opacity: off ? 0.6 : 1,
        whiteSpace: 'nowrap', transition: 'background .15s', boxSizing: 'border-box',
        ...style,
      }}
      {...rest}
    >
      {loading && <Spinner size={16} color="currentColor" track="rgba(255,255,255,.35)" />}
      {children}
    </button>
  )
}

/* ── Field / Input (shared standard) ──
   Подпись сверху (uppercase, приглушённая) + стандартный инпут с фокус-рамкой. */
export function Field({ label, children, style }: { label?: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={style}>
      {label != null && (
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.04em' }}>
          {label}
        </div>
      )}
      {children}
    </div>
  )
}

export const INPUT_STYLE: React.CSSProperties = {
  width: '100%', padding: '10px 13px', borderRadius: 10, border: '1.5px solid var(--bd)',
  background: 'var(--bg2)', color: 'var(--t)', fontSize: 13, fontFamily: 'inherit',
  outline: 'none', boxSizing: 'border-box',
}

export function Input({ style, onFocus, onBlur, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      onFocus={e => { e.currentTarget.style.borderColor = 'var(--primary)'; onFocus?.(e) }}
      onBlur={e => { e.currentTarget.style.borderColor = 'var(--bd)'; onBlur?.(e) }}
      style={{ ...INPUT_STYLE, ...style }}
      {...rest}
    />
  )
}
