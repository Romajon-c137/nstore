'use client'

import type { Task } from '@/views/crm/board/shared'
import { PRIORITY,fmtMoney } from '@/views/crm/board/shared'
import type { DndCtx } from '@/views/crm/board/useBoardDnd'
import { DropLine } from '@/views/crm/board/useBoardDnd'
import { Fragment,useState } from 'react'

/* ───────────────────────────── Mobile List View ───────────────────────────── */

export default function MobileListView({ cols, getCards, dnd }: {
  cols: { id: string; label: string; color: string; bg: string }[]
  getCards: (colId: string) => Task[]
  dnd: DndCtx
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    cols.forEach((c, i) => { init[c.id] = i < 3 })
    return init
  })

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', paddingBottom: 'calc(60px + env(safe-area-inset-bottom, 0px))' }}>
      {cols.map(col => {
        const cards = getCards(col.id)
        const isOpen = open[col.id]
        const isOver = dnd.drag != null && dnd.over?.col === col.id
        return (
          <div key={col.id} data-board-col={col.id} style={{ marginBottom: 10, border: isOver ? `2px dashed ${col.color}` : '2px solid transparent', borderRadius: 14, transition: 'border .15s' }}>
            <button
              onClick={() => setOpen(p => ({ ...p, [col.id]: !p[col.id] }))}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px',
                background: isOpen || isOver ? col.color + '22' : 'var(--bg2)', borderRadius: isOpen ? '12px 12px 0 0' : 12,
                border: 'none', cursor: 'pointer', transition: 'all .15s',
              }}
            >
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: col.color, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t)', flex: 1, textAlign: 'left' }}>{col.label}</span>
              <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: col.color + '22', color: col.color }}>
                {cards.length}
              </span>
              <span style={{ fontSize: 16, color: 'var(--t3)', transition: 'transform .2s', transform: isOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
            </button>

            {isOpen && (
              <div style={{ background: 'var(--bg2)', borderRadius: '0 0 12px 12px', border: `1px solid ${col.color}22`, borderTop: 'none', overflow: 'hidden' }}>
                {cards.length === 0 && !isOver ? (
                  <div style={{ textAlign: 'center', color: 'var(--t3)', fontSize: 12, padding: '16px 0' }}>Пусто</div>
                ) : cards.map((t, i) => {
                  const money = fmtMoney(t.total)
                  const prio = t.priority ? PRIORITY[t.priority] : null
                  const checklist = t.checklist ?? []
                  return (
                    <Fragment key={t.id}>
                      {isOver && dnd.over?.index === i && <DropLine color={col.color} />}
                      <div
                        data-board-card
                        data-idx={i}
                        {...dnd.bind(t, col.id)}
                        style={{
                          padding: '12px 14px', cursor: 'grab',
                          borderBottom: i < cards.length - 1 ? '1px solid var(--bd)' : 'none',
                          transition: 'opacity .15s', userSelect: 'none', touchAction: 'pan-y',
                          opacity: dnd.dragId === t.id ? 0.4 : 1,
                          display: 'flex', alignItems: 'flex-start', gap: 10,
                        }}
                      >
                        <span style={{ color: 'var(--t3)', fontSize: 16, lineHeight: 1.2, flexShrink: 0, marginTop: 1 }}>⠿</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--t)', marginBottom: 4, textDecoration: t.is_done ? 'line-through' : 'none', opacity: t.is_done ? 0.6 : 1 }}>
                            {t.client_name ?? t.title}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            {t.client_phone && <span style={{ fontSize: 11, color: 'var(--t3)' }}>{t.client_phone}</span>}
                            {t.address && <span style={{ fontSize: 11, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{t.address}</span>}
                            {prio && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: prio.bg, color: prio.color }}>{prio.label}</span>}
                            {checklist.length > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)' }}>☑ {checklist.filter(i => i.done).length}/{checklist.length}</span>}
                            {money && <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 11, color: 'var(--primary)', marginLeft: 'auto' }}>{money}</span>}
                          </div>
                        </div>
                      </div>
                    </Fragment>
                  )
                })}
                {isOver && (dnd.over?.index ?? 0) >= cards.length && <DropLine color={col.color} />}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
