import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { DEMO_HOSPITAL_ID } from '../departments/harness'
import { AccountSamplePanel } from '../../../ehr-blue/frame/TopBarParts'

/**
 * The account menu's sample panels (My profile, Preferences, Help) save nothing, so they open at a demo facility only:
 * at a real facility the panel draws nothing even when asked to open. Every account and facility here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
const session = vi.hoisted(() => ({ facilityId: '' }))
vi.mock('../../../staff/App', async () => {
  const { fakeFacility: at, staffContext: context } = await import('../departments/harness')
  return { useStaff: () => context(at([], { id: session.facilityId, name: 'Somewhere (fictional)', roles: ['doctor'] })) }
})
afterEach(cleanup)

const REAL_FACILITY = 'f0000000-0000-4000-8000-000000000001'

describe('AccountSamplePanel', () => {
  it('opens the sample My profile at a demo facility', () => {
    session.facilityId = DEMO_HOSPITAL_ID
    render(<AccountSamplePanel panel="profile" onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Edit my profile' })).toBeDefined()
  })

  it.each(['profile', 'preferences', 'help'] as const)('draws nothing for %s at a real facility', panel => {
    session.facilityId = REAL_FACILITY
    const { container } = render(<AccountSamplePanel panel={panel} onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(container.textContent).toBe('')
  })
})
