'use client'

import type { Task } from '@/views/crm/board/shared'
import { useRef,useState } from 'react'

/* ───────────────────────────── Drag & Drop (pointer-based, works on touch and mouse) ───────────────────────────── */

export interface DndCtx {
  bind: (task: Task, colId: string) => { onPointerDown: (e: React.PointerEvent) => void }
  drag: { task: Task; x: number; y: number } | null
  over: { col: string; index: number } | null
  dragId: string | null
}

export function useBoardDnd(args: {
  readonly?: boolean
  getColumnCards: (colId: string) => Task[]
  onCommit: (p: { task: Task; toCol: string; orderedIds: string[] }) => void
  onClickCard: (t: Task) => void
}): DndCtx {
  const argsRef = useRef(args); argsRef.current = args
  const [drag, setDrag] = useState<{ task: Task; x: number; y: number } | null>(null)
  const [over, setOver] = useState<{ col: string; index: number } | null>(null)

  const st = useRef({
    task: null as Task | null, fromCol: '', startX: 0, startY: 0,
    started: false, enabled: true, timer: 0 as ReturnType<typeof setTimeout> | 0,
    overCol: null as string | null, overIndex: 0,
    // touch capture — prevents browser from claiming touch as scroll after long-press
    element: null as HTMLElement | null, pointerId: -1,
  })

  const move = useRef<(e: PointerEvent) => void>(() => {})
  const up = useRef<(e: PointerEvent) => void>(() => {})

  const init = useRef(false)
  if (!init.current) {
    init.current = true

    const detach = () => {
      window.removeEventListener('pointermove', move.current as EventListener)
      window.removeEventListener('pointerup', up.current as EventListener)
      window.removeEventListener('pointercancel', up.current as EventListener)
    }
    const lockScroll = (lock: boolean) => {
      document.body.style.userSelect = lock ? 'none' : ''
      document.body.style.touchAction = lock ? 'none' : ''
      document.documentElement.style.touchAction = lock ? 'none' : ''
    }

    move.current = (e: PointerEvent) => {
      const s = st.current
      if (!s.task) return
      const dx = e.clientX - s.startX, dy = e.clientY - s.startY
      if (!s.started) {
        const big = Math.abs(dx) > 12 || Math.abs(dy) > 12
        if (!big) return
        if (!s.enabled) {
          clearTimeout(s.timer as ReturnType<typeof setTimeout>)
          detach()
          s.task = null
          return
        }
        if (e.pointerType === 'mouse') {
          clearTimeout(s.timer as ReturnType<typeof setTimeout>)
          // begin drag immediately for mouse
          s.started = true
          lockScroll(true)
          navigator.vibrate?.(10)
          setDrag({ task: s.task!, x: s.startX, y: s.startY })
        } else {
          // finger moved before long-press fires → treat as scroll
          clearTimeout(s.timer as ReturnType<typeof setTimeout>)
          detach()
          s.task = null
          return
        }
      }
      e.preventDefault()
      setDrag({ task: s.task, x: e.clientX, y: e.clientY })
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
      const colEl = el?.closest('[data-board-col]') as HTMLElement | null
      if (!colEl) return
      const colId = colEl.getAttribute('data-board-col') || s.fromCol
      s.overCol = colId
      const cardEl = el?.closest('[data-board-card]') as HTMLElement | null
      let index: number
      if (cardEl && colEl.contains(cardEl)) {
        const idx = Number(cardEl.getAttribute('data-idx'))
        const r = cardEl.getBoundingClientRect()
        index = e.clientY < r.top + r.height / 2 ? idx : idx + 1
      } else {
        index = argsRef.current.getColumnCards(colId).length
      }
      s.overIndex = index
      setOver({ col: colId, index })
    }

    up.current = () => {
      const s = st.current
      const wasDragging = s.started
      const task = s.task
      if (wasDragging && task && s.overCol) {
        const cards = argsRef.current.getColumnCards(s.overCol).filter(c => c.id !== task.id)
        const idx = Math.max(0, Math.min(s.overIndex, cards.length))
        const ordered = [...cards.slice(0, idx), task, ...cards.slice(idx)]
        argsRef.current.onCommit({ task, toCol: s.overCol, orderedIds: ordered.map(c => c.id) })
        navigator.vibrate?.(8)
      } else if (!wasDragging && task) {
        argsRef.current.onClickCard(task)
      }
      // release pointer capture to let browser resume normal touch handling
      if (s.element && s.pointerId >= 0) {
        try { s.element.releasePointerCapture(s.pointerId) } catch { /* ignore */ }
      }
      detach()
      lockScroll(false)
      st.current = {
        task: null, fromCol: '', startX: 0, startY: 0, started: false,
        enabled: true, timer: 0, overCol: null, overIndex: 0,
        element: null, pointerId: -1,
      }
      setDrag(null)
      setOver(null)
    }
  }

  const bind = (task: Task, colId: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const s = st.current
      s.task = task; s.fromCol = colId; s.startX = e.clientX; s.startY = e.clientY
      s.started = false; s.enabled = !argsRef.current.readonly; s.overCol = colId; s.overIndex = 0
      s.element = e.currentTarget as HTMLElement; s.pointerId = e.pointerId
      window.addEventListener('pointermove', move.current as EventListener, { passive: false })
      window.addEventListener('pointerup', up.current as EventListener)
      window.addEventListener('pointercancel', up.current as EventListener)
      if (!s.enabled) return
      // Touch only: 300ms long-press activates drag with pointer capture.
      // Mouse starts drag immediately on move (handled in move.current).
      if (e.pointerType !== 'mouse') {
        s.timer = setTimeout(() => {
          if (!st.current.task) return
          st.current.started = true
          const el = st.current.element
          const pid = st.current.pointerId
          // capture the pointer so browser stops treating this touch as a scroll
          if (el && pid >= 0) {
            try { el.setPointerCapture(pid) } catch { /* ignore */ }
          }
          document.body.style.userSelect = 'none'
          document.body.style.touchAction = 'none'
          document.documentElement.style.touchAction = 'none'
          navigator.vibrate?.(15)
          setDrag({ task, x: st.current.startX, y: st.current.startY })
        }, 300)
      }
    },
  })

  return { bind, drag, over, dragId: drag?.task.id ?? null }
}

/* Drop-position indicator line */
export function DropLine({ color }: { color: string }) {
  return <div style={{ height: 4, borderRadius: 4, background: color, margin: '3px 4px', pointerEvents: 'none', boxShadow: `0 0 0 2px ${color}33` }} />
}
