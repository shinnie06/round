import { formatSGD } from '@/lib/format'
import type { Cents } from '@/math/money'
import { cn } from '@/lib/cn'

/** Every amount in the app: JetBrains Mono, tabular numerals. */
export function Money({
  cents,
  signColor = false,
  className,
}: {
  cents: Cents
  /** Tint negatives green (they're in the diner's favor). */
  signColor?: boolean
  className?: string
}) {
  return (
    <span className={cn('money', signColor && cents < 0 && 'text-good', className)}>
      {formatSGD(cents)}
    </span>
  )
}
