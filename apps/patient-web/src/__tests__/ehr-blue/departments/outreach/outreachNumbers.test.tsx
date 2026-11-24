import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OutreachNumbers, outreachNumbers, useOutreachTotals, type OutreachTotals } from '../../../../ehr-blue/departments/outreach/outreachNumbers'
import type { OutreachCase, OutreachCasesPage } from '../../../../staff/api'
import { caseSearchText } from '../../../../ehr-blue/departments/outreach/outreachParts'
import { matchesSearch } from '../../../../ehr-blue/departments/parts/format'

/** Registration numbers, counted on the phone from the registrations it has read (owner, 14 Nov 2026). Fictional data only. */
const api = vi.hoisted(() => ({ outreachCasesPage: vi.fn() }))
vi.mock('../../../../staff/api', () => ({ staffApi: api }))

beforeEach(() => { vi.clearAllMocks() })

const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, status: 'identity_resolution_pending', fullName: `Person ${id}`, rowVersion: 1, ...extra })

describe('today’s numbers', () => {
  it('counts registrations, health checks done and Health IDs made', () => {
    expect(outreachNumbers([row('a', { hasScreening: true, healthId: 'HID-AB12CD' }), row('b', { hasScreening: false, healthId: null }), row('c', { hasScreening: true, healthId: null })]))
      .toEqual({ registered: 3, healthChecks: 2, healthIds: 1 })
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

/** n registrations, every other one with health checks, every third with a Health ID. */
const many = (n: number, campaignId = 'campaign-1'): OutreachCase[] => Array.from({ length: n }, (_, i) =>
  row(`r${i}`, { campaignId, hasScreening: i % 2 === 0, healthId: i % 3 === 0 ? `HID-${String(i).padStart(6, '0')}` : null }) as OutreachCase)
const totalsOf = (cases: OutreachCase[], extra: Partial<OutreachTotals> = {}): OutreachTotals =>
  ({ counted: outreachNumbers(cases), capped: false, latestOnly: false, ...extra })
const tile = (name: string) => screen.getByRole('region', { name: 'Registration numbers' }).textContent?.match(new RegExp(`${name}(\\d[\\d,]*)`))?.[1]

describe('every registration counted', () => {
  it('shows the totals, not only the 100 loaded, and drops the "loaded" line', () => {
    const loaded = many(100)
    render(<OutreachNumbers cases={loaded} more totals={totalsOf(many(138))} label="Registration numbers" />)
    expect(tile('Registered')).toBe('138')
    expect(tile('Health checks done')).toBe('69')
    expect(tile('Health IDs made')).toBe('46')
    expect(screen.queryByText(/Counted from/)).toBeNull()
  })

  it('says the counts cover only the newest when the read stopped early, or an Outreach sends only its newest 100', () => {
    const { rerender } = render(<OutreachNumbers cases={many(100)} more totals={totalsOf(many(10000), { capped: true })} label="Registration numbers" />)
    expect(screen.getByText('Counted from the newest 10,000 registrations.')).toBeTruthy()
    rerender(<OutreachNumbers cases={many(100)} more totals={totalsOf(many(100), { latestOnly: true })} label="Registration numbers" />)
    expect(screen.getByText('Counted from the newest 100 registrations.')).toBeTruthy()
  })

  it('counts what is loaded until the totals are read', () => {
    render(<OutreachNumbers cases={many(100)} more totals={null} label="Registration numbers" />)
    expect(tile('Registered')).toBe('100')
    expect(screen.getByText(/^Counted from the 100 registrations loaded\./)).toBeTruthy()
  })

  it('never shows fewer than the list itself has: totals behind the list are not used', () => {
    const loaded = many(100).map(item => ({ ...item, hasScreening: true }))
    render(<OutreachNumbers cases={loaded} more totals={totalsOf(many(120))} label="Registration numbers" />)
    expect(tile('Registered')).toBe('100')
    expect(tile('Health checks done')).toBe('100')
    expect(screen.getByText(/^Counted from the 100 registrations loaded\./)).toBeTruthy()
  })

  it('counts the list itself once everything is loaded', () => {
    render(<OutreachNumbers cases={many(5)} more={false} totals={totalsOf(many(138))} label="Registration numbers" />)
    expect(tile('Registered')).toBe('5')
  })
})

describe('reading every registration for the numbers', () => {
  const page = (items: OutreachCase[], nextCursor: string | null): OutreachCasesPage => ({ items, nextCursor })

  it('reads every page, 500 at a time, once the list says more are left, and again each time the list reads again', async () => {
    api.outreachCasesPage
      .mockResolvedValueOnce(page(many(500), 'cursor-2'))
      .mockResolvedValueOnce(page(many(600).slice(500), null))
    const first = page(many(100), 'c')
    const { result, rerender } = renderHook(({ first: shown }) => useOutreachTotals('facility-1', true, shown), { initialProps: { first } })
    await waitFor(() => expect(result.current?.counted.registered).toBe(600))
    expect(api.outreachCasesPage.mock.calls).toEqual([['facility-1', { limit: 500, before: undefined }], ['facility-1', { limit: 500, before: 'cursor-2' }]])
    // The same first page (the list not read again): nothing more is asked.
    await act(async () => { rerender({ first }) })
    expect(api.outreachCasesPage).toHaveBeenCalledTimes(2)
    // The list read again: so are the numbers.
    api.outreachCasesPage.mockResolvedValueOnce(page(many(601), null))
    await act(async () => { rerender({ first: page(many(100), 'c') }) })
    await waitFor(() => expect(result.current?.counted.registered).toBe(601))
    expect(api.outreachCasesPage).toHaveBeenCalledTimes(3)
  })

  it('keeps the last numbers read when a read fails, until one succeeds', async () => {
    api.outreachCasesPage.mockResolvedValueOnce(page(many(138), null))
    const { result, rerender } = renderHook(({ first }) => useOutreachTotals('facility-1', true, first), { initialProps: { first: page(many(100), 'c') } })
    await waitFor(() => expect(result.current?.counted.registered).toBe(138))
    api.outreachCasesPage.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await act(async () => { rerender({ first: page(many(100), 'c') }) })
    expect(api.outreachCasesPage).toHaveBeenCalledTimes(2)
    expect(result.current?.counted.registered).toBe(138)
    api.outreachCasesPage.mockResolvedValueOnce(page(many(140), null))
    await act(async () => { rerender({ first: page(many(100), 'c') }) })
    await waitFor(() => expect(result.current?.counted.registered).toBe(140))
  })

  it('reads nothing when the list has everyone, or the list is not readable', async () => {
    const { rerender } = renderHook(({ first, enabled }) => useOutreachTotals('facility-1', enabled, first),
      { initialProps: { first: page(many(3), null) as OutreachCasesPage | null, enabled: true } })
    rerender({ first: null, enabled: true })
    rerender({ first: page(many(100), 'c'), enabled: false })
    await act(async () => { await Promise.resolve() })
    expect(api.outreachCasesPage).not.toHaveBeenCalled()
  })

  it('counts a campaign’s registrations by campaign, keeping only its own', async () => {
    api.outreachCasesPage.mockResolvedValueOnce(page([...many(120), ...many(30, 'campaign-2').map(item => ({ ...item, id: `o-${item.id}` }))], null))
    const { result } = renderHook(() => useOutreachTotals('facility-1', true, page(many(100), 'c'), 'campaign-1'))
    await waitFor(() => expect(result.current?.counted.registered).toBe(120))
    expect(api.outreachCasesPage).toHaveBeenCalledWith('facility-1', { limit: 500, before: undefined, campaignId: 'campaign-1' })
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
