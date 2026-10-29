import { Suspense } from 'react'
import { Page } from '@/views/delivery'

export default function RoutePage() { return <Suspense fallback={<p role="status">Загрузка…</p>}><Page /></Suspense> }
