'use client'

import KanbanCard from '@/views/crm/board/KanbanCard'
import type { Task } from '@/views/crm/board/shared'
import type { DndCtx } from '@/views/crm/board/useBoardDnd'
import { DropLine } from '@/views/crm/board/useBoardDnd'
import { Fragment } from 'react'

/* ───────────────────────────── Kanban Column ───────────────────────────── */

export default function KanbanColumn({ col, cards, dnd, onAdd, readonly }: {
  col: { id: string; label: string; color: string; bg: string }
  cards: Task[]
  dnd: DndCtx
  onAdd: (colId: string) => void
  readonly?: boolean
}) {
  const totalMoney = cards.reduce((s, c) => s + (c.total ?? 0), 0)
  const isOver = dnd.drag != null && dnd.over?.col === col.id

  return (
    <div
      data-board-col={col.id}
      style={{
        width: 272,
        minWidth: 272,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: isOver ? col.color + '22' : 'var(--bg2)',
        borderRadius: 16,
        transition: 'background .15s',
        border: isOver ? `2px dashed ${col.color}` : '2px solid transparent',
        maxHeight: '100%',
      }}
    >
      <div style={{ padding: '14px 14px 10px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: totalMoney > 0 ? 4 : 0 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: col.color, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--t)', flex: 1 }}>{col.label}</span>
          <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: col.color + '22', color: col.color }}>
            {cards.length}
          </span>
        </div>
        {totalMoney > 0 && (
          <div style={{ fontSize: 11, color: 'var(--t3)', marginLeft: 18 }}>
            {totalMoney.toLocaleString('ru')} ₸
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 10px 8px', minHeight: 60 }}>
        {cards.length === 0 && !isOver && (
          <div style={{ textAlign: 'center', color: 'var(--t3)', fontSize: 12, padding: '20px 0', userSelect: 'none' }}>
            Пусто
          </div>
        )}
        {cards.map((t, i) => (
          <Fragment key={t.id}>
            {isOver && dnd.over?.index === i && <DropLine color={col.color} />}
            <KanbanCard
              task={t}
              index={i}
              pointerProps={dnd.bind(t, col.id)}
              isDragging={dnd.dragId === t.id}
            />
          </Fragment>
        ))}
        {isOver && (dnd.over?.index ?? 0) >= cards.length && <DropLine color={col.color} />}
      </div>

      {!readonly && (
        <div style={{ padding: '8px 10px 12px', flexShrink: 0 }}>
          <button
            onClick={() => onAdd(col.id)}
            style={{
              width: '100%', padding: '8px', borderRadius: 10, border: '1.5px dashed var(--t3)',
              background: 'transparent', color: 'var(--t3)', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', transition: 'all .15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = col.color; e.currentTarget.style.color = col.color; e.currentTarget.style.background = col.bg }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--t3)'; e.currentTarget.style.color = 'var(--t3)'; e.currentTarget.style.background = 'transparent' }}
          >
            + Добавить
          </button>
        </div>
      )}
    </div>
  )
}
