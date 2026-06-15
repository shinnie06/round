import { addC, cents, type Cents, ZERO } from './money'
import { applyCharges, type ChargeBreakdown } from './singapore'
import { distributeProportionally } from './proportional'
import { distributeResidual } from './residual'
import { lineTotal, type RoundState } from '@/state/types'

/**
 * splitBill — the full engine pipeline, in one pass:
 *
 *   1. Per-item allocation: each item's line total is split in exact
 *      cents across its assigned diners (the `[]` sentinel = everyone),
 *      largest-remainder per item so every cent lands on somebody.
 *   2. applyCharges: IRAS order (discount → service → GST), clamped.
 *   3. Each charge is distributed across diners proportional to their
 *      food share (discount as a negative amount).
 *   4. distributeResidual: signed leftover cents (only possible after
 *      manual charge edits) pinned on the highest payer.
 *
 * Invariant (fuzz-tested): Σ per-diner totals === grand total. Always.
 */
export interface DinerSplit {
  dinerId: string
  food: Cents
  discount: Cents
  service: Cents
  gst: Cents
  total: Cents
}

export interface BillSplit {
  breakdown: ChargeBreakdown
  perDiner: DinerSplit[]
  residual: Cents
  residualDinerId: string | null
}

export function splitBill(state: RoundState): BillSplit {
  const { diners, items } = state
  const idx = new Map(diners.map((d, i) => [d.id, i]))
  const food: Cents[] = diners.map(() => ZERO)

  for (const item of items) {
    const participants =
      item.assignedDinerIds.length === 0
        ? diners.map((d) => d.id)
        : item.assignedDinerIds.filter((id) => idx.has(id))
    if (participants.length === 0) continue
    const shares = distributeProportionally(
      lineTotal(item),
      participants.map(() => 1),
    )
    participants.forEach((id, k) => {
      const i = idx.get(id)!
      food[i] = addC(food[i]!, shares[k]!)
    })
  }

  const subtotal = addC(...food)
  const breakdown = applyCharges(subtotal, {
    discount: state.discount,
    servicePct: state.servicePct,
    gstPct: state.gstPct,
    rounding: state.rounding,
  })

  const weights = food.map((c) => c as number)
  const discountShares = distributeProportionally(cents(-breakdown.discount), weights)
  const serviceShares = distributeProportionally(breakdown.service, weights)
  const gstShares = distributeProportionally(breakdown.gst, weights)

  const totals = diners.map((_, i) =>
    addC(food[i]!, discountShares[i]!, serviceShares[i]!, gstShares[i]!),
  )
  const { totals: adjusted, absorbedBy, residual } = distributeResidual(totals, breakdown.grandTotal)

  return {
    breakdown,
    perDiner: diners.map((d, i) => ({
      dinerId: d.id,
      food: food[i]!,
      discount: discountShares[i]!,
      service: serviceShares[i]!,
      gst: gstShares[i]!,
      total: adjusted[i]!,
    })),
    residual,
    residualDinerId: absorbedBy === null ? null : diners[absorbedBy]!.id,
  }
}
