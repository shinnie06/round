import { describe, it, expect } from 'vitest'
import { mapToState } from '@/features/ocr/mapToState'
import { reconcile } from '@/features/ocr/reconcile'
import { lineTotal } from '@/state/types'
import { cents } from '@/math/money'
import type { CleanReceipt, Verdict } from '@/features/ocr/types'

const green: Verdict = { status: 'green', deltaCents: cents(0) }

const receipt = (over: Partial<CleanReceipt>): CleanReceipt => ({
  venue: 'Jumbo Seafood',
  items: [],
  discount: null,
  service_charge: null,
  gst: null,
  rounding: null,
  grand_total: null,
  ...over,
})

describe('mapToState', () => {
  it('converts dollars to cents and preserves line totals exactly', () => {
    const s = mapToState(
      receipt({
        items: [
          { name: 'Chilli Crab', qty: 1, line_total: 88.0 },
          { name: 'Tiger Beer', qty: 3, line_total: 27.0 },
        ],
      }),
      green,
    )
    expect(s.items.map(lineTotal)).toEqual([8800, 2700])
    expect(s.items[1]!.qty).toBe(3)
    expect(s.items[1]!.unitPrice).toBe(900)
  })

  it('collapses to qty 1 when the line total does not divide evenly', () => {
    // 3 × $3.33⅓: printed money beats unit-price fidelity
    const s = mapToState(
      receipt({ items: [{ name: 'Odd', qty: 3, line_total: 10.0 }] }),
      green,
    )
    expect(lineTotal(s.items[0]!)).toBe(1000)
    expect(s.items[0]!.qty).toBe(1)
  })

  it('snaps printed service/GST to canonical percentages', () => {
    const s = mapToState(
      receipt({
        items: [{ name: 'Set', qty: 1, line_total: 147.0 }],
        service_charge: 14.7,
        gst: 14.55,
      }),
      green,
    )
    expect(s.servicePct).toBe(0.1)
    expect(s.gstPct).toBe(0.09)
  })

  it('defaults pcts when nothing printed', () => {
    const s = mapToState(receipt({ items: [{ name: 'Kopi', qty: 1, line_total: 1.8 }] }), green)
    expect(s.servicePct).toBe(0.1)
    expect(s.gstPct).toBe(0.09)
  })

  it('zero service printed → 0%', () => {
    // hawker receipt: no service charge row is null, but explicit 0 is 0
    const s = mapToState(
      receipt({ items: [{ name: 'Satay', qty: 1, line_total: 12.0 }], service_charge: 0, gst: 0 }),
      green,
    )
    expect(s.servicePct).toBe(0)
    expect(s.gstPct).toBe(0)
  })

  it('carries venue, discount, verdict; diners start empty', () => {
    const v: Verdict = { status: 'amber', deltaCents: cents(15) }
    const s = mapToState(receipt({ discount: 5.0, venue: 'Lau Pa Sat' }), v)
    expect(s.venue).toBe('Lau Pa Sat')
    expect(s.discount).toBe(500)
    expect(s.scan).toEqual(v)
    expect(s.diners).toEqual([])
  })
})

describe('mapToState — resolved charges from the verdict', () => {
  it('zeroes service and GST when reconcile proved the charges are informational', () => {
    // "Incl GST 9% 0.86" inside a 10.40 total: nothing is additive, so the
    // misfiled gst amount and the 10% service default must both stay off.
    const clean = receipt({
      items: [
        { name: 'Chicken Cutlet NL w/ Drink', qty: 1, line_total: 10.4 },
        { name: '@Original Chicken Cutlet', qty: 1, line_total: 0 },
        { name: 'Peach Tea', qty: 1, line_total: 0 },
      ],
      gst: 0.86,
      grand_total: 10.4,
    })
    const s = mapToState(clean, reconcile(clean))
    expect(s.servicePct).toBe(0)
    expect(s.gstPct).toBe(0)
    expect(s.items.map(lineTotal)).toEqual([1040, 0, 0])
  })

  it('keeps additive charges when the printed total includes them', () => {
    // Watami: 66.50 − 6.65 + 5.99 svc + 5.93 gst − 0.02 = 71.75 → additive
    const clean = receipt({
      items: [{ name: 'Sets', qty: 1, line_total: 66.5 }],
      discount: 6.65,
      service_charge: 5.99,
      gst: 5.93,
      rounding: -0.02,
      grand_total: 71.75,
    })
    const s = mapToState(clean, reconcile(clean))
    expect(s.servicePct).toBe(0.1)
    expect(s.gstPct).toBe(0.09)
  })

  it('falls back to printed/default behavior when nothing was resolved (amber/red)', () => {
    // no grand total → amber, no resolved → SG defaults apply as before
    const clean = receipt({ items: [{ name: 'Kopi', qty: 1, line_total: 1.8 }] })
    const s = mapToState(clean, reconcile(clean))
    expect(s.servicePct).toBe(0.1)
    expect(s.gstPct).toBe(0.09)
  })

  it('persists only status and delta into state.scan — resolved stays OCR-side', () => {
    const clean = receipt({
      items: [{ name: 'Popiah', qty: 1, line_total: 6.3 }],
      grand_total: 6.3,
    })
    const s = mapToState(clean, reconcile(clean))
    expect(s.scan).toEqual({ status: 'green', deltaCents: 0 })
  })
})

