import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import type { AdminActor, IntegrationProvider } from '../api'
import { IntegrationsPage } from '../Integrations'
import { StepUpProvider } from '../StepUp'

const mocks = vi.hoisted(() => ({
  api: { integrations: vi.fn(), integrationHistory: vi.fn(), configureIntegration: vi.fn(), command: vi.fn(), stepUp: vi.fn() },
}))
vi.mock('../api', () => ({ adminApi: mocks.api, newIdempotencyKey: () => 'key-1' }))

const ses = (overrides: Partial<IntegrationProvider> = {}): IntegrationProvider => ({
  provider: 'ses', name: 'AWS SES', enabled: true, health: 'healthy', managementMode: 'dashboard',
  availableActions: ['pause', 'configure'], capabilities: ['email'], activeCapabilities: ['email'],
  operationGates: [{ operation: 'send', state: 'available', detail: 'Ready to send' }],
  configuration: { fromAddress: 'no-reply@example.test' }, credential: { state: 'configured', rotationSupported: false },
  lastTestedAt: null, lastSuccessfulTestAt: null, lastFailedTestAt: null, version: 7, ...overrides })
const MANAGER = ['platform.integration.read', 'platform.integration.manage']
const actor = (permissions: string[]): AdminActor => ({ accountId: 'admin-1', subject: 'staff:1', displayName: 'Ada',
  email: 'ada@example.test', platformRoles: [], platformPermissions: permissions })

function open(permissions = MANAGER) {
  render(<MemoryRouter><StepUpProvider><IntegrationsPage actor={actor(permissions)} /></StepUpProvider></MemoryRouter>)
}

const tile = async () => (await screen.findByRole('heading', { name: 'AWS SES', level: 3 })).closest('article')!

beforeEach(() => vi.clearAllMocks())

describe('integrations', () => {
  it('shows credential state and allow-listed settings only', async () => {
    mocks.api.integrations.mockResolvedValue({ items: [ses({
      configuration: { fromAddress: 'no-reply@example.test', apiKey: 'AKIA-NOT-FOR-DISPLAY' } as Record<string, string> })],
    capabilities: [] })
    open(['platform.integration.read'])
    const item = await tile()
    expect(within(item).getByText('Configured')).toBeTruthy()
    expect(within(item).getByText('From Address: no-reply@example.test')).toBeTruthy()
    expect(document.body.textContent).not.toContain('AKIA-NOT-FOR-DISPLAY')
    expect(within(item).queryByText('Edit settings')).toBeNull()
  })

  it('saves trimmed, non-empty settings with a reason and one idempotency key', async () => {
    mocks.api.integrations.mockResolvedValue({ items: [ses()], capabilities: [] })
    mocks.api.configureIntegration.mockResolvedValueOnce({ provider: 'ses', enabled: true,
      configuration: { fromAddress: 'alerts@example.test' }, version: 8, replayed: false })
    open()
    const item = await tile()
    fireEvent.change(within(item).getByLabelText('From address'), { target: { value: 'not-an-email' } })
    expect(within(item).getByRole('alert').textContent).toMatch(/Check From address/)
    expect((within(item).getByRole('button', { name: 'Save settings' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(item).getByLabelText('From address'), { target: { value: '  alerts@example.test ' } })
    fireEvent.change(within(item).getAllByLabelText('Reason for this change').at(-1)!, { target: { value: 'New alerts sender address' } })
    fireEvent.click(within(item).getByRole('button', { name: 'Save settings' }))
    expect(await within(item).findByText('Settings saved.')).toBeTruthy()
    expect(mocks.api.configureIntegration).toHaveBeenCalledWith(expect.objectContaining({ provider: 'ses', version: 7 }),
      { fromAddress: 'alerts@example.test' }, 'New alerts sender address', 'key-1')
    await waitFor(() => expect(mocks.api.integrations).toHaveBeenCalledTimes(2))
    expect(within(item).getByText('Settings saved.')).toBeTruthy()
  })

  it('explains an unchanged save instead of reporting a conflict', async () => {
    mocks.api.integrations.mockResolvedValue({ items: [ses()], capabilities: [] })
    mocks.api.configureIntegration.mockRejectedValueOnce(new HidApiError(409, 'unchanged', { code: 'INTEGRATION_UNCHANGED' }))
    open()
    const item = await tile()
    fireEvent.change(within(item).getAllByLabelText('Reason for this change').at(-1)!, { target: { value: 'Confirming the sender' } })
    fireEvent.click(within(item).getByRole('button', { name: 'Save settings' }))
    expect(await within(item).findByText('Nothing changed: the integration already has these settings or this state.')).toBeTruthy()
  })

  it('loads the change history only when it is opened', async () => {
    mocks.api.integrations.mockResolvedValue({ items: [ses()], capabilities: [] })
    mocks.api.integrationHistory.mockResolvedValueOnce({ items: [{ eventId: '4', action: 'admin.integration.configure',
      occurredAt: '2026-10-08T12:00:00.000Z', actorAccountId: 'admin-1', correlationId: 'corr-4', capability: null,
      reason: 'New alerts sender address', outcome: 'success' }] })
    open(['platform.integration.read'])
    const item = await tile()
    expect(mocks.api.integrationHistory).not.toHaveBeenCalled()
    const history = within(item).getByText('Change history').closest('details')!
    history.open = true
    fireEvent(history, new Event('toggle'))
    expect(await within(item).findByText('New alerts sender address')).toBeTruthy()
    expect(mocks.api.integrationHistory).toHaveBeenCalledWith('ses')
  })

  it('offers only valid route choices and removes a fallback with no provider', async () => {
    mocks.api.integrations.mockResolvedValue({ items: [], capabilities: [{ capability: 'email', activeProvider: 'ses',
      fallbackProvider: 'brevo', eligibleProviders: ['ses', 'brevo', 'termii'], version: 3 }] })
    mocks.api.command.mockResolvedValueOnce({ capability: 'email', activeProvider: 'ses', fallbackProvider: null, version: 4 })
    open()
    const route = (await screen.findByRole('heading', { name: 'Email', level: 3 })).closest('article')!
    const sheetOf = (title: string) => { fireEvent.click(within(route).getByRole('button', { name: title })); return screen.getByRole('dialog') }
    const optionsOf = (sheet: HTMLElement) => Array.from(within(sheet).getByLabelText('Change to').querySelectorAll('option'))
      .map(option => option.textContent)
    const active = sheetOf('Change provider')
    expect(optionsOf(active)).toEqual(['Brevo', 'Termii'])
    fireEvent.click(within(active).getByRole('button', { name: 'Cancel' }))
    const fallback = sheetOf('Change fallback')
    expect(optionsOf(fallback)).toEqual(['Termii', 'No fallback'])
    fireEvent.change(within(fallback).getByLabelText('Change to'), { target: { value: '(none)' } })
    const sheet = screen.getByRole('dialog', { name: 'Remove the fallback?' })
    fireEvent.change(within(sheet).getByLabelText('Reason for this change'), { target: { value: 'Brevo contract ended' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remove fallback' }))
    await waitFor(() => expect(mocks.api.command).toHaveBeenCalledWith('/api/v1/admin/integrations/capabilities/email/fallback',
      { provider: null, reason: 'Brevo contract ended' }, { version: 3, idempotencyKey: 'key-1' }))
  })
})
