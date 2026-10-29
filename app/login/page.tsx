import { Suspense } from 'react'
import { Page } from '@/views/login'

export default function RoutePage() { return <Suspense fallback={<p role="status">Загрузка…</p>}><Page /></Suspense> }
