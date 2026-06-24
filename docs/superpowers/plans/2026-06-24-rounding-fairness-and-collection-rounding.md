# Rounding Fairness (B2) + Collection Rounding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make diners who owe an identical amount land within 1¢ of each other (today: up to 11¢ apart), then add an opt-in "collection rounding" layer that rounds each person to a friendly number with the bill-payer absorbing the difference.

**Architecture:** Two phases. **Phase 1** changes only how the *per-diner total* is rounded in `src/math/splitBill.ts`: instead of rounding each item/charge independently (errors correlate → spread), compute each diner's **exact** total share and round it in **one** largest-remainder pass (`distributeProportionally(grandTotal, exactFood)`). Per-item `food`/`lines` stay byte-identical (approach "keep food, round the total"), so display contracts and most tests are untouched; charge columns are back-derived from `total − food`. **Phase 2** adds `payerId` + `collectRounding` state and a presentation layer that rounds non-payers down and lets the payer absorb the loss, shown cleanly with no mechanics.

**Tech Stack:** TypeScript, Vitest, Zustand (+ immer), Zod, React 19 / Next 16, integer-cents branded `Cents` type.

**Spec:** `docs/superpowers/specs/2026-06-24-rounding-fairness-and-collection-rounding-design.md`

## Global Constraints

- **All money is integer `Cents`** (branded; `cents()` throws on non-integers). Dollars only at I/O. — `src/math/money.ts`
- **LOCKED invariant:** `Σ perDiner.total === breakdown.grandTotal` for every input. Property test `tests/unit/splitBill-property.test.ts` must stay green.
- **LOCKED SG tax order:** `discount → service(×pct) → GST(×pct on discounted+service)`, each rounded to the cent at aggregate. `applyCharges` in `src/math/singapore.ts` is **not modified**.
- **Fairness target:** two diners with equal exact share differ by **≤1¢** after rounding.
- **Display contracts (must hold per diner):** `Σ lines.food === food`; and the expanded card/share rows `Σ lines + discount + service + gst === total`. — `src/features/settle/dinerCardRows.ts`, `shareText.ts`.
- **Determinism:** largest-remainder ties break to the lowest index (existing `proportional.ts:48` comparator is **not** changed).
- Run tests with `npx vitest run <path>`; typecheck with `npm run typecheck`.

---

## Phase 1 — B2 fairness engine

### Task 1: Round the per-diner total once over exact food

**Files:**
- Modify: `src/math/splitBill.ts` (the pipeline: `splitBill`, `allocateEqually`; add `splitToTarget` helper)
- Modify: `tests/unit/splitBill.test.ts` (update the 4 worked-fareware totals + the rounding-line test)
- Test: `tests/unit/splitBill.test.ts` (new Bistro golden test)

**Interfaces:**
- Consumes: `distributeProportionally(total: Cents, weights: number[]): Cents[]` (accepts float weights), `applyCharges`, `addC`, `cents`, `ZERO`, types `Diner/Item/RoundState`, `lineTotal/portionTotal/isPortioned`.
- Produces: unchanged `BillSplit`/`DinerSplit` shape. `perDiner[i].food` and `.lines` are byte-identical to today; `.total` is now the single-pass fair value; `.service/.gst/.discount` are back-derived display columns summing (with food) to `.total`. `residual` is always `ZERO`, `residualDinerId` always `null` (fields retained this task; removed in Task 3).

- [ ] **Step 1: Write the failing Bistro golden test**

Add to `tests/unit/splitBill.test.ts` inside a new `describe`:

