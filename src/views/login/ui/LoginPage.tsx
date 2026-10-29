'use client'

import { fetchRoleRoute } from '@/entities/session'
import { LangSwitch } from '@/features/language-switch'
import { useLanguage } from '@/shared/i18n/LanguageContext'
import { useNavigate } from '@/shared/lib/navigation'
import { supabase } from '@/shared/lib/supabase'
import { useEffect,useRef,useState } from 'react'

type Tab = 'login' | 'register' | 'forgot' | 'sent' | 'newpass'
type MsgType = 'error' | 'success' | ''

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconEmail() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  )
}
function IconLock() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}
function IconUser() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  )
}
function IconPhone() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 11.8a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  )
}

// ─── UI Primitives ────────────────────────────────────────────────────────────

function InputField({
  id, type, placeholder, icon, onEnter,
}: {
  id: string; type: string; placeholder: string; icon: React.ReactNode; onEnter?: () => void
}) {
  return (
    <div style={{ position: 'relative', marginBottom: 16 }}>
      <div style={{
        position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
        color: '#8A968E', lineHeight: 0, pointerEvents: 'none',
      }}>
        {icon}
      </div>
      <input
        id={id}
        type={type}
        placeholder={placeholder}
        onKeyDown={e => e.key === 'Enter' && onEnter?.()}
        style={{
          width: '100%', paddingLeft: 42, paddingRight: 14,
          height: 46, border: '1px solid #D4DAD6', borderRadius: 11,
          background: '#fff', fontSize: 14, color: '#12201A', outline: 'none',
          boxSizing: 'border-box', transition: 'border-color .2s, box-shadow .2s',
          fontFamily: 'inherit',
        }}
        onFocus={e => {
          e.currentTarget.style.borderColor = 'var(--primary)'
          e.currentTarget.style.boxShadow = '0 0 0 3px rgba(16,163,91,.12)'
        }}
        onBlur={e => {
          e.currentTarget.style.borderColor = '#D4DAD6'
          e.currentTarget.style.boxShadow = 'none'
        }}
      />
    </div>
  )
}

function GradientBtn({ onClick, loading, children }: { onClick: () => void; loading?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        width: '100%', padding: '13px', border: 'none', borderRadius: 11,
        background: loading ? '#8A968E' : 'var(--primary)',
        color: '#fff', fontSize: 14, fontWeight: 700,
        cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? .8 : 1,
        boxShadow: loading ? 'none' : '0 4px 16px rgba(16,163,91,.3)',
        transition: 'opacity .2s, background .2s',
        fontFamily: 'inherit',
      }}
      onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#0E7C46' }}
      onMouseLeave={e => { if (!loading) e.currentTarget.style.background = 'var(--primary)' }}
    >
      {children}
    </button>
  )
}

function MsgBox({ type, text }: { type: MsgType; text: string }) {
  if (!text) return null
  return (
    <div style={{
      marginTop: 12, padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500,
      background: type === 'error' ? '#FF3B3010' : '#10A35B10',
      color: type === 'error' ? '#DC2626' : 'var(--primary)',
      border: `1px solid ${type === 'error' ? '#DC262630' : '#10A35B30'}`,
    }}>
      {text}
    </div>
  )
}

function LinkBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)', fontSize: 13, fontWeight: 600, padding: 0 }}>
      {children}
    </button>
  )
}

// ─── Forms ────────────────────────────────────────────────────────────────────

function LoginForm({ onRedirect, onForgot, onRegister, tr }: {
  onRedirect: (r: string) => void; onForgot: () => void; onRegister: () => void
  tr: (k: string) => string
}) {
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ type: MsgType; text: string }>({ type: '', text: '' })

  async function handle() {
    const email = (document.getElementById('l-email') as HTMLInputElement).value.trim()
    const password = (document.getElementById('l-pass') as HTMLInputElement).value
    setMsg({ type: '', text: '' })
    if (!email || !password) { setMsg({ type: 'error', text: tr('loginErrEmpty') }); return }
    setLoading(true)
    const { error, data } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setLoading(false)
      const m = error.message
      if (m.includes('credentials') || m.includes('Invalid') || m.includes('password'))
        setMsg({ type: 'error', text: tr('loginErrWrong') })
      else if (m.includes('confirmed') || m.includes('verified'))
        setMsg({ type: 'error', text: tr('loginErrUnverified') })
      else setMsg({ type: 'error', text: tr('error') + ': ' + m })
      return
    }
    onRedirect(await fetchRoleRoute(data.user.id))
  }

  return (
    <>
      <InputField id="l-email" type="email" placeholder={tr('loginEmail')} icon={<IconEmail />} onEnter={handle} />
      <InputField id="l-pass" type="password" placeholder={tr('loginPassword')} icon={<IconLock />} onEnter={handle} />

      <div style={{ textAlign: 'right', marginBottom: 20, marginTop: -4 }}>
        <LinkBtn onClick={onForgot}>{tr('loginForgot')}</LinkBtn>
      </div>

      <GradientBtn onClick={handle} loading={loading}>{loading ? tr('loginLoading') : tr('loginBtn')}</GradientBtn>
      <MsgBox {...msg} />

      <div style={{ textAlign: 'center', marginTop: 24, color: '#8A968E', fontSize: 13 }}>
        {tr('loginNoAccount')}{' '}
        <LinkBtn onClick={onRegister}>{tr('loginRegLink')}</LinkBtn>
      </div>
    </>
  )
}

