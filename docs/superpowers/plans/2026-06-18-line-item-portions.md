# Line-Item Portions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in per-portion bill splitting to Round so one line item can be paid by different groups — and a treated guest pays nothing for chosen items purely by absence from a portion list — without changing the un-split common path or breaking v1 share links.

**Architecture:** Additive `Item.portions?: Portion[]` (each portion = whole units + an explicit payer list, `[]`=everyone). The split engine branches on `isPortioned`, allocating each portion equally in exact cents; charges/residual stay untouched. Zod stays additive on envelope v1 with a tolerant `.transform` that downgrades a non-conserving split to un-split. The UI is a second mode of the existing AssignSheet; settle gains per-line attribution. TDD throughout; un-split behavior stays byte-identical.

**Tech Stack:** Next.js (static export) · TypeScript · Zustand+immer · Zod · vitest 4 (node env) · lz-string share links.

---

## File Structure

**Created:**
- `src/features/workspace/PortionEditor.tsx` — the portion-editing body of AssignSheet (units steppers, per-portion payer toggles, add/remove/merge).
- `src/features/workspace/portionView.ts` — pure, node-tested view helpers (e.g. `portionWho`) so rendering logic is testable without a DOM.
- `src/features/settle/lineLabel.ts` — pure label for one `FoodLine` (shared by the settle card and share text so they cannot drift).
- `src/features/settle/shareText.ts` — `buildShareText(round, split)` plain-text per-diner receipt.
- `tests/unit/portionView.test.ts` — the only new UI-logic test file (node).

**Modified:**
- `src/state/types.ts` — `Portion`, `Item.portions?`, helpers `portionTotal`/`isPortioned`/`portionedUnits`/`canAddPortion`.
- `src/state/schema.ts` — `portionZod`, optional `itemZod.portions`, tolerant `.transform` downgrade.
- `src/state/store.ts` — 8 portion actions + extended `removeDiner` + guarded `updateItem`.
- `src/math/splitBill.ts` — `isPortioned` allocation branch + `FoodLine`/`DinerSplit.lines` attribution.
- `src/features/workspace/AssignSheet.tsx` — "Split into parts" affordance + portioned-mode branch.
- `src/features/workspace/ItemsSection.tsx` — portion sublines + `PortionDots`.
- `src/features/workspace/ItemSheet.tsx` — qty-edit caution when portioned.
- `src/features/settle/DinerCard.tsx` — itemized rows + "treated — pays nothing" branch.
- `src/features/settle/ShareActions.tsx` — accepts required `split` prop.
- `src/features/settle/SettleSheet.tsx` — passes `split` to `ShareActions`.
- Test files: `tests/unit/{schema,store,splitBill,splitBill-property,urlhash,mapToState}.test.ts`.

**Phase dependency chain:** 1 → 2 → 3 (strict); 4 needs 3; 5 needs 2; 6 needs 1. Each phase leaves the suite green and the app shippable.

---

## Phase 1 — Data model + schema

### Task 1: Confirm the green baseline before touching anything

This phase is additive: un-split items must stay byte-identical and every pre-existing test must remain green with `tsc --noEmit` at exit 0. Establish that footing first so any later red is unambiguously yours. The numbers observed here (15 test files / 129 passing tests) are this phase's regression floor — record them as the starting measurement, not as a gate to re-assert after you add tests (later phases run sequentially, so the totals only grow).

**Files:**
- Modify: none (verification only)

Steps:

- [ ] Step 1: From the repo root `/Users/shin/project/local-ai-packaged/round`, run the full suite to establish the starting point.

  ```bash
  npm test
  ```

  Expected: the summary reports zero failures. At this exact starting point (before any of your changes) it reads:

  ```
   Test Files  15 passed | 1 skipped (16)
        Tests  129 passed | 45 skipped (174)
  ```

  Treat `129 passed` as the pre-phase floor: every one of those must stay green through Phase 1. Do NOT re-assert the absolute `129`/`15` total after you add new test files — your added tests legitimately raise it.

- [ ] Step 2: Confirm the type checker is clean.

  ```bash
  npm run typecheck
  ```

  Expected: the command prints nothing and exits 0. Verify the exit code:

  ```bash
  echo $?
  ```

  Expected output:

  ```
  0
  ```

- [ ] Step 3: Do NOT commit anything. This step only proves the baseline. If either command above is not clean, stop and fix the environment before proceeding — every later "see it FAIL / see it PASS" depends on this being the true baseline.

---

### Task 2: Add the `Portion` interface and `Item.portions?` field to types.ts

The data model is the foundation every later phase imports, so it lands first. We add the `Portion` shape and the optional `portions` field to `Item`. There is no behavior to test yet for these two additions alone (they are pure type declarations), so this task is verified by `tsc` staying clean — the helpers in the next task are what we drive with tests.

**Files:**
- Modify: `/Users/shin/project/local-ai-packaged/round/src/state/types.ts:12-20` (the `Item` interface) and `:43` (after `lineTotal`)

Steps:

- [ ] Step 1: Open `/Users/shin/project/local-ai-packaged/round/src/state/types.ts`. It currently begins:

  ```ts
  import { cents, type Cents } from '@/math/money'

  export type Screen = 'splash' | 'workspace' | 'settle'

  export interface Diner {
    id: string
    name: string
    /** Index into DINER_COLORS — stable per diner, reused across screens. */
    colorIdx: number
  }

  export interface Item {
    id: string
    name: string
    qty: number
    /** Price per unit; line total = qty × unitPrice. */
    unitPrice: Cents
    /** Diner ids sharing this item. `[]` is the "everyone" sentinel. */
    assignedDinerIds: string[]
  }
  ```

- [ ] Step 2: Insert the `Portion` interface immediately ABOVE the `Item` interface, and add the optional `portions` field to `Item`. Replace this exact block:

  ```ts
  export interface Item {
    id: string
    name: string
    qty: number
    /** Price per unit; line total = qty × unitPrice. */
    unitPrice: Cents
    /** Diner ids sharing this item. `[]` is the "everyone" sentinel. */
    assignedDinerIds: string[]
  }
  ```

  with:

  ```ts
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
    /** Price per unit; line total = qty × unitPrice. */
    unitPrice: Cents
    /** Today's single-group sharing. `[]` is the everyone sentinel.
     *  Used when `portions` is absent. RETAINED verbatim. */
    assignedDinerIds: string[]
    /** OPTIONAL opt-in split. When present and non-empty, OVERRIDES
     *  assignedDinerIds: the item is allocated portion-by-portion. Absent
     *  (undefined) for the common un-split case — never written for it. */
    portions?: Portion[]
  }
  ```

- [ ] Step 3: Run the type checker to confirm the additive field broke nothing.

  ```bash
  npm run typecheck
  ```

  Expected: no output, exit 0. (`portions?` is optional, so every existing construction of `Item` — in the store, OCR mapper, and tests — that omits it still typechecks.)

- [ ] Step 4: Run the full suite to confirm un-split behavior is untouched.

  ```bash
  npm test
  ```

  Expected: the summary reports zero failures and every pre-existing test still passes (un-split items are byte-identical because `portions` is absent). The total may be unchanged from the baseline since this task adds no tests; what matters is that nothing went red. If any pre-existing test failed, the additive guarantee was violated — stop and revert.

- [ ] Step 5: Commit.

  ```bash
  git add src/state/types.ts
  git commit -m "$(cat <<'EOF'
  Add Portion interface and optional Item.portions field

  Additive type-only change: Portion { units; assignedDinerIds[] } and
  Item.portions?: Portion[]. Un-split items remain byte-identical
  (portions absent => undefined). No behavior yet.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 3: Add `portionTotal` helper to types.ts (tests first)

`portionTotal(unitPrice, units)` is the exact-integer-cents cost of one portion. The split engine (Phase 2) and the portion editor UI (Phase 4) both call it, so it lands now beside `lineTotal`. We drive it with a failing test first.

**Files:**
- Create/Modify test: `/Users/shin/project/local-ai-packaged/round/tests/unit/portionHelpers.test.ts`
- Modify: `/Users/shin/project/local-ai-packaged/round/src/state/types.ts:43` (after the existing `lineTotal` export)

Steps:

- [ ] Step 1: Create the test file `/Users/shin/project/local-ai-packaged/round/tests/unit/portionHelpers.test.ts` with exactly this content (it imports a symbol that does not exist yet, so it must fail):

  ```ts
  import { describe, it, expect } from 'vitest'
  import { cents } from '@/math/money'
  import { portionTotal } from '@/state/types'

  describe('portionTotal', () => {
    it('returns units × unitPrice as exact integer cents', () => {
      expect(portionTotal(cents(1400), 2)).toBe(2800)
    })

    it('returns 0 for 0 units', () => {
      expect(portionTotal(cents(1400), 0)).toBe(0)
    })

    it('throws when units × unitPrice is not an integer', () => {
      // 1.5 × 3 = 4.5 (non-integer) → cents() throws. (NB: 1.5 × 100 = 150 is
      // an integer and would NOT throw — the product must be fractional.)
      expect(() => portionTotal(cents(3), 1.5)).toThrow()
    })
  })
  ```

- [ ] Step 2: Run just this file and watch it FAIL on the missing export.

  ```bash
  npx vitest run tests/unit/portionHelpers.test.ts
  ```

  Expected failure: Vitest reports the file as failed because `portionTotal` is not exported from `@/state/types` (a collection/import error along the lines of `portionTotal is not a function` / no matching export). The point is RED, not green.

- [ ] Step 3: Open `/Users/shin/project/local-ai-packaged/round/src/state/types.ts`. The file currently ends with:

  ```ts
  export const lineTotal = (it: Item): Cents => cents(it.qty * it.unitPrice)
  ```

  Replace that single line with:

  ```ts
  /** UNCHANGED. Portions never change what the whole line costs.
   *  Invariant: Σ(portion.units·unitPrice) === lineTotal. */
  export const lineTotal = (it: Item): Cents => cents(it.qty * it.unitPrice)

  /** Exact integer cents for one portion: units × unitPrice. New helper.
   *  Safe: `cents()` (money.ts:11) throws on non-integers, but `units` is a
   *  positive integer (portionZod + store clamps) and `unitPrice` is int. */
  export const portionTotal = (unitPrice: Cents, units: number): Cents =>
    cents(units * unitPrice)
  ```

- [ ] Step 4: Re-run the file and watch it PASS.

  ```bash
  npx vitest run tests/unit/portionHelpers.test.ts
  ```

  Expected output:

  ```
   Test Files  1 passed (1)
        Tests  3 passed (3)
  ```

- [ ] Step 5: Commit.

  ```bash
  git add src/state/types.ts tests/unit/portionHelpers.test.ts
  git commit -m "$(cat <<'EOF'
  Add portionTotal helper

  portionTotal(unitPrice, units) = cents(units * unitPrice), exact
  integer cents for one portion. Throws on a non-integer product via
  cents(), matching the money-core boundary contract.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 4: Add `isPortioned` predicate to types.ts (tests first)

`isPortioned(it)` is the single predicate every consumer branches on. `portions: []` (from a hand-rolled link) must be treated as ABSENT so the engine/UI/store fall back to `assignedDinerIds`.

**Files:**
- Modify test: `/Users/shin/project/local-ai-packaged/round/tests/unit/portionHelpers.test.ts`
- Modify: `/Users/shin/project/local-ai-packaged/round/src/state/types.ts` (after `portionTotal`)

Steps:

- [ ] Step 1: Open `/Users/shin/project/local-ai-packaged/round/tests/unit/portionHelpers.test.ts`. It currently imports:

  ```ts
  import { portionTotal } from '@/state/types'
  ```

  Replace that import line with:

  ```ts
  import { portionTotal, isPortioned, type Item } from '@/state/types'
  ```

- [ ] Step 2: Append a new `describe` block to the END of that same test file (after the existing `portionTotal` block's closing `})`):

  ```ts
  const baseItem = (over: Partial<Item> = {}): Item => ({
    id: 'i1',
    name: 'Adobo',
    qty: 3,
    unitPrice: cents(1400),
    assignedDinerIds: [],
    ...over,
  })

  describe('isPortioned', () => {
    it('is false when portions is undefined', () => {
      expect(isPortioned(baseItem())).toBe(false)
    })

    it('is false when portions is an empty array (treated as absent)', () => {
      expect(isPortioned(baseItem({ portions: [] }))).toBe(false)
    })

    it('is true when at least one portion is present', () => {
      expect(
        isPortioned(baseItem({ portions: [{ units: 3, assignedDinerIds: [] }] })),
      ).toBe(true)
    })
  })
  ```

- [ ] Step 3: Run the file and watch the new block FAIL on the missing `isPortioned` export.

  ```bash
  npx vitest run tests/unit/portionHelpers.test.ts
  ```

  Expected: the `isPortioned` describe fails with a missing-export / `isPortioned is not a function` error; the three `portionTotal` tests still pass.

- [ ] Step 4: Open `/Users/shin/project/local-ai-packaged/round/src/state/types.ts`. After the `portionTotal` export you just added, append:

  ```ts
  /** The single predicate every consumer branches on. `portions: []` (from a
   *  hand-rolled link) is treated as ABSENT, so split engine, UI and store
   *  fall back to assignedDinerIds. */
  export const isPortioned = (it: Item): boolean =>
    Array.isArray(it.portions) && it.portions.length > 0
  ```

- [ ] Step 5: Re-run the file and watch it PASS.

  ```bash
  npx vitest run tests/unit/portionHelpers.test.ts
  ```

  Expected output:

  ```
   Test Files  1 passed (1)
        Tests  6 passed (6)
  ```

- [ ] Step 6: Commit.

  ```bash
  git add src/state/types.ts tests/unit/portionHelpers.test.ts
  git commit -m "$(cat <<'EOF'
  Add isPortioned predicate

  isPortioned(it) is true only when portions is a non-empty array.
  portions:[] and portions:undefined both read as un-split, so every
  consumer falls back to assignedDinerIds — keeps the common path
  byte-identical.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 5: Add `portionedUnits` helper to types.ts (tests first)

`portionedUnits(it)` sums the units across portions; it equals `qty` exactly when the units-conservation invariant holds. The store (Phase 3) and the units-sum bar (Phase 4) read it.

**Files:**
- Modify test: `/Users/shin/project/local-ai-packaged/round/tests/unit/portionHelpers.test.ts`
- Modify: `/Users/shin/project/local-ai-packaged/round/src/state/types.ts` (after `isPortioned`)

Steps:

- [ ] Step 1: Open `/Users/shin/project/local-ai-packaged/round/tests/unit/portionHelpers.test.ts`. Update the import line that currently reads:

  ```ts
  import { portionTotal, isPortioned, type Item } from '@/state/types'
  ```

  to:

  ```ts
  import { portionTotal, isPortioned, portionedUnits, type Item } from '@/state/types'
  ```

- [ ] Step 2: Append a new `describe` block to the END of the file:

  ```ts
  describe('portionedUnits', () => {
    it('is 0 when portions is undefined', () => {
      expect(portionedUnits(baseItem())).toBe(0)
    })

    it('sums the units of all portions', () => {
      expect(
        portionedUnits(
          baseItem({
            portions: [
              { units: 1, assignedDinerIds: ['P1'] },
              { units: 2, assignedDinerIds: [] },
            ],
          }),
        ),
      ).toBe(3)
    })
  })
  ```

- [ ] Step 3: Run the file and watch the new block FAIL on the missing export.

  ```bash
  npx vitest run tests/unit/portionHelpers.test.ts
  ```

  Expected: the `portionedUnits` describe fails (missing export); the prior 6 tests still pass.

- [ ] Step 4: Open `/Users/shin/project/local-ai-packaged/round/src/state/types.ts`. After the `isPortioned` export, append:

  ```ts
  /** Units accounted for by portions. Equals qty when the invariant holds. */
  export const portionedUnits = (it: Item): number =>
    it.portions ? it.portions.reduce((a, p) => a + p.units, 0) : 0
  ```

- [ ] Step 5: Re-run the file and watch it PASS.

  ```bash
  npx vitest run tests/unit/portionHelpers.test.ts
  ```

  Expected output:

  ```
   Test Files  1 passed (1)
        Tests  8 passed (8)
  ```

- [ ] Step 6: Commit.

  ```bash
  git add src/state/types.ts tests/unit/portionHelpers.test.ts
  git commit -m "$(cat <<'EOF'
  Add portionedUnits helper

  portionedUnits(it) sums portion units (0 when un-split). Equals qty
  exactly when units-conservation holds; used by the store guards and
  the UI sum bar.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 6: Add `canAddPortion` helper to types.ts (tests first)

`canAddPortion(it)` is the UI-queryable mirror of `addPortion`'s no-op condition: a new slice can be carved only if some portion has ≥2 units to spare. Colocated here so the disabled-state logic stays out of the component (Phase 4).

**Files:**
- Modify test: `/Users/shin/project/local-ai-packaged/round/tests/unit/portionHelpers.test.ts`
- Modify: `/Users/shin/project/local-ai-packaged/round/src/state/types.ts` (after `portionedUnits`)

Steps:

- [ ] Step 1: Open `/Users/shin/project/local-ai-packaged/round/tests/unit/portionHelpers.test.ts`. Update the import line that currently reads:

  ```ts
  import { portionTotal, isPortioned, portionedUnits, type Item } from '@/state/types'
  ```

  to:

  ```ts
  import {
    portionTotal,
    isPortioned,
    portionedUnits,
    canAddPortion,
    type Item,
  } from '@/state/types'
  ```

- [ ] Step 2: Append a new `describe` block to the END of the file:

  ```ts
  describe('canAddPortion', () => {
    it('is false when the item is un-split', () => {
      expect(canAddPortion(baseItem())).toBe(false)
    })

    it('is true when some portion has >= 2 units to spare', () => {
      expect(
        canAddPortion(
          baseItem({
            portions: [
              { units: 1, assignedDinerIds: ['P1'] },
              { units: 2, assignedDinerIds: [] },
            ],
          }),
        ),
      ).toBe(true)
    })

    it('is false when every portion is exactly 1 unit (fully fragmented)', () => {
      expect(
        canAddPortion(
          baseItem({
            qty: 2,
            portions: [
              { units: 1, assignedDinerIds: ['P1'] },
              { units: 1, assignedDinerIds: ['P2'] },
            ],
          }),
        ),
      ).toBe(false)
    })
  })
  ```

- [ ] Step 3: Run the file and watch the new block FAIL on the missing export.

  ```bash
  npx vitest run tests/unit/portionHelpers.test.ts
  ```

  Expected: the `canAddPortion` describe fails (missing export); the prior 8 tests still pass.

- [ ] Step 4: Open `/Users/shin/project/local-ai-packaged/round/src/state/types.ts`. After the `portionedUnits` export, append:

  ```ts
  /** UI-queryable mirror of addPortion's no-op condition: a portion can be
   *  carved only if some portion has >=2 units to spare. Colocated so the
   *  disabled-state logic stays out of the component. */
  export const canAddPortion = (it: Item): boolean =>
    isPortioned(it) && it.portions!.some((p) => p.units >= 2)
  ```

- [ ] Step 5: Re-run the file and watch it PASS.

  ```bash
  npx vitest run tests/unit/portionHelpers.test.ts
  ```

  Expected output:

  ```
   Test Files  1 passed (1)
        Tests  11 passed (11)
  ```

- [ ] Step 6: Run the type checker to confirm all five helpers are well-typed.

  ```bash
  npm run typecheck
  ```

  Expected: no output, exit 0.

- [ ] Step 7: Commit.

  ```bash
  git add src/state/types.ts tests/unit/portionHelpers.test.ts
  git commit -m "$(cat <<'EOF'
  Add canAddPortion helper

  canAddPortion(it) is true only for a portioned item where some
  portion has >=2 units to spare — the UI mirror of addPortion's no-op
  condition. types.ts now defines the full helper set.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 7: Add `portionZod` and optional `portions` on `itemZod`, with `units:0` coercion (tests first)

The schema is the trust boundary into the store (share links + IndexedDB drafts). We add `portionZod` (`units: int().min(1).catch(0)`) and make `itemZod.portions` optional. We do NOT yet add the downgrade `.transform` — that is the next task. This task proves: (a) a conserving portioned item parses and keeps its portions, (b) a `units:0` malformed portion is coerced to 0 (not thrown), and (c) old payloads with no portions still parse. We add the test cases incrementally so each red→green is one schema change.

**Files:**
- Create test: `/Users/shin/project/local-ai-packaged/round/tests/unit/schemaPortions.test.ts`
- Modify: `/Users/shin/project/local-ai-packaged/round/src/state/schema.ts:19-25` (the `itemZod` object) and a new `portionZod` export above it

Steps:

- [ ] Step 1: Create `/Users/shin/project/local-ai-packaged/round/tests/unit/schemaPortions.test.ts` with this content. It builds a valid base round and overrides `items`. The first three cases below exercise only the optional field + `.catch(0)` (no downgrade yet):

  ```ts
  import { describe, it, expect } from 'vitest'
  import { parseRoundState } from '@/state/schema'

  type AnyItem = Record<string, unknown>

  const baseRound = (items: AnyItem[]): Record<string, unknown> => ({
    venue: 'X',
    diners: [],
    items,
    discount: 0,
    servicePct: 0.1,
    gstPct: 0.09,
    rounding: 0,
    scan: null,
    scannedTotal: null,
  })

  const item = (over: AnyItem = {}): AnyItem => ({
    id: 'i1',
    name: 'Adobo',
    qty: 3,
    unitPrice: 1400,
    assignedDinerIds: ['P1', 'P2'],
    ...over,
  })

  describe('roundStateZod — portions: optional field + units coercion', () => {
    it('parses a conserving portioned item and keeps its portions', () => {
      const parsed = parseRoundState(
        baseRound([
          item({
            portions: [
              { units: 1, assignedDinerIds: ['P1'] },
              { units: 2, assignedDinerIds: ['P1', 'P2', 'P3'] },
            ],
          }),
        ]),
      )
      expect(parsed).not.toBeNull()
      expect(parsed!.items[0]!.portions).toEqual([
        { units: 1, assignedDinerIds: ['P1'] },
        { units: 2, assignedDinerIds: ['P1', 'P2', 'P3'] },
      ])
    })

    it('coerces a units:0 portion to 0 rather than throwing (catch(0))', () => {
      const parsed = parseRoundState(
        baseRound([
          item({
            portions: [
              { units: 0, assignedDinerIds: ['P1'] },
              { units: 3, assignedDinerIds: ['P2'] },
            ],
          }),
        ]),
      )
      // No downgrade transform yet, so portions survive but units is coerced to 0.
      expect(parsed).not.toBeNull()
      expect(parsed!.items[0]!.portions![0]!.units).toBe(0)
    })

    it('tolerates unknown assignee ids in a portion (no existence check)', () => {
      const parsed = parseRoundState(
        baseRound([
          item({
            qty: 3,
            portions: [{ units: 3, assignedDinerIds: ['ghost-id'] }],
          }),
        ]),
      )
      expect(parsed).not.toBeNull()
      expect(parsed!.items[0]!.portions![0]!.assignedDinerIds).toEqual(['ghost-id'])
    })
  })
  ```

- [ ] Step 2: Run the file and watch it FAIL. With `itemZod` having no `portions` key, zod's `z.object` strips it, so `parsed!.items[0]!.portions` is `undefined` and the first assertion fails.

  ```bash
  npx vitest run tests/unit/schemaPortions.test.ts
  ```

  Expected failure (first case):

  ```
  AssertionError: expected undefined to deeply equal [ { units: 1, … } ]
  ```

- [ ] Step 3: Open `/Users/shin/project/local-ai-packaged/round/src/state/schema.ts`. It currently has, after `dinerZod`:

  ```ts
  export const itemZod = z.object({
    id: z.string().min(1),
    name: z.string(),
    qty: z.number().int().min(1),
    unitPrice: centsZod,
    assignedDinerIds: z.array(z.string()),
  })
  ```

  Replace that block with (adds `portionZod` above and the optional `portions` field — NO transform yet):

  ```ts
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

  export const itemZod = z.object({
    id: z.string().min(1),
    name: z.string(),
    qty: z.number().int().min(1),
    unitPrice: centsZod,
    assignedDinerIds: z.array(z.string()),
    /** OPTIONAL — absent in every v1 link, draft, and OCR output, which all
     *  parse unchanged (no `.default()`, so the key stays `undefined`). */
    portions: z.array(portionZod).optional(),
  })
  ```

- [ ] Step 4: Re-run the file and watch all three cases PASS.

  ```bash
  npx vitest run tests/unit/schemaPortions.test.ts
  ```

  Expected output:

  ```
   Test Files  1 passed (1)
        Tests  3 passed (3)
  ```

- [ ] Step 5: Run the type checker. Adding an optional field to `itemZod` does not change its inferred output shape incompatibly (`portions?: ... | undefined` is assignable to `Item.portions?`), so the `r.data as RoundState` cast in `parseRoundState` (`schema.ts:48`) still typechecks.

  ```bash
  npm run typecheck
  ```

  Expected: no output, exit 0.

- [ ] Step 6: Commit.

  ```bash
  git add src/state/schema.ts tests/unit/schemaPortions.test.ts
  git commit -m "$(cat <<'EOF'
  Add portionZod and optional itemZod.portions

  portionZod coerces a bad units to 0 via .catch(0) (never throws);
  itemZod.portions is optional with no default, so v1 links/drafts/OCR
  parse unchanged. No downgrade transform yet.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 8: Add the `.transform` downgrade to `itemZod` (over/under-alloc, units:0, portions:[], assignedDinerIds retained) — tests first

This is the heart of §3: a structurally valid but inconsistent split is DOWNGRADED to un-split (portions dropped) rather than rejected, with `assignedDinerIds` ALWAYS retained. `portions: []` is normalized to absent. We add every spec §11 downgrade case as failing tests first, then add the transform.

**Files:**
- Modify test: `/Users/shin/project/local-ai-packaged/round/tests/unit/schemaPortions.test.ts`
- Modify: `/Users/shin/project/local-ai-packaged/round/src/state/schema.ts` (append `.transform` to `itemZod`)

Steps:

- [ ] Step 1: Open `/Users/shin/project/local-ai-packaged/round/tests/unit/schemaPortions.test.ts`. The case from the previous task that asserted a `units:0` portion *survives* must now be UPDATED to assert it *downgrades*. Find this exact block:

  ```ts
    it('coerces a units:0 portion to 0 rather than throwing (catch(0))', () => {
      const parsed = parseRoundState(
        baseRound([
          item({
            portions: [
              { units: 0, assignedDinerIds: ['P1'] },
              { units: 3, assignedDinerIds: ['P2'] },
            ],
          }),
        ]),
      )
      // No downgrade transform yet, so portions survive but units is coerced to 0.
      expect(parsed).not.toBeNull()
      expect(parsed!.items[0]!.portions![0]!.units).toBe(0)
    })
  ```

  and replace it with:

  ```ts
    it('downgrades a units:0 portion to un-split, retaining assignedDinerIds', () => {
      // catch(0) makes Σ units = 0 + 3 = 3, but item.qty here is 4 → non-conserving → downgrade.
      const parsed = parseRoundState(
        baseRound([
          item({
            qty: 4,
            assignedDinerIds: ['P1', 'P2'],
            portions: [
              { units: 0, assignedDinerIds: ['P1'] },
              { units: 3, assignedDinerIds: ['P2'] },
            ],
          }),
        ]),
      )
      expect(parsed).not.toBeNull()
      expect(parsed!.items[0]!.portions).toBeUndefined()
      expect('portions' in parsed!.items[0]!).toBe(false)
      expect(parsed!.items[0]!.assignedDinerIds).toEqual(['P1', 'P2'])
    })
  ```

- [ ] Step 2: Append a new `describe` block to the END of the test file covering the over-alloc, under-alloc, `portions: []`, absent-portions, and conserving-survives cases — each asserting `assignedDinerIds` is retained where relevant:

  ```ts
  describe('roundStateZod — portions: .transform downgrade', () => {
    it('over-allocating (Σ units > qty) downgrades to un-split, retaining assignedDinerIds', () => {
      const parsed = parseRoundState(
        baseRound([
          item({
            qty: 3,
            assignedDinerIds: ['P1', 'P2'],
            portions: [
              { units: 2, assignedDinerIds: ['P1'] },
              { units: 2, assignedDinerIds: ['P2'] },
            ],
          }),
        ]),
      )
      expect(parsed).not.toBeNull()
      expect(parsed!.items[0]!.portions).toBeUndefined()
      expect('portions' in parsed!.items[0]!).toBe(false)
      expect(parsed!.items[0]!.assignedDinerIds).toEqual(['P1', 'P2'])
    })

    it('under-allocating (Σ units < qty) downgrades to un-split, retaining assignedDinerIds', () => {
      const parsed = parseRoundState(
        baseRound([
          item({
            qty: 3,
            assignedDinerIds: ['P3'],
            portions: [{ units: 1, assignedDinerIds: ['P1'] }],
          }),
        ]),
      )
      expect(parsed).not.toBeNull()
      expect(parsed!.items[0]!.portions).toBeUndefined()
      expect('portions' in parsed!.items[0]!).toBe(false)
      expect(parsed!.items[0]!.assignedDinerIds).toEqual(['P3'])
    })

    it('portions: [] is normalized to absent (no own-property), assignedDinerIds retained', () => {
      const parsed = parseRoundState(
        baseRound([item({ qty: 3, assignedDinerIds: ['P1'], portions: [] })]),
      )
      expect(parsed).not.toBeNull()
      expect(parsed!.items[0]!.portions).toBeUndefined()
      expect('portions' in parsed!.items[0]!).toBe(false)
      expect(parsed!.items[0]!.assignedDinerIds).toEqual(['P1'])
    })

    it('a conserving portioned item (Σ units === qty) survives the transform unchanged', () => {
      const parsed = parseRoundState(
        baseRound([
          item({
            qty: 3,
            portions: [
              { units: 1, assignedDinerIds: ['P1'] },
              { units: 2, assignedDinerIds: ['P1', 'P2', 'P3'] },
            ],
          }),
        ]),
      )
      expect(parsed).not.toBeNull()
      expect(parsed!.items[0]!.portions).toEqual([
        { units: 1, assignedDinerIds: ['P1'] },
        { units: 2, assignedDinerIds: ['P1', 'P2', 'P3'] },
      ])
    })

    it('an item with no portions key parses byte-identically (no portions own-property)', () => {
      const parsed = parseRoundState(
        baseRound([item({ qty: 3, assignedDinerIds: ['P1', 'P2'] })]),
      )
      expect(parsed).not.toBeNull()
      expect('portions' in parsed!.items[0]!).toBe(false)
      expect(parsed!.items[0]!.assignedDinerIds).toEqual(['P1', 'P2'])
    })
  })
  ```

- [ ] Step 3: Run the file and watch the new/updated downgrade cases FAIL. With no transform, `portions` is retained verbatim, so every `expect(...portions).toBeUndefined()` fails.

  ```bash
  npx vitest run tests/unit/schemaPortions.test.ts
  ```

  Expected failure (representative):

  ```
  AssertionError: expected [ { units: 2, … }, { units: 2, … } ] to be undefined
  ```

- [ ] Step 4: Open `/Users/shin/project/local-ai-packaged/round/src/state/schema.ts`. The `itemZod` currently ends:

  ```ts
  export const itemZod = z.object({
    id: z.string().min(1),
    name: z.string(),
    qty: z.number().int().min(1),
    unitPrice: centsZod,
    assignedDinerIds: z.array(z.string()),
    /** OPTIONAL — absent in every v1 link, draft, and OCR output, which all
     *  parse unchanged (no `.default()`, so the key stays `undefined`). */
    portions: z.array(portionZod).optional(),
  })
  ```

  Append the `.transform` directly to that `z.object({...})` so the whole declaration becomes:

  ```ts
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
  ```

- [ ] Step 5: Re-run the file and watch every case PASS (the 3 field/coercion cases from the prior task, now 2 of them in their updated downgrade form, plus the 5 new transform cases).

  ```bash
  npx vitest run tests/unit/schemaPortions.test.ts
  ```

  Expected output:

  ```
   Test Files  1 passed (1)
        Tests  8 passed (8)
  ```

- [ ] Step 6: Run the type checker. The transform now has two return branches — `{...rest}` (portions omitted) and `it` (portions present). The first is structurally `Item` minus `portions` (so `portions` is `undefined`), the second is `Item` with `portions`; both are assignable to `Item`, so `r.data as RoundState` (`schema.ts:48`) still typechecks. This is the §3 "type-safety note" done criterion.

  ```bash
  npm run typecheck
  ```

  Expected: no output, exit 0.

- [ ] Step 7: Commit.

  ```bash
  git add src/state/schema.ts tests/unit/schemaPortions.test.ts
  git commit -m "$(cat <<'EOF'
  Add itemZod .transform downgrade for non-conserving portions

  A units-non-conserving (Σ units !== qty) or empty/absent portions
  array is downgraded to un-split at the boundary — portions dropped,
  assignedDinerIds always retained. Never rejects the round.
  tsc stays clean (both transform branches assignable to Item).

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 9: Spec §11 migration — an OLD reader stripping the `portions` key bills everyone (including treated diner M), money conserved (tests first)

Spec §11 / §9 risk row "Old (pre-feature) app reads a new portioned link": an OLD app's reader is a `z.object` that strips unknown keys, so it silently drops the `portions` field from each item. The item then falls back to its item-level `assignedDinerIds`. For a line that was portioned specifically to EXCLUDE a treated diner M (M's portion had M absent), dropping portions means M is folded back into the whole-line split via the item's `assignedDinerIds: []` ("everyone") sentinel — so M is billed a non-zero share and OVERPAYS, but no money is lost: Σ per-diner totals still equals `grandTotal`. We prove the graceful degradation by SIMULATING the old reader: take a portioned round, `structuredClone` it, `delete` the `portions` key on every item, then run the EXISTING un-split `splitBill` (already in the codebase pre-Phase-2 — it reads only `assignedDinerIds`, so stripping portions yields plain un-split items it handles natively). This needs no forward reference to the Phase-2 portion-aware engine because the stripped items ARE un-split.

**Files:**
- Modify test: `/Users/shin/project/local-ai-packaged/round/tests/unit/schemaPortions.test.ts`

Steps:

- [ ] Step 1: Open `/Users/shin/project/local-ai-packaged/round/tests/unit/schemaPortions.test.ts`. Add these two imports at the TOP of the file, immediately after the existing `import { parseRoundState } from '@/state/schema'` line:

  ```ts
  import { cents } from '@/math/money'
  import { splitBill } from '@/math/splitBill'
  import type { RoundState } from '@/state/types'
  ```

- [ ] Step 2: Append a new `describe` block to the END of the file. It builds a portioned round where item "wine" is split so the treated diner `M` is excluded from paying (his portion lists only `H`), simulates the old strip-unknown-keys reader by `structuredClone` + `delete it.portions`, then runs `splitBill` and asserts (a) Σ per-diner totals === `grandTotal` (no money lost) and (b) `M` is billed a non-zero share (he was folded back into the everyone split and now OVERPAYS):

  ```ts
  describe('roundStateZod — §11 old reader strips portions (graceful degrade)', () => {
    it('dropping portions bills everyone incl. treated M; per-diner totals still sum to grandTotal', () => {
      // A NEW portioned round: M was deliberately excluded from the wine via portions.
      const portionedRound: RoundState = {
        venue: 'Cellar',
        diners: [
          { id: 'H', name: 'Host', colorIdx: 0 },
          { id: 'M', name: 'Treated', colorIdx: 1 },
          { id: 'G', name: 'Guest', colorIdx: 2 },
        ],
        items: [
          // shared by everyone (the [] sentinel) — unaffected by the strip
          { id: 'food', name: 'Set Dinner', qty: 3, unitPrice: cents(3000), assignedDinerIds: [] },
          // 2 bottles, portioned so M pays for NONE of it (both portions exclude M)
          {
            id: 'wine',
            name: 'Wine',
            qty: 2,
            unitPrice: cents(6000),
            assignedDinerIds: [], // item-level "everyone" — the fallback the old reader uses
            portions: [
              { units: 1, assignedDinerIds: ['H'] },
              { units: 1, assignedDinerIds: ['H', 'G'] },
            ],
          },
        ],
        discount: cents(0),
        servicePct: 0.1,
        gstPct: 0.09,
        rounding: cents(0),
        scan: null,
        scannedTotal: null,
      }

      // Simulate the OLD app's z.object reader, which strips the unknown `portions` key.
      const asOldReaderSees = structuredClone(portionedRound)
      for (const it of asOldReaderSees.items) {
        delete (it as { portions?: unknown }).portions
      }
      // Sanity: the strip really happened — no item carries portions anymore.
      expect(asOldReaderSees.items.every((it) => !('portions' in it))).toBe(true)

      const s = splitBill(asOldReaderSees)

      // (a) Money is never lost: per-diner totals sum exactly to the grand total.
      const sumOfTotals = s.perDiner.reduce<number>((a, d) => a + d.total, 0)
      expect(sumOfTotals).toBe(s.breakdown.grandTotal)

      // (b) M was folded back into the wine via the [] sentinel and OVERPAYS:
      //     he is now billed a non-zero share instead of the $0 the portions intended.
      const m = s.perDiner.find((d) => d.dinerId === 'M')!
      expect(m.food).toBeGreaterThan(0)
      expect(m.total).toBeGreaterThan(0)
    })
  })
  ```

- [ ] Step 3: Run the file. This case must PASS immediately — `splitBill` already exists and reads only `assignedDinerIds`; the stripped items are plain un-split, so the wine's `[]` sentinel splits both bottles across all three diners (M included), and the engine's largest-remainder allocation guarantees Σ totals === grandTotal. It is a graceful-degradation pin, not a red→green.

  ```bash
  npx vitest run tests/unit/schemaPortions.test.ts
  ```

  Expected output (the 8 prior cases in this file plus the 1 new = 9):

  ```
   Test Files  1 passed (1)
        Tests  9 passed (9)
  ```

  If `M.food` were 0, the strip would NOT have folded M back in — meaning the old reader is somehow honoring portions, which is impossible; stop and investigate. If `sumOfTotals !== grandTotal`, money was lost — a regression in the engine's conservation invariant; stop.

- [ ] Step 4: Commit.

  ```bash
  git add tests/unit/schemaPortions.test.ts
  git commit -m "$(cat <<'EOF'
  Pin §11 old-reader graceful degradation case

  Simulate an old app's strip-unknown-keys reader (structuredClone +
  delete portions): items fall back to assignedDinerIds, treated diner
  M is folded back into the everyone split and overpays, but Σ per-diner
  totals still equals grandTotal — money is never lost.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 10: Pin the combined backward-compat case in schema.test.ts (tests first)

