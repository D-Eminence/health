import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import type { AdminActor, CommercialPrice, CommercialProduct, PricingCatalog } from '../api'
import { PricingPage } from '../Pages'
import { StepUpProvider } from '../StepUp'
import { ToastProvider } from '../../kasuwa/toast'

/**
 * The pricing catalogue drives the prices the public website shows. hid-system
 * POST /admin/pricing/products/:slug and .../prices/:context each need If-Match,
 * an Idempotency-Key, a reason and step-up (platform.pricing.product and
 * platform.pricing.price); a quote price has no amount (PricePricingCommandDto).
 */
const mocks = vi.hoisted(() => ({ api: { pricing: vi.fn(), command: vi.fn(), stepUp: vi.fn() }, keys: 0 }))
vi.mock('../api', () => ({ adminApi: mocks.api, newIdempotencyKey: () => `key-${++mocks.keys}` }))

const product = (overrides: Partial<CommercialProduct> = {}): CommercialProduct => ({ slug: 'ehr', name: 'Health ID EHR',
  status: 'active', version: 2, ...overrides })
const price = (overrides: Partial<CommercialPrice> = {}): CommercialPrice => ({ product_slug: 'ehr', context: 'core',
  visibility: 'contact_sales', amount_minor: null, currency: 'NGN', billing_period: null, unit: null, active: true,
  version: 5, ...overrides })
const catalog = (prices: CommercialPrice[] = [price()], products: CommercialProduct[] = [product()]): PricingCatalog =>
  ({ products, prices })
const actor = (permissions: string[]): AdminActor => ({ accountId: 'admin-1', subject: 'staff:1', displayName: 'Ada',
  email: 'ada@example.test', platformRoles: [], platformPermissions: ['platform.pricing.read', ...permissions] })
const MANAGE = ['platform.pricing.manage']

function open(permissions: string[]) {
  render(<ToastProvider><StepUpProvider><PricingPage actor={actor(permissions)} /></StepUpProvider></ToastProvider>)
}

/** The form inside the disclosure whose summary reads `title`. */
const form = (title: string) => within(screen.getByText(title).closest('details')!)

beforeEach(() => { vi.resetAllMocks(); mocks.keys = 0 })

