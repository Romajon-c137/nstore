'use client'

import { CRMProvider } from '@/views/crm/context/CRMContext'
import CRMLayout from '@/views/crm/CRMLayout'

export default function CRMPage({ children }: { children: React.ReactNode }) {
  return (
    <CRMProvider>
      <CRMLayout>{children}</CRMLayout>
    </CRMProvider>
  )
}