§11 requires one explicit case in the EXISTING `tests/unit/schema.test.ts` proving an old round with no portions AND no rounding AND no scannedTotal still parses — the combined-compat canary that lives alongside the existing `scannedTotal` compat test. We add it to the existing file (not the new one) so it sits with its siblings.

**Files:**
- Modify test: `/Users/shin/project/local-ai-packaged/round/tests/unit/schema.test.ts:52-69` (the existing `roundStateZod — scannedTotal compatibility` describe)

Steps:

- [ ] Step 1: Open `/Users/shin/project/local-ai-packaged/round/tests/unit/schema.test.ts`. It currently has this describe block:

  ```ts
  describe('roundStateZod — scannedTotal compatibility', () => {
    it('old drafts and share links without scannedTotal stay valid', async () => {
      const { parseRoundState } = await import('@/state/schema')
      const legacy = {
        venue: 'X',
        diners: [],
        items: [],
        discount: 0,
        servicePct: 0.1,
        gstPct: 0.09,
        rounding: 0,
        scan: null,
      }
      const parsed = parseRoundState(legacy)
      expect(parsed).not.toBeNull()
      expect(parsed!.scannedTotal).toBeNull()
    })
  })
  ```

  Add a second `it` inside that SAME describe block, immediately after the existing one (before the describe's closing `})`):

  ```ts
    it('old round with no portions / rounding / scannedTotal still parses, items portion-free', async () => {
      const { parseRoundState } = await import('@/state/schema')
      const legacy = {
        venue: 'Jumbo',
        diners: [{ id: 'd1', name: 'Shin', colorIdx: 0 }],
        items: [
          { id: 'i1', name: 'Chilli Crab', qty: 1, unitPrice: 8800, assignedDinerIds: [] },
        ],
        discount: 0,
        servicePct: 0.1,
        gstPct: 0.09,
        scan: null,
      }
      const parsed = parseRoundState(legacy)
      expect(parsed).not.toBeNull()
      expect(parsed!.rounding).toBe(0)
      expect(parsed!.scannedTotal).toBeNull()
      expect('portions' in parsed!.items[0]!).toBe(false)
      expect(parsed!.items[0]!.assignedDinerIds).toEqual([])
    })
  ```

- [ ] Step 2: Run the file. This case should PASS immediately because the schema already handles all three defaulted/absent fields — it is a regression-pin for the additive guarantee, not a red→green. The existing 8 tests in this file plus the 1 new make 9. Confirm zero failures:

  ```bash
  npx vitest run tests/unit/schema.test.ts
  ```

  Expected output:

  ```
   Test Files  1 passed (1)
        Tests  9 passed (9)
  ```

  If this case had instead failed, that would mean the additive guarantee is broken — stop and investigate before continuing.

- [ ] Step 3: Commit.

  ```bash
  git add tests/unit/schema.test.ts
  git commit -m "$(cat <<'EOF'
  Pin combined no-portions/rounding/scannedTotal compat case

  Regression canary: an old round missing portions, rounding, and
  scannedTotal parses, items stay portion-free. Lives beside the
  existing scannedTotal compat test.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 11: Phase 1 done — full suite green and typecheck clean

Final gate for Phase 1. The wire/storage floor now accepts portions and repairs malformed ones; un-split items are byte-identical; no engine/store/UI behavior has changed yet.

**Files:**
- Modify: none (verification only)

Steps:

- [ ] Step 1: Run the full test suite.

  ```bash
  npm test
  ```

  Expected: the summary reports zero failures. Confirm specifically that:
  - every test that existed at the start of Phase 1 (the 129-test pre-phase floor) is still green — un-split items are unchanged; and
  - the NEW tests this phase added all pass: the 11 in `tests/unit/portionHelpers.test.ts`, the 9 in `tests/unit/schemaPortions.test.ts` (8 schema cases + the §11 old-reader case), and the +1 added to `tests/unit/schema.test.ts`.

  Do NOT gate on an absolute file/test total — phases run sequentially and the count only grows. The pass/fail signal is "zero failures AND the named new tests are present and green." If any pre-existing test went red, the additive guarantee was violated; stop and fix.

- [ ] Step 2: Run the type checker — the §3 done criterion (transform output assignable to `Item`).

  ```bash
  npm run typecheck
  ```

  Expected: no output. Verify exit 0:

  ```bash
  echo $?
  ```

  Expected output:

  ```
  0
  ```

- [ ] Step 3: Confirm a clean tree (every change already committed across the prior tasks).

  ```bash
  git status --short
  ```

  Expected output: empty (no uncommitted changes). Phase 1 is complete and shippable.

---

## Phase 2 — Split math engine (the invariant)

### Task 12: Failing acceptance test — the worked fareware scenario

This is THE acceptance test for the engine: Snapper shared by everyone + Adobo (solo P1 | shared-except-M) + Chicken (solo P2 | shared-except-M), with SG service+GST. It fails first because `splitBill` does not yet branch on `isPortioned` — today it reads `item.assignedDinerIds` (which is `[]` = everyone) and ignores `portions`, so M is wrongly billed for Adobo/Chicken and every per-diner number is off.

Prerequisite from Phase 1 (already landed): `src/state/types.ts` exports `interface Portion { units: number; assignedDinerIds: string[] }`, `Item.portions?: Portion[]`, `isPortioned(it)`, and `portionTotal(unitPrice, units)`. If `npx tsc --noEmit` errors on a missing `Portion`/`portions`/`isPortioned`/`portionTotal`, stop — Phase 1 is not in place and Phase 2 cannot proceed.

**Files:**
- Test: `tests/unit/splitBill.test.ts` (Modify — append a new `describe('splitBill — portions', …)` after the existing `describe('splitBill — rounding line', …)` block that ends at line 116)

- [ ] Step 1: Open `tests/unit/splitBill.test.ts`. The existing header (lines 1-29) already imports `cents`, `splitBill`, types `Diner, Item, RoundState`, and defines the `diner`, `item`, `round`, and `total` helpers. The existing `item()` factory at lines 7-13 produces only un-split items. Append this new describe block to the END of the file (after the closing `})` of the rounding-line describe on line 116). Note the local `portioned()` factory — it builds an `Item` carrying `portions`, which the file's `item()` helper cannot:

```ts

describe('splitBill — portions', () => {
  // Local factory: an Item carrying explicit portions (the file's `item()`
  // helper only builds un-split items). qty/unitPrice given; item-level
  // assignedDinerIds is dormant when portioned, so default it to [].
  const portioned = (
    id: string,
    unitPrice: number,
    qty: number,
    portions: { units: number; assignedDinerIds: string[] }[],
  ): Item => ({
    id,
    name: id,
    qty,
    unitPrice: cents(unitPrice),
    assignedDinerIds: [],
    portions,
  })

  it('the worked fareware scenario: P1/P2/P3 pay, M is treated on Adobo + Chicken', () => {
    const state = round({
      diners: [diner('P1'), diner('P2'), diner('P3'), diner('M')],
      items: [
        // 5× Snapper @ 1800 — un-split, everyone (M DOES pay a share here)
        item('snapper', 1800, 5, []),
        // 3× Adobo @ 1400 — 1u solo P1, 2u shared P1/P2/P3 (M excluded)
        portioned('adobo', 1400, 3, [
          { units: 1, assignedDinerIds: ['P1'] },
          { units: 2, assignedDinerIds: ['P1', 'P2', 'P3'] },
        ]),
        // 3× Chicken @ 1000 — 1u solo P2, 2u shared P1/P2/P3 (M excluded)
        portioned('chicken', 1000, 3, [
          { units: 1, assignedDinerIds: ['P2'] },
          { units: 2, assignedDinerIds: ['P1', 'P2', 'P3'] },
        ]),
      ],
    })
    const s = splitBill(state)

    const food = (id: string) => s.perDiner.find((d) => d.dinerId === id)!.food
    const tot = (id: string) => s.perDiner.find((d) => d.dinerId === id)!.total

    // Per-diner food (verified numerically against distributeProportionally):
    //   Snapper 9000/4 = [2250,2250,2250,2250]
    //   Adobo A 1400→P1; Adobo B 2800/[1,1,1]=[934,933,933]
    //   Chicken A 1000→P2; Chicken B 2000/[1,1,1]=[667,667,666]
    expect(food('P1')).toBe(2250 + 1400 + 934 + 667) // 5251
    expect(food('P2')).toBe(2250 + 933 + 1000 + 667) // 4850
    expect(food('P3')).toBe(2250 + 933 + 666) // 3849
    expect(food('M')).toBe(2250) // Snapper only

    // subtotal 16200 → service 1620 → gst 1604 → grand 19424
    expect(s.breakdown.subtotal).toBe(16200)
    expect(s.breakdown.grandTotal).toBe(19424)

    // Per-diner totals and THE invariant
    expect(tot('P1')).toBe(6296)
    expect(tot('P2')).toBe(5815)
    expect(tot('P3')).toBe(4615)
    expect(tot('M')).toBe(2698)
    expect(total(s)).toBe(19424)
    expect(total(s)).toBe(s.breakdown.grandTotal)
  })
})
```

- [ ] Step 2: Run the new test and watch it FAIL. The engine still bills M for Adobo/Chicken via the `[]` everyone sentinel on `item.assignedDinerIds`:

  ```
  npx vitest run tests/unit/splitBill.test.ts -t "the worked fareware scenario: P1/P2/P3 pay, M is treated on Adobo + Chicken"
  ```

  Expected output (a real assertion failure, NOT a compile error — if you see "Cannot find name 'Portion'" or a `portions` type error, Phase 1 is missing; stop):

  ```
   FAIL  tests/unit/splitBill.test.ts > splitBill — portions > the worked fareware scenario: P1/P2/P3 pay, M is treated on Adobo + Chicken
  AssertionError: expected 4825 to be 5251 // Object.is equality
   - Expected
   + Received
   - 5251
   + 4825
  ```

  (M is wrongly given Adobo/Chicken shares, so every food/total differs from the proven values. The exact "Received" number is unimportant — what matters is that it is NOT 5251 and the test fails on a real assertion.)

- [ ] Step 3: Do NOT commit. The next task makes this pass by branching the engine on `isPortioned`.

### Task 13: Branch the per-item loop on isPortioned (minimal impl, all regression tests intact)

Extract the existing sentinel-resolution + accumulate into two module-local helpers, then branch the per-item loop: portioned items distribute each portion's `portionTotal(unitPrice, units)` equally across resolved participants; un-split items keep today's exact path. Everything below `subtotal` (`applyCharges`, the three charge distributions, `distributeResidual`) is byte-identical — portions only redistribute which diner pays which food.

**Files:**
- Modify: `src/math/splitBill.ts` — import line `:5`, add helpers before `splitBill`, replace loop body `:42-56`
- Test: `tests/unit/splitBill.test.ts` (already written in the previous task; this task makes it pass and re-runs the regression cases)

- [ ] Step 1: In `src/math/splitBill.ts`, replace the type import on line 5. Current:

  ```ts
  import { lineTotal, type RoundState } from '@/state/types'
  ```

  Replace with (adds `portionTotal`, `isPortioned`, and the `Diner` type for the helper signature):

  ```ts
  import { lineTotal, portionTotal, isPortioned, type Diner, type RoundState } from '@/state/types'
  ```

- [ ] Step 2: Insert the two module-local helpers immediately before the `export function splitBill(` declaration on line 37. Place them after the `BillSplit` interface's closing `}` on line 35 and before line 37:

  ```ts
  // `[]` → everyone; else the explicit ids that still exist. Identical rule at
  // item and portion level (sentinel-meaning-identical invariant). The []-check
  // is BEFORE the filter, so literal-[] (everyone) and all-unknown-after-filter
  // ([] → skip) are correctly distinct.
  function resolveParticipants(
    assigned: string[],
    diners: Diner[],
    idx: Map<string, number>,
  ): string[] {
    return assigned.length === 0
      ? diners.map((d) => d.id)
      : assigned.filter((id) => idx.has(id))
  }

  // Split an exact-cent cost equally across participants (largest remainder) and
  // accumulate into food[]. Empty participants → deposit nothing (orphan/skip),
  // exactly like today's continue.
  function allocateEqually(
    cost: Cents,
    participants: string[],
    idx: Map<string, number>,
    food: Cents[],
  ): void {
    if (participants.length === 0) return
    const shares = distributeProportionally(
      cost,
      participants.map(() => 1),
    )
    participants.forEach((id, k) => {
      const i = idx.get(id)!
      food[i] = addC(food[i]!, shares[k]!)
    })
  }
  ```

- [ ] Step 3: Replace the per-item allocation loop. The current loop is lines 42-56:

  ```ts
    for (const item of items) {
      const participants =
        item.assignedDinerIds.length === 0
          ? diners.map((d) => d.id)
          : item.assignedDinerIds.filter((id) => idx.has(id))
      if (participants.length === 0) continue
      const shares = distributeProportionally(
        lineTotal(item),
        participants.map(() => 1),
      )
      participants.forEach((id, k) => {
        const i = idx.get(id)!
        food[i] = addC(food[i]!, shares[k]!)
      })
    }
  ```

  Replace it with:

  ```ts
    for (const item of items) {
      if (isPortioned(item)) {
        // Σ(portion.units·unitPrice) === lineTotal (units conservation, enforced
        // by store + schema), so when no portion is orphaned the line's total food
        // is unchanged — only WHO absorbs WHICH units differs.
        for (const p of item.portions!) {
          const cost = portionTotal(item.unitPrice, p.units)
          allocateEqually(cost, resolveParticipants(p.assignedDinerIds, diners, idx), idx, food)
        }
      } else {
        // Un-split path — byte-identical to today.
        allocateEqually(
          lineTotal(item),
          resolveParticipants(item.assignedDinerIds, diners, idx),
          idx,
          food,
        )
      }
    }
  ```

- [ ] Step 4: Run the acceptance test and watch it PASS:

  ```
  npx vitest run tests/unit/splitBill.test.ts -t "the worked fareware scenario: P1/P2/P3 pay, M is treated on Adobo + Chicken"
  ```

  Expected output (the named test now passes; the summary line counts only the `-t`-filtered test):

  ```
   ✓ tests/unit/splitBill.test.ts > splitBill — portions > the worked fareware scenario: P1/P2/P3 pay, M is treated on Adobo + Chicken
   Test Files  1 passed (1)
        Tests  1 passed (1)
  ```

- [ ] Step 5: Run the FULL `splitBill.test.ts` file to prove every pre-existing un-split case (Jumbo Seafood `:32-57`, everyone-sentinel `:59-68`, zero-weight `:70-80`, residual `:82-92`, empty round `:94-98`, rounding line `:101-116`) still passes — these are the regression gate for the helper extraction:

  ```
  npx vitest run tests/unit/splitBill.test.ts
  ```

  Confirm: the summary reports ZERO failures, the six pre-existing un-split cases are still listed as passing, and the new `the worked fareware scenario: P1/P2/P3 pay, M is treated on Adobo + Chicken` test passes. (Do not match an absolute total — only the named cases above and a zero-failure summary matter.)

- [ ] Step 6: Typecheck — the new `Diner` import and helper signatures must compile clean:

  ```
  npm run typecheck
  ```

  Expected: no output after the `> tsc --noEmit` banner, exit 0.

- [ ] Step 7: Commit.

  ```
  git add src/math/splitBill.ts tests/unit/splitBill.test.ts
  git commit -m "$(cat <<'EOF'
  feat(engine): branch splitBill on isPortioned for per-portion allocation

  Extract resolveParticipants/allocateEqually; portioned items distribute
  each portion's portionTotal equally across resolved participants. Un-split
  path is byte-identical. Adds the worked fareware acceptance test.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 14: Single full-allocation portion === un-split (cent-for-cent)

Proves reversibility at the math layer: an item carved into ONE portion covering all units, with the same participant list, splits identically to the un-split item. This is the no-regression guarantee that `splitItem` (Phase 3, which births exactly such a single portion) changes nothing about the money.

**Files:**
- Test: `tests/unit/splitBill.test.ts` (Modify — add one `it()` inside the existing `describe('splitBill — portions', …)` block; the `portioned` factory defined in that block is in scope)

- [ ] Step 1: Inside `describe('splitBill — portions', …)`, after the worked-example `it()`, add:

```ts
  it('a single full-allocation portion splits identically to an un-split item', () => {
    const diners = [diner('a'), diner('b'), diner('c')]
    // un-split: qty 3 @ 1003, everyone
    const unsplit = splitBill(round({ diners, items: [item('x', 1003, 3, [])] }))
    // portioned: ONE portion covering all 3 units, everyone sentinel inside
    const split = splitBill(
      round({
        diners,
        items: [portioned('x', 1003, 3, [{ units: 3, assignedDinerIds: [] }])],
      }),
    )
    expect(split.perDiner.map((d) => d.food)).toEqual(
      unsplit.perDiner.map((d) => d.food),
    )
    expect(split.perDiner.map((d) => d.total)).toEqual(
      unsplit.perDiner.map((d) => d.total),
    )
    expect(split.breakdown.grandTotal).toBe(unsplit.breakdown.grandTotal)
  })
```

- [ ] Step 2: Run it and watch it PASS (the engine is already implemented; this test asserts the property the impl already satisfies):

  ```
  npx vitest run tests/unit/splitBill.test.ts -t "a single full-allocation portion splits identically to an un-split item"
  ```

  Expected output:

  ```
   ✓ tests/unit/splitBill.test.ts > splitBill — portions > a single full-allocation portion splits identically to an un-split item
        Tests  1 passed (1)
  ```

- [ ] Step 3: Commit.

  ```
  git add tests/unit/splitBill.test.ts
  git commit -m "$(cat <<'EOF'
  test(engine): single full-allocation portion equals un-split cent-for-cent

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 15: Per-portion independent largest-remainder odd cents

Each portion runs its OWN largest-remainder distribution, so odd cents land deterministically per portion (ties → lowest index). Pins the exact `[67,67,66]` (Σ===200) behaviour for 2 units @ 100¢ across 3 payers — the spec's named edge case.

**Files:**
- Test: `tests/unit/splitBill.test.ts` (Modify — add one `it()` inside `describe('splitBill — portions', …)`)

- [ ] Step 1: Add inside the portions describe block:

```ts
  it('each portion gets independent largest-remainder odd cents', () => {
    // qty 2 @ 100¢, single portion of 2 units split across 3 payers.
    // cost = 2·100 = 200; 200/[1,1,1] = [67,67,66] (Σ===200, ties→lowest idx).
    const state = round({
      diners: [diner('a'), diner('b'), diner('c')],
      items: [portioned('p', 100, 2, [{ units: 2, assignedDinerIds: ['a', 'b', 'c'] }])],
      servicePct: 0,
      gstPct: 0,
    })
    const s = splitBill(state)
    expect(s.perDiner.map((d) => d.food)).toEqual([67, 67, 66])
    expect(s.perDiner.reduce((acc, d) => acc + d.food, 0)).toBe(200)
  })
```

- [ ] Step 2: Run it and watch it PASS:

  ```
  npx vitest run tests/unit/splitBill.test.ts -t "each portion gets independent largest-remainder odd cents"
  ```

  Expected output:

  ```
   ✓ tests/unit/splitBill.test.ts > splitBill — portions > each portion gets independent largest-remainder odd cents
        Tests  1 passed (1)
  ```

- [ ] Step 3: Commit.

  ```
  git add tests/unit/splitBill.test.ts
  git commit -m "$(cat <<'EOF'
  test(engine): per-portion largest-remainder odd cents land deterministically

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 16: Orphaned portion is excluded from the bill (subtotal recomputes lower)

A portion whose participant list resolves to empty (all ids unknown) deposits nothing and its slice cost is EXCLUDED from the bill — subtotal and grandTotal recompute LOWER, exactly like today's all-unknown-ids un-split item. It is NOT residual-pinned. The global Σ-per-diner === grandTotal invariant still holds by the subtotal-recompute argument (Claim 1′).

**Files:**
- Test: `tests/unit/splitBill.test.ts` (Modify — add one `it()` inside `describe('splitBill — portions', …)`)

- [ ] Step 1: Add inside the portions describe block:

```ts
  it('an orphaned portion (all ids unknown) is excluded — subtotal recomputes lower', () => {
    // diners a, b. Item qty 2 @ 1000:
    //   portion 1 → ['ghost'] (unknown) → orphan, skipped, 1000¢ NOT billed
    //   portion 2 → ['a']             → a +1000
    // Plus an everyone item @ 500 so b still pays something.
    const state = round({
      diners: [diner('a'), diner('b')],
      items: [
        portioned('orphaned', 1000, 2, [
          { units: 1, assignedDinerIds: ['ghost'] },
          { units: 1, assignedDinerIds: ['a'] },
        ]),
        item('shared', 500, 1, []), // everyone → [250,250]
      ],
      servicePct: 0,
      gstPct: 0,
    })
    const s = splitBill(state)

    const a = s.perDiner.find((d) => d.dinerId === 'a')!
    const b = s.perDiner.find((d) => d.dinerId === 'b')!
    // a: orphan-portion 1000 + half of shared 250 = 1250; b: half of shared 250.
    expect(a.food).toBe(1250)
    expect(b.food).toBe(250)
    // subtotal = 1250 + 250 = 1500, NOT 2500 — the orphan's 1000¢ is excluded.
    expect(s.breakdown.subtotal).toBe(1500)
    expect(s.breakdown.grandTotal).toBe(1500)
    // Excluded, not residual-pinned:
    expect(s.residual).toBe(0)
    expect(s.residualDinerId).toBeNull()
    // The global invariant still holds against the (lower) grand total.
    expect(s.perDiner.reduce((acc, d) => acc + d.total, 0)).toBe(s.breakdown.grandTotal)
  })
```

- [ ] Step 2: Run it and watch it PASS (the `allocateEqually` early-return on empty participants already implements exclusion):

  ```
  npx vitest run tests/unit/splitBill.test.ts -t "an orphaned portion (all ids unknown) is excluded — subtotal recomputes lower"
  ```

  Expected output:

  ```
   ✓ tests/unit/splitBill.test.ts > splitBill — portions > an orphaned portion (all ids unknown) is excluded — subtotal recomputes lower
        Tests  1 passed (1)
  ```

