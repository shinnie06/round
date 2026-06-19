'use client'
import { Check, PencilLine, Scissors, Users } from 'lucide-react'
import { useStore } from '@/state/store'
import { DINER_COLORS } from '@/state/colors'
import { isPortioned, lineTotal, type Diner, type Item } from '@/state/types'
import { Money } from '@/components/Money'
import { Sheet } from '@/components/Sheet'
import { Button } from '@/components/Button'
import { cn } from '@/lib/cn'
import { PortionEditor } from './PortionEditor'

/**
 * Who shares this item? One toggle per diner, sentinel-aware ([] =
 * everyone). The last assigned diner can't be removed — an item always
 * belongs to someone.
 */
export function AssignSheet({
  itemId,
  onClose,
  onEdit,
}: {
  itemId: string | null
  onClose: () => void
  onEdit: (id: string) => void
}) {
  const items = useStore((s) => s.round.items)
  const diners = useStore((s) => s.round.diners)
  const readOnly = useStore((s) => s.readOnly)
  const item = items.find((i) => i.id === itemId)

  return (
    <Sheet
      open={item !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={item ? item.name : 'Item'}
    >
      {item &&
        (isPortioned(item) ? (
          <PortionEditor item={item} diners={diners} readOnly={readOnly} onClose={onClose} />
        ) : (
          <UnsplitBody item={item} diners={diners} readOnly={readOnly} onEdit={onEdit} onClose={onClose} />
        ))}
    </Sheet>
  )
}

/** Today's assign body, lifted verbatim so the un-split path is
 *  byte-identical — plus the one new "Split into parts" affordance. */
function UnsplitBody({
  item,
  diners,
  readOnly,
  onEdit,
  onClose,
}: {
  item: Item
  diners: Diner[]
  readOnly: boolean
  onEdit: (id: string) => void
  onClose: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-baseline justify-between text-small text-cream-dim">
        <span>
          {item.qty > 1 ? `${item.qty} × ` : ''}
          shared by{' '}
          {item.assignedDinerIds.length === 0 ? 'everyone' : `${item.assignedDinerIds.length} of ${diners.length}`}
        </span>
        <Money cents={lineTotal(item)} className="text-cream" />
      </p>

      {!readOnly && item.assignedDinerIds.length > 0 && (
        <button
          type="button"
          onClick={() => useStore.getState().actions.assignEveryone(item.id)}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line text-small text-cream-dim hover:border-cream-dim hover:text-cream"
        >
          <Users size={15} aria-hidden /> Everyone shares this
        </button>
      )}

      {!readOnly && item.qty > 1 && !isPortioned(item) && (
        <button
          type="button"
          onClick={() => useStore.getState().actions.splitItem(item.id)}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line text-small text-cream-dim hover:border-cream-dim hover:text-cream"
        >
          <Scissors size={15} aria-hidden /> Split into parts
        </button>
      )}

      <ul className="flex flex-col gap-2" aria-label="Who shares this item">
        {diners.map((d) => {
          const activeIds =
            item.assignedDinerIds.length === 0
              ? diners.map((x) => x.id)
              : item.assignedDinerIds
          const on = activeIds.includes(d.id)
          // The ≥1 rule, made visible: the last person on an item
          // can't be toggled off — switch someone else on, or use Only.
          const lockedLast = on && activeIds.length === 1
          return (
            <li key={d.id} className="flex items-stretch gap-2">
              <button
                type="button"
                aria-pressed={on}
                disabled={readOnly || lockedLast}
                title={lockedLast ? 'Every item needs at least one person' : undefined}
                onClick={() => useStore.getState().actions.toggleAssignment(item.id, d.id)}
                className={cn(
                  'flex min-h-12 flex-1 items-center gap-3 rounded-xl border px-4 text-left text-body transition-colors',
                  on
                    ? 'border-cream-dim bg-ink-3 text-cream'
                    : 'border-line bg-transparent text-cream-faint',
                  lockedLast && !readOnly && 'cursor-default opacity-90',
                )}
              >
                <span
                  className="h-3 w-3 rounded-full"
                  style={{
                    background: DINER_COLORS[d.colorIdx % DINER_COLORS.length],
                    opacity: on ? 1 : 0.35,
                  }}
                  aria-hidden
                />
                <span className="flex-1" id={`assign-name-${d.id}`}>
                  {d.name}
                </span>
                {on && <Check size={16} className="text-good" aria-hidden />}
              </button>
              {!readOnly && diners.length > 1 && !lockedLast && (
                <button
                  type="button"
                  aria-describedby={`assign-name-${d.id}`}
                  title={`Assign only to ${d.name}`}
                  onClick={() => useStore.getState().actions.assignOnly(item.id, d.id)}
                  className="min-h-12 rounded-xl border border-line px-3 text-small text-cream-faint transition-colors hover:border-cream-dim hover:text-cream"
                >
                  Only
                </button>
              )}
            </li>
          )
        })}
      </ul>

      <div className="flex items-center justify-between gap-2">
        {!readOnly ? (
          <Button variant="ghost" onClick={() => onEdit(item.id)}>
            <PencilLine size={16} aria-hidden /> Edit item
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={onClose}>Done</Button>
      </div>
    </div>
  )
}
