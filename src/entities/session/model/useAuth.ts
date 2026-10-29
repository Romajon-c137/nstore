import { supabase } from '@/shared/lib/supabase'
import type { UserRole } from '@/shared/types/index'
import type { User } from '@supabase/supabase-js'
import { useEffect,useState } from 'react'

export function getRoleRoute(role: UserRole): string {
  return ['admin', 'manager', 'logist'].includes(role) ? '/crm' : '/cabinet'
}

export async function fetchRoleRoute(userId: string): Promise<string> {
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle()
  return getRoleRoute((data?.role as UserRole) ?? 'client')
}

export function useCurrentUser() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  return { user, loading }
}
