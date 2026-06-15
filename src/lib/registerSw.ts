/** Installable PWA: register the service worker, production only. */
export function registerSw(): void {
  if (process.env.NODE_ENV !== 'production') return
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      /* PWA is progressive — the app works without it */
    })
  })
}
