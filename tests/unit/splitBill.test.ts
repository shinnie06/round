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
  it('rounding flows into the grand total and is distributed (no single-payer residual)', () => {
    const state = round({
      diners: [diner('big'), diner('small')],
      items: [item('feast', 8000, 1, ['big']), item('side', 2000, 1, ['small'])],
      servicePct: 0,
      gstPct: 0,
      rounding: cents(-2),
    })
    const s = splitBill(state)
    const big = s.perDiner.find((d) => d.dinerId === 'big')!
    const small = s.perDiner.find((d) => d.dinerId === 'small')!
    expect(s.breakdown.grandTotal).toBe(9998)
    expect(total(s)).toBe(9998)
    expect(big.total + small.total).toBe(9998) // rounding folded into totals, conserved
    expect(s.residual).toBe(0)
    expect(s.residualDinerId).toBeNull()
  })

  it('card reconciliation holds for every diner when a rounding line is folded in', () => {
    // Nonzero cash-rounding: its per-diner share lives inside the back-derived
    // service/gst/discount columns (no separate rounding row, per design §3.1).
    // The card contract food + discount + service + gst === total must still hold.
    const state = round({
      diners: [diner('a'), diner('b'), diner('c')],
      items: [item('shared', 1000, 1, [])], // everyone
      rounding: cents(-3),
    })
    const s = splitBill(state)
    for (const d of s.perDiner) {
      expect(d.food + d.discount + d.service + d.gst).toBe(d.total)
    }
    expect(total(s)).toBe(s.breakdown.grandTotal)
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

    // B2 totals (round-once over exact food; food columns unchanged):
    expect(tot('P1')).toBe(6295)
    expect(tot('P2')).toBe(5815)
    expect(tot('P3')).toBe(4616)
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

  it('an orphaned portion (all ids unknown) is excluded — subtotal recomputes lower', () => {
    // diners a, b. Item qty 2 @ 1000:
    //   portion 1 → ['ghost'] (unknown) → orphan, skipped, 1000¢ NOT billed
    //   portion 2 → ['a']             → a +1000
    // Plus an everyone item @ 500 so b still pays something.
    const state = round({
      diners: [diner('a'), diner('b')],
      items: [
        portioned('orphaned', 1000, 2, [
          { units: 1, assignedDinerIds: ['ghost'] },
          { units: 1, assignedDinerIds: ['a'] },
        ]),
        item('shared', 500, 1, []), // everyone → [250,250]
      ],
      servicePct: 0,
      gstPct: 0,
    })
    const s = splitBill(state)

    const a = s.perDiner.find((d) => d.dinerId === 'a')!
    const b = s.perDiner.find((d) => d.dinerId === 'b')!
    // a: orphan-portion 1000 + half of shared 250 = 1250; b: half of shared 250.
    expect(a.food).toBe(1250)
    expect(b.food).toBe(250)
    // subtotal = 1250 + 250 = 1500, NOT 2500 — the orphan's 1000¢ is excluded.
    expect(s.breakdown.subtotal).toBe(1500)
    expect(s.breakdown.grandTotal).toBe(1500)
    // Excluded, not residual-pinned:
    expect(s.residual).toBe(0)
    expect(s.residualDinerId).toBeNull()
    // The global invariant still holds against the (lower) grand total.
    expect(s.perDiner.reduce((acc, d) => acc + d.total, 0)).toBe(s.breakdown.grandTotal)
  })

  it('an empty-sentinel portion bills everyone (distinct from all-unknown skip)', () => {
    // qty 2 @ 1000, single portion with the [] everyone sentinel, 2 diners.
    // [] → everyone → 2000/[1,1] = [1000,1000]. (If [] were mistakenly filtered
    // it would skip and bill nothing — this asserts the sentinel branch.)
    const state = round({
      diners: [diner('a'), diner('b')],
      items: [portioned('p', 1000, 2, [{ units: 2, assignedDinerIds: [] }])],
      servicePct: 0,
      gstPct: 0,
    })
    const s = splitBill(state)
    expect(s.perDiner.map((d) => d.food)).toEqual([1000, 1000])
    expect(s.breakdown.subtotal).toBe(2000)
  })

  it('a fully-treated diner pays 0 across all portions (food/charges/total 0)', () => {
    // diners payer + treated. Single portioned line, every portion excludes treated.
    const state = round({
      diners: [diner('payer'), diner('treated')],
      items: [
        portioned('line', 1000, 2, [
          { units: 1, assignedDinerIds: ['payer'] },
          { units: 1, assignedDinerIds: ['payer'] },
        ]),
      ],
      discount: cents(100),
    })
    const s = splitBill(state)
    const treated = s.perDiner.find((d) => d.dinerId === 'treated')!
    expect(treated.food).toBe(0)
    expect(treated.discount).toBe(0)
    expect(treated.service).toBe(0)
    expect(treated.gst).toBe(0)
    expect(treated.total).toBe(0)
    expect(total(s)).toBe(s.breakdown.grandTotal)
  })

  it('a diner added after a split pays []-sentinel portions but zero of explicit portions', () => {
    // 4 diners; M is the "late add". Snapper is everyone-sentinel ([]); Adobo's
    // portions are explicit [P1,P2,P3] and a solo [P1] — M is absent from both.
    const state = round({
      diners: [diner('P1'), diner('P2'), diner('P3'), diner('M')],
      items: [
        item('snapper', 1800, 5, []), // [] everyone → M shares 9000/4 = 2250
        portioned('adobo', 1400, 3, [
          { units: 1, assignedDinerIds: ['P1'] },
          { units: 2, assignedDinerIds: ['P1', 'P2', 'P3'] },
        ]),
      ],
    })
    const s = splitBill(state)
    const m = s.perDiner.find((d) => d.dinerId === 'M')!
    // M gets a share of the [] Snapper portion ONLY; zero from explicit Adobo.
    expect(m.food).toBe(2250)
    expect(total(s)).toBe(s.breakdown.grandTotal)
  })

  it('single-diner round with portions sends all cents to the one diner', () => {
    const state = round({
      diners: [diner('solo')],
      items: [
        portioned('line', 333, 3, [
          { units: 1, assignedDinerIds: ['solo'] },
          { units: 2, assignedDinerIds: [] }, // [] → everyone == solo
        ]),
      ],
      servicePct: 0,
      gstPct: 0,
    })
    const s = splitBill(state)
    expect(s.perDiner[0]!.food).toBe(999) // 3·333
    expect(s.breakdown.subtotal).toBe(999)
    expect(total(s)).toBe(s.breakdown.grandTotal)
  })

  it('portions: [] and portions: undefined take the un-split branch (isPortioned false)', () => {
    const diners = [diner('a'), diner('b')]
    const baseline = splitBill(round({ diners, items: [item('x', 1000, 1, [])] }))
    // portions: [] — empty array, isPortioned false, falls back to assignedDinerIds.
    const emptyPortions: Item = {
      id: 'x',
      name: 'x',
      qty: 1,
      unitPrice: cents(1000),
      assignedDinerIds: [],
      portions: [],
    }
    const sEmpty = splitBill(round({ diners, items: [emptyPortions] }))
    expect(sEmpty.perDiner.map((d) => d.food)).toEqual(
      baseline.perDiner.map((d) => d.food),
    )
    // portions absent (undefined) is the plain item() factory — equals baseline.
    const sAbsent = splitBill(round({ diners, items: [item('x', 1000, 1, [])] }))
    expect(sAbsent.perDiner.map((d) => d.food)).toEqual(
      baseline.perDiner.map((d) => d.food),
    )
    expect(baseline.perDiner.map((d) => d.food)).toEqual([500, 500])
  })
})

