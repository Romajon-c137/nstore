/* Оформление заявки клиента — общий путь для кабинета и каталога /shop.
   RPC place_order резервирует остатки и возвращает номер заказа;
   уведомление менеджеру в WhatsApp — fire-and-forget. */

import { supabase } from '@/shared/lib/supabase';

/** Минимальная сумма заказа для клиентов B2B. */
export const MIN_ORDER_TOTAL = 30_000

export interface OrderItem { id: string; sku: string | null; name: string; qty: number; price: number; unit: string }

export interface PlaceOrderArgs {
  items: OrderItem[]
  total: number
  client: { id: string | null; name: string | null; phone: string | null; email?: string | null; companyId?: string | null }
  locationId: string | null
  address: string | null
}

export interface StockShortage { name: string; requested: number; available: number }

export type PlaceOrderResult =
  | { ok: true; orderNumber: string | null }
  | { ok: false; shortage: StockShortage[] }

export async function placeOrder(a: PlaceOrderArgs): Promise<PlaceOrderResult> {
  const { data: orderNumber, error } = await supabase.rpc('place_order', {
    p_items:        a.items,
    p_client_id:    a.client.id,
    p_client_name:  a.client.name,
    p_client_phone: a.client.phone,
    p_location_id:  a.locationId,
    p_address:      a.address,
    p_total:        a.total,
  })

  if (error) {
    if (error.message?.includes('INSUFFICIENT_STOCK:')) {
      try { return { ok: false, shortage: JSON.parse(error.message.split('INSUFFICIENT_STOCK:')[1]) } }
      catch { return { ok: false, shortage: [{ name: 'Некоторые товары', requested: 0, available: 0 }] } }
    }
    throw error
  }

  supabase.functions.invoke('notify-order-whatsapp', {
    body: { client_name: a.client.name ?? 'Клиент', total: a.total, items: a.items, order_number: (orderNumber as string) ?? 'N/A' },
  }).catch(err => console.error('[placeOrder] notify-order-whatsapp error:', err))

  return { ok: true, orderNumber: (orderNumber as string) ?? null }
}