```ts
describe('splitBill — fairness (B2)', () => {
  const portioned = (
    id: string, unitPrice: number, qty: number,
    portions: { units: number; assignedDinerIds: string[] }[],
  ): Item => ({ id, name: id, qty, unitPrice: cents(unitPrice), assignedDinerIds: [], portions })

  it('Bistro OneThirtySix: 7 identical diners land within 1¢', () => {
    const names = ['Shi Ling', 'Su yi', 'Suan sim', 'jit', 'Edwin', 'connie', 'sin yun', 'Shu fen']
    const state = round({
      diners: names.map((n) => diner(n)),
      items: [
        portioned('adobo', 1590, 3, [
          { units: 2, assignedDinerIds: ['Shi Ling', 'Edwin'] },
          { units: 1, assignedDinerIds: [] },
        ]),
        item('snapper', 1590, 5, ['Suan sim', 'jit', 'connie', 'sin yun', 'Shu fen']),
        portioned('chicken', 1490, 3, [
          { units: 2, assignedDinerIds: [] },
          { units: 1, assignedDinerIds: ['Su yi'] },
        ]),
      ],
    })
    const s = splitBill(state)
    const byName = Object.fromEntries(s.perDiner.map((d) => [d.dinerId, d.total]))
    // Seven diners owe an identical exact share (2161.25¢) → must be 2591 or 2592, never 2590/2593.
    const seven = names.filter((n) => n !== 'Su yi').map((n) => byName[n]!)
    expect(Math.max(...seven) - Math.min(...seven)).toBeLessThanOrEqual(1)
    expect(byName['Su yi']).toBe(2472)
    expect(s.breakdown.grandTotal).toBe(20611)
    expect(total(s)).toBe(20611)
    // Card reconciliation for one diner: lines + charges === total
    const sl = s.perDiner.find((d) => d.dinerId === 'Shi Ling')!
    const lineSum = sl.lines.reduce((a, l) => a + l.food, 0)
    expect(lineSum).toBe(sl.food)
    expect(sl.food + sl.discount + sl.service + sl.gst).toBe(sl.total)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/unit/splitBill.test.ts -t "land within 1"`
Expected: FAIL — today's engine yields a 3¢ spread (`max-min === 3`).

- [ ] **Step 3: Add the `splitToTarget` helper to `src/math/splitBill.ts`**

Insert after the imports, before `resolveParticipants`:

```ts
// Split integer `total` across `targets` (signed exact values that sum to ~total)
// into integers summing EXACTLY to total, each as close to its target as possible.
// Largest-remainder, sign-aware. Used to back-derive per-diner charge columns so
// the expanded card reconciles (food + discount + service + gst === total).
function splitToTarget(total: number, targets: number[]): number[] {
  const n = targets.length
  if (n === 0) return []
  const base = targets.map((t) => Math.floor(t))
  const res = base.slice()
  let leftover = total - base.reduce((a, b) => a + b, 0)
  const frac = targets.map((t, i) => t - base[i]!)
  const keys = [...Array(n).keys()]
  if (leftover > 0) {
    keys.sort((a, b) => frac[b]! - frac[a]! || a - b)
    for (let k = 0; k < leftover; k++) res[keys[k % n]!]! += 1
  } else if (leftover < 0) {
    keys.sort((a, b) => frac[a]! - frac[b]! || a - b)
    for (let k = 0; k < -leftover; k++) res[keys[k % n]!]! -= 1
  }
  return res
}
```

- [ ] **Step 4: Accumulate exact food in `allocateEqually`**

Change `allocateEqually` to also fill an `exactFood: number[]` array. New signature + body (add the `exactFood` param and the one accumulation line):

```ts
function allocateEqually(
  cost: Cents,
  participants: string[],
  idx: Map<string, number>,
  food: Cents[],
  exactFood: number[],
  item: Item,
  linesByDiner: FoodLine[][],
  portion: FoodLine['portion'],
): void {
  if (participants.length === 0) return
  const shares = distributeProportionally(
    cost,
    participants.map(() => 1),
  )
  const each = cost / participants.length // exact fractional share (display total uses this)
  participants.forEach((id, k) => {
    const i = idx.get(id)!
    food[i] = addC(food[i]!, shares[k]!)
    exactFood[i] += each
    linesByDiner[i]!.push({ itemId: item.id, name: item.name, food: shares[k]!, portion })
  })
}
```

- [ ] **Step 5: Rewrite the `splitBill` tail to round the total once and back-derive columns**

In `splitBill`, add `const exactFood: number[] = diners.map(() => 0)` next to `food`, pass `exactFood` into both `allocateEqually` calls (after `food`), then replace everything from `const subtotal = ...` to the `return` with:

