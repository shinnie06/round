import { beforeEach, describe, it, expect } from 'vitest'
import { cents } from '@/math/money'
import { emptyRound, useStore } from '@/state/store'

const a = () => useStore.getState().actions
const round = () => useStore.getState().round

beforeEach(() => {
  a().reset()
})

const seed = () => {
  a().addDiner('Shin')
  a().addDiner('Mei')
  a().addDiner('Raj')
  a().addItem({ name: 'Beer', qty: 3, unitPrice: cents(900) })
}

describe('store — diners and items', () => {
  it('addDiner assigns distinct colors and trims names', () => {
    a().addDiner('  Shin ')
    a().addDiner('Mei')
    const [d1, d2] = round().diners
    expect(d1!.name).toBe('Shin')
    expect(d1!.colorIdx).not.toBe(d2!.colorIdx)
  })

  it('ignores empty names', () => {
    a().addDiner('   ')
    expect(round().diners).toHaveLength(0)
  })

  it('removeDiner strips explicit assignments', () => {
    seed()
    const [shin, mei] = round().diners
    const item = round().items[0]!
    a().toggleAssignment(item.id, mei!.id) // explicit: [shin, raj]
    a().removeDiner(shin!.id)
    expect(round().items[0]!.assignedDinerIds).toEqual([round().diners[1]!.id])
  })
})

describe('store — everyone-sentinel toggle matrix', () => {
  it('toggling OFF everyone materializes the explicit n−1 list', () => {
    seed()
    const item = round().items[0]!
    const mei = round().diners[1]!
    a().toggleAssignment(item.id, mei.id)
    const ids = round().diners.map((d) => d.id)
    expect(round().items[0]!.assignedDinerIds).toEqual([ids[0], ids[2]])
  })

  it('re-adding the last missing diner collapses back to []', () => {
    seed()
    const item = round().items[0]!
    const mei = round().diners[1]!
    a().toggleAssignment(item.id, mei.id)
    a().toggleAssignment(item.id, mei.id)
    expect(round().items[0]!.assignedDinerIds).toEqual([])
  })

  it('the last assigned diner cannot be toggled off', () => {
    seed()
    const item = round().items[0]!
    const [shin, mei, raj] = round().diners
    a().toggleAssignment(item.id, shin!.id)
    a().toggleAssignment(item.id, mei!.id)
    a().toggleAssignment(item.id, raj!.id) // would leave nobody — refused
    expect(round().items[0]!.assignedDinerIds).toEqual([raj!.id])
  })
})

describe('store — load, read-only, reset', () => {
  it('loadRound with readOnly flags the session', () => {
    a().loadRound(emptyRound(), { readOnly: true })
    expect(useStore.getState().readOnly).toBe(true)
  })

  it('enterManual clears readOnly and opens the workspace', () => {
    a().loadRound(emptyRound(), { readOnly: true })
    a().enterManual()
    expect(useStore.getState().readOnly).toBe(false)
    expect(useStore.getState().screen).toBe('workspace')
  })

  it('reset returns to a pristine splash', () => {
    seed()
    a().setScreen('settle')
    a().reset()
    expect(round()).toEqual(emptyRound())
    expect(useStore.getState().screen).toBe('splash')
  })

  it('discount clamps at zero, pcts clamp to [0,1]', () => {
    a().setDiscount(cents(-100))
    expect(round().discount).toBe(0)
    a().setServicePct(2)
    expect(round().servicePct).toBe(1)
    a().setGstPct(-1)
    expect(round().gstPct).toBe(0)
  })
})

describe('store — rounding', () => {
  it('setRounding stores signed cents and reset clears it', () => {
    a().setRounding(cents(-2))
    expect(round().rounding).toBe(-2)
    a().reset()
    expect(round().rounding).toBe(0)
  })
})

describe('store — one-tap assignment (assignOnly / assignEveryone)', () => {
  it('assignOnly assigns the item to exactly one diner in one action', () => {
    seed()
    const item = round().items[0]!
    const raj = round().diners[2]!
    a().assignOnly(item.id, raj.id)
    expect(round().items[0]!.assignedDinerIds).toEqual([raj.id])
  })
  it('assignEveryone restores the everyone sentinel', () => {
    seed()
    const item = round().items[0]!
    const raj = round().diners[2]!
    a().assignOnly(item.id, raj.id)
    a().assignEveryone(item.id)
    expect(round().items[0]!.assignedDinerIds).toEqual([])
  })
})

