import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { cents, ZERO, type Cents } from '@/math/money'
import { newId } from '@/lib/id'
import { nextColorIdx } from './colors'
import type { Item, RoundState, Screen } from './types'

export function emptyRound(): RoundState {
  return {
    venue: '',
    diners: [],
    items: [],
    discount: ZERO,
    servicePct: 0.1,
    gstPct: 0.09,
    rounding: ZERO,
    scan: null,
    scannedTotal: null,
  }
}

export interface StoreState {
  round: RoundState
  screen: Screen
  /** Share links open view-only: edits disabled, draft writes suppressed. */
  readOnly: boolean
  actions: {
    setScreen: (screen: Screen) => void
    loadRound: (round: RoundState, opts?: { readOnly?: boolean }) => void
    enterManual: () => void
    setVenue: (venue: string) => void
    addDiner: (name: string) => void
    renameDiner: (id: string, name: string) => void
    removeDiner: (id: string) => void
    addItem: (partial: { name: string; qty: number; unitPrice: Cents }) => void
    updateItem: (id: string, patch: Partial<Omit<Item, 'id'>>) => void
    removeItem: (id: string) => void
    splitItem: (itemId: string) => void
    addPortion: (itemId: string) => void
    toggleAssignment: (itemId: string, dinerId: string) => void
    /** One tap: this item belongs to exactly this diner. */
    assignOnly: (itemId: string, dinerId: string) => void
    /** One tap: back to the everyone sentinel (mistake recovery). */
    assignEveryone: (itemId: string) => void
    setDiscount: (discount: Cents) => void
    setServicePct: (pct: number) => void
    setGstPct: (pct: number) => void
    setRounding: (rounding: Cents) => void
    reset: () => void
  }
}

export const useStore = create<StoreState>()(
  immer((set) => ({
    round: emptyRound(),
    screen: 'splash',
    readOnly: false,
    actions: {
      setScreen: (screen) =>
        set((s) => {
          s.screen = screen
        }),

      loadRound: (round, opts) =>
        set((s) => {
          s.round = round
          s.readOnly = opts?.readOnly ?? false
        }),

      enterManual: () =>
        set((s) => {
          s.readOnly = false
          s.screen = 'workspace'
        }),

      setVenue: (venue) =>
        set((s) => {
          s.round.venue = venue
        }),

      addDiner: (name) =>
        set((s) => {
          const trimmed = name.trim()
          if (!trimmed) return
          s.round.diners.push({
            id: newId(),
            name: trimmed,
            colorIdx: nextColorIdx(s.round.diners),
          })
        }),

      renameDiner: (id, name) =>
        set((s) => {
          const d = s.round.diners.find((d) => d.id === id)
          if (d) d.name = name
        }),

      removeDiner: (id) =>
        set((s) => {
          s.round.diners = s.round.diners.filter((d) => d.id !== id)
          for (const item of s.round.items) {
            if (item.assignedDinerIds.length === 0) continue
            item.assignedDinerIds = item.assignedDinerIds.filter((a) => a !== id)
            // Nobody left on the item → back to "everyone".
          }
        }),

      addItem: (partial) =>
        set((s) => {
          s.round.items.push({ id: newId(), assignedDinerIds: [], ...partial })
        }),

      updateItem: (id, patch) =>
        set((s) => {
          const it = s.round.items.find((i) => i.id === id)
          if (it) Object.assign(it, patch)
        }),

      removeItem: (id) =>
        set((s) => {
          s.round.items = s.round.items.filter((i) => i.id !== id)
        }),

      splitItem: (itemId) =>
        set((s) => {
          const it = s.round.items.find((i) => i.id === itemId)
          if (!it || it.qty < 2 || it.portions) return
          it.portions = [{ units: it.qty, assignedDinerIds: [...it.assignedDinerIds] }]
        }),

      addPortion: (itemId) =>
        set((s) => {
          const it = s.round.items.find((i) => i.id === itemId)
          if (!it?.portions) return
          for (let k = it.portions.length - 1; k >= 0; k--) {
            if (it.portions[k]!.units >= 2) {
              it.portions[k]!.units -= 1
              it.portions.push({ units: 1, assignedDinerIds: [] })
              return
            }
          }
        }),

      /**
       * Sentinel-aware toggle. `[]` means everyone, so:
       *  - toggling a diner OFF "everyone" materializes the explicit
       *    list of all-other diners;
       *  - re-adding the last missing diner collapses back to `[]`.
       */
      toggleAssignment: (itemId, dinerId) =>
        set((s) => {
          const it = s.round.items.find((i) => i.id === itemId)
          if (!it) return
          const allIds = s.round.diners.map((d) => d.id)
          const current = it.assignedDinerIds.length === 0 ? allIds : it.assignedDinerIds
          const next = current.includes(dinerId)
            ? current.filter((id) => id !== dinerId)
            : [...current, dinerId]
          if (next.length === 0) return // an item must keep at least one diner
          const coversEveryone = allIds.length > 0 && allIds.every((id) => next.includes(id))
          it.assignedDinerIds = coversEveryone ? [] : next
        }),

      assignOnly: (itemId, dinerId) =>
        set((s) => {
          const it = s.round.items.find((i) => i.id === itemId)
          if (it && s.round.diners.some((d) => d.id === dinerId)) {
            it.assignedDinerIds = s.round.diners.length === 1 ? [] : [dinerId]
          }
        }),

      assignEveryone: (itemId) =>
        set((s) => {
          const it = s.round.items.find((i) => i.id === itemId)
          if (it) it.assignedDinerIds = []
        }),

      setDiscount: (discount) =>
        set((s) => {
          s.round.discount = cents(Math.max(0, discount))
        }),

      setServicePct: (pct) =>
        set((s) => {
          s.round.servicePct = Math.min(1, Math.max(0, pct))
        }),

      setGstPct: (pct) =>
        set((s) => {
          s.round.gstPct = Math.min(1, Math.max(0, pct))
        }),

      setRounding: (rounding) =>
        set((s) => {
          s.round.rounding = rounding
        }),

      reset: () =>
        set((s) => {
          s.round = emptyRound()
          s.screen = 'splash'
          s.readOnly = false
        }),
    },
  })),
)
