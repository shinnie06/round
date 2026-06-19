import { describe, it, expect } from 'vitest'
import { cents } from '@/math/money'
import { splitBill } from '@/math/splitBill'
import { shareMessage } from '@/features/settle/shareMessage'
import type { Diner, RoundState } from '@/state/types'

const diner = (id: string): Diner => ({ id, name: id, colorIdx: 0 })
const state: RoundState = {
  venue: 'T',
  diners: [diner('a'), diner('b')],
  items: [{ id: 'x', name: 'X', qty: 1, unitPrice: cents(1000), assignedDinerIds: [] }],
  discount: cents(0),
  servicePct: 0,
  gstPct: 0,
  rounding: cents(0),
  scan: null,
  scannedTotal: null,
}

describe('shareMessage', () => {
  it('joins the share text and the url with a blank line', () => {
    const split = splitBill(state)
    const msg = shareMessage(state, split, 'https://x.test/#r=abc')
    expect(msg.endsWith('\n\nhttps://x.test/#r=abc')).toBe(true)
    expect(msg).toContain('Everyone together — $10.00')
  })
})
