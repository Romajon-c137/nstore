'use client'

import { getRoleRoute } from '@/entities/session'
import { supabase } from '@/shared/lib/supabase'
import type { UserRole } from '@/shared/types/index'
import { redirect } from 'next/navigation'
import { useEffect,useRef,useState } from 'react'

type State = 'loading' | 'ok' | 'no-session' | 'wrong-role'

interface Props {
  children: React.ReactNode
  roles: UserRole[]
}

export default function AuthGuard({ children, roles }: Props) {
  const [state, setState] = useState<State>('loading')
  const [fallback, setFallback] = useState('/login')
  // Keep roles accessible inside the subscription callback without stale closure
  const rolesRef = useRef(roles)
  rolesRef.current = roles
  // Какой пользователь уже проверен — чтобы НЕ перемонтировать приложение на
  // token-refresh того же юзера (иначе при возврате фокуса на вкладку CRM
  // «обновляется» и теряет состояние).
  const checkedUidRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function checkUser(userId: string) {
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle()
      if (cancelled) return
      checkedUidRef.current = userId
      const role = (data?.role as UserRole) ?? 'client'
      if (rolesRef.current.includes(role)) {
        setState('ok')
      } else {
        setFallback(getRoleRoute(role))
        setState('wrong-role')
      }
    }

    // onAuthStateChange срабатывает сразу с INITIAL_SESSION, затем на каждое
    // событие (вход, выход, TOKEN_REFRESHED при возврате фокуса на вкладку).
    // Реагируем ТОЛЬКО на реальную смену пользователя / выход — иначе рефреш
    // токена перемонтировал бы всё приложение и сбрасывал состояние вкладки.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      const uid = session?.user?.id ?? null
      if (!uid) {
        checkedUidRef.current = null
        setState('no-session')
        return
      }
      if (uid !== checkedUidRef.current) {
        // новый/сменившийся пользователь — валидируем
        setState('loading')
        checkUser(uid)
      }
      // тот же пользователь (TOKEN_REFRESHED / фокус вкладки) — ничего не делаем
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (state === 'loading')
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F2F2F7] dark:bg-[#09090C]">
        <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    )
  if (state === 'no-session') return redirect('/login')
  if (state === 'wrong-role') return redirect(fallback)
  return <>{children}</>
}
