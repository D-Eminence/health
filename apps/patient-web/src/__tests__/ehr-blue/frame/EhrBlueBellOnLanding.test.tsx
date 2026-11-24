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

  it('reads nothing when Demo Hospital is opened on the Lab site, where the frame opens no page', async () => {
    vi.stubGlobal('location', { ...window.location, hostname: 'lab.healthidentitydirectory.com' })
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write', 'lab.work-item.read'], ['ehr', 'lab'])
    const sent = serve({ [SESSION]: many(sessionAt(demo, [demo])), [REQUESTS]: many(() => json(WAITING)), [LAB_WORK]: many(() => json({ items: [] })) })
    await openStaffApp('/provider')
    expect(await screen.findByRole('heading', { level: 1, name: /^Demo Hospital works on / })).toBeDefined()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(reads(sent)).toBe(0)
  })

  it('reads them once when landing on Home, shared by Home and the bell', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'])
    const sent = serve({ [SESSION]: many(sessionAt(demo, [demo])), [REQUESTS]: many(() => json(WAITING)) })
    await openStaffApp('/provider')
    expect(await screen.findByRole('heading', { level: 1, name: homeHeading() })).toBeDefined()
    expect(await screen.findByRole('button', { name: 'Notifications, 2 waiting' })).toBeDefined()
    expect(await screen.findByText('2 pending requests')).toBeDefined()
    // Anything Home or the frame would still ask has had its turn.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    expect(reads(sent)).toBe(1)
  })
})

describe('the bell after a facility switch', () => {
  async function setUp() {
    const { render, screen: view, waitFor } = await import('@testing-library/react')
    const { useEffect } = await import('react')
    const { staffApi } = await import('../../../staff/api')
    const { AttentionProvider, useAccessRequests, useReloadAccessRequests } = await import('../../../ehr-blue/frame/attention')
    const list = vi.spyOn(staffApi, 'listAccessRequests').mockResolvedValue(WAITING as never)
    function Count() {
      const read = useAccessRequests()
      return <output>{read.state === 'ready' ? `${read.pending} waiting` : read.state}</output>
    }
    /** What Home does on opening: asks for the requests to be read. */
    function AsksOnOpening() {
      const reload = useReloadAccessRequests()
      useEffect(() => { reload() }, [reload])
      return null
    }
    const at = (facilityId: string, permissions: string[], home = false) =>
      <AttentionProvider facilityId={facilityId} permissions={permissions}>{home ? <AsksOnOpening /> : null}<Count /></AttentionProvider>
    return { render, view, waitFor, list, at }
  }

  it('reads again on coming back to a facility, after one where Home asked and nothing could be read', async () => {
    const { render, view, waitFor, list, at } = await setUp()
    const { rerender } = render(at('facility-a', ['identity.consent.write']))
    await waitFor(() => expect(view.getByText('2 waiting')).toBeDefined())
    expect(list).toHaveBeenCalledTimes(1)
    // Facility B: no identity.consent.write. Home opens there and asks, but nothing is read.
    rerender(at('facility-b', [], true))
    await waitFor(() => expect(view.getByText('none')).toBeDefined())
    expect(list).toHaveBeenCalledTimes(1)
    // Back at facility A, on a product page (no Home): read once more, so the bell counts.
    rerender(at('facility-a', ['identity.consent.write']))
    await waitFor(() => expect(view.getByText('2 waiting')).toBeDefined())
    expect(list).toHaveBeenCalledTimes(2)
    expect(list).toHaveBeenLastCalledWith('facility-a')
  })

  it('reads once on coming back to a facility when nothing was asked in between', async () => {
    const { render, view, waitFor, list, at } = await setUp()
    const { rerender } = render(at('facility-a', ['identity.consent.write']))
    await waitFor(() => expect(view.getByText('2 waiting')).toBeDefined())
    rerender(at('facility-b', []))
    await waitFor(() => expect(view.getByText('none')).toBeDefined())
    rerender(at('facility-a', ['identity.consent.write']))
    await waitFor(() => expect(view.getByText('2 waiting')).toBeDefined())
    expect(list).toHaveBeenCalledTimes(2)
  })
})
