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

it('treated/zero payer absorbs everyone\'s round-off (payer share is $0)', () => {
  // host is treated — item assigned only to a and b, so host.total === 0.
  const st = base({
    diners: [diner('host'), diner('a'), diner('b')],
    items: [{ id: 'x', name: 'x', qty: 1, unitPrice: cents(9989), assignedDinerIds: ['a', 'b'] }],
    servicePct: 0, gstPct: 0,
    payerId: 'host', collectRounding: cents(10),
  })
  const split = splitBill(st)
  const v = collectionView(st, split)
  const trueByDiner = Object.fromEntries(split.perDiner.map((d) => [d.dinerId, d.total]))
  expect(v.active).toBe(true)
  expect(trueByDiner['host']).toBe(0) // sanity: host truly owes $0
  expect(v.amountByDiner['host']).toBe(0) // payer keeps true share ($0)
  for (const id of ['a', 'b']) expect(v.amountByDiner[id]!).toBe(Math.floor(trueByDiner[id]! / 10) * 10)
  const absorbed = ['a', 'b'].reduce((s, id) => s + (trueByDiner[id]! - v.amountByDiner[id]!), 0)
  expect(v.absorbed).toBe(absorbed)
})

it('non-payer whose true total < collection unit collects 0', () => {
  // a owes only 7¢ (< 10¢ unit), so floor(7/10)*10 === 0; that 7¢ goes to absorbed.
  const st = base({
    diners: [diner('host'), diner('a')],
    items: [
      { id: 'small', name: 'small', qty: 1, unitPrice: cents(7), assignedDinerIds: ['a'] },
      { id: 'big',   name: 'big',   qty: 1, unitPrice: cents(500), assignedDinerIds: ['host'] },
    ],
    servicePct: 0, gstPct: 0,
    payerId: 'host', collectRounding: cents(10),
  })
  const split = splitBill(st)
  const v = collectionView(st, split)
  const trueByDiner = Object.fromEntries(split.perDiner.map((d) => [d.dinerId, d.total]))
  expect(trueByDiner['a']).toBe(7) // sanity: a's true share is exactly 7¢
  expect(v.active).toBe(true)
  expect(v.amountByDiner['a']).toBe(Math.floor(trueByDiner['a']! / 10) * 10) // === 0
  expect(v.amountByDiner['a']).toBe(0)
  const absorbed = trueByDiner['a']! - v.amountByDiner['a']!
  expect(v.absorbed).toBe(absorbed) // 7¢ absorbed by payer
})
