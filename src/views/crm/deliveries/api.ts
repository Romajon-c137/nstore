/* ══════════════════════════════════════════════════════════════════
   Доставки — слой данных.
   Накладные: 1С «Расходная накладная» склад «Алаш» → delivery.invoices
   (функция sync-onec-deliveries, каждые 15 мин). Статусы ставит водитель
   здесь → delivery.status → функция delivery-to-onec → HTTP-сервис 1С.
   ══════════════════════════════════════════════════════════════════ */
import { supabase } from '@/shared/lib/supabase';

export type DStatus = 'waiting' | 'taken' | 'delivered' | 'returned'
export type DAction = 'take' | 'release' | 'deliver' | 'return' | 'reset'

export interface DLine { n: number; name: string | null; article: string | null; qty: number; price: number; sum: number }
export interface DItem {
  ref: string; number: string; date: string; client: string | null; amount: number
  address: string | null; phone: string | null; comment: string | null; manager: string | null
  lines: DLine[]
  status: DStatus; driver_id: string | null; driver: string | null; vehicle: string | null
  taken_at: string | null; done_at: string | null; photo_path: string | null; note: string | null
  onec: null | 'pending' | 'error' | 'ok'; onec_error: string | null
}
export interface DList {
  me: { uid: string; role: string; name: string; onec_driver: string | null; onec_vehicle: string | null } | null
  last_sync: string | null
  last_push: string | null
  items: DItem[]
}
export interface DEvent { status: string; at: string; note: string | null; who: string | null }

export interface DriversInfo {
  users: { profile_id: string; name: string; phone: string | null; email: string | null; role: string; driver_ref: string | null; vehicle_ref: string | null }[]
  drivers: { ref: string; name: string }[]
  vehicles: { ref: string; name: string }[]
}
export interface DReportRow { driver: string; vehicle: string | null; delivered: number; delivered_sum: number; returned: number; in_progress: number; clients: number }

export const BUCKET = 'delivery-docs'

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message === 'forbidden' ? 'Нет доступа к доставкам' : error.message)
  return data as T
}

export const fetchList = (from: string, to: string) => call<DList>('dl_list', { p_from: from, p_to: to })
export const fetchHistory = (ref: string) => call<DEvent[]>('dl_history', { p_ref: ref })
export const doAction = (ref: string, action: DAction, photo?: string | null, note?: string | null) =>
  call<{ ok: boolean }>('dl_action', { p_ref: ref, p_action: action, p_photo: photo ?? null, p_note: note ?? null })

export const fetchDrivers = () => call<DriversInfo>('dl_drivers', {})
export const setDriver = (profile: string, driver: string | null, vehicle: string | null) =>
  call<{ ok: boolean }>('dl_driver_set', { p_profile: profile, p_driver_ref: driver, p_vehicle_ref: vehicle })
export const fetchReport = (month: string) => call<DReportRow[]>('dl_report', { p_month: month })

/** Сжимает фото камеры до ~1600px JPEG (обычно 200–500 КБ) — экономит мобильный трафик водителя. */
export async function compressImage(file: File, maxSide = 1600, quality = 0.8): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Не удалось прочитать фото')); i.src = url
    })
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k)
    const c = document.createElement('canvas'); c.width = w; c.height = h
    c.getContext('2d')!.drawImage(img, 0, 0, w, h)
    const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/jpeg', quality))
    if (!blob) throw new Error('Не удалось сжать фото')
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function uploadPhoto(ref: string, file: File): Promise<string> {
  const blob = file.size > 700_000 || !/jpe?g$/i.test(file.type) ? await compressImage(file) : file
  const path = `${ref}/${Date.now()}.jpg`
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (error) throw new Error('Фото не загрузилось: ' + error.message)
  return path
}

export async function photoUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600)
  if (error || !data) throw new Error(error?.message ?? 'Нет ссылки на фото')
  return data.signedUrl
}

export const STATUS_META: Record<DStatus, { label: string; color: string; bg: string }> = {
  waiting:   { label: 'Ожидает',    color: 'var(--t2)',     bg: 'var(--bg3)' },
  taken:     { label: 'В пути',     color: '#0891B2',       bg: 'rgba(8,145,178,.13)' },
  delivered: { label: 'Доставлено', color: 'var(--primary)', bg: 'rgba(16,163,91,.13)' },
  returned:  { label: 'Возврат',    color: '#DC2626',       bg: 'rgba(220,38,38,.12)' },
}