function RegisterForm({ onLogin, tr }: { onLogin: () => void; tr: (k: string) => string }) {
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ type: MsgType; text: string }>({ type: '', text: '' })

  async function handle() {
    const email = (document.getElementById('r-email') as HTMLInputElement).value.trim()
    const name = (document.getElementById('r-name') as HTMLInputElement).value.trim()
    const phone = (document.getElementById('r-phone') as HTMLInputElement).value.trim()
    const password = (document.getElementById('r-pass') as HTMLInputElement).value
    setMsg({ type: '', text: '' })
    if (!email || !password) { setMsg({ type: 'error', text: tr('loginErrEmpty') }); return }
    if (password.length < 6) { setMsg({ type: 'error', text: tr('registerErrShort') }); return }
    setLoading(true)
    const { error } = await supabase.auth.signUp({ email, password, options: { data: { name, phone } } })
    setLoading(false)
    if (error) { setMsg({ type: 'error', text: error.message.includes('already') ? tr('registerErrExists') : error.message }); return }
    setMsg({ type: 'success', text: tr('registerSuccess') })
  }

  return (
    <>
      <InputField id="r-email" type="email" placeholder={tr('loginEmail')} icon={<IconEmail />} />
      <InputField id="r-name" type="text" placeholder={tr('registerName')} icon={<IconUser />} />
      <InputField id="r-phone" type="tel" placeholder={tr('registerPhone')} icon={<IconPhone />} />
      <InputField id="r-pass" type="password" placeholder={tr('registerPass')} icon={<IconLock />} onEnter={handle} />

      <GradientBtn onClick={handle} loading={loading}>{loading ? tr('registerLoading') : tr('registerBtn')}</GradientBtn>
      <MsgBox {...msg} />

      <div style={{ textAlign: 'center', marginTop: 20, color: '#8A968E', fontSize: 13 }}>
        {tr('registerHasAccount')}{' '}
        <LinkBtn onClick={onLogin}>{tr('registerLoginLink')}</LinkBtn>
      </div>
    </>
  )
}

function ForgotForm({ onSent, onBack, tr }: { onSent: () => void; onBack: () => void; tr: (k: string) => string }) {
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ type: MsgType; text: string }>({ type: '', text: '' })

  async function handle() {
    const email = (document.getElementById('f-email') as HTMLInputElement).value.trim()
    setMsg({ type: '', text: '' })
    if (!email) { setMsg({ type: 'error', text: tr('forgotErrEmpty') }); return }
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/login' })
    setLoading(false)
    if (error) { setMsg({ type: 'error', text: error.message }); return }
    onSent()
  }

  return (
    <>
      <div style={{ fontSize: 13, color: '#5C6B63', marginBottom: 20, lineHeight: 1.6 }}>
        {tr('forgotDesc')}
      </div>
      <InputField id="f-email" type="email" placeholder={tr('loginEmail')} icon={<IconEmail />} onEnter={handle} />
      <GradientBtn onClick={handle} loading={loading}>{loading ? tr('forgotLoading') : tr('forgotBtn')}</GradientBtn>
      <MsgBox {...msg} />
      <div style={{ textAlign: 'center', marginTop: 20 }}>
        <LinkBtn onClick={onBack}>{tr('back')}</LinkBtn>
      </div>
    </>
  )
}

function SentScreen({ onBack, tr }: { onBack: () => void; tr: (k: string) => string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 17, fontWeight: 800, color: '#12201A', marginBottom: 8 }}>{tr('sentTitle')}</div>
      <div style={{ fontSize: 13, color: '#5C6B63', lineHeight: 1.6, marginBottom: 28 }}>
        {tr('sentDesc')}
      </div>
      <GradientBtn onClick={onBack}>{tr('sentBack')}</GradientBtn>
    </div>
  )
}

