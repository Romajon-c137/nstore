'use client'

import { UserSettingsModal } from '@/features/user-settings'
import { useLanguage } from '@/shared/i18n/LanguageContext'
import type { Lang } from '@/shared/i18n/translations'
import { NavLink,useLocation,useNavigate } from '@/shared/lib/navigation'
import { supabase } from '@/shared/lib/supabase'
import { useCRM } from '@/views/crm/context/CRMContext'
import { useIsMobile } from '@/views/crm/shared/crmui'
import { useQuery } from '@tanstack/react-query'
import { useEffect,useRef,useState } from 'react'

/* ── Role badge styles ── */
const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  admin:   { bg: 'rgba(220,38,38,.15)',  color: '#DC2626' },
  manager: { bg: 'rgba(16,163,91,.15)',  color: 'var(--primary)' },
  logist:  { bg: 'rgba(8,145,178,.15)',  color: '#0891B2' },
  client:  { bg: 'rgba(22,163,74,.15)',  color: '#16A34A' },
}

const TAB_IDS = ['dash', 'deliveries', 'sales', 'board', 'partners', 'products1c', 'logistics', 'whatsapp', 'content', 'balance', 'roles'] as const

const LANG_OPTIONS: { lang: Lang; short: string; label: string }[] = [
  { lang: 'kz', short: 'ҚАЗ', label: 'Қазақша' },
  { lang: 'ru', short: 'РУ',  label: 'Русский'  },
]

/* ── Theme helper ── */
function applyTheme(theme: 'light' | 'dark') {
  if (theme === 'dark') document.documentElement.classList.add('dark')
  else document.documentElement.classList.remove('dark')
  localStorage.setItem('crm_theme', theme)
}
function getInitialTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  const saved = localStorage.getItem('crm_theme')
  if (saved === 'dark' || saved === 'light') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}


/* ── Bottom tab bar icons (24px, stroke=currentColor) ── */
const ICONS: Record<string, React.ReactNode> = {
  dash: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>,
  board: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="9.5" y="4" width="5" height="11" rx="1.5"/><rect x="16" y="4" width="5" height="14" rx="1.5"/></svg>,
  clients: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 6.2a3 3 0 0 1 0 5.6"/><path d="M17.5 19a5.2 5.2 0 0 0-2.3-4.3"/></svg>,
  partners: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 6.2a3 3 0 0 1 0 5.6"/><path d="M17.5 19a5.2 5.2 0 0 0-2.3-4.3"/></svg>,
  products1c: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>,
  more: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>,
  locations: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>,
  companies: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="10" height="18" rx="1.5"/><path d="M14 8h6v13H4"/><path d="M7.5 7h3M7.5 11h3M7.5 15h3"/></svg>,
  logistics: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h11v9H3z"/><path d="M14 9h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></svg>,
  whatsapp: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.6-5.3A8.5 8.5 0 1 1 21 11.5Z"/></svg>,
  content: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 9v11"/></svg>,
  traffic: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="M7 14l3-4 3 3 5-7"/></svg>,
  roles: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 5 6v5c0 4.4 3 8.3 7 9.5 4-1.2 7-5.1 7-9.5V6l-7-3Z"/><path d="m9.5 12 1.8 1.8L15 10"/></svg>,
  deliveries: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/><path d="m7.5 5.5 9 5"/></svg>,
  sales: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/><path d="m14 8 3-3 3 3"/></svg>,
  balance: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="M7 15l3-4 3 3 5-7"/></svg>,
}

