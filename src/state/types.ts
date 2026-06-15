import { cents, type Cents } from '@/math/money'

export type Screen = 'splash' | 'workspace' | 'settle'

export interface Diner {
  id: string
  name: string
  /** Index into DINER_COLORS — stable per diner, reused across screens. */
  colorIdx: number
}

export interface Item {
  id: string
  name: string
  qty: number
  /** Price per unit; line total = qty × unitPrice. */
  unitPrice: Cents
  /** Diner ids sharing this item. `[]` is the "everyone" sentinel. */
  assignedDinerIds: string[]
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
