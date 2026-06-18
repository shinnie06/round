# Round — Portions (Fareware / Birthday Split) Design & Implementation Plan

> **Status:** Final, critique-hardened. Design + plan only (D6); no implementation in this pass.
> **Baseline verified at authoring time:** 15 test files / 129 tests green, 1 file / 45 tests skipped (integration), `tsc --noEmit` exit 0. The entire worked example was reproduced numerically (food `[5251,4850,3849,2250]`, subtotal `16200`, service `1620`, GST `1604`, grand `19424`; portion splits `[934,933,933]` and `[667,667,666]`; edge `200/[1,1,1]=[67,67,66]`).

## 0. Overview

Round splits a Singapore restaurant bill among diners with the hard, fuzz-tested invariant **Σ per-diner total === grand total, always**. Today every line item is shared by exactly one group (`Item.assignedDinerIds`, with `[]` as the "everyone" sentinel; `src/state/splitBill` loop at `src/math/splitBill.ts:42-56`). This design adds an **opt-in, per-item "portions" model** so a single line can be carved into ordered slices, each shared equally by a *different* explicit set of diners — enabling the worked fareware scenario where the guest(s) of honour pay for nothing on certain lines, expressed purely by their **absence** from those slices' participant lists.

The feature is **additive and backward-compatible by construction**. An un-split item is byte-identical to today through every *engine, schema, store, codec, and storage* layer; the **settle/share view changes deliberately** for the common case (one itemized food row per item instead of a single "Food & drink" row — see §0.1). The common editing path gains **zero required fields and zero extra taps**.

### Worked scenario (the acceptance test for every layer)
Diners: payers **P1, P2, P3** plus one main person **M** being treated.
- **5× Pan-Seared Snapper** — un-split, everyone sentinel `[]`. M *does* pay an equal share here (this is normal sharing; M is only treated on specific items).
- **3× One36 Pork Adobo w/ Egg** — portioned: 1 unit paid solo by P1; the other 2 units shared equally by P1, P2, P3 (M excluded).
- **3× Grilled Chicken Chop** — portioned: 1 unit paid solo by P2; the other 2 units shared equally by P1, P2, P3 (M excluded).

M ends up paying *only* their Snapper share plus the SG charges on that share. The bill still sums to the printed grand total to the cent.

### 0.1 Scope of "byte-identical" (one precise correction)
"Un-split path is byte-identical to today" holds for: the type (`portions` absent ⇒ `undefined`), the zod schema (optional, no default, key stays unset), the store (every new action early-outs on `!portions`), the split **engine** (the `else` branch is the same `lineTotal` + same sentinel resolution + same skip-on-empty), the URL codec (envelope stays `v1`; `portions` is just more JSON), the IndexedDB draft, and OCR output. It does **not** hold for the **settle card and share text**: Phase 5 replaces `DinerCard`'s single `{ label:'Food & drink', amount: split.food }` row (`src/features/settle/DinerCard.tsx:29-34`) with one labeled row per item. That is an *intended common-path settle-view change*, not a regression — the collapsed card header (`DinerCard.tsx:42-56`) and every monetary amount are unchanged, and a no-regression snapshot re-baselines the expanded un-split card (see §11, §13).

---

## 1. Locked decisions (D1–D6) — honoured verbatim

- **D1 Portions model, opt-in.** Each portion consumes a whole number of units; portions' units sum to `qty` (full allocation). Each portion is split *equally* among an explicit participant list. An un-split item behaves exactly as today. The common path never regresses.
- **D2 No guest-of-honour role/flag.** No diner state, no star, no auto-exclusion. "M does not pay" = M's absence from the relevant slices.
- **D3 Exclusion = absence from the list.** Per-portion participant lists, user-controlled; "everyone except X" is the materialized n−1 list, reusing the `[]`=everyone sentinel *within* a portion.
- **D4 Equal split within a portion.** No weights. Money stays exact via the existing largest-remainder method (`distributeProportionally`, `src/math/proportional.ts`), applied **per portion**.
- **D5 Backward compatibility mandatory.** Existing share links (`{v:1}`), IndexedDB drafts (`round-draft-v1`), and OCR output (no portions) load and behave identically. Additive, defaulted zod; envelope stays **v1**.
- **D6 Deliverable is design + plan only.** No implementation this pass.

---

## 2. Canonical data model (single source of truth)

`src/state/types.ts` — additive only. Un-split items are byte-identical to today (current `Item` at `src/state/types.ts:12-20`, `lineTotal` at `:43`).

```ts
import { cents, type Cents } from '@/math/money'

/**
 * A contiguous slice of an item's units, shared EQUALLY by an explicit
 * participant list. Opt-in: present only when the line is split between
 * different groups (e.g. a treated guest doesn't pay for some units).
 * Reuses the item-level sentinel verbatim: `assignedDinerIds: []` means
 * "everyone" WITHIN this portion (resolved against the current diner list
 * at split time, exactly like an un-split item).
 */
export interface Portion {
  /** Whole units of the parent item this portion covers. >=1. Portions'
   *  units sum to item.qty — every unit's cost lands on somebody. */
  units: number
  /** Diners splitting THIS portion equally. `[]` is the everyone sentinel. */
  assignedDinerIds: string[]
}

export interface Item {
  id: string
  name: string
  qty: number
  /** Price per unit; line total = qty x unitPrice. */
  unitPrice: Cents
  /** Today's single-group sharing. `[]` is the everyone sentinel.
   *  Used when `portions` is absent. RETAINED verbatim. */
  assignedDinerIds: string[]
  /** OPTIONAL opt-in split. When present and non-empty, OVERRIDES
   *  assignedDinerIds: the item is allocated portion-by-portion. Absent
   *  (undefined) for the common un-split case — never written for it. */
  portions?: Portion[]
}

/** UNCHANGED. Portions never change what the whole line costs.
 *  Invariant: Σ(portion.units·unitPrice) === lineTotal. */
export const lineTotal = (it: Item): Cents => cents(it.qty * it.unitPrice)

/** Exact integer cents for one portion: units x unitPrice. New helper.
 *  Safe: `cents()` (money.ts:11) throws on non-integers, but `units` is a
 *  positive integer (portionZod + store clamps) and `unitPrice` is int. */
export const portionTotal = (unitPrice: Cents, units: number): Cents =>
  cents(units * unitPrice)

/** The single predicate every consumer branches on. `portions: []` (from a
 *  hand-rolled link) is treated as ABSENT, so split engine, UI and store
 *  fall back to assignedDinerIds. */
export const isPortioned = (it: Item): boolean =>
  Array.isArray(it.portions) && it.portions.length > 0

/** Units accounted for by portions. Equals qty when the invariant holds. */
export const portionedUnits = (it: Item): number =>
  it.portions ? it.portions.reduce((a, p) => a + p.units, 0) : 0

/** UI-queryable mirror of addPortion's no-op condition: a portion can be
 *  carved only if some portion has >=2 units to spare. Colocated so the
 *  disabled-state logic stays out of the component. */
export const canAddPortion = (it: Item): boolean =>
  isPortioned(it) && it.portions!.some((p) => p.units >= 2)
```

