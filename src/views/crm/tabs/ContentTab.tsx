'use client'

import { categorySlug,productSlug } from '@/shared/lib/seo'
import { supabase } from '@/shared/lib/supabase'
import { Spinner } from '@/shared/ui/ui'
import { uploadImage } from '@/views/crm/board/shared'
import { useCRM } from '@/views/crm/context/CRMContext'
import { useIsMobile } from '@/views/crm/shared/crmui'
import TrafficTab from '@/views/crm/tabs/TrafficTab'
import { useEffect,useRef,useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Viewport = 'desktop' | 'tablet' | 'mobile'

type BlockType =
  | 'promo_bar' | 'header' | 'categories_chips' | 'usp_hero' | 'hero'
  | 'products' | 'cat_grid' | 'terms' | 'b2b_banner' | 'steps' | 'perks' | 'footer'
  | 'text' | 'reviews' | 'form' | 'promo_sale'

interface BlockDef {
  type: BlockType
  label: string
  color: string
  defaultProps: Record<string, unknown>
}

interface CanvasBlock {
  id: string
  type: BlockType
  props: Record<string, unknown>
}

// Live catalog data pulled from Supabase so the editor manages the REAL catalog
interface SectionInfo { name: string; count: number }
interface PreviewProduct { id: string; name: string; price: number | null; image_url: string | null; section_name: string | null }

// ─── Block library ────────────────────────────────────────────────────────────

const DEFAULT_PERKS = [
  { icon: '', title: 'Доставка сегодня', desc: 'Заказы до 18:00 — привезём в этот же день' },
  { icon: '', title: 'Удобная оплата', desc: 'Картой онлайн, при получении или по счёту' },
  { icon: '', title: 'Свежесть', desc: 'Холодовая цепь и контроль сроков годности' },
  { icon: '', title: 'Лёгкий возврат', desc: 'Вернём деньги, если товар не подошёл' },
]

const DEFAULT_HERO_STATS = [
  { value: '1197+', label: 'товаров в каталоге' },
  { value: '500+',  label: 'клиентов' },
  { value: '7 лет',  label: 'на рынке' },
]

const DEFAULT_TERMS = [
  { title: 'Доставка по Астане',              desc: 'Бесплатно при заказе от 30 000 ₸, иначе 1 500 ₸. Оформление до 09:00 — доставка в тот же день' },
  { title: 'Доставка по Казахстану и СНГ',    desc: 'Отправляем в любой регион, стоимость доставки оплачивает покупатель' },
  { title: 'Оплата',                          desc: 'Наличными курьеру или по QR (Kaspi), безналичный расчёт, перевод на Kaspi' },
  { title: 'Самовывоз',                       desc: 'г. Астана, ул. Керей Жанибек ханов, д. 50, офис №6' },
]

const DEFAULT_STEPS = [
  { title: 'Заявка',   desc: 'Оставьте заявку на сайте или напишите менеджеру' },
  { title: 'Договор',  desc: 'Согласуем условия и подпишем договор поставки' },
  { title: 'Поставка', desc: 'Открываем доступ в B2B-кабинет и начинаем поставки' },
]

const BLOCK_DEFS: BlockDef[] = [
  {
    type: 'promo_bar', label: 'Промо-полоса', color: '#FFF4E6',
    defaultProps: { text: 'Бесплатная доставка от 8 000 ₸ по городу', bgColor: '#0E7C46' },
  },
  {
    type: 'header', label: 'Шапка / меню', color: '#E8F4FF',
    defaultProps: { logo: 'nstore', city: 'Астана', showSearch: true, showCart: true, showB2B: true },
  },
  {
    type: 'categories_chips', label: 'Категории (чипы)', color: '#FFF0F0',
    defaultProps: { items: ['Все товары', 'Молочное', 'Кофе и чай', 'Напитки', 'Соусы', 'Вода', 'Снеки'] },
  },
  {
    type: 'usp_hero', label: 'Hero (УТП + цифры)', color: '#0E1E16',
    defaultProps: {
      title: 'Продукты питания оптом и в розницу',
      subtitle: 'Прямые поставки от дистрибьютора — свежесть, цены и сроки под контролем',
      primaryBtnText: 'Смотреть каталог', secondaryBtnText: 'Стать партнёром B2B',
      stats: DEFAULT_HERO_STATS,
    },
  },
  {
    type: 'hero', label: 'Баннер-герой', color: '#EAF6EE',
    defaultProps: {
      title: '−20% на молоко и сливки', subtitle: 'СВЕЖАЯ МОЛОЧКА КАЖДОЕ УТРО', btnText: 'Смотреть',
      promos: [
        { title: 'Кофе недели', desc: 'Свежая обжарка от 3 990 ₸/кг', bg: '#F4EEFE', color: '#5B21D6' },
        { title: 'Соусы Азии', desc: 'Терияки, соевый, устричный', bg: '#FFF4E6', color: '#B25E00' },
      ],
    },
  },
  {
    type: 'products', label: 'Сетка товаров', color: '#F0F8FF',
    defaultProps: { title: 'Популярное', columns: 6, count: 12, section: '' },
  },
  {
    type: 'cat_grid', label: 'Категории (сетка)', color: '#F4EEFE',
    defaultProps: {
      title: 'Категории',
      items: [
        { name: 'Молочное', count: '320 товаров', icon: '', tile: '#EAF6EE' },
        { name: 'Кофе и чай', count: '180 товаров', icon: '', tile: '#F1ECE5' },
        { name: 'Напитки', count: '240 товаров', icon: '', tile: '#FFF1DD' },
        { name: 'Соусы', count: '95 товаров', icon: '', tile: '#ECEAE6' },
        { name: 'Вода', count: '60 товаров', icon: '', tile: '#E7F3F4' },
        { name: 'Снеки', count: '150 товаров', icon: '', tile: '#F4EEFE' },
      ],
    },
  },
  {
    type: 'terms', label: 'Условия работы', color: '#F4EEFE',
    defaultProps: { title: 'Условия работы', items: DEFAULT_TERMS },
  },
  {
    type: 'b2b_banner', label: 'B2B Баннер', color: '#EDE3FB',
    defaultProps: {
      title: 'Закупаете для кафе, магазина или офиса?',
      desc: 'Оптовые цены, отсрочка платежа и персональный менеджер в B2B-кабинете. Перенос корзины в один клик.',
      btnText: 'Открыть опт B2B',
    },
  },
  {
    type: 'steps', label: 'Как начать работу', color: '#EAF6EE',
    defaultProps: { title: 'Как начать работу', items: DEFAULT_STEPS },
  },
  {
    type: 'perks', label: 'Преимущества', color: '#EAF6EE',
    defaultProps: { items: DEFAULT_PERKS },
  },
  {
    type: 'text', label: 'Текст', color: '#FFFBEB',
    defaultProps: { content: 'Введите текст здесь…', align: 'left' },
  },
  {
    type: 'reviews', label: 'Отзывы', color: '#F5F0FF',
    defaultProps: {
      title: 'Отзывы клиентов',
      items: [
        { text: 'Отличный сервис, доставка в срок!', author: 'Айгерим К.' },
        { text: 'Качество продуктов на высоте.', author: 'Данияр М.' },
        { text: 'Рекомендую всем, кто ищет оптом.', author: 'Светлана П.' },
      ],
    },
  },
  {
    type: 'form', label: 'Форма "Стать партнёром"', color: '#F0FFF4',
    defaultProps: { title: 'Стать партнёром', btnText: 'Отправить заявку', showEmail: false, showCompany: true, showSegment: true, showComment: true },
  },
  {
    type: 'footer', label: 'Футер', color: '#E8F0EC',
    defaultProps: { city: 'Астана', phone: '+7 700 720 0006', email: 'sales.nstore@gmail.com' },
  },
  {
    type: 'promo_sale', label: 'Акция / скидка', color: '#EDE3FB',
    defaultProps: { title: 'Акция месяца', description: 'Специальное предложение на выбранные категории', discount_pct: 20, end_date: '' },
  },
]

const DEF_MAP = Object.fromEntries(BLOCK_DEFS.map(d => [d.type, d])) as Record<BlockType, BlockDef>
const VIEWPORT_W: Record<Viewport, number> = { desktop: 960, tablet: 768, mobile: 390 }

function uid() { return Math.random().toString(36).slice(2, 9) }

// ─── Inline-editable text (Tilda-style: edit directly on the canvas) ────────────

function Editable({ value, editable, onCommit, style, multiline }: {
  value: string; editable: boolean; onCommit: (v: string) => void
  style?: React.CSSProperties; multiline?: boolean
}) {
  const ref = useRef<HTMLSpanElement>(null)
  if (!editable) return <span style={style}>{value}</span>
  return (
    <span
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      draggable={false}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onDragStart={e => e.preventDefault()}
      onBlur={() => { const t = ref.current?.innerText ?? ''; if (t !== value) onCommit(t) }}
      onKeyDown={e => {
        if (!multiline && e.key === 'Enter') { e.preventDefault(); ref.current?.blur() }
        if (e.key === 'Escape') { if (ref.current) ref.current.innerText = value; ref.current?.blur() }
      }}
      style={{ ...style, outline: 'none', cursor: 'text', borderRadius: 3, boxShadow: '0 0 0 1px rgba(16,163,91,.35)', padding: '0 2px', margin: '0 -2px' }}
    >{value}</span>
  )
}

// ─── Block preview ─────────────────────────────────────────────────────────────

function BlockPreview({ block, vp, selected, sections, catalog, onEditProp }: { block: CanvasBlock; vp: Viewport; selected: boolean; sections: SectionInfo[]; catalog: PreviewProduct[]; onEditProp?: (key: string, value: string) => void }) {
  const def = DEF_MAP[block.type] || { label: block.type, color: '#eee' }
  const p = block.props
  const sm = vp === 'mobile'
  // Inline-editable text bound to a top-level string prop; active only for the selected block
  const E = (key: string, elStyle: React.CSSProperties, opts?: { multiline?: boolean }) => (
    <Editable value={(p[key] as string) || ''} editable={selected && !!onEditProp} multiline={opts?.multiline}
      onCommit={v => onEditProp?.(key, v)} style={elStyle} />
  )

  const wrapper: React.CSSProperties = {
    background: 'var(--bg2)',
    border: `2px solid ${selected ? 'var(--primary)' : 'var(--bd)'}`,
    borderRadius: 12, overflow: 'hidden', cursor: 'pointer', position: 'relative',
    transition: 'border-color .15s',
    boxShadow: selected ? '0 0 0 3px rgba(16,163,91,.15)' : 'none',
  }

  if (block.type === 'promo_bar') return (
    <div style={wrapper}>
      <div style={{ background: (p.bgColor as string) || '#0E7C46', color: '#EAFBF1', padding: '8px 16px', textAlign: 'center', fontSize: sm ? 11 : 13, fontWeight: 600 }}>
        {E('text', {})}
      </div>
    </div>
  )

  if (block.type === 'header') return (
    <div style={wrapper}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: sm ? '10px 12px' : '12px 20px', borderBottom: '1px solid var(--bd)' }}>
        <div style={{ width: 26, height: 26, borderRadius: 7, background: 'linear-gradient(135deg,#10A35B,#7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 13 }}>N</div>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: sm ? 11 : 15, color: '#0E1E16' }}>nstore</span>
        {!sm && <div style={{ flex: 1, height: 30, background: 'var(--bg3)', borderRadius: 8 }} />}
        <div style={{ width: 38, height: 24, borderRadius: 6, background: 'var(--bg3)', display: 'flex', overflow: 'hidden' }}>
          <div style={{ flex: 1, background: 'var(--primary)' }} />
          <div style={{ flex: 1 }} />
        </div>
        <div style={{ width: 36, height: 24, borderRadius: 6, background: 'var(--primary)' }} />
      </div>
    </div>
  )

  if (block.type === 'categories_chips') {
    // Live page auto-generates chips from real catalog sections (respecting hide/order), so preview them too
    const hidden = Array.isArray(p.hidden) ? (p.hidden as string[]) : []
    const order = Array.isArray(p.order) ? (p.order as string[]) : []
    let names = sections.map(s => s.name).filter(n => !hidden.includes(n))
    if (order.length > 0) {
      const inSet = new Set(names)
      names = [...order.filter(n => inSet.has(n)), ...names.filter(n => !order.includes(n))]
    }
    const chips = sections.length > 0 ? ['Все товары', ...names] : ((p.items as string[]) || [])
    return (
      <div style={wrapper}>
        <div style={{ padding: sm ? '8px 10px' : '10px 16px', display: 'flex', gap: 5, overflowX: 'hidden', borderBottom: '1px solid var(--bg3)' }}>
          {chips.slice(0, sm ? 3 : 7).map((cat, i) => (
            <span key={i} style={{ flexShrink: 0, background: i === 0 ? '#0E1E16' : 'var(--bg3)', color: i === 0 ? '#fff' : '#28352C', borderRadius: 7, padding: '4px 9px', fontSize: sm ? 9 : 11, fontWeight: 600 }}>{cat}</span>
          ))}
        </div>
      </div>
    )
  }

  if (block.type === 'usp_hero') {
    type StatItem = { value: string; label: string }
    const stats = (p.stats as StatItem[]) || DEFAULT_HERO_STATS
    return (
      <div style={wrapper}>
        <div style={{ background: 'linear-gradient(120deg,#0E1E16,#12291D 55%,#0E7C46)', margin: 8, borderRadius: 12, padding: sm ? '14px' : '18px 22px', color: '#EAFBF1' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: sm ? 12 : 16, lineHeight: 1.2, marginBottom: 6 }}>{E('title', {})}</div>
          <div style={{ fontSize: sm ? 9 : 11, color: '#B9D6C4', marginBottom: 10 }}>{E('subtitle', {})}</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <div style={{ background: '#fff', color: '#0E7C46', borderRadius: 6, padding: '4px 10px', fontWeight: 700, fontSize: sm ? 9 : 11 }}>{E('primaryBtnText', {})}</div>
            {!sm && <div style={{ background: 'rgba(255,255,255,.15)', color: '#fff', borderRadius: 6, padding: '4px 10px', fontWeight: 700, fontSize: 11 }}>{E('secondaryBtnText', {})}</div>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${stats.length}, 1fr)`, gap: 6 }}>
            {stats.map((s, i) => (
              <div key={i} style={{ background: 'rgba(255,255,255,.08)', borderRadius: 8, padding: '6px 8px' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: sm ? 10 : 13 }}>{s.value}</div>
                {!sm && <div style={{ fontSize: 9, color: '#B9D6C4' }}>{s.label}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (block.type === 'hero') {
    const bannerImg = (p.image as string) || ''
    const bannerLinked = !!(p.link as { href?: string } | undefined)?.href
    return (
      <div style={wrapper}>
        <div style={{ display: 'grid', gridTemplateColumns: sm ? '1fr' : '2fr 1fr 1fr', gap: 8, padding: 10 }}>
          <div style={{
            background: bannerImg
              ? `linear-gradient(110deg, rgba(14,124,70,.86), rgba(22,184,106,.62)), url(${bannerImg}) center/cover no-repeat`
              : 'linear-gradient(110deg,#0E7C46,#10A35B 60%,#16B86A)',
            borderRadius: 10, padding: sm ? '14px' : '16px', color: '#EAFBF1', minHeight: sm ? 70 : 80, position: 'relative',
          }}>
            <div style={{ fontSize: sm ? 9 : 10, fontWeight: 700, opacity: .8, marginBottom: 5 }}>{E('subtitle', {})}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: sm ? 10 : 13, lineHeight: 1.2, marginBottom: 8 }}>{E('title', {})}</div>
            <div style={{ display: 'inline-block', background: 'var(--bg2)', color: '#0E7C46', borderRadius: 6, padding: '4px 10px', fontWeight: 700, fontSize: sm ? 9 : 11 }}>{E('btnText', {})}</div>
            {bannerLinked && <span style={{ position: 'absolute', top: 6, right: 6, fontSize: 11 }} title="Есть ссылка">🔗</span>}
          </div>
          {!sm && ((p.promos as Array<{title: string; bg: string; color: string; image?: string; link?: { href?: string }}>) || []).slice(0, 2).map((pr, i) => {
            const hasImg = !!pr.image
            return (
              <div key={i} style={{
                background: hasImg ? `linear-gradient(180deg, rgba(0,0,0,.05), rgba(0,0,0,.45)), url(${pr.image}) center/cover no-repeat` : pr.bg,
                borderRadius: 10, padding: 12, minHeight: 70, display: 'flex', alignItems: 'flex-start', position: 'relative',
              }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, color: hasImg ? '#fff' : pr.color, lineHeight: 1.3, textShadow: hasImg ? '0 1px 4px rgba(0,0,0,.5)' : 'none' }}>{pr.title}</span>
                {!!pr.link?.href && <span style={{ position: 'absolute', top: 6, right: 6, fontSize: 10 }} title="Есть ссылка">🔗</span>}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (block.type === 'products') {
    // Filter the real catalog by the chosen section — true WYSIWYG preview
    const manual = p.mode === 'manual'
    const productIds = Array.isArray(p.productIds) ? (p.productIds as string[]) : []
    const section = (p.section as string) || ''
    let matched: PreviewProduct[]
    if (manual) {
      const byId = new Map(catalog.map(pr => [pr.id, pr]))
      matched = productIds.map(id => byId.get(id)).filter(Boolean) as PreviewProduct[]
    } else {
      matched = section ? catalog.filter(pr => pr.section_name === section) : catalog
    }
    const colsProp = typeof p.columns === 'number' && p.columns >= 2 && p.columns <= 6 ? p.columns : 4
    const cols = sm ? 2 : colsProp
    const shown = matched.slice(0, sm ? 4 : Math.max(8, cols * 2))
    const tiles = ['#EAF6EE','#F4EEFE','#FFF4E6','#E7F3F4','#F0F4E8','#FBE9EE','#F1ECE5','#ECEAE6']
    return (
      <div style={wrapper}>
        <div style={{ padding: sm ? '10px' : '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: sm ? 11 : 15 }}>{E('title', {})}</div>
            <div style={{ fontSize: sm ? 8 : 10, color: 'var(--t3)', fontWeight: 600, flexShrink: 0 }}>
              {manual ? `Выбрано: ${productIds.length}` : `${section || 'Все товары'} · ${matched.length} тов.`}
            </div>
          </div>
          {shown.length === 0 ? (
            <div style={{ padding: '18px 10px', textAlign: 'center', fontSize: sm ? 9 : 11, color: 'var(--t3)', border: '1px dashed var(--bd)', borderRadius: 9 }}>
              {manual
                ? (productIds.length === 0 ? 'Выберите товары в панели справа' : 'Выбранные товары загружаются…')
                : (catalog.length === 0 ? 'Загрузка товаров…' : `В разделе «${section}» нет активных товаров`)}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 7 }}>
              {shown.map((pr, i) => (
                <div key={pr.id} style={{ borderRadius: 9, border: '1px solid var(--bd)', overflow: 'hidden', background: 'var(--bg2)' }}>
                  {pr.image_url
                    ? <div style={{ aspectRatio: '1', background: `#fff url(${pr.image_url}) center/contain no-repeat` }} />
                    : <div style={{ aspectRatio: '1', background: tiles[i % 8], display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: sm ? 16 : 22 }}>📦</div>}
                  <div style={{ padding: '5px 7px' }}>
                    <div style={{ fontSize: sm ? 8 : 10, fontWeight: 600, color: 'var(--t)', lineHeight: 1.25, marginBottom: 3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{pr.name}</div>
                    <div style={{ fontSize: sm ? 8 : 11, fontWeight: 700, color: '#10A35B' }}>{pr.price != null ? `${pr.price.toLocaleString('ru-RU')} ₸` : '—'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (block.type === 'cat_grid') {
    type CatItem = { name: string; icon?: string; tile?: string; image?: string }
    const items = (p.items as CatItem[]) || []
    return (
      <div style={wrapper}>
        <div style={{ padding: sm ? '10px' : '14px 18px' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: sm ? 11 : 15, marginBottom: 8 }}>{E('title', {})}</div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${sm ? 3 : 6}, 1fr)`, gap: 7 }}>
            {items.slice(0, 6).map((c, i) => (
              <div key={i} style={{
                border: '1px solid var(--bd)', borderRadius: 9, padding: '8px 6px', textAlign: 'center',
                minHeight: c.image ? (sm ? 40 : 54) : undefined, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
                background: c.image ? `linear-gradient(180deg, rgba(0,0,0,.05), rgba(0,0,0,.5)), url(${c.image}) center/cover no-repeat` : 'var(--bg2)',
              }}>
                {!c.image && <div style={{ fontSize: sm ? 14 : 18, marginBottom: 4 }}>{c.icon}</div>}
                <div style={{ fontSize: sm ? 8 : 10, fontWeight: 600, color: c.image ? '#fff' : 'var(--t)', lineHeight: 1.2, textShadow: c.image ? '0 1px 4px rgba(0,0,0,.6)' : 'none' }}>{c.name}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (block.type === 'terms') {
    type TermItem = { title: string; desc: string }
    const items = (p.items as TermItem[]) || DEFAULT_TERMS
    return (
      <div style={wrapper}>
        <div style={{ padding: sm ? '10px' : '14px 18px' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: sm ? 11 : 15, marginBottom: 8 }}>{E('title', {})}</div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${sm ? 2 : 4}, 1fr)`, gap: 7 }}>
            {items.slice(0, 4).map((t, i) => (
              <div key={i} style={{ border: '1px solid var(--bd)', borderRadius: 9, padding: '10px' }}>
                <div style={{ fontSize: sm ? 9 : 11, fontWeight: 700, color: 'var(--t)' }}>{t.title}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (block.type === 'b2b_banner') return (
    <div style={wrapper}>
      <div style={{ background: 'linear-gradient(115deg,#3B1574,#5B21D6 55%,#7C3AED)', padding: sm ? '14px' : '18px 22px', margin: 8, borderRadius: 10, color: '#F3ECFF' }}>
        <div style={{ fontSize: sm ? 9 : 10, fontWeight: 700, opacity: .8, marginBottom: 5, letterSpacing: '.06em' }}>ДЛЯ БИЗНЕСА</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: sm ? 11 : 14, lineHeight: 1.2, marginBottom: 8 }}>{E('title', {})}</div>
        <div style={{ display: 'inline-block', background: 'var(--bg2)', color: '#5B21D6', borderRadius: 7, padding: '6px 12px', fontWeight: 700, fontSize: sm ? 10 : 12 }}>{E('btnText', {})}</div>
      </div>
    </div>
  )

  if (block.type === 'steps') {
    type StepItem = { title: string; desc: string }
    const items = (p.items as StepItem[]) || DEFAULT_STEPS
    return (
      <div style={wrapper}>
        <div style={{ padding: sm ? '10px' : '14px 18px' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: sm ? 11 : 15, marginBottom: 8 }}>{E('title', {})}</div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${sm ? 1 : 3}, 1fr)`, gap: 7 }}>
            {items.slice(0, 3).map((s, i) => (
              <div key={i} style={{ border: '1px solid var(--bd)', borderRadius: 9, padding: '10px' }}>
                <div style={{ width: 18, height: 18, borderRadius: 5, background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, marginBottom: 6 }}>{i + 1}</div>
                <div style={{ fontSize: sm ? 9 : 11, fontWeight: 700, color: 'var(--t)' }}>{s.title}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (block.type === 'perks') {
    type PerkItem = { icon: string; title: string; desc: string }
    const items = (p.items as PerkItem[]) || DEFAULT_PERKS
    return (
      <div style={wrapper}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${sm ? 2 : 4}, 1fr)`, gap: 7, padding: sm ? '10px' : '14px 18px' }}>
          {items.slice(0, 4).map((t, i) => (
            <div key={i} style={{ border: '1px solid var(--bd)', borderRadius: 9, padding: '10px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 16 }}>{t.icon}</span>
              <div style={{ fontSize: sm ? 9 : 11, fontWeight: 600, color: 'var(--t)' }}>{t.title}</div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (block.type === 'footer') return (
    <div style={wrapper}>
      <div style={{ background: '#0E1E16', padding: sm ? '12px' : '18px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, background: 'linear-gradient(135deg,#10A35B,#7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 11 }}>N</div>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: sm ? 11 : 13, color: '#fff' }}>nstore</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: sm ? '1fr 1fr' : 'repeat(4,1fr)', gap: 8 }}>
          {['Покупателям', 'Бизнесу', 'Контакты'].map((col, i) => (
            <div key={i}>
              <div style={{ fontSize: sm ? 8 : 10, fontWeight: 700, color: '#fff', marginBottom: 5 }}>{col}</div>
              {[70, 55, 40].map((w, j) => <div key={j} style={{ height: 5, borderRadius: 2, background: '#243A2E', marginBottom: 3, width: `${w}%` }} />)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  if (block.type === 'text') return (
    <div style={wrapper}>
      <div style={{ padding: sm ? '12px' : '16px 20px' }}>
        <div style={{ fontSize: sm ? 11 : 13, color: 'var(--t2)', lineHeight: 1.6 }}>{E('content', {}, { multiline: true })}</div>
      </div>
    </div>
  )

  if (block.type === 'reviews') {
    type ReviewItem = { text: string; author: string }
    const items = (p.items as ReviewItem[]) || []
    return (
      <div style={wrapper}>
        <div style={{ padding: sm ? '12px' : '16px 20px' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: sm ? 11 : 15, marginBottom: 10 }}>{E('title', {})}</div>
          <div style={{ display: 'grid', gridTemplateColumns: sm ? '1fr' : 'repeat(3,1fr)', gap: 7 }}>
            {(sm ? items.slice(0, 1) : items.slice(0, 3)).map((r, i) => (
              <div key={i} style={{ background: '#F9F5FF', borderRadius: 9, padding: '10px' }}>
                <div style={{ fontSize: sm ? 9 : 11, color: 'var(--t)', marginBottom: 4, lineHeight: 1.4 }}>{r.text}</div>
                <div style={{ fontSize: sm ? 9 : 10, fontWeight: 700, color: 'var(--t2)' }}>— {r.author}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (block.type === 'form') return (
    <div style={wrapper}>
      <div style={{ padding: sm ? '12px' : '16px 20px', background: 'var(--bg3)' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: sm ? 11 : 15, marginBottom: 10 }}>{E('title', {})}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {(p.showPhone as boolean) && <div style={{ height: 34, borderRadius: 7, border: '1px solid var(--bd)', background: 'var(--bg2)' }} />}
          {(p.showEmail as boolean) && <div style={{ height: 34, borderRadius: 7, border: '1px solid var(--bd)', background: 'var(--bg2)' }} />}
          <div style={{ height: 34, borderRadius: 7, background: 'var(--primary)' }} />
        </div>
      </div>
    </div>
  )

  if (block.type === 'promo_sale') {
    const disc = (p.discount_pct as number) || 0
    const img = (p.image as string) || ''
    const linked = !!(p.link as { href?: string } | undefined)?.href
    return (
      <div style={wrapper}>
        <div style={{
          background: img
            ? `linear-gradient(130deg, rgba(91,33,214,.88), rgba(124,58,237,.78)), url(${img}) center/cover no-repeat`
            : 'linear-gradient(130deg,#5B21D6,#7C3AED)',
          padding: sm ? '12px' : '16px 20px', display: 'flex', alignItems: 'center', gap: 14, position: 'relative',
        }}>
          {disc > 0 && (
            <div style={{ flexShrink: 0, width: sm ? 44 : 56, height: sm ? 44 : 56, borderRadius: '50%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: sm ? 11 : 14, color: '#7C3AED' }}>−{disc}%</span>
            </div>
          )}
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: sm ? 11 : 14, color: '#fff', marginBottom: 4 }}>{E('title', {})}</div>
            {(p.end_date as string) && <div style={{ fontSize: sm ? 9 : 11, color: 'rgba(255,255,255,.75)' }}>До {new Date(p.end_date as string).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</div>}
          </div>
          {linked && <span style={{ position: 'absolute', top: 6, right: 8, fontSize: 11 }} title="Есть ссылка">🔗</span>}
        </div>
      </div>
    )
  }

  return (
    <div style={wrapper}>
      <div style={{ padding: 14, background: def.color, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--t2)' }}>{def.label}</span>
      </div>
    </div>
  )
}

// ─── Props panel ──────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      {children}
    </div>
  )
}

function PInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      style={{ width: '100%', height: 36, border: '1px solid var(--bd)', borderRadius: 8, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
      onFocus={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
      onBlur={e => (e.currentTarget.style.borderColor = 'var(--bd)')} />
  )
}

// Search-and-pick real products to build a curated showcase
function ProductPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PreviewProduct[]>([])
  const [busy, setBusy] = useState(false)
  // Cache of product meta by id so selected rows can render name/price even after search changes
  const [meta, setMeta] = useState<Record<string, PreviewProduct>>({})

  // Resolve currently-selected ids to display data on mount / when the selection grows
  useEffect(() => {
    const missing = value.filter(id => !meta[id])
    if (missing.length === 0) return
    supabase.from('products').select('id, name, price, image_url, section_name').in('id', missing)
      .then(({ data }) => {
        if (!data) return
        setMeta(m => { const n = { ...m }; (data as PreviewProduct[]).forEach(p => { n[p.id] = p }); return n })
      })
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced live search across the whole active catalog
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    setBusy(true)
    const t = setTimeout(() => {
      supabase.from('products').select('id, name, price, image_url, section_name')
        .eq('is_active', true).ilike('name', `%${q}%`).order('name').limit(25)
        .then(({ data }) => {
          const rows = (data ?? []) as PreviewProduct[]
          setResults(rows)
          setMeta(m => { const n = { ...m }; rows.forEach(p => { n[p.id] = p }); return n })
          setBusy(false)
        })
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  function add(id: string) { if (!value.includes(id)) onChange([...value, id]) }
  function remove(id: string) { onChange(value.filter(v => v !== id)) }
  function move(id: string, dir: -1 | 1) {
    const idx = value.indexOf(id); const ni = idx + dir
    if (idx === -1 || ni < 0 || ni >= value.length) return
    const next = [...value]; [next[idx], next[ni]] = [next[ni], next[idx]]; onChange(next)
  }

  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 7 }
  const thumb = (pr?: PreviewProduct): React.CSSProperties => ({
    width: 30, height: 30, borderRadius: 6, flexShrink: 0, border: '1px solid var(--bd)',
    background: pr?.image_url ? `#fff url(${pr.image_url}) center/contain no-repeat` : 'var(--bg3)',
  })

  return (
    <div>
      {/* Selected list */}
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', marginBottom: 6, textTransform: 'uppercase' }}>Выбрано ({value.length})</div>
      {value.length === 0 && <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 10 }}>Пока ничего не выбрано — найдите товары ниже.</div>}
      <div style={{ marginBottom: 12 }}>
        {value.map((id, i) => {
          const pr = meta[id]
          return (
            <div key={id} style={{ ...rowStyle, background: 'var(--bg3)', marginBottom: 4 }}>
              <span style={thumb(pr)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pr?.name ?? '…'}</div>
                <div style={{ fontSize: 10, color: 'var(--t3)' }}>{pr?.price != null ? `${pr.price.toLocaleString('ru-RU')} ₸` : ''}</div>
              </div>
              <button onClick={() => move(id, -1)} disabled={i === 0} style={{ width: 20, height: 20, border: '1px solid var(--bd)', borderRadius: 4, background: 'var(--bg2)', cursor: i === 0 ? 'default' : 'pointer', fontSize: 10, color: 'var(--t2)' }}>↑</button>
              <button onClick={() => move(id, 1)} disabled={i === value.length - 1} style={{ width: 20, height: 20, border: '1px solid var(--bd)', borderRadius: 4, background: 'var(--bg2)', cursor: i === value.length - 1 ? 'default' : 'pointer', fontSize: 10, color: 'var(--t2)' }}>↓</button>
              <button onClick={() => remove(id)} style={{ width: 20, height: 20, border: 'none', borderRadius: 4, background: '#E5484D', cursor: 'pointer', fontSize: 11, color: '#fff' }}>✕</button>
            </div>
          )
        })}
      </div>

      {/* Search */}
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск товара по названию…"
        style={{ width: '100%', height: 36, border: '1px solid var(--bd)', borderRadius: 8, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', marginBottom: 8 }} />
      <div style={{ maxHeight: 260, overflowY: 'auto' }}>
        {busy && <div style={{ fontSize: 11, color: 'var(--t3)', padding: 6 }}>Поиск…</div>}
        {!busy && query.trim().length >= 2 && results.length === 0 && <div style={{ fontSize: 11, color: 'var(--t3)', padding: 6 }}>Ничего не найдено</div>}
        {results.filter(r => !value.includes(r.id)).map(pr => (
          <div key={pr.id} style={{ ...rowStyle, cursor: 'pointer' }}
            onClick={() => add(pr.id)}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
            <span style={thumb(pr)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pr.name}</div>
              <div style={{ fontSize: 10, color: 'var(--t3)' }}>{pr.section_name ?? ''}{pr.price != null ? ` · ${pr.price.toLocaleString('ru-RU')} ₸` : ''}</div>
            </div>
            <span style={{ fontSize: 16, color: 'var(--primary)', fontWeight: 700 }}>＋</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Upload/paste an image URL (Cloudinary via shared helper, Supabase Storage fallback)
function ImageField({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    setBusy(true); setErr('')
    try { const url = await uploadImage(file); onChange(url) }
    catch { setErr('Не удалось загрузить фото') }
    setBusy(false)
    e.target.value = ''
  }
  return (
    <div>
      {value && (
        <div style={{ position: 'relative', marginBottom: 8, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--bd)' }}>
          <img src={value} alt="" style={{ display: 'block', width: '100%', height: 90, objectFit: 'cover' }} />
          <button onClick={() => onChange('')} style={{ position: 'absolute', top: 6, right: 6, width: 24, height: 24, border: 'none', borderRadius: 6, background: 'rgba(0,0,0,.6)', color: '#fff', cursor: 'pointer', fontSize: 12 }}>✕</button>
        </div>
      )}
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 36, border: '1px dashed var(--bd)', borderRadius: 8, cursor: busy ? 'wait' : 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--t2)', background: 'var(--bg3)' }}>
        {busy ? 'Загрузка…' : (value ? 'Заменить фото' : '＋ Загрузить фото')}
        <input type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} disabled={busy} />
      </label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder="или вставьте URL картинки"
        style={{ width: '100%', height: 32, border: '1px solid var(--bd)', borderRadius: 8, padding: '0 10px', fontSize: 12, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', marginTop: 6 }} />
      {err && <div style={{ fontSize: 11, color: '#DC2626', marginTop: 4 }}>{err}</div>}
    </div>
  )
}

type LinkVal = { kind: 'none' | 'product' | 'section' | 'url'; href: string; label: string }

// Pick where a card links: a product page, a catalog section, a custom URL, or nothing
function LinkField({ value, onChange, sections }: { value?: LinkVal; onChange: (v: LinkVal) => void; sections: SectionInfo[] }) {
  const kind = value?.kind ?? 'none'
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Array<{ id: string; name: string; sku: string | null }>>([])
  useEffect(() => {
    const s = q.trim()
    if (kind !== 'product' || s.length < 2) { setResults([]); return }
    const t = setTimeout(() => {
      supabase.from('products').select('id, name, sku').eq('is_active', true).ilike('name', `%${s}%`).order('name').limit(15)
        .then(({ data }) => setResults((data ?? []) as Array<{ id: string; name: string; sku: string | null }>))
    }, 300)
    return () => clearTimeout(t)
  }, [q, kind])

  const inp: React.CSSProperties = { width: '100%', height: 34, border: '1px solid var(--bd)', borderRadius: 8, padding: '0 10px', fontSize: 12, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }
  return (
    <div>
      <div style={{ display: 'flex', background: 'var(--bg3)', borderRadius: 8, padding: 3, gap: 2, marginBottom: 8 }}>
        {([['none', 'Нет'], ['product', 'Товар'], ['section', 'Раздел'], ['url', 'Ссылка']] as const).map(([k, l]) => (
          <button key={k} onClick={() => onChange({ kind: k, href: '', label: '' })} style={{
            flex: 1, padding: '6px 4px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
            background: kind === k ? 'var(--bg2)' : 'transparent', color: kind === k ? 'var(--t)' : 'var(--t3)',
          }}>{l}</button>
        ))}
      </div>

      {kind === 'product' && (<>
        {value?.href && (
          <div style={{ fontSize: 12, color: 'var(--t)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--primary)' }}>✓</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value.label}</span>
            <button onClick={() => onChange({ kind: 'product', href: '', label: '' })} style={{ border: 'none', background: 'none', color: '#DC2626', cursor: 'pointer', fontSize: 11 }}>убрать</button>
          </div>
        )}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Найти товар по названию…" style={inp} />
        <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 4 }}>
          {results.map(r => (
            <div key={r.id} onClick={() => { onChange({ kind: 'product', href: `/product/${productSlug(r)}`, label: r.name }); setQ(''); setResults([]) }}
              style={{ padding: '7px 6px', fontSize: 12, cursor: 'pointer', borderRadius: 6, color: 'var(--t)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>{r.name}</div>
          ))}
        </div>
      </>)}

      {kind === 'section' && (
        <select value={value?.label || ''} onChange={e => { const name = e.target.value; onChange(name ? { kind: 'section', href: `/catalog/${categorySlug(name)}`, label: name } : { kind: 'section', href: '', label: '' }) }}
          style={{ ...inp, cursor: 'pointer', background: 'var(--bg2)', color: 'var(--t)' }}>
          <option value="">— выберите раздел —</option>
          {sections.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
      )}

      {kind === 'url' && (
        <input value={value?.href || ''} onChange={e => onChange({ kind: 'url', href: e.target.value, label: e.target.value })} placeholder="https://…" style={inp} />
      )}
    </div>
  )
}

function PropsPanel({ block, onChange, sections }: { block: CanvasBlock; onChange: (id: string, props: Record<string, unknown>) => void; sections: SectionInfo[] }) {
  const def = DEF_MAP[block.type] || { label: block.type }
  const p = block.props
  function set(key: string, val: unknown) { onChange(block.id, { ...p, [key]: val }) }

  return (
    <div style={{ padding: '16px 14px 24px', overflowY: 'auto' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--t)', marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid var(--bd)' }}>
        {def.label}
      </div>

      {block.type === 'promo_bar' && (<>
        <Field label="Текст"><PInput value={p.text as string || ''} onChange={v => set('text', v)} /></Field>
        <Field label="Цвет фона">
          <input type="color" value={(p.bgColor as string) || '#0E7C46'} onChange={e => set('bgColor', e.target.value)}
            style={{ width: '100%', height: 36, borderRadius: 8, border: '1px solid var(--bd)', cursor: 'pointer', padding: 2 }} />
        </Field>
      </>)}

      {block.type === 'header' && (<>
        <Field label="Город"><PInput value={(p.city as string) || ''} onChange={v => set('city', v)} /></Field>
        <Field label="Текст кнопки Войти"><PInput value={(p.loginText as string) || 'Войти'} onChange={v => set('loginText', v)} /></Field>
      </>)}

      {block.type === 'categories_chips' && (() => {
        const hidden = Array.isArray(p.hidden) ? (p.hidden as string[]) : []
        const order = Array.isArray(p.order) ? (p.order as string[]) : []
        // Live-ordered list of section names, mirroring the runtime
        const ordered = order.length > 0
          ? [...order.filter(n => sections.some(s => s.name === n)), ...sections.map(s => s.name).filter(n => !order.includes(n))]
          : sections.map(s => s.name)
        function toggleHidden(name: string) {
          set('hidden', hidden.includes(name) ? hidden.filter(n => n !== name) : [...hidden, name])
        }
        function move(name: string, dir: -1 | 1) {
          const idx = ordered.indexOf(name); const ni = idx + dir
          if (idx === -1 || ni < 0 || ni >= ordered.length) return
          const next = [...ordered]; [next[idx], next[ni]] = [next[ni], next[idx]]; set('order', next)
        }
        return (
          <Field label="Разделы-чипы">
            <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 8, lineHeight: 1.4 }}>
              Список разделов берётся из каталога. Здесь можно скрыть ненужные и задать порядок. «Все товары» всегда первый.
            </div>
            <div style={{ padding: 6, background: 'var(--bg3)', borderRadius: 10, border: '1px solid var(--bd)', maxHeight: 340, overflowY: 'auto' }}>
              {ordered.length === 0 && <div style={{ fontSize: 11, color: 'var(--t3)', padding: 8 }}>Разделы каталога не найдены</div>}
              {ordered.map((name, i) => {
                const off = hidden.includes(name)
                return (
                  <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px', borderRadius: 7, opacity: off ? 0.5 : 1 }}>
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--t)', textDecoration: off ? 'line-through' : 'none' }}>{name}</span>
                    <button onClick={() => move(name, -1)} disabled={i === 0} style={{ width: 20, height: 20, border: '1px solid var(--bd)', borderRadius: 4, background: 'var(--bg2)', cursor: i === 0 ? 'default' : 'pointer', fontSize: 10, color: 'var(--t2)' }}>↑</button>
                    <button onClick={() => move(name, 1)} disabled={i === ordered.length - 1} style={{ width: 20, height: 20, border: '1px solid var(--bd)', borderRadius: 4, background: 'var(--bg2)', cursor: i === ordered.length - 1 ? 'default' : 'pointer', fontSize: 10, color: 'var(--t2)' }}>↓</button>
                    <button onClick={() => toggleHidden(name)} title={off ? 'Показать' : 'Скрыть'} style={{ width: 22, height: 20, border: '1px solid var(--bd)', borderRadius: 4, background: 'var(--bg2)', cursor: 'pointer', fontSize: 11 }}>{off ? '🙈' : '👁'}</button>
                  </div>
                )
              })}
            </div>
          </Field>
        )
      })()}

      {block.type === 'usp_hero' && (<>
        <Field label="Заголовок"><PInput value={(p.title as string) || ''} onChange={v => set('title', v)} /></Field>
        <Field label="Подзаголовок"><PInput value={(p.subtitle as string) || ''} onChange={v => set('subtitle', v)} /></Field>
        <Field label="Текст кнопки (каталог)"><PInput value={(p.primaryBtnText as string) || ''} onChange={v => set('primaryBtnText', v)} /></Field>
        <Field label="Текст кнопки (B2B)"><PInput value={(p.secondaryBtnText as string) || ''} onChange={v => set('secondaryBtnText', v)} /></Field>
        <div style={{ marginTop: 14, padding: 12, background: 'var(--bg3)', borderRadius: 10, border: '1px solid var(--bd)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', marginBottom: 10, textTransform: 'uppercase' }}>ЦИФРЫ (3 карточки)</div>
          {((p.stats as Array<{value:string;label:string}>) || DEFAULT_HERO_STATS).map((s, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 6, marginBottom: 8 }}>
              <PInput value={s.value} onChange={v => { const next = [...((p.stats as any) || DEFAULT_HERO_STATS)]; next[i] = { ...next[i], value: v }; set('stats', next) }} placeholder="Число" />
              <PInput value={s.label} onChange={v => { const next = [...((p.stats as any) || DEFAULT_HERO_STATS)]; next[i] = { ...next[i], label: v }; set('stats', next) }} placeholder="Подпись" />
            </div>
          ))}
        </div>
      </>)}

      {block.type === 'terms' && (<>
        <Field label="Заголовок"><PInput value={(p.title as string) || ''} onChange={v => set('title', v)} /></Field>
        <div style={{ padding: 12, background: 'var(--bg3)', borderRadius: 10, border: '1px solid var(--bd)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', marginBottom: 10, textTransform: 'uppercase' }}>УСЛОВИЯ</div>
          {((p.items as Array<{title:string;desc:string}>) || DEFAULT_TERMS).map((item, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <PInput value={item.title} onChange={v => { const next = [...((p.items as any) || DEFAULT_TERMS)]; next[i] = { ...next[i], title: v }; set('items', next) }} placeholder="Заголовок" />
              <div style={{ marginTop: 5 }}>
                <PInput value={item.desc} onChange={v => { const next = [...((p.items as any) || DEFAULT_TERMS)]; next[i] = { ...next[i], desc: v }; set('items', next) }} placeholder="Описание" />
              </div>
            </div>
          ))}
        </div>
      </>)}

      {block.type === 'steps' && (<>
        <Field label="Заголовок"><PInput value={(p.title as string) || ''} onChange={v => set('title', v)} /></Field>
        <div style={{ padding: 12, background: 'var(--bg3)', borderRadius: 10, border: '1px solid var(--bd)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', marginBottom: 10, textTransform: 'uppercase' }}>ШАГИ</div>
          {((p.items as Array<{title:string;desc:string}>) || DEFAULT_STEPS).map((item, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 6, fontWeight: 600 }}>Шаг {i + 1}</div>
              <PInput value={item.title} onChange={v => { const next = [...((p.items as any) || DEFAULT_STEPS)]; next[i] = { ...next[i], title: v }; set('items', next) }} placeholder="Заголовок" />
              <div style={{ marginTop: 5 }}>
                <PInput value={item.desc} onChange={v => { const next = [...((p.items as any) || DEFAULT_STEPS)]; next[i] = { ...next[i], desc: v }; set('items', next) }} placeholder="Описание" />
              </div>
            </div>
          ))}
        </div>
      </>)}

      {block.type === 'hero' && (<>
        <Field label="Заголовок"><PInput value={(p.title as string) || ''} onChange={v => set('title', v)} /></Field>
        <Field label="Подзаголовок (маленький)"><PInput value={(p.subtitle as string) || ''} onChange={v => set('subtitle', v)} /></Field>
        <Field label="Текст кнопки"><PInput value={(p.btnText as string) || ''} onChange={v => set('btnText', v)} /></Field>
        <Field label="Фото баннера"><ImageField value={(p.image as string) || ''} onChange={v => set('image', v)} /></Field>
        <Field label="Ссылка баннера (куда ведёт клик)">
          <LinkField value={p.link as LinkVal | undefined} onChange={v => set('link', v)} sections={sections} />
        </Field>
        <div style={{ marginTop: 14, padding: 12, background: 'var(--bg3)', borderRadius: 10, border: '1px solid var(--bd)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', marginBottom: 10, textTransform: 'uppercase' }}>ПРОМО-БЛОКИ (2 колонки)</div>
          {[0, 1].map((_, i) => {
            const promos: Array<{title:string;desc:string;bg:string;color:string;image?:string;link?:LinkVal}> = (p.promos as any) || [{title:'',desc:'',bg:'#F4EEFE',color:'#5B21D6'},{title:'',desc:'',bg:'#FFF4E6',color:'#B25E00'}]
            const upd = (patch: Record<string, unknown>) => { const next = [...promos]; next[i] = { ...next[i], ...patch }; set('promos', next) }
            return (
              <div key={i} style={{ marginBottom: 14, paddingBottom: 12, borderBottom: i === 0 ? '1px solid var(--bd)' : 'none' }}>
                <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 6, fontWeight: 600 }}>Блок {i + 1}</div>
                <PInput value={promos[i]?.title || ''} onChange={v => upd({ title: v })} placeholder="Заголовок" />
                <div style={{ marginTop: 6 }}>
                  <PInput value={promos[i]?.desc || ''} onChange={v => upd({ desc: v })} placeholder="Описание" />
                </div>
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', marginBottom: 5, textTransform: 'uppercase' }}>Фото</div>
                  <ImageField value={promos[i]?.image || ''} onChange={v => upd({ image: v })} />
                </div>
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--t3)', marginBottom: 5, textTransform: 'uppercase' }}>Ссылка при клике</div>
                  <LinkField value={promos[i]?.link} onChange={v => upd({ link: v })} sections={sections} />
                </div>
              </div>
            )
          })}
        </div>
      </>)}

      {block.type === 'products' && (<>
        <Field label="Заголовок"><PInput value={(p.title as string) || ''} onChange={v => set('title', v)} /></Field>
        <Field label="Источник товаров">
          <div style={{ display: 'flex', background: 'var(--bg3)', borderRadius: 8, padding: 3, gap: 2 }}>
            {([['section', 'По разделу'], ['manual', 'Выбрать вручную']] as const).map(([m, label]) => {
              const active = (p.mode === 'manual' ? 'manual' : 'section') === m
              return (
                <button key={m} onClick={() => set('mode', m)} style={{
                  flex: 1, padding: '7px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                  background: active ? 'var(--bg2)' : 'transparent', color: active ? 'var(--t)' : 'var(--t3)',
                  boxShadow: active ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
                }}>{label}</button>
              )
            })}
          </div>
        </Field>
        {p.mode === 'manual' ? (
          <Field label="Товары в подборке">
            <ProductPicker value={Array.isArray(p.productIds) ? (p.productIds as string[]) : []} onChange={ids => set('productIds', ids)} />
          </Field>
        ) : (
          <Field label="Раздел каталога">
            <select value={(p.section as string) || ''} onChange={e => set('section', e.target.value)}
              style={{ width: '100%', height: 36, border: '1px solid var(--bd)', borderRadius: 8, padding: '0 8px', fontSize: 13, fontFamily: 'inherit', outline: 'none', background: 'var(--bg2)', color: 'var(--t)', cursor: 'pointer', boxSizing: 'border-box' }}>
              <option value="">Все товары ({sections.reduce((s, x) => s + x.count, 0)})</option>
              {sections.map(s => <option key={s.name} value={s.name}>{s.name} ({s.count})</option>)}
            </select>
            {(p.section as string) && !sections.some(s => s.name === (p.section as string)) && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#B25E00', lineHeight: 1.4 }}>
                ⚠ Раздел «{p.section as string}» не найден в каталоге — блок будет пустым. Выберите раздел из списка.
              </div>
            )}
          </Field>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Колонок">
            <input type="number" min={2} max={6} value={(p.columns as number) || 6} onChange={e => set('columns', +e.target.value)}
              style={{ width: '100%', height: 36, border: '1px solid var(--bd)', borderRadius: 8, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
          </Field>
          <Field label="Товаров">
            <input type="number" min={4} max={24} step={4} value={(p.count as number) || 12} onChange={e => set('count', +e.target.value)}
              style={{ width: '100%', height: 36, border: '1px solid var(--bd)', borderRadius: 8, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
          </Field>
        </div>
      </>)}

      {block.type === 'cat_grid' && (() => {
        const items = (p.items as Array<{name:string;count?:string;icon?:string;tile?:string;image?:string}>) || []
        const selected = items.map(i => i.name)
        function toggle(name: string) {
          const next = selected.includes(name)
            ? items.filter(i => i.name !== name)
            : [...items, { name }]
          set('items', next)
        }
        function move(name: string, dir: -1 | 1) {
          const idx = items.findIndex(i => i.name === name)
          const ni = idx + dir
          if (idx === -1 || ni < 0 || ni >= items.length) return
          const next = [...items]
          ;[next[idx], next[ni]] = [next[ni], next[idx]]
          set('items', next)
        }
        function setImage(name: string, url: string) {
          const next = items.map(it => it.name === name ? { ...it, image: url } : it)
          set('items', next)
        }
        return (<>
          <Field label="Заголовок"><PInput value={(p.title as string) || ''} onChange={v => set('title', v)} /></Field>
          <Field label="Плитки категорий">
            <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 8, lineHeight: 1.4 }}>
              Отметьте разделы каталога — счётчик товаров подставляется автоматически, а клик по плитке откроет нужный раздел.
            </div>
            <div style={{ padding: 6, background: 'var(--bg3)', borderRadius: 10, border: '1px solid var(--bd)', maxHeight: 320, overflowY: 'auto' }}>
              {sections.length === 0 && <div style={{ fontSize: 11, color: 'var(--t3)', padding: 8 }}>Разделы каталога не найдены</div>}
              {sections.map(s => {
                const on = selected.includes(s.name)
                const pos = selected.indexOf(s.name)
                return (
                  <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px', borderRadius: 7, background: on ? 'var(--bg2)' : 'transparent' }}>
                    <input type="checkbox" checked={on} onChange={() => toggle(s.name)} style={{ cursor: 'pointer' }} />
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--t)' }}>{s.name}</span>
                    <span style={{ fontSize: 10, color: 'var(--t3)' }}>{s.count}</span>
                    {on && (
                      <span style={{ display: 'flex', gap: 2 }}>
                        <button onClick={() => move(s.name, -1)} disabled={pos === 0} style={{ width: 20, height: 20, border: '1px solid var(--bd)', borderRadius: 4, background: 'var(--bg2)', cursor: pos === 0 ? 'default' : 'pointer', fontSize: 10, color: 'var(--t2)' }}>↑</button>
                        <button onClick={() => move(s.name, 1)} disabled={pos === selected.length - 1} style={{ width: 20, height: 20, border: '1px solid var(--bd)', borderRadius: 4, background: 'var(--bg2)', cursor: pos === selected.length - 1 ? 'default' : 'pointer', fontSize: 10, color: 'var(--t2)' }}>↓</button>
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </Field>
          {items.length > 0 && (
            <Field label="Фото плиток (необязательно)">
              <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 8, lineHeight: 1.4 }}>
                Добавьте картинку для выбранных категорий — плитка станет с фото.
              </div>
              {items.map(it => (
                <div key={it.name} style={{ marginBottom: 12, padding: 10, background: 'var(--bg3)', borderRadius: 10, border: '1px solid var(--bd)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--t)', marginBottom: 6 }}>{it.name}</div>
                  <ImageField value={it.image || ''} onChange={v => setImage(it.name, v)} />
                </div>
              ))}
            </Field>
          )}
        </>)
      })()}

      {block.type === 'b2b_banner' && (<>
        <Field label="Заголовок"><PInput value={(p.title as string) || ''} onChange={v => set('title', v)} /></Field>
        <Field label="Описание">
          <textarea value={(p.desc as string) || ''} onChange={e => set('desc', e.target.value)} rows={3}
            style={{ width: '100%', border: '1px solid var(--bd)', borderRadius: 8, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', outline: 'none' }} />
        </Field>
        <Field label="Текст кнопки"><PInput value={(p.btnText as string) || ''} onChange={v => set('btnText', v)} /></Field>
      </>)}

      {block.type === 'perks' && (
        <div style={{ padding: 12, background: 'var(--bg3)', borderRadius: 10, border: '1px solid var(--bd)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', marginBottom: 10, textTransform: 'uppercase' }}>ПРЕИМУЩЕСТВА</div>
          {((p.items as Array<{icon:string;title:string;desc:string}>) || DEFAULT_PERKS).map((item, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr', gap: 6, marginBottom: 4 }}>
                <PInput value={item.icon} onChange={v => { const next = [...((p.items as any) || DEFAULT_PERKS)]; next[i] = { ...next[i], icon: v }; set('items', next) }} />
                <PInput value={item.title} onChange={v => { const next = [...((p.items as any) || DEFAULT_PERKS)]; next[i] = { ...next[i], title: v }; set('items', next) }} />
              </div>
              <PInput value={item.desc} onChange={v => { const next = [...((p.items as any) || DEFAULT_PERKS)]; next[i] = { ...next[i], desc: v }; set('items', next) }} placeholder="Описание" />
            </div>
          ))}
        </div>
      )}

      {block.type === 'text' && (
        <Field label="Содержимое">
          <textarea value={(p.content as string) || ''} onChange={e => set('content', e.target.value)} rows={6}
            style={{ width: '100%', border: '1px solid var(--bd)', borderRadius: 8, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', outline: 'none' }} />
        </Field>
      )}

      {block.type === 'reviews' && (<>
        <Field label="Заголовок"><PInput value={(p.title as string) || ''} onChange={v => set('title', v)} /></Field>
        <div style={{ padding: 12, background: 'var(--bg3)', borderRadius: 10, border: '1px solid var(--bd)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)', marginBottom: 10, textTransform: 'uppercase' }}>ОТЗЫВЫ</div>
          {((p.items as Array<{text:string;author:string}>) || []).map((r, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <PInput value={r.author} onChange={v => { const next = [...(p.items as any)]; next[i] = { ...next[i], author: v }; set('items', next) }} placeholder={`Автор ${i+1}`} />
              <div style={{ marginTop: 5 }}>
                <textarea value={r.text} onChange={e => { const next = [...(p.items as any)]; next[i] = { ...next[i], text: e.target.value }; set('items', next) }} rows={2} placeholder="Текст отзыва"
                  style={{ width: '100%', border: '1px solid var(--bd)', borderRadius: 8, padding: '6px 10px', fontSize: 12, fontFamily: 'inherit', resize: 'none', boxSizing: 'border-box', outline: 'none' }} />
              </div>
            </div>
          ))}
        </div>
      </>)}

      {block.type === 'form' && (<>
        <Field label="Заголовок"><PInput value={(p.title as string) || ''} onChange={v => set('title', v)} /></Field>
        <Field label="Текст кнопки"><PInput value={(p.btnText as string) || ''} onChange={v => set('btnText', v)} /></Field>
        <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 8 }}>Имя и телефон — всегда обязательны. Заявка сохраняется в CRM → Клиенты со статусом «Потенциальный».</div>
        <Field label="Дополнительные поля">
          {[['showEmail', 'Email'], ['showCompany', 'Название компании'], ['showSegment', 'Сфера деятельности'], ['showComment', 'Комментарий']].map(([k, l]) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={p[k] as boolean} onChange={e => set(k, e.target.checked)} />
              {l}
            </label>
          ))}
        </Field>
      </>)}

      {block.type === 'footer' && (<>
        <Field label="Город"><PInput value={(p.city as string) || ''} onChange={v => set('city', v)} /></Field>
        <Field label="Телефон"><PInput value={(p.phone as string) || ''} onChange={v => set('phone', v)} /></Field>
        <Field label="Email"><PInput value={(p.email as string) || ''} onChange={v => set('email', v)} /></Field>
      </>)}

      {block.type === 'promo_sale' && (<>
        <Field label="Заголовок акции"><PInput value={(p.title as string) || ''} onChange={v => set('title', v)} /></Field>
        <Field label="Описание">
          <textarea value={(p.description as string) || ''} onChange={e => set('description', e.target.value)} rows={3}
            style={{ width: '100%', border: '1px solid var(--bd)', borderRadius: 8, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', outline: 'none' }} />
        </Field>
        <Field label="Скидка (%)">
          <input type="number" min={0} max={99} value={(p.discount_pct as number) || 0} onChange={e => set('discount_pct', +e.target.value)}
            style={{ width: '100%', height: 36, border: '1px solid var(--bd)', borderRadius: 8, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
        </Field>
        <Field label="Дата окончания">
          <input type="date" value={(p.end_date as string) || ''} onChange={e => set('end_date', e.target.value)}
            style={{ width: '100%', height: 36, border: '1px solid var(--bd)', borderRadius: 8, padding: '0 10px', fontSize: 13, fontFamily: 'inherit', outline: 'none' }} />
        </Field>
        <Field label="Фото фона"><ImageField value={(p.image as string) || ''} onChange={v => set('image', v)} /></Field>
        <Field label="Ссылка при клике">
          <LinkField value={p.link as LinkVal | undefined} onChange={v => set('link', v)} sections={sections} />
        </Field>
      </>)}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

const INITIAL_BLOCKS: CanvasBlock[] = [
  { id: 'b0',  type: 'promo_bar',       props: { text: 'Бесплатная доставка от 8 000 ₸ по городу · оптовикам — отдельные цены в B2B-кабинете', bgColor: '#0E7C46' } },
  { id: 'b1',  type: 'header',          props: { logo: 'nstore', city: 'Астана', showSearch: true, showCart: true, showB2B: true } },
  { id: 'b2',  type: 'categories_chips',props: { items: ['Все товары','Молочное','Кофе и чай','Напитки','Соусы','Вода','Снеки'] } },
  { id: 'b3',  type: 'usp_hero',        props: { title: 'Продукты питания оптом и в розницу', subtitle: 'Прямые поставки от дистрибьютора — свежесть, цены и сроки под контролем', primaryBtnText: 'Смотреть каталог', secondaryBtnText: 'Стать партнёром B2B', stats: DEFAULT_HERO_STATS } },
  { id: 'b4',  type: 'hero',            props: { title: '−20% на молоко и сливки', subtitle: 'СВЕЖАЯ МОЛОЧКА КАЖДОЕ УТРО', btnText: 'Смотреть', promos: [{title:'Кофе недели',desc:'Свежая обжарка от 3 990 ₸/кг',bg:'#F4EEFE',color:'#5B21D6'},{title:'Соусы Азии',desc:'Терияки, соевый, устричный',bg:'#FFF4E6',color:'#B25E00'}] } },
  { id: 'b5',  type: 'products',        props: { title: 'Популярное', columns: 6, count: 12, section: '' } },
  { id: 'b6',  type: 'cat_grid',        props: { title: 'Категории', items: [{name:'Молочное',count:'320 товаров',icon:'',tile:'#EAF6EE'},{name:'Кофе и чай',count:'180 товаров',icon:'',tile:'#F1ECE5'},{name:'Напитки',count:'240 товаров',icon:'',tile:'#FFF1DD'},{name:'Соусы',count:'95 товаров',icon:'',tile:'#ECEAE6'},{name:'Вода',count:'60 товаров',icon:'',tile:'#E7F3F4'},{name:'Снеки',count:'150 товаров',icon:'',tile:'#F4EEFE'}] } },
  { id: 'b7',  type: 'terms',           props: { title: 'Условия работы', items: DEFAULT_TERMS } },
  { id: 'b8',  type: 'b2b_banner',      props: { title: 'Закупаете для кафе, магазина или офиса?', desc: 'Оптовые цены, отсрочка платежа и персональный менеджер в B2B-кабинете. Перенос корзины в один клик.', btnText: 'Открыть опт B2B' } },
  { id: 'b9',  type: 'steps',           props: { title: 'Как начать работу', items: DEFAULT_STEPS } },
  { id: 'b10', type: 'perks',           props: { items: DEFAULT_PERKS } },
  { id: 'b11', type: 'form',            props: { title: 'Стать партнёром', btnText: 'Отправить заявку', showEmail: false, showCompany: true, showSegment: true, showComment: true } },
  { id: 'b12', type: 'footer',          props: { city: 'Астана', phone: '+7 700 720 0006', email: 'sales.nstore@gmail.com' } },
]

export default function ContentTab() {
  const { can } = useCRM()
  const isReadonly = can('content') === 'view'
  const isMobile = useIsMobile()
  const [libOpen, setLibOpen] = useState(false)
  const [view, setView] = useState<'builder' | 'traffic'>('builder')
  const [viewport, setViewport] = useState<Viewport>(isMobile ? 'mobile' : 'desktop')
  const [blocks, setBlocks] = useState<CanvasBlock[]>(INITIAL_BLOCKS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dropIdx, setDropIdx] = useState<number | null>(null)
  const [dragVisual, setDragVisual] = useState<string | null>(null) // for visual feedback only
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [history, setHistory] = useState<CanvasBlock[][]>([INITIAL_BLOCKS])
  const [historyIdx, setHistoryIdx] = useState(0)
  const [sections, setSections] = useState<SectionInfo[]>([])
  const [catalog, setCatalog] = useState<PreviewProduct[]>([])
  const canvasRef = useRef<HTMLDivElement>(null)

  // ── KEY FIX: Use ref for drag state to avoid race condition with onDragEnd ──
  const dragRef = useRef<{ libType: BlockType | null; canvasId: string | null }>({ libType: null, canvasId: null })

  const selectedBlock = blocks.find(b => b.id === selectedId) ?? null

  // ── Load from Supabase ──
  useEffect(() => {
    supabase.from('page_blocks').select('*').eq('page', 'home').order('sort_order')
      .then(({ data, error }) => {
        if (!error && data && data.length > 0) {
          const loaded: CanvasBlock[] = data.map(r => ({
            id: r.id as string,
            type: r.block_type as BlockType,
            props: (r.props as Record<string, unknown>) ?? {},
          }))
          setBlocks(loaded)
          setHistory([loaded])
          setHistoryIdx(0)
        }
        setLoading(false)
      })
  }, [])

  // ── Load real catalog so blocks manage the live catalog (mirrors LandingPage) ──
  useEffect(() => {
    // Sample of products for a true WYSIWYG preview of the products block
    supabase.from('products')
      .select('id, name, price, image_url, section_name')
      .eq('is_active', true)
      .order('name')
      .limit(500)
      .then(({ data }) => setCatalog((data ?? []) as PreviewProduct[]))

    // Accurate section counts across the whole active catalog (paginated, like the live page)
    ;(async () => {
      const counts: Record<string, number> = {}
      const step = 1000
      let from = 0
      for (;;) {
        const { data, error } = await supabase.from('products')
          .select('section_name')
          .eq('is_active', true).not('section_name', 'is', null)
          .range(from, from + step - 1)
        if (error) break
        const chunk = data ?? []
        chunk.forEach(r => { const s = (r as { section_name: string | null }).section_name; if (s) counts[s] = (counts[s] ?? 0) + 1 })
        if (chunk.length < step) break
        from += step
      }
      setSections(Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count))
    })()
  }, [])

  function applyBlocks(nb: CanvasBlock[]) {
    setBlocks(nb)
    const next = [...history.slice(0, historyIdx + 1), nb]
    setHistory(next)
    setHistoryIdx(next.length - 1)
  }

  function undo() {
    if (historyIdx > 0) { setHistoryIdx(historyIdx - 1); setBlocks(history[historyIdx - 1]) }
  }
  function redo() {
    if (historyIdx < history.length - 1) { setHistoryIdx(historyIdx + 1); setBlocks(history[historyIdx + 1]) }
  }

  function updateProps(id: string, props: Record<string, unknown>) {
    const next = blocks.map(b => b.id === id ? { ...b, props } : b)
    applyBlocks(next)
  }

  function deleteBlock(id: string) {
    applyBlocks(blocks.filter(b => b.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  function duplicateBlock(id: string) {
    const idx = blocks.findIndex(b => b.id === id)
    if (idx === -1) return
    const copy: CanvasBlock = { ...blocks[idx], id: uid(), props: { ...blocks[idx].props } }
    const next = [...blocks.slice(0, idx + 1), copy, ...blocks.slice(idx + 1)]
    applyBlocks(next)
    setSelectedId(copy.id)
  }

  function moveBlock(id: string, dir: -1 | 1) {
    const idx = blocks.findIndex(b => b.id === id)
    const ni = idx + dir
    if (ni < 0 || ni >= blocks.length) return
    const next = [...blocks]
    ;[next[idx], next[ni]] = [next[ni], next[idx]]
    applyBlocks(next)
  }

  // ── Click-to-add from library (simpler than drag, works on all devices) ──
  function insertFromLibrary(type: BlockType) {
    const def = DEF_MAP[type]
    const nb: CanvasBlock = { id: uid(), type, props: { ...def.defaultProps } }
    // Insert after selected block, or at end if nothing selected
    const selIdx = selectedId ? blocks.findIndex(b => b.id === selectedId) : -1
    const insertAt = selIdx >= 0 ? selIdx + 1 : blocks.length
    applyBlocks([...blocks.slice(0, insertAt), nb, ...blocks.slice(insertAt)])
    setSelectedId(nb.id)
  }

  // ── Drag handlers using ref (avoids onDragEnd race condition) ──
  function onLibDragStart(type: BlockType) {
    dragRef.current = { libType: type, canvasId: null }
    setDragVisual('lib:' + type)
  }
  function onCanvasDragStart(id: string) {
    dragRef.current = { libType: null, canvasId: id }
    setDragVisual('canvas:' + id)
  }
  function onDragEnd() {
    dragRef.current = { libType: null, canvasId: null }
    setDragVisual(null)
    setDropIdx(null)
  }
  function onDropZoneOver(e: React.DragEvent, idx: number) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropIdx(idx)
  }
  function onDropZoneDrop(e: React.DragEvent, idx: number) {
    e.preventDefault()
    e.stopPropagation()
    const { libType, canvasId } = dragRef.current
    dragRef.current = { libType: null, canvasId: null }
    setDragVisual(null)
    setDropIdx(null)

    if (libType) {
      const def = DEF_MAP[libType]
      const nb: CanvasBlock = { id: uid(), type: libType, props: { ...def.defaultProps } }
      applyBlocks([...blocks.slice(0, idx), nb, ...blocks.slice(idx)])
      setSelectedId(nb.id)
    } else if (canvasId) {
      const fromIdx = blocks.findIndex(b => b.id === canvasId)
      if (fromIdx === -1) return
      const next = [...blocks]
      const [moved] = next.splice(fromIdx, 1)
      const insertAt = fromIdx < idx ? idx - 1 : idx
      next.splice(Math.max(0, insertAt), 0, moved)
      applyBlocks(next)
    }
  }

  // ── Publish to Supabase ──
  async function handleSave() {
    setSaving(true)
    setSaveError(false)
    try {
      const { error: delErr } = await supabase.from('page_blocks').delete().eq('page', 'home')
      if (delErr) throw delErr

      const rows = blocks.map((b, i) => ({
        page: 'home',
        block_type: b.type,
        props: b.props,
        sort_order: i,
        is_active: true,
      }))
      const { data: inserted, error: insErr } = await supabase.from('page_blocks').insert(rows).select()
      if (insErr) throw insErr

      // Update local block IDs with DB-assigned UUIDs
      if (inserted) {
        const updated: CanvasBlock[] = inserted.map((r: Record<string, unknown>) => ({
          id: r.id as string,
          type: r.block_type as BlockType,
          props: (r.props as Record<string, unknown>) ?? {},
        }))
        setBlocks(updated)
        setHistory([updated])
        setHistoryIdx(0)
      }

      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      console.error('Publish failed:', err)
      setSaveError(true)
      setTimeout(() => setSaveError(false), 4000)
    }
    setSaving(false)
  }

  const canvasW = VIEWPORT_W[viewport]

  const subTabs = (
    <div style={{ display: 'flex', gap: 6, padding: '8px 12px', background: 'var(--bg2)', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
      {([['builder', 'Страница'], ['traffic', 'Трафик сайта']] as const).map(([v, label]) => (
        <button key={v} onClick={() => setView(v)} style={{
          padding: '7px 14px', borderRadius: 9, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
          background: view === v ? 'var(--primary)' : 'var(--bg3)', color: view === v ? '#fff' : 'var(--t2)',
        }}>{label}</button>
      ))}
    </div>
  )

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <Spinner />
    </div>
  )

  if (view === 'traffic') return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', overflow: 'hidden' }}>
      {subTabs}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}><TrafficTab /></div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', overflow: 'hidden' }}>
      {subTabs}

      {/* ── Top bar ── */}
      <div style={{ minHeight: 52, background: '#0C1A13', display: 'flex', alignItems: 'center', flexWrap: isMobile ? 'wrap' : 'nowrap', padding: isMobile ? '8px 10px' : '0 16px', gap: isMobile ? 6 : 10, flexShrink: 0 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, color: '#fff', marginRight: 4 }}>
          nstore<span style={{ color: '#5FC78F' }}>·editor</span>
        </span>

        {isMobile && (
          <button onClick={() => setLibOpen(v => !v)} style={{
            display: 'flex', alignItems: 'center', gap: 5, background: libOpen ? 'var(--primary)' : 'rgba(255,255,255,.1)',
            border: 'none', borderRadius: 8, padding: '6px 11px', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          }}>{libOpen ? '✕ Блоки' : '＋ Блоки'}</button>
        )}

        {!isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(255,255,255,.1)', borderRadius: 8, padding: '5px 11px', color: '#A9C0B2', fontSize: 13, fontWeight: 600 }}>
            Страница: Главная <span style={{ fontSize: 9 }}>▾</span>
          </div>
        )}

        <div style={{ display: 'flex', background: 'rgba(255,255,255,.08)', borderRadius: 8, padding: 3, gap: 1, marginLeft: 2 }}>
          {(['desktop', 'tablet', 'mobile'] as const).map((vp, i) => (
            <button key={vp} onClick={() => setViewport(vp)} style={{
              padding: '5px 10px', borderRadius: 5, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
              background: viewport === vp ? 'var(--primary)' : 'transparent',
              color: viewport === vp ? '#fff' : '#A9C0B2',
            }}>
              {['Desktop', 'Tablet', 'Mobile'][i]}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* Undo / Redo */}
        {[['↩', undo, historyIdx === 0], ['↪', redo, historyIdx >= history.length - 1]].map(([icon, fn, dis], i) => (
          <button key={i} onClick={fn as () => void} disabled={dis as boolean} title={i === 0 ? 'Отменить' : 'Повторить'} style={{
            width: 30, height: 30, borderRadius: 6, border: 'none', cursor: (dis as boolean) ? 'not-allowed' : 'pointer',
            background: 'rgba(255,255,255,.08)', color: (dis as boolean) ? '#3A4A41' : '#A9C0B2', fontSize: 14,
          }}>{icon as string}</button>
        ))}

        <a href="/" target="_blank" rel="noreferrer" style={{
          display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,.1)',
          border: '1px solid rgba(255,255,255,.2)', borderRadius: 8, padding: '6px 12px',
          color: '#fff', fontSize: 12, fontWeight: 600, textDecoration: 'none',
        }}>
          Просмотр
        </a>

        <button onClick={isReadonly ? undefined : handleSave} disabled={saving || isReadonly} style={{
          background: isReadonly ? 'var(--bg3)' : saveError ? '#DC2626' : saved ? '#0E7C46' : 'var(--primary)',
          border: 'none', borderRadius: 8, padding: '7px 16px',
          color: isReadonly ? 'var(--t3)' : '#fff', fontSize: 13, fontWeight: 700,
          cursor: isReadonly ? 'not-allowed' : saving ? 'wait' : 'pointer', fontFamily: 'inherit',
          boxShadow: isReadonly ? 'none' : '0 2px 8px rgba(16,163,91,.4)', transition: 'background .2s',
        }}>
          {isReadonly ? 'Только просмотр' : saving ? 'Сохранение…' : saveError ? 'Ошибка — повторить' : saved ? 'Опубликовано' : 'Опубликовать'}
        </button>
      </div>

      {/* ── Main area ── */}
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', flex: 1, overflow: 'hidden', minHeight: 0 }}>

        {/* ── Left: Block library (desktop column / mobile collapsible strip) ── */}
        {(!isMobile || libOpen) && (
          <div style={{
            width: isMobile ? '100%' : 196, flexShrink: 0, background: 'var(--bg2)',
            borderRight: isMobile ? 'none' : '1px solid var(--bd)', borderBottom: isMobile ? '1px solid var(--bd)' : 'none',
            display: 'flex', flexDirection: 'column', overflow: 'hidden', maxHeight: isMobile ? '42vh' : 'none',
          }}>
            {!isMobile && <div style={{ padding: '12px 12px 4px', fontSize: 10, fontWeight: 800, color: 'var(--t3)', letterSpacing: '.07em' }}>БЛОКИ</div>}
            {!isMobile && <div style={{ padding: '0 12px 6px', fontSize: 9, color: 'var(--t3)' }}>нажми или перетащи</div>}
            <div style={{ overflowY: 'auto', padding: isMobile ? '8px 10px' : '0 8px 16px', flex: 1, display: isMobile ? 'grid' : 'block', gridTemplateColumns: isMobile ? '1fr 1fr' : undefined, gap: isMobile ? 6 : undefined }}>
              {BLOCK_DEFS.map(def => (
                <div key={def.type}
                  draggable={!isMobile}
                  onDragStart={() => onLibDragStart(def.type)}
                  onDragEnd={onDragEnd}
                  onClick={() => { insertFromLibrary(def.type); if (isMobile) setLibOpen(false) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9, padding: '8px 9px', borderRadius: 9, marginBottom: isMobile ? 0 : 3,
                    background: dragVisual === 'lib:' + def.type ? '#EAF6EE' : 'var(--bg3)',
                    border: `1px solid ${dragVisual === 'lib:' + def.type ? 'var(--primary)' : 'var(--bd)'}`,
                    cursor: 'pointer', transition: 'all .12s', userSelect: 'none',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#EAF6EE')}
                  onMouseLeave={e => (e.currentTarget.style.background = dragVisual === 'lib:' + def.type ? '#EAF6EE' : 'var(--bg3)')}>
                  <span style={{ width: 28, height: 28, borderRadius: 7, background: def.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#28352C', lineHeight: 1.3 }}>{def.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Center: Canvas ── */}
        <div
          style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 20px 60px', background: 'var(--bg)' }}
          ref={canvasRef}
          onClick={e => { if (e.target === e.currentTarget) setSelectedId(null) }}
          onDragOver={e => e.preventDefault()}
        >
          <div style={{ width: canvasW, maxWidth: '100%', transition: 'width .25s', background: 'var(--bg2)', borderRadius: 12, overflow: 'hidden', boxShadow: '0 4px 28px -8px rgba(16,40,28,.2)', border: '1px solid var(--bd)', minHeight: 400, flexShrink: 0 }}>

            <DropZone idx={0} active={dropIdx === 0} onOver={onDropZoneOver} onDrop={onDropZoneDrop} />

            {blocks.map((block, i) => (
              <div key={block.id}>
                <div
                  draggable={selectedId !== block.id}
                  onDragStart={() => onCanvasDragStart(block.id)}
                  onDragEnd={onDragEnd}
                  onClick={e => { e.stopPropagation(); setSelectedId(block.id) }}
                  style={{ position: 'relative', opacity: dragVisual === 'canvas:' + block.id ? 0.35 : 1, cursor: selectedId === block.id ? 'default' : 'grab', transition: 'opacity .15s' }}
                >
                  <BlockPreview block={block} vp={viewport} selected={selectedId === block.id} sections={sections} catalog={catalog}
                    onEditProp={isReadonly ? undefined : (key, value) => updateProps(block.id, { ...block.props, [key]: value })} />

                  {/* Block toolbar */}
                  {selectedId === block.id && (
                    <div style={{ position: 'absolute', top: 6, right: 8, display: 'flex', gap: 3, zIndex: 20 }}>
                      {([
                        ['↑', () => moveBlock(block.id, -1), i === 0],
                        ['↓', () => moveBlock(block.id, 1), i === blocks.length - 1],
                        ['⧉', () => duplicateBlock(block.id), false],
                        ['✕', () => deleteBlock(block.id), false],
                      ] as const).map(([icon, fn, dis], j) => (
                        <button key={j}
                          onClick={e => { e.stopPropagation(); if (!dis) (fn as () => void)() }}
                          disabled={dis as boolean}
                          style={{
                            width: 24, height: 24, border: 'none', borderRadius: 5, cursor: dis ? 'default' : 'pointer',
                            background: icon === '✕' ? '#E5484D' : '#0C1A13',
                            color: (dis as boolean) ? 'rgba(255,255,255,.25)' : '#fff', fontSize: 11,
                          }}>{icon}</button>
                      ))}
                    </div>
                  )}
                </div>
                <DropZone idx={i + 1} active={dropIdx === i + 1} onOver={onDropZoneOver} onDrop={onDropZoneDrop} />
              </div>
            ))}

            {blocks.length === 0 && (
              <div style={{ padding: '60px 24px', textAlign: 'center', color: 'var(--t3)' }}
                onDragOver={e => { e.preventDefault(); setDropIdx(0) }}
                onDrop={e => onDropZoneDrop(e, 0)}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>⊕</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Перетащите блоки из панели слева</div>
              </div>
            )}
          </div>

          <div style={{ marginTop: 10, fontSize: 10, color: '#A6B0A9', fontWeight: 600 }}>
            {canvasW}px · {viewport === 'desktop' ? 'Десктоп' : viewport === 'tablet' ? 'Планшет' : 'Мобильный'}
          </div>
        </div>

        {/* ── Right: Properties (desktop column) ── */}
        {!isMobile && (
          <div style={{ width: 272, flexShrink: 0, background: 'var(--bg2)', borderLeft: '1px solid var(--bd)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {selectedBlock ? (
              <PropsPanel block={selectedBlock} onChange={updateProps} sections={sections} />
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#A6B0A9', padding: 24, textAlign: 'center', gap: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.5 }}>Выберите блок на холсте для редактирования</div>
                <div style={{ fontSize: 11, color: '#C0C8C3', lineHeight: 1.5 }}>Или перетащите блок из панели слева чтобы добавить его</div>
              </div>
            )}
          </div>
        )}

      </div>

      {/* ── Mobile: properties as a bottom sheet ── */}
      {isMobile && selectedBlock && (
        <>
          <div onClick={() => setSelectedId(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 1000 }} />
          <div style={{
            position: 'fixed', left: 0, right: 0, bottom: 0, top: '35%', zIndex: 1001,
            background: 'var(--bg2)', borderTopLeftRadius: 18, borderTopRightRadius: 18,
            boxShadow: '0 -10px 40px rgba(0,0,0,.25)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--t)' }}>Настройки блока</span>
              <button onClick={() => setSelectedId(null)} style={{ background: 'var(--primary)', border: 'none', borderRadius: 8, padding: '6px 16px', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Готово</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              <PropsPanel block={selectedBlock} onChange={updateProps} sections={sections} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Drop zone component ──────────────────────────────────────────────────────

function DropZone({ idx, active, onOver, onDrop }: {
  idx: number; active: boolean
  onOver: (e: React.DragEvent, i: number) => void
  onDrop: (e: React.DragEvent, i: number) => void
}) {
  return (
    <div
      onDragOver={e => onOver(e, idx)}
      onDragEnter={e => { e.preventDefault(); onOver(e, idx) }}
      onDrop={e => onDrop(e, idx)}
      onDragLeave={() => {}}
      style={{
        height: active ? 44 : 4,
        background: active ? 'rgba(16,163,91,.07)' : 'transparent',
        borderTop: active ? '2px dashed var(--primary)' : '2px solid transparent',
        borderBottom: active ? '2px dashed var(--primary)' : '2px solid transparent',
        transition: 'height .12s, background .12s',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {active && (
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', background: '#EAF6EE', padding: '2px 12px', borderRadius: 20 }}>
          Отпустите для вставки
        </span>
      )}
    </div>
  )
}
