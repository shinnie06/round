import { describe, it, expect } from 'vitest'
import { cents } from '@/math/money'
import { splitBill } from '@/math/splitBill'
import type { Diner, Item, RoundState } from '@/state/types'

/**
 * THE invariant of the whole app: Σ per-diner totals === grand total,
 * for any round a user could possibly construct. If this holds, nobody
 * ever over- or under-pays by even a cent.
 */
describe('splitBill property: exact-sum invariant', () => {
  it('holds across 300 seeded random rounds', () => {
    let seed = 0xf00d
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 2 ** 32)
    const randInt = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))

    for (let i = 0; i < 300; i++) {
      const dinerCount = randInt(1, 8)
      const diners: Diner[] = Array.from({ length: dinerCount }, (_, d) => ({
        id: `d${d}`,
        name: `Diner ${d}`,
        colorIdx: d % 8,
      }))

      const items: Item[] = Array.from({ length: randInt(0, 12) }, (_, j) => {
        // 40% everyone-sentinel, else a random non-empty subset
        let assigned: string[] = []
        if (rand() >= 0.4) {
          assigned = diners.filter(() => rand() < 0.5).map((d) => d.id)
          if (assigned.length === 0) assigned = [diners[randInt(0, dinerCount - 1)]!.id]
        }
        return {
          id: `i${j}`,
          name: `Item ${j}`,
          qty: randInt(1, 5),
          unitPrice: cents(randInt(1, 20_000)),
          assignedDinerIds: assigned,
        }
      })

      const state: RoundState = {
        venue: 'Fuzz',
        diners,
        items,
        discount: cents(randInt(0, 5_000)),
        servicePct: rand() < 0.2 ? 0 : 0.1,
        gstPct: rand() < 0.2 ? 0 : 0.09,
        rounding: cents(randInt(0, 8) - 4),
        scan: null,
        scannedTotal: null,
      }

      const s = splitBill(state)
      const sum = s.perDiner.reduce<number>((a, d) => a + d.total, 0)
      expect(sum, `case ${i}`).toBe(s.breakdown.grandTotal)
      for (const d of s.perDiner) {
        expect(Number.isNaN(d.total), `NaN in case ${i}`).toBe(false)
      }
    }
  })
})
