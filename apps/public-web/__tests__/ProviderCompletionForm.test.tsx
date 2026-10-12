import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { ProviderCompletionForm } from '@/app/provider/complete/ProviderCompletionForm'
import {
  getOrganizationCompletionProfile, saveOrganizationCompletionProfile,
  startOrganizationCompletion, verifyOrganizationCompletion,
  type OrganizationCompletionProfile,
} from '@/lib/provider-application'

vi.mock('@/lib/env', () => ({
  getEnvironment: () => ({ name: 'local', appOrigin: 'http://localhost:3100',
    apiBaseUrl: 'http://localhost:3100', turnstileSiteKey: null }),
}))
vi.mock('@/lib/provider-application', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  getOrganizationCompletionProfile: vi.fn(),
  saveOrganizationCompletionProfile: vi.fn(),
  startOrganizationCompletion: vi.fn(),
  verifyOrganizationCompletion: vi.fn(),
}))

const getProfile = vi.mocked(getOrganizationCompletionProfile)
const saveProfile = vi.mocked(saveOrganizationCompletionProfile)
const start = vi.mocked(startOrganizationCompletion)
const verify = vi.mocked(verifyOrganizationCompletion)

const profile: OrganizationCompletionProfile = {
  status: 'pending_verification', profileState: 'incomplete', version: 4,
  productCode: 'laboratory', registrationNumber: 'RC123456', fields: {
    companyName: { value: 'Verified Laboratory', source: 'qoreid' },
    entityType: { value: null, source: null },
    registrationDate: { value: null, source: null },
    address: { value: null, source: null },
    registryStatus: { value: null, source: null },
  },
}

beforeEach(() => {
  getProfile.mockReset().mockRejectedValueOnce(new Error('No completion session'))
    .mockResolvedValueOnce(profile)
  start.mockReset().mockResolvedValue({ accepted: true, challengeId: 'challenge-1',
    expiresInSeconds: 600, resendAfterSeconds: 60 })
  verify.mockReset().mockResolvedValue(undefined)
  saveProfile.mockReset().mockResolvedValue({ ...profile, status: 'ready_for_review', profileState: 'complete' })
})

describe('ProviderCompletionForm', () => {
  it('keeps the laboratory product through email verification and locks registry supplied fields', async () => {
    render(<ProviderCompletionForm initialProduct="laboratory" />)
    expect((screen.getByRole('combobox', { name: 'Product' }) as HTMLSelectElement).value).toBe('laboratory')

    fireEvent.change(screen.getByRole('textbox', { name: 'CAC registration identifier' }),
      { target: { value: 'rc 123456' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Administrator email' }),
      { target: { value: 'admin@example.org' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send email code' }))
    await waitFor(() => expect(start).toHaveBeenCalledWith({
      productCode: 'laboratory', cacRegistrationNumber: 'RC123456',
      administratorEmail: 'admin@example.org', turnstileToken: 'local-turnstile-disabled',
    }))

    fireEvent.change(screen.getByRole('textbox', { name: 'Email code' }),
      { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(verify).toHaveBeenCalledWith('challenge-1', '123456'))

    const verifiedName = await screen.findByRole('textbox', { name: 'Registered organization name' }) as HTMLInputElement
    expect(verifiedName.readOnly).toBe(true)
    expect(verifiedName.value).toBe('Verified Laboratory')
    fireEvent.change(screen.getByRole('textbox', { name: 'Legal entity type' }),
      { target: { value: 'Limited company' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save missing details' }))
    await waitFor(() => expect(saveProfile).toHaveBeenCalledWith(profile, { entityType: 'Limited company' }))
    expect(await screen.findByText('Your facility profile is complete and awaiting Health ID review.')).toBeDefined()
  })

  it('asks for the minimum each profile field needs before saving anything', async () => {
    getProfile.mockReset().mockResolvedValue(profile)
    render(<ProviderCompletionForm initialProduct="laboratory" />)
    const address = await screen.findByRole('textbox', { name: 'Registered address' })
    fireEvent.change(address, { target: { value: ' abc ' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Legal entity type' }), { target: { value: 'X' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save missing details' }))

    expect(await screen.findByText('Enter the registered address in 5 to 1,000 characters.')).toBeDefined()
    expect(screen.getByText('Enter the legal entity type in 2 to 120 characters.')).toBeDefined()
    expect(address.getAttribute('aria-invalid')).toBe('true')
    expect(address.getAttribute('aria-describedby')).toBe('completion-address-error')
    expect(screen.getByRole('alert').textContent).toBe('Check the details marked below.')
    expect(saveProfile).not.toHaveBeenCalled()
  })

  it('shows the reason the backend gave for refusing the details', async () => {
    getProfile.mockReset().mockResolvedValue(profile)
    saveProfile.mockReset().mockRejectedValueOnce(new HidApiError(409, 'Application changed; reload before retrying',
      { code: 'VERSION_CONFLICT' }))
    render(<ProviderCompletionForm initialProduct="laboratory" />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Registered address' }),
      { target: { value: '12 Marina Road, Lagos' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save missing details' }))

    expect((await screen.findByRole('alert')).textContent).toBe('Application changed; reload before retrying')
  })

  it('shows a refused email code as the backend words it', async () => {
    verify.mockReset().mockRejectedValueOnce(new HidApiError(401, 'The confirmation code is invalid or expired',
      { code: 'ORGANIZATION_COMPLETION_CODE_INVALID' }))
    render(<ProviderCompletionForm initialProduct="laboratory" />)
    fireEvent.change(screen.getByRole('textbox', { name: 'CAC registration identifier' }), { target: { value: 'RC123456' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Administrator email' }), { target: { value: 'admin@example.org' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send email code' }))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Email code' }), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect((await screen.findByRole('alert')).textContent).toBe('The confirmation code is invalid or expired')
  })

  it('keeps its own wording for a service failure, whose detail the backend withholds', async () => {
    getProfile.mockReset().mockResolvedValue(profile)
    saveProfile.mockReset().mockRejectedValueOnce(new HidApiError(503, 'The service could not complete the request.',
      { code: 'ORGANIZATION_COMPLETION_UNAVAILABLE' }))
    render(<ProviderCompletionForm initialProduct="laboratory" />)
    fireEvent.change(await screen.findByRole('textbox', { name: 'Registered address' }),
      { target: { value: '12 Marina Road, Lagos' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save missing details' }))

    expect((await screen.findByRole('alert')).textContent).toBe('The profile could not be saved. Reload your profile and try again.')
  })
})
