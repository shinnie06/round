import type { BillSplit } from '@/math/splitBill'
import type { RoundState } from '@/state/types'
import { buildShareText } from './shareText'

/** The full clipboard/native-share payload: the at-a-glance receipt, then
 *  a blank line, then the round-trippable link. */
export function shareMessage(round: RoundState, split: BillSplit, url: string): string {
  return `${buildShareText(round, split)}\n\n${url}`
}
