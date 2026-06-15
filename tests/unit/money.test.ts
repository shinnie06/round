import { describe, it, expect } from 'vitest'
import { cents, fromDollars, toDollars, addC, ZERO } from '@/math/money'

describe('cents', () => {
  it('brands integers', () => {
    expect(cents(150)).toBe(150)
    expect(cents(0)).toBe(0)
    expect(cents(-5)).toBe(-5)
  })
  it('throws on non-integers', () => {
    expect(() => cents(1.5)).toThrow()
    expect(() => cents(NaN)).toThrow()
    expect(() => cents(Infinity)).toThrow()
  })
})

describe('fromDollars', () => {
  it('converts exact amounts', () => {
    expect(fromDollars(1.01)).toBe(101)
    expect(fromDollars(176.25)).toBe(17625)
    expect(fromDollars(0)).toBe(0)
  })
  it('rounds half-up on magnitude', () => {
    expect(fromDollars(1.005)).toBe(101)
    expect(fromDollars(1.004)).toBe(100)
  })
  it('is sign-symmetric', () => {
    expect(fromDollars(-2.345)).toBe(-235)
    expect(fromDollars(-1.005)).toBe(-101)
  })
  it('survives float artifacts', () => {
    // 19.9 * 100 === 1989.9999999999998 in IEEE754
    expect(fromDollars(19.9)).toBe(1990)
  })
})

describe('toDollars / addC / ZERO', () => {
  it('round-trips', () => {
    expect(toDollars(cents(101))).toBe(1.01)
  })
  it('addC sums', () => {
    expect(addC(cents(1), cents(2), cents(-3))).toBe(0)
    expect(addC()).toBe(0)
  })
  it('ZERO is zero', () => {
    expect(ZERO).toBe(0)
  })
})
