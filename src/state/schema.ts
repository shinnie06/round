import { z } from 'zod'
import type { RoundState } from './types'

/**
 * Runtime validation for everything that crosses a trust boundary INTO
 * the store: share-link hashes (someone else's URL!) and IndexedDB
 * drafts (possibly written by an older app version). Cents are plain
 * ints on the wire; the brand is reapplied by virtue of passing here.
 */
const centsZod = z.number().int()
const pctZod = z.number().min(0).max(1)

export const dinerZod = z.object({
  id: z.string().min(1),
  name: z.string(),
  colorIdx: z.number().int().min(0),
})

export const itemZod = z.object({
  id: z.string().min(1),
  name: z.string(),
  qty: z.number().int().min(1),
  unitPrice: centsZod,
  assignedDinerIds: z.array(z.string()),
})

export const roundStateZod = z.object({
  venue: z.string(),
  diners: z.array(dinerZod),
  items: z.array(itemZod),
  discount: centsZod,
  servicePct: pctZod,
  gstPct: pctZod,
  /** default(0): drafts and share links from pre-rounding versions stay valid */
  rounding: centsZod.default(0),
  scan: z
    .object({
      status: z.enum(['green', 'amber', 'red']),
      deltaCents: centsZod,
    })
    .nullable(),
  /** default(null): drafts and share links from pre-scannedTotal versions stay valid */
  scannedTotal: centsZod.nullable().default(null),
})

export function parseRoundState(data: unknown): RoundState | null {
  const r = roundStateZod.safeParse(data)
  return r.success ? (r.data as RoundState) : null
}
