import { Suspense } from 'react'
import type { Metadata } from 'next'
import { Page } from '@/views/landing'

export const metadata: Metadata = {
  title: 'Nstore — оптовые поставки продуктов питания в Астане',
  description: 'Оптовые поставки для HoReCa, магазинов и офисов. Каталог продуктов, прямые цены и доставка по Астане и Казахстану.',
  alternates: { canonical: '/' },
  openGraph: { title: 'Nstore — оптовые поставки продуктов питания', description: 'Каталог продуктов для бизнеса с доставкой по Казахстану.', images: ['/og-cover.png'] },
}

export default function RoutePage() {
  return <><h1 className="sr-only">Оптовые поставки продуктов питания для бизнеса в Астане</h1><Suspense fallback={<p role="status">Загрузка…</p>}><Page /></Suspense></>
}
