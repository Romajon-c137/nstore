'use client'

import { Component,ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

function isChunkLoadError(error: Error | null): boolean {
  const msg = error?.message || ''
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) || // Safari / iOS
    /'?text\/html'? is not a valid JavaScript MIME type/i.test(msg) ||
    /ChunkLoadError/i.test(msg)
  )
}

/**
 * Полностью очищает клиентский кэш и перезагружает страницу: снимает
 * регистрацию service worker'а и удаляет все Cache Storage. Нужно, когда
 * пользователь «застрял» на устаревшей версии PWA — обычный reload отдаёт ту же
 * закэшированную страницу, и ошибка выглядит постоянной.
 */
async function hardReset() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((r) => r.unregister()))
    }
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch { /* best-effort */ }
  window.location.reload()
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      const chunkError = isChunkLoadError(this.state.error)
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif', padding: 24, background: '#f9fafb',
        }}>
          <div style={{ maxWidth: 480, width: '100%', background: '#fff', borderRadius: 16, padding: 32, boxShadow: '0 2px 16px rgba(0,0,0,.08)' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', marginBottom: 8 }}>
              Что-то пошло не так
            </h1>
            <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 20, lineHeight: 1.6 }}>
              {chunkError
                ? 'Вышла новая версия приложения. Обновите страницу, чтобы загрузить её.'
                : 'Произошла ошибка приложения. Попробуйте обновить страницу.'}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <button
                onClick={() => window.location.reload()}
                style={{ background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                Обновить страницу
              </button>
              <button
                onClick={() => { void hardReset() }}
                style={{ background: 'transparent', color: 'var(--primary, #2E9E6B)', border: '1.5px solid var(--primary, #2E9E6B)', borderRadius: 10, padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                Очистить кэш и обновить
              </button>
            </div>
            <details style={{ marginTop: 20 }}>
              <summary style={{ fontSize: 12, color: '#9ca3af', cursor: 'pointer' }}>Детали ошибки</summary>
              <pre style={{ marginTop: 8, fontSize: 11, color: '#dc2626', whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#fef2f2', padding: 12, borderRadius: 8 }}>
                {this.state.error.message}
              </pre>
            </details>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