- [ ] Step 3: Commit.

  ```
  git add tests/unit/splitBill.test.ts
  git commit -m "$(cat <<'EOF'
  test(engine): orphaned portion excluded from bill, not residual-pinned

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 17: Empty-sentinel portion bills everyone (distinct from all-unknown skip)

The `[]`-check happens BEFORE the filter, so a literal `[]` portion bills EVERYONE (resolved against the live diner list), while an explicit list of all-unknown ids filters to `[]` and is SKIPPED. These two outcomes must stay distinct (invariant 3 / 8). This test pins the sentinel branch; the previous task pinned the skip branch.

**Files:**
- Test: `tests/unit/splitBill.test.ts` (Modify — add one `it()` inside `describe('splitBill — portions', …)`)

- [ ] Step 1: Add inside the portions describe block:

```ts
  it('an empty-sentinel portion bills everyone (distinct from all-unknown skip)', () => {
    // qty 2 @ 1000, single portion with the [] everyone sentinel, 2 diners.
    // [] → everyone → 2000/[1,1] = [1000,1000]. (If [] were mistakenly filtered
    // it would skip and bill nothing — this asserts the sentinel branch.)
    const state = round({
      diners: [diner('a'), diner('b')],
      items: [portioned('p', 1000, 2, [{ units: 2, assignedDinerIds: [] }])],
      servicePct: 0,
      gstPct: 0,
    })
    const s = splitBill(state)
    expect(s.perDiner.map((d) => d.food)).toEqual([1000, 1000])
    expect(s.breakdown.subtotal).toBe(2000)
  })
```

- [ ] Step 2: Run it and watch it PASS:

  ```
  npx vitest run tests/unit/splitBill.test.ts -t "an empty-sentinel portion bills everyone (distinct from all-unknown skip)"
  ```

  Expected output:

  ```
   ✓ tests/unit/splitBill.test.ts > splitBill — portions > an empty-sentinel portion bills everyone (distinct from all-unknown skip)
        Tests  1 passed (1)
  ```

- [ ] Step 3: Commit.

  ```
  git add tests/unit/splitBill.test.ts
  git commit -m "$(cat <<'EOF'
  test(engine): empty-sentinel portion bills everyone, distinct from skip

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 18: Fully-treated diner pays 0 across all portions

A diner in NO portion of any line they would pay → food 0 → 0 charges → total 0, and the residual never lands on them while others are positive. Pins the "M is treated for everything" extreme at the engine level.

**Files:**
- Test: `tests/unit/splitBill.test.ts` (Modify — add one `it()` inside `describe('splitBill — portions', …)`)

- [ ] Step 1: Add inside the portions describe block:

```ts
  it('a fully-treated diner pays 0 across all portions (food/charges/total 0)', () => {
    // diners payer + treated. Single portioned line, every portion excludes treated.
    const state = round({
      diners: [diner('payer'), diner('treated')],
      items: [
        portioned('line', 1000, 2, [
          { units: 1, assignedDinerIds: ['payer'] },
          { units: 1, assignedDinerIds: ['payer'] },
        ]),
      ],
      discount: cents(100),
    })
    const s = splitBill(state)
    const treated = s.perDiner.find((d) => d.dinerId === 'treated')!
    expect(treated.food).toBe(0)
    expect(treated.discount).toBe(0)
    expect(treated.service).toBe(0)
    expect(treated.gst).toBe(0)
    expect(treated.total).toBe(0)
    expect(total(s)).toBe(s.breakdown.grandTotal)
  })
```

- [ ] Step 2: Run it and watch it PASS:

  ```
  npx vitest run tests/unit/splitBill.test.ts -t "a fully-treated diner pays 0 across all portions (food/charges/total 0)"
  ```

  Expected output:

  ```
   ✓ tests/unit/splitBill.test.ts > splitBill — portions > a fully-treated diner pays 0 across all portions (food/charges/total 0)
        Tests  1 passed (1)
  ```

- [ ] Step 3: Commit.

  ```
  git add tests/unit/splitBill.test.ts
  git commit -m "$(cat <<'EOF'
  test(engine): fully-treated diner pays zero across all portions

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 19: A diner added after a split — the late-add treated mechanism

A diner appearing only in `[]`-sentinel portions pays a share of those (Snapper) and ZERO of every explicit-list portion (Adobo/Chicken). This is the exact mechanism by which "M added late is still treated" — pins that explicit lists never silently re-include a new diner.

**Files:**
- Test: `tests/unit/splitBill.test.ts` (Modify — add one `it()` inside `describe('splitBill — portions', …)`)

- [ ] Step 1: Add inside the portions describe block:

```ts
  it('a diner added after a split pays []-sentinel portions but zero of explicit portions', () => {
    // 4 diners; M is the "late add". Snapper is everyone-sentinel ([]); Adobo's
    // portions are explicit [P1,P2,P3] and a solo [P1] — M is absent from both.
    const state = round({
      diners: [diner('P1'), diner('P2'), diner('P3'), diner('M')],
      items: [
        item('snapper', 1800, 5, []), // [] everyone → M shares 9000/4 = 2250
        portioned('adobo', 1400, 3, [
          { units: 1, assignedDinerIds: ['P1'] },
          { units: 2, assignedDinerIds: ['P1', 'P2', 'P3'] },
        ]),
      ],
    })
    const s = splitBill(state)
    const m = s.perDiner.find((d) => d.dinerId === 'M')!
    // M gets a share of the [] Snapper portion ONLY; zero from explicit Adobo.
    expect(m.food).toBe(2250)
    expect(total(s)).toBe(s.breakdown.grandTotal)
  })
```

- [ ] Step 2: Run it and watch it PASS:

  ```
  npx vitest run tests/unit/splitBill.test.ts -t "a diner added after a split pays []-sentinel portions but zero of explicit portions"
  ```

  Expected output:

  ```
   ✓ tests/unit/splitBill.test.ts > splitBill — portions > a diner added after a split pays []-sentinel portions but zero of explicit portions
        Tests  1 passed (1)
  ```

- [ ] Step 3: Commit.

  ```
  git add tests/unit/splitBill.test.ts
  git commit -m "$(cat <<'EOF'
  test(engine): late-added diner shares []-sentinel portions, zero of explicit

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 20: Single-diner round with portions sends all cents to the one diner; falsy-portions guards take un-split branch

Two micro-cases bundled: (a) a single-diner round with portions accumulates every cent on that diner; (b) `portions: []` and `portions: undefined` both fall to the un-split branch and equal today's result, because `isPortioned` treats empty/absent as un-split (invariant 5/6).

**Files:**
- Test: `tests/unit/splitBill.test.ts` (Modify — add two `it()` blocks inside `describe('splitBill — portions', …)`)

- [ ] Step 1: Add inside the portions describe block:

```ts
  it('single-diner round with portions sends all cents to the one diner', () => {
    const state = round({
      diners: [diner('solo')],
      items: [
        portioned('line', 333, 3, [
          { units: 1, assignedDinerIds: ['solo'] },
          { units: 2, assignedDinerIds: [] }, // [] → everyone == solo
        ]),
      ],
      servicePct: 0,
      gstPct: 0,
    })
    const s = splitBill(state)
    expect(s.perDiner[0]!.food).toBe(999) // 3·333
    expect(s.breakdown.subtotal).toBe(999)
    expect(total(s)).toBe(s.breakdown.grandTotal)
  })

  it('portions: [] and portions: undefined take the un-split branch (isPortioned false)', () => {
    const diners = [diner('a'), diner('b')]
    const baseline = splitBill(round({ diners, items: [item('x', 1000, 1, [])] }))
    // portions: [] — empty array, isPortioned false, falls back to assignedDinerIds.
    const emptyPortions: Item = {
      id: 'x',
      name: 'x',
      qty: 1,
      unitPrice: cents(1000),
      assignedDinerIds: [],
      portions: [],
    }
    const sEmpty = splitBill(round({ diners, items: [emptyPortions] }))
    expect(sEmpty.perDiner.map((d) => d.food)).toEqual(
      baseline.perDiner.map((d) => d.food),
    )
    // portions absent (undefined) is the plain item() factory — equals baseline.
    const sAbsent = splitBill(round({ diners, items: [item('x', 1000, 1, [])] }))
    expect(sAbsent.perDiner.map((d) => d.food)).toEqual(
      baseline.perDiner.map((d) => d.food),
    )
    expect(baseline.perDiner.map((d) => d.food)).toEqual([500, 500])
  })
```

- [ ] Step 2: Run both and watch them PASS:

  ```
  npx vitest run tests/unit/splitBill.test.ts -t "single-diner round with portions sends all cents to the one diner"
  npx vitest run tests/unit/splitBill.test.ts -t "portions: [] and portions: undefined take the un-split branch (isPortioned false)"
  ```

  Expected output (each invocation):

  ```
   ✓ tests/unit/splitBill.test.ts > splitBill — portions > single-diner round with portions sends all cents to the one diner
        Tests  1 passed (1)
  ```
  ```
   ✓ tests/unit/splitBill.test.ts > splitBill — portions > portions: [] and portions: undefined take the un-split branch (isPortioned false)
        Tests  1 passed (1)
  ```

- [ ] Step 3: Run the FULL `splitBill.test.ts` to confirm the whole portions suite + every regression case is green together:

  ```
  npx vitest run tests/unit/splitBill.test.ts
  ```

  Confirm: the summary reports ZERO failures, all six pre-existing un-split regression cases are still listed as passing, and all eight new portions cases (worked-example, single-full-allocation, per-portion-odd-cents, orphaned-portion, empty-sentinel, fully-treated, late-add, and these two single-diner/falsy-portions cases) are listed as passing. (Do not assert an absolute total — file/test counts grow as other phases land.)

- [ ] Step 4: Commit.

  ```
  git add tests/unit/splitBill.test.ts
  git commit -m "$(cat <<'EOF'
  test(engine): single-diner portions + falsy-portions un-split guards

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 21: Extend the 300-round fuzz — units-conserving portion generator + per-line cost-conservation

Widen the property test's input space: with ~30% probability per item, carve its `qty` into 1..k CONTIGUOUS units-conserving portions built from random CUT-POINTS (never independent random units — that would test the schema downgrade, not the engine), each with a random subset/sentinel. KEEP the two existing assertions (`Σ===grandTotal`, no NaN). Add a per-line cost-conservation assertion catching a `portionTotal` bug that happens to still globally balance.

**Files:**
- Modify: `tests/unit/splitBill-property.test.ts` — item generator `:25-39`, add per-line assertion after `:55`
- Test: same file (this IS the property test)

- [ ] Step 1: Open `tests/unit/splitBill-property.test.ts`. The current item generator is lines 25-39 inside the `for (let i = 0; i < 300; i++)` loop. Replace the entire `const items: Item[] = Array.from(...)` block (lines 25-39, which currently builds an un-split item per index) with this version that sometimes carves contiguous portions from cut-points:

  ```ts
      const items: Item[] = Array.from({ length: randInt(0, 12) }, (_, j) => {
        const qty = randInt(1, 5)
        const unitPrice = cents(randInt(1, 20_000))

        // ── pick the item-level participant list (today's logic) ──
        const pickAssigned = (): string[] => {
          let assigned: string[] = []
          if (rand() >= 0.4) {
            assigned = diners.filter(() => rand() < 0.5).map((d) => d.id)
            if (assigned.length === 0) assigned = [diners[randInt(0, dinerCount - 1)]!.id]
          }
          return assigned
        }

        const base: Item = {
          id: `i${j}`,
          name: `Item ${j}`,
          qty,
          unitPrice,
          assignedDinerIds: pickAssigned(),
        }

        // ~30% of items become portioned, but ONLY via cut-points so
        // Σ(portion.units) === qty BY CONSTRUCTION (exercises the engine,
        // not the schema downgrade). Each portion gets its own subset/sentinel.
        if (qty >= 2 && rand() < 0.3) {
          const k = randInt(1, qty) // 1..qty contiguous portions
          const cuts = new Set<number>()
          while (cuts.size < k - 1) cuts.add(randInt(1, qty - 1))
          const bounds = [0, ...[...cuts].sort((a, b) => a - b), qty]
          const portions = []
          for (let b = 1; b < bounds.length; b++) {
            portions.push({
              units: bounds[b]! - bounds[b - 1]!,
              assignedDinerIds: pickAssigned(),
            })
          }
          base.portions = portions
        }

        return base
      })
  ```

- [ ] Step 2: Add the per-line cost-conservation assertion. The existing assertions are at lines 53-58 (compute `s`, assert `sum === grandTotal`, assert no NaN). Immediately AFTER the existing `for (const d of s.perDiner) { ... }` no-NaN loop (currently ending around line 58) and BEFORE the loop's closing `}`, add a cost-conservation check that recomputes the subtotal directly from the items (using only NON-orphaned slices) and asserts it equals the engine's subtotal:

  ```ts
        // Per-line cost conservation: recompute subtotal from the items using
        // ONLY non-orphaned slices, and assert it matches the engine's subtotal.
        // Catches a portionTotal bug that happens to still globally balance.
        const known = new Set(diners.map((d) => d.id))
        const resolves = (assigned: string[]) =>
          assigned.length === 0 || assigned.some((id) => known.has(id))
        let expectedSubtotal = 0
        for (const it of items) {
          if (Array.isArray(it.portions) && it.portions.length > 0) {
            for (const p of it.portions) {
              if (resolves(p.assignedDinerIds)) expectedSubtotal += p.units * it.unitPrice
            }
          } else if (resolves(it.assignedDinerIds)) {
            expectedSubtotal += it.qty * it.unitPrice
          }
        }
        expect(s.breakdown.subtotal, `subtotal case ${i}`).toBe(expectedSubtotal)
  ```

- [ ] Step 3: Run the property test and watch it PASS — the engine balances across the wider input space including portioned items:

  ```
  npx vitest run tests/unit/splitBill-property.test.ts
  ```

  Confirm: the summary reports ZERO failures and the `holds across 300 seeded random rounds` test is listed as passing. (If the per-line assertion fails, it means `portionTotal`/`allocateEqually` mis-allocated cents in a way that still globally balanced — a real engine bug to fix, not a test bug.)

- [ ] Step 4: Typecheck — the generator now assigns `base.portions`, exercising the Phase-1 `Item.portions?` field:

  ```
  npm run typecheck
  ```

  Expected: no output after the banner, exit 0.

- [ ] Step 5: Commit.

  ```
  git add tests/unit/splitBill-property.test.ts
  git commit -m "$(cat <<'EOF'
  test(engine): fuzz portioned rounds via cut-points + per-line cost conservation

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 22: Property test — non-conserving portions routed through parseRoundState never break the engine

A second, smaller property case: feed DELIBERATELY non-conserving portions (Σ units ≠ qty) through `parseRoundState` (the schema downgrade path from Phase 1) BEFORE `splitBill`, and assert `Σ === grandTotal`. This proves the downgrade path never yields a broken engine input. This consciously adds a `@/state/schema` import to a previously engine-only test file (noted in §11/§13).

**Files:**
- Modify: `tests/unit/splitBill-property.test.ts` — add `parseRoundState` import to line 3-4 region; append a new `it()` to the existing `describe`
- Test: same file

- [ ] Step 1: At the top of `tests/unit/splitBill-property.test.ts`, the current imports are lines 1-4:

  ```ts
  import { describe, it, expect } from 'vitest'
  import { cents } from '@/math/money'
  import { splitBill } from '@/math/splitBill'
  import type { Diner, Item, RoundState } from '@/state/types'
  ```

  Add the schema import after line 4 (a deliberate change to this file's engine-only character):

  ```ts
  import { parseRoundState } from '@/state/schema'
  ```

- [ ] Step 2: Append a new `it()` inside the existing `describe('splitBill property: exact-sum invariant', …)` block, after the `holds across 300 seeded random rounds` test's closing `})`:

  ```ts
    it('non-conserving portions routed through parseRoundState never break the engine', () => {
      let seed = 0xbeef
      const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 2 ** 32)
      const randInt = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))

      for (let i = 0; i < 120; i++) {
        const dinerCount = randInt(1, 5)
        const diners = Array.from({ length: dinerCount }, (_, d) => ({
          id: `d${d}`,
          name: `Diner ${d}`,
          colorIdx: d % 8,
        }))

        const items = Array.from({ length: randInt(1, 6) }, (_, j) => {
          const qty = randInt(2, 5)
          // DELIBERATELY non-conserving: each portion gets an INDEPENDENT random
          // unit count, so Σ units almost never equals qty → schema downgrades it.
          const k = randInt(1, 3)
          const portions = Array.from({ length: k }, () => ({
            units: randInt(1, 4),
            assignedDinerIds: diners.filter(() => rand() < 0.5).map((d) => d.id),
          }))
          return {
            id: `i${j}`,
            name: `Item ${j}`,
            qty,
            unitPrice: randInt(1, 20_000),
            assignedDinerIds: [] as string[],
            portions,
          }
        })

        const raw = {
          venue: 'Fuzz',
          diners,
          items,
          discount: randInt(0, 5_000),
          servicePct: 0.1,
          gstPct: 0.09,
          rounding: randInt(0, 8) - 4,
          scan: null,
          scannedTotal: null,
        }

        // The schema either keeps conserving portions or downgrades to un-split;
        // either way the engine input is valid and Σ must balance.
        const parsed = parseRoundState(raw)
        expect(parsed, `parse case ${i}`).not.toBeNull()
        const s = splitBill(parsed!)
        const sum = s.perDiner.reduce<number>((a, d) => a + d.total, 0)
        expect(sum, `case ${i}`).toBe(s.breakdown.grandTotal)
      }
    })
  ```

- [ ] Step 3: Run the new test and watch it PASS — `parseRoundState` downgrades non-conserving items to un-split, and the engine balances on the result:

  ```
  npx vitest run tests/unit/splitBill-property.test.ts -t "non-conserving portions routed through parseRoundState never break the engine"
  ```

  Expected output:

  ```
   ✓ tests/unit/splitBill-property.test.ts > splitBill property: exact-sum invariant > non-conserving portions routed through parseRoundState never break the engine
        Tests  1 passed (1)
  ```

  (If `parseRoundState` returns null for any case, the downgrade transform from Phase 1 is too strict — a Phase-1 bug surfaced here.)

- [ ] Step 4: Run the FULL property file (both cases together):

  ```
  npx vitest run tests/unit/splitBill-property.test.ts
  ```

  Confirm: the summary reports ZERO failures and both the `holds across 300 seeded random rounds` and `non-conserving portions routed through parseRoundState never break the engine` tests are listed as passing.

- [ ] Step 5: Typecheck:

  ```
  npm run typecheck
  ```

  Expected: no output after the banner, exit 0.

- [ ] Step 6: Commit.

  ```
  git add tests/unit/splitBill-property.test.ts
  git commit -m "$(cat <<'EOF'
  test(engine): non-conserving portions via parseRoundState never break Σ invariant

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 23: Phase 2 done-criteria — full suite green, typecheck clean, un-split behaviour unchanged

Confirm the whole suite (every pre-existing file plus the Phase-1 and Phase-2 additions) is green together, nothing below `subtotal` changed, and the un-split path stayed byte-identical. This is the gate before handing off to Phase 3.

**Files:** (no source changes — verification only)

- [ ] Step 1: Run the full suite:

  ```
  npm test
  ```

  Confirm ALL of the following, WITHOUT asserting any absolute file/test total (counts grow as earlier and later phases land):
  - the summary reports ZERO failures (no `failed` in the final line);
  - in `tests/unit/splitBill.test.ts`, the six pre-existing un-split regression cases (Jumbo Seafood, everyone-sentinel, zero-weight, residual, empty round, rounding line) are all listed as passing — this is the byte-identical-un-split-path gate;
  - the eight new Phase-2 portions cases in `tests/unit/splitBill.test.ts` are all listed as passing;
  - both cases in `tests/unit/splitBill-property.test.ts` (`holds across 300 seeded random rounds`, `non-conserving portions routed through parseRoundState never break the engine`) are listed as passing.

  If ANY pre-existing un-split regression case fails, STOP — a regression was introduced and the un-split path is no longer byte-identical. Use systematic debugging before proceeding.

- [ ] Step 2: Typecheck the whole project:

  ```
  npm run typecheck
  ```

  Expected: no output after the `> tsc --noEmit` banner, exit 0.

- [ ] Step 3: Confirm nothing below `subtotal` was touched in `src/math/splitBill.ts` — the diff for this phase must be confined to the import line (`:5`), the two new helpers, and the loop body. Verify the lines from `const subtotal = addC(...food)` downward are unchanged:

  ```
  git diff de893f2 -- src/math/splitBill.ts | grep -E '^\+' | grep -E 'applyCharges|distributeResidual|breakdown =|grandTotal' || echo "NO changes to charge/residual lines — correct"
  ```

  Expected output:

  ```
  NO changes to charge/residual lines — correct
  ```

  (The `applyCharges`/`distributeResidual`/`breakdown`/`grandTotal` lines must appear in NO added `+` line — they were untouched.)

- [ ] Step 4: No commit needed (verification only). Phase 2 is complete: portioned rounds split correctly to the cent, the hard Σ-per-diner === grandTotal invariant is fuzz-proven over the wider input space (conserving generator + per-line cost conservation + downgrade path), and every un-split regression case passes unmodified.

---

## Phase 3 — Store actions (editing)

## Phase 3 — Store actions (editing)

Implements spec §4 and §12 Phase 3. This phase adds 8 new store actions plus extends `removeDiner` and guards `updateItem`, all tests-first. Every action lives in the `actions` object of `src/state/store.ts` (the immer-wrapped store at `store.ts:51-184`).

**Prerequisites (already landed in earlier phases — DO NOT re-create):**
- Phase 1: `src/state/types.ts` exports `interface Portion { units:number; assignedDinerIds:string[] }`, `Item.portions?:Portion[]`, and `isPortioned(it)`. Verify before starting: `grep -n "isPortioned\|interface Portion\|portions?" src/state/types.ts` must show all three.
- Phase 2: `src/math/splitBill.ts` exports `splitBill(state)` returning `BillSplit` with `perDiner: DinerSplit[]`. Used only by the `removeDiner` outcome tests (asserting the SPLIT result, not array shape).

**Toolchain reminders (verbatim):** run one file → `npx vitest run tests/unit/store.test.ts`; one test by name → `npx vitest run tests/unit/store.test.ts -t "exact test name"`; full suite → `npm test`; typecheck → `npm run typecheck`.

**Baseline for this phase:** `npx vitest run tests/unit/store.test.ts` → 13 passed in this file. `npm test` → all files green, zero failures (the integration file remains skipped exactly as before). `npm run typecheck` → exit 0. The existing `removeDiner strips explicit assignments` tripwire at `tests/unit/store.test.ts:33-40` must stay byte-identically green through every task.

All new tests go in ONE new `describe('store — portions', …)` block appended to `tests/unit/store.test.ts`. Each task adds its own test(s) inside that block, watches them fail, then adds the minimal action.

---

### Task 24: Scaffold the `store — portions` describe block — SUPERSEDED (skipped)

> NOTE: This standalone scaffold is intentionally skipped during execution. vitest 4 hard-errors on an empty `describe` ("No test found in suite"), and `noUnusedLocals` rejects importing `splitBill` before it is used. The `store — portions` describe block is instead created by Task 25 (with its first real test), and the `splitBill` import is added in Task 32 where it is first used.

**Files:**
- Modify: `tests/unit/store.test.ts` (append after line 129, the end of the last `describe`)

The existing file already imports what we need (`tests/unit/store.test.ts:1-3`): `import { beforeEach, describe, it, expect } from 'vitest'`, `import { cents } from '@/math/money'`, `import { emptyRound, useStore } from '@/state/store'`, plus the `a()` / `round()` / `seed()` helpers at lines 5-17 (`seed()` adds diners Shin, Mei, Raj and one item `Beer` qty 3 @ `cents(900)`). The `beforeEach(() => { a().reset() })` at lines 8-10 resets the store before every test. We reuse all of this.

We also need `splitBill` for the `removeDiner` outcome tests later in this phase, so add its import now.

- [ ] Step 1: Add the `splitBill` import. In `tests/unit/store.test.ts`, after the existing line 3 `import { emptyRound, useStore } from '@/state/store'`, add a new line:
  ```ts
  import { splitBill } from '@/math/splitBill'
  ```
- [ ] Step 2: Append the empty portions describe block at the very end of `tests/unit/store.test.ts` (after the final `})` on line 129):
  ```ts

  describe('store — portions', () => {
    // tests added task-by-task below
  })
  ```
- [ ] Step 3: Run the file to confirm the scaffold is green (an empty describe passes, and the new import resolves): `npx vitest run tests/unit/store.test.ts`. Expected: the file passes with `Tests  13 passed (13)` (the empty describe contributes 0 tests). The `splitBill` import must resolve cleanly — if you see `Failed to resolve import "@/math/splitBill"`, STOP and verify Phase 2 landed.
- [ ] Step 4: Commit. `git add tests/unit/store.test.ts && git commit -m "test(store): scaffold portions describe block

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 25: `splitItem` — birth one full-allocation portion

`splitItem` is the only place a split is born. Per spec §4 it seeds a single portion `{ units: it.qty, assignedDinerIds: [...it.assignedDinerIds] }`, no-op if `qty < 2` or already portioned.

**Files:**
- Modify: `tests/unit/store.test.ts` (inside `store — portions`)
- Modify: `src/state/store.ts` (action `splitItem` in the `actions` object; signature in `StoreState.actions` at `store.ts:27-48`)
- Test: `tests/unit/store.test.ts`

- [ ] Step 1: Create the `store — portions` describe block at the END of `tests/unit/store.test.ts` (it does not exist yet — Task 24's standalone scaffold is skipped). Add the failing tests inside it, using the existing top-of-file `seed()`, `round()`, `a()`, `cents()` helpers. Do NOT import `splitBill` here — it is added in Task 32 (its first use), and `noUnusedLocals` would fail typecheck on an unused import:
  ```ts
  describe('store — portions', () => {
  it('splitItem seeds one full-allocation portion copying assignedDinerIds', () => {
    seed()
    const item = round().items[0]!
    a().assignOnly(item.id, round().diners[2]!.id) // explicit [raj]
    a().splitItem(item.id)
    const p = round().items[0]!.portions
    expect(p).toEqual([{ units: 3, assignedDinerIds: [round().diners[2]!.id] }])
  })

  it('splitItem keeps the everyone sentinel as [] on the seeded portion', () => {
    seed()
    const item = round().items[0]! // assignedDinerIds is [] by default
    a().splitItem(item.id)
    expect(round().items[0]!.portions).toEqual([{ units: 3, assignedDinerIds: [] }])
  })

  it('splitItem is a no-op for qty < 2', () => {
    seed()
    a().addItem({ name: 'Coffee', qty: 1, unitPrice: cents(500) })
    const coffee = round().items[1]!
    a().splitItem(coffee.id)
    expect(round().items[1]!.portions).toBeUndefined()
  })

  it('splitItem is idempotent — no-op if already portioned', () => {
    seed()
    const item = round().items[0]!
    a().splitItem(item.id)
    a().splitItem(item.id) // second call must not re-seed
    expect(round().items[0]!.portions).toEqual([{ units: 3, assignedDinerIds: [] }])
  })
  }) // end describe('store — portions')
  ```
- [ ] Step 2: Add the `splitItem` signature to `StoreState.actions`. In `src/state/store.ts`, immediately after the `removeItem` signature line (`store.ts:37` `removeItem: (id: string) => void`), add:
  ```ts
    splitItem: (itemId: string) => void
  ```
- [ ] Step 3: Run the tests, watch them FAIL on the missing action. `npx vitest run tests/unit/store.test.ts -t "splitItem seeds one full-allocation portion copying assignedDinerIds"`. Expected failure: `TypeError: useStore.getState().actions.splitItem is not a function` (the signature exists in the type but no implementation yet; at runtime `a().splitItem` is `undefined`).
- [ ] Step 4: Implement `splitItem`. In `src/state/store.ts`, inside the `actions` object, after the `removeItem` action (which ends at `store.ts:120` with `}),`), add:
  ```ts

        splitItem: (itemId) =>
          set((s) => {
            const it = s.round.items.find((i) => i.id === itemId)
            if (!it || it.qty < 2 || it.portions) return
            it.portions = [{ units: it.qty, assignedDinerIds: [...it.assignedDinerIds] }]
          }),
  ```
- [ ] Step 5: Run all four tests, watch them PASS: `npx vitest run tests/unit/store.test.ts -t "splitItem"`. Expected: `Tests  4 passed (4)`.
- [ ] Step 6: Typecheck (the new action must satisfy the new signature): `npm run typecheck`. Expected: exit 0, no output errors.
- [ ] Step 7: Commit. `git add src/state/store.ts tests/unit/store.test.ts && git commit -m "feat(store): splitItem seeds one full-allocation portion

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 26: `addPortion` — carve a 1-unit slice off the last portion with units ≥ 2

Per spec §4: carve 1 unit off the LAST portion with `units >= 2`, push `{ units: 1, assignedDinerIds: [] }`. No-op when fully fragmented (every portion is 1 unit) or un-split.

**Files:**
- Modify: `tests/unit/store.test.ts` (inside `store — portions`)
- Modify: `src/state/store.ts` (action `addPortion`; signature in `StoreState.actions`)
- Test: `tests/unit/store.test.ts`

- [ ] Step 1: Add the failing tests:
  ```ts
  it('addPortion carves a 1-unit slice off the last portion with units >= 2', () => {
    seed()
    const item = round().items[0]! // qty 3
    a().splitItem(item.id) // [{units:3, []}]
    a().addPortion(item.id)
    expect(round().items[0]!.portions).toEqual([
      { units: 2, assignedDinerIds: [] },
      { units: 1, assignedDinerIds: [] },
    ])
  })

  it('addPortion is a no-op on an un-split item', () => {
    seed()
    const item = round().items[0]!
    a().addPortion(item.id)
    expect(round().items[0]!.portions).toBeUndefined()
  })

  it('addPortion is a no-op when fully fragmented (every portion 1 unit)', () => {
    seed()
    const item = round().items[0]! // qty 3
    a().splitItem(item.id)
    a().addPortion(item.id) // -> [2,1]
    a().addPortion(item.id) // -> [1,1,1]
    a().addPortion(item.id) // fully fragmented -> no-op
    expect(round().items[0]!.portions).toEqual([
      { units: 1, assignedDinerIds: [] },
      { units: 1, assignedDinerIds: [] },
      { units: 1, assignedDinerIds: [] },
    ])
  })
  ```
- [ ] Step 2: Add the `addPortion` signature to `StoreState.actions`, immediately after the `splitItem` signature added in the previous task:
  ```ts
    addPortion: (itemId: string) => void
  ```
- [ ] Step 3: Run the tests, watch them FAIL: `npx vitest run tests/unit/store.test.ts -t "addPortion carves a 1-unit slice off the last portion with units >= 2"`. Expected failure: `TypeError: useStore.getState().actions.addPortion is not a function`.
- [ ] Step 4: Implement `addPortion`. In `src/state/store.ts`, immediately after the `splitItem` action's closing `}),`, add:
  ```ts

        addPortion: (itemId) =>
          set((s) => {
            const it = s.round.items.find((i) => i.id === itemId)
            if (!it?.portions) return
            for (let k = it.portions.length - 1; k >= 0; k--) {
              if (it.portions[k]!.units >= 2) {
                it.portions[k]!.units -= 1
                it.portions.push({ units: 1, assignedDinerIds: [] })
                return
              }
            }
          }),
  ```
- [ ] Step 5: Run the tests, watch them PASS: `npx vitest run tests/unit/store.test.ts -t "addPortion"`. Expected: `Tests  3 passed (3)`.
- [ ] Step 6: Typecheck: `npm run typecheck`. Expected: exit 0.
- [ ] Step 7: Commit. `git add src/state/store.ts tests/unit/store.test.ts && git commit -m "feat(store): addPortion carves a 1-unit slice off the last splittable portion

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 27: `setPortionUnits` — steal/return from a single neighbour, conserving Σ