describe('mapToState — printed money beats a tidy rate', () => {
  it('keeps the printed GST cent when the snapped 9% re-rounds differently', () => {
    // Hong Heng: 66.50 + 1% svc 0.67 + GST 6.04 − 0.01 = 73.20 printed.
    // A snapped 9% recomputes 6.05 — one cent off the printed row. The
    // resolved amounts must survive into state so the total stays 73.20.
    const clean = receipt({
      items: [
        { name: 'Fish Meat Bee Hoon Soup', qty: 7, line_total: 49.0 },
        { name: 'Dry Hor Fun', qty: 1, line_total: 17.5 },
      ],
      service_charge: 0.67,
      gst: 6.04,
      rounding: -0.01,
      grand_total: 73.2,
    })
    const verdict = reconcile(clean)
    expect(verdict.status).toBe('green')
    const s = mapToState(clean, verdict)
    const svc = Math.round(6650 * s.servicePct + Number.EPSILON * 1e4)
    const gst = Math.round((6650 + svc) * s.gstPct + Number.EPSILON * 1e4)
    expect(svc).toBe(67)
    expect(gst).toBe(604)
    expect(6650 + svc + gst - 1).toBe(7320)
  })

  it('still snaps to canonical 10%/9% when the snap is cent-exact', () => {
    const clean = receipt({
      items: [{ name: 'Crab', qty: 1, line_total: 147.0 }],
      service_charge: 14.7,
      gst: 14.55,
      grand_total: 176.25,
    })
    const s = mapToState(clean, reconcile(clean))
    expect(s.servicePct).toBe(0.1)
    expect(s.gstPct).toBe(0.09)
  })
})

describe('mapToState — scanned total anchor', () => {
  it('stores the printed grand total for the live banner check', () => {
    const clean = receipt({
      items: [{ name: 'Popiah', qty: 1, line_total: 6.3 }],
      grand_total: 6.3,
    })
    const s = mapToState(clean, reconcile(clean))
    expect(s.scannedTotal).toBe(630)
  })

  it('null when the receipt printed no total', () => {
    const clean = receipt({ items: [{ name: 'Kopi', qty: 1, line_total: 1.8 }] })
    const s = mapToState(clean, reconcile(clean))
    expect(s.scannedTotal).toBeNull()
  })
})

describe('mapToState — rounding + GST default regression', () => {
  it('carries printed rounding into state as signed cents', () => {
    const s = mapToState(
      receipt({ items: [{ name: 'Laksa', qty: 1, line_total: 8.5 }], rounding: -0.02 }),
      green,
    )
    expect(s.rounding).toBe(-2)
  })
  it('GST default is 9 percent — never 8', () => {
    const s = mapToState(receipt({ items: [{ name: 'Kopi', qty: 1, line_total: 1.8 }] }), green)
    expect(s.gstPct).toBe(0.09)
    expect(Math.round(s.gstPct * 100)).toBe(9)
  })
})

describe('mapToState — portions', () => {
  it('never emits a portions key — portions undefined and not an own-property', () => {
    const s = mapToState(
      receipt({
        items: [
          { name: 'Pan-Seared Snapper', qty: 5, line_total: 90.0 },
          { name: 'One36 Pork Adobo w/ Egg', qty: 3, line_total: 42.0 },
        ],
      }),
      green,
    )
    for (const item of s.items) {
      expect(item.portions).toBeUndefined()
      expect('portions' in item).toBe(false)
    }
  })
})
