import type { DinerSplit } from '@/math/splitBill'
import { lineLabel } from './lineLabel'

export interface CardRow {
  label: string
  amount: number
}

/**
 * The expanded settle card's rows for one diner. Replaces the old single
 * "Food & drink" row (DinerCard.tsx:29-34) with one row PER food line
 * (labelled via lineLabel, shared with the share text), then the non-zero
 * charge rows. A diner treated on everything — no lines AND zero food —
 * collapses to a single muted "Treated — pays nothing" row. Intended
 * common-path settle-view change (spec §0.1), not a regression.
 */
export function dinerCardRows(split: DinerSplit): CardRow[] {
  if (split.lines.length === 0 && split.food === 0) {
    return [{ label: 'Treated — pays nothing', amount: 0 }]
  }
  return [
    ...split.lines.map((l) => ({ label: lineLabel(l), amount: l.food })),
    ...(split.discount !== 0 ? [{ label: 'Discount share', amount: split.discount }] : []),
    ...(split.service !== 0 ? [{ label: 'Service charge', amount: split.service }] : []),
    ...(split.gst !== 0 ? [{ label: 'GST', amount: split.gst }] : []),
  ]
}