Per spec §4: rebalance against ONE neighbour (`portionIndex+1` if it exists, else `portionIndex-1`), clamp to `[1, cur+nbr]`, `Math.floor` the input (the only guard against a fractional value reaching `cents()`), no-op on a single portion or when `next === cur`.

**Files:**
- Modify: `tests/unit/store.test.ts` (inside `store — portions`)
- Modify: `src/state/store.ts` (action `setPortionUnits`; signature in `StoreState.actions`)
- Test: `tests/unit/store.test.ts`

- [ ] Step 1: Add the failing tests:
  ```ts
  it('setPortionUnits moves units to/from the right neighbour conserving qty', () => {
    seed()
    const item = round().items[0]! // qty 3
    a().splitItem(item.id)
    a().addPortion(item.id) // [{2,[]},{1,[]}]
    a().setPortionUnits(item.id, 0, 1) // 2->1, neighbour 1->2
    expect(round().items[0]!.portions).toEqual([
      { units: 1, assignedDinerIds: [] },
      { units: 2, assignedDinerIds: [] },
    ])
  })

  it('setPortionUnits clamps to [1, cur+nbr]', () => {
    seed()
    const item = round().items[0]! // qty 3
    a().splitItem(item.id)
    a().addPortion(item.id) // [{2,[]},{1,[]}]
    a().setPortionUnits(item.id, 0, 99) // clamp to cur+nbr = 3
    expect(round().items[0]!.portions).toEqual([
      { units: 3, assignedDinerIds: [] },
      { units: 0, assignedDinerIds: [] },
    ])
    a().setPortionUnits(item.id, 0, -5) // clamp to 1
    expect(round().items[0]!.portions![0]!.units).toBe(1)
  })

  it('setPortionUnits floors a fractional input before it reaches cents()', () => {
    seed()
    const item = round().items[0]! // qty 3
    a().splitItem(item.id)
    a().addPortion(item.id) // [{2,[]},{1,[]}]
    a().setPortionUnits(item.id, 1, 1.9) // floor(1.9)=1 === cur -> no-op
    expect(round().items[0]!.portions).toEqual([
      { units: 2, assignedDinerIds: [] },
      { units: 1, assignedDinerIds: [] },
    ])
  })

  it('setPortionUnits is a no-op on a single portion', () => {
    seed()
    const item = round().items[0]! // qty 3
    a().splitItem(item.id) // single portion {3,[]}
    a().setPortionUnits(item.id, 0, 1)
    expect(round().items[0]!.portions).toEqual([{ units: 3, assignedDinerIds: [] }])
  })

  it('setPortionUnits is a no-op for an out-of-range index or un-split item', () => {
    seed()
    const item = round().items[0]!
    a().setPortionUnits(item.id, 0, 1) // un-split -> no-op
    expect(round().items[0]!.portions).toBeUndefined()
    a().splitItem(item.id)
    a().addPortion(item.id) // [{2,[]},{1,[]}]
    a().setPortionUnits(item.id, 5, 1) // index out of range -> no-op
    expect(round().items[0]!.portions).toEqual([
      { units: 2, assignedDinerIds: [] },
      { units: 1, assignedDinerIds: [] },
    ])
  })
  ```
- [ ] Step 2: Add the `setPortionUnits` signature to `StoreState.actions`, immediately after the `addPortion` signature:
  ```ts
    setPortionUnits: (itemId: string, portionIndex: number, units: number) => void
  ```
- [ ] Step 3: Run the tests, watch them FAIL: `npx vitest run tests/unit/store.test.ts -t "setPortionUnits moves units to/from the right neighbour conserving qty"`. Expected failure: `TypeError: useStore.getState().actions.setPortionUnits is not a function`.
- [ ] Step 4: Implement `setPortionUnits`. In `src/state/store.ts`, immediately after the `addPortion` action's closing `}),`, add:
  ```ts

        setPortionUnits: (itemId, portionIndex, units) =>
          set((s) => {
            const it = s.round.items.find((i) => i.id === itemId)
            const ps = it?.portions
            if (!ps || portionIndex < 0 || portionIndex >= ps.length) return
            const nbr = portionIndex + 1 < ps.length ? portionIndex + 1 : portionIndex - 1
            if (nbr < 0) return
            const cur = ps[portionIndex]!.units
            const max = cur + ps[nbr]!.units
            const next = Math.min(Math.max(1, Math.floor(units)), max)
            if (next === cur) return
            ps[nbr]!.units += cur - next
            ps[portionIndex]!.units = next
          }),
  ```
- [ ] Step 5: Run all five tests, watch them PASS: `npx vitest run tests/unit/store.test.ts -t "setPortionUnits"`. Expected: `Tests  5 passed (5)`.
- [ ] Step 6: Typecheck: `npm run typecheck`. Expected: exit 0.
- [ ] Step 7: Commit. `git add src/state/store.ts tests/unit/store.test.ts && git commit -m "feat(store): setPortionUnits rebalances against one neighbour, conserving qty

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 28: `removePortion` — return units to prev (else next), never orphan, length ≥ 2 only

Per spec §4 and §10: `dest = portionIndex > 0 ? portionIndex - 1 : 1` (fold into prev, else into next when removing the first). Return the units, then splice. No-op if `length < 2` (a lone portion is collapsed via `mergePortions`, not here) or index out of range.

**Files:**
- Modify: `tests/unit/store.test.ts` (inside `store — portions`)
- Modify: `src/state/store.ts` (action `removePortion`; signature in `StoreState.actions`)
- Test: `tests/unit/store.test.ts`

- [ ] Step 1: Add the failing tests (the three separate cases from spec §11: folds-into-prev, of-first-folds-into-next, lone/length<2 refused):
  ```ts
  it('removePortion folds units into the previous portion', () => {
    seed()
    const item = round().items[0]! // qty 3
    a().splitItem(item.id)
    a().addPortion(item.id) // [{2,[]},{1,[]}]
    a().removePortion(item.id, 1) // remove last, fold into prev
    expect(round().items[0]!.portions).toEqual([{ units: 3, assignedDinerIds: [] }])
  })

  it('removePortion of the first portion folds units into the NEXT', () => {
    seed()
    const item = round().items[0]! // qty 3
    a().splitItem(item.id)
    a().addPortion(item.id) // [{2,[]},{1,[]}]
    a().removePortion(item.id, 0) // remove first, fold into next (dest=1)
    expect(round().items[0]!.portions).toEqual([{ units: 3, assignedDinerIds: [] }])
  })

  it('removePortion of a lone portion is a no-op (use mergePortions to collapse)', () => {
    seed()
    const item = round().items[0]! // qty 3
    a().splitItem(item.id) // single portion {3,[]}
    a().removePortion(item.id, 0)
    expect(round().items[0]!.portions).toEqual([{ units: 3, assignedDinerIds: [] }])
  })

  it('removePortion is a no-op on an un-split item (length < 2 guard)', () => {
    seed()
    const item = round().items[0]!
    a().removePortion(item.id, 0)
    expect(round().items[0]!.portions).toBeUndefined()
  })
  ```
- [ ] Step 2: Add the `removePortion` signature to `StoreState.actions`, immediately after the `setPortionUnits` signature:
  ```ts
    removePortion: (itemId: string, portionIndex: number) => void
  ```
- [ ] Step 3: Run the tests, watch them FAIL: `npx vitest run tests/unit/store.test.ts -t "removePortion folds units into the previous portion"`. Expected failure: `TypeError: useStore.getState().actions.removePortion is not a function`.
- [ ] Step 4: Implement `removePortion`. In `src/state/store.ts`, immediately after the `setPortionUnits` action's closing `}),`, add:
  ```ts

        removePortion: (itemId, portionIndex) =>
          set((s) => {
            const it = s.round.items.find((i) => i.id === itemId)
            const ps = it?.portions
            if (!ps || ps.length < 2 || portionIndex < 0 || portionIndex >= ps.length) return
            const dest = portionIndex > 0 ? portionIndex - 1 : 1
            ps[dest]!.units += ps[portionIndex]!.units
            ps.splice(portionIndex, 1)
          }),
  ```
- [ ] Step 5: Run all four tests, watch them PASS: `npx vitest run tests/unit/store.test.ts -t "removePortion"`. Expected: `Tests  4 passed (4)`.
- [ ] Step 6: Typecheck: `npm run typecheck`. Expected: exit 0.
- [ ] Step 7: Commit. `git add src/state/store.ts tests/unit/store.test.ts && git commit -m "feat(store): removePortion returns units to a neighbour, never orphans

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 29: `mergePortions` — collapse to un-split, adopting portions[0]'s list

Per spec §4: set `it.assignedDinerIds = [...it.portions[0].assignedDinerIds]` (documented lossy — first portion's people win) and `delete it.portions` → `undefined`. This is the exact inverse of `splitItem` for a single full-allocation portion. The reversibility test (Split→Merge byte-identical) lives here.

**Files:**
- Modify: `tests/unit/store.test.ts` (inside `store — portions`)
- Modify: `src/state/store.ts` (action `mergePortions`; signature in `StoreState.actions`)
- Test: `tests/unit/store.test.ts`

- [ ] Step 1: Add the failing tests, including the reversibility (byte-identical serialization) test from spec §11 / invariant 7. NOTE: the lossy-adoption test builds its "portion 0 → [shin]" fixture using ONLY actions defined by this point (`splitItem`, `addPortion`, `togglePortionAssignment`) — it must NOT call `assignPortionOnly`, which is defined in a later task. Toggling mei then raj off portion 0 (which starts as the `[]` everyone sentinel) materializes the n−1 list down to exactly `[shin]`:
  ```ts
  it('mergePortions collapses to un-split adopting portions[0] list (lossy)', () => {
    seed()
    const item = round().items[0]! // qty 3; diners [shin, mei, raj]
    a().splitItem(item.id)
    a().addPortion(item.id) // [{2,[]},{1,[]}]
    const [shin, mei, raj] = round().diners
    // Build "portion 0 -> [shin]" using only already-defined actions:
    // portion 0 starts [] (everyone); toggle mei then raj off -> [shin].
    a().togglePortionAssignment(item.id, 0, mei!.id) // -> [shin, raj]
    a().togglePortionAssignment(item.id, 0, raj!.id) // -> [shin]
    expect(round().items[0]!.portions![0]!.assignedDinerIds).toEqual([shin!.id]) // precondition
    a().mergePortions(item.id)
    expect(round().items[0]!.portions).toBeUndefined()
    expect(round().items[0]!.assignedDinerIds).toEqual([shin!.id])
  })

  it('mergePortions is a no-op on an un-split item', () => {
    seed()
    const item = round().items[0]!
    const before = JSON.stringify(round().items[0])
    a().mergePortions(item.id)
    expect(JSON.stringify(round().items[0])).toBe(before)
  })

  it('splitItem then mergePortions yields a byte-identical un-split item (reversibility)', () => {
    seed()
    const item = round().items[0]!
    a().assignOnly(item.id, round().diners[2]!.id) // explicit [raj]
    const before = JSON.stringify(round().items[0])
    a().splitItem(item.id)
    a().mergePortions(item.id)
    expect(JSON.stringify(round().items[0])).toBe(before)
    expect('portions' in round().items[0]!).toBe(false)
  })
  ```
- [ ] Step 2: Add the `mergePortions` signature to `StoreState.actions`, immediately after the `removePortion` signature:
  ```ts
    mergePortions: (itemId: string) => void
  ```
- [ ] Step 3: Run the reversibility test, watch it FAIL: `npx vitest run tests/unit/store.test.ts -t "splitItem then mergePortions yields a byte-identical un-split item (reversibility)"`. Expected failure: `TypeError: useStore.getState().actions.mergePortions is not a function`.
- [ ] Step 4: Implement `mergePortions`. In `src/state/store.ts`, immediately after the `removePortion` action's closing `}),`, add:
  ```ts

        mergePortions: (itemId) =>
          set((s) => {
            const it = s.round.items.find((i) => i.id === itemId)
            if (!it?.portions) return
            it.assignedDinerIds = [...it.portions[0]!.assignedDinerIds]
            delete it.portions
          }),
  ```
- [ ] Step 5: Run all three tests by the substring `mergePortions`, watch them PASS: `npx vitest run tests/unit/store.test.ts -t "mergePortions"`. Expected: `Tests  3 passed (3)` — every test under this substring is self-contained against actions defined by this point, so the run is genuinely green with no later-task dependency. Then re-run the reversibility test alone to confirm coverage: `npx vitest run tests/unit/store.test.ts -t "splitItem then mergePortions yields a byte-identical un-split item (reversibility)"`. Expected: `1 passed`. Note the `delete it.portions` on an immer draft removes the own-property, so `'portions' in item` is `false` (not just `undefined`) — that is what makes the serialization byte-identical.
- [ ] Step 6: Typecheck: `npm run typecheck`. Expected: exit 0.
- [ ] Step 7: Commit. `git add src/state/store.ts tests/unit/store.test.ts && git commit -m "feat(store): mergePortions collapses to un-split, inverse of splitItem

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 30: `togglePortionAssignment` — per-portion sentinel-aware mirror of toggleAssignment

Per spec §4: a per-portion mirror of the item-level toggle (`store.ts:128-140`). `[]` means everyone; toggling off everyone materializes the explicit n−1 list; re-adding the last missing diner collapses back to `[]`; the `>= 1` rule refuses to empty a portion.

**Files:**
- Modify: `tests/unit/store.test.ts` (inside `store — portions`)
- Modify: `src/state/store.ts` (action `togglePortionAssignment`; signature in `StoreState.actions`)
- Test: `tests/unit/store.test.ts`

- [ ] Step 1: Add the failing tests (the three matrix cases from spec §11):
  ```ts
  it('togglePortionAssignment off [] materializes the explicit n-1 list', () => {
    seed()
    const item = round().items[0]! // qty 3
    a().splitItem(item.id) // portion 0 = {3,[]}
    const ids = round().diners.map((d) => d.id)
    a().togglePortionAssignment(item.id, 0, ids[1]!) // toggle Mei off everyone
    expect(round().items[0]!.portions![0]!.assignedDinerIds).toEqual([ids[0], ids[2]])
  })

  it('togglePortionAssignment re-adding the last missing diner collapses to []', () => {
    seed()
    const item = round().items[0]!
    a().splitItem(item.id)
    const mei = round().diners[1]!.id
    a().togglePortionAssignment(item.id, 0, mei) // -> [shin, raj]
    a().togglePortionAssignment(item.id, 0, mei) // re-add -> []
    expect(round().items[0]!.portions![0]!.assignedDinerIds).toEqual([])
  })

  it('togglePortionAssignment refuses to empty a portion (>=1 rule)', () => {
    seed()
    const item = round().items[0]!
    a().splitItem(item.id)
    const [shin, mei, raj] = round().diners
    a().assignPortionOnly(item.id, 0, shin!.id) // portion 0 -> [shin]
    a().togglePortionAssignment(item.id, 0, shin!.id) // would leave nobody -> refused
    expect(round().items[0]!.portions![0]!.assignedDinerIds).toEqual([shin!.id])
    expect(mei && raj).toBeTruthy() // (destructure used)
  })

  it('togglePortionAssignment is a no-op on an un-split item / bad index', () => {
    seed()
    const item = round().items[0]!
    a().togglePortionAssignment(item.id, 0, round().diners[0]!.id) // un-split
    expect(round().items[0]!.portions).toBeUndefined()
    a().splitItem(item.id)
    a().togglePortionAssignment(item.id, 9, round().diners[0]!.id) // bad index
    expect(round().items[0]!.portions![0]!.assignedDinerIds).toEqual([])
  })
  ```
- [ ] Step 2: Add the `togglePortionAssignment` signature to `StoreState.actions`, immediately after the `mergePortions` signature:
  ```ts
    togglePortionAssignment: (itemId: string, portionIndex: number, dinerId: string) => void
  ```
- [ ] Step 3: Run the tests, watch them FAIL: `npx vitest run tests/unit/store.test.ts -t "togglePortionAssignment off [] materializes the explicit n-1 list"`. Expected failure: `TypeError: useStore.getState().actions.togglePortionAssignment is not a function`. (Note: the `refuses to empty` test references `assignPortionOnly`, defined in the next task — that one specific test will error on `assignPortionOnly is not a function` until that task lands; run THIS task by the three named tests that do not need `assignPortionOnly`, per Step 5.)
- [ ] Step 4: Implement `togglePortionAssignment`. In `src/state/store.ts`, immediately after the `mergePortions` action's closing `}),`, add:
  ```ts

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
            if (next.length === 0) return
            const coversEveryone = allIds.length > 0 && allIds.every((id) => next.includes(id))
            p.assignedDinerIds = coversEveryone ? [] : next
          }),
  ```
- [ ] Step 5: Run the three tests that do NOT depend on `assignPortionOnly`, watch them PASS: `npx vitest run tests/unit/store.test.ts -t "togglePortionAssignment off \[\] materializes the explicit n-1 list"`, then `-t "togglePortionAssignment re-adding the last missing diner collapses to \[\]"`, then `-t "togglePortionAssignment is a no-op on an un-split item / bad index"`. Expected: each `1 passed`. The `refuses to empty` test will currently error with `assignPortionOnly is not a function` — that is expected and resolved in the next task. Do NOT delete it.
- [ ] Step 6: Typecheck: `npm run typecheck`. Expected: exit 0.
- [ ] Step 7: Commit. `git add src/state/store.ts tests/unit/store.test.ts && git commit -m "feat(store): togglePortionAssignment, sentinel-aware per-portion toggle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 31: `assignPortionOnly` and `assignPortionEveryone` — per-portion one-tap mirrors

Per spec §4: `assignPortionOnly` mirrors the item-level `assignOnly` (`store.ts:142-148`): set the portion to exactly `[dinerId]`, or `[]` when there is a single diner (everyone == that diner), guarded by `diners.some`. `assignPortionEveryone` mirrors `assignEveryone` (`store.ts:150-154`): set the portion to `[]`.

**Files:**
- Modify: `tests/unit/store.test.ts` (inside `store — portions`)
- Modify: `src/state/store.ts` (actions `assignPortionOnly`, `assignPortionEveryone`; signatures in `StoreState.actions`)
- Test: `tests/unit/store.test.ts`

- [ ] Step 1: Add the failing tests:
  ```ts
  it('assignPortionOnly assigns exactly one diner', () => {
    seed()
    const item = round().items[0]!
    a().splitItem(item.id)
    const raj = round().diners[2]!.id
    a().assignPortionOnly(item.id, 0, raj)
    expect(round().items[0]!.portions![0]!.assignedDinerIds).toEqual([raj])
  })

  it('assignPortionOnly collapses to [] for a single-diner round', () => {
    a().addDiner('Solo')
    a().addItem({ name: 'Tea', qty: 2, unitPrice: cents(300) })
    const item = round().items[0]!
    a().splitItem(item.id)
    a().assignPortionOnly(item.id, 0, round().diners[0]!.id)
    expect(round().items[0]!.portions![0]!.assignedDinerIds).toEqual([])
  })

  it('assignPortionOnly is a no-op for an unknown diner id', () => {
    seed()
    const item = round().items[0]!
    a().splitItem(item.id)
    a().assignPortionOnly(item.id, 0, 'ghost')
    expect(round().items[0]!.portions![0]!.assignedDinerIds).toEqual([])
  })

  it('assignPortionEveryone restores the [] sentinel', () => {
    seed()
    const item = round().items[0]!
    a().splitItem(item.id)
    a().assignPortionOnly(item.id, 0, round().diners[2]!.id) // -> [raj]
    a().assignPortionEveryone(item.id, 0)
    expect(round().items[0]!.portions![0]!.assignedDinerIds).toEqual([])
  })
  ```
- [ ] Step 2: Add both signatures to `StoreState.actions`, immediately after the `togglePortionAssignment` signature:
  ```ts
    assignPortionOnly: (itemId: string, portionIndex: number, dinerId: string) => void
    assignPortionEveryone: (itemId: string, portionIndex: number) => void
  ```
- [ ] Step 3: Run the tests, watch them FAIL: `npx vitest run tests/unit/store.test.ts -t "assignPortionOnly assigns exactly one diner"`. Expected failure: `TypeError: useStore.getState().actions.assignPortionOnly is not a function`.
- [ ] Step 4: Implement both actions. In `src/state/store.ts`, immediately after the `togglePortionAssignment` action's closing `}),`, add:
  ```ts

        assignPortionOnly: (itemId, portionIndex, dinerId) =>
          set((s) => {
            const it = s.round.items.find((i) => i.id === itemId)
            const p = it?.portions?.[portionIndex]
            if (p && s.round.diners.some((d) => d.id === dinerId)) {
              p.assignedDinerIds = s.round.diners.length === 1 ? [] : [dinerId]
            }
          }),

        assignPortionEveryone: (itemId, portionIndex) =>
          set((s) => {
            const p = s.round.items.find((i) => i.id === itemId)?.portions?.[portionIndex]
            if (p) p.assignedDinerIds = []
          }),
  ```
- [ ] Step 5: Run the four new tests, watch them PASS: `npx vitest run tests/unit/store.test.ts -t "assignPortion"`. Expected: `Tests  4 passed (4)`. Then re-run the previously-deferred toggle test, now green: `npx vitest run tests/unit/store.test.ts -t "togglePortionAssignment refuses to empty a portion (>=1 rule)"`. Expected: `1 passed`.
- [ ] Step 6: Run the full store file to confirm everything so far is green together: `npx vitest run tests/unit/store.test.ts`. Expected: the file passes with zero failures (the prior 13 plus all portions tests added so far).
- [ ] Step 7: Typecheck: `npm run typecheck`. Expected: exit 0.
- [ ] Step 8: Commit. `git add src/state/store.ts tests/unit/store.test.ts && git commit -m "feat(store): assignPortionOnly and assignPortionEveryone per-portion one-tap

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 32: Extend `removeDiner` — strip id from every portion list, matching the SHIPPED code

Per spec §4, §10 and the risk register: the existing item-level loop (`store.ts:96-104`) filters only and NEVER re-collapses (the `store.ts:102` comment is aspirational). The portion mirror MUST match the code: strip the id from every explicit (`length !== 0`) portion list; an emptied list becomes `[]` (which the engine reads as everyone, re-billing survivors); an n−1 list stays explicit. Early-out on `!item.portions`. Tests assert the SPLIT OUTCOME via `splitBill`, not just array shape.

**Files:**
- Modify: `tests/unit/store.test.ts` (inside `store — portions`)
- Modify: `src/state/store.ts` (action `removeDiner` at `store.ts:96-104`)
- Test: `tests/unit/store.test.ts`

- [ ] Step 1: First confirm the existing item-level tripwire still passes BEFORE any change (it must stay byte-identical): `npx vitest run tests/unit/store.test.ts -t "removeDiner strips explicit assignments"`. Expected: `1 passed`.
- [ ] Step 2: This is the first store test to use `splitBill`, so add its import now — in `tests/unit/store.test.ts`, immediately after the existing `import { emptyRound, useStore } from '@/state/store'` line, add `import { splitBill } from '@/math/splitBill'`. Then add the failing tests for the portion-level behaviour. The outcome tests build a 2-portion item, remove a diner, and assert via `splitBill`:
  ```ts
  it('removeDiner strips the id from every explicit portion list', () => {
    seed()
    const item = round().items[0]! // qty 3
    a().splitItem(item.id)
    a().addPortion(item.id) // [{2,[]},{1,[]}]
    const [shin, mei, raj] = round().diners
    a().togglePortionAssignment(item.id, 0, raj!.id) // portion 0 -> [shin, mei]
    a().togglePortionAssignment(item.id, 1, raj!.id) // portion 1 -> [shin, mei]
    a().removeDiner(shin!.id)
    expect(round().items[0]!.portions![0]!.assignedDinerIds).toEqual([mei!.id])
    expect(round().items[0]!.portions![1]!.assignedDinerIds).toEqual([mei!.id])
  })

  it('removeDiner emptying a portion list resets it to [] and re-bills survivors', () => {
    seed()
    const item = round().items[0]! // qty 3 @ 900 => 2700 line
    a().splitItem(item.id) // single portion {3,[]}
    const [shin, mei, raj] = round().diners
    a().assignPortionOnly(item.id, 0, shin!.id) // portion 0 -> [shin] only
    a().removeDiner(shin!.id) // empties the explicit list -> []
    expect(round().items[0]!.portions![0]!.assignedDinerIds).toEqual([])
    // OUTCOME (not array shape): [] = everyone => the 2700 line re-bills the
    // two survivors (mei, raj) equally: 1350 each, nobody dropped.
    const split = splitBill(round())
    const meiSplit = split.perDiner.find((p) => p.dinerId === mei!.id)!
    const rajSplit = split.perDiner.find((p) => p.dinerId === raj!.id)!
    expect(meiSplit.food).toBe(cents(1350))
    expect(rajSplit.food).toBe(cents(1350))
  })

  it('removeDiner leaves an n-1 explicit portion list NOT collapsed to []', () => {
    seed()
    const item = round().items[0]! // qty 3
    a().splitItem(item.id) // single portion {3,[]}
    const [shin, mei, raj] = round().diners
    a().togglePortionAssignment(item.id, 0, raj!.id) // -> [shin, mei] (n-1 explicit)
    a().removeDiner(shin!.id) // -> [mei]; must stay explicit, NOT collapse to []
    expect(round().items[0]!.portions![0]!.assignedDinerIds).toEqual([mei!.id])
  })

  it('removeDiner is a no-op on portions for an un-split round (tripwire byte-identical)', () => {
    seed()
    const item = round().items[0]!
    a().removeDiner(round().diners[0]!.id)
    expect(round().items[0]!.portions).toBeUndefined()
  })
  ```
- [ ] Step 3: Run the new tests, watch the FIRST two FAIL (the portion lists are not yet touched by `removeDiner`). `npx vitest run tests/unit/store.test.ts -t "removeDiner strips the id from every explicit portion list"`. Expected failure: `AssertionError: expected [ 'shin-id', 'mei-id' ] to deeply equal [ 'mei-id' ]` (the current `removeDiner` leaves portion lists untouched, so `shin` is still present).
- [ ] Step 4: Extend `removeDiner`. In `src/state/store.ts`, replace the entire current action body (`store.ts:96-104`):
  ```ts
        removeDiner: (id) =>
          set((s) => {
            s.round.diners = s.round.diners.filter((d) => d.id !== id)
            for (const item of s.round.items) {
              if (item.assignedDinerIds.length === 0) continue
              item.assignedDinerIds = item.assignedDinerIds.filter((a) => a !== id)
              // Nobody left on the item → back to "everyone".
            }
          }),
  ```
  with:
  ```ts
        removeDiner: (id) =>
          set((s) => {
            s.round.diners = s.round.diners.filter((d) => d.id !== id)
            for (const item of s.round.items) {
              if (item.assignedDinerIds.length !== 0)
                item.assignedDinerIds = item.assignedDinerIds.filter((a) => a !== id)
              if (!item.portions) continue
              for (const p of item.portions) {
                if (p.assignedDinerIds.length === 0) continue
                p.assignedDinerIds = p.assignedDinerIds.filter((a) => a !== id)
              }
            }
          }),
  ```
- [ ] Step 5: Run all four new tests, watch them PASS: `npx vitest run tests/unit/store.test.ts -t "removeDiner"`. Expected: all `removeDiner` tests green, including the original `removeDiner strips explicit assignments` tripwire (`store.test.ts:33-40`) which must still pass byte-identically — confirm it explicitly: `npx vitest run tests/unit/store.test.ts -t "removeDiner strips explicit assignments"` → `1 passed`.
- [ ] Step 6: Typecheck: `npm run typecheck`. Expected: exit 0.
- [ ] Step 7: Commit. `git add src/state/store.ts tests/unit/store.test.ts && git commit -m "feat(store): removeDiner strips id from portion lists, matching shipped filter-only behavior

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 33: Add the late-add-diner outcome test (`addDiner` untouched, mechanism verified)

Per spec §10 ("Diner lifecycle × portions") and §11: `addDiner` is untouched, but the OUTCOME must be pinned — a diner added AFTER a split pays a share of every `[]`-sentinel portion and ZERO of every explicit-list portion. This is the exact mechanism by which "M added late is still treated." Asserted via `splitBill`. No production change in this task — it locks `addDiner`'s untouched contract.

**Files:**
- Modify: `tests/unit/store.test.ts` (inside `store — portions`)
- Test: `tests/unit/store.test.ts`

- [ ] Step 1: Add the failing/locking test. Build an item with one explicit portion and one `[]`-sentinel portion, add a diner afterwards, and split:
  ```ts
  it('a diner added after a split shares [] portions but zero of explicit portions', () => {
    seed() // Shin, Mei, Raj + Beer qty 3 @ 900
    const item = round().items[0]!
    a().splitItem(item.id) // {3, []}
    a().addPortion(item.id) // [{2,[]},{1,[]}]
    const [shin, mei, raj] = round().diners
    // portion 0 explicit [shin,mei,raj]; portion 1 stays [] (everyone)
    a().togglePortionAssignment(item.id, 0, shin!.id) // [mei,raj]
    a().togglePortionAssignment(item.id, 0, shin!.id) // re-add -> [shin,mei,raj] explicit
    a().assignPortionEveryone(item.id, 1) // portion 1 = [] sentinel
    // Now add M LATE.
    a().addDiner('M')
    const m = round().diners[3]!
    // addDiner must not have mutated any portion list.
    expect(round().items[0]!.portions![0]!.assignedDinerIds).toEqual([shin!.id, mei!.id, raj!.id])
    expect(round().items[0]!.portions![1]!.assignedDinerIds).toEqual([])
    // OUTCOME: portion 1 (1 unit @ 900 = 900) splits across all 4 incl. M;
    // portion 0 (2 units @ 900 = 1800) excludes M.
    const split = splitBill(round())
    const mSplit = split.perDiner.find((p) => p.dinerId === m.id)!
    // M's only food is a 4-way share of 900: distributeProportionally(900,[1,1,1,1]) -> 225 each.
    expect(mSplit.food).toBe(cents(225))
  })
  ```
