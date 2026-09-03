import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { createHidApi, type HidApiFor } from '@hid/api'
import { createApiClient } from '@hid/http'
import { PATIENT_ROUTE, STAFF_ROUTE, type SessionState } from '@hid/auth'
import { RequireAccess } from '../RequireAccess'
import { SessionContext } from '../session'
import type { PatientPrincipal, StaffPrincipal } from '@hid/auth'

const patient: PatientPrincipal = {
  kind: 'patient',
  subjectId: 'subject-1',
  appRole: 'patient',
  assuranceLevel: 'aal1',
}

const staff: StaffPrincipal = {
  kind: 'staff',
  subjectId: 'subject-2',
  appRole: 'clinician',
  assuranceLevel: 'aal2',
  staffRole: 'doctor',
  organizationId: 'org-1',
}

function stubApi(): HidApiFor<'patient-web'> {
  const client = createApiClient({
    baseUrl: 'https://gateway.test',
    clientId: 'patient-web',
    fetchImpl: vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
  })
  return createHidApi({ app: 'patient-web', client })
}

function renderGuard(state: SessionState, requirement = PATIENT_ROUTE) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <SessionContext.Provider value={{ state, api: stubApi(), signOut: () => {} }}>
        <Routes>
          <Route
            path="/"
            element={
              <RequireAccess requirement={requirement}>
                <p>Protected content</p>
              </RequireAccess>
            }
          />
          <Route path="/sign-in" element={<p>Sign-in screen</p>} />
          <Route path="/verify" element={<p>Verification screen</p>} />
        </Routes>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
}

describe('RequireAccess', () => {
  it('renders protected content for a signed-in patient', () => {
    renderGuard({ status: 'authenticated', principal: patient })

    expect(screen.getByText('Protected content')).toBeDefined()
  })

  it('waits rather than redirecting while the session is unknown', () => {
    renderGuard({ status: 'unknown', principal: null })

    expect(screen.getByRole('status')).toBeDefined()
    expect(screen.queryByText('Sign-in screen')).toBeNull()
    expect(screen.queryByText('Protected content')).toBeNull()
  })

  it('redirects an anonymous visitor to sign-in', () => {
    renderGuard({ status: 'anonymous', principal: null })

    expect(screen.getByText('Sign-in screen')).toBeDefined()
    expect(screen.queryByText('Protected content')).toBeNull()
  })

  it('never renders protected content for the wrong portal', () => {
    renderGuard({ status: 'authenticated', principal: staff })

    expect(screen.queryByText('Protected content')).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('patient application')
  })

  it('sends a session without MFA to verification when the route requires it', () => {
    renderGuard(
      { status: 'authenticated', principal: { ...staff, assuranceLevel: 'aal1' } },
      STAFF_ROUTE,
    )

    expect(screen.getByText('Verification screen')).toBeDefined()
  })

  it('leaks nothing about the principal into the rendered output', () => {
    const { container } = renderGuard({ status: 'authenticated', principal: patient })

    expect(container.textContent).not.toContain('subject-1')
  })
})
