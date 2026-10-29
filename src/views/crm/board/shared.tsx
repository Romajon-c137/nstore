'use client'

import { fmtMoney as fmtMoneyBase } from '@/shared/lib/format';
import { supabase } from '@/shared/lib/supabase';

/* ───────────────────────────── Types ────────────────────────────── */

export interface ChecklistItem { id: string; text: string; done: boolean }

export interface Task {
  id: string
  title: string
  task_type: 'order' | 'task' | 'lead'
  order_status: string | null
  client_name: string | null
  client_phone: string | null
  address: string | null
  total: number | null
  priority: string | null
  note: string | null
  description: string | null
  is_done: boolean | null
  due_date: string | null
  created_at: string
  items: { name: string; qty: number; price: number; unit?: string }[] | null
  company_id: string | null
  assignee_id: string | null
  tags: string[] | null
  image_url: string | null
  is_active: boolean | null
  sort_order: number | null
  invoice_no: string | null
  cash_received: boolean | null
  delivered_at: string | null
  checklist: ChecklistItem[] | null
  companies?: { name: string } | { name: string }[] | null
  profiles?: { name: string | null; email: string } | { name: string | null; email: string }[] | null
}

export interface Manager { id: string; name: string | null; email: string; role: string }

/* ───────────────────────────── Constants ────────────────────────────── */
/* Единый источник статусов/колонок/приоритетов — src/data/orders.ts.
   Ре-экспортируем, чтобы файлы доски продолжали импортировать из ../board/shared. */
export { ORDER_COLS,PRIORITY,TASK_COLS } from '@/entities/order';

/* ───────────────────────────── Helpers ────────────────────────────── */

/** Деньги на карточках борда: null → скрыть (вызовы полагаются на это). */
export function fmtMoney(n: number | null): string | null {
  return n ? fmtMoneyBase(n) : null
}

export function taskColId(t: Task): string {
  // Колонка задачи/регламента хранится в order_status (todo|inprog|done)
  if (t.order_status === 'todo' || t.order_status === 'inprog' || t.order_status === 'done') return t.order_status
  if (t.is_done) return 'done'
  if (t.due_date && new Date(t.due_date) < new Date()) return 'inprog'
  return 'todo'
}

export const isRegulation = (t: Task) => !!t.tags?.includes('regulation')

/* Добавление события в календарь — генерируем .ics (работает на iOS/Android/десктоп) */
export function addToCalendar(task: Task) {
  const pad = (n: number) => String(n).padStart(2, '0')
  const due = task.due_date ? new Date(task.due_date) : new Date()
  const ymd = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  const next = new Date(due); next.getDate(); next.setDate(due.getDate() + 1)
  const now = new Date()
  const stamp = `${ymd(now)}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const assignee = Array.isArray(task.profiles) ? task.profiles[0] : task.profiles
  const who = assignee?.name ?? assignee?.email ?? ''
  const esc = (s: string) => (s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n')
  const desc = [task.description || task.note || '', who ? `Ответственный: ${who}` : ''].filter(Boolean).join('\\n')
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nstore//CRM//RU', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${task.id}@nstore.crm`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${ymd(due)}`,
    `DTEND;VALUE=DATE:${ymd(next)}`,
    `SUMMARY:${esc(task.title)}`,
    desc ? `DESCRIPTION:${esc(desc)}` : '',
    'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', `DESCRIPTION:${esc(task.title)}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n')

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(task.title || 'event').slice(0, 40).replace(/[^\wа-яёА-ЯЁ\- ]/gi, '')}.ics`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/* Загрузка фото: Cloudinary (если заданы env) либо Supabase Storage (бакет board) */
export async function uploadImage(file: File): Promise<string> {
  const cloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
  const preset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET
  if (cloud && preset) {
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('upload_preset', preset)
      const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: 'POST', body: fd })
      const j = await res.json()
      if (j.secure_url) return j.secure_url as string
      // Если preset неверный/не unsigned — падаем в фолбэк Supabase Storage
      console.warn('Cloudinary upload failed, falling back to Supabase Storage:', j.error?.message)
    } catch (e) {
      console.warn('Cloudinary upload error, falling back to Supabase Storage:', e)
    }
  }
  // Фолбэк — Supabase Storage (публичный бакет board)
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `cards/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from('board').upload(path, file, { upsert: false, contentType: file.type })
  if (error) throw error
  return supabase.storage.from('board').getPublicUrl(path).data.publicUrl
}
