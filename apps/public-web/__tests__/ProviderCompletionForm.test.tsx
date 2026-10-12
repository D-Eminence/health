import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
    // The Field's hint says where the value came from (PEHR-14).
    expect(document.getElementById(verifiedName.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Provided by the registry')
    fireEvent.change(screen.getByRole('textbox', { name: 'Legal entity type' }),
      { target: { value: 'Limited company' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save missing details' }))
    await waitFor(() => expect(saveProfile).toHaveBeenCalledWith(profile, { entityType: 'Limited company' }))
    expect(await screen.findByText('Your facility profile is complete and awaiting Health ID review.')).toBeDefined()
  })
})
