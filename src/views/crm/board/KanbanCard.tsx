'use client'

import type { Task } from '@/views/crm/board/shared'
import { PRIORITY,fmtMoney } from '@/views/crm/board/shared'

/* ───────────────────────────── Kanban Card ───────────────────────────── */

export default function KanbanCard({ task, pointerProps, index, isDragging }: {
  task: Task
  pointerProps: { onPointerDown: (e: React.PointerEvent) => void }
  index: number
  isDragging?: boolean
}) {
  const money = fmtMoney(task.total)
  const prio = task.priority ? PRIORITY[task.priority] : null
  const isOverdue = task.due_date && !task.is_done && new Date(task.due_date) < new Date()
  const checklist = task.checklist ?? []
  const checklistDone = checklist.filter(i => i.done).length
  const isLead = task.task_type === 'lead'

  return (
    <div
      data-board-card
      data-idx={index}
      {...pointerProps}
      style={{
        background: 'var(--bg2)',
        borderRadius: 12,
        padding: '12px 14px',
        marginBottom: 8,
        cursor: 'grab',
        border: isLead ? '1.5px solid #7C3AED' : '1.5px solid #E8EDE9',
        boxShadow: isLead ? '0 1px 6px rgba(124,58,237,.15)' : '0 1px 3px rgba(0,0,0,.06)',
        transition: 'box-shadow .15s, opacity .15s',
        userSelect: 'none',
        touchAction: 'pan-y',
        opacity: isDragging ? 0.4 : 1,
      }}
    >
      {isLead && (
        <div style={{ marginBottom: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#7C3AED', background: '#F4EEFE', borderRadius: 6, padding: '2px 7px' }}>
            B2B заявка с сайта
          </span>
        </div>
      )}
      {/* Company + assignee row */}
      {(() => {
        const co = Array.isArray(task.companies) ? task.companies[0] : task.companies
        const assignee = Array.isArray(task.profiles) ? task.profiles[0] : task.profiles
        const assigneeName = assignee?.name ?? assignee?.email?.split('@')[0] ?? null
        return (co?.name || assigneeName) ? (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
            {co?.name && (
              <span style={{ fontSize: 10, fontWeight: 700, color: '#7C3AED', background: '#F4EEFE', borderRadius: 6, padding: '2px 7px' }}>
                {co.name}
              </span>
            )}
            {assigneeName && (
              <span style={{ fontSize: 10, fontWeight: 700, color: '#0E7C46', background: '#E6F6EE', borderRadius: 6, padding: '2px 7px' }}>
                {assigneeName}
              </span>
            )}
          </div>
        ) : null
      })()}

      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t)', marginBottom: 4, lineHeight: 1.4, textDecoration: task.is_done ? 'line-through' : 'none', opacity: task.is_done ? 0.6 : 1 }}>
        {task.client_name ?? task.title}
      </div>

      {task.client_phone && (
        <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 4 }}>{task.client_phone}</div>
      )}
      {task.address && (
        <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.address}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          {prio && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: prio.bg, color: prio.color }}>
              {prio.label}
            </span>
          )}
          {isOverdue && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: '#FEF2F2', color: '#DC2626' }}>
              Просрочено
            </span>
          )}
          {task.due_date && !isOverdue && (
            <span style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 600 }}>
              {new Date(task.due_date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
            </span>
          )}
          {checklist.length > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, color: checklistDone === checklist.length ? 'var(--primary)' : 'var(--t3)' }}>
              ☑ {checklistDone}/{checklist.length}
            </span>
          )}
        </div>
        {money && (
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 11, color: 'var(--primary)', flexShrink: 0 }}>
            {money}
          </span>
        )}
      </div>
    </div>
  )
}
