import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { openVault } from './offlineFixture'

vi.mock('../../env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', name: 'test' }) }))
const { SyncPanel } = await import('../SyncPanel')
const { forgetOfflineReports, reportOffline } = await import('../runtime')

/** The runtime's `report` callback (coordinator, core review): refused or rejected offline audit reaches someone. */
afterEach(() => { forgetOfflineReports() })

const SAID = /did not accept some records of what was opened offline/

describe('what the runtime reports', () => {
  it('shows in the sync panel when Health ID rejected or refused offline audit events', async () => {
    const { runtime } = await openVault()
    render(<SyncPanel runtime={runtime} onReview={() => undefined} onClose={() => undefined} />)
    expect(screen.queryByText(SAID)).toBeNull()
    act(() => { reportOffline({ kind: 'audit-rejected', dropped: 2, code: 'EVENT_TOO_OLD' }) })
    expect(screen.getByText(SAID)).toBeTruthy()

    forgetOfflineReports()
    act(() => { reportOffline({ kind: 'audit-refused', code: 'FORBIDDEN' } as never) })
    expect(screen.getByText(SAID)).toBeTruthy()
  })

  it('says nothing for reports that are not about the audit', async () => {
    const { runtime } = await openVault()
    render(<SyncPanel runtime={runtime} onReview={() => undefined} onClose={() => undefined} />)
    act(() => {
      reportOffline({ kind: 'defect', op: 'ehr.note.create', status: 400, code: 'VALIDATION_FAILED' })
      reportOffline({ kind: 'wipe', reason: 'kill-switch' })
    })
    expect(screen.queryByText(SAID)).toBeNull()
  })
})
