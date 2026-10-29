'use client'

import { supabase } from '@/shared/lib/supabase'
import { Profile } from '@/views/cabinet/ui/shared'
import { useQuery } from '@tanstack/react-query'

export default function ProfileTab({ profile }: { profile: Profile | null }) {
  const { data: manager } = useQuery({ queryKey: ['cabinet-manager', profile?.manager_id], queryFn: async () => { if (!profile?.manager_id) return null; const { data } = await supabase.from('profiles').select('name, phone, email').eq('id', profile.manager_id).single(); return data }, enabled: !!profile?.manager_id, staleTime: 120_000 })
  const row = (label: string, val: string | null | undefined, href?: string) => val ? (
    <div style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid #EDF1EF', fontSize: 14 }}>
      <span style={{ color: '#8A968E', width: 130, flexShrink: 0, fontWeight: 600 }}>{label}</span>
      {href ? <a href={href} style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 500 }}>{val}</a> : <span style={{ color: '#1A2A21' }}>{val}</span>}
    </div>
  ) : null
  return (
    <div style={{ padding: '28px 32px', overflowY: 'auto', height: '100%', background: '#F6F8F7' }}>
      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: '#0E1E16', marginBottom: 24 }}>Профиль</div>
      <div style={{ maxWidth: 560 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ width: 72, height: 72, borderRadius: 36, background: 'var(--primary)', color: '#fff', fontSize: 26, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>{(profile?.name ?? 'U').slice(0, 1).toUpperCase()}</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#0E1E16' }}>{profile?.name ?? 'Клиент'}</div>
          {profile?.company && <div style={{ fontSize: 14, color: '#5C6B63', marginTop: 4 }}>{profile.company}</div>}
        </div>
        <div style={{ background: '#fff', borderRadius: 16, padding: '0 20px', marginBottom: 16, border: '1px solid #EDF1EF' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#8A968E', padding: '14px 0 8px', textTransform: 'uppercase', letterSpacing: '.6px' }}>Мои данные</div>
          {row('Телефон', profile?.phone, profile?.phone ? `tel:${profile.phone}` : undefined)}
          {row('Email', profile?.email, profile?.email ? `mailto:${profile.email}` : undefined)}
          {row('Компания', profile?.company)}
        </div>
        {manager && (
          <div style={{ background: '#fff', borderRadius: 16, padding: '0 20px', marginBottom: 16, border: '1px solid #EDF1EF' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#8A968E', padding: '14px 0 8px', textTransform: 'uppercase', letterSpacing: '.6px' }}>Мой менеджер</div>
            {row('Имя', manager.name)}{row('Телефон', manager.phone, `tel:${manager.phone}`)}{row('Email', manager.email, `mailto:${manager.email}`)}
          </div>
        )}
        <button onClick={async () => { await supabase.auth.signOut(); window.location.href = '/login' }} style={{ width: '100%', padding: '13px', borderRadius: 14, border: 'none', background: '#FF3B3015', color: '#FF3B30', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>Выйти из аккаунта</button>
      </div>
    </div>
  )
}
