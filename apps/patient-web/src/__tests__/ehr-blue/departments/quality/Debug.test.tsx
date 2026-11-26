import { afterEach, beforeEach, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { REAL_FACILITY, SESSION, facility, openStaffApp, problem, serve, sessionAt } from '../../frame/blueHarness'
import { ME, STAFF_CODES, withQualityPage } from './qualityFixtures'
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(() => { withQualityPage() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })
it('debug', async () => {
  const member = facility(REAL_FACILITY, 'Fictional Hospital', STAFF_CODES, ['nurse'])
  const sent = serve({ [SESSION]: [sessionAt(member, [member])],
    [ME]: Array.from({ length: 8 }, () => () => problem(503, 'QUALITY_NOT_AVAILABLE', 'Off')) })
  await openStaffApp('/provider/quality')
  await new Promise(resolve => setTimeout(resolve, 4000))
  console.log('ROUTES', JSON.stringify(sent.map(call => call.route)))
  console.log('TEXT', screen.getByRole('main').textContent)
})
