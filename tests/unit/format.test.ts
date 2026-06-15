import { describe, it, expect } from 'vitest'
import { cents } from '@/math/money'
import { formatSGD, parseDollarInput } from '@/lib/format'

describe('formatSGD', () => {
  it('always two decimal places', () => {
    expect(formatSGD(cents(17625))).toBe('$176.25')
    expect(formatSGD(cents(100))).toBe('$1.00')
    expect(formatSGD(cents(5))).toBe('$0.05')
    expect(formatSGD(cents(0))).toBe('$0.00')
  })
  it('minus sign before the dollar sign', () => {
    expect(formatSGD(cents(-500))).toBe('-$5.00')
  })
})

describe('parseDollarInput', () => {
  it('accepts plain and decimal forms', () => {
    expect(parseDollarInput('12')).toBe(1200)
    expect(parseDollarInput('12.3')).toBe(1230)
    expect(parseDollarInput('12.34')).toBe(1234)
    expect(parseDollarInput('0.05')).toBe(5)
  })
  it('strips $ , and whitespace', () => {
    expect(parseDollarInput(' $1,234.50 ')).toBe(123450)
  })
  it('rejects invalid input', () => {
    expect(parseDollarInput('')).toBeNull()
    expect(parseDollarInput('abc')).toBeNull()
    expect(parseDollarInput('12.345')).toBeNull()
    expect(parseDollarInput('-5')).toBeNull()
    expect(parseDollarInput('1.2.3')).toBeNull()
  })
})

describe('cn — custom fluid font sizes must not eat color utilities', () => {
  it('keeps text-ink alongside text-body (twMerge classifies both correctly)', async () => {
    const { cn } = await import('@/lib/cn')
    const out = cn('text-ink text-body', 'w-full')
    expect(out).toContain('text-ink')
    expect(out).toContain('text-body')
  })
  it('still merges real conflicts', async () => {
    const { cn } = await import('@/lib/cn')
    expect(cn('text-body', 'text-title')).toBe('text-title')
    expect(cn('text-ink', 'text-cream')).toBe('text-cream')
  })
})

describe('parseSignedDollarInput', () => {
  it('accepts negative amounts', async () => {
    const { parseSignedDollarInput } = await import('@/lib/format')
    expect(parseSignedDollarInput('-0.02')).toBe(-2)
    expect(parseSignedDollarInput('0.05')).toBe(5)
    expect(parseSignedDollarInput('-')).toBeNull()
    expect(parseSignedDollarInput('abc')).toBeNull()
  })
})