function NewPassForm({ onRedirect, tr }: { onRedirect: (r: string) => void; tr: (k: string) => string }) {
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ type: MsgType; text: string }>({ type: '', text: '' })

  async function handle() {
    const p1 = (document.getElementById('np-1') as HTMLInputElement).value
    const p2 = (document.getElementById('np-2') as HTMLInputElement).value
    setMsg({ type: '', text: '' })
    if (p1.length < 6) { setMsg({ type: 'error', text: tr('newpassErrShort') }); return }
    if (p1 !== p2) { setMsg({ type: 'error', text: tr('newpassErrMatch') }); return }
    setLoading(true)
    const { error, data } = await supabase.auth.updateUser({ password: p1 })
    setLoading(false)
    if (error) { setMsg({ type: 'error', text: error.message.includes('different') ? tr('newpassErrDiff') : tr('newpassErrFail') }); return }
    setMsg({ type: 'success', text: tr('newpassSuccess') })
    if (data.user?.id) setTimeout(async () => onRedirect(await fetchRoleRoute(data.user!.id)), 1000)
  }

  return (
    <>
      <div style={{ fontSize: 13, color: '#5C6B63', marginBottom: 20 }}>{tr('newpassDesc')}</div>
      <InputField id="np-1" type="password" placeholder={tr('newpassNew')} icon={<IconLock />} />
      <InputField id="np-2" type="password" placeholder={tr('newpassRepeat')} icon={<IconLock />} onEnter={handle} />
      <GradientBtn onClick={handle} loading={loading}>{loading ? tr('newpassLoading') : tr('newpassBtn')}</GradientBtn>
      <MsgBox {...msg} />
    </>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const [tab, setTab] = useState<Tab>('login')
  const navigate = useNavigate()
  const redirected = useRef(false)
  const { tr } = useLanguage()

  function redirect(route: string) {
    if (redirected.current) return
    redirected.current = true
    navigate(route, { replace: true })
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem('nstore-auth-token')
      if (raw) {
        const parsed = JSON.parse(raw)
        const s = parsed?.currentSession || parsed
        if (s?.access_token && s?.user && (!s.expires_at || s.expires_at > Date.now() / 1000 + 10)) {
          fetchRoleRoute(s.user.id).then(redirect)
          return
        }
      }
    } catch {}

    if (window.location.hash.includes('type=recovery') || window.location.hash.includes('type%3Drecovery')) {
      window.history.replaceState({}, '', window.location.pathname)
      setTab('newpass')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const TITLES: Partial<Record<Tab, string>> = {
    login:    tr('loginTitle'),
    register: tr('registerTitle'),
    forgot:   tr('forgotTitle'),
    sent:     '',
    newpass:  tr('newpassTitle'),
  }

  const title = TITLES[tab]

  const t = (k: string) => tr(k as Parameters<typeof tr>[0])

  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#EEF1F0',
      padding: 20, fontFamily: "'Onest', system-ui, sans-serif",
    }}>
      {/* Lang switcher top-right */}
      <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 10 }}>
        <LangSwitch />
      </div>

      {/* Card */}
      <div style={{
        background: '#fff', borderRadius: 20, padding: '36px 32px 32px',
        width: '100%', maxWidth: 380,
        boxShadow: '0 8px 40px rgba(16,40,28,.14)',
        border: '1px solid #EDF1EF',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14, margin: '0 auto 12px',
            background: 'linear-gradient(135deg,#10A35B,#7C3AED)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 800, fontSize: 22,
            fontFamily: 'var(--font-display)',
          }}>N</div>
          <div style={{
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16,
            color: '#12201A', letterSpacing: '.02em',
          }}>nstore</div>
          <div style={{ fontSize: 10, color: '#8A968E', letterSpacing: 1, marginTop: 2 }}>B2B PLATFORM</div>
        </div>

        {/* Title */}
        {title && (
          <div style={{ fontSize: 20, fontWeight: 700, color: '#12201A', marginBottom: 20, textAlign: 'center' }}>
            {title}
          </div>
        )}

        {/* Forms */}
        {tab === 'login'    && <LoginForm    onRedirect={redirect} onForgot={() => setTab('forgot')} onRegister={() => setTab('register')} tr={t} />}
        {tab === 'register' && <RegisterForm onLogin={() => setTab('login')} tr={t} />}
        {tab === 'forgot'   && <ForgotForm   onSent={() => setTab('sent')} onBack={() => setTab('login')} tr={t} />}
        {tab === 'sent'     && <SentScreen   onBack={() => setTab('login')} tr={t} />}
        {tab === 'newpass'  && <NewPassForm  onRedirect={redirect} tr={t} />}

        {/* Back to site */}
        <div style={{ textAlign: 'center', marginTop: 24, paddingTop: 20, borderTop: '1px solid #EDF1EF' }}>
          <a href="/" style={{ fontSize: 12, color: '#8A968E', textDecoration: 'none' }}>
            {tr('loginBackSite')}
          </a>
        </div>
      </div>
    </div>
  )
}
