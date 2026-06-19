import { DINER_COLORS } from '@/state/colors'
import type { Diner, Portion } from '@/state/types'

/** Resolve a portion's participant list against the current diners.
 *  `[]` is the everyone sentinel → all current ids. An explicit list is
 *  filtered to ids that still exist (mirrors the engine's resolve rule:
 *  the []-check happens BEFORE the filter, so literal-[] and
 *  all-unknown-after-filter stay distinct). */
export function resolveMembers(portion: Portion, diners: Diner[]): string[] {
  if (portion.assignedDinerIds.length === 0) return diners.map((d) => d.id)
  const live = new Set(diners.map((d) => d.id))
  return portion.assignedDinerIds.filter((id) => live.has(id))
}

/** The subline "who" label (§7.4): `[]` → "everyone"; an all-unknown
 *  explicit list → "no one" (the slice the engine skips); ≤2 names → the
 *  joined names; 3+ → "N people". */
export function portionWho(portion: Portion, diners: Diner[]): string {
  if (portion.assignedDinerIds.length === 0) return 'everyone'
  const names = diners.filter((d) => portion.assignedDinerIds.includes(d.id)).map((d) => d.name)
  if (names.length === 0) return 'no one'
  if (names.length <= 2) return names.join(', ')
  return `${names.length} people`
}

export interface PortionRowVM {
  /** Resolved participant ids (sentinel expanded), in diner order. */
  memberIds: string[]
  /** One entry per diner, in diner order — the toggle list. */
  rows: { id: string; name: string; colorIdx: number; on: boolean; lockedLast: boolean }[]
  /** Avatar dots for the members, capped at 5, in diner order. */
  dots: { id: string; color: string }[]
  /** Members beyond the 5-dot cap. */
  overflow: number
  /** "1 unit" / "N units" — the stepper's read-out noun. */
  unitNoun: string
}

/** The per-portion view-model every row needs, computed once, framework-free. */
export function portionRowVM(portion: Portion, diners: Diner[]): PortionRowVM {
  const memberIds = resolveMembers(portion, diners)
  const memberSet = new Set(memberIds)
  const rows = diners.map((d) => ({
    id: d.id,
    name: d.name,
    colorIdx: d.colorIdx,
    on: memberSet.has(d.id),
    // The ≥1-per-portion rule, made visible: the lone remaining member
    // can't be toggled off (mirrors AssignSheet's lockedLast).
    lockedLast: memberSet.has(d.id) && memberIds.length === 1,
  }))
  const members = diners.filter((d) => memberSet.has(d.id))
  const dots = members.slice(0, 5).map((d) => ({
    id: d.id,
    color: DINER_COLORS[d.colorIdx % DINER_COLORS.length]!,
  }))
  return {
    memberIds,
    rows,
    dots,
    overflow: Math.max(0, members.length - 5),
    unitNoun: portion.units === 1 ? '1 unit' : `${portion.units} units`,
  }
}
