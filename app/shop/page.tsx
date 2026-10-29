import { Suspense } from 'react'
import { Page } from '@/views/shop'

export default function RoutePage() { return <Suspense fallback={<p role="status">Загрузка…</p>}><Page /></Suspense> }
