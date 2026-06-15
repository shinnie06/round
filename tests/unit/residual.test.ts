import { describe, it, expect } from 'vitest'
import { cents } from '@/math/money'
import { distributeResidual } from '@/math/residual'

describe('distributeResidual', () => {
  it('balanced books → no absorption', () => {
    const r = distributeResidual([cents(500), cents(300)], cents(800))
    expect(r.absorbedBy).toBeNull()
    expect(r.residual).toBe(0)
    expect(r.totals).toEqual([500, 300])
  })

  it('positive residual lands on the highest payer', () => {
    const r = distributeResidual([cents(300), cents(500)], cents(802))
    expect(r.absorbedBy).toBe(1)
    expect(r.residual).toBe(2)
    expect(r.totals).toEqual([300, 502])
  })

  it('negative residual subtracts from the highest payer', () => {
    const r = distributeResidual([cents(300), cents(500)], cents(799))
    expect(r.absorbedBy).toBe(1)
    expect(r.residual).toBe(-1)
    expect(r.totals).toEqual([300, 499])
  })

  it('ties break to the lowest index', () => {
    const r = distributeResidual([cents(400), cents(400)], cents(801))
    expect(r.absorbedBy).toBe(0)
    expect(r.totals).toEqual([401, 400])
  })

  it('empty totals → no-op', () => {
    const r = distributeResidual([], cents(100))
    expect(r.absorbedBy).toBeNull()
    expect(r.totals).toEqual([])
  })

  it('adjusted totals always sum to the grand total', () => {
    const r = distributeResidual([cents(333), cents(333), cents(333)], cents(1000))
    expect(r.totals.reduce<number>((a, b) => a + b, 0)).toBe(1000)
  })
})
