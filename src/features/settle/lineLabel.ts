import type { FoodLine } from '@/math/splitBill'

/**
 * The human label for one food line, shared verbatim by the settle card
 * and the share text so the two can never drift.
 *   no portion      → "{name}"
 *   shareOf === 1    → "{name} · {units} of {qty}"        (a solo unit)
 *   shareOf  >  1    → "{name} · shared {units} of {qty}" (a split slice)
 */
export function lineLabel(line: FoodLine): string {
  if (!line.portion) return line.name
  const { units, qty, shareOf } = line.portion
  const how = shareOf === 1 ? `${units} of ${qty}` : `shared ${units} of ${qty}`
  return `${line.name} · ${how}`
}
