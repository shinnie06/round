# Round — architecture overview

## Singapore tax order (LOCKED — IRAS-mandated)

```
1. subtotal       = Σ items.line_total
2. discounted     = subtotal − discount               (clamped: discount ≤ subtotal)
3. withService    = discounted × (1 + service_pct)    (default 10%)
4. withGst        = withService × (1 + gst_pct)       (default 9%)
5. grandTotal     = withGst + rounding                (signed cash-rounding line, e.g. −$0.02)
```

GST is calculated on the discounted-subtotal-PLUS-service-charge total —
service charge is itself taxable per IRAS guidance for F&B. The rounding
line is the SG cash-rounding adjustment (totals land on 5¢); the workspace
has a one-tap "to 5¢" action that computes it.

Sources:
- [IRAS — F&B GST](https://www.iras.gov.sg/taxes/goods-services-tax-(gst)/specific-business-sectors/hotel-and-food-beverage)
- [SingSaver guide](https://www.singsaver.com.sg/blog/calculate-gst-service-charge)

Implementation: `src/math/singapore.ts` (`applyCharges`), each charge rounded
to the cent independently — matching how SG receipts print SVC and GST rows.

## Framework shape

Next.js 16 App Router with `output: 'export'`: the build emits a fully static
bundle. There is **no server** — Next is used for its build pipeline, routing
conventions, and ecosystem, not SSR. The app is one route (`/`) with three
screens switched in client state:

```
splash ──scan/manual/resume──▶ workspace ──Square Up──▶ settle
   ▲                                                       │
   └────────────── share link opens read-only ◀────────────┘
```

Why no router for screens: the share link uses `#r=…` (hash), not paths, and
three screens don't justify route plumbing. `AnimatePresence` handles
transitions.

## State shape

The single source of truth is `RoundState` defined in `src/state/types.ts`:

- Money is held as integer `Cents` (TS-branded type) everywhere.
- Conversion to dollars happens ONLY at I/O boundaries (display, OCR JSON).
- `assignedDinerIds: []` is the **"everyone selected" sentinel** — much cheaper
  than mirroring the full diner list on every item. One-tap store actions
  `assignOnly` / `assignEveryone` keep the common flows (single-owner item,
  mistake recovery) to a single interaction; an item always keeps ≥1 diner,
  and the UI shows that lock explicitly instead of silently refusing.
- `rounding: Cents` (signed) is the cash-rounding line; it defaults to 0 in
  the Zod schema so pre-rounding drafts and share links stay decodable.

Store: Zustand + immer (`src/state/store.ts`), actions colocated.

## Persistence — two tiers

| Tier | Where | When written | When read | Lifetime |
|---|---|---|---|---|
| Draft | IndexedDB (`idb-keyval`) | every state change, debounced 350ms | on app mount if no `#r=…` hash | until cleared on reset |
| Share | URL hash (`#r=<lz-string>`) | only on explicit "Square Up" → Copy/Share | on app mount if hash present (read-only mode) | as long as the URL exists |

This split keeps the URL bar clean during editing and prevents leaking
mid-edit junk into share links. Share links open in **read-only** mode and
never overwrite the viewer's own draft.

## Math engine pipeline

```
splitBill(state)                          [src/math/splitBill.ts]
  ├─ Per-item per-person allocation
  │     - "everyone" sentinel → all diners
  │     - largest-remainder per item → every cent lands somewhere
  ├─ applyCharges(subtotal, charges)      [src/math/singapore.ts]
  │     - clamp discount to subtotal
  │     - service on (subtotal − discount)
  │     - GST on (subtotal − discount + service)
  │     - signed rounding line added after GST
  ├─ distributeProportionally(...)        [src/math/proportional.ts]
  │     - largest-remainder (Hamilton) method, weights = food share
  │     - discount / service / GST each distributed exactly
  └─ distributeResidual(...)              [src/math/residual.ts]
        - signed leftover cents (incl. the rounding line) → highest payer
        - "±N¢ rounding" surfaced in the settle screen
```

Invariant (fuzz-tested): **Σ per-diner totals === grand total, always.**

## OCR pipeline

```
file → preprocessReceipt → ocrReceipt     [src/features/ocr/]
                              ├─ LMStudio /v1/chat/completions
                              ├─ response_format: json_schema, strict
                              ├─ Zod parse                  (Tier 1: schema)
                              ├─ sanitize.ts — strip fake "SVC"/"GST"/"TOTAL"/
                              │   "ROUNDING" rows the LLM put in items; reclassify
                              │   (printed top-level values always win)
                              └─ reconcile.ts               (Tier 2: arithmetic)
                                    - recompute bill from parsed lines
                                    - compare vs printed grand_total
                                    - 0¢ → green · ≤25¢ or ≤0.5% → amber · else red
                                    - Tier 3 (sanity heuristics) deferred
                                    - Tier 4 (image-grounded re-prompt) v1.1
```

## UI system

- **Design language**: dark warm ink surfaces; the receipt is rendered as
  cream paper with a deckled (torn) bottom edge and mono dotted-leader rows —
  the artifact itself is the centerpiece.
- **Typography**: Fraunces (display), Instrument Sans (UI), JetBrains Mono
  (every amount, tabular numerals). Fluid scale via `clamp()` tokens in
  `@theme` — no breakpoint jumps, no layout shift.
- **Motion**: Framer Motion springs for sheets/lists/transitions; GSAP
  timeline for the splash intro; Lenis smooth scroll (desktop pointers only);
  three.js ambient scene on the splash, lazy-loaded, DPR-capped, paused when
  hidden. `prefers-reduced-motion` disables all of it.
- **Semantics/a11y**: `header/main/section/footer`, labelled controls, radix
  focus traps in sheets, `aria-live` totals, 44px touch targets, safe-area
  insets.

## Out of scope for v1

- Multi-device collab (architecture-ready, no transport)
- Cloud OCR fallback
- Multiple currencies / countries
- Per-item tax/service editing
- iOS native app
