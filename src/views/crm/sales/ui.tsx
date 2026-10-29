'use client'

/* Общие элементы вкладки «Аналитика продаж» (стили — через CSS-переменные CRM). */
import { InfoDot } from '@/shared/ui/ui'
import { STATUS_META,type ClientStatus } from '@/views/crm/sales/api'
import { useEffect,useMemo,useRef,useState } from 'react'

/* ── Форматирование ── */
export const money = (n: number | null | undefined) =>
  n == null ? '—' : Math.round(n).toLocaleString('ru-RU') + ' ₸'

export function moneyShort(n: number | null | undefined): string {
  if (n == null) return '—'
  const a = Math.abs(n)
  if (a >= 1e9) return (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + ' млрд ₸'
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + ' млн ₸'
  if (a >= 1e3) return Math.round(n / 1e3) + ' тыс ₸'
  return Math.round(n) + ' ₸'
}
export const num = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('ru-RU'))
export const dateRu = (s: string | null | undefined) =>
  s ? new Date(s + (s.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'
export const monthRu = (s: string) =>
  new Date(s + 'T00:00:00').toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' }).replace('.', '')

export function pctChange(cur: number | null | undefined, prev: number | null | undefined): number | null {
  if (cur == null || prev == null || prev === 0) return null
  return ((cur - prev) / Math.abs(prev)) * 100
}

/* ── Δ-бейдж ── */
export function Delta({ cur, prev, invert = false, suffix }: { cur?: number | null; prev?: number | null; invert?: boolean; suffix?: string }) {
  const p = pctChange(cur, prev)
  if (p == null) return <span style={{ fontSize: 11, color: 'var(--t3)' }}>{suffix ? `нет данных ${suffix}` : '—'}</span>
  const good = invert ? p < 0 : p > 0
  const color = Math.abs(p) < 0.5 ? 'var(--t3)' : good ? 'var(--primary2)' : 'var(--red)'
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color, whiteSpace: 'nowrap' }}>
      {p > 0 ? '▲' : p < 0 ? '▼' : ''} {Math.abs(p).toFixed(Math.abs(p) < 10 ? 1 : 0)}%{suffix ? ` ${suffix}` : ''}
    </span>
  )
}

/* ── Карточки ── */
export function Card({ title, hint, right, children, pad = 16, style }: {
  title?: React.ReactNode; hint?: string; right?: React.ReactNode; children: React.ReactNode; pad?: number; style?: React.CSSProperties
}) {
  return (
    <section style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 'var(--r2)', padding: pad, minWidth: 0, boxShadow: 'var(--shadow)', ...style }}>
      {(title || right) && (
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--t)', display: 'flex', alignItems: 'center', gap: 6 }}>
            {title}{hint && <InfoDot hint={hint} />}
          </h3>
          {right}
        </header>
      )}
      {children}
    </section>
  )
}

export function Kpi({ label, value, sub, hint, tone }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode; hint?: string; tone?: 'red' | 'green' | 'ora'
}) {
  const color = tone === 'red' ? 'var(--red)' : tone === 'green' ? 'var(--primary2)' : tone === 'ora' ? 'var(--ora)' : 'var(--t)'
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 'var(--r2)', padding: '12px 14px', minWidth: 0, boxShadow: 'var(--shadow)' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.03em', display: 'flex', alignItems: 'center', gap: 4 }}>
        {label}{hint && <InfoDot hint={hint} size={13} />}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color, marginTop: 4, fontFamily: 'var(--font-display)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
      {sub && <div style={{ marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{sub}</div>}
    </div>
  )
}

export function StatusPill({ status }: { status: ClientStatus }) {
  const m = STATUS_META[status]
  return (
    <span title={m.hint} style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, color: m.fg, background: m.bg, whiteSpace: 'nowrap' }}>
      {m.label}
    </span>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error'; children: React.ReactNode }) {
  const c = tone === 'error' ? { bg: 'rgba(220,38,38,.08)', bd: 'rgba(220,38,38,.25)', fg: 'var(--red)' }
    : tone === 'warn' ? { bg: 'rgba(217,119,6,.08)', bd: 'rgba(217,119,6,.25)', fg: '#B25E00' }
    : { bg: 'var(--fl)', bd: 'var(--bd2)', fg: 'var(--t2)' }
  return <div style={{ background: c.bg, border: `1px solid ${c.bd}`, color: c.fg, borderRadius: 'var(--r)', padding: '8px 12px', fontSize: 12, lineHeight: 1.45 }}>{children}</div>
}

