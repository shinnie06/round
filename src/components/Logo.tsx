import { cn } from '@/lib/cn'

/**
 * The Round mark — the bill as a ring split into four unequal arcs
 * (42/26/19/13). The amber arc is whose round it is; the dot is the
 * coin on the table. Same geometry as public/logo.svg and the PWA icons.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('h-16 w-16', className)} aria-hidden="true">
      <g fill="none" strokeLinecap="round" strokeWidth="7">
        <path d="M 32 9 A 23 23 0 0 1 53.72 39.56" stroke="var(--color-accent)" />
        <path d="M 48.49 48.03 A 23 23 0 0 1 23.46 53.36" stroke="var(--color-cream)" />
        <path d="M 15.23 47.74 A 23 23 0 0 1 9.13 29.52" stroke="var(--color-cream)" />
        <path d="M 12.33 20.09 A 23 23 0 0 1 22.28 11.15" stroke="var(--color-cream)" />
      </g>
      <circle cx="32" cy="32" r="4.5" fill="var(--color-cream)" />
    </svg>
  )
}
