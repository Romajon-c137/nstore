'use client'

import { supabase } from '@/shared/lib/supabase'
import type { Profile } from '@/shared/types/index'
import { useQuery } from '@tanstack/react-query'
import {
createContext,
useCallback,
useContext,
useEffect,
useMemo,
useRef,
useState,
type ReactNode,
} from 'react'

type AccessLevel = 'full' | 'view' | 'none'

// Maps CRM nav tab IDs to role_permissions.module names in DB
const TAB_TO_MODULE: Record<string, string> = {
  partners:   'clients',
  products1c: 'kaspi',
}

interface ToastItem {
  id: string
  msg: string
}

interface CRMContextValue {
  profile: Profile | null
  profileLoading: boolean
  toast: (msg: string, duration?: number) => void
  can: (tabId: string) => AccessLevel
  permsLoaded: boolean
}

const CRMCtx = createContext<CRMContextValue | null>(null)

export function useCRM() {
  const ctx = useContext(CRMCtx)
  if (!ctx) throw new Error('useCRM must be used within CRMProvider')
  return ctx
}

export function CRMProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const { data: permsData = [], isSuccess } = useQuery<{ role: string; module: string; access_level: AccessLevel }[]>({
    queryKey: ['role-permissions'],
    queryFn: async () => {
      const { data } = await supabase.from('role_permissions').select('role,module,access_level')
      return (data ?? []) as { role: string; module: string; access_level: AccessLevel }[]
    },
    staleTime: 5 * 60_000,
    enabled: !!profile,
  })
  // Готово только когда права реально загружены (непустой ответ) — иначе пустой
  // ответ дал бы can()==='none' на все вкладки и ложный редирект на дашборд.
  const permsLoaded = isSuccess && permsData.length > 0

  const permMap = useMemo(() => {
    const m: Record<string, Record<string, AccessLevel>> = {}
    for (const p of permsData) {
      if (!m[p.role]) m[p.role] = {}
      m[p.role][p.module] = p.access_level
    }
    return m
  }, [permsData])

  const can = useCallback((tabId: string): AccessLevel => {
    if (!profile) return 'none'
    const module = TAB_TO_MODULE[tabId] ?? tabId
    return permMap[profile.role]?.[module] ?? 'none'
  }, [profile, permMap])

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { if (active) setProfileLoading(false); return }
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle()
      if (!active) return
      setProfile(data as Profile | null)
      setProfileLoading(false)
    }).catch(() => { if (active) setProfileLoading(false) })
    return () => { active = false }
  }, [])

  // Очистка висящих таймеров тостов при размонтировании
  useEffect(() => {
    const map = timers.current
    return () => { map.forEach(clearTimeout); map.clear() }
  }, [])

  const toast = useCallback((msg: string, duration = 2200) => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev, { id, msg }])
    const t = setTimeout(() => {
      setToasts(prev => prev.filter(item => item.id !== id))
      timers.current.delete(id)
    }, duration)
    timers.current.set(id, t)
  }, [])

  return (
    <CRMCtx.Provider value={{ profile, profileLoading, toast, can, permsLoaded }}>
      {children}

      {/* Toast container */}
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          pointerEvents: 'none',
        }}
      >
        {toasts.map(t => (
          <div
            key={t.id}
            style={{
              background: 'var(--t)',
              color: 'var(--bg)',
              padding: '8px 18px',
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              animation: 'fadeInUp .2s ease',
              boxShadow: 'var(--shadow)',
            }}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </CRMCtx.Provider>
  )
}
