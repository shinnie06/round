import { describe, it, expect } from 'vitest'
import { rawReceiptZod } from '@/features/ocr/schema'
import { sanitize } from '@/features/ocr/sanitize'
import { repair } from '@/features/ocr/repair'
import { reconcile } from '@/features/ocr/reconcile'
import { mapToState } from '@/features/ocr/mapToState'
import { applyCharges } from '@/math/singapore'
import { lineTotal, type RoundState } from '@/state/types'
import { cents } from '@/math/money'

/**
 * Real-world regression fixtures: verbatim qwen3-vl-8b outputs (temp 0,
 * constrained decoding, production prompt) for photographed receipts —
 * including the encode-dependent misreads observed on 2026-06-12. The whole
 * pipeline must land on the printed grand total.
 */
function run(rawJson: unknown): { state: RoundState; verdict: ReturnType<typeof reconcile> } {
  const clean = repair(sanitize(rawReceiptZod.parse(rawJson)))
  const verdict = reconcile(clean)
  return { state: mapToState(clean, verdict), verdict }
}

const stateTotal = (s: RoundState) =>
  applyCharges(cents(s.items.reduce((a, it) => a + it.qty * it.unitPrice, 0)), {
    discount: s.discount,
    servicePct: s.servicePct,
    gstPct: s.gstPct,
    rounding: s.rounding,
  }).grandTotal

describe('pipeline — Heavenly Wang $10.40 (GST-inclusive, FOC set-meal lines)', () => {
  const base = {
    venue: 'Heavenly Wang @ CHANGI AIRPORT T2',
    discount: null,
    service_charge: null,
    gst: 0.86,
    rounding: null,
    grand_total: 10.4,
  }
  const variants: [string, number, number][] = [
    // [model output variant seen at..., FOC line 1, FOC line 2]
    ['q85: model zeroes both FOC lines', 0, 0],
    ['q95/live: one FOC line borrows the GST value', 0, 0.86],
    ['original bug: both FOC lines borrow the GST value', 0.86, 0.86],
  ]

  it.each(variants)('%s → single $10.40 item, no charges, green', (_label, foc1, foc2) => {
    const { state, verdict } = run({
      ...base,
      items: [
        { name: 'Chicken Cutlet NL w/ Drink', qty: 1, line_total: 10.4 },
        { name: '@Original Chicken Cutlet', qty: 1, line_total: foc1 },
        { name: '1X Peach Tea', qty: 1, line_total: foc2 },
      ],
    })
    expect(verdict.status).toBe('green')
    // descriptor lines are gone — only the billable set remains
    expect(state.items.map((i) => i.name)).toEqual(['Chicken Cutlet NL w/ Drink'])
    expect(state.items.map(lineTotal)).toEqual([1040])
    expect(state.servicePct).toBe(0)
    expect(state.gstPct).toBe(0)
    expect(stateTotal(state)).toBe(1040)
  })
})

describe('pipeline — Watami $71.75 (discount + additive charges + rounding)', () => {
  it('reconciles green and lands on the printed total, descriptors dropped', () => {
    const { state, verdict } = run({
      venue: 'WATAMI Japanese Casual Restaurant',
      items: [
        { name: 'Chicken Katsu Curry Rice Set', qty: 1, line_total: 12.9 },
        { name: 'Hot Coffee (Now)', qty: null, line_total: 0 },
        { name: 'Chicken Cutlet w/Egg Set', qty: 1, line_total: 11.9 },
        { name: 'Yuzu Soda', qty: null, line_total: 0 },
        { name: 'Tokachi Pork Rice Set', qty: 1, line_total: 13.9 },
        { name: 'Hot Kikuimo Tea', qty: null, line_total: 0 },
        { name: 'Beef Rice Bowl with Onsen Egg Set', qty: 1, line_total: 13.9 },
        { name: 'Hot Yuzu Tea', qty: null, line_total: 0 },
        { name: 'Watami Beef Stone Pot Bibimbap', qty: 1, line_total: 13.9 },
        { name: 'Ice Oolong Tea', qty: null, line_total: 0 },
      ],
      discount: 6.65,
      service_charge: 5.99,
      gst: 5.93,
      rounding: -0.02,
      grand_total: 71.75,
    })
    expect(verdict.status).toBe('green')
    expect(state.items).toHaveLength(5)
    expect(state.servicePct).toBe(0.1)
    expect(state.gstPct).toBe(0.09)
    expect(state.rounding).toBe(-2)
    expect(stateTotal(state)).toBe(7175)
  })
})

describe('pipeline — Ann Chin Popiah $6.30 (hawker: no charges at all)', () => {
  it('keeps the takeaway surcharge, zero charges, green', () => {
    const { state, verdict } = run({
      venue: 'Ann Chin Popiah TP Hub',
      items: [
        { name: 'Signature Popiah', qty: 1, line_total: 2.6 },
        { name: 'PEANUT 花生麻糍', qty: 1, line_total: 3.5 },
        { name: 'takeaway', qty: 1, line_total: 0.2 },
      ],
      discount: null,
      service_charge: null,
      gst: null,
      rounding: null,
      grand_total: 6.3,
    })
    expect(verdict.status).toBe('green')
    expect(state.items).toHaveLength(3)
    expect(state.servicePct).toBe(0)
    expect(state.gstPct).toBe(0)
    expect(stateTotal(state)).toBe(630)
  })
})

describe('pipeline — failure honesty', () => {
  it('a genuine misread the repair cannot anchor stays red with items untouched', () => {
    const { state, verdict } = run({
      venue: 'X',
      items: [{ name: 'Main', qty: 1, line_total: 13.9 }],
      discount: null,
      service_charge: null,
      gst: 0.86,
      rounding: null,
      grand_total: 10.4,
    })
    expect(verdict.status).toBe('red')
    expect(state.items.map(lineTotal)).toEqual([1390])
  })
})
