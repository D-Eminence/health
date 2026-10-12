import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { ProviderEnrollment } from './ProviderEnrollment'

/**
 * The portal's self-service provider enrollment (/provider/enroll), which the
 * public site's /provider/apply links to. hid-system's provider-enrollment
 * routes take the CAC, verify the administrator email and activate the account.
 */
const api = vi.hoisted(() => ({ start: vi.fn(), verify: vi.fn(), activate: vi.fn() }))
vi.mock('../api', () => ({ providerEnrollmentApi: api }))
vi.mock('../../env', () => ({ getEnvironment: () => ({ name: 'local', turnstileSiteKey: null,
  apiBaseUrl: 'https://gateway.example.test', appOrigin: 'http://localhost:3200' }) }))

beforeEach(() => {
  vi.clearAllMocks()
  api.start.mockResolvedValue({ accepted: true, challengeId: 'challenge-1' })
  api.verify.mockResolvedValue({ verified: true })
})
afterEach(() => vi.unstubAllGlobals())

function open() {
  render(<MemoryRouter initialEntries={['/provider/enroll']}><Routes>
    <Route path="/provider/enroll" element={<ProviderEnrollment />} />
    <Route path="/provider" element={<h1>Provider workspace</h1>} />
  </Routes></MemoryRouter>)
}

const select = (name: string) => screen.getByRole('combobox', { name }) as HTMLSelectElement

function enterDetails() {
  fireEvent.change(screen.getByRole('textbox', { name: 'CAC registration number' }), { target: { value: 'rc 123 456' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Administrator full name' }), { target: { value: '  Ada Admin ' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Administrator email' }), { target: { value: ' Ada@Example.TEST ' } })
}

describe('provider enrollment', () => {
  it('offers only the products a facility type may enroll for', () => {
    open()
    expect([...select('Product').options].map(option => option.value)).toEqual(['ehr', 'laboratory', 'pharmacy', 'migrate'])
    fireEvent.change(select('Facility type'), { target: { value: 'laboratory' } })
    expect([...select('Product').options].map(option => option.value)).toEqual(['laboratory'])
    expect(select('Product').value).toBe('laboratory')
    fireEvent.change(select('Facility type'), { target: { value: 'clinic' } })
    expect(select('Product').value).toBe('laboratory')
  })

  it('sends the CAC in capitals with the facility details and the provider-enrollment check', async () => {
    open()
    fireEvent.change(select('Facility type'), { target: { value: 'pharmacy' } })
    enterDetails()
    expect((screen.getByRole('textbox', { name: 'CAC registration number' }) as HTMLInputElement).value).toBe('RC123456')
    fireEvent.click(screen.getByRole('button', { name: 'Verify CAC and continue' }))

    expect(await screen.findByRole('heading', { name: 'Confirm your administrator email' })).toBeTruthy()
    expect(api.start).toHaveBeenCalledWith({ productCode: 'pharmacy', organizationType: 'pharmacy',
      cacRegistrationNumber: 'RC123456', administratorName: 'Ada Admin', administratorEmail: 'ada@example.test',
      turnstileToken: 'local-turnstile-disabled' })
  })

  it('stops at the details and says so when hid-system sends the application to review', async () => {
    api.start.mockRejectedValueOnce(new HidApiError(409, 'This provider application requires manual resolution',
      { code: 'PROVIDER_ENROLLMENT_REQUIRES_REVIEW' }))
    open()
    enterDetails()
    fireEvent.click(screen.getByRole('button', { name: 'Verify CAC and continue' }))

    expect((await screen.findByRole('alert')).textContent).toBe('This provider application requires manual resolution')
    expect(screen.queryByRole('heading', { name: 'Confirm your administrator email' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Verify CAC and continue' })).toBeTruthy()
  })

  it('verifies the six-digit code, then activates with a password of at least 12 characters', async () => {
    const reload = vi.fn()
    // Activation signs the administrator in, so the page reloads into the workspace.
    vi.stubGlobal('location', { ...window.location, hostname: 'localhost', reload })
    api.activate.mockResolvedValueOnce({ activated: true })
    open()
    enterDetails()
    fireEvent.click(screen.getByRole('button', { name: 'Verify CAC and continue' }))

    const code = await screen.findByRole('textbox', { name: 'Email verification code' }) as HTMLInputElement
    fireEvent.change(code, { target: { value: '12a34' } })
    expect(code.value).toBe('1234')
    expect((screen.getByRole('button', { name: 'Verify email' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(code, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }))
    await waitFor(() => expect(api.verify).toHaveBeenCalledWith('challenge-1', '123456'))

    const password = await screen.findByLabelText('Password') as HTMLInputElement
    fireEvent.change(password, { target: { value: 'short-pass' } })
    expect((screen.getByRole('button', { name: 'Create provider account' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(password, { target: { value: 'a-long-enough-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create provider account' }))

    expect(await screen.findByRole('heading', { name: 'Provider workspace' })).toBeTruthy()
    expect(api.activate).toHaveBeenCalledWith('a-long-enough-password')
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
