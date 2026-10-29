import { Suspense } from 'react'
import { DeliveriesTab_Tab as Tab } from '@/views/crm'
export default function Page() { return <Suspense fallback={<p>Загрузка…</p>}><Tab /></Suspense> }
