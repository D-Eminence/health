import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { DEMO_HOSPITAL, REQUESTS, SESSION, facility, json, openStaffApp, serve, sessionAt, withFramePages } from './blueHarness'

/*
 * A page printed as it is (a sample's Print) carries the shared print header too: the Health ID logo and the facility
 * open now, kept off the screen, while the frame's own sidebar and top bar stay off the paper. Fictional data only.
 */

vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(() => { withFramePages() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

describe('the frame’s print header', () => {
  it('heads the page with the logo and the session’s facility, in print only', async () => {
    const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'])
    serve({ [SESSION]: [sessionAt(demo, [demo])], [REQUESTS]: [() => json([])] })
    await openStaffApp('/provider')
    await screen.findByRole('navigation', { name: 'Main navigation' })
    const header = document.querySelector('.hid-ehr-blue-page > [data-print-header]')
    expect(header).not.toBeNull()
    expect(header!.classList).toContain('hid-ehr-print-only')
    expect(header!.querySelector('img')?.getAttribute('alt')).toBe('Health ID')
    expect(header!.querySelector('.hid-ehr-print-header-facility')?.textContent).toBe('Demo Hospital')
    expect(document.querySelectorAll('[data-print-header]')).toHaveLength(1)
  })
})
