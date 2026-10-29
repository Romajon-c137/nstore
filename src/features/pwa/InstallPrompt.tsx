'use client'

import { isStandalone } from '@/features/pwa/registerPWA'
import { useEffect,useState } from 'react'

interface BIPEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'nstore-install-dismissed-at'
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function isIOS() {
  // Only true Safari on iOS supports "Add to Home Screen" via Share sheet.
  // Chrome for iOS (CriOS) and Firefox for iOS (FxiOS) don't support it.
  const ua = navigator.userAgent
  return /iphone|ipad|ipod/i.test(ua) &&
    !(window as unknown as { MSStream?: unknown }).MSStream &&
    !/CriOS|FxiOS|OPiOS|EdgiOS/i.test(ua)
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null)
  const [show, setShow] = useState(false)
  const [iosHint, setIosHint] = useState(false)

  useEffect(() => {
    if (isStandalone()) return
    const dismissedAt = localStorage.getItem(DISMISS_KEY)
    if (dismissedAt && Date.now() - Number(dismissedAt) < DISMISS_TTL_MS) return

    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BIPEvent)
      setShow(true)
    }
    const onInstalled = () => setShow(false)

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)

    // iOS Safari only — show share-hint after 2.5s
    if (isIOS()) {
      const t = setTimeout(() => { setIosHint(true); setShow(true) }, 2500)
      return () => {
        clearTimeout(t)
        window.removeEventListener('beforeinstallprompt', onPrompt)
        window.removeEventListener('appinstalled', onInstalled)
      }
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const dismiss = () => { setShow(false); localStorage.setItem(DISMISS_KEY, String(Date.now())) }

  const install = async () => {
    if (!deferred) return
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    if (outcome === 'dismissed') localStorage.setItem(DISMISS_KEY, String(Date.now()))
    setShow(false)
    setDeferred(null)
  }

  if (!show) return null

  return (
    <div
      role="dialog"
      style={{
        position: 'fixed', left: 12, right: 12, zIndex: 4000,
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        background: 'rgba(255,255,255,.86)', backdropFilter: 'saturate(180%) blur(20px)',
        WebkitBackdropFilter: 'saturate(180%) blur(20px)',
        border: '1px solid rgba(0,0,0,.06)', borderRadius: 20,
        boxShadow: '0 12px 40px rgba(16,40,28,.18)',
        padding: 14, display: 'flex', alignItems: 'center', gap: 12,
        maxWidth: 460, margin: '0 auto',
        animation: 'pwaSlideUp .35s cubic-bezier(.22,1,.36,1)',
      }}
    >
      <img src="/icons/icon-192.png" width={44} height={44} alt="Nstore" style={{ borderRadius: 12, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: '#12201A' }}>Установить Nstore</div>
        <div style={{ fontSize: 12, color: '#5C6B63', marginTop: 1, lineHeight: 1.35 }}>
          {iosHint
            ? <>Нажмите <b>Поделиться</b> → «На экран “Домой”»</>
            : 'Быстрый доступ с домашнего экрана, работает офлайн'}
        </div>
      </div>
      {!iosHint && (
        <button
          onClick={install}
          style={{ flexShrink: 0, background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 12, padding: '10px 16px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}
        >
          Установить
        </button>
      )}
      <button
        onClick={dismiss}
        aria-label="Закрыть"
        style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 10, border: 'none', background: 'rgba(0,0,0,.05)', color: '#5C6B63', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}
      >
        ×
      </button>
    </div>
  )
}