```ts
  const subtotal = addC(...food)
  const breakdown = applyCharges(subtotal, {
    discount: state.discount,
    servicePct: state.servicePct,
    gstPct: state.gstPct,
    rounding: state.rounding,
  })

  // B2: the authoritative per-diner total — ONE largest-remainder pass over the
  // EXACT food shares. Identical exact shares ⇒ totals differ by ≤1¢ by construction,
  // and Σ totals === grandTotal. (Weights are exact, NOT the rounded food[].)
  const totals = distributeProportionally(breakdown.grandTotal, exactFood)
  const sub = subtotal as number

  const perDiner: DinerSplit[] = diners.map((d, i) => {
    // Back-derive display charge columns from the diner's fixed total. The charge
    // block (everything past food) is split across service/gst/discount by their
    // exact magnitudes so food + discount + service + gst === total.
    const block = (totals[i]! as number) - (food[i]! as number)
    const share = sub === 0 ? 0 : exactFood[i]! / sub
    const [service, gst, discount] = splitToTarget(block, [
      (breakdown.service as number) * share,
      (breakdown.gst as number) * share,
      -(breakdown.discount as number) * share,
    ])
    return {
      dinerId: d.id,
      food: food[i]!,
      discount: cents(discount!),
      service: cents(service!),
      gst: cents(gst!),
      total: totals[i]!,
      lines: linesByDiner[i]!,
    }
  })

  return { breakdown, perDiner, residual: ZERO, residualDinerId: null }
```

Remove the now-unused imports `distributeResidual` and (if unused elsewhere) keep `addC`/`cents`/`ZERO`. Delete the old `weights`/`discountShares`/`serviceShares`/`gstShares`/`distributeResidual` block.

- [ ] **Step 6: Run the Bistro test to verify it passes**

Run: `npx vitest run tests/unit/splitBill.test.ts -t "land within 1"`
Expected: PASS.

- [ ] **Step 7: Update the worked-fareware totals (B2 values)**

In `tests/unit/splitBill.test.ts` the "worked fareware scenario" test, replace the four total assertions (the `food(...)` assertions are unchanged — food/lines are byte-identical under approach P):

```ts
    // B2 totals (round-once over exact food; food columns unchanged):
    expect(tot('P1')).toBe(6295)
    expect(tot('P2')).toBe(5815)
    expect(tot('P3')).toBe(4616)
    expect(tot('M')).toBe(2698)
```

- [ ] **Step 8: Rewrite the rounding-line test for distributed rounding**

Replace the body of the `splitBill — rounding line` test (`rounding flows into the grand total …`) with:

```ts
  it('rounding flows into the grand total and is distributed (no single-payer residual)', () => {
    const state = round({
      diners: [diner('big'), diner('small')],
      items: [item('feast', 8000, 1, ['big']), item('side', 2000, 1, ['small'])],
      servicePct: 0,
      gstPct: 0,
      rounding: cents(-2),
    })
    const s = splitBill(state)
    const big = s.perDiner.find((d) => d.dinerId === 'big')!
    const small = s.perDiner.find((d) => d.dinerId === 'small')!
    expect(s.breakdown.grandTotal).toBe(9998)
    expect(total(s)).toBe(9998)
    expect(big.total + small.total).toBe(9998) // rounding folded into totals, conserved
    expect(s.residual).toBe(0)
    expect(s.residualDinerId).toBeNull()
  })
```

- [ ] **Step 9: Run the full splitBill + property suites**

Run: `npx vitest run tests/unit/splitBill.test.ts tests/unit/splitBill-property.test.ts tests/unit/dinerCardRows.test.ts`
Expected: PASS (food/lines unchanged ⇒ lines-decomposition + dinerCardRows tests stay green; property invariant holds).

- [ ] **Step 10: Typecheck + commit**

```bash
npm run typecheck
git add src/math/splitBill.ts tests/unit/splitBill.test.ts
git commit -m "fix(math): round per-diner total once over exact food (B2 fairness)

Identical-basket diners now land within 1c (was up to 11c). Per-item
food/lines unchanged; charge columns back-derived from total-food so
cards still reconcile. Cash-rounding folded into the proportional pass.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Promote the fairness simulation to a permanent regression test

**Files:**
- Create: `tests/unit/splitBill-fairness.test.ts`

**Interfaces:**
- Consumes: `splitBill`, `cents`, types. Source material: `scratchpad/sim_rounding.test.ts` (the harness used during design).

- [ ] **Step 1: Write the fairness regression test**

Create `tests/unit/splitBill-fairness.test.ts`. Adapt the harness in `scratchpad/sim_rounding.test.ts`: keep only **strategy A = the real `splitBill`** (drop B1/B2/C — they were design candidates), group diners by exact dollar share, and assert ≤1¢ on Bistro + the two worst-cases + a 600-receipt fuzz. Core assertions:

```ts
import { describe, it, expect } from 'vitest'
import { cents } from '@/math/money'
import { splitBill } from '@/math/splitBill'
import type { Diner, Item, RoundState } from '@/state/types'

