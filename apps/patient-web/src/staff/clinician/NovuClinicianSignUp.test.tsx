import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

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

const show = (element: JSX.Element) => render(<MemoryRouter>{element}</MemoryRouter>)

describe('clinician sign-up on Novu', () => {
  it('says sign-up is not open on the provider pages and links no application', async () => {
    const { ClinicianSignUpEntry } = await import('./ClinicianSignUpEntry')
    show(<ClinicianSignUpEntry className="entry" />)
    expect(await screen.findByText("Clinician sign-up isn't open yet.")).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
    expect(calls).toEqual([])
  })

  it('opens the sign-up page as not open, with only the way to sign in', async () => {
    const { ClinicianSignUp } = await import('../routes/ClinicianSignUp')
    show(<ClinicianSignUp />)
    expect(await screen.findByRole('heading', { level: 1, name: "Clinician sign-up isn't open yet" })).toBeTruthy()
    expect(screen.getAllByRole('link').map(link => link.textContent)).not.toContain('Check an application')
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/provider/sign-in')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(calls).toEqual([])
  })

  it('opens the status page as having no application to check', async () => {
    const { ClinicianApplicationStatus } = await import('../routes/ClinicianApplicationStatus')
    show(<ClinicianApplicationStatus />)
    expect(screen.getByRole('heading', { level: 1, name: "Clinician sign-up isn't open yet" })).toBeTruthy()
    expect(screen.getByText(/there is no application to check/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/provider/sign-in')
    expect(screen.queryByLabelText(/email/i)).toBeNull()
    expect(calls).toEqual([])
  })
})
