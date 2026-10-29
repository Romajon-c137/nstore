'use client'

/* Сети клиентов: Espresso Day, Zebra, Master Coffee… — несколько контрагентов (точки, ИП/ТОО) как одна сеть.
   Состав сети: правило по названию предлагает точки, админ добавляет/убирает вручную (ИП без бренда в названии). */
import { LoadingBox } from '@/shared/ui/ui'
import { useCRM } from '@/views/crm/context/CRMContext'
import {
chainKeys,
fetchChainDetail,fetchChainSuggest,fetchChains,
fetchChainsSync,
saveChain,setChainMembers,
type ChainPoint,type Filters,type PointStatus,
} from '@/views/crm/sales/api'
import { Bar,Card,Delta,ErrorBox,Kpi,Notice,TableWrap,dateRu,downloadCsv,money,moneyShort,num,td,tdNum,th,thNum } from '@/views/crm/sales/ui'
import { Modal,SearchInput,Segmented,inputStyle,labelStyle,useIsMobile } from '@/views/crm/shared/crmui'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { useMemo,useState } from 'react'

const ST: Record<PointStatus, { label: string; fg: string; bg: string; hint: string }> = {
  active:   { label: 'Закупает',  fg: 'var(--primary2)', bg: 'rgba(16,163,91,.12)', hint: 'Последняя закупка не позже 30 дней назад' },
  sleeping: { label: 'Пауза',     fg: '#B25E00',         bg: 'rgba(217,119,6,.12)', hint: 'Последняя закупка 31–90 дней назад' },
  lost:     { label: 'Перестала', fg: 'var(--red)',      bg: 'rgba(220,38,38,.10)', hint: 'Не закупала больше 90 дней' },
  never:    { label: 'Нет продаж', fg: 'var(--t3)',      bg: 'var(--bg3)',          hint: 'Продаж по этой карточке нет' },
}
const Pill = ({ s }: { s: PointStatus }) => (
  <span title={ST[s].hint} style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, color: ST[s].fg, background: ST[s].bg, whiteSpace: 'nowrap' }}>{ST[s].label}</span>
)
const btn = (primary = false): React.CSSProperties => ({
  padding: '7px 12px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  border: primary ? 'none' : '1px solid var(--bd2)', background: primary ? 'var(--primary)' : 'var(--bg2)', color: primary ? '#fff' : 'var(--t2)',
})
const telHref = (p: string) => 'tel:' + p.split(',')[0].replace(/[^\d+]/g, '').replace(/^8(?=7\d{9}$)/, '+7')

