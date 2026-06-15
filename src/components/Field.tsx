'use client'
import { forwardRef, useId } from 'react'
import { cn } from '@/lib/cn'

/**
 * Labelled input. EVERY text input in the app goes through this so each
 * one has a real <label for> — screen readers and the verify harness
 * both find fields by their accessible label.
 */
export interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string
  /** Visually hide the label (stays in the a11y tree). */
  hideLabel?: boolean
  containerClassName?: string
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(
  ({ label, hideLabel, className, containerClassName, id, ...props }, ref) => {
    const autoId = useId()
    const inputId = id ?? autoId
    return (
      <div className={cn('flex flex-col gap-1.5', containerClassName)}>
        <label
          htmlFor={inputId}
          className={cn('text-small text-cream-dim', hideLabel && 'sr-only')}
        >
          {label}
        </label>
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'min-h-11 rounded-lg bg-ink-3 border border-line px-3 text-body text-cream',
            'placeholder:text-cream-faint',
            'focus:border-cream-dim focus:outline-none focus-visible:outline-2 focus-visible:outline-accent',
            className,
          )}
          {...props}
        />
      </div>
    )
  },
)
Field.displayName = 'Field'
