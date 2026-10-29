'use client'

import { FORM_INPUT_STYLE,SEGMENT_LABELS } from '@/entities/content'
import { supabase } from '@/shared/lib/supabase'
import { Button } from '@/shared/ui/ui'
import { useState,type FormEvent } from 'react'

export default function FormBlock({ p }: { p: Record<string, unknown> }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [segment, setSegment] = useState('')
  const [comment, setComment] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const showEmail = (p.showEmail as boolean) ?? false
  const showCompany = (p.showCompany as boolean) ?? true
  const showSegment = (p.showSegment as boolean) ?? true
  const showComment = (p.showComment as boolean) ?? true

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!name.trim() || !phone.trim()) return
    setStatus('submitting')
    setErrorMsg('')

    const notesParts: string[] = []
    if (company.trim()) notesParts.push(`Компания: ${company.trim()}`)
    if (segment) notesParts.push(`Сегмент: ${SEGMENT_LABELS[segment] ?? segment}`)
    if (comment.trim()) notesParts.push(`Комментарий: ${comment.trim()}`)
    notesParts.push('Источник: заявка с лендинга')

    const { error } = await supabase.from('contacts').insert({
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim() || null,
      company_id: null,
      notes: notesParts.join('. '),
      relation_status: 'potential',
    })

    if (error) { setStatus('error'); setErrorMsg(error.message); return }

    const { error: leadError } = await supabase.from('crm_tasks').insert({
      task_type: 'lead',
      order_status: 'new',
      client_name: name.trim(),
      client_phone: phone.trim(),
      title: `B2B заявка: ${name.trim()}${company.trim() ? ` (${company.trim()})` : ''}`,
      description: notesParts.join('. '),
      is_active: true,
    })
    if (leadError) console.error('[FormBlock] crm_tasks lead insert failed:', leadError.message)

    setStatus('success')
  }

  if (status === 'success') {
    return (
      <div className="lp-section-pad">
        <div style={{ background: '#EAF6EE', border: '1px solid #CDEBD9', borderRadius: 20, padding: '28px 32px', maxWidth: 520, textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>✓</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, color: '#0E7C46', marginBottom: 6 }}>Заявка отправлена</div>
          <div style={{ fontSize: 13, color: '#5C6B63' }}>Менеджер свяжется с вами в ближайшее время</div>
        </div>
      </div>
    )
  }

  return (
    <div className="lp-section-pad">
      <form onSubmit={handleSubmit} style={{ background: '#F9FAFB', border: '1px solid #EDF1EF', borderRadius: 20, padding: '28px 32px', maxWidth: 520 }}>
        {!!p.title && <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 20, marginBottom: 4 }}>{p.title as string}</div>}
        <div style={{ fontSize: 13, color: '#8A968E', marginBottom: 18 }}>Оставьте заявку — подключим к оптовым ценам и персональному менеджеру</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input required maxLength={200} value={name} onChange={e => setName(e.target.value)} placeholder="Ваше имя *" style={FORM_INPUT_STYLE} />
          <input required maxLength={30} value={phone} onChange={e => setPhone(e.target.value)} placeholder="Телефон *" style={FORM_INPUT_STYLE} />
          {showEmail && <input maxLength={200} value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="Email" style={FORM_INPUT_STYLE} />}
          {showCompany && <input maxLength={200} value={company} onChange={e => setCompany(e.target.value)} placeholder="Название компании" style={FORM_INPUT_STYLE} />}
          {showSegment && (
            <select value={segment} onChange={e => setSegment(e.target.value)} style={FORM_INPUT_STYLE}>
              <option value="">Сфера деятельности</option>
              {Object.entries(SEGMENT_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          )}
          {showComment && (
            <textarea maxLength={1000} value={comment} onChange={e => setComment(e.target.value)} placeholder="Комментарий" rows={3}
              style={{ ...FORM_INPUT_STYLE, height: 'auto', padding: '10px 14px', resize: 'vertical' }} />
          )}

          {status === 'error' && <div style={{ fontSize: 12, color: '#DC2626' }}>Не удалось отправить заявку: {errorMsg}</div>}

          <Button type="submit" size="form" font="inherit" full loading={status === 'submitting'}
            style={{ borderRadius: 11, fontSize: 15 }}>
            {status === 'submitting' ? 'Отправка…' : ((p.btnText as string) || 'Отправить')}
          </Button>
        </div>
      </form>
    </div>
  )
}
