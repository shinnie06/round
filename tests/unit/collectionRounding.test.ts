import { it, expect } from 'vitest'
import { cents } from '@/math/money'
import { splitBill } from '@/math/splitBill'
import { collectionView } from '@/features/settle/collectionRounding'
import type { Diner, RoundState } from '@/state/types'

const diner = (id: string): Diner => ({ id, name: id, colorIdx: 0 })
const base = (o: Partial<RoundState>): RoundState => ({
  venue: 'V', diners: [], items: [], discount: cents(0), servicePct: 0.1, gstPct: 0.09,
  rounding: cents(0), scan: null, scannedTotal: null, payerId: null, collectRounding: cents(0), ...o,
})

it('inactive when off or payer unset', () => {
  const st = base({ diners: [diner('a'), diner('b')], items: [{ id: 'x', name: 'x', qty: 1, unitPrice: cents(1000), assignedDinerIds: [] }] })
  expect(collectionView(st, splitBill(st)).active).toBe(false)
})

it('inert when unit <= 0 but payer is set', () => {
  const st = base({ diners: [diner('host'), diner('a')], items: [{ id: 'x', name: 'x', qty: 1, unitPrice: cents(1000), assignedDinerIds: [] }], payerId: 'host', collectRounding: cents(0) })
  expect(collectionView(st, splitBill(st)).active).toBe(false)
})

it('inert when payer id is set but not in the split (stale payer)', () => {
  const st = base({ diners: [diner('a'), diner('b')], items: [{ id: 'x', name: 'x', qty: 1, unitPrice: cents(1000), assignedDinerIds: [] }], payerId: 'ghost', collectRounding: cents(10) })
  const v = collectionView(st, splitBill(st))
  expect(v.active).toBe(false)
  expect(v.absorbed).toBe(0)
})

it('rounds non-payers down to the unit; payer keeps true share; absorbed = Σ deltas', () => {
  const st = base({
    diners: [diner('host'), diner('a'), diner('b')],
    items: [{ id: 'x', name: 'x', qty: 1, unitPrice: cents(9989), assignedDinerIds: [] }],
    servicePct: 0, gstPct: 0,
    payerId: 'host', collectRounding: cents(10),
  })
  const split = splitBill(st)
  const v = collectionView(st, split)
  const trueByDiner = Object.fromEntries(split.perDiner.map((d) => [d.dinerId, d.total]))
  expect(v.active).toBe(true)
  for (const id of ['a', 'b']) expect(v.amountByDiner[id]! % 10).toBe(0) // rounded to 10¢
  for (const id of ['a', 'b']) expect(v.amountByDiner[id]!).toBe(Math.floor(trueByDiner[id]! / 10) * 10)
  expect(v.amountByDiner['host']).toBe(trueByDiner['host']) // payer = true share
  const absorbed = ['a', 'b'].reduce((s, id) => s + (trueByDiner[id]! - v.amountByDiner[id]!), 0)
  expect(v.absorbed).toBe(absorbed)
})
