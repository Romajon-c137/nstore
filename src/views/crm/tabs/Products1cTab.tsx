'use client'

import { useLanguage } from '@/shared/i18n/LanguageContext'
import { supabase } from '@/shared/lib/supabase'
import { Button } from '@/shared/ui/ui'
import { useCRM } from '@/views/crm/context/CRMContext'
import { Pagination,SearchInput,Segmented,useIsMobile } from '@/views/crm/shared/crmui'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { useCallback,useMemo,useState } from 'react'
import { createPortal } from 'react-dom'

/* ── Mobile hook ── */

// ─── Types ────────────────────────────────────────────────────────────────────

interface Product {
  id: string
  sku: string
  name: string
  section_name: string | null
  category: string | null
  description: string | null
  price: number | null
  price_tp: number | null
  price_top: number | null
  box_qty: number | null
  vol: string | null
  flavor: string | null
  is_active: boolean
  stock: number | null
  reserved_qty: number | null
  image_url: string | null
  /** Приоритет на сайте: 1 — первым на главной, /shop и /opt; null — по алфавиту после приоритетных */
  sort_priority: number | null
}

const PAGE_SIZE = 60

// Группы товаров — те же что на лендинге в чипах и CatGrid
//const PRODUCT_GROUPS = ['Молочное', 'Кофе и чай', 'Напитки', 'Соусы', 'Вода', 'Снеки']

// ─── Stock levels ───────────────────────────────────────────────────────────
// Назначение: наглядно видеть, что нужно заказывать.
//   < 48          → критично (заказать срочно)
//   48 … 95       → мало (заказать скоро)
//   ≥ 96          → достаточно

type StockLevel = 'red' | 'yellow' | 'green'

const STOCK_META: Record<StockLevel, { color: string; bg: string; label: string }> = {
  red:    { color: '#DC2626', bg: '#DC26261A', label: 'Критично'   },
  yellow: { color: '#F59E0B', bg: '#F59E0B1A', label: 'Мало'       },
  green:  { color: '#16A34A', bg: '#16A34A1A', label: 'На исходе'  },
}

