import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { createRegisteredBrowserClient } from '@hid/api'
import { createApiClient } from '@hid/http'
import { createPatientApi, type AccessRequest } from '../api'
import { createTestSessionValue, SessionContext } from '../session'
import { AccessPage } from '../routes/Portal'

/** D4: the patient sees how long a facility asks for access before approving it. */
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

const request = (requestedDurationMinutes: number): AccessRequest => ({
  accessRequestId: '70000000-0000-4000-8000-000000000001', facilityId: 'facility-1', facilityName: 'Demo Hospital', scope: 'read_records',
  reason: 'Follow-up visit', status: 'pending', requestedDurationMinutes, requestedAt: '2026-10-29T10:00:00Z',
  approvedAt: null, deniedAt: null, deniedReason: null,
})

function renderWith(answer: AccessRequest) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname
    return path.endsWith('/me/access-requests') ? json([answer]) : path.endsWith('/me/access-history') ? json({ items: [] }) : json({}, 404)
  }) as typeof fetch
  const api = createPatientApi(createRegisteredBrowserClient(createApiClient({
    baseUrl: 'https://gateway.test', clientId: 'patient-web', sessionMode: 'cookie', fetchImpl,
  }), 'patient-web'))
  render(<MemoryRouter><SessionContext.Provider value={createTestSessionValue({
    kind: 'patient', subjectId: 'patient:subject', appRole: 'patient', assuranceLevel: 'aal1',
  }, api)}><AccessPage /></SessionContext.Provider></MemoryRouter>)
}

describe('access request length on the patient card', () => {
  it.each([[480, 'for 8 hours'], [60, 'for 1 hour'], [720, 'for 12 hours'], [90, 'for 90 minutes']])('%i minutes reads “%s”', async (minutes, text) => {
    renderWith(request(minutes))
    expect(await screen.findByText(new RegExp(`· pending · ${text}$`))).toBeTruthy()
  })
})
