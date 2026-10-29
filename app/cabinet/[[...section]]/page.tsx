import { Suspense } from 'react'
import { Cabinet } from '@/views/cabinet'
import { AuthGuard } from '@/features/auth'
export default function Page() { return <Suspense><AuthGuard roles={['client']}><Cabinet /></AuthGuard></Suspense> }
