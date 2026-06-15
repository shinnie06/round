import { del, get, set as idbSet } from 'idb-keyval'
import { parseRoundState } from './schema'
import type { RoundState } from './types'
import type { useStore } from './store'

/**
 * Draft tier of the two-tier persistence story (the other is the share
 * hash): every state change lands in IndexedDB after a 350ms debounce,
 * and is offered as "Resume" on the next visit. Read-only rounds
 * (opened from someone's share link) never overwrite YOUR draft.
 */
const DRAFT_KEY = 'round-draft-v1'
const DEBOUNCE_MS = 350

export function startDraftPersistence(store: typeof useStore): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const unsubscribe = store.subscribe((state, prev) => {
    if (state.readOnly || state.round === prev.round) return
    if (timer) clearTimeout(timer)
    const snapshot = state.round
    timer = setTimeout(() => {
      void idbSet(DRAFT_KEY, snapshot).catch(() => {
        /* private mode / quota — drafts are best-effort */
      })
    }, DEBOUNCE_MS)
  })
  return () => {
    if (timer) clearTimeout(timer)
    unsubscribe()
  }
}

export async function loadDraft(): Promise<RoundState | null> {
  try {
    const data: unknown = await get(DRAFT_KEY)
    if (data === undefined) return null
    return parseRoundState(data)
  } catch {
    return null
  }
}

export async function clearDraft(): Promise<void> {
  try {
    await del(DRAFT_KEY)
  } catch {
    /* best-effort */
  }
}

/** A draft is worth resuming only if the user actually put something in it. */
export function draftHasContent(d: RoundState): boolean {
  return d.items.length > 0 || d.diners.length > 0 || d.venue.trim() !== ''
}
