// Supabase Edge Function — приём платежей от Kaspi Bank
//
// Деплой:
//   supabase functions deploy kaspi-payment --no-verify-jwt
//   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//   --no-verify-jwt ОБЯЗАТЕЛЕН: Kaspi шлёт GET без JWT-токена.
//
// Kaspi указывает URL эндпоинта при регистрации сервиса.
//
// Защита эндпоинта (IP-allowlist Kaspi + shared secret) — см. ниже.
// KASPI_SECRET нужно задать вручную:
//   supabase secrets set KASPI_SECRET=<случайная_строка>
// и указать его же значение в query-параметре ?secret=... при регистрации
// сервиса в кабинете Kaspi (Postomat/Homebank).
//
// Встроенные секреты (не нужно добавлять вручную):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ─── Константы сервиса Kaspi ──────────────────────────────────────────────────
const KASPI_SERVICE_NAME = 'JibekJolyCo'
const KASPI_SERVICE_ID   = '11576'
const KASPI_PARAM_ID     = '16743'

// Официальные диапазоны IP Kaspi Bank, с которых приходят запросы check/pay
const KASPI_IP_RANGES = ['82.200.0.0/16', '185.5.250.0/24']

// ─── Типы ────────────────────────────────────────────────────────────────────

interface KaspiCheckResponse {
  txn_id: string
  result: number
  sum?: number
  comment: string
}

interface KaspiPayResponse {
  txn_id: string
  result: number
  prv_txn?: string
  sum?: number
  comment: string
}

interface OrderRow {
  id: string
  order_number: string | null
  total: number | null
  order_status: string | null
  is_paid: boolean
  task_type: string
}

// ─── Хелперы ─────────────────────────────────────────────────────────────────

const SUPABASE_URL             = Deno.env.get('SUPABASE_URL')              ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const KASPI_SECRET             = Deno.env.get('KASPI_SECRET')              ?? ''

function json(body: KaspiCheckResponse | KaspiPayResponse) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

// ── IP-allowlist ─────────────────────────────────────────────────────────────

function ipToInt(ip: string): number | null {
  const parts = ip.trim().split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet < 0 || octet > 255) return null
    n = (n << 8) | octet
  }
  return n >>> 0
}

function isIpInCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split('/')
  const bits    = Number(bitsStr)
  const ipInt   = ipToInt(ip)
  const rangeInt = ipToInt(range)
  if (ipInt === null || rangeInt === null || !Number.isInteger(bits)) return false
  if (bits <= 0) return true
  const mask = bits >= 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0
  return (ipInt & mask) === (rangeInt & mask)
}

function isKaspiIp(ip: string): boolean {
  if (!ip) return false
  return KASPI_IP_RANGES.some((cidr) => isIpInCidr(ip, cidr))
}

// Supabase Edge Runtime — реальный IP клиента приходит в x-forwarded-for
function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  return req.headers.get('x-real-ip') ?? ''
}

// ── Shared secret (constant-time сравнение) ──────────────────────────────────

function timingSafeEqualStr(a: string, b: string): boolean {
  const encA = new TextEncoder().encode(a)
  const encB = new TextEncoder().encode(b)
  if (encA.length !== encB.length) return false
  let diff = 0
  for (let i = 0; i < encA.length; i++) diff |= encA[i] ^ encB[i]
  return diff === 0
}

function isValidSecret(provided: string): boolean {
  if (!KASPI_SECRET || !provided) return false
  return timingSafeEqualStr(provided, KASPI_SECRET)
}

// Ссылка для QR-оплаты. Параметры TODO заполнить после получения от Kaspi.
export function buildKaspiPayUrl(orderNumber: string, amount: number): string {
  return `https://kaspi.kz/pay/${KASPI_SERVICE_NAME}?service_id=${KASPI_SERVICE_ID}&${KASPI_PARAM_ID}=${orderNumber}&amount=${amount}`
}

// ─── Основной обработчик ─────────────────────────────────────────────────────

