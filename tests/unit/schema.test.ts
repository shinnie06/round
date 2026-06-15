import { describe, it, expect } from 'vitest'
import { rawReceiptZod, RECEIPT_JSON_SCHEMA } from '@/features/ocr/schema'

const typical = {
  venue: 'Jumbo Seafood',
  items: [
    { name: 'Chilli Crab', qty: 1, line_total: 88.0 },
    { name: 'Tiger Beer', qty: 3, line_total: 27.0 },
  ],
  discount: null,
  service_charge: 11.5,
  gst: 11.39,
  grand_total: 137.89,
}

describe('rawReceiptZod', () => {
  it('accepts a typical payload', () => {
    const r = rawReceiptZod.parse(typical)
    expect(r.items).toHaveLength(2)
    expect(r.venue).toBe('Jumbo Seafood')
  })

  it('null qty defaults to 1', () => {
    const r = rawReceiptZod.parse({
      ...typical,
      items: [{ name: 'Kopi', qty: null, line_total: 1.8 }],
    })
    expect(r.items[0]!.qty).toBe(1)
  })

  it('normalizes a negative discount — receipts print "10% Member -5.00"', () => {
    const r = rawReceiptZod.parse({ ...typical, discount: -5.0 })
    expect(r.discount).toBe(5.0)
  })

  it('keeps a positive discount as-is and null as null', () => {
    expect(rawReceiptZod.parse({ ...typical, discount: 6.65 }).discount).toBe(6.65)
    expect(rawReceiptZod.parse({ ...typical, discount: null }).discount).toBeNull()
  })

  it('rejects negative line totals', () => {
    expect(() =>
      rawReceiptZod.parse({ ...typical, items: [{ name: 'x', qty: 1, line_total: -5 }] }),
    ).toThrow()
  })

  it('rejects missing fields', () => {
    expect(() => rawReceiptZod.parse({ venue: null, items: [] })).toThrow()
  })
})

describe('roundStateZod — scannedTotal compatibility', () => {
  it('old drafts and share links without scannedTotal stay valid', async () => {
    const { parseRoundState } = await import('@/state/schema')
    const legacy = {
      venue: 'X',
      diners: [],
      items: [],
      discount: 0,
      servicePct: 0.1,
      gstPct: 0.09,
      rounding: 0,
      scan: null,
    }
    const parsed = parseRoundState(legacy)
    expect(parsed).not.toBeNull()
    expect(parsed!.scannedTotal).toBeNull()
  })
})

describe('RECEIPT_JSON_SCHEMA', () => {
  it('is strict and requires every top-level field', () => {
    expect(RECEIPT_JSON_SCHEMA.strict).toBe(true)
    expect(RECEIPT_JSON_SCHEMA.schema.additionalProperties).toBe(false)
    expect(RECEIPT_JSON_SCHEMA.schema.required).toEqual([
      'venue',
      'items',
      'discount',
      'service_charge',
      'gst',
      'rounding',
      'grand_total',
    ])
  })
})
