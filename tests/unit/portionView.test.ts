import { describe, it, expect } from 'vitest'
import type { Diner } from '@/state/types'
import { portionWho, portionRowVM } from '@/features/workspace/portionView'

const diners: Diner[] = [
  { id: 'p1', name: 'P1', colorIdx: 0 },
  { id: 'p2', name: 'P2', colorIdx: 1 },
  { id: 'p3', name: 'P3', colorIdx: 2 },
  { id: 'm', name: 'M', colorIdx: 3 },
]

describe('portionWho', () => {
  it('renders the [] sentinel as "everyone"', () => {
    expect(portionWho({ units: 1, assignedDinerIds: [] }, diners)).toBe('everyone')
  })

  it('joins one or two names', () => {
    expect(portionWho({ units: 1, assignedDinerIds: ['p1'] }, diners)).toBe('P1')
    expect(portionWho({ units: 1, assignedDinerIds: ['p1', 'p2'] }, diners)).toBe('P1, P2')
  })

  it('collapses 3+ explicit names to "N people"', () => {
    expect(portionWho({ units: 2, assignedDinerIds: ['p1', 'p2', 'p3'] }, diners)).toBe('3 people')
  })

  it('drops ids that no longer resolve, then re-labels', () => {
    expect(portionWho({ units: 1, assignedDinerIds: ['p1', 'ghost'] }, diners)).toBe('P1')
  })

  it('treats an all-unknown explicit list as no-one (skipped slice)', () => {
    expect(portionWho({ units: 1, assignedDinerIds: ['ghost'] }, diners)).toBe('no one')
  })
})

describe('portionRowVM', () => {
  it('resolves the [] sentinel to every diner and dots all of them', () => {
    const vm = portionRowVM({ units: 2, assignedDinerIds: [] }, diners)
    expect(vm.memberIds).toEqual(['p1', 'p2', 'p3', 'm'])
    expect(vm.dots.map((d) => d.id)).toEqual(['p1', 'p2', 'p3', 'm'])
    expect(vm.unitNoun).toBe('2 units')
  })

  it('marks explicit members on, others off, preserving diner order', () => {
    const vm = portionRowVM({ units: 1, assignedDinerIds: ['p2'] }, diners)
    expect(vm.memberIds).toEqual(['p2'])
    expect(vm.rows.map((r) => [r.id, r.on])).toEqual([
      ['p1', false],
      ['p2', true],
      ['p3', false],
      ['m', false],
    ])
    expect(vm.unitNoun).toBe('1 unit')
  })

  it('lockedLast is true only when exactly one member is on', () => {
    const solo = portionRowVM({ units: 1, assignedDinerIds: ['p1'] }, diners)
    expect(solo.rows.find((r) => r.id === 'p1')!.lockedLast).toBe(true)
    const shared = portionRowVM({ units: 2, assignedDinerIds: ['p1', 'p2'] }, diners)
    expect(shared.rows.find((r) => r.id === 'p1')!.lockedLast).toBe(false)
  })

  it('caps dots at 5 and reports the overflow count', () => {
    const many: Diner[] = Array.from({ length: 7 }, (_, i) => ({
      id: `d${i}`,
      name: `D${i}`,
      colorIdx: i,
    }))
    const vm = portionRowVM({ units: 1, assignedDinerIds: [] }, many)
    expect(vm.dots).toHaveLength(5)
    expect(vm.overflow).toBe(2)
  })
})