describe('splitBill — fairness (B2)', () => {
  const portioned = (
    id: string, unitPrice: number, qty: number,
    portions: { units: number; assignedDinerIds: string[] }[],
  ): Item => ({ id, name: id, qty, unitPrice: cents(unitPrice), assignedDinerIds: [], portions })

  it('Bistro OneThirtySix: 7 identical diners land within 1¢', () => {
    const names = ['Shi Ling', 'Su yi', 'Suan sim', 'jit', 'Edwin', 'connie', 'sin yun', 'Shu fen']
    const state = round({
      diners: names.map((n) => diner(n)),
      items: [
        portioned('adobo', 1590, 3, [
          { units: 2, assignedDinerIds: ['Shi Ling', 'Edwin'] },
          { units: 1, assignedDinerIds: [] },
        ]),
        item('snapper', 1590, 5, ['Suan sim', 'jit', 'connie', 'sin yun', 'Shu fen']),
        portioned('chicken', 1490, 3, [
          { units: 2, assignedDinerIds: [] },
          { units: 1, assignedDinerIds: ['Su yi'] },
        ]),
      ],
    })
    const s = splitBill(state)
    const byName = Object.fromEntries(s.perDiner.map((d) => [d.dinerId, d.total]))
    // Seven diners owe an identical exact share (2161.25¢) → must be 2591 or 2592, never 2590/2593.
    const seven = names.filter((n) => n !== 'Su yi').map((n) => byName[n]!)
    expect(Math.max(...seven) - Math.min(...seven)).toBeLessThanOrEqual(1)
    expect(byName['Su yi']).toBe(2472)
    expect(s.breakdown.grandTotal).toBe(20611)
    expect(total(s)).toBe(20611)
    // Card reconciliation for one diner: lines + charges === total
    const sl = s.perDiner.find((d) => d.dinerId === 'Shi Ling')!
    const lineSum = sl.lines.reduce((a, l) => a + l.food, 0)
    expect(lineSum).toBe(sl.food)
    expect(sl.food + sl.discount + sl.service + sl.gst).toBe(sl.total)
  })
})

