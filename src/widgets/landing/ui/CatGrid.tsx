'use client'

import { DEFAULT_CATS,pluralTovar } from '@/entities/content';

export default function CatGrid({ p, onSectionSelect, counts }: { p: Record<string, unknown>; onSectionSelect: (s: string) => void; counts: Record<string, number> }) {
  type CatItem = { name: string; count?: string; image?: string }

  // Категории берём из реального каталога (section_name из 1С), чтобы плитки
  // всегда совпадали с выгрузкой и счётчиками. Настроенные в блоке items
  // используем только как источник картинок по совпадению названия.
  const configured = (p.items as CatItem[]) || []
  const imageByName: Record<string, string> = {}
  configured.forEach(c => { if (c.image) imageByName[c.name] = c.image })

  const fromCatalog: CatItem[] = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => ({ name, image: imageByName[name] }))

  // fallback: пока счётчики не загрузились — показываем настроенные/дефолтные
  const items: CatItem[] = fromCatalog.length > 0 ? fromCatalog : (configured.length > 0 ? configured : DEFAULT_CATS)
  return (
    <div className="lp-section-pad">
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, marginBottom: 16 }}>{(p.title as string) || 'Категории'}</div>
      <div className="lp-cat-grid">
        {items.map((c, i) => {
          const img = c.image
          return (
            <div
              key={i}
              onClick={() => { onSectionSelect(c.name); document.getElementById('lp-catalog')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
              style={{
                border: '1px solid #EDF1EF', borderRadius: 18, padding: '16px 14px', display: 'flex', flexDirection: 'column',
                justifyContent: 'flex-end', gap: 12, minHeight: img ? 120 : undefined, cursor: 'pointer',
                background: img ? `linear-gradient(180deg, rgba(0,0,0,.05), rgba(0,0,0,.55)), url(${img}) center/cover no-repeat` : '#fff',
              }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(16,40,28,.1)')}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: img ? '#fff' : '#1A2A21', textShadow: img ? '0 1px 6px rgba(0,0,0,.5)' : 'none' }}>{c.name}</div>
                <div style={{ fontSize: 12, color: img ? 'rgba(255,255,255,.9)' : '#8A968E', marginTop: 2, textShadow: img ? '0 1px 6px rgba(0,0,0,.5)' : 'none' }}>{pluralTovar(counts[c.name] ?? 0)}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
