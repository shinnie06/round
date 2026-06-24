/**
 * Regression guard: diners with an identical exact food share must land
 * within 1¢ of each other after splitBill rounds.
 */
import { describe, it, expect } from 'vitest'
import { cents } from '@/math/money'
import { splitBill } from '@/math/splitBill'
import { lineTotal, portionTotal, isPortioned } from '@/state/types'
import type { Diner, Item, RoundState } from '@/state/types'

// ---------- inlined helpers (ported verbatim from sim_rounding.test.ts) ----------

type Slice = { cost: number; parts: number[] }

function slices(state: RoundState): Slice[] {
  const idx = new Map(state.diners.map((d, i) => [d.id, i]))
  const resolve = (assigned: string[]): number[] =>
    assigned.length === 0
      ? state.diners.map((_, i) => i)
      : assigned.filter((id) => idx.has(id)).map((id) => idx.get(id)!)
  const out: Slice[] = []
  for (const it of state.items) {
    if (isPortioned(it)) {
      for (const p of it.portions!) {
        const parts = resolve(p.assignedDinerIds)
        if (parts.length) out.push({ cost: portionTotal(it.unitPrice, p.units), parts })
      }
    } else {
      const parts = resolve(it.assignedDinerIds)
      if (parts.length) out.push({ cost: lineTotal(it), parts })
    }
  }
  return out
}

function exactFood(state: RoundState, sl: Slice[]): number[] {
  const f = state.diners.map(() => 0)
  for (const s of sl) for (const i of s.parts) f[i] += s.cost / s.parts.length
  return f
}

// ---------- factories ----------

const diner = (id: string, c = 0): Diner => ({ id, name: id, colorIdx: c })
const base = (p: Partial<RoundState>): RoundState => ({
  venue: 'X',
  diners: [],
  items: [],
  discount: cents(0),
  servicePct: 0.1,
  gstPct: 0.09,
  rounding: cents(0),
  scan: null,
  scannedTotal: null,
  ...p,
})

// ---------- named receipts ----------

const bistro = base({
  diners: ['Shi Ling', 'Su yi', 'Suan sim', 'jit', 'Edwin', 'connie', 'sin yun', 'Shu fen'].map((n, i) => diner(n, i)),
  items: [
    {
      id: 'adobo',
      name: 'Adobo',
      qty: 3,
      unitPrice: cents(1590),
      assignedDinerIds: [],
      portions: [
        { units: 2, assignedDinerIds: ['Shi Ling', 'Edwin'] },
        { units: 1, assignedDinerIds: [] },
      ],
    },
    {
      id: 'snapper',
      name: 'Snapper',
      qty: 5,
      unitPrice: cents(1590),
      assignedDinerIds: ['Suan sim', 'jit', 'connie', 'sin yun', 'Shu fen'],
    },
    {
      id: 'chicken',
      name: 'Chicken',
      qty: 3,
      unitPrice: cents(1490),
      assignedDinerIds: [],
      portions: [
        { units: 2, assignedDinerIds: [] },
        { units: 1, assignedDinerIds: ['Su yi'] },
      ],
    },
  ],
})

// worst-case: 8 diners, 9 "everyone" items each costing ≡1 (mod 8) → leftover always lands on index 0
const worst = base({
  diners: Array.from({ length: 8 }, (_, i) => diner(`d${i}`, i)),
  items: Array.from({ length: 9 }, (_, j) => ({
    id: `i${j}`,
    name: `i${j}`,
    qty: 1,
    unitPrice: cents(1601),
    assignedDinerIds: [],
  })),
})

// worst-case 2: no tax, pure food, to isolate the food engine
const worstNoTax = base({ ...worst, servicePct: 0, gstPct: 0 })

// ---------- fairness metric ----------

function maxIdenticalSpread(state: RoundState): number {
  const sl = slices(state)
  const ef = exactFood(state, sl)
  const groups = new Map<number, number[]>()
  ef.forEach((v, i) => {
    const k = Math.round(v * 1e6)
    ;(groups.get(k) ?? groups.set(k, []).get(k)!).push(i)
  })
  const totals = splitBill(state).perDiner.map((d) => d.total)
  let spread = 0
  for (const m of groups.values())
    if (m.length > 1)
      spread = Math.max(
        spread,
        Math.max(...m.map((i) => totals[i]!)) - Math.min(...m.map((i) => totals[i]!)),
      )
  return spread
}

// ---------- fuzz corpus ----------

function* fuzzCorpus(count: number): Generator<RoundState> {
  let seed = 0x1234
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 2 ** 32)
  const ri = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))

  for (let t = 0; t < count; t++) {
    const n = ri(2, 8)
    const diners = Array.from({ length: n }, (_, i) => diner(`d${i}`, i))
    const items: Item[] = Array.from({ length: ri(1, 10) }, (_, j) => {
      const qty = ri(1, 5)
      // bias toward "everyone" so identical baskets actually occur
      const assigned =
        rand() < 0.6 ? [] : diners.filter(() => rand() < 0.5).map((d) => d.id)
      const it: Item = {
        id: `i${j}`,
        name: `i${j}`,
        qty,
        unitPrice: cents(ri(50, 6000)),
        assignedDinerIds: assigned.length ? assigned : [],
      }
      if (qty >= 2 && rand() < 0.25) {
        const cut = ri(1, qty - 1)
        it.portions = [
          {
            units: cut,
            assignedDinerIds: rand() < 0.6 ? [] : [diners[ri(0, n - 1)]!.id],
          },
          { units: qty - cut, assignedDinerIds: [] },
        ]
      }
      return it
    })
    yield base({
      diners,
      items,
      discount: cents(ri(0, 3000)),
      servicePct: rand() < 0.3 ? 0 : 0.1,
      gstPct: rand() < 0.3 ? 0 : 0.09,
    })
  }
}

// ---------- tests ----------

describe('splitBill fairness: identical baskets within 1¢', () => {
  it('named receipts ≤1¢', () => {
    expect(maxIdenticalSpread(bistro)).toBeLessThanOrEqual(1)
    expect(maxIdenticalSpread(worst)).toBeLessThanOrEqual(1)
    expect(maxIdenticalSpread(worstNoTax)).toBeLessThanOrEqual(1)
  })

  it('600 fuzz receipts: never exceeds 1¢ and always conserves', () => {
    for (const st of fuzzCorpus(600)) {
      expect(maxIdenticalSpread(st)).toBeLessThanOrEqual(1)
      const s = splitBill(st)
      expect(s.perDiner.reduce((a, d) => a + d.total, 0)).toBe(s.breakdown.grandTotal)
    }
  })
})
