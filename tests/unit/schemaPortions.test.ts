import { describe, it, expect } from 'vitest'
import { parseRoundState } from '@/state/schema'

type AnyItem = Record<string, unknown>

const baseRound = (items: AnyItem[]): Record<string, unknown> => ({
  venue: 'X',
  diners: [],
  items,
  discount: 0,
  servicePct: 0.1,
  gstPct: 0.09,
  rounding: 0,
  scan: null,
  scannedTotal: null,
})

const item = (over: AnyItem = {}): AnyItem => ({
  id: 'i1',
  name: 'Adobo',
  qty: 3,
  unitPrice: 1400,
  assignedDinerIds: ['P1', 'P2'],
  ...over,
})

describe('roundStateZod — portions: optional field + units coercion', () => {
  it('parses a conserving portioned item and keeps its portions', () => {
    const parsed = parseRoundState(
      baseRound([
        item({
          portions: [
            { units: 1, assignedDinerIds: ['P1'] },
            { units: 2, assignedDinerIds: ['P1', 'P2', 'P3'] },
          ],
        }),
      ]),
    )
    expect(parsed).not.toBeNull()
    expect(parsed!.items[0]!.portions).toEqual([
      { units: 1, assignedDinerIds: ['P1'] },
      { units: 2, assignedDinerIds: ['P1', 'P2', 'P3'] },
    ])
  })

  it('downgrades a units:0 portion to un-split, retaining assignedDinerIds', () => {
    // catch(0) makes Σ units = 0 + 3 = 3, but item.qty here is 4 → non-conserving → downgrade.
    const parsed = parseRoundState(
      baseRound([
        item({
          qty: 4,
          assignedDinerIds: ['P1', 'P2'],
          portions: [
            { units: 0, assignedDinerIds: ['P1'] },
            { units: 3, assignedDinerIds: ['P2'] },
          ],
        }),
      ]),
    )
    expect(parsed).not.toBeNull()
    expect(parsed!.items[0]!.portions).toBeUndefined()
    expect('portions' in parsed!.items[0]!).toBe(false)
    expect(parsed!.items[0]!.assignedDinerIds).toEqual(['P1', 'P2'])
  })

  it('tolerates unknown assignee ids in a portion (no existence check)', () => {
    const parsed = parseRoundState(
      baseRound([
        item({
          qty: 3,
          portions: [{ units: 3, assignedDinerIds: ['ghost-id'] }],
        }),
      ]),
    )
    expect(parsed).not.toBeNull()
    expect(parsed!.items[0]!.portions![0]!.assignedDinerIds).toEqual(['ghost-id'])
  })
})

describe('roundStateZod — portions: .transform downgrade', () => {
  it('over-allocating (Σ units > qty) downgrades to un-split, retaining assignedDinerIds', () => {
    const parsed = parseRoundState(
      baseRound([
        item({
          qty: 3,
          assignedDinerIds: ['P1', 'P2'],
          portions: [
            { units: 2, assignedDinerIds: ['P1'] },
            { units: 2, assignedDinerIds: ['P2'] },
          ],
        }),
      ]),
    )
    expect(parsed).not.toBeNull()
    expect(parsed!.items[0]!.portions).toBeUndefined()
    expect('portions' in parsed!.items[0]!).toBe(false)
    expect(parsed!.items[0]!.assignedDinerIds).toEqual(['P1', 'P2'])
  })

  it('under-allocating (Σ units < qty) downgrades to un-split, retaining assignedDinerIds', () => {
    const parsed = parseRoundState(
      baseRound([
        item({
          qty: 3,
          assignedDinerIds: ['P3'],
          portions: [{ units: 1, assignedDinerIds: ['P1'] }],
        }),
      ]),
    )
    expect(parsed).not.toBeNull()
    expect(parsed!.items[0]!.portions).toBeUndefined()
    expect('portions' in parsed!.items[0]!).toBe(false)
    expect(parsed!.items[0]!.assignedDinerIds).toEqual(['P3'])
  })

  it('portions: [] is normalized to absent (no own-property), assignedDinerIds retained', () => {
    const parsed = parseRoundState(
      baseRound([item({ qty: 3, assignedDinerIds: ['P1'], portions: [] })]),
    )
    expect(parsed).not.toBeNull()
    expect(parsed!.items[0]!.portions).toBeUndefined()
    expect('portions' in parsed!.items[0]!).toBe(false)
    expect(parsed!.items[0]!.assignedDinerIds).toEqual(['P1'])
  })

  it('a conserving portioned item (Σ units === qty) survives the transform unchanged', () => {
    const parsed = parseRoundState(
      baseRound([
        item({
          qty: 3,
          portions: [
            { units: 1, assignedDinerIds: ['P1'] },
            { units: 2, assignedDinerIds: ['P1', 'P2', 'P3'] },
          ],
        }),
      ]),
    )
    expect(parsed).not.toBeNull()
    expect(parsed!.items[0]!.portions).toEqual([
      { units: 1, assignedDinerIds: ['P1'] },
      { units: 2, assignedDinerIds: ['P1', 'P2', 'P3'] },
    ])
  })

  it('an item with no portions key parses byte-identically (no portions own-property)', () => {
    const parsed = parseRoundState(
      baseRound([item({ qty: 3, assignedDinerIds: ['P1', 'P2'] })]),
    )
    expect(parsed).not.toBeNull()
    expect('portions' in parsed!.items[0]!).toBe(false)
    expect(parsed!.items[0]!.assignedDinerIds).toEqual(['P1', 'P2'])
  })
})
