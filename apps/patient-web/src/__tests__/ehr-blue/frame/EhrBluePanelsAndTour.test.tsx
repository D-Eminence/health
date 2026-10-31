import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { JOURNEYS } from '../../../ehr-blue/frame/tour/journeys'
import { DEMO_HOSPITAL, REQUESTS, SESSION, facility, json, openStaffApp, serve, sessionAt, where, withFramePages } from './blueHarness'

vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
// These test the frame's own panels and stand-ins, whichever other folders' pages have joined.
beforeEach(() => { withFramePages() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const SAMPLE_NOTICE = 'Sample only: not connected to Health ID yet. Nothing you do here is saved.'

async function openDemo(path: string, roles?: readonly string[]) {
  const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'], roles)
  const sent = serve({ [SESSION]: [sessionAt(demo, [demo])], [REQUESTS]: [() => json([])] })
  await openStaffApp(path)
  await screen.findByRole('navigation', { name: 'Main navigation' })
  return sent
}

describe('the Design tour', () => {
  it('lists the five journeys as sample pages, each a page of its own', async () => {
    expect(JOURNEYS.map(journey => journey.id)).toEqual(['register-and-launch', 'sign-in', 'forgot-password', 'staff-invitation', 'subscription'])
    await openDemo('/provider/tour')
    // Imported once the app runs, so it shares the app's modules.
    const { BLUE_PAGES } = await import('../../../ehr-blue/routes')
    for (const journey of JOURNEYS) {
      expect(BLUE_PAGES.find(page => page.path === `tour/${journey.id}/*`)?.status).toBe('sample')
    }
    expect(screen.getByRole('heading', { level: 1, name: 'Design tour' })).toBeDefined()
    expect(screen.getByText(SAMPLE_NOTICE)).toBeDefined()
    expect(screen.getAllByRole('link', { name: /^Start: / })).toHaveLength(5)
  })

  it('steps through a journey with Back and Next, validates its forms, and asks for no password', async () => {
    const sent = await openDemo('/provider/tour/forgot-password')
    const before = sent.length
    expect(screen.getByText('Screen 1 of 5')).toBeDefined()
    expect(screen.getByRole('link', { name: '1. Forgot password: enter email or phone' }).getAttribute('aria-current')).toBe('step')
    fireEvent.click(screen.getByRole('button', { name: 'Send recovery code' }))
    expect(screen.getByText('Enter email or phone.')).toBeDefined()
    fireEvent.change(screen.getByRole('textbox', { name: 'Email or phone' }), { target: { value: 'sample@example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send recovery code' }))
    await waitFor(() => expect(where()).toBe('/provider/tour/forgot-password/2'))
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Check your recovery channel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(where()).toBe('/provider/tour/forgot-password/1'))
    expect(document.querySelector('input[type="password"]')).toBeNull()
    expect(sent.length).toBe(before)
  })
})

describe('the frame\'s sample panels', () => {
  it('shows the sample status chip only on sample pages, saying it is a sample', async () => {
    await openDemo('/provider/whats-left')
    expect(screen.queryByRole('button', { name: /Needs attention/ })).toBeNull()
    act(() => { fireEvent.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', { name: 'Radiology' })) })
    expect(await screen.findByRole('button', { name: 'Sample · Needs attention · 4 pending' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Sample · Needs attention · 4 pending' }).textContent).toBe('Sample · Needs attention · 4 pending')
  })

  it('opens the connection popover from the status chip, and the sync details from it', async () => {
    await openDemo('/provider/appointments')
    const chip = screen.getByRole('button', { name: 'Sample · Needs attention · 4 pending' })
    fireEvent.click(chip)
    const popover = screen.getByRole('region', { name: 'Connection and sync status' })
    expect(within(popover).getByText(SAMPLE_NOTICE)).toBeDefined()
    fireEvent.click(within(popover).getByRole('button', { name: 'View sync details' }))
    const drawer = screen.getByRole('dialog', { name: 'Connection and sync details' })
    expect(within(drawer).getAllByRole('heading', { name: 'Review required' })).toHaveLength(4)
  })

  it('lists sample activity in the notifications drawer, each opening its sample record', async () => {
    await openDemo('/provider/whats-left')
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    const drawer = screen.getByRole('dialog', { name: 'Notifications' })
    expect(within(drawer).getByText('Appointments record created')).toBeDefined()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Open Appointments record' }))
    await waitFor(() => expect(where()).toMatch(/^\/provider\/appointments\/[0-9a-f]{8}$/))
  })

  it('lists only the sample activity the role may open: a receptionist\'s is Appointments alone', async () => {
    await openDemo('/provider/whats-left', ['receptionist'])
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
    const drawer = screen.getByRole('dialog', { name: 'Notifications' })
    // The design gives a Receptionist no Quality & Safety, Nursing observations, ICU or Referral Network.
    expect(within(drawer).getAllByRole('button', { name: /^Open .+ record$/ }).map(button => button.getAttribute('aria-label')))
      .toEqual(['Open Appointments record'])
    fireEvent.click(within(drawer).getByRole('button', { name: 'Open Appointments record' }))
    await waitFor(() => expect(where()).toMatch(/^\/provider\/appointments\/[0-9a-f]{8}$/))
  })

  it('opens a sample record\'s quick view from its list', async () => {
    await openDemo('/provider/radiology')
    fireEvent.click(screen.getAllByRole('button', { name: 'Quick view' })[0]!)
    const drawer = screen.getByRole('dialog', { name: 'Record quick view' })
    expect(within(drawer).getByText(SAMPLE_NOTICE)).toBeDefined()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Open full record' }))
    await waitFor(() => expect(where()).toBe('/provider/radiology/5a070001'))
  })
})