export default function ChainsView({ filters, onClient }: { filters: Filters; onClient: (ref: string, name: string) => void }) {
  const [open, setOpen] = useState<number | null>(null)
  const [edit, setEdit] = useState<{ id: number | null; name: string; pattern: string } | null>(null)
  const list = useQuery({ queryKey: chainKeys.list(filters.from, filters.to), queryFn: () => fetchChains(filters.from, filters.to), staleTime: 5 * 60_000 })
  const sync = useQuery({ queryKey: chainKeys.sync(), queryFn: fetchChainsSync, staleTime: 60_000, refetchInterval: 120_000 })

  if (list.isLoading) return <LoadingBox minHeight={260} label="Считаю сети…" />
  if (list.error) return <ErrorBox error={list.error} onRetry={() => list.refetch()} />
  const d = list.data!

  if (open != null) {
    return <ChainDetailView id={open} filters={filters} isAdmin={d.is_admin} onBack={() => setOpen(null)} onClient={onClient}
      onEdit={(c) => setEdit({ id: c.id, name: c.name, pattern: c.pattern ?? '' })} editModal={edit && <ChainEditModal v={edit} onClose={() => setEdit(null)} />} />
  }

  const maxRev = Math.max(1, ...d.items.map(c => c.rev))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <Card title="Сети клиентов" pad={12}
        hint="Несколько карточек 1С (точки, ИП и ТОО франчайзи) считаются как одна сеть. Период — из фильтра сверху, сравнение с таким же предыдущим периодом."
        right={d.is_admin && <button style={btn(true)} onClick={() => setEdit({ id: null, name: '', pattern: '' })}>+ Сеть</button>}>
        {d.items.length === 0 ? <div style={{ fontSize: 13, color: 'var(--t3)' }}>Сетей пока нет.</div> : (
          <TableWrap>
            <thead><tr>
              <th style={th}>Сеть</th><th style={thNum}>Точек</th><th style={thNum}>Закупали</th>
              <th style={thNum}>Перестали</th><th style={thNum}>Выручка</th><th style={th}>К пред. периоду</th><th style={thNum}>Заказов</th>
            </tr></thead>
            <tbody>
              {d.items.map(c => (
                <tr key={c.id} onClick={() => setOpen(c.id)} style={{ cursor: 'pointer' }}>
                  <td style={td}>
                    <div style={{ fontWeight: 800 }}>{c.name}</div>
                    <div style={{ marginTop: 5, maxWidth: 220 }}><Bar value={c.rev} max={maxRev} /></div>
                  </td>
                  <td style={tdNum}>{c.points}</td>
                  <td style={tdNum}><b>{c.active}</b> <span style={{ color: 'var(--t3)', fontSize: 11 }}>было {c.active_prev}</span></td>
                  <td style={{ ...tdNum, color: c.lost ? 'var(--red)' : 'var(--t3)', fontWeight: c.lost ? 800 : 400 }}>{c.lost || '—'}</td>
                  <td style={tdNum}><b>{moneyShort(c.rev)}</b></td>
                  <td style={td}><Delta cur={c.rev} prev={c.rev_prev} /></td>
                  <td style={tdNum}>{num(c.orders)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
      {sync.data && (
        <Notice tone={sync.data.errors ? 'warn' : 'info'}>
          Синхронизация с 1С (реквизит контрагента «Сеть»): {sync.data.pending ? `ожидают отправки ${sync.data.pending}` : 'всё отправлено'}
          {sync.data.last_push && ` · последняя отправка ${new Date(sync.data.last_push).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
          {sync.data.errors > 0 && ` · ошибок ${sync.data.errors}: ${sync.data.last_error ?? ''}`}
          {typeof sync.data.last_run?.stats?.push === 'string' && ` · ${String(sync.data.last_run.stats.push)}`}
          . Сеть, поставленная в карточке контрагента в 1С, появится здесь в течение 10 минут.
        </Notice>
      )}
      <Notice>
        «Перестали» — точки, которые закупали в течение года, но не закупали последние 90 дней. ИП без бренда в названии добавляйте в сеть вручную
        (в сети → «Добавить точки» → поиск по названию, БИН или телефону). Новые карточки 1С с брендом в названии попадают в сеть автоматически.
      </Notice>
      {edit && <ChainEditModal v={edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

function ChainDetailView({ id, filters, isAdmin, onBack, onClient, onEdit, editModal }: {
  id: number; filters: Filters; isAdmin: boolean; onBack: () => void; onClient: (ref: string, name: string) => void
  onEdit: (c: { id: number; name: string; pattern: string | null }) => void; editModal: React.ReactNode
}) {
  const isMobile = useIsMobile()
  const qc = useQueryClient()
  const { toast } = useCRM()
  const [tab, setTab] = useState<'points' | 'products'>('points')
  const [st, setSt] = useState<PointStatus | 'all'>('all')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const det = useQuery({ queryKey: chainKeys.detail(id, filters.from, filters.to), queryFn: () => fetchChainDetail(id, filters.from, filters.to), staleTime: 5 * 60_000 })

  const remove = useMutation({
    mutationFn: (p: ChainPoint) => setChainMembers(id, [p.ref], false),
    onSuccess: (_r, p) => { toast(`«${p.name}» убрана из сети`); qc.invalidateQueries({ queryKey: ['sales-analytics'] }) },
    onError: e => toast((e as Error).message, 5000),
  })

  const pts = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (det.data?.points ?? []).filter(p => (st === 'all' || p.status === st) && (!s || [p.name, p.bin, p.phone, p.manager].some(v => v?.toLowerCase().includes(s))))
  }, [det.data, st, q])

  if (det.isLoading) return <LoadingBox minHeight={260} label="Загружаю сеть…" />
  if (det.error) return <ErrorBox error={det.error} onRetry={() => det.refetch()} />
  const d = det.data!
  const all = d.points
  const cnt = (s: PointStatus) => all.filter(p => p.status === s).length
  const rev = all.reduce((a, p) => a + p.rev, 0), revPrev = all.reduce((a, p) => a + p.rev_prev, 0)
  const buying = all.filter(p => p.rev > 0).length, buyingPrev = all.filter(p => p.rev_prev > 0).length
  const orders = all.reduce((a, p) => a + p.orders, 0)
  const mMax = Math.max(1, ...d.months.map(m => m.rev))
  const catMax = Math.max(1, ...d.categories.map(c => c.rev))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button style={btn()} onClick={onBack}>← Все сети</button>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--t)', flex: 1, minWidth: 0 }}>{d.chain.name}</h2>
        {isAdmin && <button style={btn()} onClick={() => onEdit(d.chain)}>Правило</button>}
        {isAdmin && <button style={btn(true)} onClick={() => setAdding(true)}>+ Добавить точки</button>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, minmax(0,1fr))' : 'repeat(4, minmax(0,1fr))', gap: 10 }}>
        <Kpi label="Выручка сети" value={moneyShort(rev)} sub={<Delta cur={rev} prev={revPrev} suffix="к пред." />} />
        <Kpi label="Точек закупали" value={`${buying} из ${all.length}`} sub={<span style={{ fontSize: 11, color: 'var(--t3)' }}>в пред. периоде {buyingPrev}</span>} />
        <Kpi label="Перестали" value={cnt('lost')} tone={cnt('lost') ? 'red' : undefined} hint="Не закупали больше 90 дней" sub={<span style={{ fontSize: 11, color: 'var(--t3)' }}>на паузе {cnt('sleeping')}</span>} />
        <Kpi label="Средний заказ" value={orders ? moneyShort(rev / orders) : '—'} sub={<span style={{ fontSize: 11, color: 'var(--t3)' }}>{num(orders)} заказов</span>} />
      </div>

      <Card title="Выручка и точки по месяцам" pad={12}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 150, overflowX: 'auto', paddingBottom: 2 }}>
          {d.months.map(m => (
            <div key={m.month} title={`${money(m.rev)} · ${m.points} точек`} style={{ flex: '1 0 34px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, height: '100%', justifyContent: 'flex-end' }}>
              <span style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 700 }}>{m.points}</span>
              <div style={{ width: '70%', height: `${Math.max(2, (m.rev / mMax) * 100)}%`, background: 'var(--primary)', borderRadius: '4px 4px 0 0', opacity: .85 }} />
              <span style={{ fontSize: 10, color: 'var(--t3)', whiteSpace: 'nowrap' }}>{new Date(m.month + 'T00:00:00').toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '')}</span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>Столбик — выручка за месяц, число над ним — сколько точек закупали.</div>
      </Card>

      <div style={{ overflowX: 'auto' }}>
        <Segmented value={tab} onChange={setTab} options={[{ value: 'points', label: 'Точки', count: all.length }, { value: 'products', label: 'Что покупают' }]} />
      </div>

      {tab === 'points' ? (
        <Card pad={12}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
              <Segmented value={st} onChange={setSt} options={[
                { value: 'all', label: 'Все', count: all.length }, { value: 'active', label: 'Закупают', count: cnt('active') },
                { value: 'sleeping', label: 'Пауза', count: cnt('sleeping') }, { value: 'lost', label: 'Перестали', count: cnt('lost') },
              ]} />
            </div>
            <SearchInput value={q} onChange={setQ} placeholder="Точка, БИН, телефон" grow maxWidth={280} />
            <button style={btn()} onClick={() => downloadCsv(`set_${d.chain.name}.csv`,
              ['Точка', 'БИН', 'Телефон', 'Менеджер', 'Статус', 'Последняя закупка', 'Выручка за период', 'Выручка пред. период', 'Заказов'],
              pts.map(p => [p.name, p.bin, p.phone, p.manager, ST[p.status].label, p.last_day, Math.round(p.rev), Math.round(p.rev_prev), p.orders]))}>CSV</button>
          </div>
          <TableWrap maxHeight={560}>
            <thead><tr>
              <th style={th}>Точка</th><th style={th}>Статус</th><th style={th}>Последняя</th>
              <th style={thNum}>Выручка</th><th style={th}>К пред.</th><th style={th}>Телефон</th>{isAdmin && <th style={th} />}
            </tr></thead>
            <tbody>
              {pts.map(p => (
                <tr key={p.ref}>
                  <td style={td}>
                    <button onClick={() => onClient(p.ref, p.name)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--t)', fontWeight: 700, fontFamily: 'inherit', fontSize: 13, textAlign: 'left' }}>{p.name}</button>
                    <div style={{ fontSize: 11, color: 'var(--t3)' }}>{[p.bin && `БИН ${p.bin}`, p.manager, p.source === 'manual' ? 'добавлена вручную' : null].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td style={td}><Pill s={p.status} /></td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{dateRu(p.last_day)}</td>
                  <td style={tdNum}>{p.rev ? money(p.rev) : '—'}</td>
                  <td style={td}><Delta cur={p.rev} prev={p.rev_prev} /></td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{p.phone ? <a href={telHref(p.phone)} style={{ color: 'var(--primary2)', fontWeight: 700, textDecoration: 'none' }}>{p.phone.split(',')[0]}</a> : '—'}</td>
                  {isAdmin && <td style={td}><button title="Убрать из сети" disabled={remove.isPending} onClick={() => confirm(`Убрать «${p.name}» из сети ${d.chain.name}?`) && remove.mutate(p)} style={{ ...btn(), padding: '3px 8px', fontSize: 12 }}>✕</button></td>}
                </tr>
              ))}
              {pts.length === 0 && <tr><td style={{ ...td, color: 'var(--t3)' }} colSpan={7}>Нет точек</td></tr>}
            </tbody>
          </TableWrap>
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0,1fr)' : 'minmax(0,1fr) minmax(0,2fr)', gap: 14 }}>
          <Card title="Категории" pad={12}>
            {d.categories.length === 0 ? <div style={{ fontSize: 13, color: 'var(--t3)' }}>Нет продаж за период.</div> :
              d.categories.map(c => (
                <div key={c.name} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
                    <span style={{ color: 'var(--t)', fontWeight: 600 }}>{c.name}</span>
                    <span style={{ whiteSpace: 'nowrap' }}><b>{moneyShort(c.rev)}</b> <span style={{ color: 'var(--t3)', fontSize: 11 }}>{c.points} т.</span></span>
                  </div>
                  <Bar value={c.rev} max={catMax} />
                </div>
              ))}
          </Card>
          <Card title="Товары" pad={12} hint="Топ-40 товаров сети за период. «Точек» — сколько точек сети брали товар.">
            <TableWrap maxHeight={560}>
              <thead><tr><th style={th}>Товар</th><th style={thNum}>Кол-во</th><th style={thNum}>Выручка</th><th style={thNum}>Точек</th></tr></thead>
              <tbody>
                {d.products.map((p, i) => (
                  <tr key={i}>
                    <td style={td}>{p.name}<div style={{ fontSize: 11, color: 'var(--t3)' }}>{p.category}</div></td>
                    <td style={tdNum}>{num(p.qty)}</td><td style={tdNum}>{money(p.rev)}</td>
                    <td style={tdNum}>{p.points} / {buying || all.length}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>
        </div>
      )}

      {adding && <AddPointsModal chainId={id} chainName={d.chain.name} onClose={() => setAdding(false)} />}
      {editModal}
    </div>
  )
}

function AddPointsModal({ chainId, chainName, onClose }: { chainId: number; chainName: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { toast } = useCRM()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const term = q.trim().length >= 2 ? q.trim() : null
  const s = useQuery({ queryKey: ['chain-suggest', chainId, term], queryFn: () => fetchChainSuggest(chainId, term), staleTime: 30_000 })
  const add = useMutation({
    mutationFn: () => setChainMembers(chainId, [...sel], true),
    onSuccess: (r) => { toast(`Добавлено в сеть: ${r.changed}`); qc.invalidateQueries({ queryKey: ['sales-analytics'] }); onClose() },
    onError: e => toast((e as Error).message, 5000),
  })
  const toggle = (ref: string) => setSel(prev => { const n = new Set(prev); if (n.has(ref)) n.delete(ref); else n.add(ref); return n })
  return (
    <Modal onClose={onClose} maxWidth={640}>
      <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--t)', marginBottom: 4 }}>Добавить точки в «{chainName}»</div>
      <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 10 }}>
        Поиск по названию, БИН или телефону. Без поиска показаны карточки с тем же телефоном, что у точек сети.
      </div>
      <SearchInput value={q} onChange={setQ} placeholder="Например: ИП Ахметова, 9408…, +7 701…" grow maxWidth={600} />
      <div style={{ maxHeight: 380, overflowY: 'auto', margin: '10px 0', border: '1px solid var(--bd)', borderRadius: 10 }}>
        {s.isLoading ? <LoadingBox minHeight={120} /> : (s.data ?? []).length === 0 ? (
          <div style={{ padding: 14, fontSize: 13, color: 'var(--t3)' }}>{term ? 'Ничего не найдено' : 'Подсказок по телефону нет — воспользуйтесь поиском'}</div>
        ) : s.data!.map(c => (
          <label key={c.ref} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 12px', borderBottom: '1px solid var(--bd)', cursor: 'pointer' }}>
            <input type="checkbox" checked={sel.has(c.ref)} onChange={() => toggle(c.ref)} style={{ marginTop: 3 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t)' }}>{c.name}</div>
              <div style={{ fontSize: 11, color: 'var(--t3)' }}>
                {[c.bin && `БИН ${c.bin}`, c.phone, c.rev ? `${moneyShort(c.rev)} за год` : 'нет продаж за год',
                  c.in_chain && !c.excluded ? `сейчас в сети «${c.in_chain}» — будет перенесена` : null].filter(Boolean).join(' · ')}
              </div>
            </div>
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button style={btn()} onClick={onClose}>Отмена</button>
        <button style={{ ...btn(true), opacity: sel.size ? 1 : .5 }} disabled={!sel.size || add.isPending} onClick={() => add.mutate()}>
          {add.isPending ? 'Сохраняю…' : `Добавить${sel.size ? ` (${sel.size})` : ''}`}
        </button>
      </div>
    </Modal>
  )
}

function ChainEditModal({ v, onClose }: { v: { id: number | null; name: string; pattern: string }; onClose: () => void }) {
  const qc = useQueryClient()
  const { toast } = useCRM()
  const [name, setName] = useState(v.name)
  const [pattern, setPattern] = useState(v.pattern)
  const save = useMutation({
    mutationFn: () => saveChain(v.id, name, pattern.trim() || null),
    onSuccess: (r) => { toast(r.added ? `Сохранено, по правилу добавлено точек: ${r.added}` : 'Сохранено'); qc.invalidateQueries({ queryKey: ['sales-analytics'] }); onClose() },
    onError: e => toast((e as Error).message, 5000),
  })
  return (
    <Modal onClose={onClose} maxWidth={480}>
      <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--t)', marginBottom: 12 }}>{v.id ? 'Сеть' : 'Новая сеть'}</div>
      <label style={labelStyle}>Название сети</label>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Например: Coffee Boom" style={{ ...inputStyle, marginBottom: 12 }} />
      <label style={labelStyle}>Правило по названию (необязательно)</label>
      <input value={pattern} onChange={e => setPattern(e.target.value)} placeholder="coffee\s*boom|кофе\s*бум" style={{ ...inputStyle, fontFamily: 'monospace' }} />
      <div style={{ fontSize: 11, color: 'var(--t3)', margin: '6px 0 14px', lineHeight: 1.45 }}>
        Карточки 1С, в названии которых встречается одно из слов через «|», попадут в сеть автоматически (регистр не важен, \s* — «пробел или без пробела»).
        Уже убранные вручную точки правило не вернёт. ИП без бренда в названии добавляйте кнопкой «Добавить точки».
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button style={btn()} onClick={onClose}>Отмена</button>
        <button style={btn(true)} disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Сохраняю…' : 'Сохранить'}</button>
      </div>
    </Modal>
  )
}
