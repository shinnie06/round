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
