import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { createApiClient } from '@hid/http'
import { PATIENT_ROUTE, STAFF_ROUTE, type SessionState } from '@hid/auth'
import { RequireAccess } from '../RequireAccess'
import { createTestSessionValue, SessionContext } from '../session'
import { createPatientApi, type PatientApi } from '../api'
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

function stubApi(): PatientApi {
  const client = createApiClient({
    baseUrl: 'https://gateway.test',
    clientId: 'patient-web',
    fetchImpl: vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
  })
  return createPatientApi(client)
}

function renderGuard(state: SessionState, requirement = PATIENT_ROUTE,
  sessionError: string | null = null, retrySessionCheck = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <SessionContext.Provider value={{ ...createTestSessionValue(state.principal, stubApi()), state,
        sessionError, retrySessionCheck }}>
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

  it('offers a retry when session verification fails without confirming sign-out', () => {
    const retry = vi.fn()
    renderGuard({ status: 'unknown', principal: null }, PATIENT_ROUTE,
      'We could not check your session. Try again.', retry)

    expect(screen.getByRole('alert').textContent).toContain('could not check')
    expect(screen.queryByText('Sign-in screen')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledOnce()
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
