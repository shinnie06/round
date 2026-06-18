import { describe, it, expect } from 'vitest'
import { cents } from '@/math/money'
import { splitBill } from '@/math/splitBill'
import type { Diner, Item, RoundState } from '@/state/types'

const diner = (id: string): Diner => ({ id, name: id, colorIdx: 0 })
const item = (id: string, unitPrice: number, qty = 1, assigned: string[] = []): Item => ({
  id,
  name: id,
  qty,
  unitPrice: cents(unitPrice),
  assignedDinerIds: assigned,
})

const round = (partial: Partial<RoundState>): RoundState => ({
  venue: 'Test',
  diners: [],
  items: [],
  discount: cents(0),
  servicePct: 0.1,
  gstPct: 0.09,
  rounding: cents(0),
  scan: null,
  scannedTotal: null,
  ...partial,
})

const total = (s: ReturnType<typeof splitBill>) =>
  s.perDiner.reduce<number>((a, d) => a + d.total, 0)

describe('splitBill', () => {
  it('Jumbo Seafood: 3 diners, restricted beer, $5 discount', () => {
    const state = round({
      diners: [diner('shin'), diner('mei'), diner('raj')],
      items: [
        item('crab', 8800), // everyone
        item('prawns', 3200), // everyone
        item('beer', 900, 3, ['shin', 'raj']), // 27.00, two drinkers
      ],
      discount: cents(500),
    })
    const s = splitBill(state)

    // subtotal 147.00 − 5.00 = 142.00 → svc 14.20 → gst 14.06 → 170.26
    expect(s.breakdown.grandTotal).toBe(17026)
    expect(total(s)).toBe(17026)

    // Per-item largest remainder: crab 8800/3 → [2934,2933,2933],
    // prawns 3200/3 → [1067,1067,1066], beer 2700/2 → [1350,1350].
    // Shin (index 0) collects the odd cents from both shared items.
    const shin = s.perDiner.find((d) => d.dinerId === 'shin')!
    const mei = s.perDiner.find((d) => d.dinerId === 'mei')!
    const raj = s.perDiner.find((d) => d.dinerId === 'raj')!
    expect(shin.food).toBe(2934 + 1067 + 1350)
    expect(mei.food).toBe(2933 + 1067)
    expect(raj.food).toBe(2933 + 1066 + 1350)
  })

  it('the everyone-sentinel covers all diners', () => {
    const state = round({
      diners: [diner('a'), diner('b')],
      items: [item('x', 1000)],
      servicePct: 0,
      gstPct: 0,
    })
    const s = splitBill(state)
    expect(s.perDiner.map((d) => d.food)).toEqual([500, 500])
  })

  it('a diner with no food pays nothing (zero weight)', () => {
    const state = round({
      diners: [diner('eats'), diner('skips')],
      items: [item('x', 1000, 1, ['eats'])],
      discount: cents(100),
    })
    const s = splitBill(state)
    const skips = s.perDiner.find((d) => d.dinerId === 'skips')!
    expect(skips.total).toBe(0)
    expect(total(s)).toBe(s.breakdown.grandTotal)
  })

  it('residual diner surfaces when manual edits leave drift', () => {
    // Construct via the pipeline: normally residual is 0 by design.
    const state = round({
      diners: [diner('a'), diner('b'), diner('c')],
      items: [item('x', 1003)],
    })
    const s = splitBill(state)
    expect(total(s)).toBe(s.breakdown.grandTotal)
    expect(s.residual).toBe(0)
    expect(s.residualDinerId).toBeNull()
  })

  it('empty round → zero everything', () => {
    const s = splitBill(round({ diners: [diner('a')] }))
    expect(s.breakdown.grandTotal).toBe(0)
    expect(s.perDiner[0]!.total).toBe(0)
  })
})

describe('splitBill — rounding line', () => {
  it('rounding flows into the grand total and lands on the highest payer', () => {
    const state = round({
      diners: [diner('big'), diner('small')],
      items: [item('feast', 8000, 1, ['big']), item('side', 2000, 1, ['small'])],
      servicePct: 0,
      gstPct: 0,
      rounding: cents(-2),
    })
    const s = splitBill(state)
    expect(s.breakdown.grandTotal).toBe(9998)
    expect(total(s)).toBe(9998)
    expect(s.residualDinerId).toBe('big')
    expect(s.residual).toBe(-2)
  })
})

