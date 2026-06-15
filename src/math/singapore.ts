import { cents, type Cents } from './money'

/**
 * Singapore tax order (LOCKED — IRAS-mandated):
 *
 *   1. discounted  = subtotal − discount        (discount clamped to [0, subtotal])
 *   2. service     = discounted × servicePct    (default 10%)
 *   3. gst         = (discounted + service) × gstPct   (default 9%)
 *
 * GST is charged on the service charge too — service is itself taxable
 * per IRAS guidance for F&B. Each charge is rounded to the cent
 * independently, matching how SG receipts print their SVC and GST rows.
 */
export interface Charges {
  discount: Cents
  servicePct: number
  gstPct: number
  /** Signed cash-rounding adjustment applied AFTER GST (SG receipts round to 5¢). */
  rounding?: Cents
}

export interface ChargeBreakdown {
  subtotal: Cents
  /** Clamped to [0, subtotal] — never produces a negative bill. */
  discount: Cents
  service: Cents
  gst: Cents
  rounding: Cents
  grandTotal: Cents
}

/** Round a (possibly fractional) cent amount half-up, with float-artifact shield. */
const roundCents = (x: number): Cents => cents(Math.round(x + Number.EPSILON * 1e4))

export function applyCharges(subtotal: Cents, charges: Charges): ChargeBreakdown {
  const discount = cents(Math.min(Math.max(charges.discount, 0), subtotal))
  const discounted = cents(subtotal - discount)
  const service = roundCents(discounted * charges.servicePct)
  const gst = roundCents((discounted + service) * charges.gstPct)
  const rounding = charges.rounding ?? cents(0)
  const grandTotal = cents(discounted + service + gst + rounding)
  return { subtotal, discount, service, gst, rounding, grandTotal }
}
