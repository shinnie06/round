import type { Diner } from './types'

/**
 * Warm accents tuned against the ink (#12100B) and cream surfaces —
 * each diner keeps theirs for the whole session (avatar dots, settle
 * cards, assignment chips).
 */
export const DINER_COLORS = [
  '#E8A14B', // amber
  '#7FB069', // herb green
  '#D96C5F', // chilli
  '#7E9CD8', // dusk blue
  '#C792B7', // orchid
  '#5FB8A5', // kopi mint
  '#D9B45F', // kaya
  '#A48BD1', // ube
] as const

/** Least-used color first; ties go to palette order. */
export function nextColorIdx(diners: Diner[]): number {
  const counts = DINER_COLORS.map(() => 0)
  for (const d of diners) counts[d.colorIdx % DINER_COLORS.length]! += 1
  let best = 0
  for (let i = 1; i < counts.length; i++) {
    if (counts[i]! < counts[best]!) best = i
  }
  return best
}
