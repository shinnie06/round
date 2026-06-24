import type { BillSplit } from '@/math/splitBill'
import type { RoundState } from '@/state/types'

export interface CollectionView {
  active: boolean
  amountByDiner: Record<string, number>
  absorbed: number
}

/**
 * Opt-in collection layer over the (already fair, exact) split. When a payer is
 * set and a unit is chosen, every NON-payer is rounded DOWN to the unit; the
 * payer keeps their true share and silently absorbs the rounded-off cents.
 * Inert (active:false, true amounts) when off or the payer is missing.
 */
export function collectionView(round: RoundState, split: BillSplit): CollectionView {
  const unit = round.collectRounding as number
  const payerId = round.payerId
  const amountByDiner: Record<string, number> = {}
  const payerExists = payerId !== null && split.perDiner.some((d) => d.dinerId === payerId)
  if (unit <= 0 || !payerExists) {
    for (const d of split.perDiner) amountByDiner[d.dinerId] = d.total as number
    return { active: false, amountByDiner, absorbed: 0 }
  }
  let absorbed = 0
  for (const d of split.perDiner) {
    const t = d.total as number
    if (d.dinerId === payerId) {
      amountByDiner[d.dinerId] = t
    } else {
      const rounded = Math.floor(t / unit) * unit
      amountByDiner[d.dinerId] = rounded
      absorbed += t - rounded
    }
  }
  return { active: true, amountByDiner, absorbed }
}
