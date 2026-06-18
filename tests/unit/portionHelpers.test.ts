import { describe, it, expect } from 'vitest'
import { cents } from '@/math/money'
import { portionTotal } from '@/state/types'

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
