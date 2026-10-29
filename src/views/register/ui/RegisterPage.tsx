'use client'

import { supabase } from '@/shared/lib/supabase';
import { Button } from '@/shared/ui/ui';
import { useEffect,useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormData {
  name: string; phone: string; email: string; password: string; passwordConfirm: string
  companyName: string; legalName: string; marketSegment: string; companyPhone: string; companyAddress: string
  locationName: string; locationAddress: string; locationPhone: string
}

interface InviteData {
  id: string; location_id: string; owner_id: string; expires_at: string
  locations: { name: string; company_id: string | null } | null
}

const INIT: FormData = {
  name: '', phone: '', email: '', password: '', passwordConfirm: '',
  companyName: '', legalName: '', marketSegment: '', companyPhone: '', companyAddress: '',
  locationName: '', locationAddress: '', locationPhone: '',
}

const SEGMENTS = [
  { value: 'horeca',    label: 'HoReCa (рестораны, кафе, отели)' },
  { value: 'shop',      label: 'Розничный магазин' },
  { value: 'wholesale', label: 'Оптовая торговля' },
  { value: 'office',    label: 'Офисные поставки' },
  { value: 'pharmacy',  label: 'Аптека / фармацевтика' },
]

const STEP_LABELS = ['Контакт', 'Компания', 'Точка доставки']

// ─── Sub-components ───────────────────────────────────────────────────────────

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374B3E', marginBottom: 6 }}>
        {label}{required && <span style={{ color: '#DC2626', marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '11px 14px', borderRadius: 10,
  border: '1.5px solid #E2E8E4', background: '#F8FAF9',
  fontSize: 14, color: '#0E1E16', outline: 'none',
  boxSizing: 'border-box', fontFamily: 'inherit', transition: 'border-color .15s',
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input {...props} style={{ ...inputStyle, ...props.style }}
      onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
      onBlur={e => (e.currentTarget.style.borderColor = '#E2E8E4')} />
  )
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} style={{ ...inputStyle, appearance: 'none', cursor: 'pointer', ...props.style }}
      onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
      onBlur={e => (e.currentTarget.style.borderColor = '#E2E8E4')} />
  )
}

