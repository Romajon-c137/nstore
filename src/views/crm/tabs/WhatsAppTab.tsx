'use client'

import { useLanguage } from '@/shared/i18n/LanguageContext'
import { supabase } from '@/shared/lib/supabase'
import { Spinner } from '@/shared/ui/ui'
import { useCRM } from '@/views/crm/context/CRMContext'
import { SearchInput,Segmented,useIsMobile } from '@/views/crm/shared/crmui'
import BroadcastPanel from '@/views/crm/tabs/whatsapp/BroadcastPanel'
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { useEffect,useMemo,useRef,useState } from 'react'

/* ── Mobile hook ── */

// ─── Types ────────────────────────────────────────────────────────────────────

interface Conversation {
  id: string
  wa_id: string
  display_name: string
  last_message: string | null
  last_message_at: string | null
  unread_count: number
}

interface Message {
  id: string
  conversation_id: string
  wa_message_id: string | null
  direction: 'in' | 'out'
  body: string | null
  type: string | null
  status: string | null
  sender_name: string | null
  created_at: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Флаг доступности Supabase Realtime (WebSocket). На уровне модуля, чтобы после
// первого провала (напр. iOS Safari бросает "The operation is insecure.") не
// пытаться переподключаться при каждом выборе чата — данные всё равно
// обновляются периодическим опросом.
let realtimeSupported = true

function timeAgo(iso: string | null, lang = 'ru') {
  if (!iso) return ''
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return lang === 'kz' ? 'жаңа ғана' : 'только что'
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + ' мин'
  if (diff < 86_400_000) return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
}

function initials(name: string) {
  const p = name.trim().split(/\s+/)
  return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase()
}

const AC = ['#2E9E6B','#34C759','#FF3B30','#FF9500','#5AC8FA','#007AFF','#5856D6']
function avColor(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) & 0xffff; return AC[h % AC.length] }

// ─── Conversation Item ────────────────────────────────────────────────────────

