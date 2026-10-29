// supabase/functions/contract-egov-sign/index.ts
//
// Этап 2 — подпись договора через eGov Mobile (QR · SIGEX).
//
// Клиент кабинета выполняет QR-подписание на стороне браузера
// (библиотека sigex-qr-signing-client), получает CMS-подпись и ссылку SIGEX,
// после чего вызывает эту функцию, чтобы НАДЁЖНО (service role) зафиксировать
// договор как подписанный. Клиент напрямую обновлять contract_documents не
// может (RLS разрешает UPDATE только менеджеру/админу) — подпись проставляется
// только здесь, после проверки, что договор принадлежит компании клиента.
//
// Деплой:
//   supabase functions deploy contract-egov-sign --no-verify-jwt
//   verify_jwt ВЫКЛЮЧЕН НАМЕРЕННО: иначе платформа отклоняет CORS-preflight
//   (OPTIONS без токена → 403) и браузер не может вызвать функцию. JWT
//   проверяется вручную внутри (getUser по заголовку Authorization), поэтому
//   доступ по-прежнему только для аутентифицированных клиентов.
//
// Встроенные секреты (Supabase подставляет автоматически):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')              ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function cors(req: Request) {
  // Bearer-API (без cookie) — безопасно отражать Origin, чтобы работало и на
  // прод-домене, и на preview-деплоях Vercel.
  const origin = req.headers.get('Origin') ?? '*'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, x-supabase-api-version',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors(req) },
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json(req, { error: 'Unauthorized' }, 401)

  // Проверяем JWT и получаем пользователя
  const { data: { user }, error: authErr } = await createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { global: { headers: { Authorization: authHeader } } },
  ).auth.getUser()
  if (authErr || !user) return json(req, { error: 'Unauthorized' }, 401)

  // Входные данные
  let payload: { contractId?: string; cms?: string; signRef?: string }
  try {
    payload = await req.json()
  } catch {
    return json(req, { error: 'Invalid JSON' }, 400)
  }
  const { contractId, cms, signRef } = payload
  if (!contractId || typeof contractId !== 'string') return json(req, { error: 'contractId required' }, 400)
  if (!cms || typeof cms !== 'string' || cms.length < 16) return json(req, { error: 'cms (подпись) required' }, 400)

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Профиль клиента → его company_id
  const { data: profile } = await db.from('profiles').select('company_id').eq('id', user.id).single()
  if (!profile?.company_id) return json(req, { error: 'Профиль без компании' }, 403)

  // Договор и проверка принадлежности компании клиента
  const { data: contract, error: cErr } = await db
    .from('contract_documents')
    .select('id, company_id, status')
    .eq('id', contractId)
    .single()
  if (cErr || !contract) return json(req, { error: 'Договор не найден' }, 404)
  if (contract.company_id !== profile.company_id) return json(req, { error: 'Нет доступа к договору' }, 403)
  if (contract.status === 'signed') return json(req, { ok: true, alreadySigned: true })
  if (contract.status === 'cancelled') return json(req, { error: 'Договор отменён' }, 409)

  // Фиксируем подпись
  const { error: uErr } = await db
    .from('contract_documents')
    .update({
      status:        'signed',
      sign_provider: 'egov-mobile',
      sign_ref:      signRef ?? null,
      sign_cms:      cms,
      signed_by:     user.id,
      signed_at:     new Date().toISOString(),
    })
    .eq('id', contractId)
  if (uErr) {
    console.error('[contract-egov-sign] update failed:', uErr.message)
    return json(req, { error: 'Не удалось сохранить подпись' }, 500)
  }

  return json(req, { ok: true })
})
