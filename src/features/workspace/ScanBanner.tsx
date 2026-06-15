'use client'
import { useState } from 'react'
import { CircleCheck, CircleAlert, CircleX, X } from 'lucide-react'
import { addC, cents } from '@/math/money'
import { applyCharges } from '@/math/singapore'
import { judgeDelta } from '@/features/ocr/reconcile'
import { lineTotal } from '@/state/types'
import { useStore } from '@/state/store'
import { cn } from '@/lib/cn'

const COPY = {
  green: { icon: CircleCheck, text: 'Adds up exactly — the scan checks out.', cls: 'border-good/40 bg-good/10 text-good' },
  amber: { icon: CircleAlert, text: 'Close but not exact — worth a quick glance at the totals.', cls: 'border-warn/40 bg-warn/10 text-warn' },
  red: { icon: CircleX, text: "Doesn't add up — please check the items against the photo.", cls: 'border-bad/40 bg-bad/10 text-bad' },
} as const

/**
 * Tier-2 verdict, surfaced once per scanned round — and LIVE: when the
 * receipt printed a grand total we re-judge the current workspace numbers
 * against it on every render, so the banner heals the moment an edit (or
 * the percentage snap) makes the bill tally, instead of nagging about a
 * mismatch that no longer exists. Total-less receipts keep the scan-time
 * verdict (there is nothing to re-check against).
 */
export function ScanBanner() {
  const round = useStore((s) => s.round)
  const [dismissed, setDismissed] = useState(false)
  if (!round.scan || dismissed) return null

  let status = round.scan.status
  let delta = round.scan.deltaCents
  if (round.scannedTotal !== null) {
    const subtotal = addC(...round.items.map(lineTotal))
    const grand = applyCharges(subtotal, {
      discount: round.discount,
      servicePct: round.servicePct,
      gstPct: round.gstPct,
      rounding: round.rounding,
    }).grandTotal
    delta = cents(Math.abs(grand - round.scannedTotal))
    status = judgeDelta(delta, round.scannedTotal)
  }

  const { icon: Icon, text, cls } = COPY[status]
  return (
    <div
      role="status"
      className={cn('flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-small', cls)}
    >
      <Icon size={17} aria-hidden className="shrink-0" />
      <span className="flex-1 text-cream">
        {text}
        {status !== 'green' && delta > 0 && (
          <span className="text-cream-dim"> (off by {delta < 100 ? `${delta}¢` : `$${(delta / 100).toFixed(2)}`})</span>
        )}
      </span>
      <button
        type="button"
        aria-label="Dismiss scan verdict"
        onClick={() => setDismissed(true)}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-cream-faint hover:text-cream"
      >
        <X size={15} aria-hidden />
      </button>
    </div>
  )
}
