import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createRegisteredBrowserClient } from '@hid/api'
import { createApiClient } from '@hid/http'
import { createPatientApi, type AccessRequest } from '../api'
import { createTestSessionValue, SessionContext } from '../session'
import { AccessPage, PIN_COVERS, paperRecordsOnApproval } from '../routes/Portal'
import { ToastProvider } from '../kasuwa/toast'

/**
 * The 24-hour paper records rule as the patient reads it (records processing, 0104; coordinator wording of 3 Nov 2026):
 * a request's first OK, or the Access PIN, also lets the facility add the patient's old paper records for 24 hours.
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
  }) as typeof fetch
  const api = createPatientApi(createRegisteredBrowserClient(createApiClient({
    baseUrl: 'https://gateway.test', clientId: 'patient-web', sessionMode: 'cookie', fetchImpl,
  }), 'patient-web'))
  render(<MemoryRouter><SessionContext.Provider value={createTestSessionValue({
    kind: 'patient', subjectId: 'patient:subject', appRole: 'patient', assuranceLevel: 'aal1',
  }, api)}><ToastProvider><AccessPage /></ToastProvider></SessionContext.Provider></MemoryRouter>)
}

async function review() {
  fireEvent.click(await screen.findByRole('button', { name: /^Lagos General/ }))
  return within(screen.getByRole('dialog', { name: 'Lagos General' }))
}

const WORDS = 'Approving also lets Lagos General add your old paper records to your Health ID for 24 hours after you approve.'

describe('the 24-hour paper records rule, as the patient reads it', () => {
  it('is the decided sentence, word for word', () => {
    expect(paperRecordsOnApproval('Lagos General')).toBe(WORDS)
    expect(PIN_COVERS).toBe('A hospital you give it to can use it to open your records. For 24 hours after they use it, they can also add your old paper records to your Health ID.')
  })

  it('is said on a pending request to an adult', async () => {
    renderAccess(pending, '1991-03-04')
    const drawer = await review()
    expect(await drawer.findByText(WORDS)).toBeTruthy()
  })

  it('is not said to someone under 18', async () => {
    renderAccess(pending, `${new Date().getUTCFullYear() - 10}-01-01`)
    const drawer = await review()
    expect(await drawer.findByText(/You can end access at any time/)).toBeTruthy()
    expect(drawer.queryByText(/paper records/)).toBeNull()
  })

  it('is not said once the request is decided', async () => {
    renderAccess({ ...pending, status: 'approved', approvedAt: '2026-10-08T10:05:00Z' }, '1991-03-04')
    fireEvent.click(await screen.findByRole('button', { name: /^Lagos General/ }))
    expect(screen.queryByText(/paper records/)).toBeNull()
  })
})
