'use client'

export default function CategoriesChips({ sections, activeSection, setActiveSection, p }: { sections: string[]; activeSection: string; setActiveSection: (s: string) => void; p?: Record<string, unknown> }) {
  // Чипы берутся из реальных section_name товаров (Supabase) — равны фильтру каталога.
  // Админ может скрыть/переупорядочить разделы через блок «Категории (чипы)».
  const hidden = Array.isArray(p?.hidden) ? (p!.hidden as string[]) : []
  const order = Array.isArray(p?.order) ? (p!.order as string[]) : []
  let display = sections.filter(s => !hidden.includes(s))
  if (order.length > 0) {
    const set = new Set(display)
    const ordered = order.filter(s => set.has(s))
    const rest = display.filter(s => !order.includes(s))
    display = [...ordered, ...rest]
  }
  return (
    <div className="lp-chips">
      <button
        onClick={() => setActiveSection('')}
        style={{ flexShrink: 0, background: activeSection === '' ? '#0E1E16' : '#F2F5F3', color: activeSection === '' ? '#fff' : '#28352C', borderRadius: 11, padding: '9px 15px', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s' }}
      >
        Все товары
      </button>
      {display.map(cat => {
        const isActive = activeSection === cat
        return (
          <button
            key={cat}
            onClick={() => setActiveSection(cat)}
            style={{ flexShrink: 0, background: isActive ? '#0E1E16' : '#F2F5F3', color: isActive ? '#fff' : '#28352C', borderRadius: 11, padding: '9px 15px', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s', whiteSpace: 'nowrap' }}
          >
            {cat}
          </button>
        )
      })}
    </div>
  )
}
