// supabase/functions/get-company-balance/index.ts
//
// Возвращает баланс/задолженность B2B-клиента из 1С.
// Вызывается из кабинета клиента (с JWT).
//
// Деплой:
//   supabase functions deploy get-company-balance
//   (verify_jwt оставляем включённым — функция вызывается только аутентиф. пользователями)
//
// Секреты (задать в Supabase Dashboard → Edge Functions → Secrets):
//
//   ONEC_URL — публичный адрес MCP Toolkit на Windows-сервере, напр.:
//              http://<внешний-IP-или-домен>:6004/api/execute_query
//              ВАЖНО: sync-скрипты используют localhost:6004, потому что запускаются
//              на том же сервере. Edge Function работает в облаке Supabase —
//              ей нужен внешний адрес. Это НЕ адрес веб-сервиса 1С
//              (unf.nstore.keenetic.pro) — тот используется для HTTP-сервисов 1С,
//              здесь же нужен MCP Toolkit (порт 6004, endpoint /api/execute_query).
//
//   ONEC_BALANCE_REGISTER — имя регистра накопления в 1С:
//                           ВзаиморасчетыСКонтрагентамиМП
//
// Встроенные (Supabase подставляет автоматически):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')              ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ONEC_URL                  = Deno.env.get('ONEC_URL')                  ?? ''
const ONEC_BALANCE_REGISTER     = Deno.env.get('ONEC_BALANCE_REGISTER')     ?? ''

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? 'https://nstorecrm.kz',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)

  // Проверяем JWT и получаем user ID из токена клиента
  const { data: { user }, error: authErr } = await createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { global: { headers: { Authorization: authHeader } } },
  ).auth.getUser()
  if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Читаем company_id из профиля пользователя
  const { data: profile } = await db
    .from('profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id) return json({ available: false })

  // Читаем onec_counterparty_name компании
  const { data: company } = await db
    .from('companies')
    .select('onec_counterparty_name')
    .eq('id', profile.company_id)
    .single()

  if (!company?.onec_counterparty_name) return json({ available: false })

  // Проверяем, что 1С сконфигурирован
  if (!ONEC_URL || !ONEC_BALANCE_REGISTER) {
    console.warn('[get-company-balance] ONEC_URL or ONEC_BALANCE_REGISTER not configured')
    return json({ available: false })
  }

  // Запрос к регистру накопления взаиморасчётов.
  // Положительный остаток = клиент должен нам (дебиторка).
  // Отрицательный = мы должны клиенту (переплата).
  //
  // MCP Toolkit (execute_query) не поддерживает параметризованные запросы —
  // принимает только сырую строку запроса. Поэтому валидируем counterparty
  // white-list'ом (буквы/цифры/пробелы/дефис) вместо конкатенации сырого значения.
  const counterparty = company.onec_counterparty_name
  if (!/^[\p{L}\p{N}\s-]+$/u.test(counterparty)) {
    console.error('[get-company-balance] invalid onec_counterparty_name:', counterparty)
    return json({ available: false })
  }
  const query = [
    'ВЫБРАТЬ',
    '    Остатки.СуммаВзаиморасчетовОстаток КАК balance',
    `ИЗ РегистрНакопления.${ONEC_BALANCE_REGISTER}.Остатки() КАК Остатки`,
    `ГДЕ Остатки.Контрагент.Наименование = "${counterparty}"`,
  ].join('\n')

  let onecResp: Response
  try {
    onecResp = await fetch(ONEC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (e) {
    console.error('[get-company-balance] 1C unreachable:', e)
    return json({ available: false })
  }

  const onecData = await onecResp.json()
  if (!onecData?.success) {
    console.error('[get-company-balance] 1C query failed:', onecData?.error)
    return json({ available: false })
  }

  const rows: { balance?: number }[] = Array.isArray(onecData.data) ? onecData.data : []
  const balance = rows[0]?.balance ?? null

  return json({ available: true, balance, currency: 'KZT' })
})