// (port `slices`, `exactFood`, the `base`/`diner` factories, `bistro`, `worst`,
//  `worstNoTax`, and the fuzz generator verbatim from scratchpad/sim_rounding.test.ts)

function maxIdenticalSpread(state: RoundState): number {
  const sl = slices(state)
  const ef = exactFood(state, sl)
  const groups = new Map<number, number[]>()
  ef.forEach((v, i) => {
    const k = Math.round(v * 1e6)
    ;(groups.get(k) ?? groups.set(k, []).get(k)!).push(i)
  })
  const totals = splitBill(state).perDiner.map((d) => d.total)
  let spread = 0
  for (const m of groups.values())
    if (m.length > 1) spread = Math.max(spread, Math.max(...m.map((i) => totals[i]!)) - Math.min(...m.map((i) => totals[i]!)))
  return spread
}

describe('splitBill fairness: identical baskets within 1¢', () => {
  it('named receipts ≤1¢', () => {
    expect(maxIdenticalSpread(bistro)).toBeLessThanOrEqual(1)
    expect(maxIdenticalSpread(worst)).toBeLessThanOrEqual(1)
    expect(maxIdenticalSpread(worstNoTax)).toBeLessThanOrEqual(1)
  })
  it('600 fuzz receipts: never exceeds 1¢ and always conserves', () => {
    // (seeded generator from the harness)
    for (const st of fuzzCorpus(600)) {
      expect(maxIdenticalSpread(st)).toBeLessThanOrEqual(1)
      const s = splitBill(st)
      expect(s.perDiner.reduce((a, d) => a + d.total, 0)).toBe(s.breakdown.grandTotal)
    }
  })
})
```

(The full file inlines the `slices`/`exactFood`/`base`/`diner`/`bistro`/`worst`/`worstNoTax`/`fuzzCorpus` helpers copied from `scratchpad/sim_rounding.test.ts` — do not leave them as references.)

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/unit/splitBill-fairness.test.ts`
Expected: PASS (all ≤1¢, 0 conservation failures).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/splitBill-fairness.test.ts
git commit -m "test(math): regression guard — identical baskets stay within 1c

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Retire the residual path (cleanup; the cash-rounding HIGH fix)

**Files:**
- Delete: `src/math/residual.ts`, `tests/unit/residual.test.ts`
- Modify: `src/math/splitBill.ts` (drop `residual`/`residualDinerId` from `BillSplit` + return)
- Modify: `src/features/settle/SettleSheet.tsx` (remove `absorbedResidual` prop pass)
- Modify: `src/features/settle/DinerCard.tsx` (remove `absorbedResidual` prop + its render block)
- Modify: `tests/unit/splitBill.test.ts` (drop the now-removed `s.residual`/`s.residualDinerId` assertions added/updated in Task 1 and the pre-existing ones at the "residual diner surfaces" and orphan-portion tests)

**Interfaces:**
- Produces: `BillSplit = { breakdown, perDiner }`. `DinerCard` props lose `absorbedResidual`.

- [ ] **Step 1: Remove the fields from `BillSplit` and the return**

In `src/math/splitBill.ts`: delete `residual: Cents` and `residualDinerId: string | null` from the `BillSplit` interface, and change the return to `return { breakdown, perDiner }`. Remove the `ZERO` import if now unused.

- [ ] **Step 2: Remove the annotation from the settle UI**

`SettleSheet.tsx`: delete the `absorbedResidual={…}` line on `<DinerCard>`.
`DinerCard.tsx`: remove `absorbedResidual` from the props type and destructuring, and delete the entire `{absorbedResidual !== 0 && (…)}` block (lines ~71–81). Remove the now-unused `cents` import if appropriate.

- [ ] **Step 3: Delete the module + its test, scrub references**

