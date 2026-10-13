import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import type { AdminActor, PlatformControl } from '../api'
import { ControlsPage } from '../Pages'
import { StepUpProvider } from '../StepUp'

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

function open(permissions: string[]) {
  render(<StepUpProvider><ControlsPage actor={actor(permissions)} /></StepUpProvider>)
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

    expect(await screen.findByText('Normal operation')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Maintenance mode' })).toBeTruthy()
    expect(screen.getByText('Enable control')).toBeTruthy()
    const confirm = screen.getByRole('button', { name: 'Confirm change' }) as HTMLButtonElement
    fireEvent.change(screen.getByLabelText('Reason for this change'), { target: { value: 'Upgrade' } })
    expect(confirm.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Reason for this change'), { target: { value: '  Scheduled database upgrade ' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)

    fireEvent.change(await screen.findByLabelText('Authenticator code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }))
    expect(await screen.findByText('Saved. Current information is being refreshed.')).toBeTruthy()
    await waitFor(() => expect(mocks.api.controls).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Scheduled database upgrade')).toBeTruthy()

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
    expect(await screen.findByText('Disable control')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Reason for this change'), { target: { value: 'Storage provider incident' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }))
    await waitFor(() => expect(mocks.api.command).toHaveBeenCalledWith('/api/v1/admin/controls',
      { controlKey: 'uploads_enabled', enabled: false, reason: 'Storage provider incident' }, { version: 3 }))
  })

  it('shows the backend refusal and keeps the control as it was', async () => {
    mocks.api.controls.mockResolvedValueOnce([control()])
    mocks.api.command.mockRejectedValueOnce(new HidApiError(409, 'Version conflict', { code: 'VERSION_CONFLICT' }))
    open(['platform.control.manage'])
    await screen.findByText('Normal operation')
    fireEvent.change(screen.getByLabelText('Reason for this change'), { target: { value: 'Scheduled database upgrade' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }))
    expect((await screen.findByRole('alert')).textContent).toBe('This item changed. Reload it and try again.')
    expect(screen.queryByText('Saved. Current information is being refreshed.')).toBeNull()
    expect(mocks.api.controls).toHaveBeenCalledTimes(1)
  })

  it('is view-only without platform.control.manage', async () => {
    mocks.api.controls.mockResolvedValueOnce([control()])
    open([])
    expect(await screen.findByText('Normal operation')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Maintenance mode' })).toBeTruthy()
    expect(screen.queryByText('Enable control')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Confirm change' })).toBeNull()
    expect(mocks.api.command).not.toHaveBeenCalled()
  })
})
