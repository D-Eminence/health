import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { ClinicianSignUpEntry } from './ClinicianSignUpEntry'

/**
 * The way into clinician self sign-up from the provider pages: offered only
 * while Identity says intake is open; otherwise only the status page, with no "not open yet".
 */
const api = vi.hoisted(() => ({ availability: vi.fn() }))
vi.mock('../clinicianApplicationApi', () => ({ clinicianApplicationApi: api }))

beforeEach(() => { vi.resetAllMocks() })
afterEach(() => { vi.unstubAllGlobals() })

function show() {
  render(<MemoryRouter><ClinicianSignUpEntry className="entry" /></MemoryRouter>)
}

describe('the clinician sign-up entry', () => {
  it('offers sign-up while intake is open, with the status page', async () => {
    api.availability.mockResolvedValueOnce({ open: true })
    show()
    expect((await screen.findByRole('link', { name: 'Sign up as a clinician' })).getAttribute('href')).toBe('/provider/join')
    expect(screen.getByRole('link', { name: 'Check your application' }).getAttribute('href')).toBe('/provider/join/status')
    expect(screen.queryByText(/isn't open yet/)).toBeNull()
  })

  it.each([
    ['closed', () => api.availability.mockResolvedValueOnce({ open: false })],
    ['an outage', () => api.availability.mockRejectedValueOnce(new HidApiError(503, 'Unavailable', { code: 'PLATFORM_CONTROL_UNAVAILABLE' }))],
  ])('offers no sign-up when %s, and still links the status page', async (_case, answer) => {
    answer()
    show()
    expect((await screen.findByRole('link', { name: 'Check your application' })).getAttribute('href')).toBe('/provider/join/status')
    expect(screen.queryByRole('link', { name: 'Sign up as a clinician' })).toBeNull()
    expect(screen.queryByText(/open yet/)).toBeNull()
  })

  it('offers nothing until Identity has answered', () => {
    api.availability.mockReturnValueOnce(new Promise(() => undefined))
    show()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByText(/clinician/i)).toBeNull()
  })

  it('links the main site from a staff product host', async () => {
    vi.stubGlobal('location', { ...window.location, hostname: 'pharmacy.healthidentitydirectory.com' })
    api.availability.mockResolvedValueOnce({ open: true })
    show()
    expect((await screen.findByRole('link', { name: 'Sign up as a clinician' })).getAttribute('href'))
      .toBe('https://app.healthidentitydirectory.com/provider/join')
    expect(screen.getByRole('link', { name: 'Check your application' }).getAttribute('href'))
      .toBe('https://app.healthidentitydirectory.com/provider/join/status')
  })
})
