import { Suspense } from 'react'
import { DashTab_Tab as Tab } from '@/views/crm'
export default function Page() { return <Suspense fallback={<p>Загрузка…</p>}><Tab /></Suspense> }