function stockLevel(stock: number): StockLevel {
  if (stock < 48) return 'red'
  if (stock < 96) return 'yellow'
  return 'green'
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** «3» → 3; пусто, 0 или мусор → null (без приоритета) */
function parsePriority(v: string): number | null {
  const n = Math.round(Number(v.trim()))
  return v.trim() && Number.isFinite(n) && n > 0 ? n : null
}

function PriorityBadge({ n }: { n: number | null }) {
  if (n == null) return null
  return <span title="Приоритет на сайте" style={{ fontSize: 10, background: '#F59E0B22', color: '#B45309', borderRadius: 4, padding: '1px 5px', fontWeight: 800 }}>★ {n}</span>
}

function fmt(n: number | null) {
  if (!n && n !== 0) return '—'
  return n.toLocaleString('ru-RU') + ' ₸'
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────

function EditModal({
  product, onSave, onClose, saving,
}: {
  product: Product
  onSave: (updates: { price: number | null; price_tp: number | null; is_active: boolean; image_url: string | null; sort_priority: number | null }) => void
  onClose: () => void
  saving: boolean
}) {
  const { tr } = useLanguage()
  const [price, setPrice]           = useState(product.price?.toString() ?? '')
  const [priceTp, setPriceTp]       = useState(product.price_tp?.toString() ?? '')
  const [active, setActive]         = useState(product.is_active)
  const [imageUrl, setImageUrl]     = useState(product.image_url ?? '')
  const [priority, setPriority]     = useState(product.sort_priority?.toString() ?? '')
  //const [sectionName, setSectionName] = useState(product.section_name ?? '')
  const [descOpen, setDescOpen]     = useState(false)
  const [imgError, setImgError]     = useState(false)

  const inp: React.CSSProperties = {
    width: '100%', padding: '8px 11px', borderRadius: 9, border: '1.5px solid var(--bd)',
    background: 'var(--bg3)', color: 'var(--t)', fontSize: 14, outline: 'none', boxSizing: 'border-box',
  }

  const infoLabel: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: 'var(--t3)', marginBottom: 3, display: 'block', textTransform: 'uppercase', letterSpacing: '.4px',
  }

  const infoValue: React.CSSProperties = {
    fontSize: 13, fontWeight: 600, color: 'var(--t)',
  }

  const infoBox: React.CSSProperties = {
    padding: '10px 12px', borderRadius: 9, background: 'var(--bg3)', border: '1px solid var(--bd)',
  }

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: 'var(--bg2)', borderRadius: 16, width: '100%', maxWidth: 460, boxShadow: '0 24px 80px rgba(0,0,0,.3)', padding: 24, maxHeight: '90dvh', overflowY: 'auto' }}>
        <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>{product.name}</div>
        <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 20 }}>SKU: {product.sku}</div>

        {/* ── Read-only info ── */}
        <div style={{ marginBottom: 18, display: 'grid', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={infoBox}>
              <span style={infoLabel}>Категория</span>
              <span style={infoValue}>{product.category || '—'}</span>
            </div>
            <div style={infoBox}>
              <span style={infoLabel}>Остаток</span>
              <span style={{ ...infoValue, color: product.stock && product.stock > 0 ? 'var(--primary)' : 'var(--t3)' }}>
                {product.stock ?? '—'}
                {(product.reserved_qty ?? 0) > 0 && (
                  <span style={{ fontSize: 10, color: '#B45309', marginLeft: 4 }}>
                    ({product.reserved_qty} рез.)
                  </span>
                )}
              </span>
            </div>
          </div>
           <div style={infoBox}>
            <span style={infoLabel}>Группа товаров (из 1С)</span>
            <span style={infoValue}>{product.section_name || '—'}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}></div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={infoBox}>
              <span style={infoLabel}>Топ цена</span>
              <span style={infoValue}>{fmt(product.price_top)}</span>
            </div>
            <div style={infoBox}>
              <span style={infoLabel}>Упаковка (шт/кейс)</span>
              <span style={infoValue}>{product.box_qty ?? '—'}</span>
            </div>
          </div>

          {product.description && (
            <div style={{ ...infoBox, cursor: 'pointer' }} onClick={() => setDescOpen(v => !v)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                <span style={infoLabel}>Описание</span>
                <span style={{ fontSize: 10, color: 'var(--primary)' }}>{descOpen ? '▲ свернуть' : '▼ развернуть'}</span>
              </div>
              <span style={{
                ...infoValue, fontWeight: 400, fontSize: 13, lineHeight: 1.5,
                display: descOpen ? 'block' : '-webkit-box',
                overflow: 'hidden',
                WebkitLineClamp: descOpen ? undefined : 2,
                WebkitBoxOrient: 'vertical',
              } as React.CSSProperties}>
                {product.description}
              </span>
            </div>
          )}
        </div>

        {/* ── Divider ── */}
        <div style={{ borderTop: '1px solid var(--bd)', marginBottom: 16 }} />

        {/* ── Editable fields ── */}
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)', marginBottom: 4, display: 'block' }}>{tr('kaspiRetailPrice')}</label>
              <input style={inp} type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="0" />
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)', marginBottom: 4, display: 'block' }}>{tr('kaspiTpPrice')}</label>
              <input style={inp} type="number" value={priceTp} onChange={e => setPriceTp(e.target.value)} placeholder="0" />
            </div>
          </div>

          {/* ── Приоритет на сайте ── */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)', marginBottom: 4, display: 'block' }}>Приоритет на сайте</label>
            <input style={inp} type="number" min={1} step={1} value={priority} onChange={e => setPriority(e.target.value)} placeholder="пусто — обычный порядок" />
            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--t3)' }}>1 — показывать первым на главной, в каталоге /shop и в оптовом прайсе /opt. Пусто — по алфавиту после приоритетных.</div>
          </div>

          {/* ── Image URL ── */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)', marginBottom: 4, display: 'block' }}>Фото товара (ссылка)</label>
            <input
              style={inp}
              type="url"
              value={imageUrl}
              onChange={e => { setImageUrl(e.target.value); setImgError(false) }}
              placeholder="https://example.com/photo.jpg"
            />
            {imageUrl && !imgError && (
              <div style={{ marginTop: 8, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--bd)', height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg3)' }}>
                <img
                  src={imageUrl}
                  alt="preview"
                  onError={() => setImgError(true)}
                  style={{ maxHeight: 120, maxWidth: '100%', objectFit: 'contain' }}
                />
              </div>
            )}
            {imgError && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#DC2626' }}>Не удалось загрузить изображение — проверьте ссылку</div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, background: 'var(--bg3)' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t)', flex: 1 }}>{tr('kaspiActive2')}</span>
            <button
              onClick={() => setActive(v => !v)}
              style={{
                width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                background: active ? 'var(--primary)' : 'var(--bd)',
                position: 'relative', transition: 'background .2s',
              }}
            >
              <span style={{
                position: 'absolute', top: 3, left: active ? 22 : 3,
                width: 18, height: 18, borderRadius: 9, background: '#fff',
                transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.3)',
              }} />
            </button>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
            <Button variant="secondary" size="sm" onClick={onClose} style={{ borderRadius: 9, paddingLeft: 18, paddingRight: 18 }}>
              {tr('cancel')}
            </Button>
            <Button
              size="sm"
              loading={saving}
              onClick={() => onSave({
                price: price ? parseFloat(price) : null,
                price_tp: priceTp ? parseFloat(priceTp) : null,
                is_active: active,
                image_url: imageUrl.trim() || null,
                sort_priority: parsePriority(priority),
              })}
              style={{ borderRadius: 9, paddingLeft: 20, paddingRight: 20 }}
            >
              {saving ? tr('loading') : tr('save')}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ─── Stock Dashboard (Список на заказ) ────────────────────────────────────────

