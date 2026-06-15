'use client'
import { useMemo, useState } from 'react'
import { splitBill } from '@/math/splitBill'
import { useStore } from '@/state/store'
import { Money } from '@/components/Money'
import { Sheet } from '@/components/Sheet'
import { DinerCard } from './DinerCard'
import { ShareActions } from './ShareActions'

/**
 * Square Up: per-diner totals over the workspace. The footer renders
 * the engine's invariant — Σ per-diner totals always equals the grand
 * total, so the check row is a statement, not a hope.
 */
export function SettleSheet() {
  const round = useStore((s) => s.round)
  const open = useStore((s) => s.screen) === 'settle'
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const split = useMemo(() => splitBill(round), [round])

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) useStore.getState().actions.setScreen('workspace')
      }}
      title="Square up"
      className="md:w-[32rem]"
    >
      <div className="flex flex-col gap-4">
        {round.venue.trim() !== '' && (
          <p className="text-small text-cream-faint">{round.venue}</p>
        )}

        <ul className="flex flex-col gap-2.5" aria-label="What everyone owes">
          {round.diners.map((d) => {
            const ds = split.perDiner.find((p) => p.dinerId === d.id)
            if (!ds) return null
            return (
              <li key={d.id}>
                <DinerCard
                  diner={d}
                  split={ds}
                  absorbedResidual={split.residualDinerId === d.id ? split.residual : 0}
                  expanded={expandedId === d.id}
                  onToggle={() => setExpandedId((cur) => (cur === d.id ? null : d.id))}
                />
              </li>
            )
          })}
        </ul>

        <div
          aria-live="polite"
          className="flex items-center justify-between border-t border-dashed border-line pt-3 text-body"
        >
          <span className="text-cream-dim">Everyone together</span>
          <Money cents={split.breakdown.grandTotal} className="text-cream" />
        </div>

        <ShareActions />
      </div>
    </Sheet>
  )
}
