import { describe, it, expect } from 'vitest'
import { repair } from '@/features/ocr/repair'
import type { CleanReceipt } from '@/features/ocr/types'

const receipt = (over: Partial<CleanReceipt>): CleanReceipt => ({
  venue: 'Test',
  items: [],
  discount: null,
  service_charge: null,
  gst: null,
  rounding: null,
  grand_total: null,
  ...over,
})

describe('repair — borrowed-price recovery', () => {
  it('zeroes a single FOC line that borrowed the printed GST amount', () => {
    // Live failure 2026-06-12: Peach Tea picked up the "Incl GST 9% 0.86" value
    const r = repair(
      receipt({
        items: [
          { name: 'Chicken Cutlet NL w/ Drink', qty: 1, line_total: 10.4 },
          { name: '@Original Chicken Cutlet', qty: 1, line_total: 0 },
          { name: '1X Peach Tea', qty: 1, line_total: 0.86 },
        ],
        gst: 0.86,
        grand_total: 10.4,
      }),
    )
    expect(r.items).toEqual([{ name: 'Chicken Cutlet NL w/ Drink', qty: 1, line_total: 10.4 }])
  })

  it('zeroes BOTH FOC lines when both borrowed the GST amount', () => {
    const r = repair(
      receipt({
        items: [
          { name: 'Chicken Cutlet NL w/ Drink', qty: 1, line_total: 10.4 },
          { name: '@Original Chicken Cutlet', qty: 1, line_total: 0.86 },
          { name: '1X Peach Tea', qty: 1, line_total: 0.86 },
        ],
        gst: 0.86,
        grand_total: 10.4,
      }),
    )
    expect(r.items).toEqual([{ name: 'Chicken Cutlet NL w/ Drink', qty: 1, line_total: 10.4 }])
  })

  it('leaves a receipt alone when it already reconciles (legit item priced like the GST)', () => {
    // Kopi really costs 0.90 and gst is also 0.90: 10.00 + 0.90 = 10.90 items,
    // svc 0, gst 0.90 additive → 11.80 printed. Reconciles → no repair.
    const r = repair(
      receipt({
        items: [
          { name: 'Toast Set', qty: 1, line_total: 10.0 },
          { name: 'Kopi', qty: 1, line_total: 0.9 },
        ],
        service_charge: 0,
        gst: 0.9,
        grand_total: 11.8,
      }),
    )
    expect(r.items).toHaveLength(2)
    expect(r.items[1]).toEqual({ name: 'Kopi', qty: 1, line_total: 0.9 })
  })

  it('bails on ambiguity — two candidates where zeroing either one reconciles', () => {
    // Two 0.86 items, total only accounts for one of them being real.
    // Zeroing A or zeroing B both reconcile → cannot know which → no repair.
    const r = repair(
      receipt({
        items: [
          { name: 'Main', qty: 1, line_total: 10.4 },
          { name: 'Tea A', qty: 1, line_total: 0.86 },
          { name: 'Tea B', qty: 1, line_total: 0.86 },
        ],
        gst: 0.86,
        grand_total: 11.26,
      }),
    )
    expect(r.items).toHaveLength(3)
  })

  it('does nothing without a printed grand total to anchor on', () => {
    const r = repair(
      receipt({
        items: [
          { name: 'Main', qty: 1, line_total: 10.4 },
          { name: 'Tea', qty: 1, line_total: 0.86 },
        ],
        gst: 0.86,
      }),
    )
    expect(r.items).toHaveLength(2)
  })

  it('never zeroes an item that does not match a printed charge amount', () => {
    // Misread main price: nothing matches gst/svc → repair refuses to touch it
    const r = repair(
      receipt({
        items: [{ name: 'Main', qty: 1, line_total: 13.9 }],
        gst: 0.86,
        grand_total: 10.4,
      }),
    )
    expect(r.items[0]!.line_total).toBe(13.9)
  })
})

describe('repair — zero-line tidy-up', () => {
  it('drops FOC/$0.00 descriptor lines from items', () => {
    const r = repair(
      receipt({
        items: [
          { name: 'Chicken Cutlet NL w/ Drink', qty: 1, line_total: 10.4 },
          { name: '@Original Chicken Cutlet', qty: 1, line_total: 0 },
          { name: 'Peach Tea', qty: 1, line_total: 0 },
        ],
        gst: 0.86,
        grand_total: 10.4,
      }),
    )
    expect(r.items).toEqual([{ name: 'Chicken Cutlet NL w/ Drink', qty: 1, line_total: 10.4 }])
  })

  it('keeps small real charges like a takeaway surcharge', () => {
    // Ann Chin Popiah: 2.60 + 3.50 + 0.20 takeaway = 6.30, no charges
    const r = repair(
      receipt({
        items: [
          { name: 'Signature Popiah', qty: 1, line_total: 2.6 },
          { name: 'PEANUT 花生麻糍', qty: 1, line_total: 3.5 },
          { name: 'takeaway', qty: 1, line_total: 0.2 },
        ],
        grand_total: 6.3,
      }),
    )
    expect(r.items).toHaveLength(3)
  })
})
