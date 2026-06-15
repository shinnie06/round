import type { CleanReceipt, RawLine, RawReceipt } from './types'

/**
 * sanitize — defends against the LLM's favorite hallucination: copying
 * the receipt's summary rows (SVC / GST / TOTAL / discount) into `items`
 * even though the prompt forbids it. Misclassified rows would double-count
 * charges, so we strip them and reclassify their amounts.
 *
 * Classification is deliberately conservative: a row is a summary row only
 * if NOTHING but filler (digits, %, punctuation) follows the keyword —
 * "GST 9%" dies, "Total Eclipse Mocktail" lives.
 *
 * Reclassified amounts only fill fields that are null: a value the model
 * read off a dedicated printed row always wins over one it misfiled.
 */
const TAIL = String.raw`[\s\d%.:$()\-]*`
const PRE = String.raw`^[\w\s%]*?`
const SUBTOTAL_RE = new RegExp(`${PRE}\\bsub[- ]?total\\b${TAIL}$`, 'i')
const TOTAL_RE = new RegExp(`${PRE}\\b(total|amount due|balance(?: due)?)\\b${TAIL}$`, 'i')
const SERVICE_RE = new RegExp(`${PRE}(\\bsvc\\b|s/c|\\bserv(?:ice)?(?: charge| chg)?\\b)${TAIL}$`, 'i')
const GST_RE = new RegExp(`${PRE}\\b(gst|tax)\\b${TAIL}$`, 'i')
const DISCOUNT_RE = new RegExp(`${PRE}\\b(discount|less|promo(?:tion)?|voucher|off)\\b${TAIL}$`, 'i')
const ROUNDING_RE = new RegExp(`${PRE}\\bround(?:ing)?(?: adj(?:ustment)?)?\\b${TAIL}$`, 'i')

type Kind = 'subtotal' | 'total' | 'service' | 'gst' | 'discount' | 'rounding' | 'item'

function classify(name: string): Kind {
  if (SUBTOTAL_RE.test(name)) return 'subtotal'
  if (SERVICE_RE.test(name)) return 'service'
  if (GST_RE.test(name)) return 'gst'
  if (ROUNDING_RE.test(name)) return 'rounding'
  if (TOTAL_RE.test(name)) return 'total'
  if (DISCOUNT_RE.test(name)) return 'discount'
  return 'item'
}

export function sanitize(raw: RawReceipt): CleanReceipt {
  const items: RawLine[] = []
  let { discount, service_charge, gst, rounding, grand_total } = raw

  for (const row of raw.items) {
    const name = row.name.trim()
    if (name === '' && row.line_total === 0) continue

    switch (classify(name)) {
      case 'service':
        service_charge ??= row.line_total
        break
      case 'gst':
        gst ??= row.line_total
        break
      case 'total':
        grand_total ??= row.line_total
        break
      case 'discount':
        discount ??= row.line_total
        break
      case 'rounding':
        rounding ??= row.line_total
        break
      case 'subtotal':
        break // recomputable from items — drop without reclassifying
      case 'item':
        items.push({ name, qty: Math.max(1, row.qty), line_total: row.line_total })
    }
  }

  return { venue: raw.venue, items, discount, service_charge, gst, rounding, grand_total }
}
