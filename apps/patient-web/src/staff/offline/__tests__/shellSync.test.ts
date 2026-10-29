import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import type { StaffSession } from '../../api'
import { fakeOffline, PASSWORD, PILOT, snapshotOf } from './offlineFixture'

/** When the shell is registered or purged after sign-in (A5, §2.3 kill switch, A8.5). */
const shell = vi.hoisted(() => ({ enableShell: vi.fn(), purgeShell: vi.fn() }))
vi.mock('../shellLoader', () => ({ loadShell: () => Promise.resolve(shell) }))
vi.mock('../../env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
const { attachOnlineSession } = await import('../session')

const REAL = '11111111-0000-4000-8000-000000000001'
const session = (facilityId: string): StaffSession => {
  const facility = { id: facilityId, membershipId: `member-${facilityId}`, organizationId: 'org-1', name: 'Demo Hospital', roles: [], permissions: [], isPrimary: true }
  return { actor: { kind: 'staff', id: 'staff-1', email: 'ada@example.test', displayName: 'Ada Clinician', roles: [], permissions: [], facilities: [facility], facility } }
}

beforeEach(() => { shell.enableShell.mockReset(); shell.purgeShell.mockReset() })

describe('shell after sign-in', () => {
  it('registers the shell once an existing vault opens for a pilot facility', async () => {
    const { runtime, controls } = fakeOffline()
    controls.seedVault(snapshotOf(PILOT), PASSWORD)
    runtime.prepareFromSignIn('ada@example.test', PASSWORD)
    expect(await attachOnlineSession(runtime, session(PILOT))).toMatchObject({ result: 'attached' })
    await waitFor(() => expect(shell.enableShell).toHaveBeenCalledTimes(1))
    expect(shell.purgeShell).not.toHaveBeenCalled()
  })

  it('touches nothing for a facility that is not in the pilot', async () => {
    const { runtime } = fakeOffline()
    runtime.prepareFromSignIn('ada@example.test', PASSWORD)
    expect(await attachOnlineSession(runtime, session(REAL))).toMatchObject({ result: 'none' })
    await Promise.resolve()
    expect(shell.enableShell).not.toHaveBeenCalled()
    expect(shell.purgeShell).not.toHaveBeenCalled()
  })

  it('purges the shell when the facility left the pilot and its vault opens send-only', async () => {
    const { runtime } = fakeOffline()
    vi.spyOn(runtime, 'offer').mockResolvedValue({ kind: 'existing' })
    vi.spyOn(runtime, 'policy').mockReturnValue({ mode: 'pilot', enabled: false, reason: 'facility-off' })
    vi.spyOn(runtime, 'summary').mockReturnValue({ ...runtime.summary(), vault: 'unlocked' })
    await attachOnlineSession(runtime, session(PILOT))
    await waitFor(() => expect(shell.purgeShell).toHaveBeenCalledTimes(1))
    expect(shell.enableShell).not.toHaveBeenCalled()
  })
})
