'use client'
import { useRef, useState } from 'react'
import { UserPlus, X } from 'lucide-react'
import { useStore } from '@/state/store'
import { DINER_COLORS } from '@/state/colors'
import { Button } from '@/components/Button'
import { Field } from '@/components/Field'

/**
 * Diner chips + the add-person flow. Enter commits a name and KEEPS the
 * input open (adding a table of friends is a burst, not three round
 * trips); blurring an empty input closes it.
 */
export function DinersSection() {
  const diners = useStore((s) => s.round.diners)
  const readOnly = useStore((s) => s.readOnly)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const commit = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    useStore.getState().actions.addDiner(trimmed)
    setName('')
    inputRef.current?.focus()
  }

  return (
    <section aria-label="People" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {diners.map((d) => (
          <span
            key={d.id}
            className="inline-flex items-center gap-2 rounded-full border border-line bg-ink-2 py-1.5 pl-3 pr-1.5 text-small text-cream"
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: DINER_COLORS[d.colorIdx % DINER_COLORS.length] }}
              aria-hidden
            />
            {d.name}
            {!readOnly && (
              <button
                type="button"
                aria-label={`Remove ${d.name}`}
                onClick={() => useStore.getState().actions.removeDiner(d.id)}
                className="grid h-6 w-6 place-items-center rounded-full text-cream-faint hover:bg-line/50 hover:text-cream"
              >
                <X size={13} aria-hidden />
              </button>
            )}
          </span>
        ))}
        {!readOnly && !adding && (
          <Button variant="ghost" size="md" onClick={() => setAdding(true)}>
            <UserPlus size={16} aria-hidden /> Add person
          </Button>
        )}
      </div>

      {adding && !readOnly && (
        <Field
          ref={inputRef}
          label="New person's name"
          value={name}
          autoFocus
          enterKeyHint="done"
          autoComplete="off"
          placeholder="e.g. Mei Lin"
          containerClassName="md:w-72"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
            if (e.key === 'Escape') setAdding(false)
          }}
          onBlur={() => {
            // Defer the close: blurring synchronously unmounts this field, and
            // that layout shift would otherwise swallow the very click that
            // caused the blur (e.g. the first tap on "Add item"). Letting the
            // click land first, then closing, fixes that focus race.
            if (!name.trim()) setTimeout(() => setAdding(false), 0)
          }}
        />
      )}
    </section>
  )
}
