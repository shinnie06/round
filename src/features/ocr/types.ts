import type { Cents } from '@/math/money'

/**
 * The OCR boundary speaks DOLLARS (the LLM reads them off the receipt
 * as printed). Conversion to Cents happens exactly once, in mapToState.
 */
export interface RawLine {
  name: string
  qty: number
  line_total: number
}

export interface RawReceipt {
  venue: string | null
  items: RawLine[]
  discount: number | null
  service_charge: number | null
  gst: number | null
  /** Signed dollars — SG cash rounding is usually ±$0.01–0.04. */
  rounding: number | null
  grand_total: number | null
}

/** sanitize() preserves the shape and fixes the content. */
export type CleanReceipt = RawReceipt

/**
 * Additive charge amounts proven by exact reconciliation against the
 * printed grand total. 0 means the printed row (if any) is informational —
 * e.g. "Incl GST 9%" on quick-service receipts.
 */
export interface ResolvedCharges {
  service: Cents
  gst: Cents
}

/** Tier-2 arithmetic verdict. */
export interface Verdict {
  status: 'green' | 'amber' | 'red'
  deltaCents: Cents
  /** Present only on an exact (green) reconciliation. */
  resolved?: ResolvedCharges
}
