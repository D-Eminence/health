import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import { DEMO_HOSPITAL, DEMO_LABORATORY, LAB_WORK, REQUESTS, SESSION, facility, homeHeading, json, openStaffApp, serve, sessionAt, where } from './blueHarness'

/**
 * The bell counts the access requests from landing, as today's Overview did on opening (staff/routes/Dashboard.tsx:
 * 251-257): the frame reads them once when it opens, on whatever page that is, and Home landing at the same time shares
 * that one read. A role without identity.consent.write reads none. Every account here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const many = <T,>(answer: T, count = 8): T[] => Array.from({ length: count }, () => answer)
const WAITING = [{ accessRequestId: 'r1', status: 'pending' }, { accessRequestId: 'r2', status: 'pending' }, { accessRequestId: 'r3', status: 'approved' }]
const reads = (sent: ReturnType<typeof serve>) => sent.filter(call => call.route === REQUESTS).length

describe('the bell on landing', () => {
  it('counts the waiting requests on a product site\'s own page, without opening the drawer', async () => {
    vi.stubGlobal('location', { ...window.location, hostname: 'lab.healthidentitydirectory.com' })
    const lab = facility(DEMO_LABORATORY, 'Demo Laboratory', ['identity.consent.write', 'lab.work-item.read'], ['lab'])
    const sent = serve({ [SESSION]: many(sessionAt(lab, [lab])), [REQUESTS]: many(() => json(WAITING)), [LAB_WORK]: many(() => json({ items: [] })) })
    await openStaffApp('/provider/laboratory')
    expect(await screen.findByRole('button', { name: 'Notifications, 2 waiting' })).toBeDefined()
    expect(where()).not.toBe('/provider')
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull()
    expect(reads(sent)).toBe(1)
  })

  it('reads nothing for a role that may not answer requests, even when the bell is opened', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.patient.read'])
    const sent = serve({ [SESSION]: many(sessionAt(demo, [demo])), [REQUESTS]: many(() => json(WAITING)) })
    await openStaffApp('/provider/whats-left')
    fireEvent.click(await screen.findByRole('button', { name: 'Notifications' }))
    expect(await screen.findByRole('dialog', { name: 'Notifications' })).toBeDefined()
    expect(reads(sent)).toBe(0)
  })

  it('reads them once when landing on Home, shared by Home and the bell', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'])
    const sent = serve({ [SESSION]: many(sessionAt(demo, [demo])), [REQUESTS]: many(() => json(WAITING)) })
    await openStaffApp('/provider')
    expect(await screen.findByRole('heading', { level: 1, name: homeHeading() })).toBeDefined()
    expect(await screen.findByRole('button', { name: 'Notifications, 2 waiting' })).toBeDefined()
    expect(await screen.findByRole('link', { name: /^2 access requests waiting/ })).toBeDefined()
    // Anything Home or the frame would still ask has had its turn.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(reads(sent)).toBe(1)
  })
})
