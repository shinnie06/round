# Round — Rounding Fairness (B2) + Collection Rounding — Design

**Date:** 2026-06-24
**Status:** Draft for review
**Scope:** Two related changes shipped together: (1) a fairness fix to the split engine so diners who owe the same amount are quoted within 1¢; (2) an opt-in "collection rounding" layer that rounds each person to a friendly number for easy collection.

---

## 1. Problem & evidence

A real 8-diner receipt (Bistro OneThirtySix, $206.11) exposed the bug. Seven diners owe an **identical** exact share — `2161.25¢` each — yet the engine quotes them four different totals spanning **3¢**:

```
A (today):  25.93  24.72  25.92  25.92  25.91  25.91  25.90  25.90
```

(The 8th, Su yi, legitimately owes less — she took an extra chicken.) Verified by running the real engine via a throwaway repro test — it reproduced these totals exactly. The repro + simulation harnesses are preserved in the session scratchpad (`scratchpad/repro_rounding.test.ts`, `scratchpad/sim_rounding.test.ts`) to be promoted into a permanent regression test during the plan phase.

**Money is always conserved** — the per-diner totals sum to exactly `grandTotal`, and the locked property test (`tests/unit/splitBill-property.test.ts`, `Σ perDiner === grandTotal`) never breaks. This is a **fairness / optics bug, not a conservation bug**: two people who ordered identically are told to pay different amounts, and *which* of them pays more is decided purely by their index in the diner list.

### Root cause

`src/math/splitBill.ts` rounds leftover pennies **independently per component** — once per item/portion, then again for service, GST and discount — and every largest-remainder tie breaks to the **lowest diner index** (`src/math/proportional.ts:48`). Because the same early-listed diners keep winning the `+1` on every uneven split, the rounding errors **correlate across components instead of cancelling**. Food alone spreads 2¢; the tax passes add the 3rd cent.

The spread is **unbounded in principle** — it grows with the number of unevenly-divided components. Constructed and fuzz cases reach **11¢**.

### Simulation (4 strategies, grouping diners by exact dollar share)

| Receipt | A — current | B1 — fair food, tax separate | **B2 — round once on total** | C — error-diffusion |
|---|---|---|---|---|
| Bistro (real) | 3¢ | 2¢ | **1¢** | 1¢ |
| Worst (9 even-split items + tax) | 11¢ | 3¢ | **1¢** | 1¢ |
| Fuzz, worst of 600 | 11¢ | 3¢ | **1¢** | 2¢ |
| Fuzz receipts exceeding 1¢ | 311 / 600 | 119 / 600 | **0 / 600** | 60 / 600 |
| Conserves money | ✅ | ✅ | ✅ | ✅ |

**B2 is the only strategy that provably keeps identical baskets ≤1¢** (0/600 fuzz failures). It is also the simplest at its core, and it folds the SG cash-rounding line into the proportional split — fixing a separate HIGH bug (see §4).

---

## 2. Goals & non-goals

**Goals**
- Two diners who owe the same exact amount are quoted totals within 1¢ of each other, for every constructible receipt.
- Preserve the locked invariant `Σ perDiner.total === grandTotal`.
- Preserve the locked SG tax order (`discount → service → GST`, each rounded to the cent at aggregate — `src/math/singapore.ts`).
- Preserve the settle/share display contracts (per-line breakdown + food/service/GST columns).
- Add an **opt-in** collection-rounding layer (off by default) that rounds each non-payer down to a friendly unit, with the bill-payer absorbing the remainder, and shows clean numbers with no rounding mechanics on the shared page.

**Non-goals**
- Changing the printed aggregate breakdown (subtotal / service / GST / total) — untouched.
- A general "who owes whom" settle-up graph. The payer concept here is only the collection-rounding absorber.
- Currency/locale beyond SGD.

---

## 3. Part 1 — Fairness engine (B2), always on

### 3.1 Algorithm (in `src/math/splitBill.ts`)

1. **Exact food.** For each item/portion slice, accumulate each participant's **exact fractional** share `cost / participants.length` into `exactFood[i]` (a float), and record per-line exact contributions for back-derivation. (`[]` = everyone; unknown ids filtered; orphan slices deposit nothing — identical to today's `resolveParticipants`.) `subtotal = Σ slice costs` (integer, unchanged).
2. **Charges.** `applyCharges(subtotal, …)` unchanged → `breakdown` (service, gst, rounding, grandTotal).
3. **Authoritative per-diner total (the fix):**
   `total[i] = distributeProportionally(grandTotal, exactFood)` — **one** largest-remainder pass over the exact food weights. `Σ total === grandTotal`; for equal `exactFood[i]`, results differ by ≤1¢ **by construction**. This single pass replaces the current per-charge passes (`splitBill.ts:128–135`) and `distributeResidual` (the residual is structurally 0 now — see §4).
