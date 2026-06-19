import { describe, it, expect } from 'vitest'
import { cents } from '@/math/money'
import { encodeShareHash, decodeShareHash } from '@/state/urlhash'
import type { RoundState } from '@/state/types'

const sample: RoundState = {
  venue: 'Jumbo Seafood',
  diners: [
    { id: 'd1', name: 'Shin', colorIdx: 0 },
    { id: 'd2', name: 'Mei Lin', colorIdx: 1 },
    { id: 'd3', name: 'Raj', colorIdx: 2 },
  ],
  items: [
    { id: 'i1', name: 'Chilli Crab', qty: 1, unitPrice: cents(8800), assignedDinerIds: [] },
    { id: 'i2', name: 'Cereal Prawns', qty: 1, unitPrice: cents(3200), assignedDinerIds: [] },
    { id: 'i3', name: 'Tiger Beer', qty: 3, unitPrice: cents(900), assignedDinerIds: ['d1', 'd3'] },
    { id: 'i4', name: 'Kopi Peng', qty: 2, unitPrice: cents(180), assignedDinerIds: ['d2'] },
    { id: 'i5', name: 'Satay (10 stick)', qty: 1, unitPrice: cents(1200), assignedDinerIds: [] },
    { id: 'i6', name: 'Mee Goreng', qty: 1, unitPrice: cents(850), assignedDinerIds: [] },
  ],
  discount: cents(500),
  servicePct: 0.1,
  gstPct: 0.09,
  rounding: cents(0),
  scan: { status: 'green', deltaCents: cents(0) },
  scannedTotal: cents(16768),
}

describe('share hash codec', () => {
  it('round-trips a full round', () => {
    const hash = encodeShareHash(sample)
    expect(hash.startsWith('r=')).toBe(true)
    expect(decodeShareHash(hash)).toEqual(sample)
  })

  it('accepts a leading #', () => {
    expect(decodeShareHash('#' + encodeShareHash(sample))).toEqual(sample)
  })

  it('returns null on garbage, never throws', () => {
    expect(decodeShareHash('r=!!!notlz!!!')).toBeNull()
    expect(decodeShareHash('#r=')).toBeNull()
    expect(decodeShareHash('')).toBeNull()
    expect(decodeShareHash('#other=thing')).toBeNull()
  })

  it('rejects valid lz-string that fails schema validation', () => {
    const hash = encodeShareHash({ ...sample, servicePct: 99 as never })
    expect(decodeShareHash(hash)).toBeNull()
  })

  it('keeps a 3-diner 6-item round comfortably under 2000 chars', () => {
    expect(encodeShareHash(sample).length).toBeLessThan(2000)
  })
})

describe('share hash — legacy payloads without rounding', () => {
  it('decodes a pre-rounding round with rounding defaulted to 0', async () => {
    const { compressToEncodedURIComponent } = await import('lz-string')
    const legacy = JSON.parse(JSON.stringify(sample)) as Record<string, unknown>
    delete legacy.rounding
    const hash = 'r=' + compressToEncodedURIComponent(JSON.stringify({ v: 1, s: legacy }))
    const decoded = decodeShareHash(hash)
    expect(decoded).not.toBeNull()
    expect(decoded!.rounding).toBe(0)
  })
})

describe('share hash — portions', () => {
  const portioned: RoundState = {
    ...sample,
    items: [
      ...sample.items,
      {
        id: 'p1',
        name: 'One36 Pork Adobo w/ Egg',
        qty: 3,
        unitPrice: cents(1400),
        assignedDinerIds: [],
        portions: [
          { units: 1, assignedDinerIds: ['d1'] },
          { units: 2, assignedDinerIds: ['d1', 'd2', 'd3'] },
        ],
      },
    ],
  }

  it('round-trips a portioned round byte-for-byte', () => {
    const hash = encodeShareHash(portioned)
    expect(decodeShareHash(hash)).toEqual(portioned)
  })

  it('a v1 link without portions still decodes un-split (no portions key)', () => {
    const decoded = decodeShareHash(encodeShareHash(sample))!
    expect(decoded.items.every((i) => !('portions' in i))).toBe(true)
  })

  it('a v1 link with a non-conserving portion decodes downgraded, never null', async () => {
    const { compressToEncodedURIComponent } = await import('lz-string')
    const bad = JSON.parse(JSON.stringify(portioned)) as RoundState
    // Force Σ units (1+2=3) ≠ qty by bumping qty to 4 → schema downgrades to un-split.
    ;(bad.items[bad.items.length - 1] as { qty: number }).qty = 4
    const hash = 'r=' + compressToEncodedURIComponent(JSON.stringify({ v: 1, s: bad }))
    const decoded = decodeShareHash(hash)
    expect(decoded).not.toBeNull()
    expect('portions' in decoded!.items[decoded!.items.length - 1]!).toBe(false)
  })

  it('stays under 2000 chars with a portioned item', () => {
    expect(encodeShareHash(portioned).length).toBeLessThan(2000)
  })
})
