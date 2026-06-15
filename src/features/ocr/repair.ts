import { fromDollars } from '@/math/money'
import type { CleanReceipt } from './types'
import { exactCharges } from './reconcile'

/**
 * repair — Tier-2.5, between sanitize and reconcile: deterministic
 * arithmetic repair of a known constrained-decoding failure, then tidy-up.
 *
 * The JSON schema forces a number onto every item row, so FOC/unpriced
 * descriptor lines sometimes "borrow" the value of an adjacent printed row —
 * observed verbatim with the GST amount, and encode-dependent: the same
 * photo flips between 0 and the borrowed value across JPEG qualities.
 *
 * The printed grand total is the one field the model reads reliably, so it
 * anchors the repair: if the bill doesn't reconcile under any interpretation
 * but zeroing a UNIQUE minimal set of items whose price equals a printed
 * charge amount (GST / service) makes it exact, that set was borrowed.
 * Several equally valid sets → ambiguous → repair nothing; an honest red
 * verdict beats a guess.
 *
 * Zero-priced rows (FOC descriptors, repaired borrows) are then dropped:
 * they carry no money and only clutter the split.
 */
export function repair(clean: CleanReceipt): CleanReceipt {
  return dropZeroLines(fixBorrowedPrices(clean))
}

function zeroAt(clean: CleanReceipt, idxs: readonly number[]): CleanReceipt {
  return {
    ...clean,
    items: clean.items.map((it, i) => (idxs.includes(i) ? { ...it, line_total: 0 } : it)),
  }
}

function combinations(pool: readonly number[], size: number): number[][] {
  if (size === 0) return [[]]
  return pool.flatMap((v, i) =>
    combinations(pool.slice(i + 1), size - 1).map((rest) => [v, ...rest]),
  )
}

function fixBorrowedPrices(clean: CleanReceipt): CleanReceipt {
  if (clean.grand_total === null || exactCharges(clean) !== null) return clean

  const chargeCents = [clean.gst, clean.service_charge]
    .filter((v): v is number => v !== null && v > 0)
    .map(fromDollars)
  const suspects = clean.items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => it.line_total > 0 && chargeCents.includes(fromDollars(it.line_total)))
    .map(({ i }) => i)

  for (let size = 1; size <= Math.min(suspects.length, 3); size++) {
    const hits = combinations(suspects, size).filter(
      (c) => exactCharges(zeroAt(clean, c)) !== null,
    )
    if (hits.length === 1) return zeroAt(clean, hits[0]!)
    if (hits.length > 1) return clean // ambiguous — leave it for the red banner
  }
  return clean
}

function dropZeroLines(clean: CleanReceipt): CleanReceipt {
  return { ...clean, items: clean.items.filter((it) => it.line_total > 0) }
}
