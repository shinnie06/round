import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ocrReceipt } from '@/features/ocr/lmstudio'
import { sanitize } from '@/features/ocr/sanitize'
import { repair } from '@/features/ocr/repair'
import { reconcile } from '@/features/ocr/reconcile'
import { mapToState } from '@/features/ocr/mapToState'
import { applyCharges } from '@/math/singapore'
import { cents } from '@/math/money'

/**
 * Live model eval — runs the EXACT production scan path (ocrReceipt with the
 * production prompt + constrained schema against your LMStudio, then
 * sanitize → repair → reconcile → mapToState) over a corpus of real photos
 * and synthetic rendered receipts, each at several JPEG encodes.
 *
 * Encode variants are not paranoia: on 2026-06-12 the same photo flipped a
 * FOC line between $0 and a borrowed $0.86 purely between q85 and q95.
 * A case passes only if EVERY encode lands on the printed total.
 *
 * Gated behind OCR_EVAL=1 (needs LMStudio + a vision model on :1234):
 *   npm run eval:ocr
 * Add scenarios by dropping an image into images/ + an entry in cases.json
 * (synthetic sources live in images-src/receipts.html).
 */
interface EvalCase {
  image: string
  label: string
  /** 'green': strict — exact total, count, pcts. 'flagged': the model cannot
   *  transcribe this reliably (dense bilingual columns, handwriting, cropped
   *  total); the contract is HONESTY — the banner must show, never a false
   *  green presenting wrong numbers as verified. */
  verdict: 'green' | 'flagged'
  totalCents?: number
  items?: number
  servicePct?: number
  gstPct?: number
}

const CASES = JSON.parse(
  readFileSync(path.join(__dirname, 'cases.json'), 'utf8'),
) as EvalCase[]

/** Mirrors ImagePreprocess (long edge / JPEG quality) plus stress variants. */
const VARIANTS = [
  { edge: 1024, quality: 85 },
  { edge: 1024, quality: 95 },
  { edge: 800, quality: 85 },
]

/** Benchmark a specific LMStudio model: OCR_EVAL_MODEL=google/gemma-4-31b npm run eval:ocr.
 *  Unset → the app's own probe auto-picks (production behavior). */
const MODEL = process.env.OCR_EVAL_MODEL

const work = mkdtempSync(path.join(tmpdir(), 'round-ocr-eval-'))

function encode(image: string, edge: number, quality: number): string {
  const src = path.join(__dirname, 'images', image)
  const out = path.join(work, `${image}-${edge}-${quality}.jpg`)
  execFileSync('sips', [
    '-Z', String(edge),
    '-s', 'format', 'jpeg',
    '-s', 'formatOptions', String(quality),
    src, '--out', out,
  ], { stdio: 'ignore' })
  return `data:image/jpeg;base64,${readFileSync(out).toString('base64')}`
}

describe.runIf(process.env.OCR_EVAL === '1')('OCR eval — LMStudio + full pipeline', () => {
  for (const c of CASES) {
    for (const v of VARIANTS) {
      it(`${c.label} @ ${v.edge}px q${v.quality}`, { timeout: 600_000 }, async () => {
        const raw = await ocrReceipt(encode(c.image, v.edge, v.quality), MODEL ? { model: MODEL } : {})
        const clean = repair(sanitize(raw))
        const verdict = reconcile(clean)
        const state = mapToState(clean, verdict)

        const total = applyCharges(
          cents(state.items.reduce((a, it) => a + it.qty * it.unitPrice, 0)),
          {
            discount: state.discount,
            servicePct: state.servicePct,
            gstPct: state.gstPct,
            rounding: state.rounding,
          },
        ).grandTotal

        console.log(
          `  RESULT|${MODEL ?? 'auto'}|${c.image}|${v.edge}q${v.quality}|total=${total}|verdict=${verdict.status}|items=${state.items.length}`,
        )

        if (c.verdict === 'flagged') {
          // Honesty contract: hard receipts either wear a banner, or — when
          // the model happens to read them perfectly — land EXACTLY on the
          // known printed total. A green with wrong numbers fails.
          if (verdict.status === 'green') {
            expect(
              c.totalCents,
              'green on a flagged case needs a known printed total to verify against',
            ).toBeDefined()
            expect(total).toBe(c.totalCents)
          }
          return
        }
        expect(verdict.status).toBe('green')
        expect(total).toBe(c.totalCents)
        if (c.items !== undefined) expect(state.items).toHaveLength(c.items)
        if (c.servicePct !== undefined) expect(state.servicePct).toBe(c.servicePct)
        if (c.gstPct !== undefined) expect(state.gstPct).toBe(c.gstPct)
      })
    }
  }
})
