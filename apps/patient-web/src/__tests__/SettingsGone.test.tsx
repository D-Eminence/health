import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { PatientApi } from '../api'
import { createTestSessionValue, SessionContext } from '../session'
import { PortalShell, ProfilePage } from '../routes/Portal'
import { json, problem, profile, renderPortal } from './portalHarness'

/**
 * Settings is gone (the owner's decision of 2026-10-28): the Access PIN is in Bio-data, the emergency contacts in
 * Health information, Delete account last on the profile, and an old /settings link opens the profile
 * (ProfileSections.test.tsx). Google sign-in links by the verified email, so nothing offers to link it by hand.
 */
vi.mock('../chatFeatures', () => ({ patientChatEnabled: () => false, patientChatHost: () => false }))
afterEach(() => { vi.unstubAllEnvs() })

const noBell = { onSessionAccepted: () => () => undefined, profile: () => new Promise(() => undefined) } as Partial<PatientApi> as PatientApi

describe('without Settings', () => {
  it('has no Settings in the portal\'s navigation', () => {
    render(<SessionContext.Provider value={createTestSessionValue({ kind: 'patient', subjectId: 'subject-a', appRole: 'patient', assuranceLevel: 'aal1' }, noBell)}>
      <MemoryRouter initialEntries={['/']}><Routes><Route path="/" element={<PortalShell />}><Route index element={<p>Overview page</p>} /></Route></Routes></MemoryRouter>
    </SessionContext.Provider>)
    const nav = within(screen.getByRole('navigation', { name: 'Main navigation' }))
    expect(nav.getAllByRole('link').map(link => link.textContent)).toEqual(['Overview', 'Records', 'Access & sharing', 'Profile'])
    expect(nav.queryByRole('link', { name: 'Settings' })).toBeNull()
    expect(document.querySelector('a[href="/settings"]')).toBeNull()
  })

  it('offers no Google link card on the profile, even where Google sign-in is on', async () => {
    vi.stubEnv('VITE_HID_GOOGLE_CLIENT_ID', 'client-id.apps.googleusercontent.com')
    const { sent } = renderPortal(<ProfilePage />, (path, method) => path === '/identity/me' && method === 'GET' ? json(profile)
      : problem(404, 'NOT_FOUND', path), {}, { at: '/profile#bio-data' })
    expect(await screen.findByRole('heading', { name: 'Access PIN' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Link a Google account' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull()
    expect(screen.queryByLabelText('Current password')).toBeNull()
    expect(sent.some(request => request.path.startsWith('/auth/google'))).toBe(false)
  })
})
