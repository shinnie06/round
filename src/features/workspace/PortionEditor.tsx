'use client'
import { Check, Combine, Minus, Plus, Users, X } from 'lucide-react'
import { useStore } from '@/state/store'
import { DINER_COLORS } from '@/state/colors'
import { canAddPortion, lineTotal, portionTotal, portionedUnits, type Diner, type Item } from '@/state/types'
import { Money } from '@/components/Money'
import { Button } from '@/components/Button'
import { cn } from '@/lib/cn'
import { portionRowVM } from './portionView'

/**
 * The second mode of AssignSheet: a portioned item is edited part-by-part.
 * Every member decision is computed by the tested `portionRowVM`; every
 * mutation is a tested store action. This file is a thin view over both.
 */
export function PortionEditor({
  item,
  diners,
  readOnly,
  onClose,
}: {
  item: Item
  diners: Diner[]
  readOnly: boolean
  onClose: () => void
}) {
  const portions = item.portions ?? []
  const covered = portionedUnits(item)
  const a = () => useStore.getState().actions

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-baseline justify-between text-small text-cream-dim">
        <span>
          {item.qty} × · split into {portions.length} {portions.length === 1 ? 'part' : 'parts'}
        </span>
        <Money cents={lineTotal(item)} className="text-cream" />
      </p>

      <ul className="flex flex-col gap-3">
        {portions.map((p, idx) => {
          const vm = portionRowVM(p, diners)
          return (
            <li key={idx} className="rounded-xl border border-line p-3">
              <div className="flex min-h-11 items-center justify-between gap-2">
                <span className="text-body text-cream">Part {idx + 1}</span>
                <span className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Fewer units in part ${idx + 1}`}
                    disabled={readOnly || p.units <= 1}
                    onClick={() => a().setPortionUnits(item.id, idx, p.units - 1)}
                    className="grid h-8 w-8 place-items-center rounded-full border border-line text-cream-dim hover:bg-ink-3 disabled:opacity-30"
                  >
                    <Minus size={13} aria-hidden />
                  </button>
                  <span className="money w-16 text-center text-small text-cream">{vm.unitNoun}</span>
                  <button
                    type="button"
                    aria-label={`More units in part ${idx + 1}`}
                    disabled={readOnly}
                    onClick={() => a().setPortionUnits(item.id, idx, p.units + 1)}
                    className="grid h-8 w-8 place-items-center rounded-full border border-line text-cream-dim hover:bg-ink-3 disabled:opacity-30"
                  >
                    <Plus size={13} aria-hidden />
                  </button>
                  {!readOnly && portions.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Remove part ${idx + 1}`}
                      onClick={() => a().removePortion(item.id, idx)}
                      className="ml-1 grid h-8 w-8 place-items-center rounded-full border border-line text-cream-faint hover:border-bad/50 hover:text-bad"
                    >
                      <X size={14} aria-hidden />
                    </button>
                  )}
                </span>
              </div>

              <div className="mt-1 flex justify-end">
                <Money cents={portionTotal(item.unitPrice, p.units)} className="text-small text-cream-dim" />
              </div>

              <ul className="mt-2 flex flex-col gap-2" aria-label={`Who shares part ${idx + 1}`}>
                {vm.rows.map((r) => (
                  <li key={r.id} className="flex items-stretch gap-2">
                    <button
                      type="button"
                      aria-pressed={r.on}
                      disabled={readOnly || r.lockedLast}
                      title={r.lockedLast ? 'Every part needs at least one person' : undefined}
                      onClick={() => a().togglePortionAssignment(item.id, idx, r.id)}
                      className={cn(
                        'flex min-h-12 flex-1 items-center gap-3 rounded-xl border px-4 text-left text-body transition-colors',
                        r.on
                          ? 'border-cream-dim bg-ink-3 text-cream'
                          : 'border-line bg-transparent text-cream-faint',
                        r.lockedLast && !readOnly && 'cursor-default opacity-90',
                      )}
                    >
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{
                          background: DINER_COLORS[r.colorIdx % DINER_COLORS.length],
                          opacity: r.on ? 1 : 0.35,
                        }}
                        aria-hidden
                      />
                      <span className="flex-1">{r.name}</span>
                      {r.on && <Check size={16} className="text-good" aria-hidden />}
                    </button>
                    {!readOnly && diners.length > 1 && !r.lockedLast && (
                      <button
                        type="button"
                        title={`Only ${r.name} on part ${idx + 1}`}
                        onClick={() => a().assignPortionOnly(item.id, idx, r.id)}
                        className="min-h-12 rounded-xl border border-line px-3 text-small text-cream-faint transition-colors hover:border-cream-dim hover:text-cream"
                      >
                        Only
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              {!readOnly && p.assignedDinerIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => a().assignPortionEveryone(item.id, idx)}
                  className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line text-small text-cream-dim hover:border-cream-dim hover:text-cream"
                >
                  <Users size={15} aria-hidden /> Everyone shares this part
                </button>
              )}
            </li>
          )
        })}
      </ul>

      <p
        aria-live="polite"
        className={cn(
          'text-small',
          covered === item.qty ? 'text-good' : 'text-bad',
        )}
      >
        {covered === item.qty
          ? `✓ Parts cover ${covered} of ${item.qty} units`
          : `Parts cover ${covered} of ${item.qty} units`}
      </p>

      {!readOnly && (
        <button
          type="button"
          disabled={!canAddPortion(item)}
          onClick={() => a().addPortion(item.id)}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line text-small text-cream-dim hover:border-cream-dim hover:text-cream disabled:opacity-30 disabled:hover:border-line disabled:hover:text-cream-dim"
        >
          <Plus size={15} aria-hidden /> Add part
        </button>
      )}

      {!readOnly && (
        <p className="text-small text-cream-faint">
          Merging combines the parts; everyone paying for any part shares the item.
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        {!readOnly ? (
          <Button variant="ghost" onClick={() => a().mergePortions(item.id)}>
            <Combine size={16} aria-hidden /> Merge back
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={onClose}>Done</Button>
      </div>
    </div>
  )
}
