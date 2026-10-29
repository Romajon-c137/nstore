/* ══════════════════════════════════════════════════════════════════
   Единые форматтеры (деньги / даты). Один источник правды, чтобы суммы
   выглядели одинаково на всех экранах (раньше fmtMoney был скопирован в
   6 файлов и форматировал по-разному).
   ══════════════════════════════════════════════════════════════════ */

/** Компактное число: 1 200 000 → "1.2 млн", 12 000 → "12 К", 500 → "500".
 *  Отрицательные сохраняют знак, ".0" отбрасывается. Без валюты. */
export function fmtCompact(n: number): string {
  const a = Math.abs(n)
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.0', '') + ' млн'
  if (a >= 1_000) return Math.round(n / 1_000) + ' К'
  return Math.round(n).toString()
}

/** Компактные деньги в тенге: 1 200 000 → "1.2 млн ₸". */
export function fmtMoney(n: number): string {
  return fmtCompact(n) + ' ₸'
}

/** Полное число с разделителями: 1234567 → "1 234 567". Пусто → "—". */
export function fmtFull(n: number | null | undefined): string {
  if (!n) return '—'
  return Math.round(n).toLocaleString('ru-RU')
}

/** Процент из доли: 0.153 → "15.3%". */
export function fmtPct(n: number): string {
  return (n * 100).toFixed(1).replace('.0', '') + '%'
}

/** Короткая дата: "05 июл". Пусто → "—". */
export function fmtDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
}

/** Относительное время: "только что", "5 мин", "2 ч", иначе короткая дата. */
export function fmtRelative(s: string): string {
  const d = new Date(s)
  const diff = Math.floor((Date.now() - d.getTime()) / 60_000)
  if (diff < 1) return 'только что'
  if (diff < 60) return `${diff} мин`
  if (diff < 1440) return `${Math.floor(diff / 60)} ч`
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
}
