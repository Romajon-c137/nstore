// Supabase Edge Function — массовая рассылка WhatsApp по сегменту/давности контакта.
// Вызывается из CRM (src/pages/crm/tabs/WhatsAppTab.tsx → вкладка "Рассылка").
//
// Деплой:
//   supabase functions deploy broadcast-whatsapp
//   (verify_jwt оставляем включённым по умолчанию — функция только для admin/manager)
//
// Секреты (Dashboard → Edge Functions → Secrets), общие с notify-order-whatsapp:
//   WA_PHONE_NUMBER_ID  — ID номера в Meta Business
//   WA_TOKEN            — постоянный токен Meta Cloud API (System User Token)
//
// Встроенные (Supabase подставляет автоматически):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// ВНИМАНИЕ: между сообщениями выдерживается пауза 1с (rate limiting), поэтому
// на большой сегмент (сотни контактов) выполнение может упереться в лимит
// времени выполнения Edge Function. Для очень больших рассылок стоит либо
// поднять лимит на плане Supabase, либо разбить сегмент на части.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')              ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const PHONE_NUMBER_ID           = Deno.env.get('WA_PHONE_NUMBER_ID')        ?? ''
const ACCESS_TOKEN              = Deno.env.get('WA_TOKEN')                  ?? ''

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? 'https://nstorecrm.kz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MAX_MESSAGE_LEN = 4096
const RATE_LIMIT_MS = 1000

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  })
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Meta Cloud API ожидает номер без "+" и без пробелов/дефисов.
function cleanPhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

interface BroadcastPayload {
  segment?: string | null
  message?: string
  filter_days?: number | null
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[broadcast-whatsapp] ✗ Supabase credentials not configured')
    return json({ error: 'Server misconfigured' }, 500)
  }

  // Проверяем JWT и получаем пользователя
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)

  const { data: { user }, error: authErr } = await createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { global: { headers: { Authorization: authHeader } } },
  ).auth.getUser()
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Только admin/manager могут запускать рассылки
  const { data: profile } = await db
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return json({ error: 'Forbidden' }, 403)
  }

  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    console.error('[broadcast-whatsapp] ✗ WhatsApp credentials not configured')
    return json({ error: 'WhatsApp credentials not configured' }, 503)
  }

  let payload: BroadcastPayload
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const message = (payload.message ?? '').trim()
  if (!message) return json({ error: 'message is required' }, 400)
  if (message.length > MAX_MESSAGE_LEN) return json({ error: `message too long (max ${MAX_MESSAGE_LEN})` }, 400)

  const segment = payload.segment?.trim() || null
  const filterDays = typeof payload.filter_days === 'number' && payload.filter_days > 0
    ? Math.floor(payload.filter_days)
    : null

  // Выборка контактов: сегмент компании + давность последнего контакта
  let contactsQuery = db
    .from('contacts')
    .select(segment ? 'id, phone, companies!inner(market_segment)' : 'id, phone')
    .not('phone', 'is', null)

  if (segment) contactsQuery = contactsQuery.eq('companies.market_segment', segment)
  if (filterDays !== null) {
    const cutoff = new Date(Date.now() - filterDays * 86400000).toISOString()
    contactsQuery = contactsQuery.or(`last_contacted_at.is.null,last_contacted_at.lt.${cutoff}`)
  }

  const { data: contactsRaw, error: contactsErr } = await contactsQuery
  if (contactsErr) {
    console.error('[broadcast-whatsapp] ✗ failed to load contacts:', contactsErr)
    return json({ error: 'Failed to load contacts' }, 500)
  }

  const recipients = (contactsRaw ?? [])
    .map((c: any) => ({ id: c.id as string, phone: cleanPhone(String(c.phone ?? '')) }))
    .filter(c => c.phone.length > 0)

  console.log(`[broadcast-whatsapp] segment=${segment ?? 'all'} filterDays=${filterDays ?? 'all'} recipients=${recipients.length}`)

  // Лог рассылки — создаём сразу, чтобы отследить даже частичный сбой
  const { data: broadcast, error: insertErr } = await db
    .from('wa_broadcasts')
    .insert({
      created_by: user.id,
      segment,
      filter_days: filterDays,
      message,
      recipients_count: recipients.length,
      sent_count: 0,
      failed_count: 0,
      status: 'running',
    })
    .select('id')
    .single()

  if (insertErr || !broadcast) {
    console.error('[broadcast-whatsapp] ✗ failed to create broadcast log:', insertErr)
    return json({ error: 'Failed to create broadcast record' }, 500)
  }

  let sentCount = 0
  let failedCount = 0

  for (let i = 0; i < recipients.length; i++) {
    const recipient = recipients[i]
    try {
      const metaRes = await fetch(
        `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: recipient.phone,
            type: 'text',
            text: { body: message },
          }),
        }
      )
      if (metaRes.ok) {
        sentCount++
      } else {
        failedCount++
        const errBody = await metaRes.json().catch(() => null)
        console.error(`[broadcast-whatsapp] ✗ send failed for ${recipient.phone}:`, JSON.stringify(errBody))
      }
    } catch (err) {
      failedCount++
      console.error(`[broadcast-whatsapp] ✗ network error for ${recipient.phone}:`, err)
    }

    if (i < recipients.length - 1) await sleep(RATE_LIMIT_MS)
  }

  const status = recipients.length > 0 && failedCount === recipients.length ? 'failed' : 'done'

  const { error: updateErr } = await db
    .from('wa_broadcasts')
    .update({ sent_count: sentCount, failed_count: failedCount, status })
    .eq('id', broadcast.id)
  if (updateErr) console.error('[broadcast-whatsapp] ✗ failed to update broadcast log:', updateErr)

  console.log(`[broadcast-whatsapp] ✓ done: sent=${sentCount} failed=${failedCount}`)

  return json({
    ok: true,
    broadcast_id: broadcast.id,
    recipients_count: recipients.length,
    sent_count: sentCount,
    failed_count: failedCount,
    status,
  })
})
