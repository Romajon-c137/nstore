import { createClient } from '@supabase/supabase-js'

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPA_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY



// Старые CRM-маршруты ещё импортируют этот модуль статически. В Django-режиме
// они не должны мешать загрузке /shop, даже если Supabase уже не настроен.
export const supabase = createClient(
  SUPA_URL || 'http://127.0.0.1:9',
  SUPA_KEY || 'django-mode-disabled',
  {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'nstore-auth-token',
  },
  },
)