- [ ] Step 2: Run the test, watch it PASS immediately (no production change — `addDiner` already leaves portions untouched and the engine already handles it via Phases 1-2 + the actions above): `npx vitest run tests/unit/store.test.ts -t "a diner added after a split shares \[\] portions but zero of explicit portions"`. Expected: `1 passed`. If it FAILS, that signals a real regression in `addDiner` or the engine — STOP and investigate before proceeding (this is a deliberate tripwire, not a TDD red step).
- [ ] Step 3: Commit. `git add tests/unit/store.test.ts && git commit -m "test(store): lock late-added-diner mechanism (shares [] portions, treated on explicit)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 34: Guard `updateItem` — drop portions only on a real qty value change

Per spec §4, §10 and the risk register: when `patch.qty` changes the VALUE (`patch.qty !== it.qty`, NOT `'qty' in patch`) on a portioned item, drop `portions` to undefined (a qty edit breaks units-conservation). Re-saving the SAME qty must preserve portions. A name/unitPrice-only patch preserves portions.

**Files:**
- Modify: `tests/unit/store.test.ts` (inside `store — portions`)
- Modify: `src/state/store.ts` (action `updateItem` at `store.ts:111-115`)
- Test: `tests/unit/store.test.ts`

- [ ] Step 1: Add the failing tests (the three §11 cases: qty-change drops, same-qty preserves, other-field preserves):
  ```ts
  it('updateItem changing qty on a portioned item drops portions', () => {
    seed()
    const item = round().items[0]! // qty 3
    a().splitItem(item.id)
    a().updateItem(item.id, { qty: 4 })
    expect(round().items[0]!.portions).toBeUndefined()
    expect(round().items[0]!.qty).toBe(4)
  })

  it('updateItem re-saving the SAME qty preserves portions (value-compare)', () => {
    seed()
    const item = round().items[0]! // qty 3
    a().splitItem(item.id)
    a().updateItem(item.id, { qty: 3 }) // same value -> must NOT drop
    expect(round().items[0]!.portions).toEqual([{ units: 3, assignedDinerIds: [] }])
  })

  it('updateItem patching name/unitPrice preserves portions', () => {
    seed()
    const item = round().items[0]! // qty 3
    a().splitItem(item.id)
    a().updateItem(item.id, { name: 'Lager', unitPrice: cents(1000) })
    expect(round().items[0]!.portions).toEqual([{ units: 3, assignedDinerIds: [] }])
    expect(round().items[0]!.name).toBe('Lager')
    expect(round().items[0]!.unitPrice).toBe(cents(1000))
  })
  ```
- [ ] Step 2: Run the qty-change test, watch it FAIL (current `updateItem` just `Object.assign`s and never drops portions): `npx vitest run tests/unit/store.test.ts -t "updateItem changing qty on a portioned item drops portions"`. Expected failure: `AssertionError: expected [ { units: 3, assignedDinerIds: [] } ] to be undefined` (Object.assign only touches qty, so the portion array survives — it is not `undefined`).
- [ ] Step 3: Guard `updateItem`. In `src/state/store.ts`, replace the current action body (`store.ts:111-115`):
  ```ts
        updateItem: (id, patch) =>
          set((s) => {
            const it = s.round.items.find((i) => i.id === id)
            if (it) Object.assign(it, patch)
          }),
  ```
  with:
  ```ts
        updateItem: (id, patch) =>
          set((s) => {
            const it = s.round.items.find((i) => i.id === id)
            if (!it) return
            if (patch.qty !== undefined && patch.qty !== it.qty && it.portions) delete it.portions
            Object.assign(it, patch)
          }),
  ```
- [ ] Step 4: Run all three tests, watch them PASS: `npx vitest run tests/unit/store.test.ts -t "updateItem"`. Expected: `Tests  3 passed (3)`.
- [ ] Step 5: Typecheck: `npm run typecheck`. Expected: exit 0.
- [ ] Step 6: Commit. `git add src/state/store.ts tests/unit/store.test.ts && git commit -m "feat(store): updateItem drops portions only on a real qty value change

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 35: Lock override-precedence — item-level assignment is dormant while portioned

Per spec §11 ("item-level `toggleAssignment`/`assignOnly`/`assignEveryone` leave `splitBill` output unchanged while portioned [override precedence]") and §4 "Untouched / dormant". No production change — `isPortioned` (Phase 1) already makes the engine ignore `item.assignedDinerIds` while portioned. This test pins that the dormant item-level actions cannot change the split.

**Files:**
- Modify: `tests/unit/store.test.ts` (inside `store — portions`)
- Test: `tests/unit/store.test.ts`

- [ ] Step 1: Add the locking test:
  ```ts
  it('item-level assignment is dormant while portioned (split output unchanged)', () => {
    seed()
    const item = round().items[0]! // qty 3 @ 900
    a().splitItem(item.id) // portion {3, []} = everyone
    const before = JSON.stringify(splitBill(round()).perDiner)
    const [shin] = round().diners
    a().toggleAssignment(item.id, shin!.id) // mutates dormant assignedDinerIds
    a().assignOnly(item.id, shin!.id) // mutates dormant assignedDinerIds
    a().assignEveryone(item.id) // mutates dormant assignedDinerIds
    const after = JSON.stringify(splitBill(round()).perDiner)
    expect(after).toBe(before)
  })
  ```
- [ ] Step 2: Run the test, watch it PASS immediately (override precedence is already enforced by `isPortioned` in the engine — the dormant `assignedDinerIds` writes are invisible to `splitBill`): `npx vitest run tests/unit/store.test.ts -t "item-level assignment is dormant while portioned (split output unchanged)"`. Expected: `1 passed`. If it FAILS, the engine is reading `assignedDinerIds` on a portioned item — STOP and check Phase 2's `isPortioned` branch.
- [ ] Step 3: Commit. `git add tests/unit/store.test.ts && git commit -m "test(store): lock override-precedence — item-level assignment dormant while portioned

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

### Task 36: Phase 3 done-criteria — full suite green + typecheck exit 0

Per spec §12 Phase 3 done-criteria: all store tests green; `store.test.ts:33-40` (removeDiner tripwire) passes byte-identically; reversibility test passes; nothing else regressed.

**Files:**
- (verification only — no source change)

- [ ] Step 1: Run the entire store test file: `npx vitest run tests/unit/store.test.ts`. Expected: the file passes with zero failures, no skips. Confirm the summary line reports `0 failed` and that every `store — portions` test added across this phase is present and green (it grows from the 13 baseline tests by every portions test added above).
- [ ] Step 2: Confirm the un-split tripwire is byte-identically green by name: `npx vitest run tests/unit/store.test.ts -t "removeDiner strips explicit assignments"`. Expected: `1 passed`.
- [ ] Step 3: Confirm the reversibility test is green by name: `npx vitest run tests/unit/store.test.ts -t "splitItem then mergePortions yields a byte-identical un-split item (reversibility)"`. Expected: `1 passed`.
- [ ] Step 4: Run the FULL suite to prove no cross-file regression: `npm test`. Expected: the summary reports `0 failed` (zero test failures) and every NEW `store — portions` test added in this phase passes. Do NOT assert any absolute Test Files / Tests total — the cumulative count grows as earlier phases land; only verify there are zero failures and that the previously-skipped integration file remains skipped exactly as in the prior baseline (no new skips introduced by this phase).
- [ ] Step 5: Typecheck the whole project: `npm run typecheck`. Expected: exit 0, no output.
- [ ] Step 6: Final phase commit (empty if everything was already committed per-task, otherwise stages any stragglers). `git add -A && git commit -m "chore(store): Phase 3 store actions complete — suite green, typecheck clean

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>" --allow-empty`

---

## Phase 4 — Workspace UI (pure-helper tested + manual verify)

## Phase 4 — Workspace UI (pure-helper tested + manual verify)

> **Reads from earlier phases (already landed, do NOT re-implement):**
> - `src/state/types.ts` exports `interface Portion { units:number; assignedDinerIds:string[] }`, `Item.portions?:Portion[]`, `isPortioned(it)`, `portionTotal(unitPrice,units)`, `canAddPortion(it)`, `lineTotal(it)` (Phase 1).
> - `src/state/store.ts` `actions` already expose `splitItem`, `addPortion`, `setPortionUnits`, `removePortion`, `mergePortions`, `togglePortionAssignment`, `assignPortionOnly`, `assignPortionEveryone`, and the guarded `updateItem`/`removeDiner` (Phase 3).
>
> **Locked test strategy:** the ONLY new automated tests are node-only pure-logic tests in `tests/unit/portionView.test.ts`. Do NOT add `@testing-library/react`, `jsdom`, or any dependency. Components are thin wrappers over the tested helpers + the Phase-3 actions; their rendering is checked by the final MANUAL VERIFICATION task.
>
> **Baseline before starting:** the suite grows cumulatively as earlier phases land — Phases 1-3 each add test files and tests, so the absolute file/test totals are LARGER than the project's original 15-file / 129-test baseline by the time this phase runs. Do NOT gate on a fixed total. The gate after every task is: `npm test` reports **zero failures** (and the specific new tests this phase names pass) and `npm run typecheck` exits 0. The un-split rendering path must stay byte-identical.

---

### Task 37: Pure view helpers — portionWho + portionRowVM (the only automated UI tests)

Extract every decision the portion UI makes into pure functions so they are node-testable. `portionWho` produces the subline "who" label (§7.4: `[]`→"everyone"; ≤2 names→joined names; 3+→"N people"). `portionRowVM` builds the per-portion view-model the editor/list rows need (resolved member set + dots + the unit-noun) without touching React or the store.

**Files:**
- Create: `src/features/workspace/portionView.ts`
- Test: `tests/unit/portionView.test.ts`

- [ ] Step 1: Create the failing test file `tests/unit/portionView.test.ts` with this exact content:
```ts
import { describe, it, expect } from 'vitest'
import type { Diner } from '@/state/types'
import { portionWho, portionRowVM } from '@/features/workspace/portionView'

const diners: Diner[] = [
  { id: 'p1', name: 'P1', colorIdx: 0 },
  { id: 'p2', name: 'P2', colorIdx: 1 },
  { id: 'p3', name: 'P3', colorIdx: 2 },
  { id: 'm', name: 'M', colorIdx: 3 },
]

describe('portionWho', () => {
  it('renders the [] sentinel as "everyone"', () => {
    expect(portionWho({ units: 1, assignedDinerIds: [] }, diners)).toBe('everyone')
  })

  it('joins one or two names', () => {
    expect(portionWho({ units: 1, assignedDinerIds: ['p1'] }, diners)).toBe('P1')
    expect(portionWho({ units: 1, assignedDinerIds: ['p1', 'p2'] }, diners)).toBe('P1, P2')
  })

  it('collapses 3+ explicit names to "N people"', () => {
    expect(portionWho({ units: 2, assignedDinerIds: ['p1', 'p2', 'p3'] }, diners)).toBe('3 people')
  })

  it('drops ids that no longer resolve, then re-labels', () => {
    expect(portionWho({ units: 1, assignedDinerIds: ['p1', 'ghost'] }, diners)).toBe('P1')
  })

  it('treats an all-unknown explicit list as no-one (skipped slice)', () => {
    expect(portionWho({ units: 1, assignedDinerIds: ['ghost'] }, diners)).toBe('no one')
  })
})

describe('portionRowVM', () => {
  it('resolves the [] sentinel to every diner and dots all of them', () => {
    const vm = portionRowVM({ units: 2, assignedDinerIds: [] }, diners)
    expect(vm.memberIds).toEqual(['p1', 'p2', 'p3', 'm'])
    expect(vm.dots.map((d) => d.id)).toEqual(['p1', 'p2', 'p3', 'm'])
    expect(vm.unitNoun).toBe('2 units')
  })

  it('marks explicit members on, others off, preserving diner order', () => {
    const vm = portionRowVM({ units: 1, assignedDinerIds: ['p2'] }, diners)
    expect(vm.memberIds).toEqual(['p2'])
    expect(vm.rows.map((r) => [r.id, r.on])).toEqual([
      ['p1', false],
      ['p2', true],
      ['p3', false],
      ['m', false],
    ])
    expect(vm.unitNoun).toBe('1 unit')
  })

  it('lockedLast is true only when exactly one member is on', () => {
    const solo = portionRowVM({ units: 1, assignedDinerIds: ['p1'] }, diners)
    expect(solo.rows.find((r) => r.id === 'p1')!.lockedLast).toBe(true)
    const shared = portionRowVM({ units: 2, assignedDinerIds: ['p1', 'p2'] }, diners)
    expect(shared.rows.find((r) => r.id === 'p1')!.lockedLast).toBe(false)
  })

  it('caps dots at 5 and reports the overflow count', () => {
    const many: Diner[] = Array.from({ length: 7 }, (_, i) => ({
      id: `d${i}`,
      name: `D${i}`,
      colorIdx: i,
    }))
    const vm = portionRowVM({ units: 1, assignedDinerIds: [] }, many)
    expect(vm.dots).toHaveLength(5)
    expect(vm.overflow).toBe(2)
  })
})
```

- [ ] Step 2: Run the test and confirm it FAILS because the module does not exist yet:
```
npx vitest run tests/unit/portionView.test.ts
```
Expected output contains:
```
Error: Failed to resolve import "@/features/workspace/portionView"
```
and the run ends with `Test Files  1 failed (1)`.

- [ ] Step 3: Create `src/features/workspace/portionView.ts` with this exact content:
```ts
import { DINER_COLORS } from '@/state/colors'
import type { Diner, Portion } from '@/state/types'

/** Resolve a portion's participant list against the current diners.
 *  `[]` is the everyone sentinel → all current ids. An explicit list is
 *  filtered to ids that still exist (mirrors the engine's resolve rule:
 *  the []-check happens BEFORE the filter, so literal-[] and
 *  all-unknown-after-filter stay distinct). */
export function resolveMembers(portion: Portion, diners: Diner[]): string[] {
  if (portion.assignedDinerIds.length === 0) return diners.map((d) => d.id)
  const live = new Set(diners.map((d) => d.id))
  return portion.assignedDinerIds.filter((id) => live.has(id))
}

/** The subline "who" label (§7.4): `[]` → "everyone"; an all-unknown
 *  explicit list → "no one" (the slice the engine skips); ≤2 names → the
 *  joined names; 3+ → "N people". */
export function portionWho(portion: Portion, diners: Diner[]): string {
  if (portion.assignedDinerIds.length === 0) return 'everyone'
  const names = diners.filter((d) => portion.assignedDinerIds.includes(d.id)).map((d) => d.name)
  if (names.length === 0) return 'no one'
  if (names.length <= 2) return names.join(', ')
  return `${names.length} people`
}

export interface PortionRowVM {
  /** Resolved participant ids (sentinel expanded), in diner order. */
  memberIds: string[]
  /** One entry per diner, in diner order — the toggle list. */
  rows: { id: string; name: string; colorIdx: number; on: boolean; lockedLast: boolean }[]
  /** Avatar dots for the members, capped at 5, in diner order. */
  dots: { id: string; color: string }[]
  /** Members beyond the 5-dot cap. */
  overflow: number
  /** "1 unit" / "N units" — the stepper's read-out noun. */
  unitNoun: string
}

/** The per-portion view-model every row needs, computed once, framework-free. */
export function portionRowVM(portion: Portion, diners: Diner[]): PortionRowVM {
  const memberIds = resolveMembers(portion, diners)
  const memberSet = new Set(memberIds)
  const rows = diners.map((d) => ({
    id: d.id,
    name: d.name,
    colorIdx: d.colorIdx,
    on: memberSet.has(d.id),
    // The ≥1-per-portion rule, made visible: the lone remaining member
    // can't be toggled off (mirrors AssignSheet's lockedLast).
    lockedLast: memberSet.has(d.id) && memberIds.length === 1,
  }))
  const members = diners.filter((d) => memberSet.has(d.id))
  const dots = members.slice(0, 5).map((d) => ({
    id: d.id,
    color: DINER_COLORS[d.colorIdx % DINER_COLORS.length]!,
  }))
  return {
    memberIds,
    rows,
    dots,
    overflow: Math.max(0, members.length - 5),
    unitNoun: portion.units === 1 ? '1 unit' : `${portion.units} units`,
  }
}
```

- [ ] Step 4: Run the test in isolation and confirm THIS file passes all 11 of its tests (an isolated single-file run is exact regardless of how many files the suite has accumulated):
```
npx vitest run tests/unit/portionView.test.ts
```
Expected output ends with:
```
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

- [ ] Step 5: Confirm typecheck and the full suite stay green (un-split path untouched). The cumulative file/test totals are larger than the original baseline because Phases 1-3 already added files — so do NOT assert a fixed total; assert zero failures plus the new file:
```
npm run typecheck && npm test
```
Expected: `tsc` exits 0; the `npm test` summary reports **0 failed** test files and **0 failed** tests, the run includes `tests/unit/portionView.test.ts` among the passing files, and the only skipped suite is the still-skipped integration test. (The absolute counts are higher than the project's original 15-file / 129-test baseline by everything Phases 1-3 added; that is expected — verify zero failures, not a number.)

- [ ] Step 6: Commit:
```
git add src/features/workspace/portionView.ts tests/unit/portionView.test.ts
git commit -m "$(cat <<'EOF'
Phase 4: pure portion view helpers (portionWho, portionRowVM)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 38: AssignSheet — "Split into parts" affordance + isPortioned branch

Add the §7.1 opt-in control (gated `!readOnly && item.qty > 1 && !isPortioned(item)`) and branch the sheet body so a portioned item renders `<PortionEditor>` instead of the toggle list. Lift today's JSX verbatim into a local `UnsplitBody` so the un-split path is provably byte-identical. `PortionEditor` is created in the next task; this task references it. There is no automated test for this file (locked strategy); correctness is verified in the final manual task. The contract: when `isPortioned(item)` is false, the rendered output is identical to today.

**Files:**
- Modify: `src/features/workspace/AssignSheet.tsx` (imports `:1-9`; body branch at `:38-124`)

- [ ] Step 1: Replace the import block (lines 1-9) so it pulls in `Scissors`, `isPortioned`, and the new `PortionEditor`. Find:
```tsx
'use client'
import { Check, PencilLine, Users } from 'lucide-react'
import { useStore } from '@/state/store'
import { DINER_COLORS } from '@/state/colors'
import { lineTotal } from '@/state/types'
import { Money } from '@/components/Money'
import { Sheet } from '@/components/Sheet'
import { Button } from '@/components/Button'
import { cn } from '@/lib/cn'
```
Replace with:
```tsx
'use client'
import { Check, PencilLine, Scissors, Users } from 'lucide-react'
import { useStore } from '@/state/store'
import { DINER_COLORS } from '@/state/colors'
import { isPortioned, lineTotal, type Diner, type Item } from '@/state/types'
import { Money } from '@/components/Money'
import { Sheet } from '@/components/Sheet'
import { Button } from '@/components/Button'
import { cn } from '@/lib/cn'
import { PortionEditor } from './PortionEditor'
```

- [ ] Step 2: Replace the entire `{item && ( … )}` body (the JSX from line 38 `{item && (` through its closing `)}` on line 125) with a branch that picks `PortionEditor` vs the lifted `UnsplitBody`. Find the block that starts:
```tsx
      {item && (
        <div className="flex flex-col gap-4">
          <p className="flex items-baseline justify-between text-small text-cream-dim">
```
…and ends:
```tsx
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      )}
```
Replace that whole block with:
```tsx
      {item &&
        (isPortioned(item) ? (
          <PortionEditor item={item} diners={diners} readOnly={readOnly} onClose={onClose} />
        ) : (
          <UnsplitBody item={item} diners={diners} readOnly={readOnly} onEdit={onEdit} onClose={onClose} />
        ))}
```

- [ ] Step 3: Add the `UnsplitBody` component below the `AssignSheet` function (after its closing `}` on the last line). It is today's JSX verbatim, with the new "Split into parts" affordance inserted between the "Everyone shares this" button and the toggle `<ul>` (§7.1). Append this to the end of the file:
```tsx

/** Today's assign body, lifted verbatim so the un-split path is
 *  byte-identical — plus the one new "Split into parts" affordance. */
function UnsplitBody({
  item,
  diners,
  readOnly,
  onEdit,
  onClose,
}: {
  item: Item
  diners: Diner[]
  readOnly: boolean
  onEdit: (id: string) => void
  onClose: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-baseline justify-between text-small text-cream-dim">
        <span>
          {item.qty > 1 ? `${item.qty} × ` : ''}
          shared by{' '}
          {item.assignedDinerIds.length === 0 ? 'everyone' : `${item.assignedDinerIds.length} of ${diners.length}`}
        </span>
        <Money cents={lineTotal(item)} className="text-cream" />
      </p>

      {!readOnly && item.assignedDinerIds.length > 0 && (
        <button
          type="button"
          onClick={() => useStore.getState().actions.assignEveryone(item.id)}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line text-small text-cream-dim hover:border-cream-dim hover:text-cream"
        >
          <Users size={15} aria-hidden /> Everyone shares this
        </button>
      )}

      {!readOnly && item.qty > 1 && !isPortioned(item) && (
        <button
          type="button"
          onClick={() => useStore.getState().actions.splitItem(item.id)}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line text-small text-cream-dim hover:border-cream-dim hover:text-cream"
        >
          <Scissors size={15} aria-hidden /> Split into parts
        </button>
      )}

      <ul className="flex flex-col gap-2" aria-label="Who shares this item">
        {diners.map((d) => {
          const activeIds =
            item.assignedDinerIds.length === 0
              ? diners.map((x) => x.id)
              : item.assignedDinerIds
          const on = activeIds.includes(d.id)
          // The ≥1 rule, made visible: the last person on an item
          // can't be toggled off — switch someone else on, or use Only.
          const lockedLast = on && activeIds.length === 1
          return (
            <li key={d.id} className="flex items-stretch gap-2">
              <button
                type="button"
                aria-pressed={on}
                disabled={readOnly || lockedLast}
                title={lockedLast ? 'Every item needs at least one person' : undefined}
                onClick={() => useStore.getState().actions.toggleAssignment(item.id, d.id)}
                className={cn(
                  'flex min-h-12 flex-1 items-center gap-3 rounded-xl border px-4 text-left text-body transition-colors',
                  on
                    ? 'border-cream-dim bg-ink-3 text-cream'
                    : 'border-line bg-transparent text-cream-faint',
                  lockedLast && !readOnly && 'cursor-default opacity-90',
                )}
              >
                <span
                  className="h-3 w-3 rounded-full"
                  style={{
                    background: DINER_COLORS[d.colorIdx % DINER_COLORS.length],
                    opacity: on ? 1 : 0.35,
                  }}
                  aria-hidden
                />
                <span className="flex-1" id={`assign-name-${d.id}`}>
                  {d.name}
                </span>
                {on && <Check size={16} className="text-good" aria-hidden />}
              </button>
              {!readOnly && diners.length > 1 && !lockedLast && (
                <button
                  type="button"
                  aria-describedby={`assign-name-${d.id}`}
                  title={`Assign only to ${d.name}`}
                  onClick={() => useStore.getState().actions.assignOnly(item.id, d.id)}
                  className="min-h-12 rounded-xl border border-line px-3 text-small text-cream-faint transition-colors hover:border-cream-dim hover:text-cream"
                >
                  Only
                </button>
              )}
            </li>
          )
        })}
      </ul>

      <div className="flex items-center justify-between gap-2">
        {!readOnly ? (
          <Button variant="ghost" onClick={() => onEdit(item.id)}>
            <PencilLine size={16} aria-hidden /> Edit item
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={onClose}>Done</Button>
      </div>
    </div>
  )
}
```

- [ ] Step 2 note — the `AssignSheet` function still owns `const items/diners/readOnly` and `const item = items.find(...)`; those lines (`:25-28`) are unchanged. Only the JSX body and the import block change.

- [ ] Step 3: This file will not typecheck until `PortionEditor.tsx` exists (next task creates it). Do NOT run typecheck/commit yet — proceed to the PortionEditor task, which ends with the typecheck + commit covering both files together.

---

### Task 39: PortionEditor — the per-portion editing surface (§7.2)

New component using the `PctStepper` ± idiom (`ChargesSection.tsx:16-55`, `h-8 w-8` buttons in a `min-h-11` row) wired to the Phase-3 actions: stepper → `setPortionUnits`, sentinel-aware toggle → `togglePortionAssignment`, `Only` → `assignPortionOnly`, `Everyone shares this part` → `assignPortionEveryone`, `Add part` (disabled per `canAddPortion`) → `addPortion`, `Remove part` (only when >1) → `removePortion`, `Merge back` → `mergePortions` with the lossy note, plus the units sum bar (`aria-live`). Every member-resolution decision routes through the tested `portionRowVM`; `portionTotal`/`canAddPortion` come from `types.ts`. There is no automated test for this file (locked strategy) — its logic is the tested helper + tested store actions; rendering is verified manually at the end of the phase.

**Files:**
- Create: `src/features/workspace/PortionEditor.tsx`
- Test: none (logic lives in `portionView.ts` + store actions, already tested)

- [ ] Step 1: Create `src/features/workspace/PortionEditor.tsx` with this exact content:
```tsx
'use client'
import { Check, Combine, Minus, Plus, Users, X } from 'lucide-react'
import { useStore } from '@/state/store'
import { canAddPortion, portionTotal, portionedUnits, type Diner, type Item } from '@/state/types'
import { Money } from '@/components/Money'
import { Button } from '@/components/Button'
import { cn } from '@/lib/cn'
import { portionRowVM } from './portionView'

/**
 * The second mode of AssignSheet: a portioned item is edited part-by-part.
 * Every member decision is computed by the tested `portionRowVM`; every
 * mutation is a tested store action. This file is a thin view over both.
 */
export function PortionEditor({
  item,
  diners,
  readOnly,
  onClose,
}: {
  item: Item
  diners: Diner[]
  readOnly: boolean
  onClose: () => void
}) {
  const portions = item.portions ?? []
  const covered = portionedUnits(item)
  const a = () => useStore.getState().actions

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-baseline justify-between text-small text-cream-dim">
        <span>
          {item.qty} × · split into {portions.length} {portions.length === 1 ? 'part' : 'parts'}
        </span>
        <Money cents={lineTotalFromItem(item)} className="text-cream" />
      </p>

      <ul className="flex flex-col gap-3">
        {portions.map((p, idx) => {
          const vm = portionRowVM(p, diners)
          return (
            <li key={idx} className="rounded-xl border border-line p-3">
              <div className="flex min-h-11 items-center justify-between gap-2">
                <span className="text-body text-cream">Part {idx + 1}</span>
                <span className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Fewer units in part ${idx + 1}`}
                    disabled={readOnly || p.units <= 1}
                    onClick={() => a().setPortionUnits(item.id, idx, p.units - 1)}
                    className="grid h-8 w-8 place-items-center rounded-full border border-line text-cream-dim hover:bg-ink-3 disabled:opacity-30"
                  >
                    <Minus size={13} aria-hidden />
                  </button>
                  <span className="money w-16 text-center text-small text-cream">{vm.unitNoun}</span>
                  <button
                    type="button"
                    aria-label={`More units in part ${idx + 1}`}
                    disabled={readOnly}
                    onClick={() => a().setPortionUnits(item.id, idx, p.units + 1)}
                    className="grid h-8 w-8 place-items-center rounded-full border border-line text-cream-dim hover:bg-ink-3 disabled:opacity-30"
                  >
                    <Plus size={13} aria-hidden />
                  </button>
                  {!readOnly && portions.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Remove part ${idx + 1}`}
                      onClick={() => a().removePortion(item.id, idx)}
                      className="ml-1 grid h-8 w-8 place-items-center rounded-full border border-line text-cream-faint hover:border-bad/50 hover:text-bad"
                    >
                      <X size={14} aria-hidden />
                    </button>
                  )}
                </span>
              </div>

              <div className="mt-1 flex justify-end">
                <Money cents={portionTotal(item.unitPrice, p.units)} className="text-small text-cream-dim" />
              </div>

              <ul className="mt-2 flex flex-col gap-2" aria-label={`Who shares part ${idx + 1}`}>
                {vm.rows.map((r) => (
                  <li key={r.id} className="flex items-stretch gap-2">
                    <button
                      type="button"
                      aria-pressed={r.on}
                      disabled={readOnly || r.lockedLast}
                      title={r.lockedLast ? 'Every part needs at least one person' : undefined}
                      onClick={() => a().togglePortionAssignment(item.id, idx, r.id)}
                      className={cn(
                        'flex min-h-12 flex-1 items-center gap-3 rounded-xl border px-4 text-left text-body transition-colors',
                        r.on
                          ? 'border-cream-dim bg-ink-3 text-cream'
                          : 'border-line bg-transparent text-cream-faint',
                        r.lockedLast && !readOnly && 'cursor-default opacity-90',
                      )}
                    >
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{
                          background: DINER_COLORS[r.colorIdx % DINER_COLORS.length],
                          opacity: r.on ? 1 : 0.35,
                        }}
                        aria-hidden
                      />
                      <span className="flex-1">{r.name}</span>
                      {r.on && <Check size={16} className="text-good" aria-hidden />}
                    </button>
                    {!readOnly && diners.length > 1 && !r.lockedLast && (
                      <button
                        type="button"
                        title={`Only ${r.name} on part ${idx + 1}`}
                        onClick={() => a().assignPortionOnly(item.id, idx, r.id)}
                        className="min-h-12 rounded-xl border border-line px-3 text-small text-cream-faint transition-colors hover:border-cream-dim hover:text-cream"
                      >
                        Only
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              {!readOnly && p.assignedDinerIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => a().assignPortionEveryone(item.id, idx)}
                  className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line text-small text-cream-dim hover:border-cream-dim hover:text-cream"
                >
                  <Users size={15} aria-hidden /> Everyone shares this part
                </button>
              )}
            </li>
          )
        })}
      </ul>

      <p
        aria-live="polite"
        className={cn(
          'text-small',
          covered === item.qty ? 'text-good' : 'text-bad',
        )}
      >
        {covered === item.qty
          ? `✓ Parts cover ${covered} of ${item.qty} units`
          : `Parts cover ${covered} of ${item.qty} units`}
      </p>

      {!readOnly && (
        <button
          type="button"
          disabled={!canAddPortion(item)}
          onClick={() => a().addPortion(item.id)}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line text-small text-cream-dim hover:border-cream-dim hover:text-cream disabled:opacity-30 disabled:hover:border-line disabled:hover:text-cream-dim"
        >
          <Plus size={15} aria-hidden /> Add part
        </button>
      )}

      {!readOnly && (
        <p className="text-small text-cream-faint">
          Merging keeps the first part&apos;s people for the whole item.
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        {!readOnly ? (
          <Button variant="ghost" onClick={() => a().mergePortions(item.id)}>
            <Combine size={16} aria-hidden /> Merge back
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={onClose}>Done</Button>
      </div>
    </div>
  )
}
```

- [ ] Step 2: The component above references `DINER_COLORS` and a `lineTotalFromItem` helper that are not yet imported. Fix the imports: change the first import lines. Find:
```tsx
'use client'
import { Check, Combine, Minus, Plus, Users, X } from 'lucide-react'
import { useStore } from '@/state/store'
import { canAddPortion, portionTotal, portionedUnits, type Diner, type Item } from '@/state/types'
```
Replace with:
```tsx
'use client'
import { Check, Combine, Minus, Plus, Users, X } from 'lucide-react'
import { useStore } from '@/state/store'
import { DINER_COLORS } from '@/state/colors'
import { canAddPortion, lineTotal, portionTotal, portionedUnits, type Diner, type Item } from '@/state/types'
```

- [ ] Step 3: Replace the `lineTotalFromItem(item)` call with the imported `lineTotal`. Find:
```tsx
        <Money cents={lineTotalFromItem(item)} className="text-cream" />
```
Replace with:
```tsx
        <Money cents={lineTotal(item)} className="text-cream" />
```

- [ ] Step 4: Run typecheck — this proves `AssignSheet.tsx` (which imports `PortionEditor`) and `PortionEditor.tsx` both compile, all prop types line up, and the Phase-3 action signatures match the call sites:
```
npm run typecheck
```
Expected: exits 0 with no output beyond the npm banner. If it reports `Property 'setPortionUnits' does not exist` or similar, Phase 3 has not landed — stop and resolve that dependency before continuing.

- [ ] Step 5: Run the full suite to confirm no node test regressed. The new components are not imported by any test, so the passing count is identical to the previous task's (no test was added or removed) — do NOT assert a fixed total; assert zero failures and an unchanged file count versus the previous task:
```
npm test
```
Expected: the `npm test` summary reports **0 failed** test files and **0 failed** tests, and the number of passing files is unchanged from the end of the previous task (this task adds no test file). The cumulative totals remain whatever Phases 1-3 plus `portionView.test.ts` produced — verify zero failures, not a number.

- [ ] Step 6: Commit both files together:
```
git add src/features/workspace/AssignSheet.tsx src/features/workspace/PortionEditor.tsx
git commit -m "$(cat <<'EOF'
Phase 4: AssignSheet split affordance + PortionEditor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 40: ItemsSection — PortionDots + portioned sublines (§7.4)

A portioned item keeps the same outer tappable button (still opens `AssignSheet`) and gains indented, non-tappable sublines beneath it — one per portion: `{unitNoun} — {portionWho} … {portionTotal} {dots}`. `AvatarDots` is unchanged; a sibling `PortionDots` renders a portion's resolved members (same dot style, `+N` overflow, cap 5) by reusing the tested `portionRowVM`. The "who" text uses the tested `portionWho`. Un-split rows are byte-identical. No automated test (locked strategy); verified manually.

**Files:**
- Modify: `src/features/workspace/ItemsSection.tsx` (imports `:1-6`; AvatarDots `:13-30`; row `:42-58`)

- [ ] Step 1: Replace the import block (lines 1-6). Find:
```tsx
'use client'
import { Plus } from 'lucide-react'
import { useStore } from '@/state/store'
import { DINER_COLORS } from '@/state/colors'
import { lineTotal, type Item } from '@/state/types'
import { Money } from '@/components/Money'
```
Replace with:
```tsx
'use client'
import { Plus } from 'lucide-react'
import { useStore } from '@/state/store'
import { DINER_COLORS } from '@/state/colors'
import { isPortioned, lineTotal, portionTotal, type Item, type Portion } from '@/state/types'
import { Money } from '@/components/Money'
import { portionRowVM, portionWho } from './portionView'
```

- [ ] Step 2: Add a `PortionDots` component immediately after the existing `AvatarDots` function (after its closing `}` on line 30). The `AvatarDots` function itself is unchanged. Insert:
```tsx

