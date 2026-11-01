import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'

/**
 * Novu has no clinician self sign-up (hid-system ADR-066 is main's): the
 * provider pages say it is not open, link no application to check, and ask
 * Identity nothing about it.
 */
vi.mock('../env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))

let calls: string[] = []
beforeEach(() => {
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url))
    return new Response('{"code":"API_ROUTE_NOT_FOUND"}', { status: 404, headers: { 'Content-Type': 'application/json' } })
  }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

const show = (element: ReactElement) => render(<MemoryRouter>{element}</MemoryRouter>)

describe('clinician sign-up on Novu', () => {
  it('offers nothing on the provider pages: no sign-up, no application, no "not open yet"', async () => {
    const { ClinicianSignUpEntry } = await import('./ClinicianSignUpEntry')
    const { container } = show(<ClinicianSignUpEntry className="entry" />)
    await waitFor(() => expect(calls).toEqual([]))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(container.textContent).toBe('')
    expect(screen.queryByRole('link')).toBeNull()
    expect(calls).toEqual([])
  })

  it('opens the sign-up page as not open, with only the way to sign in', async () => {
    const { ClinicianSignUp } = await import('../routes/ClinicianSignUp')
    show(<ClinicianSignUp />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Clinician sign-up is closed for now' })).toBeTruthy()
    expect(screen.getAllByRole('link').map(link => link.textContent)).not.toContain('Check an application')
    // The page's own way to sign in, and the redesign's top-bar link: both lead to provider sign-in.
    expect(screen.getAllByRole('link', { name: 'Sign in' }).map(link => link.getAttribute('href'))).toEqual(['/provider/sign-in', '/provider/sign-in'])
    expect(screen.queryByRole('alert')).toBeNull()
    expect(calls).toEqual([])
  })

  it('opens the status page as having no application to check', async () => {
    const { ClinicianApplicationStatus } = await import('../routes/ClinicianApplicationStatus')
    show(<ClinicianApplicationStatus />)
    expect(screen.getByRole('heading', { level: 1, name: 'Clinician sign-up is closed for now' })).toBeTruthy()
    expect(screen.getByText(/no application to check/)).toBeTruthy()
    // The page's own way to sign in, and the redesign's top-bar link: both lead to provider sign-in.
    expect(screen.getAllByRole('link', { name: 'Sign in' }).map(link => link.getAttribute('href'))).toEqual(['/provider/sign-in', '/provider/sign-in'])
    expect(screen.queryByLabelText(/email/i)).toBeNull()
    expect(calls).toEqual([])
  })
})
