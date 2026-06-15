'use client'
import { useCallback, useRef, useState } from 'react'
import { preprocessReceipt } from '@/features/ocr/ImagePreprocess'
import { ocrReceipt } from '@/features/ocr/lmstudio'
import { sanitize } from '@/features/ocr/sanitize'
import { repair } from '@/features/ocr/repair'
import { reconcile } from '@/features/ocr/reconcile'
import { mapToState } from '@/features/ocr/mapToState'
import { useStore } from '@/state/store'

export type ScanPhase = 'idle' | 'preparing' | 'reading' | 'error'

/**
 * The whole scan pipeline as one hook:
 * file → preprocess → LMStudio → sanitize → repair → reconcile → store → workspace.
 */
export function useScan() {
  const [phase, setPhase] = useState<ScanPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const scan = useCallback(async (file: File) => {
    setError(null)
    setPhase('preparing')
    abortRef.current = new AbortController()
    try {
      const dataUrl = await preprocessReceipt(file)
      setPhase('reading')
      const raw = await ocrReceipt(dataUrl, { signal: abortRef.current.signal })
      const clean = repair(sanitize(raw))
      const verdict = reconcile(clean)
      const state = mapToState(clean, verdict)
      const { actions } = useStore.getState()
      actions.loadRound(state)
      actions.setScreen('workspace')
      setPhase('idle')
    } catch (e) {
      setPhase('error')
      setError(e instanceof Error ? e.message : 'Something went wrong reading the receipt')
    }
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setPhase('idle')
    setError(null)
  }, [])

  const dismissError = useCallback(() => {
    setPhase('idle')
    setError(null)
  }, [])

  return { phase, error, scan, cancel, dismissError }
}
