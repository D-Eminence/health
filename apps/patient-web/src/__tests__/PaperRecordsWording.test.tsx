import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createRegisteredBrowserClient } from '@hid/api'
import { createApiClient } from '@hid/http'
import { createPatientApi, type AccessRequest } from '../api'
import { createTestSessionValue, SessionContext } from '../session'
import { AccessPage } from '../routes/Portal'
import { isAdult, PIN_ALLOWS, PIN_COVERS, paperRecordsOnApproval, STAFF_ACCESS_COVERS_PAPER } from '../paperRecordsWording'
import { ToastProvider } from '../kasuwa/toast'

/**
 * The paper records rule as the patient reads it (records processing, 0104; wording approved 3 Nov 2026, Q22; shares added
 * 5 Nov 2026, with no 24-hour bound): an approved request, the Access PIN, or a share, also lets the facility add the
 * patient's old paper records while that access lasts. The share screen's line is pinned in ShareRecords.test.tsx.
 * Said word for word, only on a pending request, and never to someone under 18 (paper records are refused for them).
 */
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

const pending: AccessRequest = {
  accessRequestId: '70000000-0000-4000-8000-000000000001', facilityId: 'facility-1', facilityName: 'Lagos General', scope: 'read_records',
  reason: 'Follow-up visit', status: 'pending', requestedDurationMinutes: 60, requestedAt: '2026-10-08T10:00:00Z',
  approvedAt: null, deniedAt: null, deniedReason: null,
}

function renderAccess(request: AccessRequest, dateOfBirth: string | null) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/me/access-requests')) return json([request])
    if (path.endsWith('/me/access-history')) return json({ items: [] })
    if (path.endsWith('/identity/me')) return json({ hid: 'HID-ZDEMAAA2', fullName: 'Adaeze Okafor', dateOfBirth })
    return json({}, 404)
  })
  const api = createPatientApi(createRegisteredBrowserClient(createApiClient({
    baseUrl: 'https://gateway.test', clientId: 'patient-web', sessionMode: 'cookie', fetchImpl: fetchImpl as typeof fetch,
  }), 'patient-web'))
  render(<MemoryRouter><SessionContext.Provider value={createTestSessionValue({
    kind: 'patient', subjectId: 'patient:subject', appRole: 'patient', assuranceLevel: 'aal1',
  }, api)}><ToastProvider><AccessPage /></ToastProvider></SessionContext.Provider></MemoryRouter>)
  return fetchImpl
}

async function review() {
  fireEvent.click(await screen.findByRole('button', { name: /^Lagos General/ }))
  return within(screen.getByRole('dialog', { name: 'Lagos General' }))
}

const WORDS = 'Approving also lets Lagos General add your old paper records to your Health ID while their access lasts.'

describe('the paper records rule, as the patient reads it', () => {
  it('is the decided sentence, word for word', () => {
    expect(paperRecordsOnApproval('Lagos General')).toBe(WORDS)
    expect(PIN_COVERS).toBe('A hospital you give your PIN to can see and add to your records for 24 hours each time they use it. While that access lasts, they can also add your old paper records to your Health ID. You can end their access at any time in Access & sharing, and change your PIN to stop them using it again.')
    expect(PIN_ALLOWS).toBe('A hospital you give your PIN to can see and add to your records for 24 hours each time they use it. You can end their access at any time in Access & sharing, and change your PIN to stop them using it again.')
    expect(STAFF_ACCESS_COVERS_PAPER).toBe('This access also lets you bring in the patient’s paper records while it lasts.')
  })

  it('is said on a pending request to an adult', async () => {
    renderAccess(pending, '1991-03-04')
    const drawer = await review()
    expect(await drawer.findByText(WORDS)).toBeTruthy()
  })

  it('is not said to someone under 18', async () => {
    const fetched = renderAccess(pending, `${new Date().getUTCFullYear() - 10}-01-01`)
    const drawer = await review()
    expect(await drawer.findByText(/You can end access at any time/)).toBeTruthy()
    // Only once the profile has answered could the line show.
    await waitFor(() => expect(fetched.mock.calls.some(([url]) => new URL(String(url)).pathname.endsWith('/identity/me'))).toBe(true))
    await act(async () => { await Promise.resolve() })
    expect(drawer.queryByText(/paper records/)).toBeNull()
  })

  it('is not said while the age is unknown', async () => {
    const fetched = renderAccess(pending, null)
    const drawer = await review()
    await waitFor(() => expect(fetched.mock.calls.some(([url]) => new URL(String(url)).pathname.endsWith('/identity/me'))).toBe(true))
    await act(async () => { await Promise.resolve() })
    expect(drawer.queryByText(/paper records/)).toBeNull()
  })

  it('is not said once the request is decided', async () => {
    renderAccess({ ...pending, status: 'approved', approvedAt: '2026-10-08T10:05:00Z' }, '1991-03-04')
    fireEvent.click(await screen.findByRole('button', { name: /^Lagos General/ }))
    expect(screen.queryByText(/paper records/)).toBeNull()
  })

  it('counts an adult from the 18th birthday, and never while the age is unknown', () => {
    const now = new Date('2026-11-03T12:00:00Z')
    expect(isAdult('2008-11-03', now)).toBe(true)
    expect(isAdult('2008-11-04', now)).toBe(false)
    expect(isAdult(null, now)).toBe(false)
    expect(isAdult('not a date', now)).toBe(false)
  })
})
