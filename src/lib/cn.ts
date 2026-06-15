import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * twMerge must be told about our custom fluid font-size utilities
 * (`@theme --text-display` etc.) — otherwise it classifies `text-body`
 * as a COLOR and silently drops real color classes like `text-ink`
 * when they appear together (cream text on a cream button, invisibly).
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['display', 'title', 'body', 'small', 'receipt'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
