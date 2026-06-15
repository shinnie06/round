import { describe, it, expect } from 'vitest'
import { reconcile } from '@/features/ocr/reconcile'
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

describe('reconcile — Tier-2 arithmetic verification', () => {
  it('green when the math is exact (printed components)', () => {
    // 147.00 + 14.70 svc + 14.55 gst = 176.25
    const v = reconcile(
      receipt({
        items: [{ name: 'Crab', qty: 1, line_total: 147.0 }],
        service_charge: 14.7,
        gst: 14.55,
        grand_total: 176.25,
      }),
    )
    expect(v.status).toBe('green')
    expect(v.deltaCents).toBe(0)
  })

  it('computes default 10%/9% for missing components', () => {
    const v = reconcile(
      receipt({
        items: [{ name: 'Crab', qty: 1, line_total: 147.0 }],
        grand_total: 176.25,
      }),
    )
    expect(v.status).toBe('green')
  })

  it('amber on small drift (≤25¢)', () => {
    const v = reconcile(
      receipt({
        items: [{ name: 'Crab', qty: 1, line_total: 147.0 }],
        service_charge: 14.7,
        gst: 14.55,
        grand_total: 176.4, // 15¢ off
      }),
    )
    expect(v.status).toBe('amber')
    expect(v.deltaCents).toBe(15)
  })

  it('amber on ≤0.5% drift even when above 25¢', () => {
    // expected 1000.00, printed 1003.00 → 300¢ but 0.3%
    const v = reconcile(
      receipt({
        items: [{ name: 'Banquet', qty: 1, line_total: 1000.0 }],
        service_charge: 0,
        gst: 0,
        grand_total: 1003.0,
      }),
    )
    expect(v.status).toBe('amber')
  })

  it('red on a real misread', () => {
    const v = reconcile(
      receipt({
        items: [{ name: 'Crab', qty: 1, line_total: 147.0 }],
        service_charge: 14.7,
        gst: 14.55,
        grand_total: 173.25, // $3 off — misread digit
      }),
    )
    expect(v.status).toBe('red')
    expect(v.deltaCents).toBe(300)
  })

  it('amber when there is no printed grand total to verify against', () => {
    const v = reconcile(receipt({ items: [{ name: 'Kopi', qty: 1, line_total: 1.8 }] }))
    expect(v.status).toBe('amber')
  })

  it('printed discount participates in the recomputation', () => {
    // 100 − 10 = 90, svc 9.00, gst 8.91 → 107.91
    const v = reconcile(
      receipt({
        items: [{ name: 'Set', qty: 1, line_total: 100.0 }],
        discount: 10.0,
        service_charge: 9.0,
        gst: 8.91,
        grand_total: 107.91,
      }),
    )
    expect(v.status).toBe('green')
  })
})

describe('reconcile — interpretation search', () => {
  it('hawker receipt: no charge rows, total equals items → green at 0/0', () => {
    // Ann Chin Popiah: 2.60 + 3.50 + 0.20 = 6.30, no svc, no GST
    const v = reconcile(
      receipt({
        items: [
          { name: 'Signature Popiah', qty: 1, line_total: 2.6 },
          { name: 'PEANUT 花生麻糍', qty: 1, line_total: 3.5 },
          { name: 'takeaway', qty: 1, line_total: 0.2 },
        ],
        grand_total: 6.3,
      }),
    )
    expect(v.status).toBe('green')
    expect(v.resolved).toEqual({ service: 0, gst: 0 })
  })

  it('GST-unregistered café: printed service charge, no GST row → green', () => {
    // 100.00 + 10.00 svc, no GST anywhere: total 110.00
    const v = reconcile(
      receipt({
        items: [{ name: 'High Tea', qty: 1, line_total: 100.0 }],
        service_charge: 10.0,
        grand_total: 110.0,
      }),
    )
    expect(v.status).toBe('green')
    expect(v.resolved).toEqual({ service: 1000, gst: 0 })
  })

  it('standard additive receipt resolves to the printed charges, not zeros', () => {
    const v = reconcile(
      receipt({
        items: [{ name: 'Crab', qty: 1, line_total: 147.0 }],
        service_charge: 14.7,
        gst: 14.55,
        grand_total: 176.25,
      }),
    )
    expect(v.resolved).toEqual({ service: 1470, gst: 1455 })
  })

  it('a misread charge digit snaps to the canonical rate when that is exact', () => {
    // Watami @ q95: model read service_charge 5.93 (real: 5.99). 5.93/59.85
    // is within half a point of 10%, and exactly 10% (5.99) reconciles to
    // the printed 71.75 — so the snapped reading is proven, green.
    const v = reconcile(
      receipt({
        items: [{ name: 'Sets', qty: 1, line_total: 66.5 }],
        discount: 6.65,
        service_charge: 5.93,
        gst: 5.93,
        rounding: -0.02,
        grand_total: 71.75,
      }),
    )
    expect(v.status).toBe('green')
    expect(v.resolved).toEqual({ service: 599, gst: 593 })
  })

  it('no resolved charges on amber/red — nothing was proven', () => {
    const v = reconcile(
      receipt({
        items: [{ name: 'Crab', qty: 1, line_total: 147.0 }],
        service_charge: 14.7,
        gst: 14.55,
        grand_total: 173.25,
      }),
    )
    expect(v.status).toBe('red')
    expect(v.resolved).toBeUndefined()
  })
})

describe('reconcile — GST-inclusive receipts', () => {
  it('green when the printed total is already items − discount (Incl GST is informational)', () => {
    // Changi quick-service receipt: "Incl GST 9% 0.86" is inside the 10.40,
    // FOC set-meal components are 0. Nothing is additive.
    const v = reconcile(
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
    expect(v.status).toBe('green')
    expect(v.deltaCents).toBe(0)
  })

  it('inclusive match respects discount and rounding', () => {
    // 20.00 − 2.00 − 0.03 rounding = 17.97 printed → inclusive, green
    const v = reconcile(
      receipt({
        items: [{ name: 'Set', qty: 1, line_total: 20.0 }],
        discount: 2.0,
        gst: 1.48,
        rounding: -0.03,
        grand_total: 17.97,
      }),
    )
    expect(v.status).toBe('green')
  })
})

describe('reconcile — rounding line', () => {
  it('printed rounding participates in the recomputation', () => {
    // 10.05 + 1.01 svc + 1.00 gst − 0.01 rounding = 12.05
    const v = reconcile(
      receipt({
        items: [{ name: 'Kaya Toast Set', qty: 1, line_total: 10.05 }],
        service_charge: 1.01,
        gst: 1.0,
        rounding: -0.01,
        grand_total: 12.05,
      }),
    )
    expect(v.status).toBe('green')
  })
})
