# Changelog

All notable changes to Round are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-06-21

### Added

- **Split a line item into portions.** Tap **Split into parts** on any multi-unit
  item to divide it into parts, each with its own payer list. So one dish can be
  paid solo while the rest is shared — and a guest of honour can be left off the
  parts they're being treated to. There are no roles or flags: "doesn't pay" simply
  means "not in that part's list." Splitting is opt-in; an un-split item behaves
  exactly as before.
- Per-portion allocation stays exact to the cent (largest-remainder per part), and
  the settle breakdown + share text attribute each part — e.g. `· 1 of 3` for a
  solo unit and `· shared 2 of 3` for a shared remainder.

### Changed

- The expanded settle card now itemises each diner's lines (one row per item or
  portion) and shows a muted **Treated — pays nothing** row for a fully-treated
  diner, replacing the single "Food & drink" row.
- **Merge back** collapses parts to one line shared by everyone who paid for *any*
  part (a treated diner stays excluded); a part shared by everyone merges to
  everyone.

### Fixed

- "Add item" no longer needs a second tap when the add-person field is focused.

### Notes

- Fully backward compatible: un-split bills are byte-identical to v1.0.0, existing
  share links and saved drafts load unchanged (the share-link envelope stays `v1`),
  and OCR output is untouched. The split engine's core invariant still holds:
  **Σ per-diner totals === grand total, always.**

## [1.0.0] - 2026-06-15

Initial release.

- Receipt scanning via an on-device LMStudio vision model (items, prices, service,
  GST, rounding line) — plus a keypad-friendly manual entry path.
- Per-item assignment (one diner, a few, or everyone).
- The full Singapore charge model: discount → service % → GST % → signed
  cash-rounding line, with a one-tap "round to 5¢".
- Tier-2 reconcile hallucination guard (green / amber / red) with no second LLM call.
- Largest-remainder (Hamilton) cent-exact splitting.
- Share-by-link (whole split compressed into a URL hash, read-only on open),
  resumable IndexedDB drafts, and an installable, offline-capable PWA.

[1.1.0]: https://github.com/shinnie06/round/releases/tag/v1.1.0
[1.0.0]: https://github.com/shinnie06/round/releases/tag/v1.0.0
