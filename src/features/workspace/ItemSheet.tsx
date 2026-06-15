'use client'
import { useEffect, useState } from 'react'
import { cents } from '@/math/money'
import { formatSGD, parseDollarInput } from '@/lib/format'
import { useStore } from '@/state/store'
import { Sheet } from '@/components/Sheet'
import { Field } from '@/components/Field'
import { Button } from '@/components/Button'

export type ItemSheetMode = { mode: 'add' } | { mode: 'edit'; id: string } | null

/** Add/edit an item. Price is entered as the LINE total in dollars. */
export function ItemSheet({ state, onClose }: { state: ItemSheetMode; onClose: () => void }) {
  const items = useStore((s) => s.round.items)
  const editing = state?.mode === 'edit' ? items.find((i) => i.id === state.id) : undefined

  const [name, setName] = useState('')
  const [qty, setQty] = useState('1')
  const [price, setPrice] = useState('')
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    if (!state) return
    setInvalid(false)
    if (editing) {
      setName(editing.name)
      setQty(String(editing.qty))
      setPrice(formatSGD(cents(editing.qty * editing.unitPrice)).slice(1))
    } else {
      setName('')
      setQty('1')
      setPrice('')
    }
  }, [state, editing])

  const done = () => {
    const line = parseDollarInput(price)
    const q = Math.max(1, Math.floor(Number(qty) || 1))
    const trimmed = name.trim()
    if (!trimmed || line === null) {
      setInvalid(true)
      return
    }
    // Keep printed money exact: collapse to qty 1 when it doesn't divide.
    const even = line % q === 0
    const patch = {
      name: trimmed,
      qty: even ? q : 1,
      unitPrice: even ? cents(line / q) : line,
    }
    const { actions } = useStore.getState()
    if (editing) actions.updateItem(editing.id, patch)
    else actions.addItem(patch)
    onClose()
  }

  return (
    <Sheet
      open={state !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={editing ? 'Edit item' : 'Add item'}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          done()
        }}
      >
        <Field
          id="item-name"
          label="Item name"
          value={name}
          autoFocus={!editing}
          autoComplete="off"
          placeholder="e.g. Chilli Crab"
          onChange={(e) => setName(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field
            id="item-qty"
            label="Quantity"
            value={qty}
            inputMode="numeric"
            autoComplete="off"
            onChange={(e) => setQty(e.target.value)}
          />
          <Field
            id="item-price"
            label="Line total in dollars"
            value={price}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        {invalid && (
          <p className="text-small text-bad" role="alert">
            Needs a name and a valid dollar amount (e.g. 12.50).
          </p>
        )}
        <div className="flex items-center justify-between gap-2">
          {editing ? (
            <Button
              variant="danger"
              onClick={() => {
                useStore.getState().actions.removeItem(editing.id)
                onClose()
              }}
            >
              Delete
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit">Done</Button>
        </div>
      </form>
    </Sheet>
  )
}
