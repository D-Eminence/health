import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OutreachNumbers, outreachNumbers } from '../../../../ehr-blue/departments/outreach/outreachNumbers'
import { caseSearchText } from '../../../../ehr-blue/departments/outreach/outreachParts'
import { matchesSearch } from '../../../../ehr-blue/departments/parts/format'

/** Registration numbers, counted on the phone from the registrations it has read (owner, 14 Nov 2026). Fictional data only. */
const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, status: 'identity_resolution_pending', fullName: `Person ${id}`, rowVersion: 1, ...extra })

describe('today’s numbers', () => {
  it('counts registrations, health checks done and Health IDs made', () => {
    expect(outreachNumbers([row('a', { hasScreening: true, healthId: 'HID-AB12CD' }), row('b', { hasScreening: false, healthId: null }), row('c', { hasScreening: true, healthId: null })]))
      .toEqual({ registered: 3, healthChecks: 2, healthIds: 1 })
  })

  it('does not count a health checks form saved with nothing filled in', () => {
    expect(outreachNumbers([row('a', { hasScreening: true, hasRecordedChecks: false }), row('b', { hasScreening: true, hasRecordedChecks: true }),
      row('c', { hasScreening: false, hasRecordedChecks: false })])).toEqual({ registered: 3, healthChecks: 1 })
  })

  it('leaves out a count Outreach does not send yet, never showing it as 0', () => {
    expect(outreachNumbers([row('a'), row('b')])).toEqual({ registered: 2 })
  })

  it('shows the tiles, the phone’s waiting count, and says when older registrations are not counted', () => {
    render(<OutreachNumbers cases={[row('a', { hasScreening: true, healthId: 'HID-AB12CD' })]} more waitingOnPhone={2} label="Registration numbers" />)
    const numbers = screen.getByRole('region', { name: 'Registration numbers' })
    expect(numbers.textContent).toContain('Registered1')
    expect(numbers.textContent).toContain('Health checks done1')
    expect(numbers.textContent).toContain('Health IDs made1')
    expect(numbers.textContent).toContain('Waiting on this phone2')
    expect(numbers.textContent).toContain('Counted from the 1 registrations loaded.')
  })

  it('shows nothing before the registrations are read', () => {
    const { container } = render(<OutreachNumbers cases={null} more={false} label="Registration numbers" />)
    expect(container.textContent).toBe('')
  })
})

describe('finding a person', () => {
  it('finds a registration by its Health ID, in any case, and never by phone', () => {
    const item = row('a', { healthId: 'HID-AB12CD', phone: '08031234567' })
    expect(matchesSearch('hid-ab12cd', caseSearchText(item))).toBe(true)
    expect(matchesSearch('AB12CD', caseSearchText(item))).toBe(true)
    expect(matchesSearch('08031234567', caseSearchText(item))).toBe(false)
  })
})