function StockView({ category, search, onPick, isMobile }: {
  category: string
  search: string
  onPick: (p: Product) => void
  isMobile: boolean
}) {
  const [stockFilter, setStockFilter] = useState<'all' | StockLevel>('all')
  const [openCats, setOpenCats] = useState<Set<string>>(new Set())

  const { data: stockProducts = [], isLoading } = useQuery<Product[]>({
    queryKey: ['products-stock'],
    queryFn: async () => {
      // Только заканчивающиеся: остаток < 200. Всё остальное не показываем.
      const all: Product[] = []
      const step = 1000
      let from = 0
      for (;;) {
        const { data, error } = await supabase
          .from('products')
          .select('id, sku, name, section_name, category, description, price, price_tp, price_top, box_qty, vol, flavor, is_active, stock, reserved_qty, image_url, sort_priority')
          .eq('is_active', true)
          .not('stock', 'is', null)
          .lt('stock', 200)
          .order('category')
          .range(from, from + step - 1)
        if (error) throw error
        const chunk = (data ?? []) as Product[]
        all.push(...chunk)
        if (chunk.length < step) break
        from += step
      }
      return all
    },
    staleTime: 60_000,
  })

  // Группы по категориям (без stockFilter — он применяется при рендере)
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = stockProducts
    if (q) list = list.filter(p => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
    if (category) list = list.filter(p => p.category === category)

    const map = new Map<string, Product[]>()
    for (const p of list) {
      const cat = p.category || 'Без категории'
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(p)
    }

    const result = [...map.entries()].map(([cat, items]) => {
      const counts = { red: 0, yellow: 0, green: 0 }
      for (const p of items) counts[stockLevel(p.stock ?? 0)]++
      const sorted = [...items].sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0))
      return { cat, items: sorted, counts, total: items.length }
    })
    // Самые горящие категории сверху
    result.sort((a, b) => b.counts.red - a.counts.red || b.counts.yellow - a.counts.yellow || a.cat.localeCompare(b.cat))
    return result
  }, [stockProducts, search, category])

  const totals = useMemo(() => {
    const t = { red: 0, yellow: 0, green: 0 }
    for (const g of groups) { t.red += g.counts.red; t.yellow += g.counts.yellow; t.green += g.counts.green }
    return t
  }, [groups])

  const toggleCat = (cat: string) => setOpenCats(prev => {
    const next = new Set(prev); next.has(cat) ? next.delete(cat) : next.add(cat); return next
  })

  if (isLoading) {
    return (
      <div style={{ padding: '20px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,minmax(0,1fr))' : 'repeat(4,minmax(0,1fr))', gap: isMobile ? 8 : 12, marginBottom: 8 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ height: 100, borderRadius: 14, background: 'var(--bg2)', animation: 'pulse 1.4s ease-in-out infinite', animationDelay: `${i * .08}s` }} />
          ))}
        </div>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} style={{ height: 54, borderRadius: 10, background: 'var(--bg2)', animation: 'pulse 1.4s ease-in-out infinite', animationDelay: `${i * .06}s` }} />
        ))}
      </div>
    )
  }

  const totalAll = totals.red + totals.yellow + totals.green

  const KPI_CARDS = [
    { key: 'all',    label: 'Нужно заказать', value: totalAll,       sub: 'позиций с остатком < 200',              color: 'var(--primary)', borderColor: 'var(--primary)', bg: 'var(--primary)' },
    { key: 'red',    label: 'Срочно',         value: totals.red,     sub: 'остаток < 48 · заказать сегодня',       color: '#DC2626',        borderColor: '#DC2626',        bg: '#DC2626' },
    { key: 'yellow', label: 'Скоро',          value: totals.yellow,  sub: 'остаток 48–95 · заказать на этой неделе', color: '#F59E0B',       borderColor: '#F59E0B',        bg: '#F59E0B' },
    { key: 'green',  label: 'На исходе',      value: totals.green,   sub: 'остаток 96–199 · следить',              color: '#16A34A',        borderColor: '#16A34A',        bg: '#16A34A' },
  ] as const

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '12px 12px 28px' : '16px 20px 28px' }}>

      {/* ── KPI Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,minmax(0,1fr))' : 'repeat(4,minmax(0,1fr))', gap: isMobile ? 8 : 12, marginBottom: isMobile ? 14 : 20 }}>
        {KPI_CARDS.map(card => {
          const active = stockFilter === card.key
          return (
            <div
              key={card.key}
              onClick={() => setStockFilter(prev => prev === card.key ? 'all' : card.key as 'all' | StockLevel)}
              style={{
                padding: isMobile ? '12px 14px' : '18px 20px 16px', borderRadius: 16, cursor: 'pointer',
                background: active ? card.bg : 'var(--bg2)',
                border: `1.5px solid ${active ? card.borderColor : card.key === 'all' ? 'var(--bd)' : card.color + '44'}`,
                boxShadow: active ? `0 4px 20px ${card.color}33` : 'none',
                transition: 'all .18s', position: 'relative', overflow: 'hidden',
              }}
            >
              {/* background accent stripe */}
              {!active && card.key !== 'all' && (
                <div style={{ position: 'absolute', top: 0, left: 0, width: 4, height: '100%', background: card.color, borderRadius: '16px 0 0 16px' }} />
              )}
              <div style={{ fontSize: isMobile ? 10 : 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: active ? 'rgba(255,255,255,.75)' : 'var(--t3)', marginBottom: isMobile ? 4 : 8, paddingLeft: card.key !== 'all' && !active ? 8 : 0 }}>
                {card.label}
              </div>
              <div style={{ fontSize: isMobile ? 28 : 36, fontWeight: 900, lineHeight: 1, color: active ? '#fff' : card.color, marginBottom: isMobile ? 4 : 8, paddingLeft: card.key !== 'all' && !active ? 8 : 0 }}>
                {card.value}
              </div>
              <div style={{ fontSize: isMobile ? 10 : 11, lineHeight: 1.4, color: active ? 'rgba(255,255,255,.65)' : 'var(--t3)', paddingLeft: card.key !== 'all' && !active ? 8 : 0 }}>
                {card.sub}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Category breakdown table ── */}
      {totalAll === 0 ? (
        <div style={{ paddingTop: 60, textAlign: 'center', color: 'var(--t3)', fontSize: 15 }}>
          Список на заказ пуст — все товары в норме
        </div>
      ) : (
        <>
          {/* Table head — desktop only */}
          {!isMobile && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px 72px 72px 72px', gap: 8, padding: '0 14px 8px', fontSize: 10, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
              <span>Категория</span>
              <span>Срочность</span>
              <span style={{ textAlign: 'center', color: '#DC2626' }}>Срочно</span>
              <span style={{ textAlign: 'center', color: '#F59E0B' }}>Скоро</span>
              <span style={{ textAlign: 'center', color: '#16A34A' }}>Исходе</span>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {groups.map(g => {
              const visible = stockFilter === 'all' ? g.items : g.items.filter(p => stockLevel(p.stock ?? 0) === stockFilter)
              if (visible.length === 0) return null

              const isOpen = openCats.has(g.cat)
              const urgency: StockLevel = g.counts.red > 0 ? 'red' : g.counts.yellow > 0 ? 'yellow' : 'green'
              const redPct    = (g.counts.red    / g.total) * 100
              const yellowPct = (g.counts.yellow / g.total) * 100
              const greenPct  = (g.counts.green  / g.total) * 100

              const urgencyBar = (
                <div style={{ height: 10, borderRadius: 5, overflow: 'hidden', background: 'var(--bg3)', display: 'flex' }}>
                  {redPct    > 0 && <div style={{ width: `${redPct}%`,    background: '#DC2626' }} />}
                  {yellowPct > 0 && <div style={{ width: `${yellowPct}%`, background: '#F59E0B' }} />}
                  {greenPct  > 0 && <div style={{ width: `${greenPct}%`,  background: '#16A34A' }} />}
                </div>
              )

              return (
                <div
                  key={g.cat}
                  style={{ borderRadius: 12, border: `1.5px solid ${isOpen ? STOCK_META[urgency].color + '88' : 'var(--bd)'}`, overflow: 'hidden', background: 'var(--bg2)', transition: 'border-color .15s' }}
                >
                  {/* Row — mobile */}
                  {isMobile ? (
                    <div onClick={() => toggleCat(g.cat)} style={{ padding: '12px 12px', cursor: 'pointer', userSelect: 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 12, color: STOCK_META[urgency].color, flexShrink: 0, fontWeight: 800 }}>{isOpen ? '▾' : '▸'}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.cat}</div>
                          <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 1 }}>{g.total} поз.</div>
                        </div>
                        <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                          {(['red', 'yellow', 'green'] as StockLevel[]).map(lvl => g.counts[lvl] > 0 && (
                            <span key={lvl} style={{ fontSize: 12, fontWeight: 900, color: STOCK_META[lvl].color, padding: '2px 8px', borderRadius: 7, background: STOCK_META[lvl].bg }}>
                              {g.counts[lvl]}
                            </span>
                          ))}
                        </div>
                      </div>
                      {urgencyBar}
                    </div>
                  ) : (
                  /* Row — desktop */
                  <div
                    onClick={() => toggleCat(g.cat)}
                    style={{ display: 'grid', gridTemplateColumns: '1fr 180px 72px 72px 72px', gap: 8, padding: '14px 14px', cursor: 'pointer', alignItems: 'center', userSelect: 'none' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {/* Name */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{ fontSize: 12, color: STOCK_META[urgency].color, flexShrink: 0, fontWeight: 800 }}>{isOpen ? '▾' : '▸'}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.cat}</div>
                        <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 1 }}>{g.total} поз.</div>
                      </div>
                    </div>

                    {/* Urgency bar */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {urgencyBar}
                      {g.counts.red > 0 && (
                        <div style={{ fontSize: 10, color: '#DC2626', fontWeight: 700 }}>
                          {Math.round(redPct)}% срочно
                        </div>
                      )}
                    </div>

                    {/* Count badges */}
                    {(['red', 'yellow', 'green'] as StockLevel[]).map(lvl => (
                      <div key={lvl} style={{ textAlign: 'center' }}>
                        {g.counts[lvl] > 0 ? (
                          <span style={{ fontSize: 14, fontWeight: 900, color: STOCK_META[lvl].color, padding: '3px 10px', borderRadius: 8, background: STOCK_META[lvl].bg, display: 'inline-block' }}>
                            {g.counts[lvl]}
                          </span>
                        ) : (
                          <span style={{ fontSize: 13, color: 'var(--t3)', opacity: .4 }}>—</span>
                        )}
                      </div>
                    ))}
                  </div>
                  )}

                  {/* Expanded product list */}
                  {isOpen && (
                    <div style={{ borderTop: `1px solid var(--bd)` }}>
                      {visible.map(p => {
                        const lvl  = stockLevel(p.stock ?? 0)
                        const meta = STOCK_META[lvl]
                        return (
                          <div
                            key={p.id}
                            onClick={() => onPick(p)}
                            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderTop: '1px solid var(--bd)', cursor: 'pointer', borderLeft: `4px solid ${meta.color}` }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          >
                            <span style={{ flex: 1, fontSize: 13, color: 'var(--t)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: 6 }}>
                              {p.name}
                            </span>
                            <span style={{ fontSize: 13, fontWeight: 900, padding: '3px 12px', borderRadius: 8, background: meta.bg, color: meta.color, flexShrink: 0 }}>
                              {p.stock ?? 0}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

export default function Products1cTab() {
  const qc = useQueryClient()
  const { toast, can } = useCRM()
  const isReadonly = can('products1c') === 'view'
  const { tr } = useLanguage()
  const isMobile = useIsMobile()

  const [view, setView]                 = useState<'products' | 'stock'>('products')
  const [search, setSearch]             = useState('')
  const [debouncedSearch, setDebounced] = useState('')
  const [category, setCategory]         = useState('')
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive' | 'priority'>('active')
  const [page, setPage]                 = useState(0)
  const [editing, setEditing]           = useState<Product | null>(null)
  const [saving, setSaving]             = useState(false)

  const handleSearch = useCallback((val: string) => {
    setSearch(val)
    clearTimeout((handleSearch as any)._t)
    ;(handleSearch as any)._t = setTimeout(() => { setDebounced(val); setPage(0) }, 350)
  }, [])

  const { data: categories = [] } = useQuery<string[]>({
    queryKey: ['product-categories'],
    queryFn: async () => {
      // Постранично — товаров > 1000, иначе категории обрезаются лимитом Supabase
      const set = new Set<string>()
      const step = 1000
      let from = 0
      for (;;) {
        const { data, error } = await supabase
          .from('products').select('category').not('category', 'is', null)
          .range(from, from + step - 1)
        if (error) throw error
        const chunk = data ?? []
        chunk.forEach(d => { const c = (d as any).category as string; if (c) set.add(c) })
        if (chunk.length < step) break
        from += step
      }
      return [...set].sort()
    },
    staleTime: 300_000,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['products', debouncedSearch, category, activeFilter, page],
    queryFn: async () => {
      let q = supabase
        .from('products')
        .select('id, sku, name, section_name, category, description, price, price_tp, price_top, box_qty, vol, flavor, is_active, stock, reserved_qty, image_url, sort_priority', { count: 'exact' })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      // «Приоритетные» — в порядке показа на сайте, остальные фильтры — по категории и имени
      q = activeFilter === 'priority'
        ? q.not('sort_priority', 'is', null).order('sort_priority').order('name')
        : q.order('category').order('name')

      if (debouncedSearch) {
        q = q.or(`name.ilike.%${debouncedSearch}%,sku.ilike.%${debouncedSearch}%`)
      }
      if (category) q = q.eq('category', category)
      if (activeFilter === 'active')   q = q.eq('is_active', true)
      if (activeFilter === 'inactive') q = q.eq('is_active', false)

      const { data, error, count } = await q
      if (error) throw error
      return { products: (data ?? []) as Product[], total: count ?? 0 }
    },
    staleTime: 30_000,
    placeholderData: prev => prev,
    enabled: view === 'products',
  })

  const products = data?.products ?? []
  const total    = data?.total ?? 0
  const pages    = Math.ceil(total / PAGE_SIZE)

  const toggleMut = useMutation({
    mutationFn: async ({ id, val }: { id: string; val: boolean }) => {
      const { error } = await supabase.from('products').update({ is_active: val }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
    onError: (e: any) => toast(e.message),
  })

  const updateMut = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      setSaving(true)
      const { error } = await supabase.from('products').update(updates).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['products-stock'] })
      setEditing(null)
      setSaving(false)
      toast(tr('kaspiProductUpdated'))
    },
    onError: (e: any) => { setSaving(false); toast(e.message) },
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, overflowX: 'hidden', background: 'var(--bg)' }}>

      {/* Top bar */}
      <div style={{ padding: isMobile ? '12px 14px 10px' : '14px 20px 10px', background: 'var(--bg2)', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>

        {/* View toggle */}
        <div style={{ marginBottom: 12 }}>
          <Segmented
            value={view}
            onChange={setView}
            full={isMobile}
            options={[{ value: 'products', label: 'Товары' }, { value: 'stock', label: 'Остатки' }]}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: isMobile ? 'nowrap' : 'wrap', marginBottom: view === 'products' ? 10 : 0 }}>

          <SearchInput
            value={search}
            onChange={handleSearch}
            grow maxWidth={99999}
            placeholder={view === 'products' ? (isMobile ? 'Поиск...' : `Поиск по ${total} товарам...`) : 'Поиск по названию или SKU...'}
          />

          <select
            value={category}
            onChange={e => { setCategory(e.target.value); setPage(0) }}
            style={{ padding: '7px 11px', borderRadius: 10, border: '1.5px solid var(--bd)', background: 'var(--bg3)', color: 'var(--t)', fontSize: 13, cursor: 'pointer', flexShrink: 0, maxWidth: isMobile ? 140 : 220 }}
          >
            <option value="">{tr('kaspiAllCats')}</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Active filter — products view only */}
        {view === 'products' && (
          <Segmented
            value={activeFilter}
            onChange={f => { setActiveFilter(f); setPage(0) }}
            options={[
              { value: 'all', label: tr('all') },
              { value: 'active', label: tr('kaspiActive') },
              { value: 'inactive', label: tr('kaspiInactive') },
              { value: 'priority', label: '★ Приоритет' },
            ]}
          />
        )}
      </div>

      {/* ── STOCK VIEW ── */}
      {view === 'stock' ? (
        <StockView
          category={category}
          search={debouncedSearch}
          onPick={p => setEditing(p)}
          isMobile={isMobile}
        />
      ) : (
        <>
          {/* Table / Cards */}
          <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '10px 12px 16px' : '0 20px 16px' }}>
            {isLoading && !data ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 14 }}>
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} style={{ height: isMobile ? 76 : 46, borderRadius: 8, background: 'var(--bg2)', animation: 'pulse 1.4s ease-in-out infinite', animationDelay: `${i * .06}s` }} />
                ))}
              </div>
            ) : products.length === 0 ? (
              <div style={{ paddingTop: 60, textAlign: 'center', color: 'var(--t3)', fontSize: 14 }}>Ничего не найдено</div>
            ) : isMobile ? (
              /* ── Mobile card layout ── */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {products.map(p => (
                  <div
                    key={p.id}
                    onClick={() => setEditing(p)}
                    style={{
                      display: 'flex', gap: 12, padding: 12, borderRadius: 12,
                      background: 'var(--bg2)', alignItems: 'flex-start',
                      opacity: p.is_active ? 1 : .5, cursor: isReadonly ? 'default' : 'pointer',
                    }}
                  >
                    {/* Photo */}
                    <div style={{ width: 52, height: 52, borderRadius: 10, overflow: 'hidden', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {p.image_url && (
                        <img src={p.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                      )}
                    </div>

                    {/* Body */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: 'var(--t)', fontWeight: 700, fontSize: 14, lineHeight: 1.3, marginBottom: 3 }}>{p.name}</div>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                        <PriorityBadge n={p.sort_priority} />
                        {p.section_name && <span style={{ fontSize: 10, background: 'var(--primary)22', color: 'var(--primary)', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>{p.section_name}</span>}
                        {p.category && <span style={{ fontSize: 10, color: 'var(--t3)' }}>{p.category}</span>}
                      </div>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 800, color: 'var(--t)', fontSize: 15 }}>{fmt(p.price)}</span>
                        <span style={{ color: 'var(--t2)', fontSize: 12 }}>ТП: {fmt(p.price_tp)}</span>
                        <span style={{ color: p.stock && p.stock > 0 ? 'var(--primary)' : 'var(--t3)', fontWeight: 700, fontSize: 12 }}>
                          Ост: {p.stock ?? '—'}
                          {(p.reserved_qty ?? 0) > 0 && <span style={{ color: '#B45309', fontWeight: 600 }}> / {p.reserved_qty} рез.</span>}
                        </span>
                      </div>
                    </div>

                    {/* Toggle */}
                    <div onClick={e => { e.stopPropagation(); if (!isReadonly) toggleMut.mutate({ id: p.id, val: !p.is_active }) }} style={{ flexShrink: 0, paddingTop: 2 }}>
                      <div style={{
                        width: 40, height: 22, borderRadius: 11, cursor: isReadonly ? 'not-allowed' : 'pointer',
                        background: p.is_active ? 'var(--primary)' : 'var(--bd)',
                        position: 'relative', transition: 'background .2s', opacity: isReadonly ? .5 : 1,
                      }}>
                        <span style={{
                          position: 'absolute', top: 2, left: p.is_active ? 20 : 2,
                          width: 18, height: 18, borderRadius: 9, background: '#fff',
                          transition: 'left .2s',
                        }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                {/* Header */}
                <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 130px 120px 80px 52px', gap: 8, padding: '12px 10px 8px', fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.5px' }}>
                  <span>Фото</span>
                  <span>Название</span>
                  <span>Цена</span>
                  <span>Цена ТП</span>
                  <span>Остаток</span>
                  <span>Акт.</span>
                </div>

                {products.map(p => (
                  <div
                    key={p.id}
                    style={{
                      display: 'grid', gridTemplateColumns: '40px 1fr 130px 120px 80px 52px',
                      gap: 8, padding: '10px 10px', borderRadius: 8,
                      background: 'var(--bg2)', marginBottom: 3,
                      alignItems: 'center', fontSize: 13,
                      opacity: p.is_active ? 1 : .5,
                      cursor: isReadonly ? 'default' : 'pointer',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg2)')}
                    onClick={() => { if (!isReadonly) setEditing(p) }}
                  >
                    {/* Photo thumbnail */}
                    <div style={{ width: 32, height: 32, borderRadius: 6, overflow: 'hidden', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {p.image_url && (
                        <img src={p.image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                      )}
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: 'var(--t)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
                        <PriorityBadge n={p.sort_priority} />
                        {p.section_name && <span style={{ fontSize: 10, background: 'var(--primary)22', color: 'var(--primary)', borderRadius: 4, padding: '1px 5px', fontWeight: 700 }}>{p.section_name}</span>}
                        {p.category && <span style={{ fontSize: 10, color: 'var(--t3)' }}>{p.category}</span>}
                      </div>
                    </div>
                    <span style={{ fontWeight: 700, color: 'var(--t)' }}>{fmt(p.price)}</span>
                    <span style={{ color: 'var(--t2)' }}>{fmt(p.price_tp)}</span>
                    <span style={{ color: p.stock && p.stock > 0 ? 'var(--primary)' : 'var(--t3)', fontWeight: 600 }}>
                      {p.stock ?? '—'}
                      {(p.reserved_qty ?? 0) > 0 && <span style={{ color: '#B45309' }}> /{p.reserved_qty}р</span>}
                    </span>

                    {/* Toggle */}
                    <div onClick={e => { e.stopPropagation(); if (!isReadonly) toggleMut.mutate({ id: p.id, val: !p.is_active }) }}>
                      <div style={{
                        width: 36, height: 20, borderRadius: 10, border: 'none', cursor: isReadonly ? 'not-allowed' : 'pointer',
                        background: p.is_active ? 'var(--primary)' : 'var(--bd)',
                        position: 'relative', transition: 'background .2s', opacity: isReadonly ? .5 : 1,
                      }}>
                        <span style={{
                          position: 'absolute', top: 2, left: p.is_active ? 18 : 2,
                          width: 16, height: 16, borderRadius: 8, background: '#fff',
                          transition: 'left .2s',
                        }} />
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Pagination */}
          {pages > 1 && (
            <Pagination page={page} pages={pages} total={total} onChange={setPage} />
          )}
        </>
      )}

      {editing && (
        <EditModal
          product={editing}
          saving={saving}
          onSave={updates => updateMut.mutate({ id: editing.id, updates })}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