serve(async (req: Request) => {
  // Kaspi шлёт только GET
  if (req.method !== 'GET') {
    return json({ txn_id: '', result: 1, comment: 'Method not allowed' })
  }

  const url     = new URL(req.url)
  const command = url.searchParams.get('command') ?? ''
  const txn_id  = url.searchParams.get('txn_id')  ?? ''
  const account = url.searchParams.get('account') ?? ''
  const sumStr  = url.searchParams.get('sum')      ?? ''
  const txnDate = url.searchParams.get('txn_date') ?? ''
  const secret  = url.searchParams.get('secret')   ?? ''

  const clientIp   = getClientIp(req)
  const authorized = isKaspiIp(clientIp) || isValidSecret(secret)

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  // ── Логируем каждый pay-запрос (включая заблокированные) ──────────────────
  if (command === 'pay') {
    try {
      await db.from('kaspi_payment_log').insert({
        ip:       clientIp || null,
        txn_id:   txn_id   || null,
        account:  account  || null,
        sum:      sumStr ? Number(sumStr) || null : null,
        allowed:  authorized,
      })
    } catch (err) {
      console.error('kaspi_payment_log insert failed:', err)
    }
  }

  // ── IP Kaspi или верный shared secret обязательны ──────────────────────────
  if (!authorized) {
    return new Response('Forbidden', { status: 403 })
  }

  // ── Поиск заказа по order_number ──────────────────────────────────────────
  async function findOrder(orderNumber: string): Promise<OrderRow | null> {
    const { data } = await db
      .from('crm_tasks')
      .select('id, order_number, total, order_status, is_paid, task_type')
      .eq('order_number', orderNumber)
      .eq('task_type', 'order')
      .maybeSingle()
    return data as OrderRow | null
  }

  // ══════════════════════════════════════════════════════════════════════════
  // command = check
  //   Kaspi проверяет, существует ли заказ и открыт ли он для оплаты.
  //   sum при check — фиктивное значение по протоколу, не проверяем.
  // ══════════════════════════════════════════════════════════════════════════
  if (command === 'check') {
    if (!account) {
      return json({ txn_id, result: 1, comment: 'account не указан' })
    }

    const order = await findOrder(account)

    if (!order) {
      return json({ txn_id, result: 1, comment: `Заказ ${account} не найден` })
    }

    if (order.order_status === 'cancelled') {
      return json({ txn_id, result: 2, comment: 'Заказ отменён' })
    }

    if (order.is_paid) {
      return json({ txn_id, result: 3, comment: 'Заказ уже оплачен' })
    }

    return json({
      txn_id,
      result:  0,
      sum:     Number(order.total ?? 0),
      comment: 'OK',
    })
  }

  // ══════════════════════════════════════════════════════════════════════════
  // command = pay
  //   Kaspi подтверждает платёж. Обязательна идемпотентность:
  //   если txn_id уже обработан — вернуть тот же ответ, не дублировать.
  // ══════════════════════════════════════════════════════════════════════════
  if (command === 'pay') {
    if (!txn_id || !account || !sumStr) {
      return json({ txn_id, result: 1, comment: 'Не хватает параметров: txn_id, account, sum' })
    }

    // ── Идемпотентность: проверяем, не обрабатывали ли этот txn_id раньше ──
    const { data: existingPayment } = await db
      .from('kaspi_payments')
      .select('id, prv_txn, sum, status')
      .eq('txn_id', txn_id)
      .maybeSingle()

    if (existingPayment) {
      // Возвращаем точно тот же результат, что и в первый раз
      return json({
        txn_id,
        result:  existingPayment.status === 'success' ? 0 : 5,
        prv_txn: existingPayment.prv_txn ?? existingPayment.id,
        sum:     Number(existingPayment.sum),
        comment: 'OK',
      })
    }

    // ── Находим заказ ─────────────────────────────────────────────────────
    const order = await findOrder(account)

    if (!order) {
      return json({ txn_id, result: 1, comment: `Заказ ${account} не найден` })
    }

    if (order.order_status === 'cancelled') {
      return json({ txn_id, result: 2, comment: 'Заказ отменён' })
    }

    if (order.is_paid) {
      return json({ txn_id, result: 3, comment: 'Заказ уже оплачен' })
    }

    // ── Проверяем сумму (частичная оплата запрещена) ───────────────────────
    const incomingSum = parseFloat(sumStr)
    const orderTotal  = Number(order.total ?? 0)

    if (isNaN(incomingSum) || Math.abs(incomingSum - orderTotal) > 0.01) {
      return json({
        txn_id,
        result:  5,
        comment: `Сумма не совпадает: ожидается ${orderTotal} ₸, получено ${incomingSum} ₸`,
      })
    }

    // ── Записываем платёж ─────────────────────────────────────────────────
    // UNIQUE (txn_id) защищает от гонки при параллельных запросах:
    // только один INSERT пройдёт, второй получит ошибку → обработаем ниже.
    const { data: payment, error: payErr } = await db
      .from('kaspi_payments')
      .insert({
        txn_id,
        order_id:     order.id,
        order_number: account,
        sum:          orderTotal,
        txn_date:     txnDate || null,
        status:       'success',
      })
      .select('id, prv_txn')
      .single()

    if (payErr || !payment) {
      // Если ошибка — unique constraint (параллельный запрос уже вставил) →
      // перечитываем и возвращаем существующий результат
      if (payErr?.code === '23505') {
        const { data: race } = await db
          .from('kaspi_payments')
          .select('id, prv_txn, sum')
          .eq('txn_id', txn_id)
          .single()
        if (race) {
          return json({
            txn_id,
            result:  0,
            prv_txn: race.prv_txn ?? race.id,
            sum:     Number(race.sum),
            comment: 'OK',
          })
        }
      }
      return json({ txn_id, result: 5, comment: 'Ошибка записи платежа' })
    }

    // ── Помечаем заказ оплаченным ──────────────────────────────────────────
    await db
      .from('crm_tasks')
      .update({ is_paid: true })
      .eq('id', order.id)
      .eq('is_paid', false)   // условие → UPDATE безопасен при параллельных запросах

    return json({
      txn_id,
      result:  0,
      prv_txn: payment.prv_txn ?? payment.id,
      sum:     orderTotal,
      comment: 'OK',
    })
  }

  // ── Неизвестная команда ───────────────────────────────────────────────────
  return json({ txn_id, result: 1, comment: `Неизвестная команда: ${command}` })
})
