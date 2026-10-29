'use client'

import { supabase } from '@/shared/lib/supabase'
import { CartItem,Contract,Discount,fmtShort,Product,Profile,sectionColor } from '@/views/cabinet/ui/shared'
import { useQuery } from '@tanstack/react-query'
import { useRef,useState } from 'react'

export default function CatalogTab({ profile, cart, onAdd, onRemove, isMobile }: {
  profile: Profile | null; cart: CartItem[]
  onAdd: (p: Product, price: number, step?: number) => void; onRemove: (id: string, step?: number) => void
  isMobile?: boolean
}) {
  const [search, setSearch] = useState('')
  const [dSearch, setDSearch] = useState('')
  const [section, setSection] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  function handleSearch(val: string) { setSearch(val); clearTimeout(searchTimer.current); searchTimer.current = setTimeout(() => setDSearch(val), 380) }

  const { data: discounts = [] } = useQuery<Discount[]>({ queryKey: ['client-discounts', profile?.id], queryFn: async () => { if (!profile?.id) return []; const { data } = await supabase.from('discounts').select('*').eq('user_id', profile.id); return data ?? [] }, enabled: !!profile?.id, staleTime: 60_000 })
  const { data: contract } = useQuery<Contract | null>({ queryKey: ['client-contract', profile?.id], queryFn: async () => { if (!profile?.id) return null; const { data } = await supabase.from('contracts').select('price_list, discount_pct').eq('user_id', profile.id).maybeSingle(); return data as Contract | null }, enabled: !!profile?.id, staleTime: 120_000 })
  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ['cabinet-products', dSearch, section],
    queryFn: async () => {
      let q = supabase.from('products').select('id, sku, name, section_name, price, price_tp, price_top, box_qty, vol, is_active, stock, reserved_qty, image_url').eq('is_active', true).order('section_name').order('name').limit(200)
      if (dSearch) q = q.or(`name.ilike.%${dSearch}%,sku.ilike.%${dSearch}%`)
      if (section) q = q.eq('section_name', section)
      const { data, error } = await q; if (error) throw error; return (data ?? []) as Product[]
    }, staleTime: 60_000,
  })
  const { data: allProducts = [] } = useQuery<Product[]>({ queryKey: ['cabinet-products-all'], queryFn: async () => { const { data } = await supabase.from('products').select('section_name').eq('is_active', true); return (data ?? []) as Product[] }, staleTime: 300_000 })

  const sections = [...new Set(allProducts.map(p => p.section_name).filter(Boolean))] as string[]
  const sectionCounts = sections.reduce((acc, s) => { acc[s] = allProducts.filter(p => p.section_name === s).length; return acc }, {} as Record<string, number>)

  function getPrice(p: Product): number | null {
    if (contract?.price_list === 'price_top' && p.price_top) return p.price_top
    // Розница (офис, сайт) по умолчанию; оптовый прайс ТП — только если он указан в договоре
    const base = contract?.price_list === 'price_tp' ? (p.price_tp ?? p.price) : p.price; if (!base) return null
    if (contract?.discount_pct) return Math.round(base * (1 - contract.discount_pct / 100))
    const disc = discounts.find(d => d.section_id === p.section_name); if (disc) return Math.round(base * (1 - disc.discount / 100))
    return base
  }
  function getCartQty(id: string) { return cart.find(item => item.product.id === id)?.qty ?? 0 }
  function getStep(p: Product) { return (p.box_qty && p.box_qty > 0) ? p.box_qty : 1 }
  const isSpecial = contract?.price_list === 'price_top'

  // Порядок карточек: раздел → сначала «в наличии», затем «под заказ» → по имени.
  // «В наличии» — глобально первыми; «под заказ» (доступный остаток ≤ 0) — в самый конец.
  const avail = (p: Product) => (p.stock ?? 0) - (p.reserved_qty ?? 0)
  const sortedProducts = [...products].sort((a, b) => {
    const ia = avail(a) > 0 ? 0 : 1, ib = avail(b) > 0 ? 0 : 1
    if (ia !== ib) return ia - ib
    const sa = a.section_name ?? '', sb = b.section_name ?? ''
    if (sa !== sb) return sa < sb ? -1 : 1
    return (a.name ?? '') < (b.name ?? '') ? -1 : 1
  })

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: '#F6F8F7' }}>
      {!isMobile && (
        <aside style={{ width: 220, flexShrink: 0, background: '#fff', borderRight: '1px solid #EDF1EF', display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          <div style={{ padding: '20px 14px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#8A968E', textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: 12, paddingLeft: 4 }}>Разделы</div>
            <button onClick={() => setSection('')} style={{ width: '100%', textAlign: 'left', padding: '9px 12px', borderRadius: 10, border: 'none', background: !section ? '#10A35B12' : 'transparent', color: !section ? 'var(--primary)' : '#0E1E16', fontWeight: !section ? 700 : 500, fontSize: 13, cursor: 'pointer', marginBottom: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: 'inherit' }}>
              <span>Все товары</span><span style={{ fontSize: 11, color: !section ? 'var(--primary)' : '#B0BCB5', fontWeight: 600 }}>{allProducts.length}</span>
            </button>
            {sections.map(s => (
              <button key={s} onClick={() => setSection(s)} style={{ width: '100%', textAlign: 'left', padding: '8px 12px', borderRadius: 10, border: 'none', background: section === s ? '#10A35B12' : 'transparent', color: section === s ? 'var(--primary)' : '#5C6B63', fontWeight: section === s ? 700 : 400, fontSize: 13, cursor: 'pointer', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'inherit', lineHeight: 1.35 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: sectionColor(s, sections), flexShrink: 0, border: '1px solid rgba(0,0,0,.06)' }} />
                <span style={{ flex: 1 }}>{s}</span>
                <span style={{ fontSize: 11, color: section === s ? 'var(--primary)' : '#C0C8C2', fontWeight: 600, flexShrink: 0 }}>{sectionCounts[s] ?? 0}</span>
              </button>
            ))}
          </div>
        </aside>
      )}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <div style={{ padding: '14px 20px', background: '#fff', borderBottom: '1px solid #EDF1EF', flexShrink: 0 }}>
          {isSpecial && <div style={{ marginBottom: 10, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 8, background: '#F4EEFE', fontSize: 11, fontWeight: 700, color: '#7C3AED' }}>⭐ Специальные цены</div>}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {isMobile && (
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, flex: '0 0 auto', maxWidth: '45%' }}>
                <button onClick={() => setSection('')} style={{ padding: '6px 12px', borderRadius: 20, border: 'none', background: !section ? 'var(--primary)' : '#F2F5F3', color: !section ? '#fff' : '#5C6B63', cursor: 'pointer', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>Все</button>
                {sections.slice(0, 4).map(s => <button key={s} onClick={() => setSection(s)} style={{ padding: '6px 12px', borderRadius: 20, border: 'none', background: section === s ? 'var(--primary)' : '#F2F5F3', color: section === s ? '#fff' : '#5C6B63', cursor: 'pointer', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>{s}</button>)}
              </div>
            )}
            <div style={{ flex: 1, position: 'relative' }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: '#8A968E' }}>🔍</span>
              <input value={search} onChange={e => handleSearch(e.target.value)} placeholder={`Поиск по ${allProducts.length} товарам...`} style={{ width: '100%', padding: '9px 14px 9px 36px', borderRadius: 10, border: '1.5px solid #EDF1EF', background: '#F9FAFB', fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
            </div>
          </div>
          {section && (
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: sectionColor(section, sections), border: '1px solid rgba(0,0,0,.06)' }} />
              <span style={{ fontSize: 12, color: '#5C6B63', fontWeight: 600 }}>{section}</span>
              <button onClick={() => setSection('')} style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Все разделы ×</button>
            </div>
          )}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>
          {isLoading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14 }}>
              {Array.from({ length: 8 }).map((_, i) => <div key={i} style={{ height: 240, borderRadius: 16, background: '#F2F5F3', animation: 'pulse 1.4s ease-in-out infinite' }} />)}
            </div>
          ) : products.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#8A968E', fontSize: 14, paddingTop: 60 }}><div style={{ fontSize: 36, marginBottom: 10 }}>🔍</div>Ничего не найдено</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14 }}>
              {sortedProducts.map(p => {
                const price = getPrice(p); const qty = getCartQty(p.id); const step = getStep(p); const inStock = ((p.stock ?? 0) - (p.reserved_qty ?? 0)) > 0
                return (
                  <div key={p.id} style={{ background: '#fff', borderRadius: 16, border: '1px solid #EDF1EF', overflow: 'hidden', display: 'flex', flexDirection: 'column', opacity: inStock ? 1 : 0.75, transition: 'box-shadow .15s' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(0,0,0,.07)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.boxShadow = 'none'}>
                    <div style={{ height: 108, background: '#fff', borderBottom: '1px solid #F1F4F2', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                      {p.image_url ? <img src={p.image_url} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 8, boxSizing: 'border-box' }} /> : <span style={{ fontSize: 30, opacity: .45 }}>🧴</span>}
                      {!inStock && <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(255,140,0,.92)', color: '#fff', fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 6, letterSpacing: '.3px' }}>ПОД ЗАКАЗ</div>}
                      {qty > 0 && <div style={{ position: 'absolute', top: 8, left: 8, background: 'var(--primary)', color: '#fff', fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 6 }}>{qty} шт</div>}
                    </div>
                    <div style={{ padding: '12px 13px 14px', display: 'flex', flexDirection: 'column', flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0E1E16', lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', minHeight: 35, marginBottom: 5 }}>{p.name}</div>
                      <div style={{ fontSize: 10, color: '#A6B0A9', marginBottom: 4 }}>{p.sku && `#${p.sku}`}{p.vol ? ` · ${p.vol}` : ''}</div>
                      {step > 1 && <div style={{ fontSize: 10, color: 'var(--primary)', fontWeight: 700, marginBottom: 6 }}>Упаковка: {step} шт</div>}
                      <div style={{ marginTop: 'auto', marginBottom: 10 }}>
                        <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--primary)', lineHeight: 1 }}>{price ? fmtShort(price) : '—'}</div>
                        <div style={{ fontSize: 10, color: '#A6B0A9', marginTop: 2 }}>{isSpecial ? '⭐ топ цена / ед.' : 'оптовая цена / ед.'}</div>
                        {price && step > 1 && <div style={{ fontSize: 10, color: '#5C6B63', marginTop: 3, fontWeight: 600 }}>{fmtShort(price * step)} / упак.</div>}
                      </div>
                      {qty === 0 ? (
                        <button onClick={() => price && onAdd(p, price, step)} disabled={!price} style={{ width: '100%', padding: '9px 0', borderRadius: 10, border: 'none', background: price ? 'var(--primary)' : '#EDF1EF', color: price ? '#fff' : '#B0BCB5', fontWeight: 700, fontSize: 13, cursor: price ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>В заявку</button>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button onClick={() => onRemove(p.id, 1)} style={{ width: 32, height: 32, borderRadius: 8, border: '1.5px solid #EDF1EF', background: '#fff', cursor: 'pointer', fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#DC2626', flexShrink: 0 }}>−</button>
                          <span style={{ flex: 1, textAlign: 'center', fontSize: 14, fontWeight: 800, color: '#0E1E16' }}>{qty}</span>
                          <button onClick={() => price && onAdd(p, price, 1)} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: 'var(--primary)', cursor: 'pointer', fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>+</button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
