'use client'
import { useEffect } from 'react'
import { usePrefersReducedMotion } from './useReducedMotion'

/**
 * Buttery smooth scroll — desktop pointers only (touch scrolling is
 * already physical), and never under prefers-reduced-motion.
 */
export function useLenis(): void {
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    if (reduced || !window.matchMedia('(pointer: fine)').matches) return
    let raf = 0
    let lenis: { raf(t: number): void; destroy(): void } | undefined
    let cancelled = false

    void import('lenis').then(({ default: Lenis }) => {
      if (cancelled) return
      lenis = new Lenis()
      const tick = (time: number) => {
        lenis?.raf(time)
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      lenis?.destroy()
    }
  }, [reduced])
}
