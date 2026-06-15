'use client'
import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { motion } from 'framer-motion'
import { Camera, PencilLine, History, Loader2 } from 'lucide-react'
import { useScan } from '@/hooks/useScan'
import { useStore } from '@/state/store'
import { loadDraft } from '@/state/persist'
import { usePrefersReducedMotion } from '@/lib/useReducedMotion'
import { Button } from '@/components/Button'
import { ConnectionPill } from '@/components/ConnectionPill'
import { Logo } from '@/components/Logo'

const Ambient = dynamic(() => import('./Ambient'), { ssr: false })

export function SplashScreen({ draftAvailable }: { draftAvailable: boolean }) {
  const reduced = usePrefersReducedMotion()
  const { phase, error, scan, cancel, dismissError } = useScan()
  const fileRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLElement>(null)
  const [introDone, setIntroDone] = useState(false)
  // Pre-animation hiding is ALSO gated on introDone: if GSAP ever fails
  // to load or run, the reveal still happens — the intro is decoration,
  // never a gate on usability.
  const preHidden = !reduced && !introDone

  // GSAP intro: wordmark rises out of its mask, actions stagger in.
  useEffect(() => {
    if (reduced) {
      setIntroDone(true)
      return
    }
    let killed = false
    let tl: { kill(): void } | undefined
    import('gsap')
      .then(({ gsap }) => {
        if (killed) return
        if (!rootRef.current) {
          setIntroDone(true)
          return
        }
        const q = gsap.utils.selector(rootRef.current)
        tl = gsap
          .timeline({ onComplete: () => setIntroDone(true) })
          .fromTo(
            q('[data-intro="mark"]'),
            { opacity: 0, scale: 0.7, rotate: -40 },
            { opacity: 1, scale: 1, rotate: 0, duration: 0.8, ease: 'back.out(1.6)', delay: 0.1 },
          )
          .fromTo(
            q('[data-intro="wordmark"]'),
            { yPercent: 110 },
            { yPercent: 0, duration: 0.9, ease: 'power4.out' },
            '-=0.5',
          )
          .fromTo(
            q('[data-intro="tagline"]'),
            { opacity: 0, y: 12 },
            { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' },
            '-=0.35',
          )
          .fromTo(
            q('[data-intro="action"]'),
            { opacity: 0, y: 16 },
            { opacity: 1, y: 0, duration: 0.45, stagger: 0.08, ease: 'power2.out' },
            '-=0.2',
          )
      })
      .catch(() => setIntroDone(true))
    return () => {
      killed = true
      tl?.kill()
    }
  }, [reduced])

  const resume = async () => {
    const draft = await loadDraft()
    if (draft) {
      useStore.getState().actions.loadRound(draft)
      useStore.getState().actions.setScreen('workspace')
    }
  }

  const busy = phase === 'preparing' || phase === 'reading'

  return (
    <motion.main
      ref={rootRef}
      className="relative flex min-h-dvh flex-col overflow-hidden safe-top"
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.25 }}
    >
      {!reduced && <Ambient />}

      <header className="flex justify-end px-5 pt-2">
        <ConnectionPill />
      </header>

      <section className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <div data-intro="mark" style={preHidden ? { opacity: 0 } : undefined}>
          <Logo className="h-16 w-16 md:h-20 md:w-20" />
        </div>
        <div className="overflow-hidden pb-1">
          <h1
            data-intro="wordmark"
            className="font-display text-display leading-none tracking-tight text-cream"
            style={preHidden ? { transform: 'translateY(110%)' } : undefined}
          >
            Round<span className="text-accent">.</span>
          </h1>
        </div>
        <p
          data-intro="tagline"
          className="text-body text-cream-dim"
          style={preHidden ? { opacity: 0 } : undefined}
        >
          Whose round is it?
        </p>
      </section>

      <footer className="flex flex-col items-stretch gap-3 px-6 pb-10 safe-bottom md:mx-auto md:w-96">
        {busy ? (
          <div
            className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-ink-2 p-5"
            role="status"
          >
            <Loader2 className="animate-spin text-accent" aria-hidden />
            <p className="text-body text-cream">
              {phase === 'preparing' ? 'Preparing the photo…' : 'Reading the receipt…'}
            </p>
            <p className="text-small text-cream-faint">
              {phase === 'reading' && 'Your photo never leaves this network.'}
            </p>
            <Button variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
        ) : (
          <>
            {error && (
              <div
                className="flex flex-col gap-2 rounded-2xl border border-bad/40 bg-bad/10 p-4 text-left"
                role="alert"
              >
                <p className="text-small text-cream">{error}</p>
                <Button variant="ghost" size="md" onClick={dismissError}>
                  Dismiss
                </Button>
              </div>
            )}
            <span data-intro="action" style={preHidden ? { opacity: 0 } : undefined}>
              <Button size="lg" className="w-full" onClick={() => fileRef.current?.click()}>
                <Camera size={18} aria-hidden /> Scan receipt
              </Button>
            </span>
            <span data-intro="action" style={preHidden ? { opacity: 0 } : undefined}>
              <Button
                size="lg"
                variant="ghost"
                className="w-full"
                onClick={() => useStore.getState().actions.enterManual()}
              >
                <PencilLine size={18} aria-hidden /> Enter manually
              </Button>
            </span>
            {draftAvailable && (
              <span data-intro="action" style={preHidden ? { opacity: 0 } : undefined}>
                <Button size="lg" variant="quiet" className="w-full" onClick={() => void resume()}>
                  <History size={18} aria-hidden /> Resume draft
                </Button>
              </span>
            )}
          </>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Receipt photo"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void scan(f)
            e.target.value = ''
          }}
        />
      </footer>
    </motion.main>
  )
}
