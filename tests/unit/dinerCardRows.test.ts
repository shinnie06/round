import { describe, it, expect } from 'vitest'
import { cents } from '@/math/money'
import { splitBill } from '@/math/splitBill'
import { dinerCardRows } from '@/features/settle/dinerCardRows'
import type { Diner, Item, RoundState } from '@/state/types'

const diner = (id: string): Diner => ({ id, name: id, colorIdx: 0 })
const round = (over: Partial<RoundState>): RoundState => ({
  venue: 'T',
  diners: [],
  items: [],
  discount: cents(0),
  servicePct: 0.1,
  gstPct: 0.09,
  rounding: cents(0),
  scan: null,
  scannedTotal: null,
  ...over,
})

describe('dinerCardRows', () => {
  it('un-split round: one row per item (not a single "Food & drink" row)', () => {
    const state = round({
      diners: [diner('a'), diner('b')],
      items: [
        { id: 'crab', name: 'Crab', qty: 1, unitPrice: cents(1000), assignedDinerIds: [] },
        { id: 'rice', name: 'Rice', qty: 1, unitPrice: cents(400), assignedDinerIds: [] },
      ],
      servicePct: 0,
      gstPct: 0,
    })
    const a = splitBill(state).perDiner.find((d) => d.dinerId === 'a')!
    const rows = dinerCardRows(a)
    const labels = rows.map((r) => r.label)
    expect(labels).toContain('Crab')
    expect(labels).toContain('Rice')
    expect(labels).not.toContain('Food & drink')
  })

  it('portioned payer: rows carry the lineLabel copy', () => {
    const state = round({
      diners: [diner('P1'), diner('P2'), diner('P3')],
      items: [
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
        } as Item,
      ],
      servicePct: 0,
      gstPct: 0,
    })
    const p1 = splitBill(state).perDiner.find((d) => d.dinerId === 'P1')!
    const labels = dinerCardRows(p1).map((r) => r.label)
    expect(labels).toContain('Adobo · 1 of 3')
    expect(labels).toContain('Adobo · shared 2 of 3')
  })

  it('fully-treated diner: a single "Treated — pays nothing" row', () => {
    const state = round({
      diners: [diner('P1'), diner('M')],
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
    const m = splitBill(state).perDiner.find((d) => d.dinerId === 'M')!
    const rows = dinerCardRows(m)
    expect(rows).toEqual([{ label: 'Treated — pays nothing', amount: 0 }])
  })

  it('keeps non-zero discount/service/GST rows after the food rows', () => {
    const state = round({
      diners: [diner('a')],
      items: [{ id: 'x', name: 'X', qty: 1, unitPrice: cents(1000), assignedDinerIds: [] }],
      discount: cents(100),
    })
    const a = splitBill(state).perDiner.find((d) => d.dinerId === 'a')!
    const labels = dinerCardRows(a).map((r) => r.label)
    expect(labels).toContain('X')
    expect(labels).toContain('Discount share')
    expect(labels).toContain('Service charge')
    expect(labels).toContain('GST')
  })
})
