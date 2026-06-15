# Contributing to Round

Thanks for taking the time to contribute. Round is a small, focused app — these
notes keep it coherent.

## Getting set up

```bash
npm install --legacy-peer-deps
npm run dev          # http://localhost:5173
```

Receipt scanning needs [LMStudio](https://lmstudio.ai) with a vision model
loaded — see [`docs/lmstudio-setup.md`](docs/lmstudio-setup.md). Manual entry
works without it, so you can develop most of the app with no model running.

## Before you open a PR

Both must pass:

```bash
npm run typecheck    # tsc --noEmit, strict
npm test             # full Vitest suite
```

If you touched the OCR path and have LMStudio running, also sanity-check the eval:

```bash
npm run eval:ocr
```

## Non-negotiable invariants

These are the rules that keep Round correct. A change that breaks one needs a
very good reason and a test.

1. **Money is integer `Cents`, everywhere.** The branded `Cents` type lives in
   `src/state/types.ts`. Convert to/from dollars **only** at I/O boundaries —
   display formatting and OCR JSON. Never do float arithmetic on money.

2. **The split is exact.** `Σ per-diner totals === grand total`, always. This is
   fuzz-tested in `tests/unit/`. Any change to the math engine
   (`src/math/`) must preserve it. The residual-distribution step
   (`src/math/residual.ts`) exists precisely so leftover cents always land
   somewhere deterministic.

3. **The Singapore tax order is locked.** `subtotal → −discount → +service →
   +GST → ±rounding`, with GST charged on (subtotal − discount + service). This
   is IRAS-mandated, not a preference. See `src/math/singapore.ts` and the
   architecture doc.

4. **Local-first is the whole point.** No backend, no accounts, no telemetry.
   Receipt images go only to the user's own LMStudio. Don't add a network
   dependency that breaks the offline/static-export guarantee
   (`output: 'export'`).

## Code style

- **TypeScript strict.** No `any` escapes without a comment justifying it.
- **Match the surrounding code** — naming, file layout, comment density. Features
  live under `src/features/<name>/`; pure logic under `src/math/` and
  `src/state/`; shared primitives under `src/components/` and `src/lib/`.
- **Test new logic.** Math and OCR changes ship with unit tests in `tests/unit/`.
- **Respect motion preferences.** Anything animated must honor
  `prefers-reduced-motion`.

## Architecture

Read [`docs/architecture.md`](docs/architecture.md) before making structural
changes — it documents the screen flow, state shape, two-tier persistence, the
math pipeline, and the OCR tiers.

## Reporting bugs

Open an issue with: what you did, what you expected, what happened. For OCR
misreads, the receipt image (or a redacted crop) and the model you used are
hugely helpful.
