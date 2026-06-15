import { fromDollars, type Cents } from '@/math/money'

/** Cents → display string. Minus sign precedes the dollar sign: -$5.00. */
export function formatSGD(c: Cents): string {
  const sign = c < 0 ? '-' : ''
  const abs = Math.abs(c)
  const dollars = Math.floor(abs / 100)
  const remainder = String(abs % 100).padStart(2, '0')
  return `${sign}$${dollars}.${remainder}`
}

/**
 * User keyboard input → Cents. Permissive about $ , and spaces,
 * strict about everything else (max 2dp, non-negative). Null = invalid,
 * so callers can keep the previous value instead of writing garbage.
 */
export function parseDollarInput(s: string): Cents | null {
  const cleaned = s.replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  return fromDollars(Number(cleaned))
}

/** Same as parseDollarInput but accepts a leading minus (rounding adjustments). */
export function parseSignedDollarInput(s: string): Cents | null {
  const cleaned = s.replace(/[$,\s]/g, '')
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null
  return fromDollars(Number(cleaned))
}