```bash
git rm src/math/residual.ts tests/unit/residual.test.ts
```
In `tests/unit/splitBill.test.ts`, remove every `expect(s.residual)…` and `expect(s.residualDinerId)…` line (the "residual diner surfaces" test collapses to just the `total(s) === grandTotal` assertion; in the rounding-line test from Task 1 Step 8, drop the two residual expectations).

- [ ] **Step 4: Typecheck + run affected suites**

Run: `npm run typecheck && npx vitest run tests/unit/splitBill.test.ts tests/unit/dinerCardRows.test.ts`
Expected: PASS, no references to `residual`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(math): retire residual path; cash-rounding now distributed

distributeResidual's only trigger (the SG cash-rounding line) is now
spread proportionally by the B2 pass, so the single-payer residual and
its '+Nc rounding' annotation are gone.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — Collection rounding (opt-in)

### Task 4: State, schema, store, serialization for `payerId` + `collectRounding`

**Files:**
- Modify: `src/state/types.ts` (add fields to `RoundState`)
- Modify: `src/state/store.ts` (`emptyRound`, `StoreState.actions`, `setPayer`/`setCollectRounding`, `removeDiner` clears stale payer)
- Modify: `src/state/schema.ts` (`roundStateZod` with backward-compatible defaults)
- Test: `tests/unit/schema.test.ts`, `tests/unit/store.test.ts`

**Interfaces:**
- Produces: `RoundState.payerId: string | null`, `RoundState.collectRounding: Cents`. Actions `setPayer(id: string | null)`, `setCollectRounding(unit: Cents)`.

- [ ] **Step 1: Write failing schema round-trip test**

Add to `tests/unit/schema.test.ts`:

```ts
it('defaults payerId/collectRounding for pre-feature payloads, round-trips new ones', () => {
  const legacy = parseRoundState({
    venue: 'V', diners: [], items: [], discount: 0, servicePct: 0.1, gstPct: 0.09,
    rounding: 0, scan: null, scannedTotal: null,
  })!
  expect(legacy.payerId).toBeNull()
  expect(legacy.collectRounding).toBe(0)
  const withPayer = parseRoundState({ ...legacy, payerId: 'd1', collectRounding: 10 })!
  expect(withPayer.payerId).toBe('d1')
  expect(withPayer.collectRounding).toBe(10)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/schema.test.ts -t "pre-feature"`
Expected: FAIL — `payerId`/`collectRounding` are `undefined`.

- [ ] **Step 3: Add the fields to `RoundState`**

In `src/state/types.ts`, inside `RoundState` (after `scannedTotal`):

```ts
  /** Diner who fronts the bill and absorbs collection-rounding loss. null = none. */
  payerId: string | null
  /** Round each NON-payer down to this unit for easy collection; 0 = off. */
  collectRounding: Cents
```

- [ ] **Step 4: Extend the schema with backward-compatible defaults**

In `src/state/schema.ts`, add to `roundStateZod` (after `scannedTotal`):

```ts
  /** default(null): pre-feature drafts/links stay valid */
  payerId: z.string().nullable().default(null),
  /** default(0 = off): pre-feature drafts/links stay valid */
  collectRounding: centsZod.default(0),
```

- [ ] **Step 5: Update `emptyRound` + actions in `store.ts`**

`emptyRound()` return: add `payerId: null,` and `collectRounding: ZERO,`.
In `StoreState.actions`, declare:

```ts
    setPayer: (id: string | null) => void
    setCollectRounding: (unit: Cents) => void
```

Implement (next to `setRounding`):

```ts
      setPayer: (id) =>
        set((s) => {
          s.round.payerId = id
        }),

      setCollectRounding: (unit) =>
        set((s) => {
          s.round.collectRounding = cents(Math.max(0, unit))
        }),
```

In `removeDiner`, after filtering diners, clear a stale payer:

```ts
          if (s.round.payerId === id) s.round.payerId = null
```

- [ ] **Step 6: Write + run a store test for payer clearing**

Add to `tests/unit/store.test.ts`:

```ts
it('removing the payer diner clears payerId', () => {
  const a = useStore.getState().actions
  a.reset(); a.addDiner('Alice'); a.addDiner('Bob')
  const [alice] = useStore.getState().round.diners
  a.setPayer(alice!.id)
  expect(useStore.getState().round.payerId).toBe(alice!.id)
  a.removeDiner(alice!.id)
  expect(useStore.getState().round.payerId).toBeNull()
})
```