export default function CRMLayout({ children }: { children: React.ReactNode }) {
  const { profile } = useCRM()
  const navigate = useNavigate()
  const location = useLocation()
  const { lang, setLang, tr } = useLanguage()
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme)
  const [menuOpen, setMenuOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const isMobile = useIsMobile()
  const { can, permsLoaded } = useCRM()

  // Close the mobile "More" sheet on navigation
  useEffect(() => { setMoreOpen(false) }, [location.pathname])

  // RBAC route guard: redirect to /crm/dash if the active tab is forbidden
  useEffect(() => {
    if (!permsLoaded) return
    const tab = location.pathname.split('/').pop()
    if (!tab || tab === 'dash') return
    if (can(tab) === 'none') navigate('/crm/dash', { replace: true })
  }, [location.pathname, can, permsLoaded, navigate])

  useEffect(() => { applyTheme(theme) }, [theme])

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    if (menuOpen) document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [menuOpen])

  const { data: ordersCount = 0 } = useQuery({
    queryKey: ['nav-orders-count'],
    queryFn: async () => {
      const { count } = await supabase.from('crm_tasks').select('id', { count: 'exact', head: true }).eq('task_type', 'order').in('order_status', ['new', 'confirmed'])
      return count ?? 0
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const { data: waUnread = 0 } = useQuery({
    queryKey: ['nav-wa-unread'],
    queryFn: async () => {
      const { data } = await supabase.from('wa_conversations').select('unread_count').gt('unread_count', 0)
      return (data ?? []).reduce((s: number, r: { unread_count: number }) => s + (r.unread_count ?? 0), 0)
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const ALL_TABS: { id: typeof TAB_IDS[number]; label: string; badge?: number; badgeColor?: string }[] = [
    { id: 'dash',       label: tr('tabDash')      },
    { id: 'deliveries', label: tr('tabDeliveries') },
    { id: 'sales',      label: tr('tabSales')     },
    { id: 'board',      label: tr('tabBoard'),      badge: ordersCount, badgeColor: '#7C3AED' },
    { id: 'partners',   label: tr('tabPartners')   },
    { id: 'products1c', label: tr('tabKaspi')      },
    { id: 'logistics',  label: tr('tabLogistics')  },
    { id: 'whatsapp',   label: tr('tabWhatsApp'),  badge: waUnread, badgeColor: '#25D366' },
    { id: 'content',    label: tr('tabContent')    },
    { id: 'balance',    label: tr('tabBalance')    },
    { id: 'roles',      label: tr('tabRoles')      },
  ]
  const TABS = ALL_TABS.filter(tab => can(tab.id) !== 'none')

  const ROLE_LABEL: Record<string, string> = {
    admin: tr('roleAdmin'), manager: tr('roleManager'),
    logist: tr('roleLogist'), client: tr('roleClient'),
  }

  async function doLogout() {
    setMenuOpen(false)
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  const role = profile?.role ?? 'client'
  // Нижняя панель (мобильная/PWA): водителям — «Доставки» первой
  const PRIMARY: string[] = role === 'logist' ? ['deliveries', 'dash', 'logistics', 'partners'] : ['dash', 'board', 'partners', 'products1c']
  const roleColors = ROLE_COLORS[role] ?? { bg: 'rgba(16,163,91,.15)', color: 'var(--primary)' }
  const currentLang = LANG_OPTIONS.find(o => o.lang === lang)!
  const activeTab = location.pathname.split('/').pop()
  const activeLabel = TABS.find(t => t.id === activeTab)?.label ?? 'CRM'

  /* ── Sidebar content (shared between desktop & mobile) ── */
  const sidebarContent = (
    <>
      {/* Logo */}
      <div style={{ padding: '20px 16px 18px', borderBottom: '1px solid rgba(169,192,178,.1)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => {}}
            style={{
              width: 34, height: 34, borderRadius: 10, flexShrink: 0,
              background: 'linear-gradient(135deg,#10A35B,#7C3AED)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 800, fontSize: 16,
              fontFamily: 'var(--font-display)',
              border: 'none', cursor: isMobile ? 'pointer' : 'default',
            }}
          >N</button>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, color: '#fff', letterSpacing: '.02em', lineHeight: 1.2 }}>
              nstore<span style={{ color: '#5FC78F' }}>·crm</span>
            </div>
            <div style={{ fontSize: 10, color: '#A9C0B2', marginTop: 1 }}>Connection</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ padding: '12px 10px', flex: 1, overflowY: 'auto' }}>
        {TABS.map(tab => {
          const isActive = activeTab === tab.id
          return (
            <NavLink
              key={tab.id}
              href={`/crm/${tab.id}`}
              style={({ isActive: a }) => ({
                display: 'flex', alignItems: 'center',
                padding: '10px 13px', borderRadius: 10, marginBottom: 2,
                fontSize: 13, fontWeight: a ? 700 : 500,
                cursor: 'pointer', textDecoration: 'none', whiteSpace: 'nowrap',
                transition: 'all .15s', fontFamily: 'inherit',
                background: a ? 'var(--primary)' : 'transparent',
                color: a ? '#fff' : '#A9C0B2',
              })}
              onMouseEnter={e => {
                if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(169,192,178,.1)'
              }}
              onMouseLeave={e => {
                if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'
              }}
            >
              {tab.label}
              {!!tab.badge && tab.badge > 0 && (
                <span style={{
                  marginLeft: 'auto', background: tab.badgeColor ?? '#7C3AED',
                  color: tab.badgeColor === '#25D366' ? '#06351A' : '#fff',
                  borderRadius: 6, padding: '1px 7px', fontSize: 11, fontWeight: 700,
                }}>
                  {tab.badge > 99 ? '99+' : tab.badge}
                </span>
              )}
            </NavLink>
          )
        })}
      </nav>

      {/* Bottom: user + controls */}
      <div style={{ padding: '0 10px', flexShrink: 0 }}>
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            onClick={() => setMenuOpen(v => !v)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 13px', borderRadius: 10, border: 'none',
              background: menuOpen ? 'rgba(16,163,91,.18)' : 'rgba(169,192,178,.08)',
              cursor: 'pointer', textAlign: 'left', transition: 'all .15s',
            }}
            onMouseEnter={e => { if (!menuOpen) (e.currentTarget as HTMLElement).style.background = 'rgba(169,192,178,.15)' }}
            onMouseLeave={e => { if (!menuOpen) (e.currentTarget as HTMLElement).style.background = 'rgba(169,192,178,.08)' }}
          >
            <div style={{
              width: 30, height: 30, borderRadius: 8, flexShrink: 0,
              background: 'linear-gradient(135deg,#10A35B,#7C3AED)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 12, fontWeight: 800,
            }}>
              {(profile?.name ?? 'U')[0].toUpperCase()}
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {profile?.name ?? '...'}
              </div>
              <div style={{ fontSize: 10, color: '#A9C0B2', marginTop: 1 }}>{ROLE_LABEL[role] ?? role}</div>
            </div>
            <span style={{ color: '#A9C0B2', fontSize: 10 }}>{menuOpen ? '▲' : '▼'}</span>
          </button>

          {/* Dropdown menu */}
          {menuOpen && (
            <div style={{
              position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, right: 0, zIndex: 1001,
              background: '#fff', border: '1px solid #EDF1EF',
              borderRadius: 14, overflow: 'hidden',
              boxShadow: '0 12px 40px rgba(0,0,0,.18)',
            }}>
              <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid #EDF1EF' }}>
                <span style={{
                  fontSize: 10, padding: '3px 10px', borderRadius: 100,
                  fontWeight: 800, textTransform: 'uppercase',
                  background: roleColors.bg, color: roleColors.color,
                }}>
                  {ROLE_LABEL[role] ?? role}
                </span>
              </div>

              <div style={{ padding: '6px 0', borderBottom: '1px solid #EDF1EF' }}>
                {LANG_OPTIONS.map(o => (
                  <button
                    key={o.lang}
                    onClick={() => setLang(o.lang)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      width: '100%', padding: '7px 14px', border: 'none',
                      background: lang === o.lang ? '#EAF6EE' : 'transparent',
                      cursor: 'pointer', textAlign: 'left',
                      borderLeft: lang === o.lang ? '3px solid var(--primary)' : '3px solid transparent',
                      color: '#12201A', fontSize: 13,
                    }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 800, width: 34, letterSpacing: '.04em', color: lang === o.lang ? 'var(--primary)' : '#5C6B63' }}>{o.short}</span>
                    <span style={{ fontWeight: lang === o.lang ? 700 : 400 }}>{o.label}</span>
                  </button>
                ))}
              </div>

              <div style={{ padding: '6px 0', borderBottom: '1px solid #EDF1EF' }}>
                <button
                  onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', padding: '8px 14px', border: 'none',
                    background: 'transparent', cursor: 'pointer', textAlign: 'left',
                    color: '#12201A', fontSize: 13,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#F2F5F3')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ fontWeight: 500 }}>
                    {theme === 'dark'
                      ? (lang === 'kz' ? 'Жарық тақырып' : 'Светлая тема')
                      : (lang === 'kz' ? 'Қараңғы тақырып' : 'Тёмная тема')}
                  </span>
                </button>
              </div>

              <div style={{ padding: '6px 0', borderBottom: '1px solid #EDF1EF' }}>
                <button
                  onClick={() => { setMenuOpen(false); setSettingsOpen(true) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', padding: '8px 14px', border: 'none',
                    background: 'transparent', cursor: 'pointer', textAlign: 'left',
                    color: '#12201A', fontSize: 13, fontWeight: 500,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#F2F5F3')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span>Настройки профиля</span>
                </button>
              </div>

              <div style={{ padding: '6px 0' }}>
                <button
                  onClick={doLogout}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', padding: '8px 14px', border: 'none',
                    background: 'transparent', cursor: 'pointer', textAlign: 'left',
                    color: '#DC2626', fontSize: 13, fontWeight: 600,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#FF3B3010')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span>{tr('logout')}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 8, padding: '0 4px' }}>
          <button
            onClick={() => setMenuOpen(v => !v)}
            title={currentLang.label}
            style={{
              background: 'rgba(169,192,178,.12)', border: 'none', borderRadius: 7,
              padding: '4px 10px', cursor: 'pointer',
              fontSize: 11, fontWeight: 800, color: '#A9C0B2', letterSpacing: '.04em',
            }}
          >
            {currentLang.short}
          </button>
        </div>
      </div>
    </>
  )

  return (
    <div
      className="flex font-sans antialiased"
      style={{ height: '100dvh', overflow: 'hidden', background: '#EEF1F0' }}
    >
      {/* ── DESKTOP SIDEBAR (hidden on mobile) ── */}
      {!isMobile && (
        <aside style={{
          width: 230, flexShrink: 0, background: '#0C1A13',
          display: 'flex', flexDirection: 'column', padding: '0 0 16px',
          scrollbarWidth: 'none', position: 'relative',
        }}>
          {sidebarContent}
        </aside>
      )}

      {/* ── MAIN CONTENT ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* Mobile header (title changes per tab) OR desktop gradient strip */}
        {isMobile ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '0 14px', flexShrink: 0, background: '#0C1A13',
            paddingTop: 'var(--sat)', height: 'calc(56px + var(--sat))',
          }}>
            {/* N brand button → opens More sheet */}
            <button
              onClick={() => setMoreOpen(true)}
              style={{
                width: 38, height: 38, borderRadius: 11, flexShrink: 0,
                background: 'linear-gradient(135deg,#10A35B,#7C3AED)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontWeight: 800, fontSize: 17,
                fontFamily: 'var(--font-display)', border: 'none', cursor: 'pointer',
              }}
            >N</button>
            {/* Active tab title + brand */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: '#fff', lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeLabel}
              </div>
              <div style={{ fontSize: 10, color: '#5FC78F', marginTop: 1, fontWeight: 600 }}>
                nstore · Connect
              </div>
            </div>
            {/* Avatar → настройки пользователя */}
            <button
              onClick={() => setSettingsOpen(true)}
              title="Настройки"
              style={{
                width: 34, height: 34, borderRadius: 10, flexShrink: 0, border: 'none', cursor: 'pointer',
                background: 'linear-gradient(135deg,#10A35B,#7C3AED)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 13, fontWeight: 800,
              }}
            >
              {(profile?.name ?? 'U')[0].toUpperCase()}
            </button>
          </div>
        ) : (
          <div style={{ flexShrink: 0 }}>
            <div style={{ height: 3, background: 'linear-gradient(90deg,#10A35B,#7C3AED)' }} />
            <div style={{
              display: 'flex', alignItems: 'center',
              height: 56, padding: '0 28px',
              background: 'var(--bg2)', borderBottom: '1px solid var(--bd)',
            }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, color: 'var(--t)' }}>
                {activeLabel}
              </div>
            </div>
          </div>
        )}

        <main style={{ flex: 1, overflow: 'hidden', display: 'flex', minHeight: 0 }}>
          {children}
        </main>

        {/* ── MOBILE: native bottom tab bar ── */}
        {isMobile && (
          <nav className="tabbar">
            {TABS.filter(t => PRIMARY.includes(t.id)).map(t => (
              <NavLink key={t.id} href={`/crm/${t.id}`} onClick={() => navigator.vibrate?.(8)} className={activeTab === t.id ? 'active' : ''} style={{ position: 'relative' }}>
                {ICONS[t.id]}
                {!!t.badge && t.badge > 0 && (
                  <span style={{ position: 'absolute', top: 4, right: '50%', marginRight: -18, background: '#7C3AED', color: '#fff', borderRadius: 10, minWidth: 16, height: 16, padding: '0 4px', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {t.badge > 99 ? '99+' : t.badge}
                  </span>
                )}
                <span>{t.label}</span>
              </NavLink>
            ))}
            <a
              onClick={(e) => { e.preventDefault(); navigator.vibrate?.(8); setMoreOpen(true) }}
              href="#more"
              className={moreOpen || !PRIMARY.includes(activeTab ?? '') ? 'active' : ''}
              style={{ position: 'relative' }}
            >
              {ICONS.more}
              {waUnread > 0 && (
                <span style={{ position: 'absolute', top: 4, right: '50%', marginRight: -18, background: '#25D366', color: '#06351A', borderRadius: 10, minWidth: 16, height: 16, padding: '0 4px', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {waUnread > 99 ? '99+' : waUnread}
                </span>
              )}
              <span>{tr('navMore')}</span>
            </a>
          </nav>
        )}
      </div>

      {/* ── MOBILE: "More" bottom sheet (all secondary tabs + settings) ── */}
      {isMobile && moreOpen && (
        <>
          <div className="sheet-backdrop" onClick={() => setMoreOpen(false)} />
          <div className="sheet" role="dialog">
            <div
              className="sheet-grip"
              style={{ cursor: 'grab', padding: '6px 0', margin: '-6px 0' }}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); (e.currentTarget as HTMLElement & { _sy?: number })._sy = e.clientY }}
              onPointerMove={(e) => { const sy = (e.currentTarget as HTMLElement & { _sy?: number })._sy; if (sy !== undefined && e.clientY - sy > 80) { setMoreOpen(false); navigator.vibrate?.(8) } }}
            />

            {/* Secondary tabs grid — только те, которых нет в нижней панели */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 6 }}>
              {TABS.filter(tab => !PRIMARY.includes(tab.id)).map(tab => {
                const isActive = activeTab === tab.id
                return (
                  <NavLink
                    key={tab.id}
                    href={`/crm/${tab.id}`}
                    onClick={() => setMoreOpen(false)}
                    style={{
                      position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
                      padding: '14px 6px', borderRadius: 14, textDecoration: 'none', textAlign: 'center',
                      background: isActive ? 'var(--primary)' : 'var(--bg3)',
                      color: isActive ? '#fff' : 'var(--t)', fontSize: 12, fontWeight: 600,
                    }}
                  >
                    <span style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', color: isActive ? '#fff' : 'var(--primary)' }}>
                      {ICONS[tab.id] ?? ICONS.more}
                    </span>
                    <span style={{ lineHeight: 1.2 }}>{tab.label}</span>
                    {!!tab.badge && tab.badge > 0 && (
                      <span style={{ position: 'absolute', top: 8, right: 10, background: tab.badgeColor ?? '#7C3AED', color: tab.badgeColor === '#25D366' ? '#06351A' : '#fff', borderRadius: 10, minWidth: 18, padding: '0 5px', fontSize: 10, fontWeight: 700, textAlign: 'center' }}>
                        {tab.badge > 99 ? '99+' : tab.badge}
                      </span>
                    )}
                  </NavLink>
                )
              })}
            </div>
          </div>
        </>
      )}

      {settingsOpen && <UserSettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
