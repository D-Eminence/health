import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import type { AdminActor, PlatformControl } from '../api'
import { ControlsPage } from '../Pages'
import { StepUpProvider } from '../StepUp'
import { ToastProvider } from '../../kasuwa/toast'

/**
 * Platform controls (the kill switches). hid-system POST /admin/controls takes
 * { controlKey, enabled, reason } with If-Match; its policy
 * (platform.control.change) requires step-up and a reason, and no idempotency key.
 */
const mocks = vi.hoisted(() => ({ api: { controls: vi.fn(), command: vi.fn(), stepUp: vi.fn() }, keys: 0 }))
vi.mock('../api', () => ({ adminApi: mocks.api, newIdempotencyKey: () => `key-${++mocks.keys}` }))

const control = (overrides: Partial<PlatformControl> = {}): PlatformControl => ({ controlKey: 'maintenance_mode',
  enabled: false, reason: 'Normal operation', updatedAt: '2026-10-01T09:00:00.000Z', version: 3, ...overrides })
const actor = (permissions: string[]): AdminActor => ({ accountId: 'admin-1', subject: 'staff:1', displayName: 'Ada',
  email: 'ada@example.test', platformRoles: [], platformPermissions: ['platform.control.read', ...permissions] })

/** Opens a control's confirmation and gives the reason; returns the sheet. */
function change(button: string, reason: string) {
  fireEvent.click(screen.getByRole('button', { name: button }))
  const sheet = screen.getByRole('dialog', { name: `${button}?` })
  fireEvent.change(within(sheet).getByLabelText('Reason for this change'), { target: { value: reason } })
  return sheet
}

function open(permissions: string[]) {
  render(<ToastProvider><StepUpProvider><ControlsPage actor={actor(permissions)} /></StepUpProvider></ToastProvider>)
}

beforeEach(() => { vi.resetAllMocks(); mocks.keys = 0 })

describe('platform controls', () => {
  it('turns a control over with its version, a reason and step-up, then reloads', async () => {
    mocks.api.controls.mockResolvedValueOnce([control()])
      .mockResolvedValueOnce([control({ enabled: true, reason: 'Scheduled database upgrade', version: 4 })])
    mocks.api.command.mockRejectedValueOnce(new HidApiError(403, 'Step-up required', { code: 'STEP_UP_REQUIRED' }))
      .mockResolvedValueOnce({ controlKey: 'maintenance_mode', enabled: true, version: 4 })
    mocks.api.stepUp.mockResolvedValueOnce({ stepUpExpiresAt: '2026-10-08T12:05:00.000Z' })
    open(['platform.control.manage'])

    expect(await screen.findByText(/“Normal operation”/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Maintenance mode' })).toBeTruthy()
    const sheet = change('Turn on maintenance mode', 'Upgrade')
    // A reason under 8 characters is refused before anything is sent.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Turn on' }))
    expect(within(sheet).getByText('Give a reason of at least 8 characters.')).toBeTruthy()
    expect(mocks.api.command).not.toHaveBeenCalled()
    fireEvent.change(within(sheet).getByLabelText('Reason for this change'), { target: { value: '  Scheduled database upgrade ' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Turn on' }))

    fireEvent.change(await screen.findByLabelText('Sign-in code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    expect(await screen.findByText('Maintenance mode is on.')).toBeTruthy()
    await waitFor(() => expect(mocks.api.controls).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/“Scheduled database upgrade”/)).toBeTruthy()

    // The same command both times: the step-up repeats it, never a second change.
    const command = ['/api/v1/admin/controls', { controlKey: 'maintenance_mode', enabled: true,
      reason: 'Scheduled database upgrade' }, { version: 3 }]
    expect(mocks.api.command.mock.calls).toEqual([command, command])
    expect(mocks.api.stepUp).toHaveBeenCalledWith('123456')
  })

  it('offers to disable a control that is on', async () => {
    mocks.api.controls.mockResolvedValueOnce([control({ controlKey: 'uploads_enabled', enabled: true })])
    mocks.api.command.mockResolvedValueOnce({ controlKey: 'uploads_enabled', enabled: false, version: 4 })
    mocks.api.controls.mockResolvedValueOnce([control({ controlKey: 'uploads_enabled', enabled: false, version: 4 })])
    open(['platform.control.manage'])
    await screen.findByRole('button', { name: 'Turn off uploads' })
    const sheet = change('Turn off uploads', 'Storage provider incident')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Turn off' }))
    await waitFor(() => expect(mocks.api.command).toHaveBeenCalledWith('/api/v1/admin/controls',
      { controlKey: 'uploads_enabled', enabled: false, reason: 'Storage provider incident' }, { version: 3 }))
  })

  it('shows the backend refusal and keeps the control as it was', async () => {
    mocks.api.controls.mockResolvedValueOnce([control()])
    mocks.api.command.mockRejectedValueOnce(new HidApiError(409, 'Version conflict', { code: 'VERSION_CONFLICT' }))
    open(['platform.control.manage'])
    await screen.findByText(/“Normal operation”/)
    const sheet = change('Turn on maintenance mode', 'Scheduled database upgrade')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Turn on' }))
    expect((await within(sheet).findByRole('alert')).textContent).toContain('This item changed. Reload it and try again.')
    expect(screen.queryByText('Maintenance mode is on.')).toBeNull()
    expect(screen.getByText('Off')).toBeTruthy()
    expect(mocks.api.controls).toHaveBeenCalledTimes(1)
  })

  // hid-system ADR-066: POST /admin/controls accepts clinician_signup_enabled (seeded off).
  it('says what the clinician sign-up control opens, and turns it on like any other control', async () => {
    mocks.api.controls.mockResolvedValueOnce([control({ controlKey: 'clinician_signup_enabled',
      reason: 'Off until an administrator opens clinician self sign-up (0098, ADR-066)' })])
    mocks.api.command.mockResolvedValueOnce({ controlKey: 'clinician_signup_enabled', enabled: true, version: 4 })
    mocks.api.controls.mockResolvedValueOnce([control({ controlKey: 'clinician_signup_enabled', enabled: true, version: 4,
      reason: 'Release checklist P37 approved' })])
    open(['platform.control.manage'])
    expect(await screen.findByRole('heading', { name: 'Clinician sign-up' })).toBeTruthy()
    expect(screen.getByText(/^Lets doctors and nurses apply at \/provider\/join\. Two Super Admins review each one/)).toBeTruthy()
    const sheet = change('Turn on clinician sign-up', 'Release checklist P37 approved')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Turn on' }))
    await waitFor(() => expect(mocks.api.command).toHaveBeenCalledWith('/api/v1/admin/controls',
      { controlKey: 'clinician_signup_enabled', enabled: true, reason: 'Release checklist P37 approved' }, { version: 3 }))
    // Other controls keep their generic tile.
    expect(screen.queryByText(/apply at \/provider\/join/)).toBeTruthy()
  })

  it('is view-only without platform.control.manage', async () => {
    mocks.api.controls.mockResolvedValueOnce([control()])
    open([])
    expect(await screen.findByText(/“Normal operation”/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Maintenance mode' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Turn (on|off)/ })).toBeNull()
    expect(screen.queryAllByRole('button').map(button => button.textContent)).toEqual(['Refresh'])
    expect(mocks.api.command).not.toHaveBeenCalled()
  })
})
