import { Suspense } from 'react'
import { CRM } from '@/views/crm'
import { AuthGuard } from '@/features/auth'
export const metadata = { title: 'CRM — nStore', robots: { index: false, follow: false } }
export default function Layout({ children }: { children: React.ReactNode }) { return <Suspense><AuthGuard roles={['admin', 'manager', 'logist']}><CRM>{children}</CRM></AuthGuard></Suspense> }
