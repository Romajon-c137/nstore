'use client'

import { invalidateOrders } from '@/entities/order'
import { supabase } from '@/shared/lib/supabase'
import { Button } from '@/shared/ui/ui'
import type { ChecklistItem,Manager,Task } from '@/views/crm/board/shared'
import { ORDER_COLS,PRIORITY,addToCalendar,fmtMoney,uploadImage } from '@/views/crm/board/shared'
import { useQuery,useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { createPortal } from 'react-dom'

function uid() { return Math.random().toString(36).slice(2, 9) }

/* ───────────────────────────── Card Detail Modal ───────────────────────────── */

export default function CardModal({ task, onClose, onUpdate, readonly }: {
  task: Task
  onClose: () => void
  onUpdate: () => void
  readonly?: boolean
}) {
  const qc = useQueryClient()
  const isOrder = task.task_type === 'order'
  const archived = task.is_active === false

  const [edit, setEdit] = useState(false)
  const [status, setStatus] = useState(task.order_status ?? 'new')
  const [cash, setCash] = useState(task.cash_received ?? false)
  const [checklist, setChecklist] = useState<ChecklistItem[]>(task.checklist ?? [])
  const [newItemText, setNewItemText] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')

  const [form, setForm] = useState({
    title: task.title ?? '',
    description: task.description ?? '',
    client_name: task.client_name ?? '',
    client_phone: task.client_phone ?? '',
    address: task.address ?? '',
    total: task.total?.toString() ?? '',
    priority: task.priority ?? 'mid',
    due_date: task.due_date ?? '',
    company_id: task.company_id ?? '',
    assignee_id: task.assignee_id ?? '',
    image_url: task.image_url ?? '',
    invoice_no: task.invoice_no ?? '',
  })

  const { data: companies = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['companies-list'],
    queryFn: async () => { const { data } = await supabase.from('companies').select('id, name').order('name'); return data ?? [] },
    staleTime: 60_000, enabled: edit,
  })
  const { data: managers = [] } = useQuery<Manager[]>({
    queryKey: ['managers-list'],
    queryFn: async () => { const { data } = await supabase.from('profiles').select('id, name, email, role').in('role', ['admin', 'manager', 'logist']).order('name'); return data ?? [] },
    staleTime: 120_000, enabled: edit,
  })

  const refresh = () => invalidateOrders(qc)

  async function toggleCash() {
    const v = !cash
    setCash(v)
    const { error } = await supabase.from('crm_tasks').update({ cash_received: v }).eq('id', task.id)
    if (error) { setErr(error.message); setCash(!v); return }
    refresh(); onUpdate()
  }

  async function persistChecklist(next: ChecklistItem[]) {
    const prev = checklist
    setChecklist(next)
    const { error } = await supabase.from('crm_tasks').update({ checklist: next }).eq('id', task.id)
    if (error) { setErr(error.message); setChecklist(prev); return }
    refresh(); onUpdate()
  }
  function addChecklistItem() {
    const text = newItemText.trim()
    if (!text) return
    setNewItemText('')
    persistChecklist([...checklist, { id: uid(), text, done: false }])
  }
  function toggleChecklistItem(id: string) {
    persistChecklist(checklist.map(i => i.id === id ? { ...i, done: !i.done } : i))
  }
  function removeChecklistItem(id: string) {
    persistChecklist(checklist.filter(i => i.id !== id))
  }

  async function confirmDelivery() {
    setSaving(true)
    const { error } = await supabase.from('crm_tasks').update({ order_status: 'done', is_done: true, completed_at: new Date().toISOString() }).eq('id', task.id)
    setSaving(false)
    if (error) { setErr(error.message); return }
    refresh(); onUpdate(); onClose()
  }

  async function returnToDelivery() {
    setSaving(true)
    const { error } = await supabase.from('crm_tasks').update({ order_status: 'delivering', is_done: false, completed_at: null }).eq('id', task.id)
    setSaving(false)
    if (error) { setErr(error.message); return }
    refresh(); onUpdate(); onClose()
  }

  async function saveStatus() {
    setSaving(true)
    const upd: Record<string, unknown> = { order_status: status }
    if (status === 'delivering') upd.delivery_state = 'waiting'
    const { error } = await supabase.from('crm_tasks').update(upd).eq('id', task.id)
    setSaving(false)
    if (error) { setErr(error.message); return }
    refresh(); onUpdate(); onClose()
  }

  async function toggleDone() {
    const done = !task.is_done
    const { error } = await supabase.from('crm_tasks').update({ is_done: done, order_status: done ? 'done' : 'todo', completed_at: done ? new Date().toISOString() : null }).eq('id', task.id)
    if (error) { setErr(error.message); return }
    refresh(); onUpdate(); onClose()
  }

  async function archiveToggle() {
    const { error } = await supabase.from('crm_tasks').update({ is_active: archived ? true : false }).eq('id', task.id)
    if (error) { setErr(error.message); return }
    refresh(); onUpdate(); onClose()
  }

  async function saveEdit() {
    if (!form.title.trim() && !form.client_name.trim()) { setErr('Заполните название'); return }
    setSaving(true); setErr('')
    const payload: Record<string, unknown> = {
      title: (isOrder ? form.client_name : form.title) || task.title,
      description: form.description.slice(0, 500) || null,
      priority: form.priority,
      due_date: form.due_date || null,
      company_id: form.company_id || null,
      assignee_id: form.assignee_id || null,
      image_url: form.image_url || null,
    }
    if (isOrder) {
      payload.client_name = form.client_name || null
      payload.client_phone = form.client_phone || null
      payload.address = form.address || null
      payload.total = form.total ? Math.round(parseFloat(form.total)) : null
      payload.invoice_no = form.invoice_no.trim() || null
    }
    const { error } = await supabase.from('crm_tasks').update(payload).eq('id', task.id)
    setSaving(false)
    if (error) { setErr(error.message); return }
    refresh(); onUpdate(); onClose()
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setErr('')
    try { const url = await uploadImage(file); setForm(p => ({ ...p, image_url: url })) }
    catch (e2) { setErr('Не удалось загрузить фото: ' + (e2 as Error).message) }
    finally { setUploading(false); e.target.value = '' }
  }

  const money = fmtMoney(task.total)
  const inp: React.CSSProperties = { width: '100%', padding: '9px 12px', borderRadius: 10, border: '1.5px solid var(--bd)', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', color: 'var(--t)', background: 'var(--bg2)' }
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: 'var(--t3)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.04em' }

  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: 'var(--bg2)', borderRadius: 20, width: '100%', maxWidth: 520, maxHeight: '90dvh', overflowY: 'auto', boxShadow: '0 32px 80px rgba(0,0,0,.3)', padding: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div style={{ flex: 1, paddingRight: 16 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, color: '#7C3AED', marginBottom: 6 }}>
              {task.invoice_no ? task.invoice_no : `#${task.id.slice(-6).toUpperCase()}`}{archived && <span style={{ color: 'var(--t3)', marginLeft: 8 }}>· в архиве</span>}
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--t)', lineHeight: 1.4 }}>
              {task.client_name ?? task.title}
            </div>
            {money && !edit && (
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, color: 'var(--primary)', marginTop: 6 }}>{money}</div>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'var(--bg3)', border: 'none', borderRadius: 10, width: 36, height: 36, fontSize: 18, cursor: 'pointer', color: 'var(--t2)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {err && <div style={{ background: '#FEF2F2', color: '#DC2626', borderRadius: 10, padding: '8px 12px', fontSize: 12, fontWeight: 600, marginBottom: 14 }}>{err}</div>}

        {edit ? (
          /* ── EDIT MODE ── */
          <div style={{ display: 'grid', gap: 14, marginBottom: 18 }}>
            {isOrder ? (
              <>
                <div><div style={lbl}>Клиент</div><input style={inp} value={form.client_name} onChange={e => setForm(p => ({ ...p, client_name: e.target.value }))} /></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div><div style={lbl}>Телефон</div><input style={inp} value={form.client_phone} onChange={e => setForm(p => ({ ...p, client_phone: e.target.value }))} /></div>
                  <div><div style={lbl}>Сумма ₸</div><input style={inp} type="number" value={form.total} onChange={e => setForm(p => ({ ...p, total: e.target.value }))} /></div>
                </div>
                <div><div style={lbl}>№ накладной (1С)</div><input style={inp} value={form.invoice_no} placeholder="напр. БКНФ-004695" onChange={e => setForm(p => ({ ...p, invoice_no: e.target.value }))} /></div>
                <div><div style={lbl}>Адрес</div><input style={inp} value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} /></div>
              </>
            ) : (
              <div><div style={lbl}>Название</div><input style={inp} value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} /></div>
            )}

            <div>
              <div style={lbl}>Описание <span style={{ color: 'var(--t3)', fontWeight: 600 }}>({form.description.length}/500)</span></div>
              <textarea
                style={{ ...inp, minHeight: 90, resize: 'vertical', lineHeight: 1.5 }}
                maxLength={500}
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                placeholder="Информация по карточке (до 500 символов)..."
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div><div style={lbl}>Дедлайн</div><input style={inp} type="date" value={form.due_date} onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))} /></div>
              <div><div style={lbl}>Приоритет</div>
                <select style={{ ...inp, cursor: 'pointer' }} value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}>
                  <option value="high">Высокий</option><option value="mid">Средний</option><option value="low">Низкий</option>
                </select>
              </div>
            </div>

            <div><div style={lbl}>Ответственный</div>
              <select style={{ ...inp, cursor: 'pointer' }} value={form.assignee_id} onChange={e => setForm(p => ({ ...p, assignee_id: e.target.value }))}>
                <option value="">— не назначен —</option>
                {managers.map(m => <option key={m.id} value={m.id}>{m.name ?? m.email} ({m.role})</option>)}
              </select>
            </div>
            <div><div style={lbl}>Компания</div>
              <select style={{ ...inp, cursor: 'pointer' }} value={form.company_id} onChange={e => setForm(p => ({ ...p, company_id: e.target.value }))}>
                <option value="">— без компании —</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div>
              <div style={lbl}>Фото</div>
              {form.image_url && (
                <div style={{ position: 'relative', marginBottom: 8, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--bd)' }}>
                  <img src={form.image_url} alt="" style={{ width: '100%', maxHeight: 180, objectFit: 'cover', display: 'block' }} />
                  <button onClick={() => setForm(p => ({ ...p, image_url: '' }))} style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,.6)', color: '#fff', border: 'none', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 16 }}>×</button>
                </div>
              )}
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 14px', borderRadius: 10, border: '1.5px dashed var(--bd2)', background: 'var(--bg3)', color: 'var(--t2)', fontSize: 13, fontWeight: 600, cursor: uploading ? 'wait' : 'pointer' }}>
                {uploading ? 'Загрузка…' : (form.image_url ? 'Заменить фото' : 'Прикрепить фото')}
                <input type="file" accept="image/*" onChange={onPickFile} disabled={uploading} style={{ display: 'none' }} />
              </label>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <Button onClick={saveEdit} loading={saving} disabled={uploading} style={{ flex: 1 }}>
                {saving ? 'Сохранение…' : 'Сохранить'}
              </Button>
              <Button variant="secondary" onClick={() => { setEdit(false); setErr('') }} style={{ border: 'none' }}>Отмена</Button>
            </div>
          </div>
        ) : (
          /* ── VIEW MODE ── */
          <>
            {task.image_url && (
              <div style={{ marginBottom: 16, borderRadius: 14, overflow: 'hidden', border: '1px solid var(--bd)' }}>
                <img src={task.image_url} alt="" style={{ width: '100%', maxHeight: 240, objectFit: 'cover', display: 'block' }} />
              </div>
            )}

            {(() => {
              const co = Array.isArray(task.companies) ? task.companies[0] : task.companies
              const assignee = Array.isArray(task.profiles) ? task.profiles[0] : task.profiles
              const assigneeName = assignee?.name ?? assignee?.email ?? null
              const orderCol = task.order_status ? ORDER_COLS.find(c => c.id === task.order_status) : null
              const rows: { label: string; content: React.ReactNode }[] = []
              if (co?.name) rows.push({ label: 'Компания', content: <span style={{ fontWeight: 700, color: '#7C3AED' }}>{co.name}</span> })
              if (orderCol) rows.push({ label: 'Статус', content: <span style={{ background: orderCol.bg, color: orderCol.color, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{orderCol.label}</span> })
              if (assigneeName) rows.push({ label: 'Ответств.', content: <span style={{ fontWeight: 600 }}>{assigneeName}</span> })
              if (task.client_phone) rows.push({ label: 'Телефон', content: <a href={`tel:${task.client_phone}`} style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>{task.client_phone}</a> })
              if (task.address) rows.push({ label: 'Адрес', content: <span>{task.address}</span> })
              if (task.priority) rows.push({ label: 'Приоритет', content: <span style={{ background: PRIORITY[task.priority]?.bg, color: PRIORITY[task.priority]?.color, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{PRIORITY[task.priority]?.label}</span> })
              if (task.due_date) rows.push({ label: 'Дедлайн', content: <span style={{ color: new Date(task.due_date) < new Date() ? '#DC2626' : 'var(--t)', fontWeight: 600 }}>{new Date(task.due_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</span> })
              return rows.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 16, background: 'var(--bg3)', borderRadius: 14, overflow: 'hidden' }}>
                  {rows.map((r, i) => (
                    <div key={r.label} style={{ display: 'flex', gap: 12, padding: '11px 16px', borderBottom: i < rows.length - 1 ? '1px solid var(--bd)' : 'none', fontSize: 13, alignItems: 'center' }}>
                      <span style={{ color: 'var(--t3)', width: 80, flexShrink: 0 }}>{r.label}</span>
                      {r.content}
                    </div>
                  ))}
                </div>
              ) : null
            })()}

            {task.description && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.05em' }}>Описание</div>
                <div style={{ background: 'var(--bg3)', borderRadius: 12, padding: '12px 14px', fontSize: 13, lineHeight: 1.55, color: 'var(--t)', whiteSpace: 'pre-wrap' }}>{task.description}</div>
              </div>
            )}

            {task.items && task.items.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>Состав заказа</div>
                <div style={{ background: 'var(--bg3)', borderRadius: 12, overflow: 'hidden' }}>
                  {task.items.map((it, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: i < task.items!.length - 1 ? '1px solid var(--bd)' : 'none', gap: 10, fontSize: 13 }}>
                      <span style={{ flex: 1, color: 'var(--t)' }}>{it.name}</span>
                      <span style={{ color: 'var(--t3)', minWidth: 50, textAlign: 'right' }}>{it.qty} шт</span>
                      <span style={{ fontWeight: 700, color: 'var(--t)', minWidth: 70, textAlign: 'right' }}>{(it.price * it.qty).toLocaleString('ru')} ₸</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(checklist.length > 0 || !readonly) && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Чек-лист</div>
                  {checklist.length > 0 && (
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)' }}>{checklist.filter(i => i.done).length}/{checklist.length}</div>
                  )}
                </div>
                {checklist.length > 0 && (
                  <div style={{ background: 'var(--bg3)', borderRadius: 12, overflow: 'hidden', marginBottom: readonly ? 0 : 8 }}>
                    {checklist.map((item, i) => (
                      <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: i < checklist.length - 1 ? '1px solid var(--bd)' : 'none' }}>
                        <input type="checkbox" checked={item.done} disabled={readonly} onChange={() => toggleChecklistItem(item.id)}
                          style={{ width: 17, height: 17, accentColor: 'var(--primary)', cursor: readonly ? 'default' : 'pointer', flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: 13, color: item.done ? 'var(--t3)' : 'var(--t)', textDecoration: item.done ? 'line-through' : 'none' }}>{item.text}</span>
                        {!readonly && (
                          <button onClick={() => removeChecklistItem(item.id)} style={{ background: 'none', border: 'none', color: 'var(--t3)', cursor: 'pointer', fontSize: 16, padding: 2, flexShrink: 0 }}>×</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {!readonly && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      value={newItemText}
                      onChange={e => setNewItemText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addChecklistItem() } }}
                      placeholder="Новый пункт..."
                      style={{ flex: 1, padding: '8px 12px', borderRadius: 10, border: '1.5px solid var(--bd)', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', color: 'var(--t)', background: 'var(--bg2)' }}
                    />
                    <button onClick={addChecklistItem} disabled={!newItemText.trim()}
                      style={{ background: newItemText.trim() ? 'var(--primary)' : 'var(--bg3)', color: newItemText.trim() ? '#fff' : 'var(--t3)', border: 'none', borderRadius: 10, padding: '0 16px', fontWeight: 700, fontSize: 13, cursor: newItemText.trim() ? 'pointer' : 'default', flexShrink: 0 }}>
                      Добавить
                    </button>
                  </div>
                )}
              </div>
            )}

            {isOrder && !readonly && task.order_status === 'review' && (
              <div style={{ marginBottom: 16, background: '#ECFEFF', border: '1px solid #A5F0FB', borderRadius: 14, padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#0E7490', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.04em' }}>Проверка доставки</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--t)' }}>
                    <span style={{ width: 18, height: 18, borderRadius: 5, background: task.image_url ? 'var(--primary)' : '#FEE2E2', color: task.image_url ? '#fff' : '#DC2626', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>{task.image_url ? '✓' : '!'}</span>
                    Документы {task.image_url ? 'приложены' : 'не приложены'}
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--t)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={cash} onChange={toggleCash} style={{ width: 18, height: 18, accentColor: 'var(--primary)', cursor: 'pointer' }} />
                    Наличные получены от логиста
                  </label>
                </div>
                {task.delivered_at && (
                  <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 12 }}>Курьер доставил: {new Date(task.delivered_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={confirmDelivery} disabled={saving}
                    style={{ flex: '1 1 160px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 12, padding: '11px', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, cursor: saving ? 'not-allowed' : 'pointer' }}>
                    Подтвердить доставку
                  </button>
                  <button onClick={returnToDelivery} disabled={saving}
                    style={{ background: 'var(--bg2)', color: '#B25E00', border: '1.5px solid #F0C88A', borderRadius: 12, padding: '11px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                    Вернуть в доставку
                  </button>
                </div>
              </div>
            )}

            {isOrder && !readonly && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.05em' }}>Статус заявки</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                  {ORDER_COLS.map(c => (
                    <button key={c.id} onClick={() => setStatus(c.id)}
                      style={{ padding: '7px 13px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: `2px solid ${status === c.id ? c.color : 'transparent'}`, background: status === c.id ? c.color + '22' : 'var(--bg3)', color: status === c.id ? c.color : 'var(--t3)', transition: 'all .15s' }}>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
              {!readonly && isOrder && (
                <Button onClick={saveStatus} loading={saving} disabled={status === task.order_status} style={{ flex: '1 1 140px' }}>
                  {saving ? 'Сохранение…' : 'Сохранить статус'}
                </Button>
              )}
              {!readonly && !isOrder && (
                <Button variant={task.is_done ? 'secondary' : 'primary'} onClick={toggleDone} style={{ flex: '1 1 140px', border: 'none' }}>
                  {task.is_done ? '↩ Вернуть в работу' : 'Выполнено'}
                </Button>
              )}
              {!readonly && (
                <button onClick={() => { setEdit(true); setErr('') }} style={{ background: 'var(--bg3)', color: 'var(--t)', border: '1.5px solid var(--bd)', borderRadius: 12, padding: '12px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Изменить</button>
              )}
              {task.due_date && (
                <button onClick={() => addToCalendar(task)} title="Добавить в календарь"
                  style={{ background: '#EFF6FF', color: '#2563EB', border: '1.5px solid #C0CFFF', borderRadius: 12, padding: '12px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>В календарь</button>
              )}
              {!readonly && (
                <button onClick={archiveToggle} style={{ background: archived ? '#E6F6EE' : 'var(--bg3)', color: archived ? '#0E7C46' : 'var(--t2)', border: 'none', borderRadius: 12, padding: '12px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  {archived ? 'Восстановить' : 'В архив'}
                </button>
              )}
              <button onClick={onClose} style={{ background: 'var(--bg3)', color: 'var(--t2)', border: 'none', borderRadius: 12, padding: '12px 20px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Закрыть</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
