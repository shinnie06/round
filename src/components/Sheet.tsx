'use client'
import * as Dialog from '@radix-ui/react-dialog'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * Bottom sheet on phones, centered panel on desktop. Radix Dialog
 * underneath (focus trap, esc, aria), Framer spring on top.
 */
export interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** Visually hide the title (it stays available to screen readers). */
  hideTitle?: boolean
  children: React.ReactNode
  className?: string
}

const spring = { type: 'spring', stiffness: 380, damping: 34 } as const

export function Sheet({ open, onOpenChange, title, hideTitle, children, className }: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className={cn(
                  'fixed z-50 bg-ink-2 border border-line text-cream',
                  'inset-x-0 bottom-0 rounded-t-sheet max-h-[88dvh] overflow-y-auto safe-bottom',
                  // desktop: true centering via inset-0 + auto margins — no
                  // transform tricks, so framer's y-spring stays a pure offset
                  'md:inset-0 md:m-auto md:h-fit md:w-[28rem] md:max-h-[80dvh] md:rounded-sheet',
                  className,
                )}
                initial={{ y: '12%', opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: '8%', opacity: 0 }}
                transition={spring}
              >
                <div className="flex items-center justify-between px-5 pt-4 pb-1">
                  <Dialog.Title
                    className={cn('font-display text-title', hideTitle && 'sr-only')}
                  >
                    {title}
                  </Dialog.Title>
                  <Dialog.Close
                    className="grid place-items-center min-h-11 min-w-11 rounded-full text-cream-dim hover:text-cream"
                    aria-label="Close"
                  >
                    <X size={20} aria-hidden />
                  </Dialog.Close>
                </div>
                <div className="px-5 pb-5">{children}</div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}