/** Avatar dots for ONE portion's resolved members — same look as
 *  AvatarDots, computed by the tested portionRowVM (sentinel/explicit,
 *  +N overflow, cap 5). */
function PortionDots({ portion }: { portion: Portion }) {
  const diners = useStore((s) => s.round.diners)
  const vm = portionRowVM(portion, diners)
  return (
    <span className="ml-2 inline-flex shrink-0 -space-x-1" aria-hidden>
      {vm.dots.map((d) => (
        <span
          key={d.id}
          className="h-2.5 w-2.5 rounded-full ring-1 ring-paper"
          style={{ background: d.color }}
        />
      ))}
      {vm.overflow > 0 && <span className="pl-1.5 text-[10px] text-paper-faint">+{vm.overflow}</span>}
    </span>
  )
}
```

- [ ] Step 3: Replace the row `<li>` body so a portioned item renders its sublines. Find the whole `<li>` block:
```tsx
          <li key={it.id}>
            <button
              type="button"
              onClick={() => onOpenItem(it.id)}
              className="flex w-full min-h-11 items-baseline px-0 py-1.5 text-left font-mono text-receipt hover:bg-paper-2/70"
            >
              <span className="truncate">
                {it.qty > 1 && <span className="text-paper-faint">{it.qty}× </span>}
                {it.name}
              </span>
              <span className="leader" aria-hidden />
              <Money cents={lineTotal(it)} />
              <AvatarDots item={it} />
            </button>
          </li>
```
Replace with:
```tsx
          <li key={it.id}>
            <button
              type="button"
              onClick={() => onOpenItem(it.id)}
              className="flex w-full min-h-11 items-baseline px-0 py-1.5 text-left font-mono text-receipt hover:bg-paper-2/70"
            >
              <span className="truncate">
                {it.qty > 1 && <span className="text-paper-faint">{it.qty}× </span>}
                {it.name}
              </span>
              <span className="leader" aria-hidden />
              <Money cents={lineTotal(it)} />
              {!isPortioned(it) && <AvatarDots item={it} />}
            </button>
            {isPortioned(it) && (
              <ul className="mb-1 flex flex-col" aria-label={`Parts of ${it.name}`}>
                {it.portions!.map((p, idx) => (
                  <li
                    key={idx}
                    className="flex items-baseline pl-6 font-mono text-receipt text-paper-faint"
                  >
                    <span className="truncate">
                      {p.units === 1 ? '1 unit' : `${p.units} units`} — {portionWho(p, diners)}
                    </span>
                    <span className="leader" aria-hidden />
                    <Money cents={portionTotal(it.unitPrice, p.units)} />
                    <PortionDots portion={p} />
                  </li>
                ))}
              </ul>
            )}
          </li>
```

- [ ] Step 4: The new subline reads `diners` inside the `.map`, but the `ItemsSection` function only subscribes to `items`/`readOnly` today. Subscribe to diners too. Find:
```tsx
  const items = useStore((s) => s.round.items)
  const readOnly = useStore((s) => s.readOnly)
```
Replace with:
```tsx
  const items = useStore((s) => s.round.items)
  const diners = useStore((s) => s.round.diners)
  const readOnly = useStore((s) => s.readOnly)
```

- [ ] Step 5: Run typecheck and the full suite. No test imports this component, so the passing count is unchanged from the previous task — do NOT assert a fixed total; assert zero failures:
```
npm run typecheck && npm test
```
Expected: `tsc` exits 0; the `npm test` summary reports **0 failed** test files and **0 failed** tests, and the passing file count is unchanged from the previous task (this task adds no test file). Verify zero failures, not a number.

- [ ] Step 6: Commit:
```
git add src/features/workspace/ItemsSection.tsx
git commit -m "$(cat <<'EOF'
Phase 4: portion sublines + PortionDots in ItemsSection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 41: ItemSheet — qty-edit caution when portioned (§7.5)

When editing a portioned item, show a one-line caution under the qty field — "Changing quantity clears the split." — so the Phase-3 `updateItem` value-compare qty-drop is expected, not surprising. The add flow and the un-split edit flow are untouched (no new required fields). No automated test (locked strategy); verified manually.

**Files:**
- Modify: `src/features/workspace/ItemSheet.tsx` (imports `:1-8`; qty `<Field>` `:82-89`)

- [ ] Step 1: Add `isPortioned` to the types import. Find:
```tsx
import { cents } from '@/math/money'
import { formatSGD, parseDollarInput } from '@/lib/format'
import { useStore } from '@/state/store'
```
Replace with:
```tsx
import { cents } from '@/math/money'
import { formatSGD, parseDollarInput } from '@/lib/format'
import { isPortioned } from '@/state/types'
import { useStore } from '@/state/store'
```

- [ ] Step 2: Add the caution under the qty `<Field>`. Find the qty/price grid:
```tsx
        <div className="grid grid-cols-2 gap-3">
          <Field
            id="item-qty"
            label="Quantity"
            value={qty}
            inputMode="numeric"
            autoComplete="off"
            onChange={(e) => setQty(e.target.value)}
          />
          <Field
            id="item-price"
            label="Line total in dollars"
            value={price}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
```
Replace with:
```tsx
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Field
              id="item-qty"
              label="Quantity"
              value={qty}
              inputMode="numeric"
              autoComplete="off"
              onChange={(e) => setQty(e.target.value)}
            />
            {editing && isPortioned(editing) && (
              <p className="text-small text-cream-faint">Changing quantity clears the split.</p>
            )}
          </div>
          <Field
            id="item-price"
            label="Line total in dollars"
            value={price}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
```

- [ ] Step 3: Run typecheck and the full suite. No test imports this component — do NOT assert a fixed total; assert zero failures:
```
npm run typecheck && npm test
```
Expected: `tsc` exits 0; the `npm test` summary reports **0 failed** test files and **0 failed** tests, and the passing file count is unchanged from the previous task (this task adds no test file). Verify zero failures, not a number.

- [ ] Step 4: Commit:
```
git add src/features/workspace/ItemSheet.tsx
git commit -m "$(cat <<'EOF'
Phase 4: qty-edit caution on portioned items in ItemSheet

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 42: MANUAL VERIFICATION — run the app and reproduce the worked example

There are no DOM/snapshot tests (locked strategy), so this task is the acceptance gate for the whole phase. Start the dev server and click through the §7.3 fareware flow, confirming the rendered UI matches the spec mockups (§7.2, §7.4) and that Merge back returns to a byte-identical un-split item.

**Files:**
- None (verification only)

- [ ] Step 1: Confirm everything still compiles and the node suite is green before starting the server. The cumulative totals are larger than the project's original baseline — do NOT gate on a fixed number; gate on zero failures plus typecheck 0:
```
npm run typecheck && npm test
```
Expected: `tsc` exits 0; the `npm test` summary reports **0 failed** test files and **0 failed** tests (including `tests/unit/portionView.test.ts` among the passing files). The absolute counts reflect everything Phases 1-4 added on top of the original 15-file / 129-test baseline — verify zero failures, not a number.

- [ ] Step 2: Start the dev server (leave it running in its own terminal):
```
npm run dev
```
Expected: Next.js prints `- Local: http://localhost:5173` (the `dev` script is `next dev -H 0.0.0.0 -p 5173`). Open **http://localhost:5173** in a browser.

- [ ] Step 3: Build the worked scenario. On the splash, choose to enter manually. Add four diners in order: **P1, P2, P3, M**. Add one item: name **One36 Pork Adobo w/ Egg**, Quantity **3**, Line total **42.00**.
  - Look for: the receipt row reads `3× One36 Pork Adobo w/ Egg …………… $42.00` with four avatar dots (everyone) at the right.

