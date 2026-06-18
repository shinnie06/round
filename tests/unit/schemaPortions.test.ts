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

  it('coerces a units:0 portion to 0 rather than throwing (catch(0))', () => {
    const parsed = parseRoundState(
      baseRound([
        item({
          portions: [
            { units: 0, assignedDinerIds: ['P1'] },
            { units: 3, assignedDinerIds: ['P2'] },
          ],
        }),
      ]),
    )
    // No downgrade transform yet, so portions survive but units is coerced to 0.
    expect(parsed).not.toBeNull()
    expect(parsed!.items[0]!.portions![0]!.units).toBe(0)
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
