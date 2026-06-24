import { describe, it, expect } from 'vitest'
import { parseRoundState } from '@/state/schema'
import { cents } from '@/math/money'
import { splitBill } from '@/math/splitBill'
import type { RoundState } from '@/state/types'

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

describe('roundStateZod — §11 old reader strips portions (graceful degrade)', () => {
  it('dropping portions bills everyone incl. treated M; per-diner totals still sum to grandTotal', () => {
    // A NEW portioned round: M was deliberately excluded from the wine via portions.
    const portionedRound: RoundState = {
      venue: 'Cellar',
      diners: [
        { id: 'H', name: 'Host', colorIdx: 0 },
        { id: 'M', name: 'Treated', colorIdx: 1 },
        { id: 'G', name: 'Guest', colorIdx: 2 },
      ],
      items: [
        // shared by everyone (the [] sentinel) — unaffected by the strip
        { id: 'food', name: 'Set Dinner', qty: 3, unitPrice: cents(3000), assignedDinerIds: [] },
        // 2 bottles, portioned so M pays for NONE of it (both portions exclude M)
        {
          id: 'wine',
          name: 'Wine',
          qty: 2,
          unitPrice: cents(6000),
          assignedDinerIds: [], // item-level "everyone" — the fallback the old reader uses
          portions: [
            { units: 1, assignedDinerIds: ['H'] },
            { units: 1, assignedDinerIds: ['H', 'G'] },
          ],
        },
      ],
      discount: cents(0),
      servicePct: 0.1,
      gstPct: 0.09,
      rounding: cents(0),
      scan: null,
      scannedTotal: null,
      payerId: null,
      collectRounding: cents(0),
    }

    // Simulate the OLD app's z.object reader, which strips the unknown `portions` key.
    const asOldReaderSees = structuredClone(portionedRound)
    for (const it of asOldReaderSees.items) {
      delete (it as { portions?: unknown }).portions
    }
    // Sanity: the strip really happened — no item carries portions anymore.
    expect(asOldReaderSees.items.every((it) => !('portions' in it))).toBe(true)

    const s = splitBill(asOldReaderSees)

    // (a) Money is never lost: per-diner totals sum exactly to the grand total.
    const sumOfTotals = s.perDiner.reduce<number>((a, d) => a + d.total, 0)
    expect(sumOfTotals).toBe(s.breakdown.grandTotal)

    // (b) M was folded back into the wine via the [] sentinel and OVERPAYS:
    //     he is now billed a non-zero share instead of the $0 the portions intended.
    const m = s.perDiner.find((d) => d.dinerId === 'M')!
    expect(m.food).toBeGreaterThan(0)
    expect(m.total).toBeGreaterThan(0)
  })
})
