/* ───────────────────────────────────────────────────────────────────────────
   Единый доменный слой заказов (P2/P3).
   Один источник правды для статусов заявок: канбан-колонки, клиентские бейджи,
   приоритеты. + фабрика queryKey и централизованная инвалидация (P3).
   Изменение статуса/цвета/подписи/ключей делается ЗДЕСЬ, а не в 4 файлах.
   ─────────────────────────────────────────────────────────────────────────── */

import type { QueryClient } from '@tanstack/react-query';

export type OrderStatus =
  | 'new' | 'confirmed' | 'picking' | 'delivering' | 'review' | 'done' | 'cancelled'

/* Колонки канбан-доски заказов (CRM · Доска) */
export const ORDER_COLS: { id: string; label: string; color: string; bg: string }[] = [
  { id: 'new',        label: 'Новые',        color: 'var(--t3)', bg: 'var(--bg3)' },
  { id: 'confirmed',  label: 'Подтверждено', color: '#2563EB', bg: '#EFF6FF' },
  { id: 'picking',    label: 'Сборка',       color: '#7C3AED', bg: '#F5F3FF' },
  { id: 'delivering', label: 'В доставке',   color: '#D97706', bg: '#FFFBEB' },
  { id: 'review',     label: 'Проверка',     color: '#0891B2', bg: '#ECFEFF' },
  { id: 'done',       label: 'Выполнено',    color: '#059669', bg: '#ECFDF5' },
  { id: 'cancelled',  label: 'Отменено',    color: '#DC2626', bg: '#FEF2F2' },
]

/* Колонки канбан-доски задач */
export const TASK_COLS = [
  { id: 'todo',     label: 'К выполнению', color: 'var(--t3)', bg: 'var(--bg3)' },
  { id: 'inprog',   label: 'В работе',     color: '#2563EB', bg: '#EFF6FF' },
  { id: 'done',     label: 'Готово',       color: '#059669', bg: '#ECFDF5' },
]

/* Приоритеты карточек */
export const PRIORITY: Record<string, { label: string; color: string; bg: string }> = {
  high: { label: 'Высокий', color: '#DC2626', bg: '#FEF2F2' },
  mid:  { label: 'Средний', color: '#D97706', bg: '#FFFBEB' },
  low:  { label: 'Низкий',  color: 'var(--t3)', bg: 'var(--bg3)' },
}

/* Бейдж статуса заказа, который видит клиент в кабинете */
export const ORDER_STATUS_MAP: Record<string, { label: string; bg: string; fg: string }> = {
  new: { label: 'Новый', bg: '#FFF3E0', fg: '#F57C00' }, confirmed: { label: 'Подтверждён', bg: '#E3F2FD', fg: '#1565C0' },
  picking: { label: 'Сборка', bg: '#F3E5F5', fg: '#6A1B9A' }, delivering: { label: 'В доставке', bg: '#E0F7FA', fg: '#00695C' },
  review: { label: 'Доставлено', bg: '#ECFEFF', fg: '#0E7490' },
  done: { label: 'Выполнен', bg: '#E8F5E9', fg: '#2E7D32' }, cancelled: { label: 'Отменён', bg: '#FFEBEE', fg: '#C62828' },
}

/* ───────────────────────────── queryKey и инвалидация (P3) ────────────────────────────── */

/* Фабрика ключей кэша для заказов — чтобы ключи не расходились по файлам. */
export const orderKeys = {
  board:      (archive: boolean)     => ['board-orders', archive] as const,
  tasks:      (archive: boolean)     => ['board-tasks', archive] as const,
  delivering: ()                     => ['logistics-delivering'] as const,
  navCount:   ()                     => ['nav-orders-count'] as const,
  cabinet:    (profileId?: string)   => ['cabinet-orders', profileId] as const,
}

/* Все запросы, зависящие от состояния заказов: доска, доставка, счётчики, кабинет.
   Один вызов вместо ручного набора invalidateQueries в каждом месте (P3). */
export function invalidateOrders(qc: QueryClient) {
  for (const k of ['board-orders', 'board-tasks', 'nav-orders-count', 'logistics-delivering', 'cabinet-orders']) {
    qc.invalidateQueries({ queryKey: [k] })
  }
}
