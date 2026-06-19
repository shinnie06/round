import { describe, it, expect } from 'vitest'
import { cents } from '@/math/money'
import { splitBill } from '@/math/splitBill'
import type { Diner, Item, RoundState } from '@/state/types'
import { parseRoundState } from '@/state/schema'

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
        const qty = randInt(1, 5)
        const unitPrice = cents(randInt(1, 20_000))

        // ── pick the item-level participant list (today's logic) ──
        const pickAssigned = (): string[] => {
          let assigned: string[] = []
          if (rand() >= 0.4) {
            assigned = diners.filter(() => rand() < 0.5).map((d) => d.id)
            if (assigned.length === 0) assigned = [diners[randInt(0, dinerCount - 1)]!.id]
          }
          return assigned
        }

        const base: Item = {
          id: `i${j}`,
          name: `Item ${j}`,
          qty,
          unitPrice,
          assignedDinerIds: pickAssigned(),
        }

        // ~30% of items become portioned, but ONLY via cut-points so
        // Σ(portion.units) === qty BY CONSTRUCTION (exercises the engine,
        // not the schema downgrade). Each portion gets its own subset/sentinel.
        if (qty >= 2 && rand() < 0.3) {
          const k = randInt(1, qty) // 1..qty contiguous portions
          const cuts = new Set<number>()
          while (cuts.size < k - 1) cuts.add(randInt(1, qty - 1))
          const bounds = [0, ...[...cuts].sort((a, b) => a - b), qty]
          const portions = []
          for (let b = 1; b < bounds.length; b++) {
            portions.push({
              units: bounds[b]! - bounds[b - 1]!,
              assignedDinerIds: pickAssigned(),
            })
          }
          base.portions = portions
        }

        return base
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

      // Per-line cost conservation: recompute subtotal from the items using
      // ONLY non-orphaned slices, and assert it matches the engine's subtotal.
      // Catches a portionTotal bug that happens to still globally balance.
      const known = new Set(diners.map((d) => d.id))
      const resolves = (assigned: string[]) =>
        assigned.length === 0 || assigned.some((id) => known.has(id))
      let expectedSubtotal = 0
      for (const it of items) {
        if (Array.isArray(it.portions) && it.portions.length > 0) {
          for (const p of it.portions) {
            if (resolves(p.assignedDinerIds)) expectedSubtotal += p.units * it.unitPrice
          }
        } else if (resolves(it.assignedDinerIds)) {
          expectedSubtotal += it.qty * it.unitPrice
        }
      }
      expect(s.breakdown.subtotal, `subtotal case ${i}`).toBe(expectedSubtotal)
    }
  })

  it('non-conserving portions routed through parseRoundState never break the engine', () => {
    let seed = 0xbeef
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 2 ** 32)
    const randInt = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))

    for (let i = 0; i < 120; i++) {
      const dinerCount = randInt(1, 5)
      const diners = Array.from({ length: dinerCount }, (_, d) => ({
        id: `d${d}`,
        name: `Diner ${d}`,
        colorIdx: d % 8,
      }))

      const items = Array.from({ length: randInt(1, 6) }, (_, j) => {
        const qty = randInt(2, 5)
        // DELIBERATELY non-conserving: each portion gets an INDEPENDENT random
        // unit count, so Σ units almost never equals qty → schema downgrades it.
        const k = randInt(1, 3)
        const portions = Array.from({ length: k }, () => ({
          units: randInt(1, 4),
          assignedDinerIds: diners.filter(() => rand() < 0.5).map((d) => d.id),
        }))
        return {
          id: `i${j}`,
          name: `Item ${j}`,
          qty,
          unitPrice: randInt(1, 20_000),
          assignedDinerIds: [] as string[],
          portions,
        }
      })

      const raw = {
        venue: 'Fuzz',
        diners,
        items,
        discount: randInt(0, 5_000),
        servicePct: 0.1,
        gstPct: 0.09,
        rounding: randInt(0, 8) - 4,
        scan: null,
        scannedTotal: null,
      }

      // The schema either keeps conserving portions or downgrades to un-split;
      // either way the engine input is valid and Σ must balance.
      const parsed = parseRoundState(raw)
      expect(parsed, `parse case ${i}`).not.toBeNull()
      const s = splitBill(parsed!)
      const sum = s.perDiner.reduce<number>((a, d) => a + d.total, 0)
      expect(sum, `case ${i}`).toBe(s.breakdown.grandTotal)
    }
  })
})
