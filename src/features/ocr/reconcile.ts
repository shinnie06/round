import { addC, cents, fromDollars, ZERO, type Cents } from '@/math/money'
import type { CleanReceipt, ResolvedCharges, Verdict } from './types'

/**
 * reconcile — Tier-2 arithmetic check. Catches LLM hallucinations
 * without a second LLM call: recompute the bill from the parsed lines
 * and compare against the printed grand total.
 *
 * SG receipts are not one shape. The same printed rows mean different
 * things at different venues: a GST row can be additive (restaurant) or
 * informational ("Incl GST 9%" at quick service); a missing service row
 * can mean 10% folded elsewhere (banquet) or genuinely no charge (hawker).
 * Arithmetic disambiguates: we try the small set of legal interpretations
 * and an EXACT match against the printed total proves one of them.
 *
 * Interpretation candidates per charge: the printed amount when the row
 * exists (else the SG default — 10% service, 9% GST in IRAS order), and 0.
 * Standard readings are tried first so an additive receipt never resolves
 * to zeros. The winning amounts are returned in the verdict so mapToState
 * applies the SAME interpretation the verdict was earned with.
 *
 * Verdict: exact interpretation → green · ≤25¢ or ≤0.5% drift on the
 * standard reading → amber · else red · no printed total → amber.
 */
function moneyParts(clean: CleanReceipt) {
  const subtotal = addC(...clean.items.map((i) => fromDollars(i.line_total)))
  const rawDiscount = clean.discount === null ? ZERO : fromDollars(clean.discount)
  return {
    subtotal,
    discounted: cents(subtotal - Math.min(rawDiscount, subtotal)),
    rounding: clean.rounding === null ? ZERO : fromDollars(clean.rounding),
  }
}

/** Same half-up rounding + float-artifact shield as math/singapore's roundCents. */
const roundC = (x: number): Cents => cents(Math.round(x + Number.EPSILON * 1e4))
const defaultService = (discounted: Cents): Cents => roundC(discounted * 0.1)
const defaultGst = (discounted: Cents, service: Cents): Cents =>
  roundC((discounted + service) * 0.09)

/** The interpretation search. Exported for repair's what-if probing. */
export function exactCharges(clean: CleanReceipt): ResolvedCharges | null {
  if (clean.grand_total === null) return null
  const { discounted, rounding } = moneyParts(clean)
  const printed = fromDollars(clean.grand_total)

  // Candidates per charge, in trust order: the printed amount; the exact
  // canonical amount when the printed one is within half a point of the
  // 10%/9% rate (a misread digit on the charge row — the rate is exact even
  // when the OCR of its amount isn't); 0 (informational row / no charge).
  const snapped = (printedAmt: Cents, canonical: Cents, base: Cents): Cents[] =>
    base > 0 && Math.abs(printedAmt / base - canonical / base) <= 0.005 && canonical !== printedAmt
      ? [canonical]
      : []
  const serviceCands =
    clean.service_charge !== null
      ? [
          fromDollars(clean.service_charge),
          ...snapped(fromDollars(clean.service_charge), defaultService(discounted), discounted),
          ZERO,
        ]
      : [defaultService(discounted), ZERO]
  for (const service of serviceCands) {
    const gstBase = cents(discounted + service)
    const gstCands =
      clean.gst !== null
        ? [
            fromDollars(clean.gst),
            ...snapped(fromDollars(clean.gst), defaultGst(discounted, service), gstBase),
            ZERO,
          ]
        : [defaultGst(discounted, service), ZERO]
    for (const gst of gstCands) {
      if (cents(discounted + service + gst + rounding) === printed) return { service, gst }
    }
  }
  return null
}

export function reconcile(clean: CleanReceipt): Verdict {
  if (clean.grand_total === null) {
    return { status: 'amber', deltaCents: ZERO }
  }

  const resolved = exactCharges(clean)
  if (resolved) return { status: 'green', deltaCents: ZERO, resolved }

  // No interpretation is exact — measure drift of the standard reading
  // (printed components, SG defaults for missing ones).
  const { discounted, rounding } = moneyParts(clean)
  const service =
    clean.service_charge === null ? defaultService(discounted) : fromDollars(clean.service_charge)
  const gst = clean.gst === null ? defaultGst(discounted, service) : fromDollars(clean.gst)

  const expected = cents(discounted + service + gst + rounding)
  const printed = fromDollars(clean.grand_total)
  const delta = cents(Math.abs(expected - printed))

  return { status: judgeDelta(delta, printed), deltaCents: delta }
}

/** Shared verdict thresholds — also drives the live workspace banner. */
export function judgeDelta(delta: Cents, printed: Cents): Verdict['status'] {
  if (delta === 0) return 'green'
  if (delta <= 25 || delta <= Math.abs(printed) * 0.005) return 'amber'
  return 'red'
}
