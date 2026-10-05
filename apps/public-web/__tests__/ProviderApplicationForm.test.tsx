import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderApplicationForm } from '@/components/provider/ProviderApplicationForm'
import { submitOrganizationApplication } from '@/lib/provider-application'

vi.mock('@/lib/env', () => ({
  getEnvironment: () => ({ name: 'local', appOrigin: 'http://localhost:3100',
    apiBaseUrl: 'http://localhost:3100', turnstileSiteKey: null }),
}))
vi.mock('@/lib/provider-application', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(),
  submitOrganizationApplication: vi.fn(),
}))

const submit = vi.mocked(submitOrganizationApplication)

beforeEach(() => {
  submit.mockReset()
  submit.mockResolvedValue(undefined)
})

describe('ProviderApplicationForm', () => {
  it('keeps the laboratory context from the CTA through to the existing application contract', async () => {
    render(<ProviderApplicationForm product="laboratory" />)
    expect((screen.getByRole('combobox', { name: 'Facility or service type' }) as HTMLSelectElement).value)
      .toBe('laboratory')
    expect((screen.getByRole('combobox', { name: 'Product of interest' }) as HTMLSelectElement).value)
      .toBe('laboratory')

    fireEvent.change(screen.getByRole('textbox', { name: /CAC registration identifier/i }),
      { target: { value: 'rc 123456' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Administrator full name' }),
      { target: { value: 'Ada Example' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Administrator email' }),
      { target: { value: 'ada@example.org' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit application' }))

    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      productCode: 'laboratory', organizationType: 'laboratory',
      cacRegistrationNumber: 'RC123456', administratorName: 'Ada Example',
      administratorEmail: 'ada@example.org', turnstileAction: 'organization-application',
      turnstileToken: 'local-turnstile-disabled',
    })))
    expect((await screen.findByRole('status')).textContent).toContain('Application received')
    expect(screen.getByRole('link', { name: 'Complete missing organization details' }).getAttribute('href'))
      .toBe('/provider/complete?product=laboratory')
  })

  it('limits a pharmacy facility to the existing pharmacy product choice', () => {
    render(<ProviderApplicationForm product="pharmacy" />)
    const product = screen.getByRole('combobox', { name: 'Product of interest' }) as HTMLSelectElement
    expect(product.value).toBe('pharmacy')
    expect([...product.options].map(option => option.value)).toEqual(['pharmacy'])
  })

  it('keeps a selected laboratory product when the facility changes to a clinic', () => {
    render(<ProviderApplicationForm product="laboratory" />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Facility or service type' }),
      { target: { value: 'clinic' } })
    expect((screen.getByRole('combobox', { name: 'Product of interest' }) as HTMLSelectElement).value)
      .toBe('laboratory')
  })
})
