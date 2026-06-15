import { cents, type Cents } from './money'

/**
 * distributeResidual — final safety net of the split pipeline.
 *
 * After every component (items, discount, service, GST) has been
 * distributed exactly, per-diner totals should already sum to the grand
 * total. But manual edits (e.g. user overrides a printed GST amount) can
 * leave a residual of a few signed cents. Rather than silently losing
 * money, we pin the residual on the diner with the highest total —
 * they're least likely to feel a ±1¢ adjustment.
 *
 * Returns the adjusted totals plus which diner absorbed the residual,
 * so the UI can show a "+1¢ rounding" annotation.
 */
export interface ResidualResult {
  totals: Cents[]
  /** Index of the diner who absorbed the residual, or null if none. */
  absorbedBy: number | null
  /** Signed cents that were absorbed (0 when books already balance). */
  residual: Cents
}

export function distributeResidual(totals: Cents[], grandTotal: Cents): ResidualResult {
  const sum = totals.reduce<number>((a, b) => a + b, 0)
  const residual = cents(grandTotal - sum)
  if (residual === 0 || totals.length === 0)
    return { totals, absorbedBy: null, residual: cents(0) }

  // Highest payer absorbs; ties → lowest index for determinism.
  let maxIdx = 0
  for (let i = 1; i < totals.length; i++) {
    if ((totals[i] ?? 0) > (totals[maxIdx] ?? 0)) maxIdx = i
  }
  const adjusted = totals.map((t, i) => (i === maxIdx ? cents(t + residual) : t))
  return { totals: adjusted, absorbedBy: maxIdx, residual }
}
