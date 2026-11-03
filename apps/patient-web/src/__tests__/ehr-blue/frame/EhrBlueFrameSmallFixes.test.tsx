import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import {
  DEMO_HOSPITAL, DEMO_LABORATORY, LAB_WORK, REQUESTS, SESSION, facility, homeHeading, json, openStaffApp, serve, sessionAt, where, withFramePages,
} from './blueHarness'

/**
 * Small frame fixes on a single product's site: the tab names the product, the frame's no-permission notice survives the
 * product's own redirect, and a self-signed-up lab sees its Facility check on its own first page. Every account and
 * facility here is fictional, and the hosts are only set as the page's address: nothing is sent there.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
const jsdom = (globalThis as unknown as { jsdom: { reconfigure(options: { url: string }): void } }).jsdom
const servedFrom = window.location.href
// vi.resetModules does not drop withFramePages' vi.doMock: the doUnmock keeps the real registry for the next case.
afterEach(() => {
  jsdom.reconfigure({ url: servedFrom }); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.doUnmock('../../../ehr-blue/routes'); vi.resetModules()
})

const LAB_HOST = 'lab.healthidentitydirectory.com'
const many = <T,>(answer: T, count = 8): T[] => Array.from({ length: count }, () => answer)

async function openLab(path: string, permissions: readonly string[], extra: Partial<ReturnType<typeof facility>> = {}) {
  jsdom.reconfigure({ url: `https://${LAB_HOST}${path}` })
  const lab = { ...facility(DEMO_LABORATORY, 'Demo Laboratory', permissions), ...extra } as ReturnType<typeof facility>
  const other = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
  serve({ [SESSION]: [sessionAt(lab, [lab, other])], [LAB_WORK]: many(() => json({ items: [] })), [REQUESTS]: many(() => json([])) })
  await openStaffApp(path)
  await screen.findByRole('navigation', { name: 'Main navigation' })
}

describe('the browser tab on a product site', () => {
  it('names Choose workspace with the product, not the EHR', async () => {
    await openLab('/provider/institutions', ['lab.work-item.read'])
    expect(await screen.findByRole('heading', { level: 1, name: 'Switch facility' })).toBeDefined()
    await waitFor(() => expect(document.title).toBe('Choose workspace · Health ID Lab'))
  })

  it('names a clinical page with the product, not the EHR', async () => {
    await openLab('/provider/patients', ['lab.work-item.read', 'identity.patient.read'])
    await screen.findByRole('heading', { name: 'Find a patient' }, { timeout: 25000 })
    await waitFor(() => expect(document.title).toBe('Patients · Health ID Lab'))
  })
})

describe('a page opened without permission on a product site', () => {
  it('keeps the frame\'s notice on the product\'s own first page', async () => {
    // The frame's own registry: its Access requests reads before refusing, so the frame sends Home with its notice. The
    // lab's Home is its queue.
    withFramePages()
    await openLab('/provider/requests', ['lab.work-item.read'])
    await waitFor(() => expect(where()).toBe('/provider/laboratory'))
    expect(await screen.findByText('Your current permissions no longer allow that page. Choose an authorized workflow.')).toBeDefined()
  })
})

describe('the Facility check on a product site', () => {
  it('shows above the lab\'s own first page, which opens in place of Home', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    await openLab('/provider', ['lab.work-item.read'], { selfService: { review: 'reviewed', organizationType: 'laboratory' } } as never)
    await waitFor(() => expect(where()).toBe('/provider/laboratory'))
    expect(await screen.findByRole('heading', { name: 'Facility check' })).toBeDefined()
    expect(screen.getByText('Done')).toBeDefined()
    expect(screen.getByText(/Health ID support has checked Demo Laboratory/)).toBeDefined()
  })

  it('is shown once on Home', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    const pending = { ...facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write']), selfService: { review: 'pending', organizationType: 'clinic' } }
    serve({ [SESSION]: [sessionAt(pending as ReturnType<typeof facility>, [pending as ReturnType<typeof facility>])], [REQUESTS]: many(() => json([])) })
    await openStaffApp('/provider')
    await screen.findByRole('heading', { level: 1, name: homeHeading() })
    expect(await screen.findAllByRole('heading', { name: 'Facility check' })).toHaveLength(1)
  })

  it('is shown once on a product site whose Home opens (its own first page is not open to this person)', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    await openLab('/provider', ['identity.consent.write'], { selfService: { review: 'pending', organizationType: 'laboratory' } } as never)
    await screen.findByRole('heading', { level: 1, name: homeHeading() })
    expect(where()).toBe('/provider')
    expect(await screen.findAllByRole('heading', { name: 'Facility check' })).toHaveLength(1)
  })
})
