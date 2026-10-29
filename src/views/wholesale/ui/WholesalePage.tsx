'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { fmtMoney, productHref } from '@/entities/catalog'
import { useShopData } from '@/features/shopping'

export default function WholesalePage() {
  const data = useShopData()
  const [query, setQuery] = useState('')
  const [section, setSection] = useState('')
  const available = useMemo(() => data.products.filter(product => product.price != null && product.stock > 0), [data.products])
  const sections = [...new Set(available.map(product => product.subcategory || 'Другое'))].sort()
  const shown = available.filter(product => (!section || (product.subcategory || 'Другое') === section) && `${product.name} ${product.sku}`.toLocaleLowerCase('ru-RU').includes(query.trim().toLocaleLowerCase('ru-RU')))
    .sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity) || (a.subcategory || '').localeCompare(b.subcategory || '', 'ru') || a.name.localeCompare(b.name, 'ru'))
  return <main style={{ maxWidth: 1100, margin: 'auto', padding: '32px 16px 64px' }}>
    <nav style={{ display: 'flex', justifyContent: 'space-between' }}><Link href="/">nStore</Link><Link href="/shop">Каталог и корзина →</Link></nav>
    <h1 style={{ fontSize: 32, fontWeight: 800, marginTop: 32 }}>Оптовый прайс</h1>
    <p style={{ margin: '12px 0 24px' }}>Товары в наличии. Доступные цены зависят от условий вашего договора.</p>
    <label>Поиск по названию или артикулу<input value={query} onChange={event => setQuery(event.target.value)} type="search" style={{ display: 'block', width: '100%', border: '1px solid #d4dad6', borderRadius: 10, padding: 12, margin: '8px 0 16px' }} /></label>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
      {['', ...sections].map(item => <button key={item} aria-pressed={section === item} onClick={() => setSection(item)} style={{ border: '1px solid #d4dad6', borderRadius: 16, padding: '6px 12px', background: section === item ? '#eaf0fc' : '#fff' }}>{item || 'Все'}</button>)}
    </div>
    {data.isLoading ? <p role="status">Загрузка прайса…</p> : data.error ? <p role="alert">Не удалось загрузить прайс. <button onClick={() => data.refetch()}>Повторить</button></p> : <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', minWidth: 520, textAlign: 'left' }}>
      <thead><tr><th style={{ padding: 12 }}>Товар</th><th>от 12 шт</th><th>от 50 шт</th><th>от 100 шт</th></tr></thead>
      <tbody>{shown.map(product => <tr key={product.id} style={{ borderTop: '1px solid #edf1ef' }}>
        <td style={{ padding: 12 }}><Link href={productHref(product)}>{product.name}</Link><div style={{ fontSize: 12, color: '#64748b' }}>Арт. {product.sku}{product.step > 1 ? ` · в коробке ${product.step} шт` : ''}</div></td>
        {[product.price, product.priceLists.wholesale, product.priceLists.top].map((price, index) => <td key={index} style={{ padding: 8, whiteSpace: 'nowrap' }}>{price == null ? 'По договору' : fmtMoney(price)}</td>)}
      </tr>)}</tbody>
    </table>{!shown.length && <p>Ничего не найдено</p>}</div>}
    <p style={{ marginTop: 24, color: '#64748b', fontSize: 13 }}>Цены и наличие из учётной системы · {available.length} позиций</p>
  </main>
}
