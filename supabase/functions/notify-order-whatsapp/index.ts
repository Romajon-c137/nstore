// Supabase Edge Function — уведомление менеджеру в WhatsApp при новом заказе.
//
// Деплой через Supabase Dashboard → Edge Functions → New Function → "notify-order-whatsapp"
//
// Секреты (Dashboard → Edge Functions → Secrets):
//   WA_PHONE_NUMBER_ID  — ID номера в Meta Business (Настройки → API Setup → Phone number ID)
//   WA_TOKEN            — постоянный токен Meta Cloud API (System User Token)
//   MANAGER_PHONE       — номер менеджера без + (по умолчанию 77005220006)

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const PHONE_NUMBER_ID = Deno.env.get('WA_PHONE_NUMBER_ID') ?? ''
const ACCESS_TOKEN    = Deno.env.get('WA_TOKEN')           ?? ''
const MANAGER_PHONE   = Deno.env.get('MANAGER_PHONE')      ?? '77005220006'

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? 'https://nstorecrm.kz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS })
  }

  console.log('[notify-order-whatsapp] invoked, method:', req.method)

  // Проверка конфигурации
  const phoneIdMasked = PHONE_NUMBER_ID
    ? `${PHONE_NUMBER_ID.slice(0, 5)}... (len=${PHONE_NUMBER_ID.length})`
    : '(not set)'
  const tokenMasked = ACCESS_TOKEN
    ? `${ACCESS_TOKEN.slice(0, 5)}... (len=${ACCESS_TOKEN.length})`
    : '(not set)'
  console.log('[notify-order-whatsapp] WA_PHONE_NUMBER_ID:', phoneIdMasked)
  console.log('[notify-order-whatsapp] WA_TOKEN:', tokenMasked)
  console.log('[notify-order-whatsapp] MANAGER_PHONE:', MANAGER_PHONE)

  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    console.error('[notify-order-whatsapp] ✗ credentials not set, aborting')
    return new Response(
      JSON.stringify({ error: 'WhatsApp credentials not configured' }),
      { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }

  let payload: { client_name?: string; total?: number; order_number?: string }
  try {
    payload = await req.json()
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }

  console.log('[notify-order-whatsapp] payload:', JSON.stringify(payload))

  const { client_name = 'Клиент', total = 0, order_number = 'N/A' } = payload

  // Форматирование суммы
  const fmtSum = (n: number) => n.toLocaleString('ru-RU') + ' ₸'

  // Вызов Meta Cloud API v20 — template message
  // Шаблон: jaspers_market_order_confirmation_v1, язык: en_US
  //   {{1}} = имя клиента
  //   {{2}} = сумма заказа
  //   {{3}} = номер заказа (ORDER-XXXX)
  const metaBody = {
    messaging_product: 'whatsapp',
    to: MANAGER_PHONE,
    type: 'template',
    template: {
      name: 'jaspers_market_order_confirmation_v1',
      language: { code: 'en_US' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: client_name },
            { type: 'text', text: fmtSum(total) },
            { type: 'text', text: order_number },
          ],
        },
      ],
    },
  }
  console.log('[notify-order-whatsapp] → Meta API body:', JSON.stringify(metaBody))

  let metaRes: Response
  try {
    metaRes = await fetch(
      `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metaBody),
      }
    )
  } catch (err) {
    console.error('[notify-order-whatsapp] ✗ network error reaching Meta API:', err)
    return new Response(
      JSON.stringify({ error: 'Meta API unreachable' }),
      { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }

  const metaData = await metaRes.json()
  console.log('[notify-order-whatsapp] ← Meta API response (status', metaRes.status, '):', JSON.stringify(metaData))

  if (!metaRes.ok) {
    console.error('[notify-order-whatsapp] ✗ Meta API returned error')
    return new Response(
      JSON.stringify({ error: metaData }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } }
    )
  }

  console.log('[notify-order-whatsapp] ✓ sent, message_id:', metaData?.messages?.[0]?.id)
  return new Response(
    JSON.stringify({ ok: true, message_id: metaData?.messages?.[0]?.id }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } }
  )
})