describe('store — portions', () => {
  it('splitItem seeds one full-allocation portion copying assignedDinerIds', () => {
    seed()
    const item = round().items[0]!
    a().assignOnly(item.id, round().diners[2]!.id) // explicit [raj]
    a().splitItem(item.id)
    const p = round().items[0]!.portions
    expect(p).toEqual([{ units: 3, assignedDinerIds: [round().diners[2]!.id] }])
  })

  it('splitItem keeps the everyone sentinel as [] on the seeded portion', () => {
    seed()
    const item = round().items[0]! // assignedDinerIds is [] by default
    a().splitItem(item.id)
    expect(round().items[0]!.portions).toEqual([{ units: 3, assignedDinerIds: [] }])
  })

  it('splitItem is a no-op for qty < 2', () => {
    seed()
    a().addItem({ name: 'Coffee', qty: 1, unitPrice: cents(500) })
    const coffee = round().items[1]!
    a().splitItem(coffee.id)
    expect(round().items[1]!.portions).toBeUndefined()
  })

  it('splitItem is idempotent — no-op if already portioned', () => {
    seed()
    const item = round().items[0]!
    a().splitItem(item.id)
    a().splitItem(item.id) // second call must not re-seed
    expect(round().items[0]!.portions).toEqual([{ units: 3, assignedDinerIds: [] }])
  })

  it('addPortion carves a 1-unit slice off the last portion with units >= 2', () => {
    seed()
    const item = round().items[0]! // qty 3
    a().splitItem(item.id) // [{units:3, []}]
    a().addPortion(item.id)
    expect(round().items[0]!.portions).toEqual([
      { units: 2, assignedDinerIds: [] },
      { units: 1, assignedDinerIds: [] },
    ])
  })

  it('addPortion is a no-op on an un-split item', () => {
    seed()
    const item = round().items[0]!
    a().addPortion(item.id)
    expect(round().items[0]!.portions).toBeUndefined()
  })

  it('addPortion is a no-op when fully fragmented (every portion 1 unit)', () => {
    seed()
    const item = round().items[0]! // qty 3
    a().splitItem(item.id)
    a().addPortion(item.id) // -> [2,1]
    a().addPortion(item.id) // -> [1,1,1]
    a().addPortion(item.id) // fully fragmented -> no-op
    expect(round().items[0]!.portions).toEqual([
      { units: 1, assignedDinerIds: [] },
      { units: 1, assignedDinerIds: [] },
      { units: 1, assignedDinerIds: [] },
    ])
  })

  it('setPortionUnits moves units to/from the right neighbour conserving qty', () => {
    seed()
    const item = round().items[0]! // qty 3
    a().splitItem(item.id)
    a().addPortion(item.id) // [{2,[]},{1,[]}]
    a().setPortionUnits(item.id, 0, 1) // 2->1, neighbour 1->2
    expect(round().items[0]!.portions).toEqual([
      { units: 1, assignedDinerIds: [] },
      { units: 2, assignedDinerIds: [] },
    ])
  })

  it('setPortionUnits clamps to [1, cur+nbr]', () => {
    seed()
    const item = round().items[0]! // qty 3
    a().splitItem(item.id)
    a().addPortion(item.id) // [{2,[]},{1,[]}]
    a().setPortionUnits(item.id, 0, 99) // clamp to cur+nbr = 3
    expect(round().items[0]!.portions).toEqual([
      { units: 3, assignedDinerIds: [] },
      { units: 0, assignedDinerIds: [] },
    ])
    a().setPortionUnits(item.id, 0, -5) // clamp to 1
    expect(round().items[0]!.portions![0]!.units).toBe(1)
  })

  it('setPortionUnits floors a fractional input before it reaches cents()', () => {
    seed()
    const item = round().items[0]! // qty 3
    a().splitItem(item.id)
    a().addPortion(item.id) // [{2,[]},{1,[]}]
    a().setPortionUnits(item.id, 1, 1.9) // floor(1.9)=1 === cur -> no-op
    expect(round().items[0]!.portions).toEqual([
      { units: 2, assignedDinerIds: [] },
      { units: 1, assignedDinerIds: [] },
    ])
  })

  it('setPortionUnits is a no-op on a single portion', () => {
    seed()
    const item = round().items[0]! // qty 3
    a().splitItem(item.id) // single portion {3,[]}
    a().setPortionUnits(item.id, 0, 1)
    expect(round().items[0]!.portions).toEqual([{ units: 3, assignedDinerIds: [] }])
  })

  it('setPortionUnits is a no-op for an out-of-range index or un-split item', () => {
    seed()
    const item = round().items[0]!
    a().setPortionUnits(item.id, 0, 1) // un-split -> no-op
    expect(round().items[0]!.portions).toBeUndefined()
    a().splitItem(item.id)
    a().addPortion(item.id) // [{2,[]},{1,[]}]
    a().setPortionUnits(item.id, 5, 1) // index out of range -> no-op
    expect(round().items[0]!.portions).toEqual([
      { units: 2, assignedDinerIds: [] },
      { units: 1, assignedDinerIds: [] },
    ])
  })

  it('removePortion folds units into the previous portion', () => {
    seed()
    const item = round().items[0]! // qty 3
    a().splitItem(item.id)
    a().addPortion(item.id) // [{2,[]},{1,[]}]
    a().removePortion(item.id, 1) // remove last, fold into prev
    expect(round().items[0]!.portions).toEqual([{ units: 3, assignedDinerIds: [] }])
  })

  it('removePortion of the first portion folds units into the NEXT', () => {
    seed()
    const item = round().items[0]! // qty 3
    a().splitItem(item.id)
    a().addPortion(item.id) // [{2,[]},{1,[]}]
    a().removePortion(item.id, 0) // remove first, fold into next (dest=1)
    expect(round().items[0]!.portions).toEqual([{ units: 3, assignedDinerIds: [] }])
  })

  it('removePortion of a lone portion is a no-op (use mergePortions to collapse)', () => {
    seed()
    const item = round().items[0]! // qty 3
    a().splitItem(item.id) // single portion {3,[]}
    a().removePortion(item.id, 0)
    expect(round().items[0]!.portions).toEqual([{ units: 3, assignedDinerIds: [] }])
  })

  it('removePortion is a no-op on an un-split item (length < 2 guard)', () => {
    seed()
    const item = round().items[0]!
    a().removePortion(item.id, 0)
    expect(round().items[0]!.portions).toBeUndefined()
  })
}) // end describe('store — portions')
