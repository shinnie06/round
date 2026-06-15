import { cents, fromDollars, ZERO } from '@/math/money'
import { newId } from '@/lib/id'
import type { Item, RoundState } from '@/state/types'
import type { CleanReceipt, Verdict } from './types'

/**
 * mapToState — the ONE place dollars become Cents.
 *
 * Two fidelity rules:
 *  - Printed money wins. If qty doesn't divide the line total evenly,
 *    we keep the printed total and collapse to qty 1 rather than invent
 *    a fractional unit price.
 *  - Percentages snap to canon. A printed SVC within half a point of 10%
 *    (or GST of 9%) IS 10%/9% — receipt rows are rounded, the rate isn't.
 *    Otherwise we keep the exact printed ratio so totals still reconcile.
 */
function toItem(name: string, qty: number, lineDollars: number): Item {
  const line = fromDollars(lineDollars)
  const evenSplit = qty > 0 && line % qty === 0
  return {
    id: newId(),
    name,
    qty: evenSplit ? qty : 1,
    unitPrice: evenSplit ? cents(line / qty) : line,
    assignedDinerIds: [],
  }
}

function snapPct(printed: number | null, base: number, canonical: number): number {
  if (printed === null) return canonical
  if (base <= 0) return printed === 0 ? 0 : canonical
  const ratio = printed / base
  return Math.abs(ratio - canonical) <= 0.005 ? canonical : ratio
}

const roundC = (x: number): number => Math.round(x + Number.EPSILON * 1e4)

/** snapPct for amounts PROVEN by reconciliation — but verify the snap
 *  re-rounds to the proven cent; printed money beats a tidy rate
 *  (e.g. printed GST 6.04 where a snapped 9% recomputes 6.05). */
function provenPct(amount: number, base: number, canonical: number): number {
  const snapped = snapPct(amount, base, canonical)
  if (roundC(base * snapped) === amount) return snapped
  return base > 0 ? amount / base : 0
}

export function mapToState(clean: CleanReceipt, verdict: Verdict): RoundState {
  const items = clean.items.map((i) => toItem(i.name, i.qty, i.line_total))
  const subtotal = items.reduce<number>((a, it) => a + it.qty * it.unitPrice, 0)
  const discount = clean.discount === null ? ZERO : fromDollars(clean.discount)
  const discounted = Math.max(0, subtotal - discount)
  const rounding = clean.rounding === null ? ZERO : fromDollars(clean.rounding)

  // A green verdict carries the charge amounts the reconciliation was
  // earned with (0 = informational row, e.g. "Incl GST 9%"). Use those;
  // only an unverified receipt falls back to printed values / SG defaults.
  const servicePct = verdict.resolved
    ? provenPct(verdict.resolved.service, discounted, 0.1)
    : snapPct(
        clean.service_charge === null ? null : fromDollars(clean.service_charge),
        discounted,
        0.1,
      )
  const serviceAmt = verdict.resolved ? verdict.resolved.service : Math.round(discounted * servicePct)
  const gstPct = verdict.resolved
    ? provenPct(verdict.resolved.gst, discounted + serviceAmt, 0.09)
    : snapPct(clean.gst === null ? null : fromDollars(clean.gst), discounted + serviceAmt, 0.09)

  return {
    venue: clean.venue ?? '',
    diners: [],
    items,
    discount,
    servicePct,
    gstPct,
    rounding,
    // only status + delta are state (persisted, share-linked); resolved is OCR-internal
    scan: { status: verdict.status, deltaCents: verdict.deltaCents },
    scannedTotal: clean.grand_total === null ? null : fromDollars(clean.grand_total),
  }
}
