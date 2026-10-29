'use client'

import { invalidateOrders } from '@/entities/order'
import { supabase } from '@/shared/lib/supabase'
import { Button,Spinner } from '@/shared/ui/ui'
import CardModal from '@/views/crm/board/CardModal'
import CreateModal from '@/views/crm/board/CreateModal'
import KanbanColumn from '@/views/crm/board/KanbanColumn'
import MobileListView from '@/views/crm/board/MobileListView'
import type { Manager,Task } from '@/views/crm/board/shared'
import { isRegulation,ORDER_COLS,PRIORITY,TASK_COLS,taskColId } from '@/views/crm/board/shared'
import { useBoardDnd } from '@/views/crm/board/useBoardDnd'
import { useCRM } from '@/views/crm/context/CRMContext'
import { SearchInput,Segmented,useIsMobile } from '@/views/crm/shared/crmui'
import { useQuery,useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

/* ───────────────────────────── Main Component ───────────────────────────── */

export default function BoardTab() {
  const isMobile = useIsMobile()
  const qc = useQueryClient()
  const { toast, can } = useCRM()
  const isReadonly = can('board') === 'view'

  const [mode, setMode] = useState<'orders' | 'tasks' | 'regulations'>('orders')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Task | null>(null)
  const [createModal, setCreateModal] = useState<{ defaultStatus: string } | null>(null)
  const [showArchive, setShowArchive] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [filterAssignee, setFilterAssignee] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  const { data: managers = [] } = useQuery<Manager[]>({
    queryKey: ['managers-list'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('id, name, email, role').in('role', ['admin', 'manager', 'logist']).order('name')
      return data ?? []
    },
    staleTime: 120_000,
  })

  const SELECT_COLS ='id,title,task_type,order_status,client_name,client_phone,address,total,items,priority,note,description,is_done,due_date,created_at,company_id,assignee_id,tags,image_url,is_active,sort_order,invoice_no,cash_received,delivered_at,checklist,companies(name),profiles!assignee_id(name,email)'

  const { data: orders = [], isLoading: loadOrders } = useQuery<Task[]>({
    queryKey: ['board-orders', showArchive],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crm_tasks')
        .select(SELECT_COLS)
        .in('task_type', ['order', 'lead'])
        .eq('is_active', !showArchive)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Task[]
    },
    staleTime: 30_000,
  })

  const { data: tasks = [], isLoading: loadTasks } = useQuery<Task[]>({
    queryKey: ['board-tasks', showArchive],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('crm_tasks')
        .select(SELECT_COLS)
        .eq('task_type', 'task')
        .eq('is_active', !showArchive)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Task[]
    },
    staleTime: 30_000,
  })

  /* Перемещение/сортировка карточки (drag & drop). Сохраняем колонку и порядок (sort_order). */
  async function commitMove({ task, toCol, orderedIds }: { task: Task; toCol: string; orderedIds: string[] }) {
    if (isReadonly) return
    const isOrders = mode === 'orders'
    const key = isOrders ? ['board-orders', showArchive] : ['board-tasks', showArchive]
    const curCol = isOrders ? task.order_status : taskColId(task)
    const colChanged = curCol !== toCol

    // Текущий порядок целевой колонки — чтобы понять, реально ли что-то поменялось
    const curOrderIds = getCards(toCol).map(c => c.id)
    if (!colChanged && curOrderIds.join(',') === orderedIds.join(',')) return

    const orderMap = new Map(orderedIds.map((id, i) => [id, i] as const))
    const isDone = !isOrders && toCol === 'done'

    // Оптимистичное обновление кэша
    await qc.cancelQueries({ queryKey: key })
    const prev = qc.getQueryData<Task[]>(key)
    qc.setQueryData<Task[]>(key, old => (old ?? []).map(t => {
      if (t.id === task.id) {
        return {
          ...t,
          order_status: toCol,
          is_done: isOrders ? t.is_done : isDone,
          sort_order: orderMap.get(t.id) ?? t.sort_order,
        }
      }
      return orderMap.has(t.id) ? { ...t, sort_order: orderMap.get(t.id)! } : t
    }))

    try {
      const draggedUpdate: Record<string, unknown> = { order_status: toCol, sort_order: orderMap.get(task.id) ?? 0 }
      if (!isOrders) {
        draggedUpdate.is_done = isDone
        draggedUpdate.completed_at = isDone ? new Date().toISOString() : null
      } else if (toCol === 'delivering') {
        draggedUpdate.delivery_state = 'waiting' // сброс под-статуса доставки при входе в колонку
      }
      const { error } = await supabase.from('crm_tasks').update(draggedUpdate).eq('id', task.id)
      if (error) throw error
      // Обновляем sort_order остальных карточек целевой колонки
      await Promise.all(
        orderedIds.filter(id => id !== task.id).map(id =>
          supabase.from('crm_tasks').update({ sort_order: orderMap.get(id)! }).eq('id', id)
        )
      )
      if (colChanged) {
        const col = (isOrders ? ORDER_COLS : TASK_COLS).find(c => c.id === toCol)
        toast(`Перемещено → ${col?.label ?? toCol}`)
        if (isOrders) { qc.invalidateQueries({ queryKey: ['nav-orders-count'] }); qc.invalidateQueries({ queryKey: ['logistics-delivering'] }) }
      }
    } catch {
      qc.setQueryData(key, prev)
      toast('Ошибка при перемещении')
    }
  }

  const q = search.trim().toLowerCase()
  const activeFilterCount = [filterAssignee, filterPriority, filterStatus].filter(Boolean).length

  function matchesFilters(t: Task, colId: string): boolean {
    if (filterAssignee && t.assignee_id !== filterAssignee) return false
    if (filterPriority && t.priority !== filterPriority) return false
    if (filterStatus && colId !== filterStatus) return false
    return true
  }

  const filteredOrders = orders.filter(o => {
    if (q && !((o.client_name ?? '').toLowerCase().includes(q) || (o.client_phone ?? '').includes(q) || o.id.includes(q))) return false
    return matchesFilters(o, o.order_status ?? '')
  })

  // «Задачи» — без регламентов; «Регламенты» — только с тегом regulation
  const baseTasks = mode === 'regulations' ? tasks.filter(isRegulation) : tasks.filter(t => !isRegulation(t))
  const filteredTasks = baseTasks.filter(t => {
    if (q && !t.title.toLowerCase().includes(q)) return false
    return matchesFilters(t, taskColId(t))
  })

  const cols = mode === 'orders' ? ORDER_COLS : TASK_COLS
  const isLoading = mode === 'orders' ? loadOrders : loadTasks

  function getCards(colId: string): Task[] {
    const list = mode === 'orders'
      ? filteredOrders.filter(o => o.order_status === colId)
      : filteredTasks.filter(t => taskColId(t) === colId)
    return [...list].sort((a, b) =>
      (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.created_at < b.created_at ? 1 : -1)
    )
  }

  const dnd = useBoardDnd({
    readonly: isReadonly || showArchive,
    getColumnCards: getCards,
    onCommit: commitMove,
    onClickCard: t => setSelected(t),
  })

  const totalItems = mode === 'orders' ? filteredOrders.length : filteredTasks.length

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, background: 'var(--bg)' }}>

      <div style={{
        padding: isMobile ? '12px 14px' : '14px 20px', background: 'var(--bg2)',
        borderBottom: '1px solid var(--bd)', flexShrink: 0, minWidth: 0,
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        {/* Row 1 — режим + кнопка добавления */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
          <div style={{ flex: 1, minWidth: 0, overflowX: 'auto', scrollbarWidth: 'none' }}>
            <Segmented
              value={mode}
              onChange={m => { setMode(m); setFilterStatus('') }}
              options={[
                { value: 'orders', label: 'Заявки' },
                { value: 'tasks', label: 'Задачи' },
                { value: 'regulations', label: 'Регламенты' },
              ]}
            />
          </div>

          {!isReadonly && !showArchive && (
            <Button
              onClick={() => setCreateModal({ defaultStatus: mode === 'orders' ? 'new' : 'todo' })}
              title={mode === 'orders' ? 'Новая заявка' : mode === 'regulations' ? 'Новый регламент' : 'Новая задача'}
              style={{
                flexShrink: 0, borderRadius: 10, height: 38,
                padding: isMobile ? 0 : '0 16px', width: isMobile ? 38 : undefined,
                fontSize: isMobile ? 20 : 11, lineHeight: 1,
              }}
            >
              {isMobile ? '+' : `+ ${mode === 'orders' ? 'Заявка' : mode === 'regulations' ? 'Регламент' : 'Задача'}`}
            </Button>
          )}
        </div>

        {/* Row 2 — поиск + фильтры + архив */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Поиск..." grow maxWidth={99999} />

          <button
            onClick={() => setShowFilters(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
              background: showFilters ? '#2563EB' : 'var(--bg3)', color: showFilters ? '#fff' : 'var(--t2)',
              border: showFilters ? 'none' : '1px solid var(--bd)', borderRadius: 10, padding: '0 14px', height: 38,
              fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .15s',
            }}
          >
            Фильтры
            {activeFilterCount > 0 && (
              <span style={{ background: showFilters ? 'rgba(255,255,255,.25)' : '#2563EB', color: '#fff', borderRadius: 20, padding: '1px 7px', fontSize: 11, fontWeight: 800 }}>
                {activeFilterCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setShowArchive(v => !v)}
            title={showArchive ? 'Показать активные' : 'Показать архив'}
            style={{
              flexShrink: 0,
              background: showArchive ? '#7C3AED' : 'var(--bg3)', color: showArchive ? '#fff' : 'var(--t2)',
              border: showArchive ? 'none' : '1px solid var(--bd)', borderRadius: 10, padding: '0 14px', height: 38,
              fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all .15s',
            }}
          >
            Архив
          </button>
        </div>

        {showFilters && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              value={filterAssignee}
              onChange={e => setFilterAssignee(e.target.value)}
              style={{ height: 36, borderRadius: 9, border: '1px solid var(--bd)', background: 'var(--bg3)', color: filterAssignee ? 'var(--t)' : 'var(--t3)', fontSize: 12, fontFamily: 'inherit', padding: '0 10px', cursor: 'pointer', outline: 'none' }}
            >
              <option value="">Исполнитель: все</option>
              {managers.map(m => <option key={m.id} value={m.id}>{m.name ?? m.email}</option>)}
            </select>

            <select
              value={filterPriority}
              onChange={e => setFilterPriority(e.target.value)}
              style={{ height: 36, borderRadius: 9, border: '1px solid var(--bd)', background: 'var(--bg3)', color: filterPriority ? 'var(--t)' : 'var(--t3)', fontSize: 12, fontFamily: 'inherit', padding: '0 10px', cursor: 'pointer', outline: 'none' }}
            >
              <option value="">Приоритет: все</option>
              {Object.entries(PRIORITY).map(([key, p]) => <option key={key} value={key}>{p.label}</option>)}
            </select>

            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              style={{ height: 36, borderRadius: 9, border: '1px solid var(--bd)', background: 'var(--bg3)', color: filterStatus ? 'var(--t)' : 'var(--t3)', fontSize: 12, fontFamily: 'inherit', padding: '0 10px', cursor: 'pointer', outline: 'none' }}
            >
              <option value="">Статус: все</option>
              {cols.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>

            {activeFilterCount > 0 && (
              <button
                onClick={() => { setFilterAssignee(''); setFilterPriority(''); setFilterStatus('') }}
                style={{ background: 'none', border: 'none', color: '#DC2626', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '0 4px' }}
              >
                Сбросить
              </button>
            )}
          </div>
        )}

        {!isLoading && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', maxWidth: '100%', overflowX: 'auto' }}>
            {mode === 'orders' ? (
              ORDER_COLS.map(c => {
                const cnt = filteredOrders.filter(o => o.order_status === c.id).length
                if (cnt === 0) return null
                return (
                  <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--bg3)', borderRadius: 8, padding: '4px 9px', fontSize: 12, fontWeight: 600, color: 'var(--t2)', whiteSpace: 'nowrap' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                    <b style={{ color: c.color, fontFamily: 'var(--font-display)', fontSize: 12 }}>{cnt}</b>
                    {c.label.toLowerCase()}
                  </span>
                )
              })
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'var(--bg3)', borderRadius: 8, padding: '4px 9px', fontSize: 12, fontWeight: 600, color: 'var(--t2)', whiteSpace: 'nowrap' }}>
                <b style={{ color: 'var(--primary)', fontFamily: 'var(--font-display)', fontSize: 12 }}>{filteredTasks.filter(t => t.is_done).length}</b> / {totalItems} выполнено
              </span>
            )}
          </div>
        )}

      </div>

      {isLoading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Spinner />
          <span style={{ color: 'var(--t3)', fontSize: 14 }}>Загрузка доски...</span>
        </div>
      ) : isMobile ? (
        <MobileListView cols={cols} getCards={getCards} dnd={dnd} />
      ) : (
        <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', padding: '20px' }}>
          <div style={{ display: 'flex', gap: 12, height: '100%', minWidth: 'max-content' }}>
            {cols.map(col => (
              <KanbanColumn
                key={col.id}
                col={col}
                cards={getCards(col.id)}
                dnd={dnd}
                onAdd={colId => setCreateModal({ defaultStatus: colId })}
                readonly={isReadonly || showArchive}
              />
            ))}
          </div>
        </div>
      )}

      {/* Плавающая копия карточки во время перетаскивания */}
      {dnd.drag && (
        <div style={{
          position: 'fixed', left: dnd.drag.x, top: dnd.drag.y, zIndex: 2000, pointerEvents: 'none',
          transform: 'translate(-50%, -50%) rotate(2deg)', width: 240, maxWidth: '80vw',
          background: 'var(--bg2)', borderRadius: 12, padding: '12px 14px',
          border: '1.5px solid var(--primary)', boxShadow: '0 16px 40px rgba(0,0,0,.28)', opacity: 0.95,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t)', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {dnd.drag.task.client_name ?? dnd.drag.task.title}
          </div>
        </div>
      )}

      {selected && (
        <CardModal
          task={selected}
          onClose={() => setSelected(null)}
          onUpdate={() => invalidateOrders(qc)}
          readonly={isReadonly}
        />
      )}

      {!isReadonly && createModal && (
        <CreateModal
          type={mode === 'orders' ? 'order' : mode === 'regulations' ? 'regulation' : 'task'}
          defaultStatus={createModal.defaultStatus}
          onClose={() => setCreateModal(null)}
          onCreated={() => {
            invalidateOrders(qc)
            toast('Карточка создана')
          }}
        />
      )}
    </div>
  )
}
