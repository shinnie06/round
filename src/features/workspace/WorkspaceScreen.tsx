'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Eye, RotateCcw } from 'lucide-react'
import { addC } from '@/math/money'
import { applyCharges } from '@/math/singapore'
import { lineTotal } from '@/state/types'
import { useStore } from '@/state/store'
import { clearDraft } from '@/state/persist'
import { Money } from '@/components/Money'
import { Button } from '@/components/Button'
import { Field } from '@/components/Field'
import { DinersSection } from './DinersSection'
import { ItemsSection } from './ItemsSection'
import { ItemSheet, type ItemSheetMode } from './ItemSheet'
import { AssignSheet } from './AssignSheet'
import { ChargesSection } from './ChargesSection'
import { ScanBanner } from './ScanBanner'

/**
 * The workspace: dark ink around a cream receipt. Everything edits
 * inline; the receipt is the single source of visual truth.
 */
export function WorkspaceScreen() {
  const round = useStore((s) => s.round)
  const readOnly = useStore((s) => s.readOnly)
  const [itemSheet, setItemSheet] = useState<ItemSheetMode>(null)
  const [assignFor, setAssignFor] = useState<string | null>(null)

  const subtotal = addC(...round.items.map(lineTotal))
  const grand = applyCharges(subtotal, {
    discount: round.discount,
    servicePct: round.servicePct,
    gstPct: round.gstPct,
    rounding: round.rounding,
  }).grandTotal
  const canSettle = round.diners.length > 0 && round.items.length > 0

  return (
    <motion.div
      className="flex min-h-dvh flex-col safe-top"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 32 }}
    >
      <header className="mx-auto flex w-full max-w-2xl items-end gap-3 px-5 pt-4">
        <Field
          label="Venue name"
          value={round.venue}
          disabled={readOnly}
          autoComplete="off"
          placeholder="Where was this?"
          containerClassName="flex-1"
          className="bg-transparent border-0 border-b border-line rounded-none px-0 font-display text-title text-cream focus:border-cream-dim"
          onChange={(e) => useStore.getState().actions.setVenue(e.target.value)}
        />
        <Button
          variant="ghost"
          size="icon"
          aria-label="Start over"
          onClick={() => {
            void clearDraft()
            useStore.getState().actions.reset()
          }}
        >
          <RotateCcw size={17} aria-hidden />
        </Button>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-5 pb-36 pt-5">
        {readOnly && (
          <div
            role="status"
            className="flex items-center gap-2.5 rounded-xl border border-line bg-ink-2 px-3.5 py-2.5 text-small text-cream-dim"
          >
            <Eye size={16} aria-hidden />
            Shared with you — view only.
          </div>
        )}
        <ScanBanner />
        <DinersSection />

        {/* the receipt */}
        <div className="deckle rounded-t-xl bg-paper px-5 pb-8 pt-5 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.8)]">
          {round.venue.trim() !== '' && (
            <p className="mb-1 text-center font-mono text-receipt uppercase tracking-widest text-paper-ink">
              {round.venue}
            </p>
          )}
          <p className="mb-3 border-b border-dashed border-paper-ink/30 pb-3 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-paper-faint">
            · · · the damage · · ·
          </p>
          <ItemsSection
            onOpenItem={(id) => setAssignFor(id)}
            onAddItem={() => setItemSheet({ mode: 'add' })}
          />
          <div className="mt-4">
            <ChargesSection />
          </div>
        </div>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-ink/90 backdrop-blur safe-bottom">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-5 py-3">
          <div className="flex flex-col">
            <span className="text-small text-cream-faint">Total</span>
            <Money cents={grand} className="text-title text-cream" />
          </div>
          <Button
            size="lg"
            disabled={!canSettle}
            onClick={() => useStore.getState().actions.setScreen('settle')}
          >
            Square up
          </Button>
        </div>
      </footer>

      <ItemSheet state={itemSheet} onClose={() => setItemSheet(null)} />
      <AssignSheet
        itemId={assignFor}
        onClose={() => setAssignFor(null)}
        onEdit={(id) => {
          setAssignFor(null)
          setItemSheet({ mode: 'edit', id })
        }}
      />
    </motion.div>
  )
}
