'use client'

import { MIN_ORDER_TOTAL,placeOrder } from '@/entities/order'
import { supabase } from '@/shared/lib/supabase'
import { Button } from '@/shared/ui/ui'
import { CartItem,Location,Product,Profile,buildWaMessage,fmtShort } from '@/views/cabinet/ui/shared'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { useEffect,useState } from 'react'

export default function CartDrawer({ cart, profile, onClose, onAdd, onRemove, onOrderSuccess }: {
  cart: CartItem[]; profile: Profile | null; onClose: () => void
  onAdd: (p: Product, price: number, step?: number) => void; onRemove: (id: string, step?: number) => void; onOrderSuccess: () => void
}) {
  const qc = useQueryClient()
  const total = cart.reduce((s, item) => s + item.unitPrice * item.qty, 0)
  const belowMin = total > 0 && total < MIN_ORDER_TOTAL
  const [success, setSuccess] = useState(false)
  const [selectedLocId, setSelectedLocId] = useState<string | null>(null)
  const [stockError, setStockError] = useState<Array<{ name: string; requested: number; available: number }> | null>(null)

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ['cart-locations', profile?.company_id],
    queryFn: async () => {
      if (!profile?.company_id) return []
      const { data } = await supabase.from('locations').select('id, name, address').eq('company_id', profile.company_id)
      return (data ?? []) as Location[]
    },
    enabled: !!profile?.company_id, staleTime: 60_000,
  })

  useEffect(() => {
    if (locations.length === 1 && !selectedLocId) setSelectedLocId(locations[0].id)
  }, [locations])

  const selectedLoc = locations.find(l => l.id === selectedLocId)

  const orderMut = useMutation({
    mutationFn: async () => {
      setStockError(null)
      const items = cart.map(item => ({ id: item.product.id, sku: item.product.sku, name: item.product.name, qty: item.qty, price: item.unitPrice, unit: 'шт' }))
      const res = await placeOrder({
        items, total,
        client: { id: profile?.id ?? null, name: profile?.name ?? profile?.company ?? null, phone: profile?.phone ?? null },
        locationId: selectedLocId ?? null,
        address: selectedLoc?.address ?? null,
      })
      if (!res.ok) { setStockError(res.shortage); throw new Error('INSUFFICIENT_STOCK') }
    },
    onSuccess: () => {
      setSuccess(true)
      qc.invalidateQueries({ queryKey: ['cabinet-orders'] })
      setTimeout(() => { setSuccess(false); onOrderSuccess(); onClose() }, 2000)
    },
    onError: () => {},
  })

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, backdropFilter: 'blur(2px)' }} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '100%', maxWidth: 440, background: '#fff', zIndex: 1001, display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 40px rgba(0,0,0,.15)' }}>
        <div style={{ padding: '20px 24px', paddingTop: 'calc(20px + env(safe-area-inset-top, 0px))', borderBottom: '1px solid #EDF1EF', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#1A2A21' }}>Заявка {cart.length > 0 && <span style={{ fontSize: 13, color: '#8A968E', fontWeight: 500 }}>· {cart.length} поз.</span>}</div>
          <button onClick={onClose} style={{ width: 34, height: 34, borderRadius: 10, border: '1.5px solid #EDF1EF', background: '#F9FAFB', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>
        {success && <div style={{ margin: 16, padding: '14px', borderRadius: 12, background: '#EAF6EE', color: 'var(--primary)', fontSize: 14, fontWeight: 700, textAlign: 'center' }}>✅ Заявка отправлена менеджеру!</div>}
        {stockError && (
          <div style={{ margin: '8px 16px', padding: '12px 14px', borderRadius: 12, background: '#FEF2F2', border: '1px solid #FECACA' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#DC2626', marginBottom: 6 }}>Недостаточно товара на складе:</div>
            {stockError.map((s, i) => (
              <div key={i} style={{ fontSize: 12, color: '#B91C1C', marginBottom: 2 }}>
                {s.name}: запрошено {s.requested} шт, доступно {s.available} шт
              </div>
            ))}
          </div>
        )}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cart.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8A968E', gap: 12 }}>
              <div style={{ fontSize: 44 }}>📋</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1A2A21' }}>Заявка пуста</div>
              <div style={{ fontSize: 13 }}>Добавьте товары из каталога</div>
            </div>
          ) : cart.map(item => {
            return (
            <div key={item.product.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '12px 14px', borderRadius: 12, border: '1px solid #EDF1EF', background: '#FAFBFA' }}>
              {item.product.image_url && <div style={{ width: 44, height: 44, borderRadius: 8, overflow: 'hidden', flexShrink: 0 }}><img src={item.product.image_url} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></div>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1A2A21', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.product.name}</div>
                {item.product.sku && <div style={{ fontSize: 11, color: '#B0BCB5' }}>Арт. {item.product.sku}</div>}
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)', marginTop: 3 }}>{fmtShort(item.unitPrice * item.qty)}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <button onClick={() => onRemove(item.product.id, 1)} style={{ width: 30, height: 30, borderRadius: 8, border: '1.5px solid #EDF1EF', background: '#fff', cursor: 'pointer', fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#DC2626' }}>−</button>
                <span style={{ fontSize: 14, fontWeight: 700, minWidth: 20, textAlign: 'center' }}>{item.qty}</span>
                <button onClick={() => onAdd(item.product, item.unitPrice, 1)} style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: 'var(--primary)', cursor: 'pointer', fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>+</button>
              </div>
            </div>
            )
          })}
        </div>
        {cart.length > 0 && (
          <div style={{ padding: '16px 20px', paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))', borderTop: '1px solid #EDF1EF' }}>
            {/* Location selector */}
            {locations.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#5C6B63', marginBottom: 8 }}>📍 Точка доставки</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {locations.map(loc => (
                    <button key={loc.id} onClick={() => setSelectedLocId(loc.id)}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${selectedLocId === loc.id ? 'var(--primary)' : '#EDF1EF'}`, background: selectedLocId === loc.id ? '#EAF6EE' : '#FAFBFA', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', transition: 'all .15s' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: selectedLocId === loc.id ? 'var(--primary)' : '#1A2A21' }}>{loc.name}</div>
                      {loc.address && <div style={{ fontSize: 11, color: '#8A968E', marginTop: 2 }}>{loc.address}</div>}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontSize: 14, color: '#5C6B63', fontWeight: 600 }}>Итого</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#1A2A21' }}>{fmtShort(total)}</span>
            </div>
            {belowMin && (
              <div style={{ marginBottom: 10, padding: '10px 12px', borderRadius: 10, background: '#FFF3E0', color: '#B45309', fontSize: 12.5, fontWeight: 600, textAlign: 'center' }}>
                Минимальная сумма заказа — {fmtShort(MIN_ORDER_TOTAL)}
              </div>
            )}
            <Button onClick={() => orderMut.mutate()} disabled={belowMin} loading={orderMut.isPending} full size="form" font="inherit"
              style={{ height: 50, borderRadius: 13, fontSize: 15, marginBottom: 10 }}>
              {orderMut.isPending ? 'Отправляем...' : '📋 Оформить заявку'}
            </Button>
            <a href={`https://wa.me/77005220006?text=${buildWaMessage(cart, profile)}`} target="_blank" rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '13px', borderRadius: 13, textDecoration: 'none', background: '#25D36615', color: '#25D366', fontWeight: 700, fontSize: 14, fontFamily: 'inherit', border: '1.5px solid #25D36630', boxSizing: 'border-box' }}>
              💬 Написать в WhatsApp
            </a>
          </div>
        )}
      </div>
    </>
  )
}