describe('splitBill — lines decomposition', () => {
  it('every DinerSplit carries a lines array', () => {
    const state = round({
      diners: [diner('a'), diner('b')],
      items: [item('x', 1000)],
      servicePct: 0,
      gstPct: 0,
    })
    const s = splitBill(state)
    for (const d of s.perDiner) {
      expect(Array.isArray(d.lines)).toBe(true)
    }
  })

  it('un-split item emits one line per participant, portion undefined, summing to food', () => {
    const state = round({
      diners: [diner('shin'), diner('mei'), diner('raj')],
      items: [item('crab', 8800)], // everyone, 8800/3 → [2934,2933,2933]
      servicePct: 0,
      gstPct: 0,
    })
    const s = splitBill(state)
    const shin = s.perDiner.find((d) => d.dinerId === 'shin')!
    expect(shin.lines).toHaveLength(1)
    expect(shin.lines[0]!.itemId).toBe('crab')
    expect(shin.lines[0]!.name).toBe('crab')
    expect(shin.lines[0]!.food).toBe(2934)
    expect(shin.lines[0]!.portion).toBeUndefined()
    for (const d of s.perDiner) {
      const sum = d.lines.reduce((a, l) => a + l.food, 0)
      expect(sum).toBe(d.food)
    }
  })

  it('portioned item emits a line per (portion, participant) carrying units/qty/shareOf', () => {
    const state = round({
      // 3× gyoza @ 1500: 1u solo to shin, 2u shared shin+mei (raj absent).
      // unitPrice·units: solo 1500→shin; shared 3000/2 → [1500,1500].
      diners: [diner('shin'), diner('mei'), diner('raj')],
      items: [
        {
          id: 'gyoza',
          name: 'Gyoza',
          qty: 3,
          unitPrice: cents(1500),
          assignedDinerIds: [],
          portions: [
            { units: 1, assignedDinerIds: ['shin'] }, // solo → shareOf 1
            { units: 2, assignedDinerIds: ['shin', 'mei'] }, // shared → shareOf 2
          ],
        },
      ],
      servicePct: 0,
      gstPct: 0,
    })
    const s = splitBill(state)

    // shin appears in BOTH portions → two lines for the same itemId.
    const shin = s.perDiner.find((d) => d.dinerId === 'shin')!
    const shinGyoza = shin.lines.filter((l) => l.itemId === 'gyoza')
    expect(shinGyoza).toHaveLength(2)
    const solo = shinGyoza.find((l) => l.portion!.shareOf === 1)!
    expect(solo.name).toBe('Gyoza')
    expect(solo.food).toBe(1500)
    expect(solo.portion).toEqual({ units: 1, qty: 3, shareOf: 1 })
    const shared = shinGyoza.find((l) => l.portion!.shareOf === 2)!
    expect(shared.name).toBe('Gyoza')
    expect(shared.food).toBe(1500)
    expect(shared.portion).toEqual({ units: 2, qty: 3, shareOf: 2 })

    // mei is only in the shared portion → exactly one line, shareOf 2.
    const mei = s.perDiner.find((d) => d.dinerId === 'mei')!
    const meiGyoza = mei.lines.filter((l) => l.itemId === 'gyoza')
    expect(meiGyoza).toHaveLength(1)
    expect(meiGyoza[0]!.itemId).toBe('gyoza')
    expect(meiGyoza[0]!.name).toBe('Gyoza')
    expect(meiGyoza[0]!.food).toBe(1500)
    expect(meiGyoza[0]!.portion).toEqual({ units: 2, qty: 3, shareOf: 2 })

    // raj is in no portion → NO line for gyoza, zero food.
    const raj = s.perDiner.find((d) => d.dinerId === 'raj')!
    expect(raj.lines.filter((l) => l.itemId === 'gyoza')).toHaveLength(0)
    expect(raj.food).toBe(0)

    // Strict decomposition still holds on the portioned path.
    for (const d of s.perDiner) {
      const sum = d.lines.reduce((a, l) => a + l.food, 0)
      expect(sum).toBe(d.food)
    }
  })

  it('portioned item: solo line shareOf 1, shared line shareOf 3, treated diner has no line', () => {
    const state = round({
      diners: [diner('P1'), diner('P2'), diner('P3'), diner('M')],
      items: [
        {
          id: 'adobo',
          name: 'Adobo',
          qty: 3,
          unitPrice: cents(1400),
          assignedDinerIds: [],
          portions: [
            { units: 1, assignedDinerIds: ['P1'] }, // solo
            { units: 2, assignedDinerIds: ['P1', 'P2', 'P3'] }, // except M; 2800/3 → [934,933,933]
          ],
        },
      ],
      servicePct: 0,
      gstPct: 0,
    })
    const s = splitBill(state)
    const p1 = s.perDiner.find((d) => d.dinerId === 'P1')!
    // P1 has a solo unit AND a share of the rest → TWO lines for the same itemId
    const p1Adobo = p1.lines.filter((l) => l.itemId === 'adobo')
    expect(p1Adobo).toHaveLength(2)
    const solo = p1Adobo.find((l) => l.portion!.shareOf === 1)!
    expect(solo.food).toBe(1400)
    expect(solo.portion).toEqual({ units: 1, qty: 3, shareOf: 1 })
    const shared = p1Adobo.find((l) => l.portion!.shareOf === 3)!
    expect(shared.food).toBe(934)
    expect(shared.portion).toEqual({ units: 2, qty: 3, shareOf: 3 })
    // M is in no portion → NO line for adobo at all
    const m = s.perDiner.find((d) => d.dinerId === 'M')!
    expect(m.lines.filter((l) => l.itemId === 'adobo')).toHaveLength(0)
    expect(m.food).toBe(0)
  })

  it('Σ over all diners lines.food === subtotal === Σ DinerSplit.food', () => {
    const state = round({
      diners: [diner('P1'), diner('P2'), diner('P3'), diner('M')],
      items: [
        { id: 'snapper', name: 'Snapper', qty: 5, unitPrice: cents(1800), assignedDinerIds: [] },
        {
          id: 'adobo',
          name: 'Adobo',
          qty: 3,
          unitPrice: cents(1400),
          assignedDinerIds: [],
          portions: [
            { units: 1, assignedDinerIds: ['P1'] },
            { units: 2, assignedDinerIds: ['P1', 'P2', 'P3'] },
          ],
        },
        {
          id: 'chicken',
          name: 'Chicken',
          qty: 3,
          unitPrice: cents(1000),
          assignedDinerIds: [],
          portions: [
            { units: 1, assignedDinerIds: ['P2'] },
            { units: 2, assignedDinerIds: ['P1', 'P2', 'P3'] },
          ],
        },
      ],
    })
    const s = splitBill(state)
    const sumFood = s.perDiner.reduce((a, d) => a + d.food, 0)
    const sumLines = s.perDiner.reduce((a, d) => a + d.lines.reduce((b, l) => b + l.food, 0), 0)
    expect(sumFood).toBe(16200) // worked-scenario subtotal
    expect(sumLines).toBe(sumFood)
    for (const d of s.perDiner) {
      expect(d.lines.reduce((b, l) => b + l.food, 0)).toBe(d.food)
    }
  })
})
