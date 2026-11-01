import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import type * as BlueRoutes from '../../../ehr-blue/routes'
import { DEMO_HOSPITAL, SESSION, facility, openStaffApp, serve, sessionAt } from '../frame/blueHarness'

/*
 * A department page opened by its address without its permission gives its own refusal (today's words from
 * staff/routes/Operations.tsx and Audit.tsx, or the plain sentence that replaced them), not the frame's "not open to you
 * here", and reads nothing but the session. Every account is fictional.
 */
const LAB_REFUSAL = 'Your role at this facility doesn’t include the lab’s work list and results. Ask your facility administrator.'
const OCR_REFUSAL = 'Reading scanned documents isn’t available at your facility yet.'
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
    ['/provider/laboratory', 'Laboratory unavailable', LAB_REFUSAL],
    ['/provider/pharmacy', 'Pharmacy unavailable', 'Your role at this facility doesn’t include pharmacy work. Ask your facility administrator.'],
    ['/provider/ocr', 'Document OCR unavailable', OCR_REFUSAL],
    ['/provider/audit', 'Audit access unavailable', 'Your active facility membership needs audit.read permission to review its events.'],
  ])('%s gives its own refusal, %s, and reads nothing', async (path, title, message) => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['ehr.encounter.read'])
    const sent = serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp(path)
    await screen.findByRole('navigation', { name: 'Main navigation' })
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(title)
    expect(screen.getByText(message)).toBeDefined()
    expect(screen.queryByText(/is not open to you here/)).toBeNull()
    expect(sent.map(request => request.route).filter(route => route !== SESSION)).toEqual([])
  })

  // The Laboratory's and Document OCR's refusals no longer name the permission they lack (the owner's rule: screens show
  // no codes; plain words).
  it.each([
    ['/provider/laboratory', 'Laboratory unavailable', /permission|membership|work-item|lab\.work-item\.read/i],
    ['/provider/ocr', 'Document OCR unavailable', /permission|membership|OCR job read|ocr\.job\.read/i],
  ])('%s names no permission', async (path, title, permissionWords) => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['ehr.encounter.read'])
    serve({ [SESSION]: [sessionAt(demo, [demo])] })
    await openStaffApp(path)
    // The page's own content (DeptPage's root), not the frame around it.
    const page = (await screen.findByRole('heading', { level: 1, name: title })).closest('.hid-ehr-dept')
    expect(page?.textContent).toContain(title)
    expect(page?.textContent).not.toMatch(permissionWords)
  })
})
