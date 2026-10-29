'use client'

import { applyFilters,CATEGORIES,CATEGORY_NAME,EMPTY_FILTERS,fmtMoney,IconChevron,IconChevronRight,packageSize,pluralGoods,resolvePrice,Sheet,type CatalogGroup,type CategoryId,type Filters,type PricingContext } from '@/entities/catalog'
import { useMemo,useState,type ReactNode } from 'react'

function topValues(values: (string | null)[]) {
  const c = new Map<string, number>()
  for (const v of values) if (v) c.set(v, (c.get(v) ?? 0) + 1)
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v)
}

function toggle<T>(arr: T[], v: T) { return arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v] }

function summary(sel: string[], all: string) {
  if (!sel.length) return all
  return sel.length <= 2 ? sel.join(', ') : `${sel.slice(0, 2).join(', ')} +${sel.length - 2}`
}

/** Строка-аккордеон: заголовок + выбранное значение, по нажатию — варианты. */
function Row({ title, value, open, onToggle, children }: { title: string; value: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className={`sh-frow${open ? ' open' : ''}`}>
      <button className="sh-frow-head" onClick={onToggle} aria-expanded={open}>
        <span><b>{title}</b><span>{value}</span></span>
        {open ? <IconChevron size={20} /> : <IconChevronRight size={20} />}
      </button>
      {open && <div className="sh-frow-body">{children}</div>}
    </div>
  )
}

export function FiltersSheet({ scope, value, pricing, showCategory, onApply, onClose }: {
  scope: CatalogGroup[]; value: Filters; pricing: PricingContext; showCategory: boolean
  onApply: (f: Filters) => void; onClose: () => void
}) {
  const [f, setF] = useState<Filters>(value)
  const [open, setOpen] = useState<string | null>('price')

  const all = useMemo(() => scope.flatMap(g => g.variants), [scope])
  const brands = useMemo(() => topValues(all.map(p => p.brand)), [all])
  const packages = useMemo(() => topValues(all.map(packageSize)).slice(0, 16), [all])
  const cats = useMemo(() => new Set(all.map(p => p.category)), [all])
  const bounds = useMemo(() => {
    const prices = all.map(p => resolvePrice(p, pricing).unitPrice).filter((x): x is number => x != null)
    if (!prices.length) return { min: 0, max: 0 }
    const step = 100
    return { min: Math.floor(Math.min(...prices) / step) * step, max: Math.ceil(Math.max(...prices) / step) * step }
  }, [all, pricing])
  const count = useMemo(() => applyFilters(scope, f, pricing).length, [scope, f, pricing])

  const lo = f.priceMin ?? bounds.min
  const hi = f.priceMax ?? bounds.max
  const span = Math.max(1, bounds.max - bounds.min)
  const setLo = (v: number) => setF({ ...f, priceMin: v <= bounds.min ? null : Math.min(v, hi) })
  const setHi = (v: number) => setF({ ...f, priceMax: v >= bounds.max ? null : Math.max(v, lo) })
  const num = (s: string) => { const n = parseInt(s.replace(/\D/g, ''), 10); return Number.isFinite(n) ? n : null }
  const row = (id: string) => ({ open: open === id, onToggle: () => setOpen(open === id ? null : id) })

  return (
    <Sheet
      title="Фильтры"
      onClose={onClose}
      footer={
        <>
          <button className="sh-btn navy lg" onClick={() => { onApply(f); onClose() }} disabled={count === 0}>
            {count === 0 ? 'Ничего не найдено' : `Показать ${pluralGoods(count)}`}
          </button>
          <button className="sh-link" style={{ display: 'block', margin: '8px auto 0' }} onClick={() => setF(EMPTY_FILTERS)}>Сбросить</button>
        </>
      }
    >
      <div className="sh-sheet-body sh-fbody">
        {brands.length > 1 && (
          <Row title="Бренд" value={summary(f.brands, 'Все бренды')} {...row('brand')}>
            <div className="sh-fchips">
              {brands.map(b => (
                <button key={b} className={`sh-fchip${f.brands.includes(b) ? ' on' : ''}`} aria-pressed={f.brands.includes(b)} onClick={() => setF({ ...f, brands: toggle(f.brands, b) })}>{b}</button>
              ))}
            </div>
          </Row>
        )}

        {showCategory && cats.size > 1 && (
          <Row title="Категория" value={summary(f.categories.map(c => CATEGORY_NAME[c]), 'Все категории')} {...row('cat')}>
            <div className="sh-fchips">
              {CATEGORIES.filter(c => cats.has(c.id)).map(c => (
                <button key={c.id} className={`sh-fchip${f.categories.includes(c.id) ? ' on' : ''}`} aria-pressed={f.categories.includes(c.id)}
                  onClick={() => setF({ ...f, categories: toggle<CategoryId>(f.categories, c.id) })}>{c.name}</button>
              ))}
            </div>
          </Row>
        )}

        {packages.length > 1 && (
          <Row title="Фасовка" value={summary(f.packages, 'Выбрать')} {...row('pack')}>
            <div className="sh-fchips">
              {packages.map(s => (
                <button key={s} className={`sh-fchip${f.packages.includes(s) ? ' on' : ''}`} aria-pressed={f.packages.includes(s)} onClick={() => setF({ ...f, packages: toggle(f.packages, s) })}>{s}</button>
              ))}
            </div>
          </Row>
        )}

        {bounds.max > bounds.min && (
          <Row title="Цена" value={f.priceMin != null || f.priceMax != null ? `${fmtMoney(lo)} — ${fmtMoney(hi)}` : 'Любая'} {...row('price')}>
            <div className="sh-slider">
              <div className="sh-slider-fill" style={{ left: `${((lo - bounds.min) / span) * 100}%`, right: `${100 - ((hi - bounds.min) / span) * 100}%` }} />
              <input type="range" min={bounds.min} max={bounds.max} step={100} value={lo} onChange={e => setLo(+e.target.value)} aria-label="Цена от" />
              <input type="range" min={bounds.min} max={bounds.max} step={100} value={hi} onChange={e => setHi(+e.target.value)} aria-label="Цена до" />
            </div>
            <div className="sh-range">
              <label>от <input inputMode="numeric" value={lo} onChange={e => setLo(num(e.target.value) ?? bounds.min)} aria-label="Цена от, ₸" /> ₸</label>
              <label>до <input inputMode="numeric" value={hi} onChange={e => setHi(num(e.target.value) ?? bounds.max)} aria-label="Цена до, ₸" /> ₸</label>
            </div>
          </Row>
        )}

        <div className="sh-frow">
          <div className="sh-frow-head" style={{ cursor: 'default' }}>
            <span><b>Наличие</b></span>
          </div>
          <div className="sh-frow-body" style={{ paddingTop: 0 }}>
            <label className="sh-switch">
              Только в наличии
              <input type="checkbox" checked={f.inStockOnly} onChange={e => setF({ ...f, inStockOnly: e.target.checked })} />
            </label>
          </div>
        </div>
      </div>
    </Sheet>
  )
}
