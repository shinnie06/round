import { describe, it, expect } from 'vitest'
import { cents } from '@/math/money'
import type { FoodLine } from '@/math/splitBill'
import { lineLabel } from '@/features/settle/lineLabel'

const line = (over: Partial<FoodLine>): FoodLine => ({
  itemId: 'i',
  name: 'Adobo',
  food: cents(0),
  ...over,
})

describe('lineLabel', () => {
  it('un-split line (no portion) → just the name', () => {
    expect(lineLabel(line({ name: 'Pan-Seared Snapper' }))).toBe('Pan-Seared Snapper')
  })

  it('solo portion (shareOf 1) → name · {units} of {qty}', () => {
    expect(lineLabel(line({ portion: { units: 1, qty: 3, shareOf: 1 } }))).toBe('Adobo · 1 of 3')
  })

  it('shared portion (shareOf > 1) → name · shared {units} of {qty}', () => {
    expect(lineLabel(line({ portion: { units: 2, qty: 3, shareOf: 3 } }))).toBe(
      'Adobo · shared 2 of 3',
    )
  })
})
