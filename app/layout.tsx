import type { Metadata, Viewport } from 'next'
import { Onest,Unbounded } from 'next/font/google'
import Providers from '@/app/providers/Providers'
import '@/app/styles/globals.css'
import '@/features/shopping/ui/shop.css'

const onest = Onest({ subsets: ['latin', 'cyrillic'], variable: '--font-onest', display: 'swap' })
const unbounded = Unbounded({ subsets: ['latin', 'cyrillic'], variable: '--font-display', display: 'swap' })

export const metadata: Metadata = {
  metadataBase: new URL('https://nstore.kz'),
  title: 'nStore — поставки для HoReCa и офисов',
  description: 'Кофе, молоко, сиропы, соусы и напитки. Оптовые поставки по Астане и Казахстану.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/icon.svg', apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'nStore', statusBarStyle: 'default' },
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#12306E' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ru" className={`${onest.variable} ${unbounded.variable}`}><body><Providers>{children}</Providers></body></html>
}
