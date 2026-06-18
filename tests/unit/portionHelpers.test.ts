import { describe, it, expect } from 'vitest'
import { cents } from '@/math/money'
import {
  portionTotal,
  isPortioned,
  portionedUnits,
  canAddPortion,
  type Item,
} from '@/state/types'

describe('portionTotal', () => {
  it('returns units × unitPrice as exact integer cents', () => {
    expect(portionTotal(cents(1400), 2)).toBe(2800)
  })

  it('returns 0 for 0 units', () => {
    expect(portionTotal(cents(1400), 0)).toBe(0)
  })

  it('throws when units × unitPrice is not an integer', () => {
    // 1.5 × 3 = 4.5 (non-integer) → cents() throws. (NB: 1.5 × 100 = 150 is
    // an integer and would NOT throw — the product must be fractional.)
    expect(() => portionTotal(cents(3), 1.5)).toThrow()
  })
})

const baseItem = (over: Partial<Item> = {}): Item => ({
  id: 'i1',
  name: 'Adobo',
  qty: 3,
  unitPrice: cents(1400),
  assignedDinerIds: [],
  ...over,
})

describe('isPortioned', () => {
  it('is false when portions is undefined', () => {
    expect(isPortioned(baseItem())).toBe(false)
  })

  it('is false when portions is an empty array (treated as absent)', () => {
    expect(isPortioned(baseItem({ portions: [] }))).toBe(false)
  })

  it('is true when at least one portion is present', () => {
    expect(
      isPortioned(baseItem({ portions: [{ units: 3, assignedDinerIds: [] }] })),
    ).toBe(true)
  })
})

describe('portionedUnits', () => {
  it('is 0 when portions is undefined', () => {
    expect(portionedUnits(baseItem())).toBe(0)
  })

  it('sums the units of all portions', () => {
    expect(
      portionedUnits(
        baseItem({
          portions: [
            { units: 1, assignedDinerIds: ['P1'] },
            { units: 2, assignedDinerIds: [] },
          ],
        }),
      ),
    ).toBe(3)
  })
})

describe('canAddPortion', () => {
  it('is false when the item is un-split', () => {
    expect(canAddPortion(baseItem())).toBe(false)
  })

  it('is true when some portion has >= 2 units to spare', () => {
    expect(
      canAddPortion(
        baseItem({
          portions: [
            { units: 1, assignedDinerIds: ['P1'] },
            { units: 2, assignedDinerIds: [] },
          ],
        }),
      ),
    ).toBe(true)
  })

  it('is false when every portion is exactly 1 unit (fully fragmented)', () => {
    expect(
      canAddPortion(
        baseItem({
          qty: 2,
          portions: [
            { units: 1, assignedDinerIds: ['P1'] },
            { units: 1, assignedDinerIds: ['P2'] },
          ],
        }),
      ),
    ).toBe(false)
  })
})
