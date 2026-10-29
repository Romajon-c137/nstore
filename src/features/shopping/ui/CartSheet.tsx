'use client'

import { fmtMoney,IconTrash,pluralGoods,ProductImage,Sheet,Stepper } from '@/entities/catalog'
import { type StockShortage } from '@/entities/order'
import { getSource,type Customer } from '@/features/shopping/api/source'
import type { Cart } from '@/features/shopping/model/hooks'
import { Link } from '@/shared/lib/navigation'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { useEffect,useState } from 'react'

const WA_NUMBER = '77005220006'

export function CartSheet({ cart, customer, onClose, onBrowse }: {
  cart: Cart; customer: Customer | null; onClose: () => void; onBrowse: () => void
}) {
  const qc = useQueryClient()
  const isClient = !!customer?.isClient
  const [locId, setLocId] = useState<string | null>(null)
  const [shortage, setShortage] = useState<StockShortage[] | null>(null)
  const [done, setDone] = useState<{ number: string | null } | null>(null)

  const { data: locations = [] } = useQuery({
    queryKey: ['shop-locations', customer?.id],
    queryFn: async () => (await getSource()).locations(customer!),
    enabled: isClient, staleTime: 60_000,
  })
  const { data: minimumOrderTotal = null } = useQuery({
    queryKey: ['shop-minimum-order-total'],
    queryFn: async () => (await getSource()).minimumOrderTotal,
    staleTime: Infinity,
  })
  useEffect(() => { if (locations.length === 1 && !locId) setLocId(locations[0].id) }, [locations, locId])

  const belowMin = isClient && minimumOrderTotal != null && minimumOrderTotal > 0 && cart.total < minimumOrderTotal
  const needLoc = isClient && locations.length > 1 && !locId

  const order = useMutation({
    mutationFn: async () => {
      setShortage(null)
      const loc = locations.find(l => l.id === locId)
      return (await getSource()).placeOrder({
        items: cart.lines.map(l => ({ id: l.product.id, sku: l.product.sku || null, name: l.product.name, qty: l.qty, price: l.unitPrice, unit: l.product.unit })),
        total: cart.total,
        client: { id: customer!.id, name: customer!.name ?? customer!.company, phone: customer!.phone, email: customer!.email, companyId: customer!.companyId },
        locationId: loc?.id ?? null,
        address: loc?.address ?? null,
      })
    },
    onSuccess: res => {
      if (!res.ok) { setShortage(res.shortage); return }
      setDone({ number: res.orderNumber })
      cart.clear()
      qc.invalidateQueries({ queryKey: ['shop-orders'] })
      qc.invalidateQueries({ queryKey: ['cabinet-orders'] })
    },
  })

  if (done) {
    return (
      <Sheet title="Заказ принят" onClose={onClose}>
        <div className="sh-sheet-body">
          <div className="sh-empty">
            <div style={{ width: 64, height: 64, borderRadius: 20, background: 'var(--sh-primary-l)', color: 'var(--sh-primary)', display: 'grid', placeItems: 'center', margin: '0 auto' }}>
              <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5 10 17l9-10" /></svg>
            </div>
            <div className="big">{done.number ? `Заказ № ${done.number}` : 'Заказ отправлен'}</div>
            <div>Менеджер подтвердит заказ и время доставки.</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link href="/cabinet?tab=orders" className="sh-btn ghost" style={{ textDecoration: 'none', width: 'auto', padding: '0 20px', marginTop: 16 }}>Мои заказы</Link>
              <button className="sh-btn primary" onClick={onClose}>Продолжить</button>
            </div>
          </div>
        </div>
      </Sheet>
    )
  }

  const waText = encodeURIComponent(
    `Здравствуйте! Хочу заказать:\n\n${cart.lines.map((l, i) => `${i + 1}. ${l.product.name}${l.product.sku ? ` (арт. ${l.product.sku})` : ''} — ${l.qty} ${l.product.unit} × ${fmtMoney(l.unitPrice)}`).join('\n')}\n\nИтого: ${fmtMoney(cart.total)}`,
  )

  const footer = cart.count > 0 && (
    <>
      {isClient && locations.length > 1 && (
        <div className="sh-locs" role="radiogroup" aria-label="Куда доставить">
          {locations.map(l => (
            <button key={l.id} role="radio" aria-checked={locId === l.id} className={`sh-loc${locId === l.id ? ' on' : ''}`} onClick={() => setLocId(l.id)}>
              <b>{l.name}</b>{l.address && <span>{l.address}</span>}
            </button>
          ))}
        </div>
      )}
      {belowMin && (
        <div className="sh-note warn">
          До минимального заказа {fmtMoney(minimumOrderTotal! - cart.total)}
          <div className="sh-progress"><i style={{ width: `${Math.min(100, (cart.total / minimumOrderTotal!) * 100)}%` }} /></div>
        </div>
      )}
      {shortage && (
        <div className="sh-note err">
          Не хватает на складе: {shortage.map(s => `${s.name} (доступно ${s.available})`).join(', ')}
        </div>
      )}
      {order.isError && <div className="sh-note err">Не удалось отправить заказ. Попробуйте ещё раз.</div>}
      <div className="sh-total"><span className="l">Итого</span><span className="r">{fmtMoney(cart.total)}</span></div>
      {isClient ? (
        <button className="sh-btn primary lg" disabled={belowMin || needLoc || order.isPending} onClick={() => order.mutate()}>
          {order.isPending ? 'Отправляем…' : needLoc ? 'Выберите точку доставки' : 'Оформить заказ'}
        </button>
      ) : (
        <>
          <a className="sh-btn lg sh-wa" href={`https://wa.me/${WA_NUMBER}?text=${waText}`} target="_blank" rel="noopener noreferrer">Заказать через WhatsApp</a>
          <Link href="/login" className="sh-btn ghost" style={{ textDecoration: 'none', marginTop: 8 }}>Войти — оптовые цены и заказ онлайн</Link>
        </>
      )}
    </>
  )

  return (
    <Sheet
      title="Корзина"
      subtitle={cart.count > 0 ? pluralGoods(cart.count) : undefined}
      label="Корзина"
      onClose={onClose}
      footer={footer}
      actions={cart.count > 0 && (
        <button className="sh-icon-btn" onClick={() => { if (confirm('Очистить корзину?')) cart.clear() }} aria-label="Очистить корзину"><IconTrash size={20} /></button>
      )}
    >
      <div className="sh-sheet-body">
        {cart.count === 0 ? (
          <div className="sh-empty">
            <div className="big">Корзина пуста</div>
            <div>Добавьте товары из каталога</div>
            <button className="sh-btn primary" onClick={onBrowse}>Перейти в каталог</button>
          </div>
        ) : (
          <div className="sh-lines">
            {cart.lines.map(l => (
              <div key={l.product.id} className="sh-line">
                <div className="sh-line-img"><ProductImage product={l.product} /></div>
                <div className="sh-line-mid">
                  <div className="sh-line-name">{l.product.name}</div>
                  {l.product.package && <div className="sh-line-sub">{l.product.package}</div>}
                  <div className="sh-line-sum">{fmtMoney(l.sum)}</div>
                  <div className="sh-line-ctrl">
                    <Stepper size="sm" tone="light" qty={l.qty} onInc={() => cart.inc(l.product)} onDec={() => cart.dec(l.product)} />
                    <button className="sh-icon-btn" onClick={() => cart.setQty(l.product, 0)} aria-label={`Удалить: ${l.product.name}`}><IconTrash size={18} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  )
}
