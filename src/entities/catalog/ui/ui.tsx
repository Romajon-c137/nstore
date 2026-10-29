'use client'

import type { CatalogProduct } from '@/entities/catalog/model/types';
import { useEffect,useState,type ReactNode } from 'react';

/* ── Иконки (stroke, 24×24) ────────────────────────────────────────────── */

const I = ({ d, size = 20, sw = 2 }: { d: ReactNode; size?: number; sw?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
)
export const IconSearch = (p: { size?: number }) => <I {...p} d={<><circle cx={11} cy={11} r={7} /><path d="m20 20-3.5-3.5" /></>} />
export const IconX = (p: { size?: number }) => <I {...p} d={<path d="M18 6 6 18M6 6l12 12" />} />
export const IconPlus = (p: { size?: number }) => <I {...p} sw={2.4} d={<path d="M12 5v14M5 12h14" />} />
export const IconMinus = (p: { size?: number }) => <I {...p} sw={2.4} d={<path d="M5 12h14" />} />
export const IconCart = (p: { size?: number }) => <I {...p} d={<><path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.5L21 8H6" /><circle cx={10} cy={20.5} r={1} /><circle cx={17} cy={20.5} r={1} /></>} />
export const IconFilter = (p: { size?: number }) => <I {...p} d={<path d="M4 6h16M7 12h10M10 18h4" />} />
export const IconGrid = (p: { size?: number }) => <I {...p} d={<><rect x={3.5} y={3.5} width={7} height={7} rx={2} /><rect x={13.5} y={3.5} width={7} height={7} rx={2} /><rect x={3.5} y={13.5} width={7} height={7} rx={2} /><rect x={13.5} y={13.5} width={7} height={7} rx={2} /></>} />
export const IconRepeat = (p: { size?: number }) => <I {...p} d={<><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></>} />
export const IconOrders = (p: { size?: number }) => <I {...p} d={<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>} />
export const IconUser = (p: { size?: number }) => <I {...p} d={<><circle cx={12} cy={8} r={4} /><path d="M4 21a8 8 0 0 1 16 0" /></>} />
export const IconHeart = ({ filled, size }: { filled?: boolean; size?: number }) => (
  <svg width={size ?? 20} height={size ?? 20} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 20s-7.5-4.6-9.3-9.2C1.5 7.6 3.6 4.5 7 4.5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.4 0 5.5 3.1 4.3 6.3C19.5 15.4 12 20 12 20z" />
  </svg>
)
export const IconChevron = (p: { size?: number }) => <I {...p} d={<path d="m6 9 6 6 6-6" />} />
export const IconBox = (p: { size?: number }) => <I {...p} sw={1.6} d={<><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="m3 8 9 5 9-5M12 13v8" /></>} />

/* ── Фото товара с аккуратным плейсхолдером ────────────────────────────── */

export function ProductImage({ product, eager }: { product: CatalogProduct; eager?: boolean }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [product.image])
  if (!product.image || failed) {
    return (
      <div className="sh-ph" aria-label="Нет фото">
        <div style={{ display: 'grid', placeItems: 'center' }}>
          <IconBox size={44} />
          {product.brand && <span>{product.brand}</span>}
        </div>
      </div>
    )
  }
  return (
    <img
      src={product.image}
      alt={product.name}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}

/* ── Шторка: справа на desktop / снизу на mobile ───────────────────────── */

export function Sheet({ title, subtitle, onClose, children, footer, variant = 'right', label, actions }: {
  title?: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode
  variant?: 'right' | 'center'; label?: string; actions?: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  return (
    <>
      <div className="sh-overlay" onClick={onClose} />
      <div className={`sh-sheet ${variant}`} role="dialog" aria-modal="true" aria-label={label ?? (typeof title === 'string' ? title : undefined)}>
        {title && (
          <div className="sh-sheet-head">
            {/* На мобильном шторка — полноэкранная страница со стрелкой «назад» */}
            <button className="sh-back sh-mob" onClick={onClose} aria-label="Назад"><IconBack size={22} /></button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2>{title}</h2>
              {subtitle && <div className="sh-sheet-sub">{subtitle}</div>}
            </div>
            {actions}
            <button className="sh-x sh-desk" onClick={onClose} aria-label="Закрыть"><IconX /></button>
          </div>
        )}
        {children}
        {footer && <div className="sh-sheet-foot">{footer}</div>}
      </div>
    </>
  )
}

/* ── Степпер количества ────────────────────────────────────────────────── */

export function Stepper({ qty, unit, onInc, onDec, size, tone = 'primary', canInc = true }: {
  qty: number; unit?: string; onInc: () => void; onDec: () => void
  size?: 'sm'; tone?: 'primary' | 'light'; canInc?: boolean
}) {
  return (
    <div className={`sh-step${size ? ` ${size}` : ''}${tone === 'light' ? ' light' : ''}`}>
      <button onClick={onDec} aria-label="Меньше"><IconMinus size={size ? 16 : 18} /></button>
      <div className="v" aria-live="polite">{qty}{unit && <small>{unit}</small>}</div>
      <button onClick={onInc} disabled={!canInc} aria-label="Больше" style={{ opacity: canInc ? 1 : .4 }}><IconPlus size={size ? 16 : 18} /></button>
    </div>
  )
}

export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2400); return () => clearTimeout(t) }, [text, onDone])
  return <div className="sh-toast" role="status">{text}</div>
}