Run: `npx vitest run tests/unit/schema.test.ts tests/unit/store.test.ts tests/unit/urlhash.test.ts`
Expected: PASS (urlhash serializes whole state → new fields ride along automatically).

- [ ] **Step 7: Commit**

```bash
git add src/state/types.ts src/state/store.ts src/state/schema.ts tests/unit/schema.test.ts tests/unit/store.test.ts
git commit -m "feat(state): add payerId + collectRounding (defaults keep old links valid)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Collection-rounding computation (pure function)

**Files:**
- Create: `src/features/settle/collectionRounding.ts`
- Test: `tests/unit/collectionRounding.test.ts`

**Interfaces:**
- Consumes: `BillSplit` (`from '@/math/splitBill'`), `RoundState`, `Cents`.
- Produces:
  ```ts
  export interface CollectionView {
    active: boolean
    /** dinerId → amount to display/collect (rounded for non-payers, true share for payer). */
    amountByDiner: Record<string, number>
    /** total cents the payer absorbs (Σ of non-payer round-downs); 0 when inactive. */
    absorbed: number
  }
  export function collectionView(round: RoundState, split: BillSplit): CollectionView
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/collectionRounding.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { cents } from '@/math/money'
import { splitBill } from '@/math/splitBill'
import { collectionView } from '@/features/settle/collectionRounding'
import type { Diner, Item, RoundState } from '@/state/types'

const diner = (id: string): Diner => ({ id, name: id, colorIdx: 0 })
const base = (o: Partial<RoundState>): RoundState => ({
  venue: 'V', diners: [], items: [], discount: cents(0), servicePct: 0.1, gstPct: 0.09,
  rounding: cents(0), scan: null, scannedTotal: null, payerId: null, collectRounding: cents(0), ...o,
})

it('inactive when off or payer unset', () => {
  const st = base({ diners: [diner('a'), diner('b')], items: [{ id: 'x', name: 'x', qty: 1, unitPrice: cents(1000), assignedDinerIds: [] }] })
  expect(collectionView(st, splitBill(st)).active).toBe(false)
})

