'use client'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { cents } from '@/math/money'
import type { DinerSplit } from '@/math/splitBill'
import { DINER_COLORS } from '@/state/colors'
import type { Diner } from '@/state/types'
import { Money } from '@/components/Money'
import { cn } from '@/lib/cn'
import { dinerCardRows } from './dinerCardRows'

/**
 * One diner's settle card. Collapsed: name + what they owe. Expanded:
 * the full story — food, discount share, service, and GST.
 *
 * Optional props:
 * - `displayAmount` — overrides the header amount (used by collection rounding
 *   to show the rounded-down amount instead of the exact split total).
 * - `collapsedOnly` — when true, hides the chevron and suppresses the
 *   expansion entirely (collection rounding mode: mechanics are hidden).
 */
export function DinerCard({
  diner,
  split,
  expanded,
  onToggle,
  displayAmount,
  collapsedOnly,
}: {
  diner: Diner
  split: DinerSplit
  expanded: boolean
  onToggle: () => void
  displayAmount?: number
  collapsedOnly?: boolean
}) {
  const rows = dinerCardRows(split)

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-ink-2">
      <button
        type="button"
        aria-expanded={collapsedOnly ? undefined : expanded}
        onClick={collapsedOnly ? undefined : onToggle}
        className="flex w-full min-h-14 items-center gap-3 px-4 text-left"
      >
        <span
          className="h-3 w-3 shrink-0 rounded-full"
          style={{ background: DINER_COLORS[diner.colorIdx % DINER_COLORS.length] }}
          aria-hidden
        />
        <span className="flex-1 truncate text-body text-cream">{diner.name}</span>
        <Money cents={cents(displayAmount ?? (split.total as number))} className="text-body text-cream" />
        {!collapsedOnly && (
          <ChevronDown
            size={16}
            aria-hidden
            className={cn('text-cream-faint transition-transform', expanded && 'rotate-180')}
          />
        )}
      </button>

      {!collapsedOnly && (
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 38 }}
            >
              <dl className="flex flex-col gap-1.5 border-t border-line px-4 py-3 text-small text-cream-dim">
                {rows.map((r, i) => (
                  <div key={i} className="flex justify-between">
                    <dt>{r.label}</dt>
                    <dd>
                      <Money cents={cents(r.amount)} signColor />
                    </dd>
                  </div>
                ))}
              </dl>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  )
}
