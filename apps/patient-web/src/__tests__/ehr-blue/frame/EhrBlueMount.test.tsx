import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { isBlueFacility, showsBlueEhr } from '../../../ehr-blue/blueFacilities'
import {
  DEMO_HOSPITAL, LAB_WORK, REAL_FACILITY, REQUESTS, SESSION, facility, json, openStaffApp, serve, sessionAt,
} from './blueHarness'

/**
 * The mount: a session working at one of the four demo facilities opens the blue EHR; every other facility opens
 * today's provider workspace and never loads the blue EHR's module.
 */
const blue = vi.hoisted(() => ({ loads: 0 }))
vi.mock('../../../ehr-blue/EhrBlueApp', async importOriginal => {
  blue.loads += 1
  return importOriginal()
})
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))

beforeEach(() => { blue.loads = 0 })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

describe('blueFacilities', () => {
  it('knows the four demo facilities by id, and nothing else', () => {
    for (const id of ['98d00002-0000-4000-8000-000000000001', '98d00002-0000-4000-8000-000000000002',
      '98d00002-0000-4000-8000-000000000003', '98d00002-0000-4000-8000-000000000004']) expect(isBlueFacility(id)).toBe(true)
    expect(isBlueFacility('98d00002-0000-4000-8000-000000000005')).toBe(false)
    expect(isBlueFacility(REAL_FACILITY)).toBe(false)
    expect(isBlueFacility(undefined)).toBe(false)
  })

  it('opens blue at a demo facility, and asks in blue only when every facility to choose from is a demo one', () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', [])
    const real = facility(REAL_FACILITY, 'Riverside Teaching Hospital (fictional)', [])
    expect(showsBlueEhr({ facility: demo, facilities: [demo, real] }, false)).toBe(true)
    expect(showsBlueEhr({ facility: real, facilities: [demo, real] }, false)).toBe(false)
    expect(showsBlueEhr({ facility: demo, facilities: [demo, real] }, true)).toBe(false)
    expect(showsBlueEhr({ facility: real, facilities: [demo] }, true)).toBe(true)
    expect(showsBlueEhr({ facilities: [] }, true)).toBe(false)
  })
})

describe('the staff app at a real facility', () => {
  it('renders today\'s workspace and never loads the blue EHR', async () => {
    const real = facility(REAL_FACILITY, 'Riverside Teaching Hospital (fictional)', ['identity.consent.write'])
    serve({ [SESSION]: [sessionAt(real, [real])], [REQUESTS]: [() => json([])] })
    await openStaffApp('/provider')
    expect(await screen.findByRole('heading', { level: 1, name: 'Good to see you, Demo.' })).toBeDefined()
    expect(screen.getByRole('complementary', { name: 'Provider navigation' })).toBeDefined()
    expect(document.querySelector('.hid-ehr')).toBeNull()
    expect(blue.loads).toBe(0)
  })
})

describe('the staff app at a demo facility', () => {
  it('opens the blue EHR in place of today\'s workspace', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write', 'lab.work-item.read'])
    serve({ [SESSION]: [sessionAt(demo, [demo])], [REQUESTS]: [() => json([])], [LAB_WORK]: [() => json({ items: [] })] })
    await openStaffApp('/provider')
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome, Demo Clinician' })).toBeDefined()
    expect(blue.loads).toBe(1)
    expect(document.querySelector('.hid-ehr.hid-ehr-shell')).not.toBeNull()
    expect(screen.queryByRole('complementary', { name: 'Provider navigation' })).toBeNull()
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).getByRole('link', { name: 'Home' }).getAttribute('aria-current')).toBe('page')
    expect(within(screen.getByRole('banner')).getByText('Demo Hospital')).toBeDefined()
  })
})
