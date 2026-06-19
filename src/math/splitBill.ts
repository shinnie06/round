import { addC, cents, type Cents, ZERO } from './money'
import { applyCharges, type ChargeBreakdown } from './singapore'
import { distributeProportionally } from './proportional'
import { distributeResidual } from './residual'
import { lineTotal, portionTotal, isPortioned, type Diner, type RoundState } from '@/state/types'

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
export interface FoodLine {
  itemId: string
  /** Item name, copied so share text needs no item lookup. */
  name: string
  /** This diner's exact cents for this item (this portion if portioned). */
  food: Cents
  /** Present ONLY when the item isPortioned(). Drives "1 of 3" vs "shared 2 of 3" copy. */
  portion?: { units: number; qty: number; shareOf: number }
}

export interface DinerSplit {
  dinerId: string
  food: Cents
  discount: Cents
  service: Cents
  gst: Cents
  total: Cents
  lines: FoodLine[]
}

export interface BillSplit {
  breakdown: ChargeBreakdown
  perDiner: DinerSplit[]
  residual: Cents
  residualDinerId: string | null
}

// `[]` → everyone; else the explicit ids that still exist. Identical rule at
// item and portion level (sentinel-meaning-identical invariant). The []-check
// is BEFORE the filter, so literal-[] (everyone) and all-unknown-after-filter
// ([] → skip) are correctly distinct.
function resolveParticipants(
  assigned: string[],
  diners: Diner[],
  idx: Map<string, number>,
): string[] {
  return assigned.length === 0
    ? diners.map((d) => d.id)
    : assigned.filter((id) => idx.has(id))
}

// Split an exact-cent cost equally across participants (largest remainder) and
// accumulate into food[]. Empty participants → deposit nothing (orphan/skip),
// exactly like today's continue.
function allocateEqually(
  cost: Cents,
  participants: string[],
  idx: Map<string, number>,
  food: Cents[],
): void {
  if (participants.length === 0) return
  const shares = distributeProportionally(
    cost,
    participants.map(() => 1),
  )
  participants.forEach((id, k) => {
    const i = idx.get(id)!
    food[i] = addC(food[i]!, shares[k]!)
  })
}

export function splitBill(state: RoundState): BillSplit {
  const { diners, items } = state
  const idx = new Map(diners.map((d, i) => [d.id, i]))
  const food: Cents[] = diners.map(() => ZERO)

  for (const item of items) {
    if (isPortioned(item)) {
      // Σ(portion.units·unitPrice) === lineTotal (units conservation, enforced
      // by store + schema), so when no portion is orphaned the line's total food
      // is unchanged — only WHO absorbs WHICH units differs.
      for (const p of item.portions!) {
        const cost = portionTotal(item.unitPrice, p.units)
        allocateEqually(cost, resolveParticipants(p.assignedDinerIds, diners, idx), idx, food)
      }
    } else {
      // Un-split path — byte-identical to today.
      allocateEqually(
        lineTotal(item),
        resolveParticipants(item.assignedDinerIds, diners, idx),
        idx,
        food,
      )
    }
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
      lines: [],
    })),
    residual,
    residualDinerId: absorbedBy === null ? null : diners[absorbedBy]!.id,
  }
}
