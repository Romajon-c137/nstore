'use client'

import { supabase } from '@/shared/lib/supabase'
import { Profile,TeamMember } from '@/views/cabinet/ui/shared'
import { useQuery } from '@tanstack/react-query'

export default function UsersTab({ profile }: { profile: Profile | null }) {
  const { data: users = [], isLoading } = useQuery<TeamMember[]>({
    queryKey: ['cabinet-users', profile?.company_id],
    queryFn: async () => { if (!profile?.company_id) return []; const { data } = await supabase.from('profiles').select('id, name, email, role, phone, location_id').eq('company_id', profile.company_id); return (data ?? []) as TeamMember[] },
    enabled: !!profile?.company_id, staleTime: 60_000,
  })
  const ROLE_COLORS: Record<string, { bg: string; fg: string }> = { client: { bg: '#EAF6EE', fg: 'var(--primary)' }, manager: { bg: '#EDE9FF', fg: '#7C3AED' }, admin: { bg: '#FFE4E4', fg: '#DC2626' } }
  const avatarColors = ['var(--primary)', '#7C3AED', '#1B7E8C', '#F57C00', '#DC2626']
  return (
    <div style={{ padding: '28px 32px', overflowY: 'auto', height: '100%', background: '#F6F8F7' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: '#0E1E16', marginBottom: 24 }}>Пользователи</div>
      {isLoading ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{Array.from({ length: 3 }).map((_, i) => <div key={i} style={{ height: 64, borderRadius: 14, background: '#F2F5F3', animation: 'pulse 1.4s ease-in-out infinite' }} />)}</div>
        : users.length === 0 ? <div style={{ textAlign: 'center', paddingTop: 60, color: '#8A968E' }}><div style={{ fontSize: 40, marginBottom: 12 }}>👥</div><div style={{ fontSize: 15, fontWeight: 700, color: '#1A2A21', marginBottom: 4 }}>Нет пользователей</div></div>
        : <div style={{ background: '#fff', border: '1px solid #EDF1EF', borderRadius: 16, overflow: 'hidden' }}>
            {users.map((u, idx) => { const roleColors = ROLE_COLORS[u.role ?? 'client'] ?? ROLE_COLORS.client; return (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderBottom: idx < users.length - 1 ? '1px solid #F4F7F5' : 'none' }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: avatarColors[idx % avatarColors.length], display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 15, flexShrink: 0 }}>{(u.name ?? u.email ?? 'U').slice(0, 1).toUpperCase()}</div>
                <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 600, color: '#0E1E16' }}>{u.name ?? '—'}</div><div style={{ fontSize: 12, color: '#8A968E' }}>{u.email}</div></div>
                {u.phone && <span style={{ fontSize: 13, color: '#5C6B63' }}>{u.phone}</span>}
                <span style={{ background: roleColors.bg, color: roleColors.fg, borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700 }}>{u.role ?? 'client'}</span>
              </div>
            )})}
          </div>}
    </div>
  )
}
