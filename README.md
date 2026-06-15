<div align="center">

<img src="docs/brand-preview.png" alt="Round — whose round is it?" width="600" />

# Round

**Whose round is it?**

A local-first PWA that splits Singapore restaurant receipts. Snap a photo, assign items to friends, and Round handles the IRAS-mandated math — discount → 10% service → 9% GST → 5¢ cash rounding — down to the exact cent.

[![License: MIT](https://img.shields.io/badge/License-MIT-e8a44c.svg?style=flat-square)](LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-000?style=flat-square&logo=nextdotjs)](https://nextjs.org)
[![React 19](https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react)](https://react.dev)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![Tailwind v4](https://img.shields.io/badge/Tailwind-v4-38bdf8?style=flat-square&logo=tailwindcss)](https://tailwindcss.com)
[![PWA](https://img.shields.io/badge/PWA-installable-5a0fc8?style=flat-square)](public/manifest.webmanifest)
[![Tests](https://img.shields.io/badge/tests-129%20passing-3fb950?style=flat-square&logo=vitest)](tests/)

</div>

---

Round is **local-first by design**. Receipt photos never leave your machine — OCR runs against *your own* [LMStudio](https://lmstudio.ai) over the LAN. There are no accounts, no backend, and no analytics. The entire split — items, diners, charges, who-owes-what — is encoded into a share link's URL hash, so a tap of *Copy* is the whole sync layer.

- 🔒 **Local-first** — receipts stay on-device; OCR runs on your laptop's LMStudio.
- 🚫 **No accounts, ever** — share links carry the full breakdown in the URL hash.
- 📱 **Phone + desktop** — installable PWA, tuned for both form factors.
- 🇸🇬 **Singapore-correct math** — service charge, GST, and 5¢ cash rounding, to the cent.
- 🧮 **Provably exact** — every cent of every charge lands on a diner (fuzz-tested invariant).

## Contents

- [Why Round](#why-round)
- [Features](#features)
- [Quickstart](#quickstart)
- [LMStudio setup](#lmstudio-setup)
- [How it works](#how-it-works)
- [The two algorithms worth reading](#the-two-algorithms-worth-reading)
- [Project structure](#project-structure)
- [Scripts](#scripts)
- [Tech stack](#tech-stack)
- [Privacy & security](#privacy--security)
- [Testing](#testing)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## Why Round

Splitting a Singapore restaurant bill is deceptively hard. The printed total is the result of a **specific, ordered calculation** the kitchen is legally required to follow (per IRAS):

```
subtotal  →  − discount  →  + 10% service charge  →  + 9% GST  →  ± 5¢ cash rounding
```

GST is charged on the subtotal **plus** the service charge (service is itself taxable for F&B), and the grand total is rounded to the nearest 5¢. Most "bill splitter" apps approximate this — they divide the total evenly, or apply tax as a flat percentage per person, and the cents never quite reconcile.

Round does the real thing. It allocates each item to whoever ate it, distributes every charge **proportionally** using the largest-remainder method, and guarantees that the per-diner totals sum **exactly** to the printed grand total — no rounding leaks, no "someone covers the extra cent" hand-waving.

## Features

| | |
|---|---|
| 📸 **Scan a receipt** | Point your phone at the bill. A vision LLM in your LMStudio reads items, prices, service, GST, and the rounding line. |
| ✍️ **Or go manual** | No camera, no model, no problem — add items and diners by hand with a fast keypad-friendly UI. |
| 👥 **Per-item assignment** | Tap to assign each item to one diner, a few, or everyone. "Everyone" is the default; items always keep at least one owner. |
| 🧾 **Faithful charge model** | Discount, service %, GST %, and a signed cash-rounding line — editable, with a one-tap "round to 5¢" action. |
| ✅ **Hallucination guard** | A Tier-2 arithmetic check recomputes the bill from parsed lines and flags green / amber / red **without** a second LLM call. |
| 🔗 **Share by link** | "Square Up" compresses the whole split into a URL hash. Send it; the recipient opens a read-only breakdown — no app, no account. |
| 💾 **Resumable drafts** | Work-in-progress is auto-saved to IndexedDB (debounced) and restored on next launch. |
| 📲 **Installable PWA** | Add to Home Screen for a full-screen, offline-capable app on phone or desktop. |
| ♿ **Accessible & kinetic** | Semantic landmarks, focus traps, `aria-live` totals, 44px targets — and a cinematic splash that fully respects `prefers-reduced-motion`. |

## Quickstart

> **Prerequisites:** Node 20+, and [LMStudio](https://lmstudio.ai) if you want to scan receipts (manual entry works without it).

```bash
# 1. Install dependencies
npm install --legacy-peer-deps

# 2. Start LMStudio and load ONE vision model (see table below), then:
lms server start --cors        # or use the Developer tab → Start Server

# 3. Run the dev server
npm run dev                    # next dev on 0.0.0.0:5173

# 4. Open it
#    Laptop:  http://localhost:5173
#    Phone:   http://<your-laptop>.local:5173   (same WiFi)
#    → Add to Home Screen / Install
```

Production build — a fully static bundle, no server:

```bash
npm run build                  # emits out/
npm start                      # serves out/ on :5173
```

The `out/` folder is plain static files: drop it on any static host (or the laptop on your LAN) and it just works. There is no backend to deploy.

## LMStudio setup

Round talks to **your** LMStudio over HTTP. Load one vision model:

| Tier | Model | RAM (MLX 4-bit) | Best for |
|---|---|---|---|
| 1 (default) | `qwen/qwen3-vl-8b` | ~6 GB | Daily driver — fast, accurate enough. |
| 2 (accuracy) | `qwen/qwen3.6-27b` | ~17 GB | When Tier 1 keeps flagging amber. |
| 3 (Apache 2.0) | `lmstudio-community/gemma-4-7.9b` | ~6 GB | License hedge. |

On Apple Silicon, prefer **MLX** quants (20–80% faster than GGUF). In LMStudio's **Developer → Server Settings**, toggle **Enable CORS** and **Serve on Local Network**, then start the server (port 1234). Round auto-detects the URL from `window.location.hostname` and routes scans to the first `vl`/`vision` model it finds.

📖 **Full walkthrough, troubleshooting, and phone-on-LAN topology:** [`docs/lmstudio-setup.md`](docs/lmstudio-setup.md)

## How it works

One photo in, one share link out. The pipeline:

```
       camera / file
            │
            ▼
   ImagePreprocess.ts   ← resize to 1024px, JPEG 0.85, EXIF auto-rotate
            │
            ▼
   lmstudio.ts          ← POST /v1/chat/completions, response_format: json_schema (strict)
            │
            ▼
   sanitize.ts          ← rescue misfiled SVC / GST / TOTAL / ROUNDING rows
            │
            ▼
   reconcile.ts         ← Tier-2 arithmetic check → green / amber / red
            │
            ▼
   mapToState.ts  →  Zustand store  ⇄  IndexedDB draft (350ms debounce)
            │                                     ▲
            ▼                                     │
   workspace screen  ◄──── inline edits ──────────┘
            │
            ▼
   splitBill.ts         ← singapore.ts → proportional.ts → residual.ts
            │
            ▼
   settle sheet  →  urlhash.ts (lz-string)  →  clipboard / share intent
```

The app is a **single static route** (`/`) with three screens — splash, workspace, settle — switched in client state and animated with `AnimatePresence`. No SSR, no server: Next.js is used purely for its build pipeline and `output: 'export'`.

📐 **Deep dive** — tax order, state shape, two-tier persistence, math engine, OCR tiers, and UI system: [`docs/architecture.md`](docs/architecture.md)

## The two algorithms worth reading

Both are fully implemented, tested, and heavily commented — the most interesting code in the repo:

1. **`src/math/proportional.ts` → `distributeProportionally`** — the largest-remainder
   (Hamilton) method. Splits any charge across diners in exact integer cents,
   deterministically. Handles negative amounts (discounts), zero weights, and ties.
   Fuzz-tested over 500 random cases. The invariant it guarantees:
   **Σ per-diner totals === grand total, always.**

2. **`src/features/ocr/reconcile.ts` → `reconcile`** — a Tier-2 arithmetic check that
   catches LLM hallucinations *without* a second LLM call. It recomputes the bill from
   the parsed lines and compares against the printed grand total:
   green = exact · amber = rounding drift (≤25¢ or ≤0.5%) · red = misread.

## Project structure

```
round/
├─ src/
│  ├─ app/             Next.js App Router shell — one route, three screens
│  ├─ features/
│  │  ├─ splash/       Cinematic intro (GSAP timeline + lazy three.js ambient)
│  │  ├─ workspace/    Items, diners, charges, per-item assignment sheets
│  │  ├─ ocr/          LMStudio pipeline: preprocess → parse → sanitize → reconcile → map
│  │  └─ settle/       Final breakdown, rounding surface, share actions
│  ├─ math/            Pure money engine — splitBill, singapore, proportional, residual, money
│  ├─ state/           Zustand store, Zod schema, branded types, persistence, URL-hash codec
│  ├─ components/      Design-system primitives — Button, Sheet, Field, Money, Logo…
│  ├─ hooks/           useScan and friends
│  └─ lib/             format, cn, service-worker registration, Lenis, reduced-motion…
├─ tests/
│  ├─ unit/            Math + OCR pipeline (Vitest) — 129 cases
│  └─ eval/            OCR accuracy harness (gated behind OCR_EVAL=1, needs LMStudio)
├─ docs/               architecture.md · lmstudio-setup.md · brand assets
├─ public/             manifest, icons, service worker, OG image
├─ next.config.ts      output: 'export' — static, serverless
├─ Dockerfile          static export served by nginx
└─ nginx.conf
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on `0.0.0.0:5173` (reachable from your phone on the same WiFi). |
| `npm run build` | Static export to `out/`. |
| `npm start` | Serve the built `out/` on `:5173`. |
| `npm test` | Run the full Vitest suite once. |
| `npm run test:watch` | Re-run tests on change. |
| `npm run eval:ocr` | OCR accuracy eval against LMStudio (`OCR_EVAL=1`, needs a loaded vision model). |
| `npm run typecheck` | `tsc --noEmit` — strict type check, no emit. |

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16, App Router, `output: 'export'` | Static bundle, zero server — local-first stays true. |
| UI | React 19 · TypeScript (strict) · Tailwind v4 | Tokens via `@theme`, fluid type via `clamp()`. |
| Components | shadcn-style (Radix + cva) · lucide-react | a11y primitives, a bespoke design language. |
| Motion | Framer Motion · GSAP (splash) · Lenis | Spring-first UI, cinematic intro, buttery scroll. |
| 3D | three.js (lazy, splash only) | Atmosphere without taxing the workspace. |
| State | Zustand + immer | Small footprint, ergonomic actions. |
| Validation | Zod | Runtime parsing + inferred types. |
| Persistence | URL hash (lz-string) + IndexedDB draft | No backend, no accounts. |
| OCR | LMStudio + a vision LLM | Local, free, private. |
| PWA | Web manifest + service worker | Installable on phone and desktop. |
| Tests | Vitest | Fast, ESM-native. |

## Privacy & security

Round is built so that **your receipts and your splits never touch a third party**:

- **No backend.** The production build is static files. Nothing is sent to a server Round controls — there isn't one.
- **OCR is yours.** Receipt images are POSTed only to the LMStudio endpoint *you* point Round at (default: your own machine on the LAN).
- **No accounts, no tracking.** No sign-in, no analytics, no telemetry.
- **Share links are self-contained.** A `#r=…` hash is the entire split, compressed client-side. It opens **read-only** and never overwrites the viewer's own draft. Anyone with the link can read that split — treat links like you'd treat a photo of the receipt.
- **Drafts are local.** Work-in-progress lives in your browser's IndexedDB and clears on reset.

## Testing

```bash
npm test                       # all unit suites (math engine + OCR pipeline)
npm run test:watch             # rerun on change
npm test -- proportional       # largest-remainder distribution
npm test -- reconcile          # OCR arithmetic verification
npm run eval:ocr               # end-to-end OCR accuracy (needs LMStudio + a vision model)
```

The math engine is property/fuzz-tested: random bills are generated and the
**Σ per-diner === grand total** invariant is asserted across hundreds of cases.
The OCR eval harness scores parse accuracy against a small fixture set of real
and synthetic receipts (`tests/eval/`).

## Roadmap

Shipped in v1: scan, manual entry, per-item assignment, the full SG charge model,
the reconcile guard, resumable drafts, share links, and the installable PWA.

Deliberately **out of scope for v1** (the architecture leaves room for them):

- Multi-device live collaboration (state model is ready; no transport yet)
- Cloud OCR fallback for when LMStudio isn't running
- Multiple currencies / countries
- Per-item tax & service overrides
- A native iOS wrapper

## Contributing

Issues and PRs are welcome. Before opening a PR:

```bash
npm run typecheck && npm test
```

Keep money as integer `Cents` everywhere — convert to dollars **only** at I/O
boundaries (display and OCR JSON). See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the
full guide and [`docs/architecture.md`](docs/architecture.md) for the invariants
any change must preserve.

## License

[MIT](LICENSE) © shinnie06
