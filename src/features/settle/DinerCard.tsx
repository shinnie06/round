'use client'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { cents } from '@/math/money'
import type { DinerSplit } from '@/math/splitBill'
import { DINER_COLORS } from '@/state/colors'
import type { Diner } from '@/state/types'
import { Money } from '@/components/Money'
import { cn } from '@/lib/cn'

/**
 * One diner's settle card. Collapsed: name + what they owe. Expanded:
 * the full story — food, discount share, service, GST, and the "+1¢
 * rounding" annotation when this diner absorbed the residual.
 */
export function DinerCard({
  diner,
  split,
  absorbedResidual,
  expanded,
  onToggle,
}: {
  diner: Diner
  split: DinerSplit
  absorbedResidual: number
  expanded: boolean
  onToggle: () => void
}) {
  const rows: { label: string; amount: number }[] = [
    { label: 'Food & drink', amount: split.food },
    ...(split.discount !== 0 ? [{ label: 'Discount share', amount: split.discount }] : []),
    ...(split.service !== 0 ? [{ label: 'Service charge', amount: split.service }] : []),
    ...(split.gst !== 0 ? [{ label: 'GST', amount: split.gst }] : []),
  ]

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-ink-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex w-full min-h-14 items-center gap-3 px-4 text-left"
      >
        <span
          className="h-3 w-3 shrink-0 rounded-full"
          style={{ background: DINER_COLORS[diner.colorIdx % DINER_COLORS.length] }}
          aria-hidden
        />
        <span className="flex-1 truncate text-body text-cream">{diner.name}</span>
        <Money cents={split.total} className="text-body text-cream" />
        <ChevronDown
          size={16}
          aria-hidden
          className={cn('text-cream-faint transition-transform', expanded && 'rotate-180')}
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 38 }}
          >
            <dl className="flex flex-col gap-1.5 border-t border-line px-4 py-3 text-small text-cream-dim">
              {rows.map((r) => (
                <div key={r.label} className="flex justify-between">
                  <dt>{r.label}</dt>
                  <dd>
                    <Money cents={cents(r.amount)} signColor />
                  </dd>
                </div>
              ))}
              {absorbedResidual !== 0 && (
                <div className="flex justify-between text-cream-faint">
                  <dt>
                    {absorbedResidual > 0 ? '+' : '−'}
                    {Math.abs(absorbedResidual)}¢ rounding
                  </dt>
                  <dd>
                    <Money cents={cents(absorbedResidual)} />
                  </dd>
                </div>
              )}
            </dl>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
