import { addC, cents, type Cents, ZERO } from './money'
import { applyCharges, type ChargeBreakdown } from './singapore'
import { distributeProportionally } from './proportional'
import { lineTotal, portionTotal, isPortioned, type Diner, type Item, type RoundState } from '@/state/types'

/**
 * splitBill — the full engine pipeline, in one pass:
 *
 *   1. Per-item allocation: each item's line total is split in exact
 *      cents across its assigned diners (the `[]` sentinel = everyone),
 *      largest-remainder per item so every cent lands on somebody.
 *   2. applyCharges: IRAS order (discount → service → GST), clamped.
 *   3. B2: per-diner total rounded ONCE via largest-remainder over exact
 *      food weights. Charge columns back-derived from (total − food).
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

// Split integer `total` across `targets` (signed exact values that sum to ~total)
// into integers summing EXACTLY to total, each as close to its target as possible.
// Largest-remainder, sign-aware. Used to back-derive per-diner charge columns so
// the expanded card reconciles (food + discount + service + gst === total).
function splitToTarget(total: number, targets: number[]): number[] {
  const n = targets.length
  if (n === 0) return []
  const base = targets.map((t) => Math.floor(t) + 0) // +0 normalises −0 → +0
  const res = base.slice()
  let leftover = total - base.reduce((a, b) => a + b, 0)
  const frac = targets.map((t, i) => t - base[i]!)
  const keys = [...Array(n).keys()]
  if (leftover > 0) {
    keys.sort((a, b) => frac[b]! - frac[a]! || a - b)
    for (let k = 0; k < leftover; k++) res[keys[k % n]!]! += 1
  } else if (leftover < 0) {
    keys.sort((a, b) => frac[a]! - frac[b]! || a - b)
    for (let k = 0; k < -leftover; k++) res[keys[k % n]!]! -= 1
  }
  return res
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
  exactFood: number[],
  item: Item,
  linesByDiner: FoodLine[][],
  portion: FoodLine['portion'],
): void {
  if (participants.length === 0) return
  const shares = distributeProportionally(
    cost,
    participants.map(() => 1),
  )
  const each = cost / participants.length // exact fractional share (display total uses this)
  participants.forEach((id, k) => {
    const i = idx.get(id)!
    food[i] = addC(food[i]!, shares[k]!)
    exactFood[i] = exactFood[i]! + each
    linesByDiner[i]!.push({ itemId: item.id, name: item.name, food: shares[k]!, portion })
  })
}

export function splitBill(state: RoundState): BillSplit {
  const { diners, items } = state
  const idx = new Map(diners.map((d, i) => [d.id, i]))
  const food: Cents[] = diners.map(() => ZERO)
  const exactFood: number[] = diners.map(() => 0)
  const linesByDiner: FoodLine[][] = diners.map(() => [])

  for (const item of items) {
    if (isPortioned(item)) {
      // Σ(portion.units·unitPrice) === lineTotal (units conservation, enforced
      // by store + schema), so when no portion is orphaned the line's total food
      // is unchanged — only WHO absorbs WHICH units differs.
      for (const p of item.portions!) {
        const cost = portionTotal(item.unitPrice, p.units)
        const participants = resolveParticipants(p.assignedDinerIds, diners, idx)
        allocateEqually(cost, participants, idx, food, exactFood, item, linesByDiner, {
          units: p.units,
          qty: item.qty,
          shareOf: participants.length,
        })
      }
    } else {
      // Un-split path — byte-identical to today.
      allocateEqually(
        lineTotal(item),
        resolveParticipants(item.assignedDinerIds, diners, idx),
        idx,
        food,
        exactFood,
        item,
        linesByDiner,
        undefined,
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

  // B2: the authoritative per-diner total — ONE largest-remainder pass over the
  // EXACT food shares. Identical exact shares ⇒ totals differ by ≤1¢ by construction,
  // and Σ totals === grandTotal. (Weights are exact, NOT the rounded food[].)
  const totals = distributeProportionally(breakdown.grandTotal, exactFood)
  const sub = subtotal as number // Cents → plain number for the float division below

  const perDiner: DinerSplit[] = diners.map((d, i) => {
    // Back-derive display charge columns from the diner's fixed total. The charge
    // block (everything past food) is split across service/gst/discount by their
    // exact magnitudes so food + discount + service + gst === total.
    //
    // block = total − food includes this diner's share of the cash-rounding line.
    // The three targets cover service/gst/discount ONLY, so splitToTarget folds the
    // rounding remainder into those columns — there is NO separate rounding row (per
    // design, spec §3.1). The per-diner total is authoritative; this column split is
    // display-only.
    const block = (totals[i]! as number) - (food[i]! as number)
    const share = sub === 0 ? 0 : exactFood[i]! / sub
    const [service, gst, discount] = splitToTarget(block, [
      (breakdown.service as number) * share,
      (breakdown.gst as number) * share,
      -(breakdown.discount as number) * share,
    ])
    return {
      dinerId: d.id,
      food: food[i]!,
      discount: cents(discount!),
      service: cents(service!),
      gst: cents(gst!),
      total: totals[i]!,
      lines: linesByDiner[i]!,
    }
  })

  return { breakdown, perDiner, residual: ZERO, residualDinerId: null }
}
