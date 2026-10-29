'use client'

import { InstallPrompt,PwaStatus,registerPWA } from '@/features/pwa'
import { LanguageProvider } from '@/shared/i18n/LanguageContext'
import { trackVisit } from '@/shared/lib/trackVisit'
import ErrorBoundary from '@/shared/ui/ErrorBoundary'
import { QueryClient,QueryClientProvider } from '@tanstack/react-query'
import { Analytics } from '@vercel/analytics/react'
import { usePathname } from 'next/navigation'
import { Suspense,useEffect,useState } from 'react'

function Lifecycle() {
  const pathname = usePathname()
  useEffect(() => { registerPWA() }, [])
  useEffect(() => {
    if (!/^\/(crm|cabinet|login|register)/.test(pathname)) void trackVisit()
  }, [pathname])
  return <><InstallPrompt /><PwaStatus /><Analytics /></>
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } }))
  return <ErrorBoundary><QueryClientProvider client={client}><LanguageProvider>{children}<Suspense><Lifecycle /></Suspense></LanguageProvider></QueryClientProvider></ErrorBoundary>
}
