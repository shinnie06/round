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

/** A portion off the wire. `units` is a positive whole number; a malformed
 *  units (0/negative/non-int) is COERCED to 0 via `.catch(0)` rather than
 *  thrown, so the item-level Σ check can degrade the whole split to un-split
 *  instead of nulling the entire round (repair-at-the-boundary stance).
 *  The cross-portion "Σ units === qty" invariant is checked at the ITEM
 *  level (a portion can't see its siblings or its parent's qty). The schema
 *  does NOT check assignee existence — that is a split-time concern. */
export const portionZod = z.object({
  units: z.number().int().min(1).catch(0),
  assignedDinerIds: z.array(z.string()),
})

export const itemZod = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    qty: z.number().int().min(1),
    unitPrice: centsZod,
    assignedDinerIds: z.array(z.string()),
    /** OPTIONAL — absent in every v1 link, draft, and OCR output, which all
     *  parse unchanged (no `.default()`, so the key stays `undefined`). */
    portions: z.array(portionZod).optional(),
  })
  // Tolerant repair, mirroring "never throw at the boundary": a structurally
  // valid but inconsistent split is DOWNGRADED to un-split, not rejected, so
  // one bad item can't nuke a whole share link. assignedDinerIds is always
  // RETAINED on downgrade (it was never touched).
  .transform((it) => {
    if (!it.portions || it.portions.length === 0) {
      const { portions: _omit, ...rest } = it // normalize []/undefined -> omit key
      return rest
    }
    const sum = it.portions.reduce((a, p) => a + p.units, 0)
    if (sum !== it.qty) {
      // units don't conserve (incl. a coerced-0)
      const { portions: _bad, ...rest } = it // -> drop split, keep whole-line behavior
      return rest
    }
    return it
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
  /** default(null): pre-feature drafts/links stay valid */
  payerId: z.string().nullable().default(null),
  /** default(0 = off): pre-feature drafts/links stay valid */
  collectRounding: centsZod.default(0),
})

export function parseRoundState(data: unknown): RoundState | null {
  const r = roundStateZod.safeParse(data)
  return r.success ? (r.data as RoundState) : null
}
