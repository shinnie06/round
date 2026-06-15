'use client'
import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useStore } from '@/state/store'
import { decodeShareHash } from '@/state/urlhash'
import { draftHasContent, loadDraft, startDraftPersistence } from '@/state/persist'
import { registerSw } from '@/lib/registerSw'
import { useLenis } from '@/lib/useLenis'
import { SplashScreen } from '@/features/splash/SplashScreen'
import { WorkspaceScreen } from '@/features/workspace/WorkspaceScreen'
import { SettleSheet } from '@/features/settle/SettleSheet'

/**
 * Boot order matters:
 *  1. A share hash (#r=…) wins — it opens the shared round READ-ONLY
 *     and must never touch the viewer's own draft.
 *  2. Otherwise look for an IndexedDB draft and offer "Resume" on splash.
 * Draft persistence starts only after boot so the read-only branch can
 * never leak someone else's round into local storage.
 */
export function AppRoot() {
  const screen = useStore((s) => s.screen)
  const [draftAvailable, setDraftAvailable] = useState(false)
  useLenis()

  useEffect(() => {
    let stop: (() => void) | undefined
    let cancelled = false

    const boot = async () => {
      const shared = decodeShareHash(window.location.hash)
      if (shared) {
        useStore.getState().actions.loadRound(shared, { readOnly: true })
        useStore.getState().actions.setScreen('workspace')
      } else {
        const draft = await loadDraft()
        if (!cancelled && draft && draftHasContent(draft)) setDraftAvailable(true)
      }
      if (!cancelled) stop = startDraftPersistence(useStore)
    }

    void boot()
    registerSw()
    return () => {
      cancelled = true
      stop?.()
    }
  }, [])

  return (
    <AnimatePresence mode="wait">
      {screen === 'splash' ? (
        <SplashScreen key="splash" draftAvailable={draftAvailable} />
      ) : (
        <WorkspaceScreen key="workspace" />
      )}
      {screen === 'settle' && <SettleSheet key="settle" />}
    </AnimatePresence>
  )
}
