import { describe, it, expect } from 'vitest'
import { cents } from '@/math/money'
import { portionTotal, isPortioned, type Item } from '@/state/types'

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
