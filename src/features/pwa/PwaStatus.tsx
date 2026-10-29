'use client'

import { useEffect,useState } from 'react'

/** Slim connectivity banner (online / offline). */
export default function PwaStatus() {
  const [online, setOnline] = useState(true)
  const [reconnected, setReconnected] = useState(false)

  useEffect(() => {
    setOnline(navigator.onLine)
    const goOnline = () => {
      setOnline(true)
      setReconnected(true)
      setTimeout(() => setReconnected(false), 2500)
    }
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  if (online && !reconnected) return null

  return (
    <div
      style={{
        position: 'fixed', left: 0, right: 0, zIndex: 5000,
        top: 'env(safe-area-inset-top, 0px)',
        padding: '7px 14px', textAlign: 'center',
        fontSize: 12.5, fontWeight: 700,
        color: '#fff', background: online ? 'var(--primary)' : '#4B5563',
        animation: 'pwaSlideDown .3s cubic-bezier(.22,1,.36,1)',
      }}
    >
      {online ? 'Соединение восстановлено' : 'Нет соединения — офлайн режим'}
    </div>
  )
}
