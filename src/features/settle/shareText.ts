import type { BillSplit } from '@/math/splitBill'
import type { Cents } from '@/math/money'
import { cents } from '@/math/money'
import type { RoundState } from '@/state/types'
import { formatSGD } from '@/lib/format'
import { lineLabel } from './lineLabel'
import { collectionView } from './collectionRounding'

/**
 * The whole round as plain text — the at-a-glance answer that travels
 * next to the share link. Per diner: a header `{name} — {total}`, the
 * itemized food lines (labelled by the SAME lineLabel() the card uses,
 * so text and UI can't drift), then the non-zero charge rows. A diner
 * treated on everything (no lines, zero food) collapses to a single
 * `{name} — $0.00 (treated)` line. The footer's grand total is the
 * engine's, so the text reconciles to the cent.
 */
const LABEL_WIDTH = 40

const row = (label: string, amount: Cents): string =>
  `  ${label.padEnd(LABEL_WIDTH)}${formatSGD(amount)}`

export function buildShareText(round: RoundState, split: BillSplit): string {
  const view = collectionView(round, split)
  const blocks: string[] = []
  if (round.venue.trim() !== '') blocks.push(round.venue)

  for (const ds of split.perDiner) {
    const diner = round.diners.find((d) => d.id === ds.dinerId)
    const name = diner ? diner.name : ds.dinerId

    if (view.active) {
      blocks.push(`${name} — ${formatSGD(cents(view.amountByDiner[ds.dinerId]!))}`)
      continue
    }

    if (ds.lines.length === 0 && ds.food === 0) {
      blocks.push(`${name} — ${formatSGD(ds.total)} (treated)`)
      continue
    }

    const lines: string[] = [`${name} — ${formatSGD(ds.total)}`]
    for (const line of ds.lines) lines.push(row(lineLabel(line), line.food))
    if (ds.discount !== 0) lines.push(row('Discount share', ds.discount))
    if (ds.service !== 0) lines.push(row('Service charge', ds.service))
    if (ds.gst !== 0) lines.push(row('GST', ds.gst))
    blocks.push(lines.join('\n'))
  }

  blocks.push(`Everyone together — ${formatSGD(split.breakdown.grandTotal)}`)
  return blocks.join('\n\n')
}