- [ ] Step 4: Tap the Adobo row to open the assign sheet. Confirm un-split mode is byte-identical to before this phase: the summary line `3 × shared by everyone $42.00`, NO "Everyone shares this" dashed button (it's already everyone), the four-diner toggle list, and the `Edit item` / `Done` footer.
  - Look for: a NEW dashed button **"Split into parts"** with a scissors icon, sitting just above the toggle list.

- [ ] Step 5: Tap **Split into parts**. The sheet body switches to the PortionEditor.
  - Look for: summary `3 × · split into 1 part $42.00`; one card **Part 1** showing `3 units`, `$42.00`, all four diners toggled ON; the units sum bar `✓ Parts cover 3 of 3 units` in green; an `Add part` dashed button; the lossy note "Merging keeps the first part's people for the whole item."; a `Merge back` ghost button and `Done`.

- [ ] Step 6: Tap **Add part**.
  - Look for: now TWO cards — **Part 1** = `2 units` and **Part 2** = `1 unit` (the new slice is carved off the last portion with units ≥ 2). The sum bar still reads `✓ Parts cover 3 of 3 units` (green). Each card now shows an `✕` Remove button next to its stepper.

- [ ] Step 7: On **Part 1**, tap its `−` (minus) once so Part 1 becomes `1 unit` and Part 2 becomes `2 units` (the single-neighbour rebalance from `setPortionUnits`).
  - Look for: Part 1 `1 unit · $14.00`, Part 2 `2 units · $28.00`, sum bar still `✓ Parts cover 3 of 3 units`. The minus on Part 1 is now disabled (units = 1).

- [ ] Step 8: On **Part 1** (the solo unit), tap **Only** next to **P1**.
  - Look for: Part 1's toggle list now shows only P1 checked; P1's row is `lockedLast` (its toggle is non-interactive / dimmed) and the `Only` button on P1 is gone. The receipt subline (visible after closing, verified in Step 11) will read `1 unit — P1`.

- [ ] Step 9: On **Part 2** (the shared 2 units, currently everyone), tap **M** to toggle M OFF.
  - Look for: M's row goes unchecked/faint; P1, P2, P3 stay checked. This materialized the explicit `[P1,P2,P3]` list — M now pays nothing for those 2 units purely by absence. The "Everyone shares this part" dashed button appears (the list is now non-empty/explicit).

- [ ] Step 10: Tap **Done** to close the sheet.

- [ ] Step 11: Inspect the receipt row for the Adobo. It must now render the §7.4 sublines beneath the main row:
```
3×  One36 Pork Adobo w/ Egg ………………………… $42.00
      1 unit  —  P1 ………………………………………… $14.00  ●
      2 units —  3 people ………………………………… $28.00  ●●●
```
  - Look for: the main row no longer shows the four everyone-dots (a portioned item hides `AvatarDots`); each subline is indented, dimmer (`text-paper-faint`), non-tappable, with its own `portionWho` label (`P1`; `3 people` for the explicit P1/P2/P3 list), its `portionTotal` amount, and `PortionDots` (1 dot, then 3 dots).

- [ ] Step 12: Reopen the Adobo (tap the main row) and tap **Merge back**.
  - Look for: the sheet returns to un-split mode — summary `3 × shared by …`, the four-diner toggle list, and the `Split into parts` button reappears. The receipt row's sublines are gone and the everyone-style `AvatarDots` return. This confirms `mergePortions` collapsed the split back to a single un-split item (reversibility — byte-identical serialization to never-split, per spec invariant 7). Tap `Done`.

- [ ] Step 13: Verify the ItemSheet caution (§7.5). Split the Adobo again (Steps 5-9 in brief: Split into parts, then make any per-part change), tap **Done**, reopen the row, tap **Edit item**.
  - Look for: under the **Quantity** field, the caution line **"Changing quantity clears the split."** Change the quantity from 3 to 4 and tap Done; reopen — the item is back to un-split (the `updateItem` value-compare guard dropped the portions because qty changed) and `Split into parts` is offered again.

- [ ] Step 14: Mobile touch-target audit. With the browser devtools device toolbar in a phone viewport, confirm every interactive element in the PortionEditor meets the 44px floor: the stepper `±`/`✕` buttons (`h-8 w-8` inside a `min-h-11` row), each diner toggle (`min-h-12`), the `Only` buttons (`min-h-12`), and the `Add part` / `Everyone shares this part` / `Merge back` / `Done` controls (`min-h-11`+). The sheet itself scrolls (`max-h-[88dvh] overflow-y-auto`) with the footer in thumb reach.

- [ ] Step 15: Stop the dev server (Ctrl-C in its terminal). Record the result of the click-through (each step's "look for" matched) as the phase's manual-verification evidence. No commit — this task changes no files.

---

## Phase 5 — Settle attribution + sharing

> **Phase 5 — Settle attribution + sharing.** Depends on Phase 1 (`types.ts`: `Portion`, `Item.portions?`, `isPortioned`, `portionTotal`) and Phase 2 (`splitBill` branches on `isPortioned` via the module-local `resolveParticipants`/`allocateEqually` helpers). Each task is one action (2-5 min): write a failing test, run it and SEE it fail, write the minimal impl, run it and SEE it pass, commit. The full suite (`npm test`) and `npm run typecheck` must be green at the END of every task that touches shippable code.
>
> **Cumulative baseline note (read first):** phases run sequentially, so the number of test FILES and TESTS grows as earlier phases land. Phase 5 runs AFTER Phases 1-4, which have already added test files (`portionHelpers`, `schemaPortions`, `portionView`, etc.) and many tests. NEVER assert an absolute total like "15 files / 129 tests" anywhere in this phase. The done-criterion is always: run `npm test`, confirm the summary reports ZERO failures and that the specific NEW tests named in the task pass, and confirm `npm run typecheck` exits 0. Single-test runs of the form `npx vitest run tests/unit/FILE.test.ts -t "name"` stay exactly as written.
>
> **Locked UI-test strategy (read first):** component RENDERING is verified MANUALLY, not by jsdom/snapshot/DOM automation. Wherever the spec references a "DinerCard un-split snapshot re-baseline", that named snapshot requirement is SUPERSEDED by the locked node-only strategy: the pure `dinerCardRows` test in the "Itemized rows + treated branch in DinerCard" task covers the expanded-card row behavior at the node level, and the manual walk-through task covers the actual rendered pixels. No snapshot/DOM test is added.
>
> **Toolchain reminders (verbatim):** run one file `npx vitest run tests/unit/FILE.test.ts` · run one test by name `npx vitest run tests/unit/FILE.test.ts -t "exact test name"` · full suite `npm test` · typecheck `npm run typecheck`. The `@` alias maps to `src`.
>
> **Branch first** (we are on `main`):
>
> - [ ] Step 0: Create the working branch.
>   ```bash
>   git checkout -b phase5-settle-sharing
>   ```
>   Expected output: `Switched to a new branch 'phase5-settle-sharing'`.
>
> - [ ] Step 0b: Confirm the green baseline before touching anything (cumulative — do NOT assert a fixed count).
>   ```bash
>   npm test && npm run typecheck
>   ```
>   Expected: the vitest summary reports ZERO failures (`Test Files … passed`, `Tests … passed`, with at most a skipped integration file also reported as skipped), then typecheck prints nothing after its `> tsc --noEmit` banner and exits 0. If the suite is RED or typecheck is non-zero, STOP — do not start Phase 5 on a red baseline.

### Task 43: Add FoodLine type + empty lines:[] to DinerSplit (additive, no accumulation yet)

This first task adds the new shape WITHOUT changing any number: every `DinerSplit` simply gets `lines: []`. It proves the type compiles and is wired through to `DinerCard` (which already imports `DinerSplit`) before we populate it. The accumulation is added in the next task under its own failing test.

Source-of-truth note: Phase 2 has ALREADY rewritten `src/math/splitBill.ts`. After Phase 2, line 5 reads `import { lineTotal, portionTotal, isPortioned, type Diner, type RoundState } from '@/state/types'`, the module-local helpers `resolveParticipants`/`allocateEqually` sit before `export function splitBill(`, and the per-item loop branches on `isPortioned`. The `DinerSplit` interface and the `perDiner` map are unchanged from the original. This task edits ONLY the `DinerSplit` interface and the `perDiner` map.

**Files:**
- Modify: `src/math/splitBill.ts` (the `DinerSplit` interface and the `perDiner` map)
- Test: `tests/unit/splitBill.test.ts` (append a new describe block)

- [ ] Step 1: Write a failing test asserting every `DinerSplit` carries an (initially empty) `lines` array. Append this block to the END of `tests/unit/splitBill.test.ts` (after the final `describe`/`it`):
  ```ts
  describe('splitBill — lines decomposition', () => {
    it('every DinerSplit carries a lines array', () => {
      const state = round({
        diners: [diner('a'), diner('b')],
        items: [item('x', 1000)],
        servicePct: 0,
        gstPct: 0,
      })
      const s = splitBill(state)
      for (const d of s.perDiner) {
        expect(Array.isArray(d.lines)).toBe(true)
      }
    })
  })
  ```

- [ ] Step 2: Run the new test and SEE it fail (the property `lines` does not exist yet).
  ```bash
  npx vitest run tests/unit/splitBill.test.ts -t "every DinerSplit carries a lines array"
  ```
  Expected: the test FAILS with `expected false to be true` (because `d.lines` is `undefined`, so `Array.isArray(undefined) === false`). Confirm it is RED before writing impl.

- [ ] Step 3: Add the `FoodLine` interface and the `lines` field to `DinerSplit` in `src/math/splitBill.ts`. Replace the current `DinerSplit` interface:
  ```ts
  export interface DinerSplit {
    dinerId: string
    food: Cents
    discount: Cents
    service: Cents
    gst: Cents
    total: Cents
  }
  ```
  with:
  ```ts
  export interface FoodLine {
    itemId: string
    /** Item name, copied so share text needs no item lookup. */
    name: string
    /** This diner's exact cents for this item (this portion if portioned). */
    food: Cents
    /** Present ONLY when the item isPortioned(). Drives "1 of 3" vs "shared 2 of 3" copy. */
    portion?: { units: number; qty: number; shareOf: number }
  }

  export interface DinerSplit {
    dinerId: string
    food: Cents
    discount: Cents
    service: Cents
    gst: Cents
    total: Cents
    lines: FoodLine[]
  }
  ```

- [ ] Step 4: Populate `lines: []` in the `perDiner` map so the shape is satisfied. In `src/math/splitBill.ts`, the `perDiner` object literal currently reads:
  ```ts
    perDiner: diners.map((d, i) => ({
      dinerId: d.id,
      food: food[i]!,
      discount: discountShares[i]!,
      service: serviceShares[i]!,
      gst: gstShares[i]!,
      total: adjusted[i]!,
    })),
  ```
  Change it to add the empty array:
  ```ts
    perDiner: diners.map((d, i) => ({
      dinerId: d.id,
      food: food[i]!,
      discount: discountShares[i]!,
      service: serviceShares[i]!,
      gst: gstShares[i]!,
      total: adjusted[i]!,
      lines: [],
    })),
  ```

- [ ] Step 5: Run the new test and SEE it PASS.
  ```bash
  npx vitest run tests/unit/splitBill.test.ts -t "every DinerSplit carries a lines array"
  ```
  Expected: `1 passed`.

- [ ] Step 6: Run the whole splitBill file + typecheck to prove nothing regressed (the empty array is additive).
  ```bash
  npx vitest run tests/unit/splitBill.test.ts && npm run typecheck
  ```
  Expected: every test in `splitBill.test.ts` passes (the pre-existing un-split cases, the Phase-2 portions cases, and the new lines-decomposition test); typecheck exits 0 (the new `lines` field is `[]`, assignable; `DinerCard` does not yet read it).

- [ ] Step 7: Commit.
  ```bash
  git commit -am "Phase 5: add FoodLine type + empty lines[] to DinerSplit"
  ```

### Task 44: Accumulate one FoodLine per (item|portion, participant) in splitBill

Now populate `lines` by EXTENDING the existing Phase-2 `allocateEqually` helper so the SAME pass that adds to `food[]` also pushes a `FoodLine`. Phase 2 already gave `splitBill.ts` the two module-local helpers `resolveParticipants(assigned, diners, idx)` and `allocateEqually(cost, participants, idx, food)`, and the per-item loop already branches on `isPortioned`, calling `allocateEqually(portionTotal(item.unitPrice, p.units), resolveParticipants(p.assignedDinerIds, diners, idx), idx, food)` for each portion and `allocateEqually(lineTotal(item), resolveParticipants(item.assignedDinerIds, diners, idx), idx, food)` for un-split items. We REUSE those helpers — no new `resolve`/`allocate` are introduced and the `type Diner` import stays. We add a `linesByDiner` accumulator and give `allocateEqually` two extra parameters (the item identity + an optional portion descriptor) so it can push one `FoodLine` per participant.

For an un-split item: one line per participant, `portion` omitted, `food` = that participant's largest-remainder share. For a portioned item: one line per (portion, participant), `portion: { units, qty, shareOf: participants.length }`. A diner absent from every portion of an item gets NO line for it (that is how "M pays nothing for the Adobo" surfaces). The decomposition is strict: `Σ over a diner's line.food === DinerSplit.food`.

**Files:**
- Modify: `src/math/splitBill.ts` — the `food`/`linesByDiner` declarations, the `allocateEqually` helper signature + body, the two call sites in the loop, and the `perDiner` map's `lines`
- Test: `tests/unit/splitBill.test.ts` (extend the `splitBill — lines decomposition` describe)

- [ ] Step 1: Write a failing test for the un-split decomposition. Add this `it` INSIDE the existing `describe('splitBill — lines decomposition', …)` block in `tests/unit/splitBill.test.ts`:
  ```ts
    it('un-split item emits one line per participant, portion undefined, summing to food', () => {
      const state = round({
        diners: [diner('shin'), diner('mei'), diner('raj')],
        items: [item('crab', 8800)], // everyone, 8800/3 → [2934,2933,2933]
        servicePct: 0,
        gstPct: 0,
      })
      const s = splitBill(state)
      const shin = s.perDiner.find((d) => d.dinerId === 'shin')!
      expect(shin.lines).toHaveLength(1)
      expect(shin.lines[0]!.itemId).toBe('crab')
      expect(shin.lines[0]!.name).toBe('crab')
      expect(shin.lines[0]!.food).toBe(2934)
      expect(shin.lines[0]!.portion).toBeUndefined()
      for (const d of s.perDiner) {
        const sum = d.lines.reduce((a, l) => a + l.food, 0)
        expect(sum).toBe(d.food)
      }
    })
  ```

- [ ] Step 2: Run it and SEE it fail (lines is still `[]`, so `shin.lines` has length 0).
  ```bash
  npx vitest run tests/unit/splitBill.test.ts -t "un-split item emits one line per participant"
  ```
  Expected: FAILS at `expect(shin.lines).toHaveLength(1)` with `expected [] to have a length of 1 but got +0`.

- [ ] Step 3: Add the `type Item` import (needed for the `allocateEqually` signature) and the `linesByDiner` accumulator. In `src/math/splitBill.ts`, the Phase-2 import on line 5 currently reads:
  ```ts
  import { lineTotal, portionTotal, isPortioned, type Diner, type RoundState } from '@/state/types'
  ```
  Add `type Item` (keep `type Diner` — the Phase-2 helpers depend on it):
  ```ts
  import { lineTotal, portionTotal, isPortioned, type Diner, type Item, type RoundState } from '@/state/types'
  ```
  Then add the `linesByDiner` accumulator next to the `food` declaration. The current line reads `const food: Cents[] = diners.map(() => ZERO)`; add the array directly after it:
  ```ts
    const food: Cents[] = diners.map(() => ZERO)
    const linesByDiner: FoodLine[][] = diners.map(() => [])
  ```

- [ ] Step 4: Extend the existing Phase-2 `allocateEqually` helper so it ALSO pushes a `FoodLine` per participant. The Phase-2 helper currently reads:
  ```ts
  function allocateEqually(
    cost: Cents,
    participants: string[],
    idx: Map<string, number>,
    food: Cents[],
  ): void {
    if (participants.length === 0) return
    const shares = distributeProportionally(
      cost,
      participants.map(() => 1),
    )
    participants.forEach((id, k) => {
      const i = idx.get(id)!
      food[i] = addC(food[i]!, shares[k]!)
    })
  }
  ```
  Replace it with this version that takes the item identity + an optional portion descriptor and pushes one `FoodLine` per participant into a `linesByDiner` accumulator (`resolveParticipants` is UNCHANGED — leave it exactly as Phase 2 wrote it):
  ```ts
  function allocateEqually(
    cost: Cents,
    participants: string[],
    idx: Map<string, number>,
    food: Cents[],
    item: Item,
    linesByDiner: FoodLine[][],
    portion: FoodLine['portion'],
  ): void {
    if (participants.length === 0) return
    const shares = distributeProportionally(
      cost,
      participants.map(() => 1),
    )
    participants.forEach((id, k) => {
      const i = idx.get(id)!
      food[i] = addC(food[i]!, shares[k]!)
      linesByDiner[i]!.push({ itemId: item.id, name: item.name, food: shares[k]!, portion })
    })
  }
  ```

- [ ] Step 5: Update the two `allocateEqually` call sites in the per-item loop to pass the new arguments. The Phase-2 loop currently reads:
  ```ts
    for (const item of items) {
      if (isPortioned(item)) {
        for (const p of item.portions!) {
          const cost = portionTotal(item.unitPrice, p.units)
          allocateEqually(cost, resolveParticipants(p.assignedDinerIds, diners, idx), idx, food)
        }
      } else {
        allocateEqually(
          lineTotal(item),
          resolveParticipants(item.assignedDinerIds, diners, idx),
          idx,
          food,
        )
      }
    }
  ```
  Replace it with (passing `item`, `linesByDiner`, and the portion descriptor — `shareOf` is the resolved participant count, so resolve once and reuse it):
  ```ts
    for (const item of items) {
      if (isPortioned(item)) {
        for (const p of item.portions!) {
          const cost = portionTotal(item.unitPrice, p.units)
          const participants = resolveParticipants(p.assignedDinerIds, diners, idx)
          allocateEqually(cost, participants, idx, food, item, linesByDiner, {
            units: p.units,
            qty: item.qty,
            shareOf: participants.length,
          })
        }
      } else {
        allocateEqually(
          lineTotal(item),
          resolveParticipants(item.assignedDinerIds, diners, idx),
          idx,
          food,
          item,
          linesByDiner,
          undefined,
        )
      }
    }
  ```
  Note: the un-split branch is semantically byte-identical to Phase 2 for the MONEY (same `lineTotal`, same `resolveParticipants` sentinel rule, same skip-on-empty via the early return); only the FoodLine push is new.

- [ ] Step 6: Thread `linesByDiner` into the `perDiner` map. Change the `lines: []` you added in the previous task to:
  ```ts
        lines: linesByDiner[i]!,
  ```

- [ ] Step 7: Run the new test and SEE it PASS.
  ```bash
  npx vitest run tests/unit/splitBill.test.ts -t "un-split item emits one line per participant"
  ```
  Expected: `1 passed`.

- [ ] Step 8: Run the whole splitBill file + typecheck — every PRE-EXISTING case (un-split AND Phase-2 portions) must pass unmodified (the helper extension is money-preserving).
  ```bash
  npx vitest run tests/unit/splitBill.test.ts && npm run typecheck
  ```
  Expected: every test in `splitBill.test.ts` passes (the un-split regression cases at their old values, the everyone-sentinel `[500,500]`, the zero-weight skip, residual, empty round, rounding line, the Phase-2 portions suite, and the two new lines tests); typecheck exits 0.

- [ ] Step 9: Commit.
  ```bash
  git commit -am "Phase 5: accumulate FoodLine per (item|portion, participant) in splitBill"
  ```

### Task 45: Prove portioned FoodLine decomposition (solo + shared, treated absence, completeness)

These tests pin the portion-specific behavior used by the settle UI: a portioned item emits a line per (portion, participant) with `shareOf` = participant count; a diner absent from every portion has NO line for that item; a diner with a solo unit AND a share of the rest gets TWO lines for the same itemId; and `Σ over all diners' lines.food === subtotal === Σ DinerSplit.food`. No production change — the previous task already implemented this; these are the proof (characterization tests run expecting an immediate PASS).

**Files:**
- Test only: `tests/unit/splitBill.test.ts` (extend the `splitBill — lines decomposition` describe)

- [ ] Step 1: Write the portioned-decomposition test using the worked-scenario Adobo line. Add this `it` inside `describe('splitBill — lines decomposition', …)`:
  ```ts
    it('portioned item: solo line shareOf 1, shared line shareOf 3, treated diner has no line', () => {
      const state = round({
        diners: [diner('P1'), diner('P2'), diner('P3'), diner('M')],
        items: [
          {
            id: 'adobo',
            name: 'Adobo',
            qty: 3,
            unitPrice: cents(1400),
            assignedDinerIds: [],
            portions: [
              { units: 1, assignedDinerIds: ['P1'] }, // solo
              { units: 2, assignedDinerIds: ['P1', 'P2', 'P3'] }, // except M; 2800/3 → [934,933,933]
            ],
          },
        ],
        servicePct: 0,
        gstPct: 0,
      })
      const s = splitBill(state)
      const p1 = s.perDiner.find((d) => d.dinerId === 'P1')!
      // P1 has a solo unit AND a share of the rest → TWO lines for the same itemId
      const p1Adobo = p1.lines.filter((l) => l.itemId === 'adobo')
      expect(p1Adobo).toHaveLength(2)
      const solo = p1Adobo.find((l) => l.portion!.shareOf === 1)!
      expect(solo.food).toBe(1400)
      expect(solo.portion).toEqual({ units: 1, qty: 3, shareOf: 1 })
      const shared = p1Adobo.find((l) => l.portion!.shareOf === 3)!
      expect(shared.food).toBe(934)
      expect(shared.portion).toEqual({ units: 2, qty: 3, shareOf: 3 })
      // M is in no portion → NO line for adobo at all
      const m = s.perDiner.find((d) => d.dinerId === 'M')!
      expect(m.lines.filter((l) => l.itemId === 'adobo')).toHaveLength(0)
      expect(m.food).toBe(0)
    })
  ```

- [ ] Step 2: Run it and SEE it PASS (impl already exists from the prior task).
  ```bash
  npx vitest run tests/unit/splitBill.test.ts -t "portioned item: solo line shareOf 1"
  ```
  Expected: `1 passed`. (This is a characterization test confirming the prior task's accumulation; if it fails, the bug is in the loop you just wrote — fix the loop, not the test.)

- [ ] Step 3: Write the decomposition-completeness test (the invariant `Σ all lines.food === subtotal === Σ food`). Add inside the same describe:
  ```ts
    it('Σ over all diners lines.food === subtotal === Σ DinerSplit.food', () => {
      const state = round({
        diners: [diner('P1'), diner('P2'), diner('P3'), diner('M')],
        items: [
          { id: 'snapper', name: 'Snapper', qty: 5, unitPrice: cents(1800), assignedDinerIds: [] },
          {
            id: 'adobo',
            name: 'Adobo',
            qty: 3,
            unitPrice: cents(1400),
            assignedDinerIds: [],
            portions: [
              { units: 1, assignedDinerIds: ['P1'] },
              { units: 2, assignedDinerIds: ['P1', 'P2', 'P3'] },
            ],
          },
          {
            id: 'chicken',
            name: 'Chicken',
            qty: 3,
            unitPrice: cents(1000),
            assignedDinerIds: [],
            portions: [
              { units: 1, assignedDinerIds: ['P2'] },
              { units: 2, assignedDinerIds: ['P1', 'P2', 'P3'] },
            ],
          },
        ],
      })
      const s = splitBill(state)
      const sumFood = s.perDiner.reduce((a, d) => a + d.food, 0)
      const sumLines = s.perDiner.reduce((a, d) => a + d.lines.reduce((b, l) => b + l.food, 0), 0)
      expect(sumFood).toBe(16200) // worked-scenario subtotal
      expect(sumLines).toBe(sumFood)
      for (const d of s.perDiner) {
        expect(d.lines.reduce((b, l) => b + l.food, 0)).toBe(d.food)
      }
    })
  ```

- [ ] Step 4: Run it and SEE it PASS.
  ```bash
  npx vitest run tests/unit/splitBill.test.ts -t "Σ over all diners lines.food"
  ```
  Expected: `1 passed`.

- [ ] Step 5: Run the full splitBill file to confirm the whole decomposition suite is green together.
  ```bash
  npx vitest run tests/unit/splitBill.test.ts
  ```
  Expected: every test in the file passes (un-split regression cases + Phase-2 portions suite + the four lines-decomposition tests), zero failures.

- [ ] Step 6: Commit.
  ```bash
  git commit -am "Phase 5: tests proving portioned FoodLine decomposition + completeness"
  ```

### Task 46: New pure lineLabel.ts module + tests

`lineLabel(line)` is the single source of the human label, shared by the settle card AND the share text so they can never drift. Rules (spec §6.3, §7.6): no `portion` → `{name}`; `portion.shareOf === 1` → `{name} · {units} of {qty}`; `portion.shareOf > 1` → `{name} · shared {units} of {qty}`. Pure function, node-testable. (The `·` between name and detail is U+00B7 MIDDLE DOT.)

**Files:**
- Create: `src/features/settle/lineLabel.ts`
- Test: `tests/unit/lineLabel.test.ts` (new)

- [ ] Step 1: Write the failing test file `tests/unit/lineLabel.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { cents } from '@/math/money'
  import type { FoodLine } from '@/math/splitBill'
  import { lineLabel } from '@/features/settle/lineLabel'

  const line = (over: Partial<FoodLine>): FoodLine => ({
    itemId: 'i',
    name: 'Adobo',
    food: cents(0),
    ...over,
  })

  describe('lineLabel', () => {
    it('un-split line (no portion) → just the name', () => {
      expect(lineLabel(line({ name: 'Pan-Seared Snapper' }))).toBe('Pan-Seared Snapper')
    })

    it('solo portion (shareOf 1) → name · {units} of {qty}', () => {
      expect(lineLabel(line({ portion: { units: 1, qty: 3, shareOf: 1 } }))).toBe('Adobo · 1 of 3')
    })

    it('shared portion (shareOf > 1) → name · shared {units} of {qty}', () => {
      expect(lineLabel(line({ portion: { units: 2, qty: 3, shareOf: 3 } }))).toBe(
        'Adobo · shared 2 of 3',
      )
    })
  })
  ```

- [ ] Step 2: Run it and SEE it fail (module does not exist).
  ```bash
  npx vitest run tests/unit/lineLabel.test.ts
  ```
  Expected: FAILS to resolve the import — `Failed to load url @/features/settle/lineLabel` (or `Cannot find module`). Confirm RED.

- [ ] Step 3: Create `src/features/settle/lineLabel.ts` (the separator is U+00B7 MIDDLE DOT `·`):
  ```ts
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
  ```

- [ ] Step 4: Run the test and SEE it PASS.
  ```bash
  npx vitest run tests/unit/lineLabel.test.ts
  ```
  Expected: `3 passed`.

- [ ] Step 5: Typecheck and commit.
  ```bash
  npm run typecheck && git commit -am "Phase 5: pure lineLabel.ts shared by card and share text"
  ```
  Expected: typecheck exits 0.

### Task 47: New shareText.ts module — buildShareText(round, split) + tests

`buildShareText(round, split): string` renders a plain-text per-diner receipt. Each diner: a header `{name} — {formatSGD(total)}`, then one indented line per `split.lines` via `lineLabel` with its `formatSGD(food)`, then the non-zero charge rows (service, GST, discount). A fully-treated diner (no lines, food 0) renders as `{name} — $0.00 (treated)` with no body. A footer `Everyone together — {formatSGD(grandTotal)}` where the grand total === `split.breakdown.grandTotal`. Pure, deterministic, node-testable.

Alignment is intrinsic to the format (a fixed-width label column so amounts line up), so the expected strings below are the ACTUAL literals computed from `formatSGD` + `padEnd(40)` — not guesses. The label column is 40 chars wide. `formatSGD` takes a branded `Cents`; the engine values (`ds.total`, `line.food`, `ds.service`, …) are already `Cents`, so they pass directly with NO cast. The `·` separator is U+00B7 MIDDLE DOT and counts as ONE character for `padEnd`.

**Files:**
- Create: `src/features/settle/shareText.ts`
- Test: `tests/unit/shareText.test.ts` (new)

- [ ] Step 1: Write the failing test file `tests/unit/shareText.test.ts`. It builds the worked scenario, runs the real `splitBill`, then asserts the rendered text. The alignment-sensitive assertions use `toContain` on the EXACT label+amount substrings (label `padEnd(40)` then the formatted amount):
  ```ts
  import { describe, it, expect } from 'vitest'
  import { cents } from '@/math/money'
  import { splitBill } from '@/math/splitBill'
  import { buildShareText } from '@/features/settle/shareText'
  import type { Diner, Item, RoundState } from '@/state/types'

  const diner = (id: string, name: string): Diner => ({ id, name, colorIdx: 0 })

  const round = (over: Partial<RoundState>): RoundState => ({
    venue: 'Fareware',
    diners: [],
    items: [],
    discount: cents(0),
    servicePct: 0.1,
    gstPct: 0.09,
    rounding: cents(0),
    scan: null,
    scannedTotal: null,
    ...over,
  })

  const worked = round({
    diners: [diner('P1', 'P1'), diner('P2', 'P2'), diner('P3', 'P3'), diner('M', 'M')],
    items: [
      { id: 'snapper', name: 'Pan-Seared Snapper', qty: 5, unitPrice: cents(1800), assignedDinerIds: [] },
      {
        id: 'adobo',
        name: 'One36 Pork Adobo w/ Egg',
        qty: 3,
        unitPrice: cents(1400),
        assignedDinerIds: [],
        portions: [
          { units: 1, assignedDinerIds: ['P1'] },
          { units: 2, assignedDinerIds: ['P1', 'P2', 'P3'] },
        ],
      } as Item,
      {
        id: 'chicken',
        name: 'Grilled Chicken Chop',
        qty: 3,
        unitPrice: cents(1000),
        assignedDinerIds: [],
        portions: [
          { units: 1, assignedDinerIds: ['P2'] },
          { units: 2, assignedDinerIds: ['P1', 'P2', 'P3'] },
        ],
      } as Item,
    ],
  })

  describe('buildShareText', () => {
    it('renders a P1 header line with their total $62.96', () => {
      const split = splitBill(worked)
      const text = buildShareText(worked, split)
      expect(text).toContain('P1 — $62.96') // total[P1] = 6296
    })

    it('labels P1 portion lines with the exact lineLabel + aligned amount', () => {
      const text = buildShareText(worked, splitBill(worked))
      // 'One36 Pork Adobo w/ Egg · 1 of 3' is 32 chars → padEnd(40) = 8 trailing
      // spaces, then '$14.00'. (The leading 2-space indent is omitted from the
      // substring so it can match anywhere on the line.)
      expect(text).toContain('One36 Pork Adobo w/ Egg · 1 of 3        $14.00')
      // '… · shared 2 of 3' is 39 chars → padEnd(40) = 1 trailing space, then '$9.34'.
      expect(text).toContain('One36 Pork Adobo w/ Egg · shared 2 of 3 $9.34')
    })

    it('a fully-treated diner renders "Name — $0.00 (treated)" with no body', () => {
      const treated = round({
        diners: [diner('P1', 'P1'), diner('M', 'M')],
        items: [
          {
            id: 'adobo',
            name: 'Adobo',
            qty: 2,
            unitPrice: cents(1000),
            assignedDinerIds: [],
            portions: [{ units: 2, assignedDinerIds: ['P1'] }],
          } as Item,
        ],
        servicePct: 0,
        gstPct: 0,
      })
      const text = buildShareText(treated, splitBill(treated))
      expect(text).toContain('M — $0.00 (treated)')
      expect(text).not.toContain('M — $0.00\n') // no header-then-body form for M
    })

    it('footer grand total === split.breakdown.grandTotal ($194.24)', () => {
      const split = splitBill(worked)
      const text = buildShareText(worked, split)
      expect(split.breakdown.grandTotal).toBe(19424)
      expect(text).toContain('Everyone together — $194.24')
    })

    it('is deterministic (same input → identical output)', () => {
      expect(buildShareText(worked, splitBill(worked))).toBe(buildShareText(worked, splitBill(worked)))
    })
  })
  ```

- [ ] Step 2: Run it and SEE it fail (module does not exist).
  ```bash
  npx vitest run tests/unit/shareText.test.ts
  ```
  Expected: FAILS to resolve `@/features/settle/shareText`. Confirm RED.

- [ ] Step 3: Create `src/features/settle/shareText.ts`. The label/amount alignment uses `padEnd(40)` on the label so amounts line up; the `row` helper takes a branded `Cents` directly (no `as never` cast — engine values are already `Cents`):
  ```ts
  import type { BillSplit } from '@/math/splitBill'
  import type { Cents } from '@/math/money'
  import type { RoundState } from '@/state/types'
  import { formatSGD } from '@/lib/format'
  import { lineLabel } from './lineLabel'

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
    const blocks: string[] = []
    if (round.venue.trim() !== '') blocks.push(round.venue)

    for (const ds of split.perDiner) {
      const diner = round.diners.find((d) => d.id === ds.dinerId)
      const name = diner ? diner.name : ds.dinerId

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
  ```

- [ ] Step 4: Run the test and SEE it PASS. The expected strings in Step 1 are the EXACT output of `padEnd(40)` + `formatSGD` (verified: `'One36 Pork Adobo w/ Egg · 1 of 3'` is 32 chars → 8 trailing spaces → `$14.00`; `'… · shared 2 of 3'` is 39 chars → 1 trailing space → `$9.34`). Do NOT hand-tune the test — if an alignment assertion fails, the bug is in the impl (wrong `LABEL_WIDTH`, wrong amount field, or a stray space), not the literals.
  ```bash
  npx vitest run tests/unit/shareText.test.ts
  ```
  Expected: `5 passed`.

- [ ] Step 5: Typecheck and commit.
  ```bash
  npm run typecheck && git commit -am "Phase 5: buildShareText(round,split) plain-text receipt"
  ```
  Expected: typecheck exits 0.

### Task 48: Itemized rows + treated branch in DinerCard

Replace the single `{ label:'Food & drink', amount: split.food }` row (`DinerCard.tsx:29-34`) with one row per `split.lines`, labelled via `lineLabel`. Keep discount/service/GST/residual rows unchanged. Add the fully-treated branch: `lines.length === 0 && split.food === 0` → a single muted `Treated — pays nothing` row. The collapsed header (`:42-56`) and the render loop (`:67-74`) are UNTOUCHED. This is the intended common-path settle-view change (§0.1): an un-split round's expanded card now shows one row per item instead of one "Food & drink" row.

Locked-strategy note: the spec's named "DinerCard un-split snapshot re-baseline" is SUPERSEDED by the locked node-only test strategy. The pure `dinerCardRows` test below covers the expanded-card row behavior at the node level; the rendered pixels are verified in the manual walk-through task. No snapshot/DOM test is added.

**Files:**
- Modify: `src/features/settle/DinerCard.tsx` (the `rows` construction at `:29-34`; an import)
- Test: `tests/unit/dinerCardRows.test.ts` (new — tests the PURE row-builder, not the rendered DOM)

- [ ] Step 1: Extract a pure `dinerCardRows(split)` helper so the row logic is node-testable without jsdom (locked UI-test strategy: pure functions in node, no DOM deps). First write the failing test `tests/unit/dinerCardRows.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { cents } from '@/math/money'
  import { splitBill } from '@/math/splitBill'
  import { dinerCardRows } from '@/features/settle/dinerCardRows'
  import type { Diner, Item, RoundState } from '@/state/types'

  const diner = (id: string): Diner => ({ id, name: id, colorIdx: 0 })
  const round = (over: Partial<RoundState>): RoundState => ({
    venue: 'T',
    diners: [],
    items: [],
    discount: cents(0),
    servicePct: 0.1,
    gstPct: 0.09,
    rounding: cents(0),
    scan: null,
    scannedTotal: null,
    ...over,
  })

  describe('dinerCardRows', () => {
    it('un-split round: one row per item (not a single "Food & drink" row)', () => {
      const state = round({
        diners: [diner('a'), diner('b')],
        items: [
          { id: 'crab', name: 'Crab', qty: 1, unitPrice: cents(1000), assignedDinerIds: [] },
          { id: 'rice', name: 'Rice', qty: 1, unitPrice: cents(400), assignedDinerIds: [] },
        ],
        servicePct: 0,
        gstPct: 0,
      })
      const a = splitBill(state).perDiner.find((d) => d.dinerId === 'a')!
      const rows = dinerCardRows(a)
      const labels = rows.map((r) => r.label)
      expect(labels).toContain('Crab')
      expect(labels).toContain('Rice')
      expect(labels).not.toContain('Food & drink')
    })

    it('portioned payer: rows carry the lineLabel copy', () => {
      const state = round({
        diners: [diner('P1'), diner('P2'), diner('P3')],
        items: [
          {
            id: 'adobo',
            name: 'Adobo',
            qty: 3,
            unitPrice: cents(1400),
            assignedDinerIds: [],
            portions: [
              { units: 1, assignedDinerIds: ['P1'] },
              { units: 2, assignedDinerIds: ['P1', 'P2', 'P3'] },
            ],
          } as Item,
        ],
        servicePct: 0,
        gstPct: 0,
      })
      const p1 = splitBill(state).perDiner.find((d) => d.dinerId === 'P1')!
      const labels = dinerCardRows(p1).map((r) => r.label)
      expect(labels).toContain('Adobo · 1 of 3')
      expect(labels).toContain('Adobo · shared 2 of 3')
    })

    it('fully-treated diner: a single "Treated — pays nothing" row', () => {
      const state = round({
        diners: [diner('P1'), diner('M')],
        items: [
          {
            id: 'adobo',
            name: 'Adobo',
            qty: 2,
            unitPrice: cents(1000),
            assignedDinerIds: [],
            portions: [{ units: 2, assignedDinerIds: ['P1'] }],
          } as Item,
        ],
        servicePct: 0,
        gstPct: 0,
      })
      const m = splitBill(state).perDiner.find((d) => d.dinerId === 'M')!
      const rows = dinerCardRows(m)
      expect(rows).toEqual([{ label: 'Treated — pays nothing', amount: 0 }])
    })

    it('keeps non-zero discount/service/GST rows after the food rows', () => {
      const state = round({
        diners: [diner('a')],
        items: [{ id: 'x', name: 'X', qty: 1, unitPrice: cents(1000), assignedDinerIds: [] }],
        discount: cents(100),
      })
      const a = splitBill(state).perDiner.find((d) => d.dinerId === 'a')!
      const labels = dinerCardRows(a).map((r) => r.label)
      expect(labels).toContain('X')
      expect(labels).toContain('Discount share')
      expect(labels).toContain('Service charge')
      expect(labels).toContain('GST')
    })
  })
  ```

- [ ] Step 2: Run it and SEE it fail (module does not exist).
  ```bash
  npx vitest run tests/unit/dinerCardRows.test.ts
  ```
  Expected: FAILS to resolve `@/features/settle/dinerCardRows`. Confirm RED.

- [ ] Step 3: Create `src/features/settle/dinerCardRows.ts`:
  ```ts
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
  ```

- [ ] Step 4: Run the test and SEE it PASS.
  ```bash
  npx vitest run tests/unit/dinerCardRows.test.ts
  ```
  Expected: `4 passed`.

- [ ] Step 5: Wire the helper into `DinerCard.tsx`. Replace the rows construction (lines 29-34):
  ```ts
    const rows: { label: string; amount: number }[] = [
      { label: 'Food & drink', amount: split.food },
      ...(split.discount !== 0 ? [{ label: 'Discount share', amount: split.discount }] : []),
      ...(split.service !== 0 ? [{ label: 'Service charge', amount: split.service }] : []),
      ...(split.gst !== 0 ? [{ label: 'GST', amount: split.gst }] : []),
    ]
  ```
  with:
  ```ts
    const rows = dinerCardRows(split)
  ```
  and add the import near the other imports (after the `import { cn } from '@/lib/cn'` line):
  ```ts
  import { dinerCardRows } from './dinerCardRows'
  ```
  The existing render loop at `DinerCard.tsx:67-74` keys on `r.label` and renders `<Money cents={cents(r.amount)} signColor />`. Portion labels are unique per item+slice within a diner so the key stays unique; no render change is needed. The collapsed header (`:42-56`) is untouched.

- [ ] Step 6: Typecheck and run the dinerCardRows test + the full splitBill file to prove nothing regressed.
  ```bash
  npm run typecheck && npx vitest run tests/unit/dinerCardRows.test.ts tests/unit/splitBill.test.ts
  ```
  Expected: typecheck exits 0 (DinerCard now imports `dinerCardRows`, drops the inline array); both test files pass with zero failures.

- [ ] Step 7: Commit.
  ```bash
  git commit -am "Phase 5: itemized rows + treated branch in DinerCard via pure dinerCardRows"
  ```

### Task 49: Change ShareActions to require split prop + thread it from SettleSheet (lockstep)

`ShareActions` is propless today and reads `useStore.getState().round` directly (`ShareActions.tsx:14,18`). Make `split: BillSplit` a REQUIRED prop: `copy()` writes `` `${buildShareText(round, split)}\n\n${shareUrl()}` `` (via the pure `shareMessage` helper); `nativeShare()` adds `text: buildShareText(round, split)` alongside the existing `url`. `SettleSheet.tsx:62` MUST change from `<ShareActions />` to `<ShareActions split={split} />` in the same task or `tsc` breaks — that lockstep is the done-criterion.

**Files:**
- Create: `src/features/settle/shareMessage.ts`
- Modify: `src/features/settle/ShareActions.tsx` (signature + share strings)
- Modify: `src/features/settle/SettleSheet.tsx:62` (pass the prop)
- Test: `tests/unit/shareActionsContent.test.ts` (new — tests the pure text+url composition, not the clipboard/DOM)

- [ ] Step 1: To keep the share-string composition node-testable without DOM/clipboard, extract a pure `shareMessage(round, split, url)` helper. Write the failing test `tests/unit/shareActionsContent.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { cents } from '@/math/money'
  import { splitBill } from '@/math/splitBill'
  import { shareMessage } from '@/features/settle/shareMessage'
  import type { Diner, RoundState } from '@/state/types'

  const diner = (id: string): Diner => ({ id, name: id, colorIdx: 0 })
  const state: RoundState = {
    venue: 'T',
    diners: [diner('a'), diner('b')],
    items: [{ id: 'x', name: 'X', qty: 1, unitPrice: cents(1000), assignedDinerIds: [] }],
    discount: cents(0),
    servicePct: 0,
    gstPct: 0,
    rounding: cents(0),
    scan: null,
    scannedTotal: null,
  }

  describe('shareMessage', () => {
    it('joins the share text and the url with a blank line', () => {
      const split = splitBill(state)
      const msg = shareMessage(state, split, 'https://x.test/#r=abc')
      expect(msg.endsWith('\n\nhttps://x.test/#r=abc')).toBe(true)
      expect(msg).toContain('Everyone together — $10.00')
    })
  })
  ```

- [ ] Step 2: Run it and SEE it fail (module does not exist).
  ```bash
  npx vitest run tests/unit/shareActionsContent.test.ts
  ```
  Expected: FAILS to resolve `@/features/settle/shareMessage`. Confirm RED.

- [ ] Step 3: Create `src/features/settle/shareMessage.ts`:
  ```ts
  import type { BillSplit } from '@/math/splitBill'
  import type { RoundState } from '@/state/types'
  import { buildShareText } from './shareText'

  /** The full clipboard/native-share payload: the at-a-glance receipt, then
   *  a blank line, then the round-trippable link. */
  export function shareMessage(round: RoundState, split: BillSplit, url: string): string {
    return `${buildShareText(round, split)}\n\n${url}`
  }
  ```

- [ ] Step 4: Run the test and SEE it PASS.
  ```bash
  npx vitest run tests/unit/shareActionsContent.test.ts
  ```
  Expected: `1 passed`.

- [ ] Step 5: Rewrite `ShareActions.tsx` to take the required `split` prop and use `shareMessage` + `buildShareText`. Replace lines 1-37 of `src/features/settle/ShareActions.tsx`:
  ```ts
  'use client'
  import { useState } from 'react'
  import { Link2, Share2, Check } from 'lucide-react'
  import { encodeShareHash } from '@/state/urlhash'
  import { useStore } from '@/state/store'
  import { Button } from '@/components/Button'

  /**
   * The whole round, in a URL. The hash never reaches any server —
   * fragments aren't sent in HTTP requests — so sharing stays as private
   * as the OCR.
   */
  function shareUrl(): string {
    const hash = encodeShareHash(useStore.getState().round)
    return `${window.location.origin}${window.location.pathname}#${hash}`
  }

  export function ShareActions() {
    const [copied, setCopied] = useState(false)

    const copy = async () => {
      try {
        await navigator.clipboard.writeText(shareUrl())
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        /* clipboard denied — the native share path still works */
      }
    }

    const nativeShare = async () => {
      try {
        await navigator.share({ title: 'Round — our bill', url: shareUrl() })
      } catch {
        /* user dismissed the share sheet */
      }
    }
  ```
  with:
  ```ts
  'use client'
  import { useState } from 'react'
  import { Link2, Share2, Check } from 'lucide-react'
  import { encodeShareHash } from '@/state/urlhash'
  import { useStore } from '@/state/store'
  import { Button } from '@/components/Button'
  import type { BillSplit } from '@/math/splitBill'
  import { shareMessage } from './shareMessage'
  import { buildShareText } from './shareText'

  /**
   * The whole round, in a URL. The hash never reaches any server —
   * fragments aren't sent in HTTP requests — so sharing stays as private
   * as the OCR.
   */
  function shareUrl(): string {
    const hash = encodeShareHash(useStore.getState().round)
    return `${window.location.origin}${window.location.pathname}#${hash}`
  }

  export function ShareActions({ split }: { split: BillSplit }) {
    const [copied, setCopied] = useState(false)

    const copy = async () => {
      try {
        const round = useStore.getState().round
        await navigator.clipboard.writeText(shareMessage(round, split, shareUrl()))
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        /* clipboard denied — the native share path still works */
      }
    }

    const nativeShare = async () => {
      try {
        const round = useStore.getState().round
        await navigator.share({
          title: 'Round — our bill',
          text: buildShareText(round, split),
          url: shareUrl(),
        })
      } catch {
        /* user dismissed the share sheet */
      }
    }
  ```
  (The JSX return block from the `const canNativeShare = …` line onward — the two `<Button>`s — is unchanged.)

- [ ] Step 6: Update `SettleSheet.tsx:62` in lockstep — pass the already-computed `split` (`SettleSheet.tsx:20`). Replace:
  ```tsx
          <ShareActions />
  ```
  with:
  ```tsx
          <ShareActions split={split} />
  ```

- [ ] Step 7: Typecheck — the done-criterion that NO propless `<ShareActions/>` remains.
  ```bash
  npm run typecheck
  ```
  Expected: exits 0. If it errors with `Property 'split' is missing` at any `<ShareActions/>` site, you missed a caller — grep and fix:
  ```bash
  grep -rn "<ShareActions" src
  ```
  Expected: exactly one match, `src/features/settle/SettleSheet.tsx`, with `split={split}`.

- [ ] Step 8: Run the new test + the shareText file together.
  ```bash
  npx vitest run tests/unit/shareActionsContent.test.ts tests/unit/shareText.test.ts
  ```
  Expected: both files green, zero failures.

- [ ] Step 9: Commit.
  ```bash
  git commit -am "Phase 5: ShareActions requires split prop; SettleSheet threads it in lockstep"
  ```

### Task 50: Integration — share LINK round-trips a portioned round through SettleSheet path

Prove the two halves the user sees: (1) the share TEXT footer grand total === `split.breakdown.grandTotal` for a portioned round, and (2) the share LINK still round-trips the editable portioned round byte-for-byte through `encodeShareHash`/`decodeShareHash`. This is the SettleSheet→ShareActions data contract, validated at the data layer (no DOM).

**Files:**
- Test: `tests/unit/urlhash.test.ts` (append a new describe) and `tests/unit/shareText.test.ts` (add the footer round-trip linkage assertion)

- [ ] Step 1: Add a portioned round-trip describe to `tests/unit/urlhash.test.ts`. Append it after the existing final describe in the file (the `sample`, `encodeShareHash`, `decodeShareHash`, and `cents` symbols are already imported by the file header — if the existing fixture is not named `sample`, reuse whatever the file's existing round fixture is named):
  ```ts
  describe('share hash — portions', () => {
    const portioned: RoundState = {
      ...sample,
      items: [
        ...sample.items,
        {
          id: 'p1',
          name: 'One36 Pork Adobo w/ Egg',
          qty: 3,
          unitPrice: cents(1400),
          assignedDinerIds: [],
          portions: [
            { units: 1, assignedDinerIds: ['d1'] },
            { units: 2, assignedDinerIds: ['d1', 'd2', 'd3'] },
          ],
        },
      ],
    }

    it('round-trips a portioned round byte-for-byte', () => {
      const hash = encodeShareHash(portioned)
      expect(decodeShareHash(hash)).toEqual(portioned)
    })

    it('a v1 link without portions still decodes un-split (no portions key)', () => {
      const decoded = decodeShareHash(encodeShareHash(sample))!
      expect(decoded.items.every((i) => !('portions' in i))).toBe(true)
    })

    it('a v1 link with a non-conserving portion decodes downgraded, never null', async () => {
      const { compressToEncodedURIComponent } = await import('lz-string')
      const bad = JSON.parse(JSON.stringify(portioned)) as RoundState
      // Force Σ units (1+2=3) ≠ qty by bumping qty to 4 → schema downgrades to un-split.
      ;(bad.items[bad.items.length - 1] as { qty: number }).qty = 4
      const hash = 'r=' + compressToEncodedURIComponent(JSON.stringify({ v: 1, s: bad }))
      const decoded = decodeShareHash(hash)
      expect(decoded).not.toBeNull()
      expect('portions' in decoded!.items[decoded!.items.length - 1]!).toBe(false)
    })

    it('stays under 2000 chars with a portioned item', () => {
      expect(encodeShareHash(portioned).length).toBeLessThan(2000)
    })
  })
  ```

- [ ] Step 2: Run the urlhash file and SEE these PASS. The round-trip and size assertions rely only on Phase 1's schema being portion-aware (already shipped); the downgrade assertion exercises the Phase-1 `.transform`.
  ```bash
  npx vitest run tests/unit/urlhash.test.ts
  ```
  Expected: every test in `urlhash.test.ts` passes — the pre-existing cases plus the four new `share hash — portions` tests, zero failures. (If the downgrade test fails with the item still carrying `portions`, the Phase-1 `.transform` is not present — STOP; this task depends on Phase 1 being merged.)

- [ ] Step 3: Add the SettleSheet→ShareActions footer-linkage assertion to `tests/unit/shareText.test.ts` proving the text the user copies reconciles to the same grand total the SettleSheet footer shows. Add inside `describe('buildShareText', …)`:
  ```ts
    it('share text footer matches the SettleSheet grand total for a portioned round', () => {
      const split = splitBill(worked)
      const text = buildShareText(worked, split)
      // SettleSheet renders <Money cents={split.breakdown.grandTotal}/> in its footer;
      // buildShareText must end on the same number, formatted.
      expect(text.trimEnd().endsWith(`Everyone together — $194.24`)).toBe(true)
      expect(split.breakdown.grandTotal).toBe(19424)
    })
  ```

- [ ] Step 4: Run the shareText file and SEE it PASS.
  ```bash
  npx vitest run tests/unit/shareText.test.ts
  ```
  Expected: every test in `shareText.test.ts` passes (the prior cases + this one), zero failures.

- [ ] Step 5: Commit.
  ```bash
  git commit -am "Phase 5: integration tests — portioned share link round-trip + footer linkage"
  ```

### Task 51: Full-suite green + typecheck (Phase 5 done-criteria gate)

The Phase 5 done-criteria: `Σ line.food === food` (every invariant intact), `tsc` exit 0 (no dangling propless `<ShareActions/>`), existing settle tests pass (lines additive), share round-trip carries portions. This task is the gate — no new code, only proof. Per the cumulative-baseline rule, assert ZERO failures, NOT a fixed count.

**Files:** none (verification only)

- [ ] Step 1: Run the entire suite.
  ```bash
  npm test
  ```
  Expected: the vitest summary reports ZERO failures. The NEW Phase-5 tests that must appear green: the `splitBill — lines decomposition` cases in `splitBill.test.ts`; all of `lineLabel.test.ts`, `shareText.test.ts`, `dinerCardRows.test.ts`, `shareActionsContent.test.ts`; and the `share hash — portions` cases in `urlhash.test.ts`. Every pre-existing test (from Phases 1-4 and the original baseline) must still pass — un-split behavior is unchanged, `DinerSplit` only gained an additive field, and `ShareActions`'s signature change was matched in lockstep by `SettleSheet`. If ANY test fails, STOP and debug; do not proceed on red.

- [ ] Step 2: Typecheck — the hard done-criterion.
  ```bash
  npm run typecheck
  ```
  Expected: prints nothing after the `> tsc --noEmit` banner, exits 0.

- [ ] Step 3: Confirm no propless `<ShareActions/>` survived anywhere.
  ```bash
  grep -rn "<ShareActions" src
  ```
  Expected: exactly one line — `src/features/settle/SettleSheet.tsx:...:          <ShareActions split={split} />`.

- [ ] Step 4: Confirm the engine still constructs `DinerSplit` in exactly one place and `lines` is wired (sanity that no half-edit remains).
  ```bash
  grep -rn "lines:" src/math/splitBill.ts
  ```
  Expected: one line — `      lines: linesByDiner[i]!,` inside the `perDiner` map.

- [ ] Step 5: No commit needed (verification only). The prior tasks already committed; if `git status` is clean, this gate is documentation. Phase 5 is complete: the engine emits a per-(item|portion) FoodLine decomposition that sums exactly to each diner's food, the settle card and share text share one `lineLabel`, fully-treated diners read "Treated — pays nothing" / "$0.00 (treated)", and the portioned round round-trips through the share link.

### Task 52: Manual settle/share verification (locked UI-test strategy — no DOM automation)

Per the locked strategy, component RENDERING is verified MANUALLY, not by jsdom/snapshot/DOM automation. This task is the human walk-through that, together with the pure `dinerCardRows` node test, fully covers the spec's "DinerCard un-split snapshot re-baseline" intent (the snapshot requirement itself is superseded by the locked node-only strategy). Run the dev server and walk the worked scenario, confirming the spec §6.3 card and §6.4 share text.

**Files:** none (manual)

- [ ] Step 1: Start the dev server (serves on http://localhost:5173 per `package.json` `dev`).
  ```bash
  npm run dev
  ```
  Expected: Next prints `- Local: http://localhost:5173`. Leave it running; open that URL in a browser.

- [ ] Step 2: Build the worked scenario in the workspace UI (the Phase 4 affordances): add diners P1, P2, P3, M; add items Pan-Seared Snapper (qty 5, everyone), One36 Pork Adobo w/ Egg (qty 3), Grilled Chicken Chop (qty 3). For Adobo: Split into parts → Add part → Part 1 = 1 unit assigned Only P1; Part 2 = 2 units, toggle M OFF (leaving P1,P2,P3). For Chicken: Part 1 = 1 unit Only P2; Part 2 = 2 units with M OFF. (Prices: Snapper $18, Adobo $14, Chicken $10.)
  - [ ] Verify checklist (settle screen — tap "Square up"):
    - P1 collapsed total reads **$62.96**; P2 **$58.15**; P3 **$46.15**; M **$26.98**.
    - Expand P1: rows read `Pan-Seared Snapper $22.50`, `One36 Pork Adobo w/ Egg · 1 of 3 $14.00`, `One36 Pork Adobo w/ Egg · shared 2 of 3 $9.34`, `Grilled Chicken Chop · shared 2 of 3 $6.67`, then Service charge and GST rows.
    - Expand M: rows read `Pan-Seared Snapper $22.50`, Service charge, GST — and NO Adobo or Chicken row (treated by absence).
    - Footer "Everyone together" reads **$194.24**.

- [ ] Step 3: Verify the share text. Tap "Copy link", paste into a note. Confirm: a `P1 — $62.96` block with the same `· 1 of 3` / `· shared 2 of 3` labels as the card; an `M — $26.98` block listing only Snapper + charges; footer `Everyone together — $194.24`; then a blank line and the `#r=…` link. Paste that link into a fresh tab → the portioned round (including the Adobo/Chicken parts and M's exclusions) loads identically.

- [ ] Step 4: Verify the fully-treated case: in a fresh round, give M no share of anything (split every item with M toggled off on every portion). M's card shows a single muted **`Treated — pays nothing`** row, total **$0.00**; the share text shows **`M — $0.00 (treated)`**.

- [ ] Step 5: Stop the dev server (Ctrl-C). If everything above matched, the phase is complete and the branch is ready to finish (merge/PR per the team's process).

---

## Phase 6 — OCR regression lock (tests-only; no production change)

## Phase 6 — OCR regression lock (TESTS ONLY — no production file changes)

> **Why this phase exists (spec §8, §12 Phase 6).** The portions feature is post-OCR and user-driven. `Item` is born in exactly one place — `toItem` at `src/features/ocr/mapToState.ts:17-27` — which emits `{ id, name, qty, unitPrice, assignedDinerIds: [] }` with NO `portions` key. That is already a valid new `Item` (`portions` optional ⇒ `undefined` ⇒ `isPortioned` false ⇒ today's exact engine branch). Phase 6 adds **only regression tests** that pin this portion-free contract, so any future "optimization" that seeds a portion in `toItem` fails loudly. **No production source is touched in this phase.**
>
> **Dependencies.** Phase 6 depends only on Phase 1 (it imports `isPortioned` from `@/state/types` and `parseRoundState` / `itemZod` from `@/state/schema`, both delivered in Phase 1). It does NOT import any Phase 3 store symbol — the "splitItem can later portion" criterion is verified as an Item-SHAPE contract (qty ≥ 2, no `portions` own-property) rather than by calling `splitItem`, keeping this phase a strict superset of Phase 1.
>
> **Baseline for this phase (cumulative — phases run sequentially).** The total number of test files and tests grows as earlier phases land, so do NOT compare against any fixed global total. Before starting, confirm the suite is green: run `npm test` and confirm the summary reports **zero failures** (no `FAIL` line anywhere). Then run the single file this phase edits — `npx vitest run tests/unit/mapToState.test.ts` — and expect `Tests  16 passed (16)` (this file's current deterministic count, unaffected by other phases). Run `npm run typecheck` and expect exit 0. These three (suite zero-failures, mapToState file at 16, typecheck clean) are the green-light gates.

### Task 53: Pin the no-portions-key contract on raw OCR output

`mapToState` (`src/features/ocr/mapToState.ts:47-81`) maps each clean line through `toItem` (`:17-27`). `toItem` returns an object literal with exactly five keys and NEVER a `portions` key. This task adds the first regression test asserting that, distinguishing `portions === undefined` (true even if a key were present with value undefined) from the stronger `'portions' in item === false` (no own-property at all — what the spec §11 case "never emits a portions key (`portions === undefined` AND `'portions' in item === false`)" requires).

**Files:**
- Modify (test): `tests/unit/mapToState.test.ts` — add a new `describe('mapToState — portions')` block after the final existing `describe` (which ends at `:206`).

Note on test data: the file already defines a `receipt(over)` factory (`:10-19`) and a `green` verdict (`:8`). Reuse them — do NOT redefine. The new block lives at the bottom of the file, after line 206.

- [ ] Step 1: Append the new describe block with the first test to `tests/unit/mapToState.test.ts`. Add these lines at the very end of the file (after the closing `})` of the `'mapToState — rounding + GST default regression'` describe on line 206):

```ts

describe('mapToState — portions', () => {
  it('never emits a portions key — portions undefined and not an own-property', () => {
    const s = mapToState(
      receipt({
        items: [
          { name: 'Pan-Seared Snapper', qty: 5, line_total: 90.0 },
          { name: 'One36 Pork Adobo w/ Egg', qty: 3, line_total: 42.0 },
        ],
      }),
      green,
    )
    for (const item of s.items) {
      expect(item.portions).toBeUndefined()
      expect('portions' in item).toBe(false)
    }
  })
})
```

- [ ] Step 2: Run the new test by name and watch it PASS (production already satisfies the contract — this is a pinning test, not a red-then-green):

```
npx vitest run tests/unit/mapToState.test.ts -t "never emits a portions key — portions undefined and not an own-property"
```

Expected output (tail):
```
 ✓ tests/unit/mapToState.test.ts > mapToState — portions > never emits a portions key — portions undefined and not an own-property
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

- [ ] Step 3: Prove the test is a real tripwire (it FAILS if production ever seeds a portion). Temporarily edit `src/features/ocr/mapToState.ts` `toItem` return (`:20-26`) to add a portions key — change the returned object to:

```ts
  return {
    id: newId(),
    name,
    qty: evenSplit ? qty : 1,
    unitPrice: evenSplit ? cents(line / qty) : line,
    assignedDinerIds: [],
    portions: [],
  }
```

Then re-run the same command:

```
npx vitest run tests/unit/mapToState.test.ts -t "never emits a portions key — portions undefined and not an own-property"
```

Expected FAILURE (the `'portions' in item` assertion fires; `portions: []` is an own-property):
```
 FAIL  tests/unit/mapToState.test.ts > mapToState — portions > never emits a portions key — portions undefined and not an own-property
AssertionError: expected true to be false // Object.is equality
- Expected
+ Received
- false
+ true
```

- [ ] Step 4: REVERT the production tripwire edit so `mapToState.ts` is byte-identical to before (remove the `portions: []` line — restore the exact five-key literal at `:20-26`). Confirm with `git diff src/features/ocr/mapToState.ts` showing NO output (empty diff). Production must remain untouched by this phase.

- [ ] Step 5: Re-run the test to confirm PASS again after revert:

```
npx vitest run tests/unit/mapToState.test.ts -t "never emits a portions key — portions undefined and not an own-property"
```

Expected: `Tests  1 passed (1)`.

- [ ] Step 6: Commit.

```
git add tests/unit/mapToState.test.ts
git commit -m "test(ocr): pin OCR output never emits a portions key

mapToState/toItem must produce items with no portions own-property so no
future change silently pre-splits an OCR row. Asserts both portions===undefined
and 'portions' in item===false (the stronger own-property check).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 54: Pin isPortioned() false for every OCR item

The single predicate every consumer branches on is `isPortioned` (`src/state/types.ts`, added in Phase 1: `Array.isArray(it.portions) && it.portions.length > 0`). For OCR output it must be `false` for every item — that is the guarantee that OCR rows take the un-split engine branch (`splitBill.ts` `else`). This test asserts the predicate directly, complementing the structural `portions`-key test.

**Files:**
- Modify (test): `tests/unit/mapToState.test.ts` — add `import { isPortioned } from '@/state/types'` and a second test inside `describe('mapToState — portions')`.

- [ ] Step 1: Extend the existing `@/state/types` import line. The file currently imports only `lineTotal` at `:4`:

```ts
import { lineTotal } from '@/state/types'
```

Replace that line with:

```ts
import { lineTotal, isPortioned } from '@/state/types'
```

- [ ] Step 2: Add the second test inside the `describe('mapToState — portions')` block, after the `'never emits a portions key …'` test's closing `})` and before the describe's closing `})`:

```ts

  it('isPortioned() is false for every OCR item', () => {
    const s = mapToState(
      receipt({
        items: [
          { name: 'Pan-Seared Snapper', qty: 5, line_total: 90.0 },
          { name: 'One36 Pork Adobo w/ Egg', qty: 3, line_total: 42.0 },
          { name: 'Grilled Chicken Chop', qty: 3, line_total: 30.0 },
        ],
      }),
      green,
    )
    expect(s.items.map(isPortioned)).toEqual([false, false, false])
  })
```

- [ ] Step 3: Run the new test by name and watch it PASS:

```
npx vitest run tests/unit/mapToState.test.ts -t "isPortioned() is false for every OCR item"
```

Expected output (tail):
```
 ✓ tests/unit/mapToState.test.ts > mapToState — portions > isPortioned() is false for every OCR item
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

- [ ] Step 4: Typecheck — the new `isPortioned` import must resolve (it is exported by `@/state/types` from Phase 1):

```
npm run typecheck
```

Expected: exit 0, no output.

- [ ] Step 5: Commit.

```
git add tests/unit/mapToState.test.ts
git commit -m "test(ocr): pin isPortioned() false for every OCR item

Asserts the consumer predicate (not just the key shape) so OCR rows are
guaranteed onto the un-split engine branch.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 55: Pin byte-identical JSON serialization (no portions key survives a round-trip)

Spec §8: "Un-split path is byte-identical to today … through every engine, schema, store, codec, and storage layer; … and OCR output." A JSON round-trip is the cheapest proof that no `portions` key leaks into the serialized form an OCR item would carry into a draft or share link. This test serializes the OCR item, re-parses it, and asserts the parsed object has no `portions` own-property and is deep-equal to the original.

**Files:**
- Modify (test): `tests/unit/mapToState.test.ts` — add a third test inside `describe('mapToState — portions')`.

- [ ] Step 1: Add the third test inside the `describe('mapToState — portions')` block, after the `'isPortioned() is false for every OCR item'` test's closing `})`:

```ts

  it('serializes byte-identical to an un-split item — JSON round-trip carries no portions key', () => {
    const s = mapToState(
      receipt({ items: [{ name: 'Tiger Beer', qty: 3, line_total: 27.0 }] }),
      green,
    )
    const item = s.items[0]!
    const json = JSON.stringify(item)
    expect(json.includes('portions')).toBe(false)
    const reparsed = JSON.parse(json) as typeof item
    expect('portions' in reparsed).toBe(false)
    expect(reparsed).toEqual(item)
    expect(Object.keys(item).sort()).toEqual([
      'assignedDinerIds',
      'id',
      'name',
      'qty',
      'unitPrice',
    ])
  })
```

- [ ] Step 2: Run the new test by name and watch it PASS:

```
npx vitest run tests/unit/mapToState.test.ts -t "serializes byte-identical to an un-split item — JSON round-trip carries no portions key"
```

Expected output (tail):
```
 ✓ tests/unit/mapToState.test.ts > mapToState — portions > serializes byte-identical to an un-split item — JSON round-trip carries no portions key
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

- [ ] Step 3: Commit.

```
git add tests/unit/mapToState.test.ts
git commit -m "test(ocr): pin OCR item JSON serialization carries no portions key

A JSON round-trip and an exact key-set assertion lock the byte-identical
serialization guarantee from spec §8 for OCR output.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 56: Pin OCR output through parseRoundState — transform is a portion-free no-op

Spec §8: `useScan` feeds `mapToState` output straight to `loadRound` WITHOUT re-parsing through `parseRoundState` (OCR output is trusted). But the schema's `.transform` (Phase 1) must still be a clean no-op on OCR output if it ever DID pass through — proving the OCR-shaped item is a valid `itemZod` input and the units-conservation downgrade never fires on it (no portions ⇒ first branch returns `{...rest}` with the key already absent). This is the spec §11 case "OCR output parses through `parseRoundState`/`itemZod` with the transform as a no-op (returns portion-free)" and the migration case "OCR output is a valid un-split Item."

**Files:**
- Modify (test): `tests/unit/mapToState.test.ts` — add `import { parseRoundState } from '@/state/schema'` and a fourth test inside `describe('mapToState — portions')`.

- [ ] Step 1: Add the `parseRoundState` import. The file's imports currently end with the types import (now `import { lineTotal, isPortioned } from '@/state/types'` from the previous task) at `:4` and the money import at `:5`. Add a new import line immediately after the `@/state/types` import:

```ts
import { parseRoundState } from '@/state/schema'
```

- [ ] Step 2: Add the fourth test inside the `describe('mapToState — portions')` block, after the `'serializes byte-identical …'` test's closing `})`:

```ts

  it('OCR output parses through parseRoundState with the transform as a portion-free no-op', () => {
    const s = mapToState(
      receipt({
        items: [
          { name: 'Chilli Crab', qty: 1, line_total: 88.0 },
          { name: 'Tiger Beer', qty: 3, line_total: 27.0 },
        ],
      }),
      green,
    )
    const parsed = parseRoundState(s)
    expect(parsed).not.toBeNull()
    expect(parsed!.items).toHaveLength(2)
    for (const item of parsed!.items) {
      expect('portions' in item).toBe(false)
      expect(isPortioned(item)).toBe(false)
    }
    // the schema transform did not alter the OCR items at all
    expect(parsed!.items).toEqual(s.items)
  })
```

- [ ] Step 3: Run the new test by name and watch it PASS:

```
npx vitest run tests/unit/mapToState.test.ts -t "OCR output parses through parseRoundState with the transform as a portion-free no-op"
```

Expected output (tail):
```
 ✓ tests/unit/mapToState.test.ts > mapToState — portions > OCR output parses through parseRoundState with the transform as a portion-free no-op
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

- [ ] Step 4: Typecheck — `parseRoundState` import must resolve (Phase 1 export):

```
npm run typecheck
```

Expected: exit 0, no output.

- [ ] Step 5: Commit.

```
git add tests/unit/mapToState.test.ts
git commit -m "test(ocr): pin OCR output as a no-op through parseRoundState transform

Proves an OCR-shaped item is a valid itemZod input whose units-conservation
transform never fires (no portions present) and returns the items unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 57: Pin multi-unit evenly-divisible item stays un-split (never pre-portioned)

`toItem` (`mapToState.ts:19,23-24`) preserves `qty` when the line divides evenly (`evenSplit`), producing e.g. a qty-3 item. Spec §11: "multi-unit evenly-divisible item (qty 3) is emitted un-split, never pre-portioned." A naive future change might assume a multi-unit line should be pre-split into per-unit portions — this test forbids that. It asserts the qty is preserved AND no portions exist (so `isPortioned` is false despite qty > 1).

**Files:**
- Modify (test): `tests/unit/mapToState.test.ts` — add a fifth test inside `describe('mapToState — portions')`.

- [ ] Step 1: Add the fifth test inside the `describe('mapToState — portions')` block, after the `'OCR output parses through parseRoundState …'` test's closing `})`:

```ts

  it('a multi-unit evenly-divisible item (qty 3) is emitted un-split, never pre-portioned', () => {
    const s = mapToState(
      receipt({ items: [{ name: 'Grilled Chicken Chop', qty: 3, line_total: 30.0 }] }),
      green,
    )
    const item = s.items[0]!
    expect(item.qty).toBe(3)
    expect(item.unitPrice).toBe(1000)
    expect(isPortioned(item)).toBe(false)
    expect('portions' in item).toBe(false)
  })
```

- [ ] Step 2: Run the new test by name and watch it PASS:

```
npx vitest run tests/unit/mapToState.test.ts -t "a multi-unit evenly-divisible item (qty 3) is emitted un-split, never pre-portioned"
```

Expected output (tail):
```
 ✓ tests/unit/mapToState.test.ts > mapToState — portions > a multi-unit evenly-divisible item (qty 3) is emitted un-split, never pre-portioned
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

- [ ] Step 3: Commit.

```
git add tests/unit/mapToState.test.ts
git commit -m "test(ocr): pin multi-unit OCR item stays un-split, never pre-portioned

A qty-3 evenly-divisible row keeps qty=3 and carries no portions; forbids a
future change that auto-splits multi-unit lines.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 58: Pin OCR item is a valid un-split Item shape that splitItem can later portion

Spec §11 migration case + §12 Phase 6 done-criterion: "OCR output is a valid un-split Item that `splitItem` can portion" / "a valid new Item that `splitItem` can later portion." Phase 6 depends only on Phase 1, so this test does NOT import the Phase-3 `splitItem` action. Instead it asserts the exact Item-SHAPE preconditions `splitItem` requires before it will portion an item (spec §4 `splitItem`: no-op `if (!it || it.qty < 2 || it.portions) return`): the OCR item must have `qty >= 2` and NO `portions` key, with an `assignedDinerIds` array `splitItem` will copy into portion 0. This pins the boundary contract without coupling Phase 6 to a later phase.

**Files:**
- Modify (test): `tests/unit/mapToState.test.ts` — add a sixth test inside `describe('mapToState — portions')`.

- [ ] Step 1: Add the sixth test inside the `describe('mapToState — portions')` block, after the `'a multi-unit evenly-divisible item …'` test's closing `})` and before the describe's closing `})`:

```ts

  it('emits a valid un-split Item shape that splitItem can later portion (qty>=2, no portions)', () => {
    // splitItem (Phase 3) no-ops unless qty >= 2 and portions is absent, then
    // copies assignedDinerIds into portion 0. Assert those preconditions on the
    // raw OCR item WITHOUT importing the Phase-3 action (Phase 6 depends only on
    // Phase 1).
    const s = mapToState(
      receipt({ items: [{ name: 'One36 Pork Adobo w/ Egg', qty: 3, line_total: 42.0 }] }),
      green,
    )
    const item = s.items[0]!
    expect(item.qty).toBeGreaterThanOrEqual(2)
    expect('portions' in item).toBe(false)
    expect(Array.isArray(item.assignedDinerIds)).toBe(true)
    // simulate splitItem's seed (one full-allocation portion copying assignedDinerIds)
    // to prove the shape supports it cleanly, with units conserving to qty.
    const seeded = {
      ...item,
      portions: [{ units: item.qty, assignedDinerIds: [...item.assignedDinerIds] }],
    }
    const sumUnits = seeded.portions.reduce((a, p) => a + p.units, 0)
    expect(sumUnits).toBe(item.qty)
    expect(isPortioned(seeded)).toBe(true)
  })
```

- [ ] Step 2: Run the new test by name and watch it PASS:

```
npx vitest run tests/unit/mapToState.test.ts -t "emits a valid un-split Item shape that splitItem can later portion (qty>=2, no portions)"
```

Expected output (tail):
```
 ✓ tests/unit/mapToState.test.ts > mapToState — portions > emits a valid un-split Item shape that splitItem can later portion (qty>=2, no portions)
 Test Files  1 passed (1)
      Tests  1 passed (1)
```

- [ ] Step 3: Commit.

```
git add tests/unit/mapToState.test.ts
git commit -m "test(ocr): pin OCR item as a valid un-split Item splitItem can later portion

Asserts splitItem's preconditions (qty>=2, no portions, assignedDinerIds array)
on the raw OCR item and simulates the full-allocation seed, without importing the
Phase-3 action (Phase 6 depends only on Phase 1).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 59: Extend two existing cases with the portion-free canary

Spec §11: "EXTEND 'converts dollars to cents…' (`:22`) and 'carries venue, discount, verdict…' (`:76`) to also assert all items are portion-free (the canonical-shape canary)." These two tests exercise the two most-used OCR shapes (multi-item conversion; metadata carry). Adding a portion-free assertion to each means the contract is checked on the everyday paths, not only in the dedicated portions block.

**Files:**
- Modify (test): `tests/unit/mapToState.test.ts:32-34` (inside "converts dollars to cents and preserves line totals exactly") and `:79-82` (inside "carries venue, discount, verdict; diners start empty").

- [ ] Step 1: Extend "converts dollars to cents and preserves line totals exactly". The test body currently ends (`:32-34`):

```ts
    expect(s.items.map(lineTotal)).toEqual([8800, 2700])
    expect(s.items[1]!.qty).toBe(3)
    expect(s.items[1]!.unitPrice).toBe(900)
```

Add the canary assertion immediately after the `unitPrice` line, so the block becomes:

```ts
    expect(s.items.map(lineTotal)).toEqual([8800, 2700])
    expect(s.items[1]!.qty).toBe(3)
    expect(s.items[1]!.unitPrice).toBe(900)
    // canonical-shape canary: OCR items are never portioned
    expect(s.items.every((it) => !('portions' in it))).toBe(true)
    expect(s.items.map(isPortioned)).toEqual([false, false])
```

- [ ] Step 2: Extend "carries venue, discount, verdict; diners start empty". The test body currently ends (`:79-82`):

```ts
    expect(s.venue).toBe('Lau Pa Sat')
    expect(s.discount).toBe(500)
    expect(s.scan).toEqual(v)
    expect(s.diners).toEqual([])
```

This test uses `receipt({ discount: 5.0, venue: 'Lau Pa Sat' })`, whose `items` default to `[]` (from the `receipt` factory at `:11`), so there are no items to map. To make the canary meaningful, give it one item AND assert portion-freedom. Replace the test's `mapToState` call line (`:78`):

```ts
    const s = mapToState(receipt({ discount: 5.0, venue: 'Lau Pa Sat' }), v)
```

with:

```ts
    const s = mapToState(
      receipt({ discount: 5.0, venue: 'Lau Pa Sat', items: [{ name: 'Set', qty: 1, line_total: 20.0 }] }),
      v,
    )
```

Then add the canary assertion immediately after `expect(s.diners).toEqual([])` so the block ends:

```ts
    expect(s.venue).toBe('Lau Pa Sat')
    expect(s.discount).toBe(500)
    expect(s.scan).toEqual(v)
    expect(s.diners).toEqual([])
    // canonical-shape canary: OCR items are never portioned
    expect(s.items.every((it) => !('portions' in it) && !isPortioned(it))).toBe(true)
```

- [ ] Step 3: Run both extended tests by name and watch them PASS:

```
npx vitest run tests/unit/mapToState.test.ts -t "converts dollars to cents and preserves line totals exactly"
npx vitest run tests/unit/mapToState.test.ts -t "carries venue, discount, verdict; diners start empty"
```

Expected for each: `Tests  1 passed (1)` with the matching `✓` line.

- [ ] Step 4: Commit.

```
git add tests/unit/mapToState.test.ts
git commit -m "test(ocr): add portion-free canary to two common-path mapToState cases

Extends the dollars→cents conversion and metadata-carry tests to assert OCR
items carry no portions key, so the contract is enforced on everyday paths.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 60: Full-file + full-suite green; boundary pinned

Confirm the whole `mapToState.test.ts` file passes with the six new tests + two extended, then confirm the full suite and typecheck are green — the Phase 6 done-criteria (spec §12: "suite green; boundary pinned so no future change silently pre-splits OCR rows").

**Files:**
- None (verification only).

- [ ] Step 1: Run the entire `mapToState.test.ts` file. This single file's count is deterministic and unaffected by other phases — the original 16 tests plus the 6 new tests in the `mapToState — portions` block (the two extended tests are still counted within the original 16):

```
npx vitest run tests/unit/mapToState.test.ts
```

Expected output (tail):

```
 Test Files  1 passed (1)
      Tests  22 passed (22)
```

- [ ] Step 2: Confirm no production source changed in this phase (Phase 6 is tests-only). Expect output listing ONLY the test file:

```
git diff --name-only de893f2..HEAD -- src/features/ocr/
```

Expected: empty output (no OCR production file touched by Phase 6). If any `src/` path under `ocr/` appears, a tripwire revert (Task 1, Step 4) was missed — re-revert before proceeding.

- [ ] Step 3: Run the full suite — every pre-existing test must still pass (un-split behavior byte-identical). The suite total is cumulative across all prior phases, so do NOT compare against any fixed number; instead confirm zero failures and that the 6 new `mapToState — portions` tests are present and passing:

```
npm test
```

Expected: the summary reports **zero failures** — no `FAIL` line anywhere in the output, and the `✓ tests/unit/mapToState.test.ts` line shows all of its tests passing (the file's count is 22 as confirmed in Step 1). Do not assert an absolute `Test Files` or `Tests` total.

- [ ] Step 4: Typecheck:

```
npm run typecheck
```

Expected: exit 0, no output. The new imports (`isPortioned` from `@/state/types`, `parseRoundState` from `@/state/schema`) resolve and the test file is well-typed.

- [ ] Step 5 (manual verification — locked UI-test strategy, no DOM deps): start the dev server and confirm a real scanned receipt still produces un-split rows in the workspace (the OCR boundary is exercised end-to-end in the browser, not by automated DOM tests):

```
npm run dev
```

Then in a browser at `http://localhost:5173`, run this click-through checklist:
1. Open the app and scan (or paste) a receipt with a multi-unit line (e.g. "3× Grilled Chicken Chop").
2. Confirm the workspace receipt list shows that row as a normal un-split item — NO indented portion sublines beneath it (those only appear after a manual "Split into parts", a Phase 4 affordance).
3. Tap the row to open `AssignSheet`; confirm it opens in the un-split (today's) mode with the item-level toggle list, NOT the PortionEditor.
4. Stop the dev server (Ctrl-C).

Record the result inline (no file): "OCR rows render un-split; AssignSheet opens in un-split mode — confirmed."

- [ ] Step 6: There is nothing to commit for this verification task (no file changes). Confirm a clean tree:

```
git status --porcelain
```

Expected: empty output. Phase 6 is complete — the OCR→Item boundary is pinned portion-free by 8 assertions across 6 new tests and 2 extended tests, and the suite is green.