/* ── Горизонтальная полоса (для разрезов) ── */
export function Bar({ value, max, color = 'var(--primary)' }: { value: number; max: number; color?: string }) {
  const w = max > 0 ? Math.max(0, Math.min(100, (Math.abs(value) / max) * 100)) : 0
  return (
    <div style={{ height: 6, borderRadius: 4, background: 'var(--bg3)', overflow: 'hidden' }}>
      <div style={{ width: `${w}%`, height: '100%', background: color, borderRadius: 4 }} />
    </div>
  )
}

/* ── Таблица с прокруткой по горизонтали ── */
export const th: React.CSSProperties = {
  textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase',
  letterSpacing: '.03em', padding: '8px 10px', borderBottom: '1px solid var(--bd)', whiteSpace: 'nowrap',
  position: 'sticky', top: 0, background: 'var(--bg2)', zIndex: 1,
}
export const td: React.CSSProperties = { padding: '9px 10px', borderBottom: '1px solid var(--bd)', fontSize: 13, color: 'var(--t)', verticalAlign: 'top' }
export const tdNum: React.CSSProperties = { ...td, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }
export const thNum: React.CSSProperties = { ...th, textAlign: 'right' }

export function TableWrap({ children, maxHeight }: { children: React.ReactNode; maxHeight?: number }) {
  return (
    <div style={{ overflowX: 'auto', overflowY: maxHeight ? 'auto' : undefined, maxHeight, margin: '0 -4px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>{children}</table>
    </div>
  )
}

/* ── Мультивыбор (выпадающий список с поиском) ── */
export function MultiSelect({ label, options, value, onChange, width = 220 }: {
  label: string
  options: { value: string; label: string }[]
  value: string[]
  onChange: (v: string[]) => void
  width?: number
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [open])
  const shown = useMemo(() => options.filter(o => o.label.toLowerCase().includes(q.toLowerCase())), [options, q])
  const text = value.length === 0 ? 'Все'
    : value.length === 1 ? (options.find(o => o.value === value[0])?.label ?? '1 выбран')
    : `Выбрано: ${value.length}`
  return (
    <div ref={ref} style={{ position: 'relative', minWidth: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, width: '100%',
          padding: '6px 10px', borderRadius: 10, border: `1px solid ${value.length ? 'var(--primary)' : 'var(--bd2)'}`,
          background: 'var(--bg2)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', minWidth: 0,
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase' }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text} ▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50, width: `min(${width + 60}px, 86vw)`,
          background: 'var(--bg2)', border: '1px solid var(--bd2)', borderRadius: 12, boxShadow: '0 12px 32px -12px rgba(0,0,0,.25)', padding: 8,
        }}>
          {options.length > 8 && (
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск…" autoFocus
              style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--bd2)', background: 'var(--bg3)', color: 'var(--t)', fontSize: 13, fontFamily: 'inherit', marginBottom: 6 }} />
          )}
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {shown.map(o => {
              const on = value.includes(o.value)
              return (
                <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: 'var(--t)', background: on ? 'var(--fl)' : 'transparent' }}>
                  <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter(v => v !== o.value) : [...value, o.value])} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                </label>
              )
            })}
            {!shown.length && <div style={{ padding: 8, fontSize: 12, color: 'var(--t3)' }}>Ничего не найдено</div>}
          </div>
          {value.length > 0 && (
            <button onClick={() => onChange([])} style={{ marginTop: 6, width: '100%', padding: '6px', borderRadius: 8, border: '1px solid var(--bd)', background: 'var(--bg3)', color: 'var(--t2)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              Сбросить
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Выгрузка в CSV (Excel открывает с BOM) ── */
export function downloadCsv(name: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v)
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = '﻿' + [header, ...rows].map(r => r.map(esc).join(';')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Notice tone="error">
      Не удалось загрузить данные: {(error as Error)?.message ?? 'ошибка'}
      {onRetry && <> · <button onClick={onRetry} style={{ background: 'none', border: 'none', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', padding: 0, font: 'inherit' }}>повторить</button></>}
    </Notice>
  )
}