function StepIndicator({ current, total }: { current: number; total: number }) {
  const labels = STEP_LABELS.slice(0, total)
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 32 }}>
      {labels.map((label, i) => {
        const n = i + 1; const done = n < current; const active = n === current
        return (
          <div key={n} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, background: done || active ? 'var(--primary)' : '#EDF1EF', color: done || active ? '#fff' : '#8A968E', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, boxShadow: active ? '0 0 0 4px rgba(16,163,91,.15)' : 'none', transition: 'all .2s' }}>
                {done ? '✓' : n}
              </div>
              <span style={{ fontSize: 11, fontWeight: active ? 700 : 400, color: active ? 'var(--primary)' : done ? '#5C6B63' : '#A6B0A9', whiteSpace: 'nowrap' }}>{label}</span>
            </div>
            {i < labels.length - 1 && (
              <div style={{ width: 56, height: 2, background: done ? 'var(--primary)' : '#EDF1EF', margin: '0 6px', marginBottom: 20, transition: 'background .2s' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RegisterPage() {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<FormData>(INIT)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Invite flow
  const [inviteToken, setInviteToken] = useState<string | null>(null)
  const [inviteData, setInviteData] = useState<InviteData | null>(null)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState('')

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('invite')
    if (!token) return
    setInviteToken(token)
    setInviteLoading(true)
    supabase.from('invites')
      .select('id, location_id, owner_id, expires_at, locations(name, company_id)')
      .eq('token', token)
      .eq('used', false)
      .single()
      .then(({ data, error: err }) => {
        setInviteLoading(false)
        if (err || !data) return setInviteError('Ссылка недействительна или уже использована')
        if (new Date((data as any).expires_at) < new Date()) return setInviteError('Срок действия ссылки истёк (7 дней)')
        setInviteData(data as any)
      })
  }, [])

  const isInvite = !!inviteToken
  const totalSteps = isInvite ? 1 : 3
  const successStep = totalSteps + 1

  function set(key: keyof FormData) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setForm(prev => ({ ...prev, [key]: e.target.value })); setError('')
    }
  }

  function validate(): string {
    if (step === 1) {
      if (!form.name.trim()) return 'Введите ваше имя'
      if (!form.phone.trim()) return 'Введите номер телефона'
      if (!form.email.trim()) return 'Введите email'
      if (!/\S+@\S+\.\S+/.test(form.email)) return 'Некорректный email'
      if (form.password.length < 6) return 'Пароль должен быть не менее 6 символов'
      if (form.password !== form.passwordConfirm) return 'Пароли не совпадают'
    }
    if (!isInvite) {
      if (step === 2) {
        if (!form.companyName.trim()) return 'Введите название компании'
        if (!form.marketSegment) return 'Выберите тип бизнеса'
        if (!form.companyAddress.trim()) return 'Введите адрес компании'
      }
      if (step === 3) {
        if (!form.locationName.trim()) return 'Введите название точки'
        if (!form.locationAddress.trim()) return 'Введите адрес доставки'
      }
    }
    return ''
  }

  async function handleNext() {
    const err = validate()
    if (err) { setError(err); return }

    if (step < totalSteps) { setStep(s => s + 1); return }

    setLoading(true); setError('')
    try {
      // 1. Create auth user
      const { data: auth, error: authErr } = await supabase.auth.signUp({
        email: form.email.trim(), password: form.password,
      })
      if (authErr) throw authErr
      const uid = auth.user?.id
      if (!uid) throw new Error('Не удалось создать аккаунт')

      if (isInvite && inviteData) {
        // ── Invite flow ──
        const companyId = (inviteData.locations as any)?.company_id ?? null

        const { error: profileErr } = await supabase.from('profiles').upsert({
          id: uid, name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(),
          company_id: companyId, location_id: inviteData.location_id,
          relation_status: 'active', role: 'client',
        })
        if (profileErr) throw profileErr

        // Mark invite as used
        await supabase.from('invites').update({ used: true }).eq('id', inviteData.id)

      } else {
        // ── Normal flow ──
        const { data: co, error: coErr } = await supabase.from('companies').insert({
          name: form.companyName.trim(), legal_name: form.legalName.trim() || null,
          market_segment: form.marketSegment,
          phone: form.companyPhone.trim() || form.phone.trim(),
          email: form.email.trim(), address: form.companyAddress.trim(), created_by: uid,
        }).select('id').single()
        if (coErr) throw coErr

        const { error: profileErr } = await supabase.from('profiles').upsert({
          id: uid, name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(),
          company: form.companyName.trim(), company_id: co.id, market_segment: form.marketSegment,
          relation_status: 'cold', role: 'client',
        })
        if (profileErr) throw profileErr

        const { error: locErr } = await supabase.from('locations').insert({
          owner_id: uid, company_id: co.id,
          name: form.locationName.trim(), address: form.locationAddress.trim(),
          phone: form.locationPhone.trim() || null,
        })
        if (locErr) throw locErr
      }

      await supabase.auth.signOut()
      setStep(successStep)

    } catch (e: any) {
      const msg = e.message ?? ''
      if (msg.includes('already registered') || msg.includes('already been registered')) {
        setError('Этот email уже зарегистрирован. Попробуйте войти или используйте другой email.')
      } else {
        setError(msg || 'Произошла ошибка. Попробуйте ещё раз.')
      }
    } finally {
      setLoading(false)
    }
  }

  const locationName = (inviteData?.locations as any)?.name ?? null

  return (
    <div style={{ minHeight: '100dvh', background: '#EEF1F0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', fontFamily: "'Onest', system-ui, sans-serif" }}>

      {/* Logo */}
      <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28, textDecoration: 'none' }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#10A35B,#7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18 }}>N</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: '#0E1E16' }}>nstore<span style={{ color: 'var(--primary)' }}>·B2B</span></div>
      </a>

      {/* Card */}
      <div style={{ width: '100%', maxWidth: 520, background: '#fff', borderRadius: 20, border: '1px solid #EDF1EF', padding: '36px 40px', boxShadow: '0 4px 24px rgba(0,0,0,.06)' }}>

        {/* Loading invite */}
        {inviteLoading && (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#8A968E' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔗</div>
            <div>Проверяем ссылку-приглашение...</div>
          </div>
        )}

        {/* Invalid invite */}
        {!inviteLoading && inviteToken && inviteError && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>❌</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0E1E16', marginBottom: 8 }}>Ссылка недействительна</div>
            <div style={{ fontSize: 13, color: '#8A968E', marginBottom: 24 }}>{inviteError}</div>
            <a href="/register" style={{ color: 'var(--primary)', fontWeight: 600, fontSize: 14 }}>Зарегистрироваться без приглашения →</a>
          </div>
        )}

        {/* Main form */}
        {!inviteLoading && (!inviteToken || (!inviteError && inviteData)) && step <= totalSteps && (
          <>
            {/* Header */}
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, color: '#0E1E16', marginBottom: 6 }}>
                {isInvite ? 'Регистрация по приглашению' : 'Регистрация'}
              </div>
              {isInvite && locationName ? (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, background: '#EAF6EE', fontSize: 13, color: 'var(--primary)', fontWeight: 600, marginTop: 4 }}>
                  📍 Точка: {locationName}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: '#7A877F' }}>Оптовый кабинет для вашего бизнеса</div>
              )}
            </div>

            <StepIndicator current={step} total={totalSteps} />

            {error && (
              <div style={{ marginBottom: 18, padding: '11px 14px', borderRadius: 10, background: '#FFF0F0', border: '1px solid #FFCDD2', color: '#C62828', fontSize: 13 }}>{error}</div>
            )}

            {/* Step 1 — Контакт */}
            {step === 1 && (
              <>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0E1E16', marginBottom: 18 }}>Ваши контактные данные</div>
                <Field label="Имя и фамилия" required><Input placeholder="Иван Иванов" value={form.name} onChange={set('name')} /></Field>
                <Field label="Телефон" required><Input placeholder="+7 700 000 0000" value={form.phone} onChange={set('phone')} type="tel" /></Field>
                <Field label="Email" required><Input placeholder="ivan@company.kz" value={form.email} onChange={set('email')} type="email" autoComplete="email" /></Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Field label="Пароль" required><Input placeholder="Минимум 6 символов" value={form.password} onChange={set('password')} type="password" autoComplete="new-password" /></Field>
                  <Field label="Повторите пароль" required><Input placeholder="Повторите пароль" value={form.passwordConfirm} onChange={set('passwordConfirm')} type="password" autoComplete="new-password" /></Field>
                </div>
                {isInvite && (
                  <div style={{ padding: '12px 14px', borderRadius: 10, background: '#EAF6EE', border: '1px solid #A5D4B8', fontSize: 12, color: 'var(--primary)', marginTop: 4 }}>
                    ✓ После регистрации вы автоматически получите доступ к кабинету и будете привязаны к точке {locationName ? `"${locationName}"` : ''}.
                  </div>
                )}
              </>
            )}

            {/* Step 2 — Компания (only for normal flow) */}
            {!isInvite && step === 2 && (
              <>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0E1E16', marginBottom: 18 }}>Данные о компании</div>
                <Field label="Название компании" required><Input placeholder="ТОО «Моя Компания»" value={form.companyName} onChange={set('companyName')} /></Field>
                <Field label="Юридическое название"><Input placeholder="Необязательно, если совпадает" value={form.legalName} onChange={set('legalName')} /></Field>
                <Field label="Тип бизнеса" required>
                  <div style={{ position: 'relative' }}>
                    <Select value={form.marketSegment} onChange={set('marketSegment')}>
                      <option value="">Выберите тип бизнеса...</option>
                      {SEGMENTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </Select>
                    <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: '#8A968E', fontSize: 12 }}>▼</span>
                  </div>
                </Field>
                <Field label="Телефон компании"><Input placeholder="+7 700 000 0000" value={form.companyPhone} onChange={set('companyPhone')} type="tel" /></Field>
                <Field label="Юридический / фактический адрес" required><Input placeholder="г. Астана, ул. Примерная, 1" value={form.companyAddress} onChange={set('companyAddress')} /></Field>
              </>
            )}

            {/* Step 3 — Точка (only for normal flow) */}
            {!isInvite && step === 3 && (
              <>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0E1E16', marginBottom: 6 }}>Первая точка доставки</div>
                <div style={{ fontSize: 13, color: '#7A877F', marginBottom: 20 }}>Укажите адрес куда будет доставляться заказ. Дополнительные точки можно добавить позже.</div>
                <Field label="Название точки" required><Input placeholder="Магазин на Абая, Склад №1" value={form.locationName} onChange={set('locationName')} /></Field>
                <Field label="Адрес доставки" required><Input placeholder="г. Астана, ул. Абая, 10" value={form.locationAddress} onChange={set('locationAddress')} /></Field>
                <Field label="Контактный телефон точки"><Input placeholder="+7 700 000 0000" value={form.locationPhone} onChange={set('locationPhone')} type="tel" /></Field>
                <div style={{ padding: '12px 14px', borderRadius: 10, background: '#F4EEFE', border: '1px solid #E8DBFD', fontSize: 12, color: '#6B30D0', marginTop: 4 }}>
                  📋 После отправки заявки менеджер свяжется с вами для заключения договора. Доступ откроется после подтверждения.
                </div>
              </>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
              {step > 1 && (
                <Button variant="secondary" size="form" font="inherit" onClick={() => { setStep(s => s - 1); setError('') }}
                  style={{ flex: 1, fontWeight: 600, background: '#fff', border: '1.5px solid #E2E8E4', color: '#5C6B63' }}>← Назад</Button>
              )}
              <Button size="form" font="inherit" loading={loading} onClick={handleNext} style={{ flex: step > 1 ? 2 : 1 }}>
                {loading ? 'Отправляем...' : step < totalSteps ? 'Далее →' : isInvite ? 'Зарегистрироваться ✓' : 'Отправить заявку ✓'}
              </Button>
            </div>

            <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: '#8A968E' }}>
              Уже есть аккаунт?{' '}
              <a href="/login" style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}>Войти</a>
            </div>
          </>
        )}

        {/* Success screen */}
        {step === successStep && (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'linear-gradient(135deg,#10A35B,#2DAE6B)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', fontSize: 32, color: '#fff' }}>✓</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, color: '#0E1E16', marginBottom: 10 }}>
              {isInvite ? 'Добро пожаловать!' : 'Заявка отправлена!'}
            </div>
            <div style={{ fontSize: 14, color: '#5C6B63', lineHeight: 1.6, marginBottom: 28 }}>
              {isInvite
                ? `Вы успешно зарегистрированы и привязаны к точке${locationName ? ` "${locationName}"` : ''}. Войдите в кабинет чтобы начать работу.`
                : 'Мы получили вашу заявку. Менеджер свяжется с вами в течение 1–2 рабочих дней.'}
            </div>

            {isInvite ? (
              <a href="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '13px 24px', borderRadius: 12, background: 'var(--primary)', color: '#fff', fontWeight: 700, fontSize: 14, textDecoration: 'none', marginBottom: 12 }}>
                Войти в кабинет →
              </a>
            ) : (
              <a href={`https://wa.me/77005220006?text=${encodeURIComponent(`Здравствуйте! Я только что отправил заявку на регистрацию. Компания: ${form.companyName}, контакт: ${form.name}, тел: ${form.phone}`)}`}
                target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '13px 24px', borderRadius: 12, background: '#25D36615', color: '#128C7E', fontWeight: 700, fontSize: 14, textDecoration: 'none', border: '1.5px solid #25D36630', marginBottom: 12 }}>
                💬 Написать менеджеру в WhatsApp
              </a>
            )}

            <div style={{ marginTop: 8 }}>
              <a href="/" style={{ fontSize: 13, color: '#8A968E', textDecoration: 'none' }}>← Вернуться на главную</a>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 20, fontSize: 12, color: '#A6B0A9' }}>© 2026 Jibek Joly Co · nstore B2B</div>
    </div>
  )
}
