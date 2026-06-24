'use client'
import { cents } from '@/math/money'
import { useStore } from '@/state/store'

const UNITS = [
  { label: 'Off', value: 0 },
  { label: '5¢', value: 5 },
  { label: '10¢', value: 10 },
  { label: '50¢', value: 50 },
  { label: '$1', value: 100 },
]

export function CollectionControls() {
  const round = useStore((s) => s.round)
  const a = useStore((s) => s.actions)
  return (
    <div className="flex flex-col gap-2 border-t border-dashed border-line pt-3 text-small">
      <label className="flex items-center justify-between">
        <span className="text-cream-dim">Who's paying</span>
        <select
          value={round.payerId ?? ''}
          onChange={(e) => a.setPayer(e.target.value || null)}
          className="bg-transparent text-cream"
        >
          <option value="">—</option>
          {round.diners.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between">
        <span className="text-cream-dim">Round for collection</span>
        <select
          value={round.collectRounding as number}
          onChange={(e) => {
            const u = Number(e.target.value)
            a.setCollectRounding(cents(u))
            if (u > 0 && !round.payerId && round.diners[0]) a.setPayer(round.diners[0].id)
          }}
          className="bg-transparent text-cream"
        >
          {UNITS.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
