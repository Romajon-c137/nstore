'use client'

import { buildWaMessage,fmt,WA_NUMBER,type CartItem,type DbProduct } from '@/entities/content'

export default function CartDrawer({ cart, onClose, onAdd, onRemove }: {
  cart: CartItem[]
  onClose: () => void
  onAdd: (product: DbProduct) => void
  onRemove: (productId: string) => void
}) {
  const total = cart.reduce((s, item) => s + (item.product.price ?? 0) * item.qty, 0)

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1000, backdropFilter: 'blur(2px)' }} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '100%', maxWidth: 420, background: '#fff', zIndex: 1001, display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 40px rgba(0,0,0,.15)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #EDF1EF', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>
            Корзина {cart.length > 0 && <span style={{ fontSize: 14, color: '#8A968E' }}>· {cart.length} поз.</span>}
          </div>
          <button onClick={onClose} style={{ width: 36, height: 36, borderRadius: 10, border: '1.5px solid #EDF1EF', background: '#F9FAFB', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {cart.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8A968E', gap: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Корзина пуста</div>
              <div style={{ fontSize: 13, textAlign: 'center' }}>Добавьте товары из каталога</div>
            </div>
          ) : (
            cart.map(item => (
              <div key={item.product.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px', borderRadius: 14, border: '1px solid #EDF1EF', background: '#FAFBFA' }}>
                {/* Mini image */}
                <div style={{ width: 44, height: 44, borderRadius: 10, overflow: 'hidden', background: '#F2F5F3', flexShrink: 0 }}>
                  {item.product.image_url && (
                    <img src={item.product.image_url} alt="" loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1A2A21', lineHeight: 1.3, marginBottom: 2 }}>{item.product.name}</div>
                  {item.product.sku && <div style={{ fontSize: 11, color: '#B0BCB5' }}>Арт. {item.product.sku}</div>}
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)', marginTop: 4 }}>{fmt((item.product.price ?? 0) * item.qty)}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <button onClick={() => onRemove(item.product.id)} style={{ width: 32, height: 32, borderRadius: 9, border: '1.5px solid #EDF1EF', background: '#fff', cursor: 'pointer', fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#DC2626' }}>−</button>
                  <span style={{ fontSize: 15, fontWeight: 700, minWidth: 20, textAlign: 'center' }}>{item.qty}</span>
                  <button onClick={() => onAdd(item.product)} style={{ width: 32, height: 32, borderRadius: 9, border: 'none', background: 'var(--primary)', cursor: 'pointer', fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>+</button>
                </div>
              </div>
            ))
          )}
        </div>

        {cart.length > 0 && (
          <div style={{ padding: '16px 24px 24px', borderTop: '1px solid #EDF1EF' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <span style={{ fontSize: 15, color: '#5C6B63', fontWeight: 600 }}>Итого</span>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20 }}>{fmt(total)}</span>
            </div>
            <a
              href={`https://wa.me/${WA_NUMBER}?text=${buildWaMessage(cart)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', padding: '15px 0', borderRadius: 14, textDecoration: 'none', background: '#25D366', color: '#fff', fontWeight: 700, fontSize: 16, fontFamily: 'inherit', boxSizing: 'border-box' }}
            >
              Заказать через WhatsApp
            </a>
            <div style={{ textAlign: 'center', fontSize: 12, color: '#8A968E', marginTop: 10 }}>
              Менеджер свяжется с вами для подтверждения
            </div>
          </div>
        )}
      </div>
    </>
  )
}
