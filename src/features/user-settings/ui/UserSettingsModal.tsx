'use client'

import { useLanguage } from '@/shared/i18n/LanguageContext'
import type { Lang } from '@/shared/i18n/translations'
import { supabase } from '@/shared/lib/supabase'
import { Button,Field,Input } from '@/shared/ui/ui'
import { useEffect,useState } from 'react'
import { createPortal } from 'react-dom'

/* Единая панель настроек пользователя: язык, профиль (имя/email/телефон/пароль), тема, выход */

const LANGS: { lang: Lang; short: string; label: string }[] = [
  { lang: 'kz', short: 'ҚАЗ', label: 'Қазақша' },
  { lang: 'ru', short: 'РУ', label: 'Русский' },
]

function applyTheme(t: 'light' | 'dark') {
  document.documentElement.classList.toggle('dark', t === 'dark')
  try { localStorage.setItem('crm_theme', t) } catch { /* ignore */ }
}
function readTheme(): 'light' | 'dark' {
  try { return localStorage.getItem('crm_theme') === 'dark' ? 'dark' : 'light' } catch { return 'light' }
}

export default function UserSettingsModal({ onClose }: { onClose: () => void }) {
  const { lang, setLang } = useLanguage()
  const [theme, setTheme] = useState<'light' | 'dark'>(readTheme)

  const [uid, setUid] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [initialEmail, setInitialEmail] = useState('')
  const [pass, setPass] = useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    let active = true
    ;(async () => {
      // getSession() читает сессию из локального хранилища мгновенно (без запроса
      // к серверу auth, в отличие от getUser) — модалка открывается сразу.
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!active || !user) { setLoading(false); return }
      setUid(user.id)
      setEmail(user.email ?? '')
      setInitialEmail(user.email ?? '')
      const { data: p } = await supabase.from('profiles').select('name, phone').eq('id', user.id).maybeSingle()
      if (!active) return
      setName(p?.name ?? '')
      setPhone(p?.phone ?? '')
      setLoading(false)
    })()
    return () => { active = false }
  }, [])

  async function save() {
    if (!uid) return
    setSaving(true); setErr(''); setMsg('')
    try {
      const { error: pe } = await supabase.from('profiles').update({ name: name.trim() || null, phone: phone.trim() || null }).eq('id', uid)
      if (pe) throw pe
      const notes: string[] = ['Профиль сохранён']
      if (email.trim() && email.trim() !== initialEmail) {
        const { error: ee } = await supabase.auth.updateUser({ email: email.trim() })
        if (ee) throw ee
        notes.push('подтвердите новый email по ссылке в письме')
      }
      if (pass) {
        if (pass.length < 6) throw new Error('Пароль минимум 6 символов')
        const { error: pwe } = await supabase.auth.updateUser({ password: pass })
        if (pwe) throw pwe
        notes.push('пароль обновлён')
        setPass('')
      }
      setMsg(notes.join(' · '))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function toggleTheme() {
    const t = theme === 'dark' ? 'light' : 'dark'
    setTheme(t); applyTheme(t)
  }

  async function logout() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const inp: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--bd)', fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', color: 'var(--t)', background: 'var(--bg2)' }
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--t3)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.04em' }

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--bg2)', borderRadius: 20, width: '100%', maxWidth: 460, maxHeight: '92dvh', overflowY: 'auto', boxShadow: '0 30px 80px rgba(0,0,0,.35)', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, color: 'var(--t)' }}>Настройки</div>
          <button onClick={onClose} style={{ background: 'var(--bg3)', border: 'none', borderRadius: 10, width: 34, height: 34, fontSize: 18, cursor: 'pointer', color: 'var(--t2)' }}>×</button>
        </div>

        {loading ? (
          <div style={{ padding: '30px 0', textAlign: 'center', color: 'var(--t3)', fontSize: 14 }}>Загрузка…</div>
        ) : (
          <div style={{ display: 'grid', gap: 16 }}>
            {/* Язык */}
            <div>
              <div style={lbl}>Язык интерфейса</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {LANGS.map(o => (
                  <button key={o.lang} onClick={() => setLang(o.lang)}
                    style={{ flex: 1, padding: '10px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
                      border: `2px solid ${lang === o.lang ? 'var(--primary)' : 'var(--bd)'}`,
                      background: lang === o.lang ? 'var(--primary)' : 'var(--bg3)', color: lang === o.lang ? '#fff' : 'var(--t2)' }}>
                    {o.short} · {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Профиль */}
            <Field label="Имя"><Input style={inp} value={name} onChange={e => setName(e.target.value)} /></Field>
            <Field label="Email"><Input style={inp} type="email" value={email} onChange={e => setEmail(e.target.value)} /></Field>
            <Field label="Телефон"><Input style={inp} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+7 ___ ___ __ __" /></Field>
            <Field label="Новый пароль"><Input style={inp} type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="оставьте пустым, чтобы не менять" /></Field>

            {msg && <div style={{ background: '#E6F6EE', color: '#0E7C46', borderRadius: 10, padding: '9px 12px', fontSize: 12, fontWeight: 600 }}>{msg}</div>}
            {err && <div style={{ background: '#FEF2F2', color: '#DC2626', borderRadius: 10, padding: '9px 12px', fontSize: 12, fontWeight: 600 }}>{err}</div>}

            <Button onClick={save} full loading={saving}>
              {saving ? 'Сохранение…' : 'Сохранить'}
            </Button>

            {/* Тема + выход */}
            <div style={{ display: 'flex', gap: 8, borderTop: '1px solid var(--bd)', paddingTop: 16 }}>
              <Button variant="secondary" full onClick={toggleTheme}>
                {theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
              </Button>
              <button onClick={logout}
                style={{ flex: 1, padding: '12px', borderRadius: 12, border: 'none', background: 'rgba(220,38,38,.12)', color: '#DC2626', fontFamily: 'inherit', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                Выйти
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
