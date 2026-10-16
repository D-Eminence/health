import { describe, expect, it, vi } from 'vitest'
import { useEffect, useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { createApiClient } from '@hid/http'
import { PATIENT_ROUTE, STAFF_ROUTE, type SessionState } from '@hid/auth'
import { RequireAccess } from '../RequireAccess'
import { createTestSessionValue, SessionContext } from '../session'
import { createPatientApi, type PatientApi } from '../api'
import type { PatientPrincipal, StaffPrincipal } from '@hid/auth'
import { pressOnArrival } from './portalHarness'

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

  it('names the session check with a level-one heading while it runs and when it fails', () => {
    const { unmount } = renderGuard({ status: 'unknown', principal: null })
    expect(screen.getByRole('heading', { level: 1, name: 'Checking your session…' })).toBeDefined()
    unmount()
    renderGuard({ status: 'unknown', principal: null }, PATIENT_ROUTE, 'We could not check your session. Try again.')
    // The heading names the state; what to do follows it.
    expect(screen.getByRole('heading', { level: 1, name: 'We could not check your session' })).toBeDefined()
    // The check also fails for an outage or a session this portal cannot use, not
    // only for a lost connection, so the advice blames none of them.
    expect(screen.getByRole('alert').textContent).toBe('We could not check your sessionTry again in a moment.Try again')
  })

  it('after Try again, moves focus to the page that opens, or to Try again when the check fails again', async () => {
    const failed = 'We could not check your session. Try again.'
    function Checking({ outcomes }: { outcomes: Array<'allow' | 'fail'> }) {
      const [value, setValue] = useState<{ state: SessionState; sessionError: string | null }>({ state: { status: 'unknown', principal: null }, sessionError: failed })
      const retrySessionCheck = () => {
        setValue({ state: { status: 'unknown', principal: null }, sessionError: null })
        setTimeout(() => setValue(outcomes.shift() === 'allow'
          ? { state: { status: 'authenticated', principal: patient }, sessionError: null }
          : { state: { status: 'unknown', principal: null }, sessionError: failed }), 0)
      }
      return <MemoryRouter><SessionContext.Provider value={{ ...createTestSessionValue(null, stubApi()), ...value, retrySessionCheck }}>
        <RequireAccess requirement={PATIENT_ROUTE}><main id="main"><h1>Your health, connected.</h1></main></RequireAccess>
      </SessionContext.Provider></MemoryRouter>
    }
    render(<Checking outcomes={['fail', 'allow']} />)
    const first = screen.getByRole('button', { name: 'Try again' })
    first.focus()
    await act(async () => { fireEvent.click(first) })
    const second = await screen.findByRole('button', { name: 'Try again' })
    await waitFor(() => expect(document.activeElement).toBe(second))
    await act(async () => { fireEvent.click(second) })
    const heading = await screen.findByRole('heading', { level: 1, name: 'Your health, connected.' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })

  it('moves focus to the page that opens when Try again is pressed before the failed check\'s effects have run', async () => {
    // A press that comes after the render showing 'Try again' commits, and before
    // its effects run: an effect still pending from that render once took the press
    // for the outcome, and focus stayed on the button the check replaced.
    const failed = 'We could not check your session. Try again.'
    const unknown: SessionState = { status: 'unknown', principal: null }
    function Checking() {
      const [value, setValue] = useState<{ state: SessionState; sessionError: string | null }>({ state: unknown, sessionError: null })
      useEffect(() => { const timer = setTimeout(() => setValue({ state: unknown, sessionError: failed }), 0); return () => clearTimeout(timer) }, [])
      const retrySessionCheck = () => {
        setValue({ state: unknown, sessionError: null })
        setTimeout(() => setValue({ state: { status: 'authenticated', principal: patient }, sessionError: null }), 0)
      }
      return <MemoryRouter><SessionContext.Provider value={{ ...createTestSessionValue(null, stubApi()), ...value, retrySessionCheck }}>
        <RequireAccess requirement={PATIENT_ROUTE}><main id="main"><h1>Your health, connected.</h1></main></RequireAccess>
      </SessionContext.Provider></MemoryRouter>
    }
    const pressed = pressOnArrival('Try again')
    render(<Checking />)
    await waitFor(() => expect(pressed()).toBe(true))
    const heading = await screen.findByRole('heading', { level: 1, name: 'Your health, connected.' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
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
