import { describe, it, expect } from 'vitest'
import { sanitize } from '@/features/ocr/sanitize'
import type { RawReceipt } from '@/features/ocr/types'

const base = (over: Partial<RawReceipt>): RawReceipt => ({
  venue: 'Test',
  items: [],
  discount: null,
  service_charge: null,
  gst: null,
  rounding: null,
  grand_total: null,
  ...over,
})

describe('sanitize — strips fake summary rows from items', () => {
  it('moves a SVC row into service_charge when missing', () => {
    const r = sanitize(
      base({
        items: [
          { name: 'Laksa', qty: 1, line_total: 8.5 },
          { name: 'SVC 10%', qty: 1, line_total: 0.85 },
        ],
      }),
    )
    expect(r.items).toHaveLength(1)
    expect(r.service_charge).toBe(0.85)
  })

  it('moves a GST row into gst when missing', () => {
    const r = sanitize(
      base({ items: [{ name: 'GST 9%', qty: 1, line_total: 0.84 }] }),
    )
    expect(r.items).toHaveLength(0)
    expect(r.gst).toBe(0.84)
  })

  it('never overwrites a printed value', () => {
    const r = sanitize(
      base({
        gst: 1.23,
        items: [{ name: 'GST', qty: 1, line_total: 9.99 }],
      }),
    )
    expect(r.gst).toBe(1.23)
    expect(r.items).toHaveLength(0)
  })

  it('TOTAL row fills missing grand_total, otherwise dropped', () => {
    const r1 = sanitize(base({ items: [{ name: 'TOTAL', qty: 1, line_total: 137.89 }] }))
    expect(r1.grand_total).toBe(137.89)
    const r2 = sanitize(
      base({ grand_total: 100, items: [{ name: 'Total', qty: 1, line_total: 137.89 }] }),
    )
    expect(r2.grand_total).toBe(100)
    expect(r2.items).toHaveLength(0)
  })

  it('subtotal rows are dropped without reclassification', () => {
    const r = sanitize(base({ items: [{ name: 'Sub-Total', qty: 1, line_total: 50 }] }))
    expect(r.items).toHaveLength(0)
    expect(r.grand_total).toBeNull()
  })

  it('discount-ish rows fill discount', () => {
    const r = sanitize(base({ items: [{ name: 'Member Discount', qty: 1, line_total: 5 }] }))
    expect(r.discount).toBe(5)
    expect(r.items).toHaveLength(0)
  })

  it('legit items containing summary-ish words survive', () => {
    const items = [
      { name: 'Total Eclipse Mocktail', qty: 1, line_total: 12 },
      { name: 'Taxi Driver IPA', qty: 1, line_total: 15 },
      { name: 'Discount Sushi Platter', qty: 1, line_total: 22 },
    ]
    const r = sanitize(base({ items }))
    // Names where the keyword is part of a longer dish name keep their row…
    expect(r.items.map((i) => i.name)).toContain('Total Eclipse Mocktail')
    expect(r.items.map((i) => i.name)).toContain('Taxi Driver IPA')
  })

  it('drops empty-name zero rows, clamps qty, trims names', () => {
    const r = sanitize(
      base({
        items: [
          { name: '  ', qty: 1, line_total: 0 },
          { name: '  Kopi  ', qty: 0, line_total: 1.8 },
        ],
      }),
    )
    expect(r.items).toEqual([{ name: 'Kopi', qty: 1, line_total: 1.8 }])
  })
})

describe('sanitize — rounding rows', () => {
  it('moves a Rounding Adj row into rounding when missing', () => {
    const r = sanitize(
      base({
        items: [
          { name: 'Laksa', qty: 1, line_total: 8.5 },
          { name: 'Rounding Adj', qty: 1, line_total: 0.02 },
        ],
      }),
    )
    expect(r.items).toHaveLength(1)
    expect(r.rounding).toBe(0.02)
  })
  it('never overwrites a printed rounding value', () => {
    const r = sanitize(
      base({ rounding: -0.02, items: [{ name: 'ROUNDING', qty: 1, line_total: 0.05 }] }),
    )
    expect(r.rounding).toBe(-0.02)
    expect(r.items).toHaveLength(0)
  })
})
