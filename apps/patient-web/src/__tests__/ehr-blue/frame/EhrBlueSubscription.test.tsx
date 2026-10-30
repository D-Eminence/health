import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { DEMO_HOSPITAL, REAL_FACILITY, SESSION, facility, json, openStaffApp, problem, serve, sessionAt } from './blueHarness'

/**
 * Facility subscription (/provider/billing): today's billing page until the clinic switch is on, and the design's
 * page after it, on today's reads, actions and words (staff/routes/Billing.tsx). Every facility here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); vi.resetModules() })

const PLAN = 'GET /api/v1/commercial/subscription'
const INVOICES = 'GET /api/v1/commercial/invoices'
const TRIAL = 'POST /api/v1/commercial/subscription/trial'
const READ = ['billing.subscription.read']
const MANAGE = ['billing.subscription.read', 'billing.subscription.manage']

const plan = (status: string, extra: Record<string, unknown> = {}) => () => json({
  organizationId: 'org-1', productCode: 'ehr', status, trialEndsAt: null, currentPeriodEndsAt: null, graceEndsAt: null,
  price: { visibility: 'fixed', amount_minor: 2500000, currency: 'NGN', billing_period: 'month', unit: null }, selfServePayment: true, ...extra,
})
const invoice = { id: 'inv-1', number: 'HID-0001', issuedAt: '2026-10-01T09:00:00Z', amount_minor: 2500000, currency: 'NGN', status: 'paid' }

describe('with the clinic switch off (as it ships)', () => {
  it('shows today\'s billing page in the frame', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', READ)
    serve({ [SESSION]: [sessionAt(demo, [demo])], [PLAN]: [plan('trialing', { trialEndsAt: '2026-11-13T09:00:00Z' }), plan('trialing',
      { trialEndsAt: '2026-11-13T09:00:00Z' })], [INVOICES]: [() => json({ items: [] })] })
    await openStaffApp('/provider/billing')
    expect(await screen.findByRole('heading', { level: 1, name: 'Plan & billing.' })).toBeDefined()
    expect(document.querySelector('.hid-ehr-blue-live h1')?.textContent).toBe('Plan & billing.')
  })
})

describe('with the clinic switch on', () => {
  beforeEach(() => {
    vi.doMock('../../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: true }))
    vi.useFakeTimers({ now: new Date('2026-10-30T09:00:00Z'), toFake: ['Date'] })
  })
  const riverside = (permissions: readonly string[]) => facility(REAL_FACILITY, 'Riverside Teaching Hospital (fictional)', permissions)

  it('draws the design\'s page in today\'s words: the plan, its detail, the facts and the invoices', async () => {
    const at = riverside(READ)
    const trialing = plan('trialing', { trialEndsAt: '2026-11-13T09:00:00Z' })
    serve({ [SESSION]: [sessionAt(at, [at])], [PLAN]: [trialing, trialing], [INVOICES]: [() => json({ items: [invoice] })] })
    await openStaffApp('/provider/billing')
    expect(await screen.findByRole('heading', { level: 1, name: 'Facility subscription' })).toBeDefined()
    expect(screen.getByText('Separate from patient billing')).toBeDefined()
    expect(screen.getByText('Your facility’s plan, free trial and invoices. Patients are never charged for Health ID.')).toBeDefined()
    const hero = (await screen.findByRole('heading', { level: 2, name: 'Free trial' })).closest('section')!
    expect(within(hero).getByText('Health ID EHR')).toBeDefined()
    expect(within(hero).getByText(/^14 days left\. Your trial ends on /)).toBeDefined()
    const facts = screen.getByRole('heading', { level: 2, name: 'Current plan' }).closest('.hid-ehr-card') as HTMLElement
    expect(within(facts).getByText('Trial ends')).toBeDefined()
    expect(within(facts).getByText('Only your facility administrator can start a trial or pay.')).toBeDefined()
    // The design's cards after Current plan: Renewal reminders, which Health ID does not send yet, and Subscription
    // history, the invoices.
    const reminders = screen.getByRole('heading', { level: 2, name: 'Renewal reminders' }).closest('.hid-ehr-card') as HTMLElement
    expect(within(reminders).getByText('No renewal reminders yet.')).toBeDefined()
    expect(within(reminders).getByText(/does not send renewal reminders by email or text message yet/)).toBeDefined()
    const history = screen.getByRole('heading', { level: 2, name: 'Subscription history' }).closest('.hid-ehr-card') as HTMLElement
    const table = await within(history).findByRole('table', { name: 'Invoices' })
    expect(within(table).getByText('HID-0001')).toBeDefined()
    expect(within(table).getByText('Paid')).toBeDefined()
    expect([...document.querySelectorAll('.hid-ehr-card-title')].map(title => title.textContent))
      .toEqual(['Current plan', 'Renewal reminders', 'Subscription history'])
    // Today's banner stays off its own page.
    expect(screen.queryByRole('link', { name: 'Choose a plan' })).toBeNull()
  })

  it('starts the free trial as today\'s page does', async () => {
    const at = riverside(MANAGE)
    const sent = serve({ [SESSION]: [sessionAt(at, [at])], [PLAN]: [plan('none'), plan('none')], [INVOICES]: [() => json({ items: [] })],
      [TRIAL]: [plan('trialing', { trialEndsAt: '2026-11-13T09:00:00Z' })] })
    await openStaffApp('/provider/billing')
    fireEvent.click(await screen.findByRole('button', { name: 'Start 14-day free trial' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Free trial' })).toBeDefined()
    expect(sent.filter(call => call.route === TRIAL)).toHaveLength(1)
  })

  it('marks a read-only plan as urgent, in today\'s words', async () => {
    const at = riverside(READ)
    serve({ [SESSION]: [sessionAt(at, [at])], [PLAN]: [plan('read_only'), plan('read_only')], [INVOICES]: [() => json({ items: [] })] })
    await openStaffApp('/provider/billing')
    const hero = (await screen.findByRole('heading', { level: 2, name: 'Read-only' })).closest('section')!
    expect(hero.classList.contains('hid-ehr-blue-plan-urgent')).toBe(true)
    expect(within(hero).getByText('Your plan is not paid, so staff can view records but cannot add or change them. Pay to restore full access.'))
      .toBeDefined()
  })

  it('refuses in today\'s words without the permission, and reads no billing', async () => {
    const at = riverside([])
    const sent = serve({ [SESSION]: [sessionAt(at, [at])] })
    await openStaffApp('/provider/billing')
    expect(await screen.findByText('Billing access unavailable')).toBeDefined()
    expect(screen.getByText('Your facility administrator manages the plan and billing for this facility.')).toBeDefined()
    expect(sent.some(call => call.route.startsWith('GET /api/v1/commercial/'))).toBe(false)
  })

  it('says billing is not switched on yet where Health ID does not serve it', async () => {
    const at = riverside(READ)
    serve({ [SESSION]: [sessionAt(at, [at])], [PLAN]: [() => problem(404, 'NOT_FOUND', 'Not found'), () => problem(404, 'NOT_FOUND', 'Not found')],
      [INVOICES]: [() => problem(404, 'NOT_FOUND', 'Not found')] })
    await openStaffApp('/provider/billing')
    expect(await screen.findByText('Billing isn\'t available yet')).toBeDefined()
    await waitFor(() => expect(screen.queryByRole('heading', { level: 2, name: 'Current plan' })).toBeNull())
  })
})
