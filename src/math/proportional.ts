import { cents, type Cents } from './money'

/**
 * distributeProportionally — largest-remainder (Hamilton) method.
 *
 * Splits `total` across `weights` in exact integer cents:
 * Σ(result) === total, always, for any input. The "extra" cents left
 * over after flooring each exact quota go, one each, to the shares with
 * the largest fractional remainders — the allocation every diner would
 * agree is fairest, and the same one parliaments use to seat fractions.
 *
 * Guarantees:
 *  - Deterministic: remainder ties break toward the lowest index.
 *  - Negative totals (discounts) distribute as the mirror image of
 *    the positive distribution — sign-symmetric to the cent.
 *  - All-zero (or empty-sum) weights fall back to equal weights:
 *    a charge never vanishes just because nobody ordered food yet.
 *  - weights.length === 0 → [] (and total is the caller's problem).
 */
export function distributeProportionally(total: Cents, weights: number[]): Cents[] {
  const n = weights.length
  if (n === 0) return []

  // Mirror negative totals: distribute the magnitude, then negate.
  if (total < 0) {
    return distributeProportionally(cents(-total), weights).map((c) => cents(-c))
  }

  const wSum = weights.reduce<number>((a, b) => a + b, 0)
  const w = wSum === 0 ? weights.map(() => 1) : weights
  const sum = wSum === 0 ? n : wSum

  const base: number[] = new Array<number>(n)
  const remainders: { frac: number; idx: number }[] = []
  let allocated = 0
  for (let i = 0; i < n; i++) {
    const quota = (total * w[i]!) / sum
    const floor = Math.floor(quota)
    base[i] = floor
    allocated += floor
    remainders.push({ frac: quota - floor, idx: i })
  }

  // Hand the leftover cents to the largest fractional remainders.
  remainders.sort((a, b) => b.frac - a.frac || a.idx - b.idx)
  let leftover = total - allocated
  for (let k = 0; leftover > 0; k++, leftover--) {
    base[remainders[k]!.idx] = base[remainders[k]!.idx]! + 1
  }

  return base.map((b) => cents(b))
}
