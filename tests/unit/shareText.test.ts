import { describe, it, expect } from 'vitest'
import { cents } from '@/math/money'
import { splitBill } from '@/math/splitBill'
import { buildShareText } from '@/features/settle/shareText'
import type { Diner, Item, RoundState } from '@/state/types'

const diner = (id: string, name: string): Diner => ({ id, name, colorIdx: 0 })

const round = (over: Partial<RoundState>): RoundState => ({
  venue: 'Fareware',
  diners: [],
  items: [],
  discount: cents(0),
  servicePct: 0.1,
  gstPct: 0.09,
  rounding: cents(0),
  scan: null,
  scannedTotal: null,
  payerId: null,
  collectRounding: cents(0),
  ...over,
})

const worked = round({
  diners: [diner('P1', 'P1'), diner('P2', 'P2'), diner('P3', 'P3'), diner('M', 'M')],
  items: [
    { id: 'snapper', name: 'Pan-Seared Snapper', qty: 5, unitPrice: cents(1800), assignedDinerIds: [] },
    {
      id: 'adobo',
      name: 'One36 Pork Adobo w/ Egg',
      qty: 3,
      unitPrice: cents(1400),
      assignedDinerIds: [],
      portions: [
        { units: 1, assignedDinerIds: ['P1'] },
        { units: 2, assignedDinerIds: ['P1', 'P2', 'P3'] },
      ],
    } as Item,
    {
      id: 'chicken',
      name: 'Grilled Chicken Chop',
      qty: 3,
      unitPrice: cents(1000),
      assignedDinerIds: [],
      portions: [
        { units: 1, assignedDinerIds: ['P2'] },
        { units: 2, assignedDinerIds: ['P1', 'P2', 'P3'] },
      ],
    } as Item,
  ],
})

describe('buildShareText', () => {
  it('renders a P1 header line with their total $62.95', () => {
    const split = splitBill(worked)
    const text = buildShareText(worked, split)
    expect(text).toContain('P1 — $62.95') // total[P1] = 6295
  })

  it('labels P1 portion lines with the exact lineLabel + aligned amount', () => {
    const text = buildShareText(worked, splitBill(worked))
    // 'One36 Pork Adobo w/ Egg · 1 of 3' is 32 chars → padEnd(40) = 8 trailing
    // spaces, then '$14.00'. (The leading 2-space indent is omitted from the
    // substring so it can match anywhere on the line.)
    expect(text).toContain('One36 Pork Adobo w/ Egg · 1 of 3        $14.00')
    // '… · shared 2 of 3' is 39 chars → padEnd(40) = 1 trailing space, then '$9.34'.
    expect(text).toContain('One36 Pork Adobo w/ Egg · shared 2 of 3 $9.34')
  })

  it('a fully-treated diner renders "Name — $0.00 (treated)" with no body', () => {
    const treated = round({
      diners: [diner('P1', 'P1'), diner('M', 'M')],
      items: [
        {
          id: 'adobo',
          name: 'Adobo',
          qty: 2,
          unitPrice: cents(1000),
          assignedDinerIds: [],
          portions: [{ units: 2, assignedDinerIds: ['P1'] }],
        } as Item,
      ],
      servicePct: 0,
      gstPct: 0,
    })
    const text = buildShareText(treated, splitBill(treated))
    expect(text).toContain('M — $0.00 (treated)')
    expect(text).not.toContain('M — $0.00\n') // no header-then-body form for M
  })

  it('footer grand total === split.breakdown.grandTotal ($194.24)', () => {
    const split = splitBill(worked)
    const text = buildShareText(worked, split)
    expect(split.breakdown.grandTotal).toBe(19424)
    expect(text).toContain('Everyone together — $194.24')
  })

  it('is deterministic (same input → identical output)', () => {
    expect(buildShareText(worked, splitBill(worked))).toBe(buildShareText(worked, splitBill(worked)))
  })

  it('collection rounding: headers show rounded amounts, no line/charge rows', () => {
    const st = round({
      diners: [diner('host', 'host'), diner('a', 'a')],
      items: [{ id: 'x', name: 'x', qty: 1, unitPrice: cents(2017), assignedDinerIds: [] }],
      servicePct: 0, gstPct: 0, payerId: 'host', collectRounding: cents(10),
    })
    const split = splitBill(st)
    const text = buildShareText(st, split)
    // 'a' owes ~1009¢ → collected 1000¢ → "$10.00"; no "Service charge"/line rows.
    expect(text).toContain('a — $10.00')
    expect(text).not.toContain('Service charge')
    // Per-item food rows are suppressed too: no indented line-item rows at all.
    // (The true grand total $20.17 still appears in the footer — that's intentional.)
    expect(text.split('\n').some((l) => l.startsWith('  '))).toBe(false)
    expect(text).toContain('Everyone together — $20.17')
  })

  it('share text footer matches the SettleSheet grand total for a portioned round', () => {
    const split = splitBill(worked)
    const text = buildShareText(worked, split)
    // SettleSheet renders <Money cents={split.breakdown.grandTotal}/> in its footer;
    // buildShareText must end on the same number, formatted.
    expect(text.trimEnd().endsWith(`Everyone together — $194.24`)).toBe(true)
    expect(split.breakdown.grandTotal).toBe(19424)
  })
})
