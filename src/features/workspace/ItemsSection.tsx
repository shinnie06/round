'use client'
import { Plus } from 'lucide-react'
import { useStore } from '@/state/store'
import { DINER_COLORS } from '@/state/colors'
import { isPortioned, lineTotal, portionTotal, type Item, type Portion } from '@/state/types'
import { Money } from '@/components/Money'
import { portionRowVM, portionWho } from './portionView'

/**
 * The item rows of the receipt. Each row is one button (opens the
 * assign sheet) — qty × name, dotted leader, mono amount, and the
 * avatar dots of whoever shares it.
 */
function AvatarDots({ item }: { item: Item }) {
  const diners = useStore((s) => s.round.diners)
  const shown = item.assignedDinerIds.length === 0
    ? diners
    : diners.filter((d) => item.assignedDinerIds.includes(d.id))
  return (
    <span className="ml-2 inline-flex shrink-0 -space-x-1" aria-hidden>
      {shown.slice(0, 5).map((d) => (
        <span
          key={d.id}
          className="h-2.5 w-2.5 rounded-full ring-1 ring-paper"
          style={{ background: DINER_COLORS[d.colorIdx % DINER_COLORS.length] }}
        />
      ))}
      {shown.length > 5 && <span className="pl-1.5 text-[10px] text-paper-faint">+{shown.length - 5}</span>}
    </span>
  )
}

/** Avatar dots for ONE portion's resolved members — same look as
 *  AvatarDots, computed by the tested portionRowVM (sentinel/explicit,
 *  +N overflow, cap 5). */
function PortionDots({ portion }: { portion: Portion }) {
  const diners = useStore((s) => s.round.diners)
  const vm = portionRowVM(portion, diners)
  return (
    <span className="ml-2 inline-flex shrink-0 -space-x-1" aria-hidden>
      {vm.dots.map((d) => (
        <span
          key={d.id}
          className="h-2.5 w-2.5 rounded-full ring-1 ring-paper"
          style={{ background: d.color }}
        />
      ))}
      {vm.overflow > 0 && <span className="pl-1.5 text-[10px] text-paper-faint">+{vm.overflow}</span>}
    </span>
  )
}

export function ItemsSection({ onOpenItem, onAddItem }: {
  onOpenItem: (id: string) => void
  onAddItem: () => void
}) {
  const items = useStore((s) => s.round.items)
  const diners = useStore((s) => s.round.diners)
  const readOnly = useStore((s) => s.readOnly)

  return (
    <section aria-label="Items" className="flex flex-col text-paper-ink">
      <ul className="flex flex-col">
        {items.map((it) => (
          <li key={it.id}>
            <button
              type="button"
              onClick={() => onOpenItem(it.id)}
              className="flex w-full min-h-11 items-baseline px-0 py-1.5 text-left font-mono text-receipt hover:bg-paper-2/70"
            >
              <span className="truncate">
                {it.qty > 1 && <span className="text-paper-faint">{it.qty}× </span>}
                {it.name}
              </span>
              <span className="leader" aria-hidden />
              <Money cents={lineTotal(it)} />
              {!isPortioned(it) && <AvatarDots item={it} />}
            </button>
            {isPortioned(it) && (
              <ul className="mb-1 flex flex-col" aria-label={`Parts of ${it.name}`}>
                {it.portions!.map((p, idx) => (
                  <li
                    key={idx}
                    className="flex items-baseline pl-6 font-mono text-receipt text-paper-faint"
                  >
                    <span className="truncate">
                      {p.units === 1 ? '1 unit' : `${p.units} units`} — {portionWho(p, diners)}
                    </span>
                    <span className="leader" aria-hidden />
                    <Money cents={portionTotal(it.unitPrice, p.units)} />
                    <PortionDots portion={p} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
        {items.length === 0 && (
          <li className="py-3 text-center font-mono text-receipt text-paper-faint">
            — nothing on the bill yet —
          </li>
        )}
      </ul>
      {!readOnly && (
        <button
          type="button"
          onClick={onAddItem}
          className="mt-1 flex min-h-11 items-center gap-1.5 font-mono text-receipt text-paper-faint hover:text-paper-ink"
        >
          <Plus size={14} aria-hidden /> Add item
        </button>
      )}
    </section>
  )
}
