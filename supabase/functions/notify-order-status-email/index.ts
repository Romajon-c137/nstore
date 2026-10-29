// Supabase Edge Function — email клиенту при изменении статуса заказа.
//
// Деплой: Supabase Dashboard → Edge Functions → New Function → "notify-order-status-email"
//
// Секреты (Dashboard → Edge Functions → Secrets):
//   RESEND_API_KEY      — API-ключ на resend.com (бесплатно: 3 000 писем/месяц)
//   EMAIL_FROM          — адрес отправителя, напр. "Nstore <orders@nstore.kz>"
//                         (домен должен быть верифицирован в Resend)
//
// Встроенные Supabase-секреты (добавляются автоматически, дополнительно не нужны):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── Конфиг ──────────────────────────────────────────────────────────────────

const RESEND_API_KEY           = Deno.env.get('RESEND_API_KEY')           ?? ''
const EMAIL_FROM               = Deno.env.get('EMAIL_FROM')               ?? 'Nstore <orders@nstore.kz>'
const SUPABASE_URL             = Deno.env.get('SUPABASE_URL')             ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// ─── Статусы (совпадают с ORDER_COLS в src/data/orders.ts) ──────────────────

const STATUS_LABELS: Record<string, { label: string; bg: string; fg: string }> = {
  new:        { label: 'Новый',        bg: '#FFF3E0', fg: '#F57C00' },
  confirmed:  { label: 'Подтверждён', bg: '#E3F2FD', fg: '#1565C0' },
  picking:    { label: 'Собирается',  bg: '#F3E5F5', fg: '#6A1B9A' },
  delivering: { label: 'В доставке',  bg: '#E0F7FA', fg: '#00695C' },
  review:     { label: 'Доставлено',  bg: '#ECFEFF', fg: '#0E7490' },
  done:       { label: 'Выполнен',    bg: '#E8F5E9', fg: '#2E7D32' },
  cancelled:  { label: 'Отменён',     bg: '#FFEBEE', fg: '#C62828' },
}

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? 'https://nstorecrm.kz',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ─── Типы ────────────────────────────────────────────────────────────────────

interface CrmTask {
  id: string
  title: string | null
  task_type: string
  order_status: string | null
  client_id: string | null
  client_name: string | null
  client_phone: string | null
  total: number | null
}

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  record: CrmTask
  old_record?: CrmTask
}

// ─── HTML-шаблон письма ──────────────────────────────────────────────────────

function buildEmailHtml(params: {
  clientName: string
  orderId: string
  statusLabel: string
  statusBg: string
  statusFg: string
  total: number | null
}): string {
  const { clientName, orderId, statusLabel, statusBg, statusFg, total } = params
  const fmtMoney = (n: number) => n.toLocaleString('ru-RU') + ' ₸'

  return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F4F6F4;font-family:'Helvetica Neue',Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0"
             style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)">

        <!-- Header -->
        <tr>
          <td style="background:#10A35B;padding:24px 32px">
            <span style="font-family:'Helvetica Neue',Arial,sans-serif;font-weight:800;
                         font-size:22px;color:#fff;letter-spacing:-.5px">nstore</span>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:32px 32px 24px">
            <p style="margin:0 0 8px;font-size:15px;color:#374151">
              Здравствуйте, <strong>${clientName}</strong>!
            </p>
            <p style="margin:0 0 24px;font-size:15px;color:#374151">
              Статус вашего заказа <strong>№${orderId}</strong> обновился:
            </p>

            <!-- Status badge -->
            <div style="display:inline-block;background:${statusBg};color:${statusFg};
                        padding:12px 24px;border-radius:10px;font-size:18px;
                        font-weight:700;margin-bottom:24px">
              ${statusLabel}
            </div>

            ${total != null && total > 0 ? `
            <p style="margin:0 0 8px;font-size:14px;color:#6B7280">
              Сумма заказа: <strong style="color:#111827">${fmtMoney(total)}</strong>
            </p>` : ''}

            <p style="margin:24px 0 0;font-size:14px;color:#6B7280;line-height:1.6">
              Если у вас есть вопросы — напишите нам на
              <a href="mailto:support@nstore.kz" style="color:#10A35B">support@nstore.kz</a>
              или позвоните по номеру на сайте.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#F9FAFB;padding:16px 32px;border-top:1px solid #E5E7EB">
            <p style="margin:0;font-size:12px;color:#9CA3AF">
              © Nstore · <a href="https://nstore.kz" style="color:#9CA3AF">nstore.kz</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// ─── Основной обработчик ─────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS })
  }

  if (!RESEND_API_KEY) {
    console.error('notify-order-status-email: RESEND_API_KEY not set')
    return new Response(
      JSON.stringify({ error: 'RESEND_API_KEY not configured' }),
      { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }

  let payload: WebhookPayload
  try {
    payload = await req.json()
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }

  const { type, table, record, old_record } = payload

  // Пропускаем не-UPDATE и не-заказы
  if (type !== 'UPDATE' || table !== 'crm_tasks' || record.task_type !== 'order') {
    return new Response(JSON.stringify({ ok: true, skipped: true }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  // Пропускаем, если статус не изменился
  if (record.order_status === old_record?.order_status) {
    return new Response(JSON.stringify({ ok: true, skipped: 'status_unchanged' }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  // Пропускаем, если нет client_id (анонимные заказы без профиля)
  if (!record.client_id) {
    console.log('notify-order-status-email: no client_id, skipping email')
    return new Response(JSON.stringify({ ok: true, skipped: 'no_client_id' }),
      { headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  // Получаем email клиента из auth.users (надёжнее, чем profiles)
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: userData, error: userErr } = await supabase.auth.admin.getUserById(record.client_id)

  if (userErr || !userData?.user?.email) {
    console.error('notify-order-status-email: cannot get client email', userErr?.message)
    return new Response(
      JSON.stringify({ error: 'Client email not found' }),
      { status: 404, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }

  const clientEmail = userData.user.email
  const clientName  = record.client_name ?? 'Клиент'
  const orderStatus = record.order_status ?? 'new'
  const statusMeta  = STATUS_LABELS[orderStatus] ?? { label: orderStatus, bg: '#F3F4F6', fg: '#374151' }
  const orderId     = record.id.slice(0, 8).toUpperCase()

  const html = buildEmailHtml({
    clientName,
    orderId,
    statusLabel: statusMeta.label,
    statusBg:    statusMeta.bg,
    statusFg:    statusMeta.fg,
    total:       record.total,
  })

  // Отправляем через Resend
  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    EMAIL_FROM,
      to:      [clientEmail],
      subject: `Nstore: заказ №${orderId} — ${statusMeta.label}`,
      html,
    }),
  })

  const resendData = await resendRes.json()

  if (!resendRes.ok) {
    console.error('notify-order-status-email: Resend error', resendData)
    return new Response(
      JSON.stringify({ error: resendData }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } },
    )
  }

  console.log(`notify-order-status-email: sent to ${clientEmail}, id=${resendData.id}, status=${orderStatus}`)
  return new Response(
    JSON.stringify({ ok: true, email_id: resendData.id }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } },
  )
})
