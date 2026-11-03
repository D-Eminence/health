import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { address, backToTestSite, openPortalOn } from '../sites/siteHarness'

/**
 * Dark by default, through the whole chain: the build's VITE_HID_* variables, the portal's public configuration
 * (publicEnvironment.ts), packages/config's resolveEnvironment, the portal's env.ts, and the hand-off. No configuration
 * module is stood in for here. With VITE_HID_SSO unset, the signed-out staff and patient pages are today's sign-in
 * pages at today's addresses; set to 1, app.'s hand off, and the staff sites' stay today's until the staff hand-off is
 * switched on (sso/staffHandOffSwitch.ts, as it ships). The gateway and the product hosts are only names; nothing
 * reaches them.
 */
vi.mock('../../staff/clinicianApplicationApi', () => ({ clinicianApplicationApi: { availability: () => Promise.resolve({ open: false }) } }))
vi.mock('../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: false }))
vi.mock('../../openSite', () => ({ openSite: vi.fn() }))
const left = vi.hoisted(() => vi.fn())
vi.mock('../../sso/leave', () => ({ leavePage: left }))

class TabChannel extends EventTarget { postMessage() {} close() {} }
beforeEach(() => {
  left.mockClear()
  vi.stubGlobal('BroadcastChannel', TabChannel)
  vi.stubEnv('VITE_HID_ENVIRONMENT', 'production')
  vi.stubEnv('VITE_HID_API_BASE_URL', 'https://gateway.example.test')
  vi.stubEnv('VITE_HID_APP_ORIGIN', 'https://portal.example.test')
})
afterEach(() => { backToTestSite(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules() })

const EHR = 'ehr.healthidentitydirectory.com'
const APP = 'app.healthidentitydirectory.com'

describe('VITE_HID_SSO', () => {
  it.each([[undefined], [''], ['0'], ['false']])('set to %j, keeps today’s sign-in pages exactly', async value => {
    if (value !== undefined) vi.stubEnv('VITE_HID_SSO', value)
    const staff = await openPortalOn(EHR, '/provider/patients')
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(address()).toBe('/provider/sign-in?returnTo=%2Fprovider%2Fpatients')
    expect(staff.filter(request => request.route.includes('/auth/sso/'))).toEqual([])
    cleanup()
    vi.resetModules()
    backToTestSite()

    const patient = await openPortalOn(APP, '/records')
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(address()).toBe('/sign-in')
    expect(patient.filter(request => request.route.includes('/auth/sso/'))).toEqual([])
    expect(left).not.toHaveBeenCalled()
  })

  it('set to 1, hands a signed-out page of app. off', async () => {
    vi.stubEnv('VITE_HID_SSO', '1')
    await openPortalOn(APP, '/records')
    await waitFor(() => expect(left).toHaveBeenCalledWith('/api/v1/auth/sso/start?return_to=%2Frecords'))
    expect(screen.queryByRole('heading', { name: 'Welcome back.' })).toBeNull()
  })

  it('set to 1, keeps today’s sign-in on a staff site while the staff hand-off is switched off (sso/staffHandOffSwitch.ts)', async () => {
    vi.stubEnv('VITE_HID_SSO', '1')
    const staff = await openPortalOn(EHR, '/provider/patients')
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy()
    expect(address()).toBe('/provider/sign-in?returnTo=%2Fprovider%2Fpatients')
    expect(staff.filter(request => request.route.includes('/auth/sso/'))).toEqual([])
    expect(left).not.toHaveBeenCalled()
  })
})
