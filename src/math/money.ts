/**
 * Money core. Every amount in the app is an integer number of cents,
 * branded so a stray dollar-float can't sneak into the math engine.
 * Conversion to/from dollars happens ONLY at I/O boundaries
 * (display, OCR JSON, user input parsing).
 */
declare const BRAND: unique symbol
export type Cents = number & { readonly [BRAND]: 'cents' }

/** Assert-and-brand. Throws on non-integers — catches unit bugs at the boundary. */
export function cents(n: number): Cents {
  if (!Number.isInteger(n)) throw new Error(`cents() requires an integer, got ${n}`)
  return n as Cents
}

export const ZERO = cents(0)

/**
 * Dollars → cents, round-half-up on magnitude (sign-symmetric, so a
 * -$2.345 discount and a $2.345 charge land the same distance from zero).
 * The epsilon shields against IEEE754 artifacts like 19.9 * 100 = 1989.99…98.
 */
export function fromDollars(d: number): Cents {
  if (!Number.isFinite(d)) throw new Error(`fromDollars() requires a finite number, got ${d}`)
  const sign = d < 0 ? -1 : 1
  return cents(sign * Math.round(Math.abs(d) * 100 + Number.EPSILON * 1e4))
}

export function toDollars(c: Cents): number {
  return c / 100
}

export function addC(...cs: Cents[]): Cents {
  return cents(cs.reduce<number>((a, b) => a + b, 0))
}
