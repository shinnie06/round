import { cents, type Cents } from '@/math/money'

export type Screen = 'splash' | 'workspace' | 'settle'

export interface Diner {
  id: string
  name: string
  /** Index into DINER_COLORS — stable per diner, reused across screens. */
  colorIdx: number
}

/**
 * A contiguous slice of an item's units, shared EQUALLY by an explicit
 * participant list. Opt-in: present only when the line is split between
 * different groups (e.g. a treated guest doesn't pay for some units).
 * Reuses the item-level sentinel verbatim: `assignedDinerIds: []` means
 * "everyone" WITHIN this portion (resolved against the current diner list
 * at split time, exactly like an un-split item).
 */
export interface Portion {
  /** Whole units of the parent item this portion covers. >=1. Portions'
   *  units sum to item.qty — every unit's cost lands on somebody. */
  units: number
  /** Diners splitting THIS portion equally. `[]` is the everyone sentinel. */
  assignedDinerIds: string[]
}

export interface Item {
  id: string
  name: string
  qty: number
  /** Price per unit; line total = qty × unitPrice. */
  unitPrice: Cents
  /** Today's single-group sharing. `[]` is the everyone sentinel.
   *  Used when `portions` is absent. RETAINED verbatim. */
  assignedDinerIds: string[]
  /** OPTIONAL opt-in split. When present and non-empty, OVERRIDES
   *  assignedDinerIds: the item is allocated portion-by-portion. Absent
   *  (undefined) for the common un-split case — never written for it. */
  portions?: Portion[]
}

/** OCR verdict from the Tier-2 arithmetic check; null for manual entry. */
export interface ScanVerdict {
  status: 'green' | 'amber' | 'red'
  deltaCents: Cents
}

export interface RoundState {
  venue: string
  diners: Diner[]
  items: Item[]
  discount: Cents
  servicePct: number
  gstPct: number
  /** SG cash-rounding line (signed): grand total adjusted to e.g. nearest 5¢. */
  rounding: Cents
  scan: ScanVerdict | null
  /** Printed grand total from the scanned receipt — anchor for the live
   *  "does it add up" check; null for manual entry / total-less receipts. */
  scannedTotal: Cents | null
}

/** UNCHANGED. Portions never change what the whole line costs.
 *  Invariant: Σ(portion.units·unitPrice) === lineTotal. */
export const lineTotal = (it: Item): Cents => cents(it.qty * it.unitPrice)

/** Exact integer cents for one portion: units × unitPrice. New helper.
 *  Safe: `cents()` (money.ts:11) throws on non-integers, but `units` is a
 *  positive integer (portionZod + store clamps) and `unitPrice` is int. */
export const portionTotal = (unitPrice: Cents, units: number): Cents =>
  cents(units * unitPrice)

/** The single predicate every consumer branches on. `portions: []` (from a
 *  hand-rolled link) is treated as ABSENT, so split engine, UI and store
 *  fall back to assignedDinerIds. */
export const isPortioned = (it: Item): boolean =>
  Array.isArray(it.portions) && it.portions.length > 0

/** Units accounted for by portions. Equals qty when the invariant holds. */
export const portionedUnits = (it: Item): number =>
  it.portions ? it.portions.reduce((a, p) => a + p.units, 0) : 0

/** UI-queryable mirror of addPortion's no-op condition: a portion can be
 *  carved only if some portion has >=2 units to spare. Colocated so the
 *  disabled-state logic stays out of the component. */
export const canAddPortion = (it: Item): boolean =>
  isPortioned(it) && it.portions!.some((p) => p.units >= 2)
