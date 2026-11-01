import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type * as StaffApi from '../../../staff/api'
import { BlueFrame } from '../../../ehr-blue/frame/BlueFrame'

/**
 * The EHR's Start menu says what each item does. "Ask a patient for access" asks a patient to share their record with
 * this facility (Access requests): nothing is sent to another facility, so it never says so. It uses the words of the
 * page it opens ("Ask a patient") and of copy.ts, never "Request record access". Every account and facility is
 * fictional.
 */

vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
// Nothing here waits on Health ID: every call stays unanswered, so the pages show their loading state.
vi.mock('../../../staff/api', async importOriginal => {
  const actual = await importOriginal<typeof StaffApi>()
  const unanswered = <T extends object>(api: T): T => new Proxy(api, {
    get: (target, key) => typeof Reflect.get(target, key) === 'function' ? () => new Promise(() => {}) : Reflect.get(target, key),
  })
  return {
    ...actual, staffApi: unanswered(actual.staffApi), facilityStaffApi: unanswered(actual.facilityStaffApi), billingApi: unanswered(actual.billingApi),
    orderRoutesApi: unanswered(actual.orderRoutesApi), staffInvitationApi: unanswered(actual.staffInvitationApi),
  }
})
vi.mock('../../../staff/App', () => ({
  useStaff: () => {
    const facility = { id: 'f0000000-0000-4000-8000-0000000000d1', membershipId: 'member-1', organizationId: 'org-1', name: 'Riverside Clinic (fictional)',
      roles: ['clinician'], permissions: ['identity.patient.read', 'identity.consent.write', 'ehr.encounter.read'], isPrimary: true }
    return {
      state: { status: 'ready', session: { actor: { id: 'staff-1', email: 'clinician@example.test', displayName: 'Demo Clinician', roles: [], permissions: [],
        facilities: [facility], facility }, expiresAt: '2026-11-30T12:00:00.000Z' } },
      lock: null, signOut: async () => {}, refresh: async () => {}, activePatient: null, setActivePatient: () => true,
    }
  },
}))

describe('the Start menu', () => {
  it('says "Ask a patient for access" asks a patient to share their record here, not that it reaches another facility', async () => {
    render(<MemoryRouter initialEntries={['/provider/requests']}><Routes><Route path="/provider/*" element={<BlueFrame />} /></Routes></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))
    const start = screen.getByRole('dialog', { name: 'Start' })
    const item = within(start).getByRole('link', { name: /^Ask a patient for access/ })
    expect(item.getAttribute('href')).toBe('/provider/requests')
    expect(item.textContent).toBe('Ask a patient for accessAsk a patient to share their record here')
    expect(start.textContent).not.toMatch(/another facility/i)
    expect(start.textContent).not.toMatch(/request record access/i)
  })
})
