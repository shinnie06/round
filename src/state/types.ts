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

export const lineTotal = (it: Item): Cents => cents(it.qty * it.unitPrice)