4. **Back-derive display columns**, nested so they reconcile exactly:
   - Split `total[i]` into `food[i]` and a `chargeBlock[i]` proportional to each diner's exact `food` vs exact `(grandTotal − subtotal)` share → `food[i] + chargeBlock[i] === total[i]`.
   - Split `chargeBlock[i]` into `service[i]`, `gst[i]`, `discount[i]` (discount negative) proportional to their exact magnitudes → they sum to `chargeBlock[i]`. (Cash-rounding share is folded into `chargeBlock`; there is no separate rounding row.)
   - Split `food[i]` across that diner's exact per-line contributions via a nested largest-remainder pass → `Σ lines === food[i]`.
   - A signed largest-remainder helper handles the discount (negative) and the rare `chargeBlock < 0` case (discount share exceeds tax share); see §3.3.

### 3.2 Invariants preserved

- `Σ total === grandTotal` (Part 1 step 3). **Locked — property test must still pass.**
- Per diner: `Σ lines + discount + service + gst === total` → the expanded card/share rows sum to the header (`dinerCardRows.ts`, `shareText.ts`).
- `Σ lines === food` (per-line contract).
- Per-column aggregates (`Σ food[i]`, `Σ service[i]`, …) may drift ≤ a couple cents from `breakdown` — **acceptable**: the settle cards never cross-sum these, and the authoritative aggregate breakdown is shown separately in the workspace. (Stated explicitly so reviewers know it's intentional.)

### 3.3 Edge cases

- `subtotal === 0` (no food): `distributeProportionally` falls back to equal weights → grandTotal (just a cash-rounding line, or 0) splits equally.
- Heavy discount makes `grandTotal < subtotal` → `chargeBlock[i]` negative; signed helper still reconciles to `total[i]`.
- Zero-food diner (treated): `exactFood[i] === 0` → `total[i] === 0`, `lines === []` → existing "Treated — pays nothing" path holds.
- Determinism: tie-break stays lowest-index. Among identical-exact-share diners the lower-index one still takes the single extra penny — that is the unavoidable 1¢, now bounded to exactly one penny rather than accumulating.

### 3.4 Files touched (Part 1)

- `src/math/splitBill.ts` — the pipeline change above. **Only engine file changed.**
- (Maybe) a small signed largest-remainder helper, colocated in `splitBill.ts` or `proportional.ts` (new export, existing comparator untouched so `proportional.test.ts` stays green).
- `src/features/settle/DinerCard.tsx` — the `absorbedResidual` "+N¢ rounding" annotation becomes dead (residual ≡ 0); remove the prop and its render (see §4).
- `src/math/residual.ts` — retire or keep dormant (no longer called by `splitBill`). Decide during planning.

---

## 4. Free bonus — the cash-rounding HIGH bug

Today the SG 5¢ cash-rounding line (`state.rounding`) is added to `grandTotal` then dumped **entirely on one diner** via `distributeResidual` (highest payer), surfaced as a "+N¢ rounding" annotation (`splitBill.ts:136`, `residual.ts`, `DinerCard.tsx:71`). Because B2 distributes the **whole grandTotal** (which already includes the rounding line) proportionally, the cash-rounding is spread across everyone and the residual is structurally 0. The annotation is removed. No separate work item.

---

## 5. Part 2 — Collection rounding (opt-in)

A presentation/collection layer on top of B2. The underlying split stays exact; collection rounding only changes **what the payer collects** and **what is displayed**.

### 5.1 State additions (`RoundState`, `src/state/types.ts` + `schema.ts` + `store.ts` + `urlhash`/`persist`)

- `payerId: string | null` — the diner who fronts the bill and absorbs the rounding loss. `null` = none.
- `collectRounding: Cents` — unit each **non-payer** is rounded **down** to; `0` = off (default). Allowed units: `5, 10, 50, 100` (5¢ / 10¢ / 50¢ / $1). Default **off**; when first enabled, default unit **10¢**.

Active only when `collectRounding > 0` **and** `payerId` references an existing diner; otherwise the layer is inert and amounts are the raw B2 totals.

### 5.2 Application rule

Given B2 authoritative `total[i]` (summing to `grandTotal`) and unit `u`:
- **Non-payer** `i`: `collected[i] = floor(total[i] / u) * u` (round **down**).
- **Payer**: shows their **true B2 share** `total[payer]` (a clean, possibly non-round number). The payer is *not* re-plugged.
- **Absorbed loss** `= Σ_nonpayer (total[i] − collected[i])` — the cents the payer chooses not to recoup. Surfaced **only** in a host-facing hint, never on the shared view.

This matches "someone owed 9.93, I'd rather collect 9.90, the few cents are my loss as bill-payer."

### 5.3 Display rules (the "no mechanics" requirement)

When the layer is active:
- **Shared square-up page (`SettleSheet`) + share text:** each non-payer shows their rounded `collected[i]`; the payer shows `total[payer]`. **No** "+N¢ rounding" notes, **no** per-line expansion of the rounding — the collection rounding is invisible as a mechanism. (Per-line breakdown is suppressed in this mode because true lines wouldn't sum to a rounded header.)
- **"Everyone together"** continues to show the true bill (`grandTotal`). The displayed per-diner amounts therefore sum to slightly **less** than the bill — the payer silently covers the gap. (Intentional, per "payer eats the loss".)
- **Host-facing hint** (the device owner enabling the feature): a small line — "You'll collect $X; you cover $Y." Not in the shared link / share text.

When the layer is off: behavior is exactly B2 (clean per-line cards, exact reconciliation).

### 5.4 UI

- **"Who's paying" picker** — a control (in the settle sheet or charges section) to mark one diner as `payerId`.
- **Collection-rounding toggle + unit** — off by default; choosing a unit (5¢/10¢/$…) enables it. Requires a payer to be set (prompt to pick one if not).
- Both live with the host on their device; neither is exposed as an editable control on the shared read-only view.

### 5.5 Edge cases (Part 2)

- `collectRounding > 0` but `payerId` null/stale → treat as off (raw B2).
- Payer is a treated/zero diner → still valid; they just absorb (their own share is 0, effective cost = absorbed loss).
- A non-payer whose `total[i] < u` (e.g. owes 7¢, unit 10¢) → `collected = 0`; payer absorbs the whole 7¢. Acceptable; flag in review if undesired.
- Rounding unit larger than typical shares (e.g. $1 on a $0.50 share) → many zeros; the unit menu makes this the host's explicit choice.

---

## 6. Test plan

- **Promote the simulation to a regression test.** The fairness harness (preserved in `scratchpad/sim_rounding.test.ts`) becomes a permanent test asserting, for the Bistro receipt + constructed worst-cases + a fuzz corpus: identical-exact-share diners differ by **≤1¢** and `Σ total === grandTotal`. This is the guardrail that B2 holds and never regresses.
- **Keep the existing property test** (`splitBill-property.test.ts`) green — `Σ === grandTotal` for 300 random + 120 schema-routed rounds.
- **Bistro golden test:** B2 yields `25.92 24.72 25.92 25.91 25.91 25.91 25.91 25.91`.
- **Back-derivation tests:** per diner `Σ lines === food` and `Σ lines + discount + service + gst === total`, including discount and `chargeBlock < 0` cases.
- **Collection-rounding tests:** non-payers rounded down to unit; payer shows true share; absorbed loss = Σ deltas; layer inert when off / payer unset; share text omits mechanics.
- Update any existing `splitBill`/`dinerCardRows`/`shareText`/`residual` tests affected by the residual removal.

---

## 7. Decisions (resolved — approved 2026-06-24)

1. **Payer display (§5.2):** ✅ payer shows their **true share** (rows sum to < bill; payer covers the gap silently). Plug model rejected.
2. **`residual.ts` (§3.4/§4):** ✅ **retire** the module (its only trigger was the cash-rounding line, now distributed). Remove from the `splitBill` pipeline and delete; keep `distributeResidual` history only in git.
3. **Rounding units (§5.1):** ✅ offer **5¢ / 10¢ / 50¢ / $1**, default **10¢ down**.
4. **Collection-rounding expansion (§5.3):** ✅ when active, **suppress** the per-line card expansion on the shared view (collapsed clean totals only).

---

## 8. Build order (for the plan phase)

1. B2 engine in `splitBill.ts` + signed back-derivation helper; keep residual dormant.
2. Promote the fairness simulation to a regression test; update affected engine tests; confirm property test green.
3. Remove the dead `absorbedResidual` annotation path.
4. Part 2 state + schema + store + url/persist round-trip.
5. Part 2 application + display rules in `SettleSheet` / `shareText` / `dinerCardRows`.
6. Part 2 UI (payer picker, toggle + unit, host hint).
7. Tests for Part 2.
