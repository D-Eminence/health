import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { Billing, BillingBanner } from '../Billing'

/** Plan & billing and the workspace banner (docs/BILLING_SPEC.md). */
const mocks = vi.hoisted(() => ({
  billing: { subscription: vi.fn(), startTrial: vi.fn(), checkout: vi.fn(), invoices: vi.fn(), pricing: vi.fn() },
  useStaff: vi.fn(),
}))
vi.mock('../../api', () => ({ billingApi: mocks.billing }))
vi.mock('../../App', () => ({ useStaff: mocks.useStaff }))

const DAY = 86_400_000
const ADMIN = ['billing.subscription.read', 'billing.subscription.manage']
const PRICE = { visibility: 'fixed', amount_minor: 2_500_000, currency: 'NGN', billing_period: 'month', unit: null }
const plan = (overrides: Record<string, unknown>) => ({
  organizationId: 'org-1', productCode: 'ehr', status: 'none', trialEndsAt: null, currentPeriodEndsAt: null,
  graceEndsAt: null, price: PRICE, selfServePayment: true, version: 'v1', ...overrides,
})
const NOT_SERVED = () => new HidApiError(404, 'Not found.', { code: 'NOT_FOUND' })
const assign = vi.fn()

function session(permissions: string[]) {
  return { state: { status: 'ready', session: { actor: { facility: { id: 'facility-1', name: 'Example Clinic', permissions } } } } }
}

function open(element: React.ReactElement, path = '/provider/billing') {
  return render(<MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('location', { ...window.location, assign })
  mocks.useStaff.mockReturnValue(session(ADMIN))
  mocks.billing.invoices.mockResolvedValue({ items: [] })
})
afterEach(() => vi.unstubAllGlobals())