it('rounds non-payers down to the unit; payer keeps true share; absorbed = Σ deltas', () => {
  const st = base({
    diners: [diner('host'), diner('a'), diner('b')],
    items: [{ id: 'x', name: 'x', qty: 1, unitPrice: cents(9989), assignedDinerIds: [] }],
    servicePct: 0, gstPct: 0,
    payerId: 'host', collectRounding: cents(10),
  })
  const split = splitBill(st)
  const v = collectionView(st, split)
  const trueByDiner = Object.fromEntries(split.perDiner.map((d) => [d.dinerId, d.total]))
  expect(v.active).toBe(true)
  for (const id of ['a', 'b']) expect(v.amountByDiner[id]! % 10).toBe(0) // rounded to 10¢
  for (const id of ['a', 'b']) expect(v.amountByDiner[id]!).toBe(Math.floor(trueByDiner[id]! / 10) * 10)
  expect(v.amountByDiner['host']).toBe(trueByDiner['host']) // payer = true share
  const absorbed = ['a', 'b'].reduce((s, id) => s + (trueByDiner[id]! - v.amountByDiner[id]!), 0)
  expect(v.absorbed).toBe(absorbed)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/collectionRounding.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `collectionRounding.ts`**

```ts
import type { BillSplit } from '@/math/splitBill'
import type { RoundState } from '@/state/types'

export interface CollectionView {
  active: boolean
  amountByDiner: Record<string, number>
  absorbed: number
}

/**
 * Opt-in collection layer over the (already fair, exact) split. When a payer is
 * set and a unit is chosen, every NON-payer is rounded DOWN to the unit; the
 * payer keeps their true share and silently absorbs the rounded-off cents.
 * Inert (active:false, true amounts) when off or the payer is missing.
 */
export function collectionView(round: RoundState, split: BillSplit): CollectionView {
  const unit = round.collectRounding as number
  const payerId = round.payerId
  const amountByDiner: Record<string, number> = {}
  const payerExists = payerId !== null && split.perDiner.some((d) => d.dinerId === payerId)
  if (unit <= 0 || !payerExists) {
    for (const d of split.perDiner) amountByDiner[d.dinerId] = d.total as number
    return { active: false, amountByDiner, absorbed: 0 }
  }
  let absorbed = 0
  for (const d of split.perDiner) {
    const t = d.total as number
    if (d.dinerId === payerId) {
      amountByDiner[d.dinerId] = t
    } else {
      const rounded = Math.floor(t / unit) * unit
      amountByDiner[d.dinerId] = rounded
      absorbed += t - rounded
    }
  }
  return { active: true, amountByDiner, absorbed }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/collectionRounding.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/settle/collectionRounding.ts tests/unit/collectionRounding.test.ts
git commit -m "feat(settle): collection-rounding view (non-payers down, payer absorbs)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Wire collection rounding into the settle display + share text

**Files:**
- Modify: `src/features/settle/SettleSheet.tsx` (use `collectionView`; pass collected amount; suppress expansion when active; host hint)
- Modify: `src/features/settle/DinerCard.tsx` (accept an optional `displayAmount` override + `collapsedOnly` flag)
- Modify: `src/features/settle/shareText.ts` (when active: per-diner header uses collected amount, omit line/charge rows)
- Test: `tests/unit/shareText.test.ts`

**Interfaces:**
- Consumes: `collectionView`. `DinerCard` gains `displayAmount?: number` (defaults to `split.total`) and `collapsedOnly?: boolean` (hides the chevron + expansion).

- [ ] **Step 1: Write the failing share-text test**

Add to `tests/unit/shareText.test.ts`:

```ts
it('collection rounding: headers show rounded amounts, no line/charge rows', () => {
  const st = base({
    diners: [diner('host'), diner('a')],
    items: [{ id: 'x', name: 'x', qty: 1, unitPrice: cents(2017), assignedDinerIds: [] }],
    servicePct: 0, gstPct: 0, payerId: 'host', collectRounding: cents(10),
  })
  const split = splitBill(st)
  const text = buildShareText(st, split)
  // 'a' owes ~1009¢ → collected 1000¢ → "$10.00"; no "Service charge"/line rows.
  expect(text).toContain('a — $10.00')
  expect(text).not.toContain('Service charge')
})
```

(Use the file's existing `base`/`diner` helpers; add `payerId`/`collectRounding` to its `base` if missing.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/shareText.test.ts -t "collection rounding"`
Expected: FAIL.

- [ ] **Step 3: Branch `buildShareText` on the collection view**

In `shareText.ts`, compute `const view = collectionView(round, split)` at the top. When `view.active`, render each diner as a single header line using the collected amount and skip line/charge rows:

```ts
  for (const ds of split.perDiner) {
    const diner = round.diners.find((d) => d.id === ds.dinerId)
    const name = diner ? diner.name : ds.dinerId
    if (view.active) {
      blocks.push(`${name} — ${formatSGD(cents(view.amountByDiner[ds.dinerId]!))}`)
      continue
    }
    // …existing per-diner block (lines + charge rows)…
  }
```

Keep the footer `Everyone together — {grandTotal}` unchanged (true bill).

- [ ] **Step 4: Update `DinerCard` for an amount override + collapsed-only mode**

Add optional props `displayAmount?: number` and `collapsedOnly?: boolean`. Use `cents(displayAmount ?? (split.total as number))` for the header `<Money>`. When `collapsedOnly`, render the header without the chevron and skip the `<AnimatePresence>` expansion entirely.

- [ ] **Step 5: Use the view in `SettleSheet`**

Compute `const view = useMemo(() => collectionView(round, split), [round, split])`. Pass `displayAmount={view.amountByDiner[d.id]}` and `collapsedOnly={view.active}` to each `<DinerCard>`. When `view.active && !readOnly && view.absorbed > 0`, render a host-only hint below the list:

```tsx
{view.active && !readOnly && view.absorbed > 0 && (
  <p className="text-small text-cream-faint">
    You’ll collect <Money cents={cents(split.breakdown.grandTotal - view.absorbed)} />; you cover{' '}
    <Money cents={cents(view.absorbed)} />.
  </p>
)}
```

(`readOnly` is `useStore((s) => s.readOnly)`.)

- [ ] **Step 6: Run settle + share suites**

Run: `npx vitest run tests/unit/shareText.test.ts tests/unit/dinerCardRows.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/settle/SettleSheet.tsx src/features/settle/DinerCard.tsx src/features/settle/shareText.ts tests/unit/shareText.test.ts
git commit -m "feat(settle): render collection-rounded amounts, suppress mechanics

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Host controls — who's-paying picker + rounding unit

**Files:**
- Create: `src/features/settle/CollectionControls.tsx`
- Modify: `src/features/settle/SettleSheet.tsx` (mount the controls, gated on `!readOnly`)

**Interfaces:**
- Consumes: store actions `setPayer`, `setCollectRounding`; `round.payerId`, `round.collectRounding`, `round.diners`.

- [ ] **Step 1: Build `CollectionControls`**

Create `src/features/settle/CollectionControls.tsx` — a payer `<select>` (Off + one option per diner) bound to `setPayer`, and a unit chooser (Off / 5¢ / 10¢ / 50¢ / $1) bound to `setCollectRounding`, following the `ChargesSection.tsx` control idiom (read it for the label/spacing classes). Unit value maps Off→`cents(0)`, 5¢→`cents(5)`, 10¢→`cents(10)`, 50¢→`cents(50)`, $1→`cents(100)`. Default selection reflects `round.collectRounding`/`round.payerId`. When a unit > 0 is chosen with no payer set, auto-select the first diner as payer (or surface a "pick who's paying" prompt).

```tsx
'use client'
import { cents } from '@/math/money'
import { useStore } from '@/state/store'

const UNITS = [
  { label: 'Off', value: 0 }, { label: '5¢', value: 5 }, { label: '10¢', value: 10 },
  { label: '50¢', value: 50 }, { label: '$1', value: 100 },
]

export function CollectionControls() {
  const round = useStore((s) => s.round)
  const a = useStore((s) => s.actions)
  return (
    <div className="flex flex-col gap-2 border-t border-dashed border-line pt-3 text-small">
      <label className="flex items-center justify-between">
        <span className="text-cream-dim">Who’s paying</span>
        <select
          value={round.payerId ?? ''}
          onChange={(e) => a.setPayer(e.target.value || null)}
          className="bg-transparent text-cream"
        >
          <option value="">—</option>
          {round.diners.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between">
        <span className="text-cream-dim">Round for collection</span>
        <select
          value={round.collectRounding as number}
          onChange={(e) => {
            const u = Number(e.target.value)
            a.setCollectRounding(cents(u))
            if (u > 0 && !round.payerId && round.diners[0]) a.setPayer(round.diners[0].id)
          }}
          className="bg-transparent text-cream"
        >
          {UNITS.map((u) => (
            <option key={u.value} value={u.value}>{u.label}</option>
          ))}
        </select>
      </label>
    </div>
  )
}
```

- [ ] **Step 2: Mount it in `SettleSheet` (host only)**

Below the diner list (and above/below `ShareActions`), add `{!readOnly && <CollectionControls />}`.

- [ ] **Step 3: Manual smoke + typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: full suite PASS. Then `npm run dev`, open Square up, set a payer + 10¢, confirm non-payers show clean amounts and the host hint appears; open a share link (read-only) and confirm the controls are hidden.

- [ ] **Step 4: Commit**

```bash
git add src/features/settle/CollectionControls.tsx src/features/settle/SettleSheet.tsx
git commit -m "feat(settle): host controls for payer + collection-rounding unit

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-review notes (spec coverage)

- Spec §3 (B2 engine, ≤1¢, invariants, back-derivation) → Tasks 1–2.
- Spec §4 (cash-rounding HIGH fix) → folded into Task 1, cleanup in Task 3.
- Spec §5.1 (state) → Task 4. §5.2 (apply rule, payer eats loss) → Task 5. §5.3 (no mechanics on shared view, host hint, true "Everyone together") → Task 6. §5.4 (UI) → Task 7.
- Spec §6 (test plan: promote sim, keep property test, Bistro golden, back-derivation, collection-rounding) → Tasks 1, 2, 5, 6.
- Spec §7 decisions: payer = true share (Task 5/6), retire residual (Task 3), units 5/10/50/100 default 10¢ (Task 7), suppress expansion when active (Task 6). All covered.
