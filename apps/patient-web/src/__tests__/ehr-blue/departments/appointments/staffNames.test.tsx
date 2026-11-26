import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useStaffNames } from '../../../../ehr-blue/departments/appointments/staffNames'

/*
 * Who an appointment is with, by name (hid-system SX-9, GET identity/facility-staff-names), for every bookable nurse,
 * clinician and doctor: SX-9 takes at most 100 ids a request, and a hospital can have more. Every id is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
const api = vi.hoisted(() => ({ facilityStaffNames: vi.fn() }))
vi.mock('../../../../staff/api', async importOriginal => ({ ...(await importOriginal<object>()), staffApi: api }))

const FACILITY = 'f0000000-0000-4000-8000-000000000001'
const member = (index: number) => `d0000000-0000-4000-8000-${String(index).padStart(12, '0')}`
const ids = (count: number) => Array.from({ length: count }, (_, index) => member(index + 1))

afterEach(() => { vi.clearAllMocks() })

function answerAsked() {
  api.facilityStaffNames.mockImplementation(async (facilityId: string, asked: readonly string[]) => ({
    facilityId, complete: true, staff: asked.map(id => ({ membershipId: id, name: `Staff ${id.slice(-3)}`, current: true })),
  }))
}

describe('staff names for appointments', () => {
  it('names every one of 150 bookable staff, asking for at most 100 at a time', async () => {
    answerAsked()
    const wanted = ids(150)
    const { result } = renderHook(() => useStaffNames(FACILITY, wanted))
    await waitFor(() => expect(result.current.size).toBe(150))
    expect(api.facilityStaffNames).toHaveBeenCalledTimes(2)
    const asked = api.facilityStaffNames.mock.calls.map(([, batch]) => batch as string[])
    expect(asked.map(batch => batch.length)).toEqual([100, 50])
    expect(new Set(asked.flat())).toEqual(new Set(wanted))
    expect(result.current.get(member(150))).toBe('Staff 150')
  })

  it('asks for each id once only, also when more ids come later', async () => {
    answerAsked()
    const first: readonly (string | null)[] = ids(120)
    const { result, rerender } = renderHook(({ wanted }) => useStaffNames(FACILITY, wanted), { initialProps: { wanted: first } })
    await waitFor(() => expect(result.current.size).toBe(120))
    rerender({ wanted: [...ids(120), member(500), null] })
    await waitFor(() => expect(result.current.size).toBe(121))
    expect(api.facilityStaffNames.mock.calls.map(([, batch]) => (batch as string[]).length)).toEqual([100, 20, 1])
  })

  it('leaves only the ids of a failed request unnamed', async () => {
    api.facilityStaffNames.mockImplementation(async (facilityId: string, asked: readonly string[]) => {
      if (asked.length === 100) throw new Error('offline')
      return { facilityId, complete: true, staff: asked.map(id => ({ membershipId: id, name: `Staff ${id.slice(-3)}`, current: true })) }
    })
    const { result } = renderHook(() => useStaffNames(FACILITY, ids(130)))
    await waitFor(() => expect(result.current.size).toBe(30))
    expect(api.facilityStaffNames).toHaveBeenCalledTimes(2)
  })
})