describe('Plan & billing', () => {
  it('says billing is not available yet while hid-system does not serve it', async () => {
    mocks.billing.subscription.mockRejectedValue(NOT_SERVED())
    mocks.billing.invoices.mockRejectedValue(NOT_SERVED())
    open(<Billing />)
    expect(await screen.findByRole('heading', { name: "Billing isn't available yet" })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Pay now' })).toBeNull()
  })

  it('needs the billing permission, and asks for nothing without it', () => {
    mocks.useStaff.mockReturnValue(session(['audit.read']))
    open(<Billing />)
    expect(screen.getByRole('heading', { name: 'Billing access unavailable' })).toBeTruthy()
    expect(mocks.billing.subscription).not.toHaveBeenCalled()
  })

  it('shows the days left in a trial, the price, and pays through Paystack only', async () => {
    mocks.billing.subscription.mockResolvedValue(plan({ status: 'trialing', trialEndsAt: new Date(Date.now() + 5 * DAY - 1000).toISOString() }))
    mocks.billing.checkout.mockResolvedValue({ authorizationUrl: 'https://checkout.paystack.com/xyz', reference: 'r1' })
    open(<Billing />)
    expect(await screen.findByText('Free trial')).toBeTruthy()
    expect(screen.getByText(/^5 days left/)).toBeTruthy()
    expect(screen.getByText(/25,000\.00 per month/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Pay now' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.paystack.com/xyz'))
  })

  it('starts the free trial from the page', async () => {
    mocks.billing.subscription.mockResolvedValue(plan({}))
    mocks.billing.startTrial.mockResolvedValue(plan({ status: 'trialing', trialEndsAt: new Date(Date.now() + 14 * DAY).toISOString() }))
    open(<Billing />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start 14-day free trial' }))
    expect(await screen.findByText('Free trial')).toBeTruthy()
    expect(mocks.billing.startTrial).toHaveBeenCalledWith('facility-1')
  })

  it('lets a member without manage permission see the plan but not pay', async () => {
    mocks.useStaff.mockReturnValue(session(['billing.subscription.read']))
    mocks.billing.subscription.mockResolvedValue(plan({ status: 'read_only' }))
    open(<Billing />)
    expect(await screen.findByText('Read-only')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Pay now' })).toBeNull()
    expect(screen.getByText('Only your facility administrator can start a trial or pay.')).toBeTruthy()
  })

  it('reads the plan again after the return from Paystack, and trusts only the server', async () => {
    mocks.billing.subscription.mockResolvedValueOnce(plan({ status: 'trialing', trialEndsAt: new Date(Date.now() + 3 * DAY).toISOString() }))
    mocks.billing.subscription.mockResolvedValueOnce(plan({ status: 'active', currentPeriodEndsAt: '2026-11-30T00:00:00Z' }))
    open(<Billing />, '/provider/billing?reference=abc')
    expect(await screen.findByText(/have not confirmed your payment yet/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByText('Payment received. Thank you.')).toBeTruthy()
  })

  it('lists invoices', async () => {
    mocks.billing.subscription.mockResolvedValue(plan({ status: 'active', currentPeriodEndsAt: '2026-11-30T00:00:00Z' }))
    mocks.billing.invoices.mockResolvedValue({ items: [
      { id: 'i1', number: 'HID-2026-000123', issuedAt: '2026-10-30T00:00:00Z', amount_minor: 2_500_000, currency: 'NGN', status: 'paid' },
    ] })
    open(<Billing />)
    expect(await screen.findByText('HID-2026-000123')).toBeTruthy()
    expect(screen.getByText('Paid')).toBeTruthy()
  })
})

describe('billing banner', () => {
  it('appears in the last days of a trial', async () => {
    mocks.billing.subscription.mockResolvedValue(plan({ status: 'trialing', trialEndsAt: new Date(Date.now() + 3 * DAY - 1000).toISOString() }))
    open(<BillingBanner />, '/provider')
    expect(await screen.findByText('Your free trial ends in 3 days.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Choose a plan' }).getAttribute('href')).toBe('/provider/billing')
  })

  it('stays away early in a trial, while billing is not available, and without permission', async () => {
    mocks.billing.subscription.mockResolvedValueOnce(plan({ status: 'trialing', trialEndsAt: new Date(Date.now() + 12 * DAY).toISOString() }))
    const early = open(<BillingBanner />, '/provider')
    await waitFor(() => expect(mocks.billing.subscription).toHaveBeenCalledTimes(1))
    expect(early.container.textContent).toBe('')
    early.unmount()

    mocks.billing.subscription.mockRejectedValueOnce(NOT_SERVED())
    const unserved = open(<BillingBanner />, '/provider')
    await waitFor(() => expect(mocks.billing.subscription).toHaveBeenCalledTimes(2))
    expect(unserved.container.textContent).toBe('')
    unserved.unmount()

    mocks.useStaff.mockReturnValue(session(['audit.read']))
    open(<BillingBanner />, '/provider')
    expect(mocks.billing.subscription).toHaveBeenCalledTimes(2)
  })

  it('warns a read-only facility', async () => {
    mocks.billing.subscription.mockResolvedValue(plan({ status: 'read_only' }))
    open(<BillingBanner />, '/provider')
    expect(await screen.findByText(/Your facility is read-only/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Pay now' })).toBeTruthy()
  })
})

describe('billing banner after sign-up', () => {
  it('invites the administrator of a facility with no plan to start the free trial', async () => {
    mocks.billing.subscription.mockResolvedValue(plan({}))
    open(<BillingBanner />, '/provider')
    expect(await screen.findByText('Your facility has no plan yet. Start your 14-day free trial. No card is needed.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Choose how to start' }).getAttribute('href')).toBe('/provider/billing')
  })

  it('does not ask staff who cannot manage the plan', async () => {
    mocks.useStaff.mockReturnValue(session(['billing.subscription.read']))
    mocks.billing.subscription.mockResolvedValue(plan({}))
    const view = open(<BillingBanner />, '/provider')
    await waitFor(() => expect(mocks.billing.subscription).toHaveBeenCalledTimes(1))
    expect(view.container.textContent).toBe('')
  })
})