describe('pricing catalogue', () => {
  it('shows a quote price as available on request, never with a made-up amount', async () => {
    mocks.api.pricing.mockResolvedValueOnce(catalog([price(), price({ context: 'standalone', visibility: 'fixed',
      amount_minor: 1250000, billing_period: 'monthly', unit: 'facility' })]))
    open([])
    expect(await screen.findByText('Amount available on request')).toBeTruthy()
    expect(screen.getByText('1,250,000 minor NGN units · Monthly · facility')).toBeTruthy()
    expect(screen.queryByText('Edit price')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change status' })).toBeNull()
  })

  it('sets a fixed price in whole minor units with its version, one key across step-up, then reloads', async () => {
    mocks.api.pricing.mockResolvedValueOnce(catalog())
      .mockResolvedValueOnce(catalog([price({ visibility: 'fixed', amount_minor: 1250000, version: 6 })]))
    mocks.api.command.mockRejectedValueOnce(new HidApiError(403, 'Step-up required', { code: 'STEP_UP_REQUIRED' }))
      .mockResolvedValueOnce({ version: 6 })
    mocks.api.stepUp.mockResolvedValueOnce({ stepUpExpiresAt: '2026-10-08T12:05:00.000Z' })
    open(MANAGE)
    await screen.findByText('Amount available on request')
    const editor = form('Edit price')
    fireEvent.change(editor.getByLabelText('Visibility'), { target: { value: 'fixed' } })
    fireEvent.change(editor.getByLabelText('Reason for this change'), { target: { value: 'Launch price approved' } })

    // A fraction is refused by the field itself (step 1); an exponent passes the
    // field, so the console refuses anything but plain digits.
    const amount = editor.getByLabelText('Amount in minor NGN units') as HTMLInputElement
    fireEvent.change(amount, { target: { value: '12.5' } })
    expect(amount.validity.valid).toBe(false)
    fireEvent.change(amount, { target: { value: '1e6' } })
    expect(amount.validity.valid).toBe(true)
    fireEvent.click(editor.getByRole('button', { name: 'Save price' }))
    expect((await editor.findByRole('alert')).textContent).toBe('Enter a valid whole number of minor currency units.')
    expect(mocks.api.command).not.toHaveBeenCalled()

    fireEvent.change(editor.getByLabelText('Amount in minor NGN units'), { target: { value: '1250000' } })
    fireEvent.click(editor.getByRole('button', { name: 'Save price' }))
    fireEvent.change(await screen.findByLabelText('Sign-in code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    expect(await screen.findByText('Pricing saved. Current catalog is being refreshed.')).toBeTruthy()
    await waitFor(() => expect(mocks.api.pricing).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('1,250,000 minor NGN units')).toBeTruthy()

    const command = ['/api/v1/admin/pricing/products/ehr/prices/core', { visibility: 'fixed', amountMinor: 1250000,
      currency: 'NGN', billingPeriod: null, unit: null, active: true, reason: 'Launch price approved' },
      { version: 5, idempotencyKey: 'key-1' }]
    expect(mocks.api.command.mock.calls).toEqual([command, command])
  })

  it('sends no amount for a quote price, whatever amount the price had', async () => {
    mocks.api.pricing.mockResolvedValueOnce(catalog([price({ visibility: 'starting_from', amount_minor: 500000 })]))
      .mockResolvedValueOnce(catalog())
    mocks.api.command.mockResolvedValueOnce({ version: 6 })
    open(MANAGE)
    await screen.findByText('500,000 minor NGN units')
    const editor = form('Edit price')
    fireEvent.change(editor.getByLabelText('Visibility'), { target: { value: 'contact_sales' } })
    expect(editor.queryByLabelText('Amount in minor NGN units')).toBeNull()
    fireEvent.change(editor.getByLabelText('Reason for this change'), { target: { value: 'Moving to sales-led quotes' } })
    fireEvent.click(editor.getByRole('button', { name: 'Save price' }))
    await waitFor(() => expect(mocks.api.command).toHaveBeenCalledWith('/api/v1/admin/pricing/products/ehr/prices/core',
      expect.objectContaining({ visibility: 'contact_sales', amountMinor: null }), { version: 5, idempotencyKey: 'key-1' }))
  })

  it('changes a product status with its name, a reason, its version and one key', async () => {
    mocks.api.pricing.mockResolvedValueOnce(catalog()).mockResolvedValueOnce(catalog([price()], [product({ status: 'coming_soon', version: 3 })]))
    mocks.api.command.mockResolvedValueOnce({ version: 3 })
    open(MANAGE)
    await screen.findByText('Amount available on request')
    fireEvent.click(screen.getByRole('button', { name: 'Change status' }))
    const choices = within(screen.getByRole('dialog')).getByLabelText('Change to') as HTMLSelectElement
    expect([...choices.options].map(option => option.value)).toEqual(['coming_soon', 'draft', 'retired'])
    fireEvent.change(choices, { target: { value: 'coming_soon' } })
    const status = within(screen.getByRole('dialog', { name: 'Change Health ID EHR?' }))
    fireEvent.change(status.getByLabelText('Reason for this change'), { target: { value: 'Pausing new sign-ups' } })
    fireEvent.click(status.getByRole('button', { name: 'Make it coming soon' }))
    expect(await screen.findByText('Health ID EHR is now coming soon.')).toBeTruthy()
    expect(mocks.api.command).toHaveBeenCalledWith('/api/v1/admin/pricing/products/ehr',
      { name: 'Health ID EHR', status: 'coming_soon', reason: 'Pausing new sign-ups' }, { version: 2, idempotencyKey: 'key-1' })
    await waitFor(() => expect(mocks.api.pricing).toHaveBeenCalledTimes(2))
  })

  it('explains a change that would leave the catalogue as it is', async () => {
    mocks.api.pricing.mockResolvedValueOnce(catalog())
    mocks.api.command.mockRejectedValueOnce(new HidApiError(409, 'Pricing unchanged', { code: 'PRICING_UNCHANGED' }))
    open(MANAGE)
    await screen.findByText('Amount available on request')
    const editor = form('Edit price')
    fireEvent.change(editor.getByLabelText('Reason for this change'), { target: { value: 'Confirming current quote' } })
    fireEvent.click(editor.getByRole('button', { name: 'Save price' }))
    expect((await editor.findByRole('alert')).textContent).toBe('Nothing changed: the catalog already has these values.')
    expect(screen.queryByText('Pricing saved. Current catalog is being refreshed.')).toBeNull()
    expect(mocks.api.pricing).toHaveBeenCalledTimes(1)
  })
})
