import { describe, it, expect } from 'vitest'
import { cents } from '@/math/money'
import { applyCharges } from '@/math/singapore'

describe('applyCharges — IRAS order: discount → service → GST', () => {
  it('canonical SG receipt: $147.00, 10% svc, 9% GST', () => {
    const b = applyCharges(cents(14700), { discount: cents(0), servicePct: 0.1, gstPct: 0.09 })
    expect(b.subtotal).toBe(14700)
    expect(b.service).toBe(1470) // 147.00 × 10%
    expect(b.gst).toBe(1455) // 161.70 × 9% = 14.553 → 14.55
    expect(b.grandTotal).toBe(17625)
  })

  it('discount applies before service and GST', () => {
    const b = applyCharges(cents(14700), { discount: cents(500), servicePct: 0.1, gstPct: 0.09 })
    expect(b.discount).toBe(500)
    expect(b.service).toBe(1420) // 142.00 × 10%
    expect(b.gst).toBe(1406) // 156.20 × 9% = 14.058 → 14.06
    expect(b.grandTotal).toBe(17026)
  })

  it('clamps discount to subtotal', () => {
    const b = applyCharges(cents(1000), { discount: cents(5000), servicePct: 0.1, gstPct: 0.09 })
    expect(b.discount).toBe(1000)
    expect(b.service).toBe(0)
    expect(b.gst).toBe(0)
    expect(b.grandTotal).toBe(0)
  })

  it('clamps negative discount to zero', () => {
    const b = applyCharges(cents(1000), { discount: cents(-300), servicePct: 0.1, gstPct: 0.09 })
    expect(b.discount).toBe(0)
    expect(b.grandTotal).toBe(1199) // 10.00 + 1.00 svc + 0.99 gst
  })

  it('zero percentages → grand total = subtotal − discount', () => {
    const b = applyCharges(cents(2345), { discount: cents(345), servicePct: 0, gstPct: 0 })
    expect(b.service).toBe(0)
    expect(b.gst).toBe(0)
    expect(b.grandTotal).toBe(2000)
  })

  it('each charge rounds to the cent independently (matches printed rows)', () => {
    // subtotal $10.05: svc = 1.005 → 1.01 (half-up); gst on 11.06 → 0.9954 → 1.00
    const b = applyCharges(cents(1005), { discount: cents(0), servicePct: 0.1, gstPct: 0.09 })
    expect(b.service).toBe(101)
    expect(b.gst).toBe(100)
    expect(b.grandTotal).toBe(1206)
  })
})

describe('applyCharges — rounding line (SG cash rounding)', () => {
  it('applies signed rounding after GST', () => {
    // $10.05 → svc $1.01 → gst $1.00 → $12.06; round down to $12.05
    const b = applyCharges(cents(1005), {
      discount: cents(0), servicePct: 0.1, gstPct: 0.09, rounding: cents(-1),
    })
    expect(b.rounding).toBe(-1)
    expect(b.grandTotal).toBe(1205)
  })
  it('positive rounding adds', () => {
    const b = applyCharges(cents(1000), {
      discount: cents(0), servicePct: 0, gstPct: 0, rounding: cents(3),
    })
    expect(b.grandTotal).toBe(1003)
  })
  it('omitted rounding defaults to zero', () => {
    const b = applyCharges(cents(1000), { discount: cents(0), servicePct: 0, gstPct: 0 })
    expect(b.rounding).toBe(0)
    expect(b.grandTotal).toBe(1000)
  })
})
