import { describe, it, expect } from 'vitest'
import { cents, type Cents } from '@/math/money'
import { distributeProportionally } from '@/math/proportional'

const sum = (cs: Cents[]) => cs.reduce<number>((a, b) => a + b, 0)

describe('distributeProportionally — largest remainder (Hamilton)', () => {
  it('splits equal weights with deterministic remainder placement', () => {
    expect(distributeProportionally(cents(100), [1, 1, 1])).toEqual([34, 33, 33])
  })

  it('ties go to the lowest index', () => {
    expect(distributeProportionally(cents(1), [1, 1])).toEqual([1, 0])
    expect(distributeProportionally(cents(3), [1, 1])).toEqual([2, 1])
  })

  it('respects proportions', () => {
    expect(distributeProportionally(cents(300), [2, 1])).toEqual([200, 100])
  })

  it('all-zero weights → equal split', () => {
    expect(distributeProportionally(cents(99), [0, 0, 0])).toEqual([33, 33, 33])
    expect(distributeProportionally(cents(100), [0, 0, 0])).toEqual([34, 33, 33])
  })

  it('zero-weight member gets nothing when others have weight', () => {
    expect(distributeProportionally(cents(100), [1, 0, 1])).toEqual([50, 0, 50])
  })

  it('negative totals (discounts) mirror positive distribution', () => {
    expect(distributeProportionally(cents(-100), [1, 1, 1])).toEqual([-34, -33, -33])
  })

  it('edge shapes', () => {
    expect(distributeProportionally(cents(0), [1, 2])).toEqual([0, 0])
    expect(distributeProportionally(cents(500), [])).toEqual([])
    expect(distributeProportionally(cents(7), [3])).toEqual([7])
  })

  it('fuzz: 500 seeded cases — Σ === total, each share within 1¢ of exact', () => {
    // Deterministic LCG so failures are reproducible.
    let seed = 0x5eed
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 2 ** 32)

    for (let i = 0; i < 500; i++) {
      const n = 1 + Math.floor(rand() * 8)
      const weights = Array.from({ length: n }, () => (rand() < 0.15 ? 0 : Math.floor(rand() * 1000)))
      const total = cents(Math.floor(rand() * 200_000) - 50_000)
      const out = distributeProportionally(total, weights)

      expect(out).toHaveLength(n)
      expect(sum(out)).toBe(total)

      const wSum = weights.reduce((a, b) => a + b, 0)
      for (let j = 0; j < n; j++) {
        const exact = wSum === 0 ? total / n : (total * weights[j]!) / wSum
        expect(Math.abs(out[j]! - exact)).toBeLessThan(1 + 1e-9)
      }
    }
  })
})
