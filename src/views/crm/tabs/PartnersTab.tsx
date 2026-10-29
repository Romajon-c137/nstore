'use client'

import { useLanguage } from '@/shared/i18n/LanguageContext'
import { Spinner } from '@/shared/ui/ui'
import { Segmented } from '@/views/crm/shared/crmui'
import ClientsSection from '@/views/crm/tabs/ClientsTab'
import { lazy,Suspense,useState } from 'react'

/* Секция по умолчанию (Клиенты) грузится сразу — без второго lazy-водопада.
   Точки (leaflet) и Компании остаются lazy: тяжёлый leaflet подгружается только при открытии. */
const LocationsSection = lazy(() => import('@/views/crm/tabs/LocationsTab'))
const CompaniesSection = lazy(() => import('@/views/crm/tabs/CounterpartiesTab')) // контрагенты 1С вместо компаний CRM
const ContractsSection = lazy(() => import('@/views/crm/tabs/ContractsTab'))

type Section = 'clients' | 'locations' | 'companies' | 'contracts'
const LS_KEY = 'crm_partners_section'

function Fallback() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)' }}>
      <Spinner size={24} color="var(--primary)" track="var(--bd2)" />
    </div>
  )
}

export default function PartnersTab() {
  const { tr } = useLanguage()
  const [section, setSection] = useState<Section>(() => {
    const s = localStorage.getItem(LS_KEY)
    return s === 'locations' || s === 'companies' || s === 'contracts' ? s : 'clients'
  })
  const pick = (s: Section) => { setSection(s); localStorage.setItem(LS_KEY, s) }

  const tabs: { id: Section; label: string }[] = [
    { id: 'clients',   label: tr('tabClients')   },
    { id: 'locations', label: tr('tabLocations') },
    { id: 'companies', label: 'Контрагенты' },
    { id: 'contracts', label: tr('tabContracts') },
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, background: 'var(--bg)' }}>
      {/* Section switcher */}
      <div style={{ padding: '10px 12px', background: 'var(--bg2)', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
        <Segmented
          value={section}
          onChange={pick}
          full
          options={tabs.map(t => ({ value: t.id, label: t.label }))}
        />
      </div>

      {/* Active section */}
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', overflow: 'hidden' }}>
        <Suspense fallback={<Fallback />}>
          {section === 'clients'   && <ClientsSection />}
          {section === 'locations' && <LocationsSection />}
          {section === 'companies' && <CompaniesSection />}
          {section === 'contracts' && <ContractsSection />}
        </Suspense>
      </div>
    </div>
  )
}