export const IconBack = (p: { size?: number }) => <I {...p} d={<path d="M15 5l-7 7 7 7" />} />
export const IconArrowRight = (p: { size?: number }) => <I {...p} d={<path d="M5 12h14M13 6l6 6-6 6" />} />
export const IconChevronRight = (p: { size?: number }) => <I {...p} d={<path d="m9 6 6 6-6 6" />} />
export const IconTrash = (p: { size?: number }) => <I {...p} sw={1.8} d={<><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></>} />
export const IconHome = (p: { size?: number }) => <I {...p} d={<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" />} />
export const IconCatalog = (p: { size?: number }) => <I {...p} d={<><rect x={4} y={4} width={16} height={6} rx={2} /><rect x={4} y={14} width={16} height={6} rx={2} /></>} />

/* ── Иконки категорий (линейные, 26 px) ────────────────────────────────── */

const CAT_PATHS: Record<string, ReactNode> = {
  coffee: <><path d="M5 10h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z" /><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16" /><path d="M8 3c0 1.5 1.5 1.5 1.5 3M12 3c0 1.5 1.5 1.5 1.5 3" /></>,
  milk: <><path d="M9 3h6v3l2 3v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9l2-3z" /><path d="M7 12h10" /></>,
  syrups: <><path d="M10 2h4v4l1.5 2.5V20a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2V8.5L10 6z" /><path d="M9 13h6" /></>,
  sauces: <><path d="M11 2h2v3l3 3.5V20a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V8.5L11 5z" /><path d="M8 12c2 1 6 1 8 0" /></>,
  drinks: <><path d="M6 6h12l-1.5 14a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2z" /><path d="M13 6l2-4M7 11h10" /></>,
  tea: <><path d="M12 21c-5 0-8-4-8-9 4 0 8 2 8 6M12 21c5 0 8-4 8-9-4 0-8 2-8 6" /><path d="M12 18V8M12 8c0-3 2-5 4-6" /></>,
  supplies: <><path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="m3 8 9 5 9-5M12 13v8" /></>,
  equipment: <><rect x={5} y={3} width={14} height={18} rx={2} /><path d="M5 8h14M9 13h6v4H9zM8 21v-1M16 21v-1" /></>,
  other: <><circle cx={6} cy={12} r={1.3} fill="currentColor" /><circle cx={12} cy={12} r={1.3} fill="currentColor" /><circle cx={18} cy={12} r={1.3} fill="currentColor" /></>,
}
export function CategoryIcon({ id, size = 26 }: { id: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{CAT_PATHS[id] ?? CAT_PATHS.other}</svg>
}

/* ── Баннер: чашка капучино, зёрна, листья (SVG — без внешних фото) ───── */

export function HeroArt() {
  return (
    <svg viewBox="0 0 520 220" preserveAspectRatio="xMaxYMax meet" aria-hidden className="sh-hero-art">
      <defs>
        <radialGradient id="crema" cx="50%" cy="45%" r="55%"><stop offset="0" stopColor="#E9C9A1" /><stop offset=".7" stopColor="#C58B55" /><stop offset="1" stopColor="#7A4A26" /></radialGradient>
        <linearGradient id="cup" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#2B211C" /><stop offset="1" stopColor="#120D0A" /></linearGradient>
        <linearGradient id="jug" x1="0" x2="1"><stop offset="0" stopColor="#8E9399" /><stop offset=".45" stopColor="#E7EAEE" /><stop offset="1" stopColor="#7C8187" /></linearGradient>
      </defs>
      <path d="M380 20h70l10 30v120a14 14 0 0 1-14 14h-62a14 14 0 0 1-14-14V50z" fill="url(#jug)" opacity=".9" />
      <path d="M460 60c30 0 34 60 0 70" fill="none" stroke="#9AA0A6" strokeWidth="10" strokeLinecap="round" />
      <ellipse cx="300" cy="196" rx="150" ry="18" fill="#1A1210" opacity=".18" />
      <ellipse cx="300" cy="186" rx="140" ry="20" fill="#2A1F1A" />
      <path d="M200 110h200l-14 60a24 24 0 0 1-23 18H237a24 24 0 0 1-23-18z" fill="url(#cup)" />
      <path d="M396 124c34-4 40 40 6 46" fill="none" stroke="#211814" strokeWidth="12" strokeLinecap="round" />
      <ellipse cx="300" cy="110" rx="100" ry="22" fill="#1A1210" />
      <ellipse cx="300" cy="110" rx="92" ry="18" fill="url(#crema)" />
      <path d="M300 96c-14 0-22 6-22 12 8-4 14-4 22 2 8-6 14-6 22-2 0-6-8-12-22-12zM300 106c-10 0-16 4-16 8 6-2 10-2 16 2 6-4 10-4 16-2 0-4-6-8-16-8z" fill="#F7EBDD" opacity=".95" />
      {[[120, 170, 20], [150, 192, -30], [96, 196, 40], [170, 160, 70], [60, 182, -10], [132, 140, 15], [455, 200, 30], [480, 186, -40]].map(([x, y, r], i) => (
        <g key={i} transform={`translate(${x} ${y}) rotate(${r})`}><ellipse rx="11" ry="7.5" fill="#4A2A17" /><path d="M-9 0c5-2 13 2 18 0" stroke="#24130A" strokeWidth="1.6" fill="none" /></g>
      ))}
      <path d="M178 70c20-30 60-34 78-24-24 6-44 18-78 24z" fill="#4C7A3A" />
      <path d="M150 96c10-26 40-36 58-30-18 8-34 20-58 30z" fill="#6C9A4E" />
      <path d="M470 120c6-26 30-40 46-36-14 10-26 22-46 36z" fill="#5E8C44" />
    </svg>
  )
}
