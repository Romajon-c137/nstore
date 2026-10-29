'use client'

import { supabase } from '@/shared/lib/supabase'
import { Button,Input } from '@/shared/ui/ui'
import type { Manager } from '@/views/crm/board/shared'
import { PRIORITY,uploadImage } from '@/views/crm/board/shared'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { createPortal } from 'react-dom'

/* ───────────────────────────── Create Card Modal ───────────────────────────── */

export default function CreateModal({ type, defaultStatus, onClose, onCreated }: {
  type: 'order' | 'task' | 'regulation'
  defaultStatus?: string
  onClose: () => void
  onCreated: () => void
}) {
  const [form, setForm] = useState({
    title: '', client_name: '', client_phone: '', address: '',
    total: '', note: '', description: '', priority: 'mid', due_date: '', company_id: '', assignee_id: '', image_url: '',
  })
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setErr('')
    try { const url = await uploadImage(file); setForm(p => ({ ...p, image_url: url })) }
    catch (e2) { setErr('Не удалось загрузить фото: ' + (e2 as Error).message) }
    finally { setUploading(false); e.target.value = '' }
  }

  const { data: companies = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['companies-list'],
    queryFn: async () => {
      const { data } = await supabase.from('companies').select('id, name').order('name')
      return data ?? []
    },
    staleTime: 60_000,
  })

  const { data: managers = [] } = useQuery<Manager[]>({
    queryKey: ['managers-list'],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, name, email, role')
        .in('role', ['admin', 'manager', 'logist'])
        .order('name')
      return data ?? []
    },
    staleTime: 120_000,
  })

  const isOrder = type === 'order'
  const regulation = type === 'regulation'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const name = isOrder ? form.client_name : form.title
    if (!name.trim()) { setErr('Заполните обязательное поле'); return }
    setSaving(true)
    const payload: Record<string, unknown> = isOrder ? {
      task_type: 'order',
      order_status: defaultStatus ?? 'new',
      title: form.client_name,
      client_name: form.client_name || null,
      client_phone: form.client_phone || null,
      address: form.address || null,
      total: form.total ? parseInt(form.total) : null,
      note: form.note || null,
      description: form.description.slice(0, 500) || null,
      priority: form.priority,
      company_id: form.company_id || null,
      assignee_id: form.assignee_id || null,
      image_url: form.image_url || null,
    } : {
      task_type: 'task',
      title: form.title,
      note: form.note || null,
      description: form.description.slice(0, 500) || null,
      priority: form.priority,
      due_date: form.due_date || null,
      is_done: false,
      order_status: defaultStatus ?? 'todo',
      company_id: form.company_id || null,
      assignee_id: form.assignee_id || null,
      image_url: form.image_url || null,
      tags: regulation ? ['regulation'] : null,
    }
    const { error } = await supabase.from('crm_tasks').insert(payload)
    setSaving(false)
    if (error) { setErr(error.message); return }
    onCreated()
    onClose()
  }

  const field = (label: string, key: keyof typeof form, opts?: { type?: string; placeholder?: string; required?: boolean }) => (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {label}{opts?.required && ' *'}
      </div>
      <Input
        type={opts?.type ?? 'text'}
        placeholder={opts?.placeholder ?? ''}
        value={form[key]}
        onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
      />
    </div>
  )

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: 'var(--bg2)', borderRadius: 20, width: '100%', maxWidth: 460, padding: 28, boxShadow: '0 24px 80px rgba(0,0,0,.3)', maxHeight: '90dvh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--t)' }}>
            {isOrder ? '+ Новая заявка' : regulation ? '+ Новый регламент' : '+ Новая задача'}
          </div>
          <button onClick={onClose} style={{ background: 'var(--bg3)', border: 'none', borderRadius: 10, width: 34, height: 34, fontSize: 18, cursor: 'pointer', color: 'var(--t2)' }}>×</button>
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          {isOrder ? (
            <>
              {field('Клиент', 'client_name', { required: true, placeholder: 'Имя клиента' })}
              {field('Телефон', 'client_phone', { type: 'tel', placeholder: '+7 (___) ___-__-__' })}
              {field('Адрес', 'address', { placeholder: 'Адрес доставки' })}
              {field('Сумма (₸)', 'total', { type: 'number', placeholder: '0' })}
            </>
          ) : (
            <>
              {field('Название задачи', 'title', { required: true, placeholder: 'Что нужно сделать?' })}
              {field('Дедлайн', 'due_date', { type: 'date' })}
            </>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.04em' }}>Компания</div>
              <select
                value={form.company_id}
                onChange={e => setForm(p => ({ ...p, company_id: e.target.value }))}
                style={{ width: '100%', padding: '9px 13px', borderRadius: 10, border: '1.5px solid var(--bd)', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', color: form.company_id ? 'var(--t)' : 'var(--t3)', background: 'var(--bg2)', cursor: 'pointer' }}
                onFocus={e => (e.target.style.borderColor = 'var(--primary)')}
                onBlur={e => (e.target.style.borderColor = 'var(--bd)')}
              >
                <option value="">— без компании —</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.04em' }}>Менеджер</div>
              <select
                value={form.assignee_id}
                onChange={e => setForm(p => ({ ...p, assignee_id: e.target.value }))}
                style={{ width: '100%', padding: '9px 13px', borderRadius: 10, border: '1.5px solid var(--bd)', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', color: form.assignee_id ? 'var(--t)' : 'var(--t3)', background: 'var(--bg2)', cursor: 'pointer' }}
                onFocus={e => (e.target.style.borderColor = 'var(--primary)')}
                onBlur={e => (e.target.style.borderColor = 'var(--bd)')}
              >
                <option value="">— не назначен —</option>
                {managers.map(m => <option key={m.id} value={m.id}>{m.name ?? m.email}</option>)}
              </select>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', marginBottom: 7, textTransform: 'uppercase', letterSpacing: '.04em' }}>Приоритет</div>
            <div style={{ display: 'flex', gap: 7 }}>
              {Object.entries(PRIORITY).map(([key, p]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, priority: key }))}
                  style={{
                    flex: 1, padding: '7px 6px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                    border: `2px solid ${form.priority === key ? p.color : 'transparent'}`,
                    background: form.priority === key ? p.color + '22' : 'var(--bg3)',
                    color: form.priority === key ? p.color : 'var(--t3)',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.04em' }}>
              Описание <span style={{ color: 'var(--t3)', fontWeight: 600 }}>({form.description.length}/500)</span>
            </div>
            <textarea
              placeholder="Подробная информация (до 500 символов)..."
              value={form.description}
              maxLength={500}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              rows={3}
              style={{ width: '100%', padding: '9px 13px', borderRadius: 10, border: '1.5px solid var(--bd)', fontSize: 13, fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box', color: 'var(--t)', lineHeight: 1.5 }}
              onFocus={e => (e.target.style.borderColor = 'var(--primary)')}
              onBlur={e => (e.target.style.borderColor = 'var(--bd)')}
            />
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.04em' }}>Фото</div>
            {form.image_url && (
              <div style={{ position: 'relative', marginBottom: 8, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--bd)' }}>
                <img src={form.image_url} alt="" style={{ width: '100%', maxHeight: 160, objectFit: 'cover', display: 'block' }} />
                <button type="button" onClick={() => setForm(p => ({ ...p, image_url: '' }))} style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,.6)', color: '#fff', border: 'none', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 16 }}>×</button>
              </div>
            )}
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 10, border: '1.5px dashed var(--bd)', background: 'var(--bg3)', color: 'var(--t2)', fontSize: 13, fontWeight: 600, cursor: uploading ? 'wait' : 'pointer' }}>
              {uploading ? 'Загрузка…' : (form.image_url ? 'Заменить фото' : 'Прикрепить фото')}
              <input type="file" accept="image/*" onChange={onPickFile} disabled={uploading} style={{ display: 'none' }} />
            </label>
          </div>

          {err && <div style={{ fontSize: 12, color: '#DC2626', fontWeight: 600 }}>{err}</div>}

          <Button type="submit" full loading={saving} disabled={uploading} style={{ marginTop: 2 }}>
            {saving ? 'Создание...' : isOrder ? 'Создать заявку' : regulation ? 'Создать регламент' : 'Создать задачу'}
          </Button>
        </form>
      </div>
    </div>,
    document.body,
  )
}