### Invariants (the contract every layer upholds)
1. **Units conservation** — for a portioned item, `Σ(portion.units) === item.qty`. Enforced by the store (moves units between portions, never invents/drops) and re-checked at the schema boundary, which **downgrades** a non-conserving item to un-split (retaining `assignedDinerIds`) rather than rejecting it.
2. **Cost conservation** — `Σ(units·unitPrice) === lineTotal === qty·unitPrice`, exact integer cents. This is the bridge that preserves the global Σ-per-diner === grand-total invariant.
3. **Sentinel meaning identical at both levels** — `assignedDinerIds === []` means "everyone", resolved against the current diner list at split time, on the item (un-split) or inside a portion. **Crucially the `[]`-check happens BEFORE filtering**: a literal `[]` → everyone; an explicit list whose ids all resolve to unknown → `[]` after filter → *skip* (distinct outcomes; see invariant 8).
4. **At-least-one per scope** — an un-split item keeps ≥1 diner (today's rule, `store.ts:137`); a portion keeps ≥1 diner. A toggle that would empty a portion is refused; a `removeDiner` that empties an explicit portion list resets it to `[]` (everyone).
5. **Override precedence** — `isPortioned(item)` ⇒ engine and UI use `portions` and ignore the dormant `item.assignedDinerIds`. Absent/empty ⇒ un-split path, byte-identical to today.
6. **Empty == absent** — `portions: []` is meaningless; normalized to `undefined` at the boundary. "Present" always implies "≥1 slice".
7. **Reversibility** — `splitItem` and `mergePortions` are inverses for a single full-allocation portion: Split→Merge yields an item with byte-identical serialization to one never split.
8. **Orphaned slice** — a portion whose participant list resolves to empty (all ids unknown) contributes no food and is skipped exactly like today's empty-participants item (`splitBill.ts:47` `continue`); **its cost is excluded from the bill** (it lowers subtotal and grand total equally), it is *not* residual-pinned.

> **Two repair mechanisms, two layers (do not conflate).** The schema `.transform` only checks **units-conservation** — it cannot validate participant existence because ids are resolved against the *live* diner list at split time, not at parse time. **Unknown-assignee tolerance is a split-time concern**, handled by the engine's `filter(idx.has)` exactly as the item level does today. A units-non-conserving item is downgraded to un-split *at parse*; a units-conserving but all-ids-unknown portion is *skipped at split*. These are independent.

---

## 3. Schema (zod boundary) — additive + tolerant repair

`src/state/schema.ts`. Old links/drafts/OCR (no `portions` key) parse unchanged. This reproduces the exact additive pattern already proven for `rounding` (`schema.ts:35`, `.default(0)`) and `scannedTotal` (`schema.ts:43`, `.nullable().default(null)`), both covered by compat tests (`schema.test.ts:52-69`, `urlhash.test.ts:57-67`).

```ts
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
 *  instead of nulling the entire round (repair-at-the-boundary stance,
 *  mirroring rawReceiptZod's normalization transforms at schema.ts ocr).
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
      const { portions: _omit, ...rest } = it    // normalize []/undefined -> omit key
      return rest
    }
    const sum = it.portions.reduce((a, p) => a + p.units, 0)
    if (sum !== it.qty) {                          // units don't conserve (incl. a coerced-0)
      const { portions: _bad, ...rest } = it       // -> drop split, keep whole-line behavior
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
  rounding: centsZod.default(0),
  scan: z.object({ status: z.enum(['green','amber','red']), deltaCents: centsZod }).nullable(),
  scannedTotal: centsZod.nullable().default(null),
})

export function parseRoundState(data: unknown): RoundState | null {
  const r = roundStateZod.safeParse(data)
  return r.success ? (r.data as RoundState) : null
}
```

**Type-safety note (must be in "done").** Adding `.transform` changes `itemZod`'s output type. The `parseRoundState` cast `r.data as RoundState` (`schema.ts:48`) must still typecheck — the transform's two return branches (`{...rest}` vs `it`) must both be assignable to `Item`. The un-split branch returns a structurally identical object (`portions` omitted ⇒ `undefined`), so it satisfies `Item`. A `tsc --noEmit` pass (baseline exit 0) is part of the phase's done criteria.

---

## 4. Store actions (`src/state/store.ts`)

`splitItem` is the **only** place a split is born; every editing action below assumes `portions` already exists. All actions early-out on `if (!it.portions) return` for un-split items so the common path pays nothing. New action signatures are added to `StoreState.actions` (`store.ts:27-48`).

```ts
// ── BIRTH ─────────────────────────────────────────────────────────────
splitItem: (itemId) =>
  set((s) => {
    const it = s.round.items.find((i) => i.id === itemId)
    if (!it || it.qty < 2 || it.portions) return     // no-op if un-splittable or already split
    it.portions = [{ units: it.qty, assignedDinerIds: [...it.assignedDinerIds] }]
    // preserves today's sharing as one full-allocation portion; [] stays []
  })

// ── STRUCTURE ─────────────────────────────────────────────────────────
addPortion: (itemId) =>
  set((s) => {
    const it = s.round.items.find((i) => i.id === itemId)
    if (!it?.portions) return
    // carve a 1-unit slice off the LAST portion with units >= 2
    for (let k = it.portions.length - 1; k >= 0; k--) {
      if (it.portions[k]!.units >= 2) {
        it.portions[k]!.units -= 1
        it.portions.push({ units: 1, assignedDinerIds: [] }) // everyone = "whoever's left"
        return
      }
    }
    // no portion can spare a unit -> no-op (qty fully fragmented)
  })

setPortionUnits: (itemId, portionIndex, units) =>
  set((s) => {
    const it = s.round.items.find((i) => i.id === itemId)
    const ps = it?.portions
    if (!ps || portionIndex < 0 || portionIndex >= ps.length) return
    const nbr = portionIndex + 1 < ps.length ? portionIndex + 1 : portionIndex - 1
    if (nbr < 0) return                                // single portion, nothing to conserve against
    const cur = ps[portionIndex]!.units
    const max = cur + ps[nbr]!.units
    const next = Math.min(Math.max(1, Math.floor(units)), max)   // clamp [1, cur+nbr]; Math.floor is
    if (next === cur) return                           // the ONLY guard against a fractional units → cents() throw
    ps[nbr]!.units += cur - next                       // delta to/from neighbour -> Σ units invariant
    ps[portionIndex]!.units = next
  })

removePortion: (itemId, portionIndex) =>
  set((s) => {
    const it = s.round.items.find((i) => i.id === itemId)
    const ps = it?.portions
    if (!ps || ps.length < 2 || portionIndex < 0 || portionIndex >= ps.length) return
    const dest = portionIndex > 0 ? portionIndex - 1 : 1     // prev, else next (was first)
    ps[dest]!.units += ps[portionIndex]!.units              // return units, never drop
    ps.splice(portionIndex, 1)
    // a lone remaining portion is left intact (still a valid 1-portion split;
    // full collapse to un-split is mergePortions, NOT removePortion)
  })

mergePortions: (itemId) =>                                  // exact inverse of splitItem for 1 portion
  set((s) => {
    const it = s.round.items.find((i) => i.id === itemId)
    if (!it?.portions) return
    it.assignedDinerIds = [...it.portions[0]!.assignedDinerIds]  // best-effort, documented lossy
    delete it.portions                                          // -> undefined; byte-identical to never-split
  })

// ── PER-PORTION ASSIGNMENT (sentinel-aware mirrors of store.ts:128-154) ──
togglePortionAssignment: (itemId, portionIndex, dinerId) =>
  set((s) => {
    const it = s.round.items.find((i) => i.id === itemId)
    const p = it?.portions?.[portionIndex]
    if (!p) return
    const allIds = s.round.diners.map((d) => d.id)
    const current = p.assignedDinerIds.length === 0 ? allIds : p.assignedDinerIds
    const next = current.includes(dinerId)
      ? current.filter((id) => id !== dinerId)
      : [...current, dinerId]
    if (next.length === 0) return                            // >=1 per portion: refuse to empty
    const coversEveryone = allIds.length > 0 && allIds.every((id) => next.includes(id))
    p.assignedDinerIds = coversEveryone ? [] : next
  })

assignPortionOnly: (itemId, portionIndex, dinerId) =>
  set((s) => {
    const it = s.round.items.find((i) => i.id === itemId)
    const p = it?.portions?.[portionIndex]
    if (p && s.round.diners.some((d) => d.id === dinerId)) {
      p.assignedDinerIds = s.round.diners.length === 1 ? [] : [dinerId]
    }
  })

assignPortionEveryone: (itemId, portionIndex) =>
  set((s) => {
    const p = s.round.items.find((i) => i.id === itemId)?.portions?.[portionIndex]
    if (p) p.assignedDinerIds = []
  })
```

### Extended/guarded existing actions
```ts
removeDiner: (id) =>                                          // extends store.ts:96-104
  set((s) => {
    s.round.diners = s.round.diners.filter((d) => d.id !== id)
    for (const item of s.round.items) {
      // today's loop, byte-identical (filter-only, never re-collapse)
      if (item.assignedDinerIds.length !== 0)
        item.assignedDinerIds = item.assignedDinerIds.filter((a) => a !== id)
      // NEW: walk portions, strip the id, guard the >=1 rule
      if (!item.portions) continue                     // un-split round pays nothing here
      for (const p of item.portions) {
        if (p.assignedDinerIds.length === 0) continue  // sentinel: skip
        p.assignedDinerIds = p.assignedDinerIds.filter((a) => a !== id)
        // emptied explicit list -> [] which the engine reads as everyone (re-bills survivors).
        // This MATCHES the SHIPPED item-level behavior (store.ts:96-104 filters only), NOT the
        // aspirational store.ts:102 comment. An n-1 list is left explicit, NOT collapsed.
      }
    }
  })

updateItem: (id, patch) =>                                   // guards store.ts:111-115
  set((s) => {
    const it = s.round.items.find((i) => i.id === id)
    if (!it) return
    // qty edit on a portioned item would break units-conservation -> drop the split.
    // VALUE-compare (not key-presence): re-saving the same qty must NOT nuke portions.
    if (patch.qty !== undefined && patch.qty !== it.qty && it.portions) delete it.portions
    Object.assign(it, patch)
  })
```

### Untouched / dormant
- `addDiner`, `addItem`, `loadRound`, `reset`, `emptyRound`: **unchanged**. A new diner appears in no explicit portion list and is implicitly included only where a portion's list is `[]`. `addItem` never seeds portions (`store.ts:106-109` already emits a valid un-split item). `emptyRound` seeds none. `loadRound` trusts `parseRoundState`.
- `toggleAssignment` / `assignOnly` / `assignEveryone` (`store.ts:128-154`): operate on `assignedDinerIds`, which is **dormant** while portioned (override precedence). The UI routes portioned items to the per-portion variants instead, so these are never reached for a portioned item; they remain byte-identical for un-split items.

> **UX note (new-slice default re-includes excluded diners).** `splitItem` copies `item.assignedDinerIds` into portion 0 (so an item-level exclusion is preserved on the first slice), but `addPortion` seeds every *new* slice as `[]` = everyone. If a diner was excluded at the item level before splitting, they are **re-included** on each newly added slice. This is correct per D3 (the user controls each portion's list, and the per-portion list is the source of truth) but should not surprise — the PortionEditor's per-portion toggles make the membership explicit.

---

## 5. Split math engine (`src/math/splitBill.ts`)

The **only** change is the per-item allocation loop (`splitBill.ts:42-56`). Everything below `subtotal` — `applyCharges` (`:58-64`), the three charge distributions (`:66-69`), and `distributeResidual` (`:74`) — is **byte-identical**, because portions only redistribute *which diner pays which units of food*; they feed the same `food[]` array.

Two module-local helpers extract the existing sentinel resolution + accumulate so item and portion levels share one impl (no behavior drift):

```ts
import { addC, cents, type Cents, ZERO } from './money'
import { applyCharges } from './singapore'
import { distributeProportionally } from './proportional'
import { distributeResidual } from './residual'
import { lineTotal, portionTotal, isPortioned, type Diner, type RoundState } from '@/state/types'

// `[]` -> everyone; else the explicit ids that still exist. Identical rule at
// item and portion level (sentinel-meaning-identical invariant). The []-check
// is BEFORE the filter, so literal-[] (everyone) and all-unknown-after-filter
// ([] -> skip) are correctly distinct.
function resolveParticipants(assigned: string[], diners: Diner[], idx: Map<string, number>): string[] {
  return assigned.length === 0 ? diners.map((d) => d.id) : assigned.filter((id) => idx.has(id))
}

// Split an exact-cent cost equally across participants (largest remainder) and
// accumulate into food[]. Empty participants -> deposit nothing (orphan/skip),
// exactly like today's line-47 `continue`.
function allocateEqually(cost: Cents, participants: string[], idx: Map<string, number>, food: Cents[]): void {
  if (participants.length === 0) return
  const shares = distributeProportionally(cost, participants.map(() => 1))
  participants.forEach((id, k) => { const i = idx.get(id)!; food[i] = addC(food[i]!, shares[k]!) })
}
```

Loop body:
```ts
for (const item of items) {
  if (isPortioned(item)) {
    // Σ(portion.units·unitPrice) === lineTotal (units conservation, enforced by
    // store + schema), so when no portion is orphaned the line's total food is
    // unchanged — only WHO absorbs WHICH units differs.
    for (const p of item.portions!) {
      const cost = portionTotal(item.unitPrice, p.units)               // units x unitPrice, exact
      allocateEqually(cost, resolveParticipants(p.assignedDinerIds, diners, idx), idx, food)
    }
  } else {
    // Un-split path — byte-identical to today.
    allocateEqually(lineTotal(item), resolveParticipants(item.assignedDinerIds, diners, idx), idx, food)
  }
}
```

The `else` branch is semantically identical to today (same `lineTotal`, same sentinel resolution, same skip-on-empty). All current `splitBill.test.ts` cases (Jumbo Seafood at `:32-57`, everyone-sentinel `:59-68`, zero-weight diner `:70-80`, residual `:82-92`, empty round `:94-98`, rounding line `:101-116`) must pass unmodified — they are the regression gate for the helper extraction.

### Why the global invariant still holds (the proof — correctly scoped)
The global invariant **Σ per-diner total === grandTotal is preserved by construction in ALL cases**, because `subtotal` is recomputed from whatever `food[]` actually ends up being (`splitBill.ts:58` `addC(...food)`), and every charge + residual derives from that scalar. Two sub-claims decompose *why*:

- **Claim 1 — food conservation per line (scoped: NO portion is orphaned).** When every portion of a line has ≥1 resolvable participant: `portionTotal(unitPrice, units) = cents(units·unitPrice)` is exact integer cents (`money.ts:11` asserts integrality; `units` is a positive integer). `distributeProportionally(cost, weights)` guarantees `Σ(result) === cost` for any input (`proportional.ts:20-52`, proven in `proportional.test.ts`). Across portions, `Σ_p portionTotal(unitPrice, p.units) = unitPrice · Σ_p p.units = unitPrice · qty = lineTotal`. So a fully-resolvable portioned line contributes the *same total food* as the un-split line — `subtotal` is identical given the same participating diners.
- **Claim 1′ — orphaned portion (the case invariant 8 introduces).** If a portion's participant list resolves to empty (all ids unknown), `allocateEqually` deposits nothing and that slice's cost is **excluded from the bill** — the portioned line then contributes *less* food than the un-split line would. This does **not** break the global invariant: `subtotal` simply recomputes lower, and `grandTotal` follows, exactly like today's all-unknown-ids **un-split** item (also skipped at `splitBill.ts:47`). The sum-per-diner still equals the (now lower) grandTotal because every downstream charge derives from the recomputed `subtotal`. So the invariant holds *by the subtotal-recompute argument*, not by per-line food equality.
- **Claim 2 — charges + residual unchanged.** `applyCharges` (`singapore.ts:35-43`) consumes only the scalar `subtotal`; blind to *how* food was allocated. Each charge is distributed proportional to `food[]` weights, and `distributeProportionally(charge, weights)` conserves `Σ` even with zero-weight members (all-zero fallback at `proportional.ts:30-31`). `distributeResidual` pins signed leftover on the highest payer and returns totals summing to `grandTotal` by construction (`residual.ts:24-36`). All portion-agnostic.

> **Invariant strength worth stating:** even a units-NON-conserving portioned item that somehow bypassed the schema transform could only mis-state `subtotal` vs the printed receipt (a *fidelity* bug) — it cannot break Σ-per-diner === grandTotal, because that sum is derived from the actual `food[]`. The schema Σ-check is the **fidelity** guard, not the **invariant** guard.

### The two required edge cases (numerically verified)
- **Cost indivisible among participants.** 2 units @ 100¢ across 3 payers: `distributeProportionally(200, [1,1,1]) = [67,67,66]` (largest remainder, ties→lowest index), `Σ === 200`. Odd cents land deterministically per portion. (Verified.)
- **Fully-treated diner → 0 food → 0 charges.** M is in no portion of the treated lines and no other line they'd pay. `food[M] = ZERO` ⇒ `weights[M] = 0` ⇒ all three charge shares 0 (`proportional.ts` zero-weight path) ⇒ `total[M] = 0`. The residual lands on the *highest* payer, never M while others are positive (`residual.ts:31-33`). Already a tested item-level invariant (`splitBill.test.ts:70-80`); portions inherit it one level deeper.

### Engine output extension (for settle/sharing — Phase 5)
`DinerSplit` (`splitBill.ts:21-28`) gains `lines: FoodLine[]`, a strict decomposition of `food` so the settle UI can attribute portion costs. Additive; `Σ over a diner's line.food === DinerSplit.food`, so every invariant is preserved.

```ts
export interface FoodLine {
  itemId: string
  name: string             // copied so share text needs no item lookup
  food: Cents              // this diner's exact cents for this item (this portion if portioned)
  /** Present ONLY when the item isPortioned(). Drives "1 of 3" vs "shared 2 of 3" copy. */
  portion?: { units: number; qty: number; shareOf: number }
}
export interface DinerSplit { dinerId: string; food: Cents; discount: Cents; service: Cents; gst: Cents; total: Cents; lines: FoodLine[] }
```

In the loop, the same accumulation that adds to `food[]` also pushes a `FoodLine` onto `linesByDiner[i]`: for an un-split item, one line per participant with `portion` omitted; for a portioned item, one line per (portion, participant) with `portion: { units: p.units, qty: item.qty, shareOf: participants.length }`. A diner absent from every portion of an item gets **no line for it** — that is exactly how "M pays nothing for the Adobo" surfaces (item missing from their card, not a $0.00 row). A solo unit + a share of the rest produces **two** lines for the same `itemId`, kept separate so "1 of 3" and "shared 2 of 3" render distinctly.

---

## 6. Worked scenario end-to-end (data → math → settle/share)

Illustrative prices: Snapper $18/unit (1800¢), Adobo $14/unit (1400¢), Chicken $10/unit (1000¢). SG defaults: service 10%, GST 9%, no discount. **All figures below were reproduced numerically against the real `distributeProportionally` / `applyCharges` logic.**

### 6.1 Data
```
Diners: P1, P2, P3, M
items: [
  { name:'Pan-Seared Snapper', qty:5, unitPrice:1800, assignedDinerIds:[] },          // un-split, everyone
  { name:'One36 Pork Adobo w/ Egg', qty:3, unitPrice:1400, assignedDinerIds:[],
    portions:[ {units:1, assignedDinerIds:['P1']},                                     // solo
               {units:2, assignedDinerIds:['P1','P2','P3']} ] },                        // payers except M
  { name:'Grilled Chicken Chop', qty:3, unitPrice:1000, assignedDinerIds:[],
    portions:[ {units:1, assignedDinerIds:['P2']},                                     // solo
               {units:2, assignedDinerIds:['P1','P2','P3']} ] },                        // payers except M
]
```

### 6.2 Math (per-line food, exact cents)
- **Snapper** `lineTotal = 5·1800 = 9000`, un-split everyone → `[2250,2250,2250,2250]`. Each of P1,P2,P3,M gets 2250.
- **Adobo** portion A `cost = 1·1400 = 1400`, `[P1]` → P1 +1400. Portion B `cost = 2·1400 = 2800`, `[P1,P2,P3]` → `[934,933,933]` → P1 +934, P2 +933, P3 +933. `Σ = 4200 = lineTotal` ✓. M: nothing.
- **Chicken** portion A `cost = 1000`, `[P2]` → P2 +1000. Portion B `cost = 2000`, `[P1,P2,P3]` → `[667,667,666]` → P1 +667, P2 +667, P3 +666. `Σ = 3000 = lineTotal` ✓. M: nothing.

Per-diner **food**:
| | Snapper | Adobo | Chicken | food |
|---|---|---|---|---|
| P1 | 2250 | 1400+934 | 667 | **5251** |
| P2 | 2250 | 933 | 1000+667 | **4850** |
| P3 | 2250 | 933 | 666 | **3849** |
| M | 2250 | — | — | **2250** |

`subtotal = 5251+4850+3849+2250 = 16200 = 9000+4200+3000` ✓.

Charges on `subtotal=16200`, no discount: `service = round(16200·0.10) = 1620`; `gst = round((16200+1620)·0.09) = round(1603.8) = 1604`; `grandTotal = 16200+1620+1604 = 19424`. Each charge distributed proportional to `food` weights `[5251,4850,3849,2250]`; M's weight 2250 is positive (M *did* eat Snapper), so M pays a Snapper-only share of service/GST. **Per-diner totals = `[6296,5815,4615,2698]`, sum = 19424 = grandTotal** ✓ (verified).

### 6.3 Settle card (P1 expanded) and treated M
```
P1
  Pan-Seared Snapper                        $22.50
  One36 Pork Adobo w/ Egg · 1 of 3          $14.00
  One36 Pork Adobo w/ Egg · shared 2 of 3    $9.34
  Grilled Chicken Chop · shared 2 of 3       $6.67
  Service charge                            $...
  GST                                       $...
M  (collapsed total $26.98 ; expanded:)
  Pan-Seared Snapper                        $22.50
  Service charge                            $...
  GST                                       $...
```
M is treated on Adobo and Chicken purely by absence — those rows simply do not appear on M's card. (A diner treated for *everything* — `lines.length === 0 && food === 0` — renders a single muted `Treated — pays nothing` row, total $0.00.)

### 6.4 Share
`encodeShareHash(round)` → `{ v:1, s: state }` → lz-string (`urlhash.ts:16-19`). `state.items[].portions` is just more JSON inside `s`; it round-trips with **zero codec change** (envelope stays v1, decode still gates on `v === 1` at `urlhash.ts:32`). The share **text** (`buildShareText`) is generated client-side from the decoded state, using the same `lineLabel()` as the card so they never drift, and `formatSGD` for every amount.

---

## 7. UI / UX (`src/features/workspace/*`, `src/features/settle/*`)

North star: the un-split **editing** path is byte-identical to today. `AssignSheet` renders exactly as now whenever `isPortioned(item)` is false. The portions UI is a *second mode* of the same sheet, reached by one new affordance, reusing every existing idiom (sentinel-aware toggle `AssignSheet.tsx:59-112`, the dashed "Everyone shares this" button `AssignSheet.tsx:49-57`, the `PctStepper` ± idiom `ChargesSection.tsx:16-55`, `DINER_COLORS`, `Money`).

### 7.1 Opt-in affordance (AssignSheet, un-split mode)
One new control, only when the line can be meaningfully split, placed between the "Everyone shares this" button (`AssignSheet.tsx:57`) and the toggle `<ul>` (`:59`):
```tsx
{!readOnly && item.qty > 1 && !isPortioned(item) && (
  <button type="button" onClick={() => useStore.getState().actions.splitItem(item.id)}
    className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line text-small text-cream-dim hover:border-cream-dim hover:text-cream">
    <Scissors size={15} aria-hidden /> Split into parts
  </button>
)}
```
Gated on `item.qty > 1` (matches `splitItem`'s `qty < 2` no-op). For qty-1, already-portioned, or `readOnly`, the button never renders — zero change to the common case. When `isPortioned(item)` is true, the sheet body switches to the **portion editor** and the item-level toggle list + `Only`/`Everyone` controls are hidden (dormant `assignedDinerIds`).

### 7.2 Portion editor (new `PortionEditor.tsx`, ASCII mockup)
`AssignSheet` branches at the top of its `{item && (…)}` block (`AssignSheet.tsx:38`): `isPortioned(item) ? <PortionEditor .../> : <UnsplitBody .../>` (today's JSX lifted verbatim).
```
┌─────────────────────────────────────────────┐
│  One36 Pork Adobo w/ Egg                 ✕   │   ← Sheet title (unchanged)
│  3 ×  ·  split into 2 parts        $42.00    │   ← summary (replaces AssignSheet.tsx:40-47)
│                                               │
│  ╭───────────────────────────────────────╮  │
│  │ Part 1            [ − ] 1 unit [ + ]   │  │   ← units stepper (PctStepper idiom → setPortionUnits)
│  │                              $14.00 ·· │  │   ← portionTotal()
│  │  ● P1           ✓        [ Only ]      │  │   ← toggle list (AssignSheet 59-112 → togglePortionAssignment)
│  │  ○ P2                    [ Only ]      │  │
│  │  ○ P3                    [ Only ]      │  │
│  │  ○ M                     [ Only ]      │  │
│  │  + Everyone shares this part           │  │   ← assignPortionEveryone (shown when list non-empty)
│  ╰───────────────────────────────────────╯  │
│  ╭───────────────────────────────── [✕] ─╮  │   ← removePortion (only when >1 part)
│  │ Part 2            [ − ] 2 units [ + ]  │  │
│  │                              $28.00 ·· │  │
│  │  ● P1           ✓        [ Only ]      │  │
│  │  ● P2           ✓        [ Only ]      │  │
│  │  ● P3           ✓        [ Only ]      │  │
│  │  ○ M  (being treated)             ↶off │  │   ← deselected = "except M"  (togglePortionAssignment)
│  ╰───────────────────────────────────────╯  │
│                                               │
│  ✓ Parts cover 3 of 3 units                  │   ← units sum bar (aria-live; always green w/ conserving store)
│  + Add part                                   │   ← addPortion (dashed; disabled per canAddPortion())
│                                               │
│  ⟲ Merge back                      [ Done ]  │   ← mergePortions  /  Done
└─────────────────────────────────────────────┘
```
- **Units stepper** reuses `PctStepper`'s ± at `h-8 w-8` (matching `ChargesSection.tsx:38,48`) inside a `min-h-11` row (44px touch floor). Because `setPortionUnits` conserves by stealing/returning from a **single** neighbour, the visible effect is that *one* neighbour part changes in lockstep; for a 3+-portion item the far part never moves — the **units sum bar** is the antidote that reassures the total still equals `qty`. No drag — discrete taps map cleanly to whole units (D1) and don't fight the sheet's vertical scroll.
- **`+ Add part`** disabled when `!canAddPortion(item)` (every portion already 1 unit). **`Merge back`** (`Combine` icon, ghost) calls `mergePortions`; a small inline note *"Merging keeps the first part's people for the whole item."* (`text-small text-cream-faint`) sets expectations for the documented-lossy behavior. `Done` unchanged.

### 7.3 "Everyone except M" — the worked example flow (no star, no role)
1. Open Adobo (qty 3), tap **Split into parts** → `splitItem` seeds one part `{units:3, assignedDinerIds:[]}`.
2. Tap **Add part** → `Part 1 = 1 unit`, `Part 2 = 2 units`.
3. On **Part 1** (solo): tap **`Only`** next to P1 → `assignPortionOnly(itemId, 0, 'P1')`. One tap.
4. On **Part 2** (shared): it's `[]` = everyone by default; tap **M off** → `togglePortionAssignment` materializes the explicit `[P1,P2,P3]` list. M pays nothing for those 2 units, expressed purely by absence (D2/D3).

### 7.4 Receipt-list rendering (`ItemsSection.tsx`) — ASCII
Un-split rows are 100% unchanged (`ItemsSection.tsx:42-58`). A portioned item keeps the same outer button (still opens `AssignSheet`) with indented, non-tappable portion sublines beneath it. `AvatarDots` (`ItemsSection.tsx:13-30`) gains a sibling `PortionDots` resolving against `p.assignedDinerIds` (same dot rendering, `+N` overflow, cap 5).
```
3×  One36 Pork Adobo w/ Egg ····································· $42.00
      1 unit  —  P1 ············································· $14.00  ●
      2 units —  P1, P2, P3 ····································· $28.00  ●●●
3×  Grilled Chicken Chop ········································ $30.00
      1 unit  —  P2 ············································· $10.00  ●
      2 units —  P1, P2, P3 ····································· $20.00  ●●●
5×  Pan-Seared Snapper ·········································· $90.00  ●●●●
```
Subline "who": ≤2 names show names; 3+ show "N people"; `[]` renders as "everyone". Sublines use the existing `leader` / `font-mono text-receipt`, dimmer (`text-paper-faint`) and indented.

### 7.5 ItemSheet qty-edit caution
`ItemSheet` already lets qty be edited (`ItemSheet.tsx:81-89`) and commits via `updateItem` (`:52`). When editing a *portioned* item, show a one-line caution under the qty field — *"Changing quantity clears the split."* (`text-small text-cream-faint`) — so the `updateItem` qty-drop is expected, not a bug. No new required fields; the add flow is untouched.

### 7.6 Settle / sharing UI changes (Phase 5)
- **`DinerCard.tsx`**: replace the single `{ label:'Food & drink', amount: split.food }` row (`DinerCard.tsx:30`) with one row per `split.lines`, labeled via a shared `lineLabel(line)`: no portion → `{name}`; `shareOf===1` → `{name} · {units} of {qty}`; `shareOf>1` → `{name} · shared {units} of {qty}`. Keep discount/service/GST/residual rows unchanged (`:31-33,75-85`). Add a `lines.length === 0 && split.food === 0 → "Treated — pays nothing"` branch. The collapsed header (`:42-56`) is untouched. **This changes the expanded un-split card from one "Food & drink" row to one-row-per-item — an intended common-path settle-view change, re-baselined by snapshot (see §11).**
- **`lineLabel.ts`** (new, pure) — shared by card and share text so they can't drift.
- **`shareText.ts`** (new) — `buildShareText(round, split): string`, a plain-text per-diner receipt using `formatSGD` and `lineLabel`; fully-treated diner → `Name — $0.00 (treated)`; footer grand total === `split.breakdown.grandTotal`.
- **`ShareActions.tsx`** — **signature change (breaking):** today `ShareActions` takes NO props and reads `useStore.getState().round` directly (`ShareActions.tsx:14,18`). It must accept `split: BillSplit` from `SettleSheet`; `copy()` writes `` `${buildShareText(round, split)}\n\n${shareUrl()}` ``; `nativeShare()` adds `text: buildShareText(...)` alongside the existing `url` (`ShareActions.tsx:33`). The link still round-trips the editable round; the text is the at-a-glance answer.
- **`SettleSheet.tsx`** — pass the already-computed `split` (`SettleSheet.tsx:20`) into `<ShareActions split={split} />`. **`SettleSheet.tsx:62` (`<ShareActions />`) MUST change in lockstep or TS breaks** — this is a Phase 5 done-criterion. `lines` rides inside `DinerSplit` so `DinerCard` receives it for free. No other change.

### Mobile ergonomics
Every interactive element keeps the `min-h-11`/`min-h-12` (44-48px) floors. `Sheet` is already `max-h-[88dvh] overflow-y-auto`; portion cards scroll within it; the footer (`Add part` / `Merge back` / `Done`) is the natural last block, in thumb reach on the bottom-sheet. Avatar dots cap at 5.

---

## 8. OCR & parsing — zero production change

The portions feature is **post-OCR and user-driven**. The whole pipeline (`sanitize`, `repair`, `reconcile`) speaks `RawReceipt`/`CleanReceipt` DTOs (`src/features/ocr/types.ts`), which describe dollars off the receipt and have no concept of diners, assignment, or portions; the two type universes never meet. `Item` is born in exactly one place — `toItem` (`src/features/ocr/mapToState.ts:17-27`) — which already emits `{ id, name, qty, unitPrice, assignedDinerIds: [] }`, an **already-valid new `Item`** (`portions` optional ⇒ `undefined` ⇒ `isPortioned` false ⇒ today's exact engine branch).

**Decision: emit NO `portions` key at all** (not `portions: []`, which the schema normalizes away; not a single implicit portion, which would defeat reversibility and force `isPortioned` true on the common path — a regression). `RECEIPT_JSON_SCHEMA` stays byte-identical (`additionalProperties: false` at both the top level `schema.ts:44` and per-item `:52`), so even a hallucinating future model can't inject a portions key. `useScan` feeds `mapToState` output straight to `loadRound` **without** re-parsing through `parseRoundState` (`src/hooks/useScan.ts:32-34`), which is correct: OCR output is portion-free and trusted; the schema's defensive units-conservation transform is for the *untrusted* share-link/draft boundary only. `qty`-collapse-to-1 (`mapToState.ts:19,23-24`) happens before any portion exists and only ever produces a still-un-split item; a collapsed qty-1 line simply can't be split later (the `splitItem` qty<2 no-op), which is correct fidelity, not a portions bug.

The only OCR deliverable is **regression tests** pinning the portion-free contract (Phase 6), so any future "optimization" that seeds a portion in `toItem` fails loudly.

---

## 9. Migration & backward compatibility (D5)

**Stay on envelope v1 — do NOT bump.** The migration is purely additive (one optional key), exactly the pattern already proven for `rounding` and `scannedTotal`. The `urlhash.ts:5-12` comment ("Envelope is version-tagged so v2 can migrate old links") describes a *future* mechanism; a v2 envelope would force a parallel reader for zero gain, since every old payload is already a valid new payload.

| Boundary | Behavior | Grounded in |
|---|---|---|
| **v1 share link, no `portions`** | `portionZod.optional()` (no `.default()`) → key stays `undefined` → `isPortioned` false → today's exact branch. Byte-identical. | `urlhash.ts:32` gates `v===1`; mirrors rounding compat `urlhash.test.ts:57-67` |
| **v1 share link, with `portions` (new)** | Round-trips through the same v1 reader; `parseRoundState` is portion-aware. | `urlhash.ts:16-37` |
| **IndexedDB draft (old, no portions)** | `loadDraft` → `parseRoundState` → portions undefined, identical resume. `DRAFT_KEY` stays `round-draft-v1`. | `persist.ts:12,33` |
| **OCR output** | No `portions` key; already a valid Item; zero change. | `mapToState.ts:17-27` |
| **Non-conserving / malformed portion on the wire** | `.catch(0)` + Σ-check downgrade to un-split (retaining `assignedDinerIds`); never nulls the round. | §3 transform |
| **Old (pre-feature) app reads a new portioned link** | `itemZod` is a plain `z.object` (strips unknown keys), so `portions` is silently dropped → item renders un-split via `assignedDinerIds`. Because the worked example sets item-level `assignedDinerIds:[]` (everyone) and excludes M only *inside portions*, the old app bills **everyone including M** for the full line — i.e. the failure mode is **"M overpays" (mis-distributed), never "money lost"**; Σ still balances. Graceful but the treated-guest exclusion is lost. Acceptable for a single-user local PWA per D5; documented as intentional. | `schema.ts:19` (z.object strip-unknown) |

**Directionality.** Nothing in the wild contains portions yet, so there is no back-migration; the schema floor only grows. Old-app + new-link is an unsupported-but-graceful forward direction (degradation never breaks Σ).

---

## 10. Edge cases & validation (enumerated, resolved)

### Critical correction baked into the plan (verified against source)
The earlier draft repeatedly invoked today's *"nobody left → back to everyone"* comment (`store.ts:102`). **That comment is aspirational; the shipped code only filters and never re-collapses** — verified at `store.ts:96-104`, and `store.test.ts:33-40` (`removeDiner strips explicit assignments`) only covers the **2-of-3 survivor** case (toggle off mei → `[shin,raj]`, remove shin → `[raj]`), never the "remove the last → re-collapse" path. The portion-level `removeDiner` mirror matches the **code**: an emptied explicit portion list becomes `[]` (which the engine reads as the everyone sentinel, re-billing survivors), and an n−1 explicit list is **not** collapsed to `[]`. Tests assert the *split outcome* (via `splitBill`), not merely the array shape.

### Units conservation
| Case | Resolution |
|---|---|
| Σ units > qty / < qty (hand-rolled link, stale draft) | `itemZod.transform` Σ-check drops `portions` → un-split; `assignedDinerIds` retained |
| qty edited after split (3→4) | `updateItem` value-compare guard drops `portions`; UI re-offers Split |
| qty re-saved unchanged | Guard compares values, not key presence → portions preserved |
| `units: 0`/negative/non-int on wire | `portionZod` `.catch(0)` then Σ-check downgrade |
| `addPortion` when fully fragmented | No-op (`canAddPortion` false) |
| `setPortionUnits` over neighbour capacity | Clamp to `[1, cur+nbr]`; `Math.floor` guards a fractional value from reaching `cents()`; no-op on single portion |
| `removePortion` of the only portion | No-op (leave the lone valid 1-portion split; full collapse = `mergePortions`) |
| `removePortion` of a first portion | Fold units into NEXT (`dest = index>0 ? index-1 : 1`); Σ preserved |
| `removePortion` of a middle/last portion | Fold units into prev; Σ preserved |

### Participant / sentinel (per portion)
| Case | Resolution |
|---|---|
| Portion `[]` sentinel | Resolves to all current diners (everyone) |
| Explicit list of all-unknown ids (stale link) | `filter(idx.has)` → `[]` → **skip** (`continue`); NOT the everyone branch (which checks `length===0` *before* filter). Cost excluded from bill; residual 0 |
| `togglePortionAssignment` that would empty a list | Refused (no-op), like `store.ts:137` |
| Re-add last missing diner | Collapses to `[]` via `coversEveryone`, like `store.ts:138` |
| `assignPortionOnly` with single diner | `[]` sentinel (everyone == that diner), like `store.ts:146` |
| `assignPortionOnly` unknown id | No-op (`diners.some` guard) |

### Diner lifecycle × portions
`addDiner` untouched (a new diner appears only in `[]` portions). **Outcome to test:** a diner added *after* a split pays a share of every `[]`-sentinel portion and **zero** of every explicit-list portion — this is the exact mechanism by which "M added late is still treated." `removeDiner` strips id from every explicit portion list; emptied list → `[]` (everyone, re-bills survivors); n−1 list stays explicit. Both `removeDiner` and the schema `.transform` early-out when `portions` is undefined so un-split rounds pay nothing (regression tripwire: `store.test.ts:33-40` + urlhash round-trip/size tests must pass unchanged).

### Money / settlement
Fully-treated diner → food 0 → 0 charges → total 0. All-diners-treated (subtotal 0) → `distributeProportionally` all-zero-weights fallback spreads charges equally, but charges on a 0 subtotal are 0 anyway (benign). Per-portion largest-remainder odd cents accumulate into `food[]`, `Σ(portion costs) === lineTotal`. Single-diner round with portions → all cents to that one diner. **Orphaned-portion cents are EXCLUDED from the bill, not residual-pinned** (consistent with today's all-unknown-ids un-split item).

---

## 11. Test matrix (named cases, by file, with the invariant each guards)

### `tests/unit/schema.test.ts` — new `roundStateZod — portions` describe
- portions absent → item parses byte-identically (no `portions` own-property) [E1]
- `portions: []` is normalized to absent [empty==absent]
- conserving portions (Σ units === qty) survive parse [conservation happy path]
- over-allocating (Σ > qty) downgrades to un-split, **`assignedDinerIds` retained** (assert the pre-existing value)
- under-allocating (Σ < qty) downgrades to un-split, **`assignedDinerIds` retained**
- a portion with `units: 0` downgrades the item to un-split (tolerant `.catch(0)` repair), **`assignedDinerIds` retained**
- unknown assignee ids in a portion are tolerated at parse (no existence check) [schema checks only units, not membership]
- old round with no portions/rounding/scannedTotal still parses [combined compat]

### `tests/unit/store.test.ts` — new `store — portions` describe
- `splitItem` seeds one full-allocation portion ([] stays [], explicit copied, units===qty)
- `splitItem` no-op for qty < 2; no-op if already portioned (idempotent)
- `addPortion` carves a 1-unit slice off the last portion with units ≥ 2; no-op when fully fragmented
- `setPortionUnits` moves units to/from the neighbour conserving qty; clamps to [1, cur+nbr]; floors a fractional input; no-op on single portion
- `togglePortionAssignment`: off-everyone materializes n−1; re-add last collapses to []; last diner cannot be toggled off
- `assignPortionOnly` assigns exactly one diner; single-diner → []; unknown id no-op
- `assignPortionEveryone` restores []
- `removePortion` folds units into prev; **of-first folds into NEXT**; **lone portion → no-op (use mergePortions to fully collapse)**; refused when length<2 (three separate assertions)
- `mergePortions` collapses to un-split adopting portions[0] list (lossy)
- `splitItem` then `mergePortions` yields a byte-identical un-split item [reversibility]
- `removeDiner` strips id from every explicit portion list
- `removeDiner` emptying a portion's explicit list resets it to [] AND the resulting split re-bills survivors (assert via `splitBill`, not just array shape)
- `removeDiner` leaves an n−1 explicit portion list NOT collapsed to [] (matches shipped item-level behavior)
- `addDiner` does not touch any portion list (array-shape)
- `updateItem` changing qty on a portioned item drops portions; re-setting the SAME qty preserves portions (value-compare); name/unitPrice patch preserves portions
- item-level `toggleAssignment`/`assignOnly`/`assignEveryone` leave `splitBill` output unchanged while portioned [override precedence]

### `tests/unit/splitBill.test.ts` — new `splitBill — portions` describe
- THE acceptance test: snapper-everyone + adobo[solo|except-M] + chicken[solo|except-M] with SG charges; explicit per-diner food assertions (food `[5251,4850,3849,2250]`, totals `[6296,5815,4615,2698]`, style of `splitBill.test.ts:32-57`) and `total(s) === grandTotal === 19424`
- a single full-allocation portion splits identically to an un-split item (cent-for-cent) [no-regression / reversibility at math layer]
- each portion gets independent largest-remainder odd cents (e.g. 2u @ 100¢ /3 → [67,67,66], Σ===200)
- an orphaned portion (all listed ids unknown) is skipped and its slice is **excluded from the bill** (grand total lower by that slice, Σ still === grandTotal, residual 0)
- an empty-sentinel portion bills everyone (distinct from all-unknown → skip)
- a fully-treated diner pays 0 across all portions (food/discount/service/gst/total all 0)
- **a diner ADDED after a split** pays a share of `[]`-sentinel portions (Snapper) and ZERO of explicit `[P1,P2,P3]` portions, Σ still === grandTotal [late-add treated mechanism]
- single-diner round with portions sends all cents to the one diner
- isPortioned false-y guards: `portions: []` and `portions: undefined` both take the un-split branch and equal today's result

### `tests/unit/splitBill-property.test.ts` — extend the 300-round fuzz (`:25-39`)
- with ~30% probability per item, cut `qty` into 1..k **contiguous units-conserving portions** (random cut-points, never independent random units — must test the engine, not the schema downgrade), each with a random subset/sentinel; KEEP the two existing assertions (`Σ===grandTotal` at `:55`, no NaN at `:57`)
- add a **per-line cost-conservation** assertion: for portioned rounds, `Σ over non-orphaned slices of (units·unitPrice) === subtotal` (catches a portionTotal bug that happens to still globally balance)
- second smaller case: feed deliberately non-conserving portions through `parseRoundState` (note: this adds a `@/state/schema` import to a file that currently has zero schema dependency — a conscious change to its "engine-only" character) then `splitBill`; assert `Σ===grandTotal` (the downgrade path never yields a broken engine input)

### `tests/unit/urlhash.test.ts` — new `share hash — portions` describe
- round-trips a portioned round (extend `sample` at `:6-27` with one portioned item) [E3]
- a v1 link without portions decodes un-split [E1 at codec layer]
- a v1 link with a non-conserving portion decodes downgraded to un-split, never null [robustness]
- stays under 2000 chars with a portioned item (mirror `urlhash.test.ts:52-54`)

### `tests/unit/mapToState.test.ts` — new `mapToState — portions` describe + extend two existing
- never emits a portions key (`portions === undefined` AND `'portions' in item === false`)
- `isPortioned()` is false for every OCR item
- serializes byte-identical to an un-split item (JSON round-trip carries no portions key)
- OCR output parses through `parseRoundState`/`itemZod` with the transform as a no-op (returns portion-free)
- multi-unit evenly-divisible item (qty 3) is emitted un-split, never pre-portioned
- EXTEND "converts dollars to cents…" (`:22`) and "carries venue, discount, verdict…" (`:76`) to also assert all items are portion-free (the canonical-shape canary)

### Settle/sharing (Phase 5) — `splitBill.test.ts` (lines) + new `lineLabel`/`shareText`/`DinerCard` tests
- un-split item emits one FoodLine per participant with `portion` undefined; Σ(line.food) === DinerSplit.food
- portioned item emits a FoodLine per (portion, participant); solo `shareOf===1`, shared `shareOf===participantCount`; each `line.food` === exact largest-remainder share
- a diner absent from every portion of an item has NO FoodLine for that itemId (treated attribution)
- a diner with a solo unit AND a share of the rest gets TWO lines for the same itemId summing to their food for that item
- Σ over all diners' lines.food === subtotal === Σ DinerSplit.food (decomposition completeness)
- `lineLabel`: un-split → `{name}`; solo → `{name} · {units} of {qty}`; shared → `{name} · shared {units} of {qty}`
- `buildShareText` lists each diner's food lines with the same labels as the card; fully-treated → `Name — $0.00 (treated)`; footer grand total === `split.breakdown.grandTotal`; deterministic
- DinerCard: expanded portioned payer shows multiple item rows with correct labels; treated diner shows `Treated — pays nothing`; collapsed header unchanged for an un-split round (no-regression)
- **DinerCard un-split snapshot re-baseline:** an un-split round's expanded card now shows one-row-per-item (not the single "Food & drink" row of `DinerCard.tsx:29-34`); pin the new expected rows so the intended common-path settle-view change is captured, not assumed identical
- **SettleSheet→ShareActions integration:** the share TEXT footer grand total === `split.breakdown.grandTotal` AND the share LINK still round-trips the editable (portioned) round (proves the new `split` prop is threaded from `SettleSheet.tsx:62`)

### Migration / mixed-origin (fold into schema.test.ts or new `portions-migration.test.ts`)
- OCR output is a valid un-split Item that `splitItem` can portion
- old draft (no portions) and new draft (portions) satisfy the same additive schema
- an old reader (z.object stripping unknown keys) reading a new link degrades gracefully to whole-line, and (worked-example shape) bills everyone including M — "M overpays", Σ still balances [E2]

---

## 12. Phased TDD implementation roadmap (ordered, each phase independently shippable, tests-first)

> Sequencing constraint: `types.ts` defines the helpers (`isPortioned`, `portionTotal`, `portionedUnits`, `canAddPortion`, `Portion`, `Item.portions`) that every later phase imports. It must land first.

### Phase 1 — Data model + schema (foundation)
**Tests first:** `schema.test.ts — portions` (all cases incl. `assignedDinerIds`-retained on every downgrade). **Then:** add `Portion`, `Item.portions?`, `portionTotal`, `isPortioned`, `portionedUnits`, `canAddPortion` to `types.ts`; add `portionZod` (`units: .int().min(1).catch(0)`), the optional `portions` on `itemZod`, and the `.transform` downgrade to `schema.ts`. **Done:** all schema tests green; `tsc --noEmit` exit 0 (transform output assignable to `Item`); every pre-existing test (129) still passes (un-split items unchanged). **Ship value:** the wire/storage floor accepts portions and repairs malformed ones; no behavior change yet.

### Phase 2 — Split engine (the invariant)
**Tests first:** `splitBill.test.ts — portions` (worked example, single-full-portion≡un-split, orphan-excluded, late-add-treated, …) + extend `splitBill-property.test.ts` (units-conserving generator + per-line cost-conservation + downgrade case). **Then:** extract `resolveParticipants`/`allocateEqually`, branch the loop on `isPortioned`. **Done:** all current splitBill cases pass unmodified; new cases + 300-round fuzz green; nothing below `subtotal` changed. **Ship value:** portioned rounds split correctly to the cent; the hard invariant is fuzz-proven over the wider input space.

### Phase 3 — Store actions (editing)
**Tests first:** `store.test.ts — portions` (full set, incl. the `removeDiner` hot-zone outcome cases, the `removePortion` first/lone/length<2 split, the late-add and the `updateItem` value-compare guard). **Then:** add `splitItem`, `addPortion`, `setPortionUnits`, `removePortion`, `mergePortions`, `togglePortionAssignment`, `assignPortionOnly`, `assignPortionEveryone`; extend `removeDiner` and guard `updateItem`. Add the new action signatures to `StoreState.actions`. **Done:** all store tests green; `store.test.ts:33-40` (removeDiner tripwire) passes byte-identically; reversibility test passes. **Ship value:** the round can be portioned/edited programmatically and via existing wiring; safe to expose.

### Phase 4 — Workspace UI (create/edit portions)
**Tests first:** component/DOM tests — "Split into parts" gating; un-split mode byte-identical (snapshot); `splitItem` on tap; PortionEditor renders one card per portion with correct `portionTotal`; stepper calls `setPortionUnits` and the sum bar stays "covers qty of qty"; per-portion toggle materializes "everyone-except"; per-portion `Only`; `Add part` disabled per `canAddPortion`; `Remove part` only when >1; `Merge back` returns to un-split with lossy note; ItemsSection renders the worked example's 1+2+2 sublines; `PortionDots` sentinel/explicit/cap-5; ItemSheet qty caution only when portioned. **Then:** add the `Split into parts` affordance + branch in `AssignSheet`; new `PortionEditor.tsx`; `PortionDots` + subline branch in `ItemsSection`; qty caution in `ItemSheet`. **Done:** all component tests green; un-split rendering unchanged; mobile 44px audit passes. **Ship value:** the full fareware flow is usable end-to-end in the workspace.

### Phase 5 — Settle attribution + sharing (engine output extension)
**Tests first:** the FoodLine decomposition tests + `lineLabel`/`buildShareText`/`DinerCard` tests + the un-split snapshot re-baseline + the SettleSheet→ShareActions prop-threading integration test. **Then:** add `FoodLine`/`lines` to `DinerSplit` and accumulate per (item|portion, participant) in `splitBill`; new `lineLabel.ts` + `shareText.ts`; itemized rows + treated branch in `DinerCard`; **change `ShareActions` signature to accept `split` and update `SettleSheet.tsx:62` in lockstep**; share text+link. **Done:** Σ line.food === food (every invariant intact); `tsc` exit 0 (no dangling propless `<ShareActions/>`); existing settle tests pass (lines additive); share round-trip carries portions. **Ship value:** the settle screen and shared text explain "1 of 3 / shared 2 of 3" and show M paying nothing for specific items.

### Phase 6 — OCR regression lock (no production change)
**Tests only:** `mapToState.test.ts — portions` (new + extended). **Then:** none (production untouched). **Done:** OCR output proven portion-free and a valid new Item that `splitItem` can later portion. **Ship value:** the boundary is pinned so no future change silently pre-splits OCR rows.

> Phases 1→2→3 are a strict dependency chain. Phase 4 depends on 3, Phase 5 depends on 2 (and reads Phase-1 helpers). Phase 6 depends only on Phase 1. Each phase leaves the app green and shippable.

---

## 13. Risk register (flagged, mitigated)
- **removeDiner comment vs code.** The shipped `store.ts:96-104` filters only; the `store.ts:102` comment is aspirational and `store.test.ts:33-40` only covers the 2-of-3 survivor case. Mitigation: portion mirror matches the *code*; dedicated tests assert the split *outcome*, not array shape. An implementer following the comment would diverge — the tests catch it.
- **`updateItem` qty-guard silent-data-loss.** Must value-compare (`patch.qty !== it.qty`), never `'qty' in patch`. Pinned by the same-qty-preserves-portions test.
- **Orphaned-portion cents excluded, not residual-pinned.** Proof Claim 1 is scoped to "no portion orphaned"; Claim 1′ covers the orphan case via subtotal-recompute (consistent with today's all-unknown-ids item). Prevents a maintainer expecting per-line food equality in the orphan case.
- **Proof scope (the one contradiction fixed).** §5 now states the global invariant holds **by subtotal-recompute in all cases**, with per-line food equality scoped to the non-orphaned case — no longer self-contradictory with invariant 8 / §10.
- **`portionZod` reject-vs-downgrade.** Resolved with `.catch(0)` + Σ-check so a malformed portion degrades like a non-conserving one; encoded in the units:0 test; `assignedDinerIds` retained on every downgrade.
- **`cents()` throws on non-integers (`money.ts:11`).** `units` is guaranteed integer by `portionZod` + the `Math.floor` clamp in `setPortionUnits`; `unitPrice` is `centsZod`. The `Math.floor` at the store call site is the only guard against a fractional UI value reaching `portionTotal` — keep it.
- **`setPortionUnits` single-neighbour rebalance.** Conserves Σ for any 2-portion delta, but a 3+-portion middle edit never moves the far part. UX-only (Σ always holds); the units sum bar reassures.
- **Property generator must conserve by construction.** Build portions from random cut-points, not independent random units, so the test exercises the engine (not the schema downgrade). The non-conserving case routes through `parseRoundState` deliberately (adds a schema import to a previously engine-only test file — a conscious change).
- **Hot-path cost.** `removeDiner` and the schema `.transform` run on every common-path round; both early-out on `!portions`. Tripwires: `store.test.ts:33-40` and the urlhash round-trip/size tests must pass unchanged.
- **`ShareActions` signature change.** Adding a required `split` prop is breaking; `SettleSheet.tsx:62` must change in lockstep or `tsc` fails. In Phase 5 done-criteria.
- **Common-path settle-view change.** The expanded un-split `DinerCard` goes from one "Food & drink" row to one-row-per-item — intended, re-baselined by snapshot (not a regression but explicitly NOT byte-identical at the settle layer; §0.1).
- **`mergePortions` lossiness.** First portion's people win; mitigated by the inline note. A confirm step for complex splits is optional (the uncommon path), weighed against D1's no-extra-taps spirit for the *common* path.
- **Old-app reads new link.** z.object strips `portions` → graceful un-split; for the worked-example shape the degradation is "M overpays" (mis-distributed), never money lost; Σ still balances. Acceptable for a single-user local PWA per D5; documented with an explicit test.

### File-path note for implementers (corrected)
All cited **line numbers are accurate**; some directory prefixes in earlier drafts were misleading. Authoritative paths: `src/math/splitBill.ts`, `src/math/proportional.ts`, `src/math/residual.ts`, `src/math/money.ts`, `src/math/singapore.ts`, `src/state/types.ts`, `src/state/schema.ts`, `src/state/store.ts`, `src/state/urlhash.ts`, `src/state/persist.ts`, `src/features/ocr/mapToState.ts`, `src/features/ocr/types.ts`, `src/features/ocr/schema.ts`, **`src/hooks/useScan.ts`** (not `src/features/ocr/useScan.ts`), `src/features/workspace/AssignSheet.tsx`, `src/features/workspace/ItemsSection.tsx`, `src/features/workspace/ItemSheet.tsx`, `src/features/workspace/ChargesSection.tsx`, `src/features/settle/DinerCard.tsx`, `src/features/settle/ShareActions.tsx`, `src/features/settle/SettleSheet.tsx`. Test files live under `tests/unit/`.
