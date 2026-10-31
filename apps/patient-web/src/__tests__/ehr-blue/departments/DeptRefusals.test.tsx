import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import type * as BlueRoutes from '../../../ehr-blue/routes'
import { DEMO_HOSPITAL, SESSION, facility, openStaffApp, serve, sessionAt } from '../frame/blueHarness'

/*
 * A department page opened by its address without its permission gives today's own words (staff/routes/Operations.tsx and
 * Audit.tsx), not the frame's "not open to you here", and reads nothing but the session. Every account is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(() => {
  vi.doMock('../../../ehr-blue/routes', async importOriginal => {
    const actual = await importOriginal<typeof BlueRoutes>()
    const frame = await import('../../../ehr-blue/frame/pages')
    const home = await import('../../../ehr-blue/home/pages')
    const departments = await import('../../../ehr-blue/departments/pages')
    return { ...actual, BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home, './departments/pages.ts': departments }) }
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

describe('a department page without its permission', () => {
  it.each([
    ['/provider/laboratory', 'Laboratory unavailable', 'This facility membership needs lab work-item read permission.'],
    ['/provider/pharmacy', 'Pharmacy unavailable', 'This facility membership needs pharmacy work-item read permission.'],
    ['/provider/ocr', 'Document OCR unavailable', 'This facility membership needs OCR job read permission.'],
    ['/provider/audit', 'Audit access unavailable', 'Your active facility membership needs audit.read permission to review its events.'],
  ])('%s says today\'s %s and reads nothing', async (path, title, message) => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['ehr.encounter.read'])
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp(path)
    await screen.findByRole('navigation', { name: 'Main navigation' })
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(title)
    expect(screen.getByText(message)).toBeDefined()
    expect(screen.queryByText(/is not open to you here/)).toBeNull()
    expect(sent.map(request => request.route).filter(route => route !== SESSION)).toEqual([])
  })
})
