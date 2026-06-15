'use client'
import { useEffect, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { formatSGD, parseDollarInput, parseSignedDollarInput } from '@/lib/format'
import { applyCharges } from '@/math/singapore'
import { addC, cents } from '@/math/money'
import { lineTotal } from '@/state/types'
import { useStore } from '@/state/store'
import { Money } from '@/components/Money'

/**
 * Discount + percentage steppers + the live charge summary, rendered as
 * the bottom of the receipt. The summary is aria-live so the totals a
 * screen-reader hears track every edit.
 */
function PctStepper({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: number
  onChange: (pct: number) => void
  disabled: boolean
}) {
  const pct = Math.round(value * 100)
  const step = (d: number) => onChange(Math.min(1, Math.max(0, (pct + d) / 100)))
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-receipt">{label}</span>
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          disabled={disabled || pct <= 0}
          onClick={() => step(-1)}
          className="grid h-8 w-8 place-items-center rounded-full border border-paper-ink/20 text-paper-ink/70 hover:bg-paper-2 disabled:opacity-30"
        >
          <Minus size={13} aria-hidden />
        </button>
        <span className="money w-12 text-center text-receipt">{pct}%</span>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          disabled={disabled || pct >= 100}
          onClick={() => step(1)}
          className="grid h-8 w-8 place-items-center rounded-full border border-paper-ink/20 text-paper-ink/70 hover:bg-paper-2 disabled:opacity-30"
        >
          <Plus size={13} aria-hidden />
        </button>
      </span>
    </div>
  )
}

export function ChargesSection() {
  const round = useStore((s) => s.round)
  const readOnly = useStore((s) => s.readOnly)
  const [discountText, setDiscountText] = useState('')
  const [roundingText, setRoundingText] = useState('')

  useEffect(() => {
    setDiscountText(round.discount === 0 ? '' : formatSGD(round.discount).slice(1))
  }, [round.discount])

  useEffect(() => {
    setRoundingText(round.rounding === 0 ? '' : (round.rounding / 100).toFixed(2))
  }, [round.rounding])

  const subtotal = addC(...round.items.map(lineTotal))
  const b = applyCharges(subtotal, {
    discount: round.discount,
    servicePct: round.servicePct,
    gstPct: round.gstPct,
    rounding: round.rounding,
  })

  const commitDiscount = (text: string) => {
    const parsed = parseDollarInput(text)
    useStore.getState().actions.setDiscount(parsed ?? round.discount)
  }

  const commitRounding = (text: string) => {
    if (text.trim() === '') {
      useStore.getState().actions.setRounding(cents(0))
      return
    }
    const parsed = parseSignedDollarInput(text)
    if (parsed !== null) useStore.getState().actions.setRounding(parsed)
  }

  /** SG cash rounding: adjust the grand total to the nearest 5¢. */
  const autoRoundTo5 = () => {
    const base = applyCharges(subtotal, {
      discount: round.discount,
      servicePct: round.servicePct,
      gstPct: round.gstPct,
    })
    useStore.getState().actions.setRounding(
      cents(Math.round(base.grandTotal / 5) * 5 - base.grandTotal),
    )
  }

  return (
    <section aria-label="Charges" className="flex flex-col gap-3 text-paper-ink">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="discount" className="text-receipt">
          Discount in dollars
        </label>
        <div className="money flex items-center gap-1 text-receipt">
          <span aria-hidden>−$</span>
          <input
            id="discount"
            value={discountText}
            disabled={readOnly}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            className="w-20 rounded-md border border-paper-ink/20 bg-paper-2/60 px-2 py-1 text-right text-receipt focus:border-paper-ink/50 focus:outline-none"
            onChange={(e) => {
              setDiscountText(e.target.value)
              commitDiscount(e.target.value)
            }}
            onBlur={(e) => commitDiscount(e.target.value)}
          />
        </div>
      </div>

      <PctStepper
        label="Service charge"
        value={round.servicePct}
        disabled={readOnly}
        onChange={(p) => useStore.getState().actions.setServicePct(p)}
      />
      <PctStepper
        label="GST"
        value={round.gstPct}
        disabled={readOnly}
        onChange={(p) => useStore.getState().actions.setGstPct(p)}
      />

      <div className="flex items-center justify-between gap-3">
        <label htmlFor="rounding" className="text-receipt">
          Rounding
        </label>
        <div className="flex items-center gap-2">
          {!readOnly && (
            <button
              type="button"
              onClick={autoRoundTo5}
              title="Round the total to the nearest 5 cents"
              className="rounded-full border border-paper-ink/20 px-2.5 py-1 text-[11px] uppercase tracking-wide text-paper-ink/70 hover:bg-paper-2"
            >
              to 5¢
            </button>
          )}
          <input
            id="rounding"
            value={roundingText}
            disabled={readOnly}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            className="money w-20 rounded-md border border-paper-ink/20 bg-paper-2/60 px-2 py-1 text-right text-receipt focus:border-paper-ink/50 focus:outline-none"
            onChange={(e) => {
              setRoundingText(e.target.value)
              commitRounding(e.target.value)
            }}
            onBlur={(e) => commitRounding(e.target.value)}
          />
        </div>
      </div>

      <dl
        aria-live="polite"
        className="mt-1 flex flex-col gap-1 border-t border-dashed border-paper-ink/30 pt-3 text-receipt"
      >
        <div className="flex justify-between">
          <dt>Subtotal</dt>
          <dd>
            <Money cents={b.subtotal} />
          </dd>
        </div>
        {b.discount > 0 && (
          <div className="flex justify-between">
            <dt>Discount</dt>
            <dd>
              <Money cents={cents(-b.discount)} />
            </dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt>Service {Math.round(round.servicePct * 100)}%</dt>
          <dd>
            <Money cents={b.service} />
          </dd>
        </div>
        <div className="flex justify-between">
          <dt>GST {Math.round(round.gstPct * 100)}%</dt>
          <dd>
            <Money cents={b.gst} />
          </dd>
        </div>
        {b.rounding !== 0 && (
          <div className="flex justify-between">
            <dt>Rounding</dt>
            <dd>
              <Money cents={b.rounding} />
            </dd>
          </div>
        )}
        <div className="mt-1 flex justify-between border-t border-paper-ink/40 pt-2 font-medium">
          <dt className="uppercase tracking-wide">Total</dt>
          <dd>
            <Money cents={b.grandTotal} className="text-base" />
          </dd>
        </div>
      </dl>
    </section>
  )
}