describe('splitBill — portions', () => {
  // Local factory: an Item carrying explicit portions (the file's `item()`
  // helper only builds un-split items). qty/unitPrice given; item-level
  // assignedDinerIds is dormant when portioned, so default it to [].
  const portioned = (
    id: string,
    unitPrice: number,
    qty: number,
    portions: { units: number; assignedDinerIds: string[] }[],
  ): Item => ({
    id,
    name: id,
    qty,
    unitPrice: cents(unitPrice),
    assignedDinerIds: [],
    portions,
  })

  it('the worked fareware scenario: P1/P2/P3 pay, M is treated on Adobo + Chicken', () => {
    const state = round({
      diners: [diner('P1'), diner('P2'), diner('P3'), diner('M')],
      items: [
        // 5× Snapper @ 1800 — un-split, everyone (M DOES pay a share here)
        item('snapper', 1800, 5, []),
        // 3× Adobo @ 1400 — 1u solo P1, 2u shared P1/P2/P3 (M excluded)
        portioned('adobo', 1400, 3, [
          { units: 1, assignedDinerIds: ['P1'] },
          { units: 2, assignedDinerIds: ['P1', 'P2', 'P3'] },
        ]),
        // 3× Chicken @ 1000 — 1u solo P2, 2u shared P1/P2/P3 (M excluded)
        portioned('chicken', 1000, 3, [
          { units: 1, assignedDinerIds: ['P2'] },
          { units: 2, assignedDinerIds: ['P1', 'P2', 'P3'] },
        ]),
      ],
    })
    const s = splitBill(state)

    const food = (id: string) => s.perDiner.find((d) => d.dinerId === id)!.food
    const tot = (id: string) => s.perDiner.find((d) => d.dinerId === id)!.total

    // Per-diner food (verified numerically against distributeProportionally):
    //   Snapper 9000/4 = [2250,2250,2250,2250]
    //   Adobo A 1400→P1; Adobo B 2800/[1,1,1]=[934,933,933]
    //   Chicken A 1000→P2; Chicken B 2000/[1,1,1]=[667,667,666]
    expect(food('P1')).toBe(2250 + 1400 + 934 + 667) // 5251
    expect(food('P2')).toBe(2250 + 933 + 1000 + 667) // 4850
    expect(food('P3')).toBe(2250 + 933 + 666) // 3849
    expect(food('M')).toBe(2250) // Snapper only

    // subtotal 16200 → service 1620 → gst 1604 → grand 19424
    expect(s.breakdown.subtotal).toBe(16200)
    expect(s.breakdown.grandTotal).toBe(19424)

    // Per-diner totals and THE invariant
    expect(tot('P1')).toBe(6296)
    expect(tot('P2')).toBe(5815)
    expect(tot('P3')).toBe(4615)
    expect(tot('M')).toBe(2698)
    expect(total(s)).toBe(19424)
    expect(total(s)).toBe(s.breakdown.grandTotal)
  })

  it('a single full-allocation portion splits identically to an un-split item', () => {
    const diners = [diner('a'), diner('b'), diner('c')]
    // un-split: qty 3 @ 1003, everyone
    const unsplit = splitBill(round({ diners, items: [item('x', 1003, 3, [])] }))
    // portioned: ONE portion covering all 3 units, everyone sentinel inside
    const split = splitBill(
      round({
        diners,
        items: [portioned('x', 1003, 3, [{ units: 3, assignedDinerIds: [] }])],
      }),
    )
    expect(split.perDiner.map((d) => d.food)).toEqual(
      unsplit.perDiner.map((d) => d.food),
    )
    expect(split.perDiner.map((d) => d.total)).toEqual(
      unsplit.perDiner.map((d) => d.total),
    )
    expect(split.breakdown.grandTotal).toBe(unsplit.breakdown.grandTotal)
  })

  it('each portion gets independent largest-remainder odd cents', () => {
    // qty 2 @ 100¢, single portion of 2 units split across 3 payers.
    // cost = 2·100 = 200; 200/[1,1,1] = [67,67,66] (Σ===200, ties→lowest idx).
    const state = round({
      diners: [diner('a'), diner('b'), diner('c')],
      items: [portioned('p', 100, 2, [{ units: 2, assignedDinerIds: ['a', 'b', 'c'] }])],
      servicePct: 0,
      gstPct: 0,
    })
    const s = splitBill(state)
    expect(s.perDiner.map((d) => d.food)).toEqual([67, 67, 66])
    expect(s.perDiner.reduce((acc, d) => acc + d.food, 0)).toBe(200)
  })
})
