import { forwardRef } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

const button = cva(
  [
    'inline-flex items-center justify-center gap-2 select-none',
    'font-medium rounded-full transition-colors duration-150',
    'disabled:opacity-40 disabled:pointer-events-none',
    'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-cream text-ink hover:bg-paper active:bg-paper-2',
        ghost: 'bg-transparent text-cream border border-line hover:border-cream-dim hover:bg-ink-2',
        quiet: 'bg-ink-3 text-cream hover:bg-line/60',
        danger: 'bg-transparent text-bad border border-bad/40 hover:bg-bad/10',
      },
      size: {
        md: 'min-h-11 px-5 text-body',
        lg: 'min-h-13 px-7 text-body',
        icon: 'min-h-11 min-w-11 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  asChild?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, type, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? 'button')}
        className={cn(button({ variant, size }), className)}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'