function ConvItem({ conv, active, onClick }: { conv: Conversation; active: boolean; onClick: () => void }) {
  const { lang } = useLanguage()
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', gap: 12, alignItems: 'center', padding: '13px 16px',
        cursor: 'pointer', borderBottom: '1px solid var(--bd)',
        background: active ? '#25D36615' : 'transparent',
        transition: 'background .1s', minHeight: 72,
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg3)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      <div style={{
        width: 46, height: 46, borderRadius: 23, background: avColor(conv.wa_id),
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontWeight: 700, fontSize: 16, flexShrink: 0,
      }}>
        {initials(conv.display_name)}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--t)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
            {conv.display_name}
          </span>
          <span style={{ fontSize: 11, color: 'var(--t3)', flexShrink: 0, marginLeft: 8 }}>{timeAgo(conv.last_message_at, lang)}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--t3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {conv.last_message ?? 'Нет сообщений'}
          </span>
          {conv.unread_count > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 700, minWidth: 20, height: 20, borderRadius: 10,
              background: '#25D366', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', flexShrink: 0,
            }}>
              {conv.unread_count}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function Bubble({ msg }: { msg: Message }) {
  const out = msg.direction === 'out'
  return (
    <div style={{ display: 'flex', justifyContent: out ? 'flex-end' : 'flex-start', marginBottom: 6, padding: '0 12px' }}>
      <div style={{
        maxWidth: '78%', padding: '9px 13px', borderRadius: out ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
        background: out ? '#25D366' : 'var(--bg2)',
        color: out ? '#fff' : 'var(--t)',
        boxShadow: '0 1px 4px rgba(0,0,0,.1)',
      }}>
        {!out && msg.sender_name && (
          <div style={{ fontSize: 10, fontWeight: 700, color: '#25D366', marginBottom: 3 }}>{msg.sender_name}</div>
        )}
        <div style={{ fontSize: 13, lineHeight: 1.5, wordBreak: 'break-word' }}>{msg.body}</div>
        <div style={{ fontSize: 10, color: out ? 'rgba(255,255,255,.7)' : 'var(--t3)', marginTop: 4, textAlign: 'right' }}>
          {new Date(msg.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  )
}

// ─── Date Divider ─────────────────────────────────────────────────────────────

function DateDiv({ date }: { date: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px 6px' }}>
      <div style={{ flex: 1, height: 1, background: 'var(--bd)' }} />
      <span style={{ fontSize: 11, color: 'var(--t3)', fontWeight: 600, whiteSpace: 'nowrap' }}>{date}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--bd)' }} />
    </div>
  )
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

export default function WhatsAppTab() {
  const isMobile = useIsMobile()
  const qc = useQueryClient()
  const { toast, profile, can } = useCRM()
  const isReadonly = can('whatsapp') === 'view'
  const { tr } = useLanguage()

  const [view, setView] = useState<'chats' | 'broadcast'>('chats')
  const [selected, setSelected] = useState<Conversation | null>(null)
  const [showChat, setShowChat] = useState(false) // mobile: show chat panel
  const [convSearch, setConvSearch] = useState('')
  const [text, setText] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Conversations
  const { data: conversations = [], isLoading: convsLoading } = useQuery<Conversation[]>({
    queryKey: ['wa-conversations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wa_conversations')
        .select('*')
        .order('last_message_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as Conversation[]
    },
    staleTime: 15_000,
    refetchInterval: 15_000,
  })

  // Messages
  const { data: messages = [], isLoading: msgsLoading } = useQuery<Message[]>({
    queryKey: ['wa-messages', selected?.id],
    queryFn: async () => {
      if (!selected) return []
      const { data, error } = await supabase
        .from('wa_messages')
        .select('*')
        .eq('conversation_id', selected.id)
        .order('created_at')
      if (error) throw error
      return (data ?? []) as Message[]
    },
    enabled: !!selected,
    staleTime: 10_000,
    refetchInterval: 10_000,
  })

  // Realtime — best-effort. На iOS Safari (приватный режим, блокировка
  // кросс-сайтовых соединений, Lockdown Mode) вызов new WebSocket() бросает
  // "The operation is insecure.", и Supabase превращает это в исключение
  // "WebSocket not available: ...". Раньше оно летело прямо из useEffect в
  // ErrorBoundary и роняло всю вкладку. Теперь ловим ошибку и молча переходим
  // на периодический опрос (refetchInterval уже настроен на запросах выше).
  useEffect(() => {
    if (!selected || !realtimeSupported) return
    let ch: ReturnType<typeof supabase.channel> | null = null
    try {
      ch = supabase
        .channel(`wa-msgs-${selected.id}`)
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'wa_messages',
          filter: `conversation_id=eq.${selected.id}`,
        }, () => {
          qc.invalidateQueries({ queryKey: ['wa-messages', selected.id] })
          qc.invalidateQueries({ queryKey: ['wa-conversations'] })
        })
        .subscribe()
    } catch (e) {
      // WebSocket недоступен — отключаем realtime до перезагрузки страницы,
      // чтобы не пытаться подключиться на каждый выбор чата.
      realtimeSupported = false
      console.warn('[WhatsApp] realtime недоступен, работаем через опрос:', e)
    }
    return () => {
      if (!ch) return
      try { supabase.removeChannel(ch) } catch { /* ignore */ }
    }
  }, [selected?.id, qc])

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: messages.length <= 20 ? 'instant' : 'smooth' })
  }, [messages.length])

  // Mark as read
  useEffect(() => {
    if (!selected || selected.unread_count === 0) return
    supabase.from('wa_conversations').update({ unread_count: 0 }).eq('id', selected.id).then(() => {
      qc.invalidateQueries({ queryKey: ['wa-conversations'] })
    })
  }, [selected?.id, qc])

  const sendMut = useMutation({
    mutationFn: async (body: string) => {
      if (!selected) return
      const { error } = await supabase.from('wa_messages').insert({
        conversation_id: selected.id,
        direction: 'out',
        body,
        type: 'text',
        status: 'sent',
        sender_name: profile?.name ?? 'Менеджер',
      })
      if (error) throw error
      await supabase.from('wa_conversations').update({
        last_message: body,
        last_message_at: new Date().toISOString(),
      }).eq('id', selected.id)
    },
    onSuccess: () => {
      setText('')
      qc.invalidateQueries({ queryKey: ['wa-messages', selected?.id] })
      qc.invalidateQueries({ queryKey: ['wa-conversations'] })
    },
    onError: (e: any) => toast(e.message),
  })

  const handleSend = () => {
    const t = text.trim()
    if (!t || sendMut.isPending) return
    sendMut.mutate(t)
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const grouped = useMemo(() => {
    const groups: { date: string; msgs: Message[] }[] = []
    for (const m of messages) {
      const d = new Date(m.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' })
      const last = groups[groups.length - 1]
      if (last?.date === d) last.msgs.push(m)
      else groups.push({ date: d, msgs: [m] })
    }
    return groups
  }, [messages])

  const filteredConvs = useMemo(() => convSearch
    ? conversations.filter(c => c.display_name.toLowerCase().includes(convSearch.toLowerCase()) || (c.wa_id ?? '').includes(convSearch))
    : conversations, [conversations, convSearch])

  const handleSelectConv = (conv: Conversation) => {
    setSelected(conv)
    if (isMobile) setShowChat(true)
  }

  const handleBack = () => {
    setShowChat(false)
    setSelected(null)
    setText('')
  }

  // ── Chat panel ──
  const ChatPanel = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
      {/* Chat header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--bd)', background: 'var(--bg2)', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        {isMobile && (
          <button
            onClick={handleBack}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--t)', padding: '0 4px 0 0', lineHeight: 1, flexShrink: 0 }}
          >
            ←
          </button>
        )}
        {selected && (
          <>
            <div style={{ width: 40, height: 40, borderRadius: 20, background: avColor(selected.wa_id), display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
              {initials(selected.display_name)}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--t)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.display_name}</div>
              <div style={{ fontSize: 11, color: 'var(--t3)' }}>+{selected.wa_id}</div>
            </div>
          </>
        )}
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', paddingTop: 8, paddingBottom: 8,
        background: 'var(--bg)',
        backgroundImage: 'radial-gradient(var(--bd) 1px, transparent 0)',
        backgroundSize: '20px 20px',
      }}>
        {msgsLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}>
            <Spinner size={24} color="#25D366" />
          </div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--t3)', fontSize: 13, paddingTop: 40 }}>{tr('waNoMessages')}</div>
        ) : (
          grouped.map(({ date, msgs }) => (
            <div key={date}>
              <DateDiv date={date} />
              {msgs.map(m => <Bubble key={m.id} msg={m} />)}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '10px 12px', borderTop: '1px solid var(--bd)', background: 'var(--bg2)', display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
        {isReadonly ? (
          <div style={{ flex: 1, padding: '10px 14px', borderRadius: 22, border: '1.5px solid var(--bd)', background: 'var(--bg3)', color: 'var(--t3)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
            Только просмотр — отправка сообщений недоступна
          </div>
        ) : (
          <>
            <textarea
              ref={inputRef}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKey}
              placeholder={tr('waInputPh')}
              rows={1}
              style={{
                flex: 1, padding: '10px 14px', borderRadius: 22, border: '1.5px solid var(--bd)',
                background: 'var(--bg3)', color: 'var(--t)', fontSize: 13,
                outline: 'none', resize: 'none', lineHeight: 1.5,
                maxHeight: 120, overflowY: 'auto', boxSizing: 'border-box',
                fontFamily: 'inherit',
              }}
              onInput={e => {
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = Math.min(el.scrollHeight, 120) + 'px'
              }}
            />
            <button
              onClick={handleSend}
              disabled={!text.trim() || sendMut.isPending}
              style={{
                width: 44, height: 44, borderRadius: 22, border: 'none',
                background: text.trim() ? '#25D366' : 'var(--bd)',
                color: '#fff', cursor: text.trim() ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, flexShrink: 0, transition: 'background .15s',
              }}
            >
              {sendMut.isPending ? (
                <Spinner size={16} color="#fff" track="rgba(255,255,255,.5)" />
              ) : '→'}
            </button>
          </>
        )}
      </div>
    </div>
  )

  // ── Conversations list ──
  const ConvList = (
    <div style={{
      width: isMobile ? '100%' : 300, flexShrink: 0,
      borderRight: isMobile ? 'none' : '1px solid var(--bd)',
      display: 'flex', flexDirection: 'column', background: 'var(--bg2)',
      minHeight: 0,
    }}>
      {/* Header */}
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
        <SearchInput value={convSearch} onChange={setConvSearch} placeholder={tr('waSearch')} grow maxWidth={99999} />
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {convsLoading ? (
          <div style={{ padding: 16 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ height: 72, borderRadius: 10, background: 'var(--bg3)', marginBottom: 6, animation: 'pulse 1.4s ease-in-out infinite' }} />
            ))}
          </div>
        ) : filteredConvs.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--t3)', fontSize: 13, paddingTop: 40, padding: '40px 16px 0' }}>{tr('waNoChats')}</div>
        ) : filteredConvs.map(c => (
          <ConvItem key={c.id} conv={c} active={selected?.id === c.id} onClick={() => handleSelectConv(c)} />
        ))}
      </div>
    </div>
  )

  // ── Top-level tab switcher: Чаты / Рассылка ──
  const ViewSwitcher = (
    <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--bd)', background: 'var(--bg2)', flexShrink: 0 }}>
      <Segmented
        options={[
          { value: 'chats', label: 'Чаты' },
          { value: 'broadcast', label: 'Рассылка' },
        ]}
        value={view}
        onChange={setView}
      />
    </div>
  )

  // ── Mobile: show one panel at a time ──
  if (isMobile) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg)' }}>
        {!(showChat && selected) && ViewSwitcher}
        {view === 'broadcast' ? <BroadcastPanel /> : (showChat && selected ? ChatPanel : ConvList)}
      </div>
    )
  }

  // ── Desktop: side-by-side ──
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg)', overflow: 'hidden' }}>
      {ViewSwitcher}
      {view === 'broadcast' ? <BroadcastPanel /> : (
        <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
          {ConvList}
          {!selected ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: 'var(--t3)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--t)' }}>{tr('waSelectChat')}</div>
              <div style={{ fontSize: 13 }}>{tr('waSelectChatDesc')}</div>
            </div>
          ) : ChatPanel}
        </div>
      )}
    </div>
  )
}
