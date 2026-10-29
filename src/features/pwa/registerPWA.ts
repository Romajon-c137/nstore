export function registerPWA() {
  if (!('serviceWorker' in navigator) || process.env.NODE_ENV === 'development') return
  void navigator.serviceWorker.register('/sw.js').catch(() => {})
}
export function isStandalone(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (window.navigator as { standalone?: boolean }).standalone === true)
}
