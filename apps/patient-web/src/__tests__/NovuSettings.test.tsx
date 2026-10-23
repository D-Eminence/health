import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { SettingsPage } from '../routes/Portal'
import { json, profile, problem, renderPortal } from './portalHarness'

vi.mock('../backendContract', () => ({ usesNovuBackend: () => true, backendContract: () => 'novu-v1' }))

describe('Settings on the Novu backend', () => {
  it('offers no emergency contacts card, and never asks for the contacts Novu does not serve', async () => {
    const { sent } = renderPortal(<SettingsPage />, path => path === '/identity/me'
      ? json(profile) : problem(404, 'NOT_FOUND', `Cannot GET /api/v1${path}`))
    expect(await screen.findByRole('heading', { name: 'Access PIN' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Emergency contacts' })).toBeNull()
    expect(sent.some(request => request.path.startsWith('/identity/me/emergency-contacts'))).toBe(false)
  })
})
