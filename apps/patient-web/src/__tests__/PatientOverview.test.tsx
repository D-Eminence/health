import { describe, expect, it } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { Overview } from '../routes/Overview'
import { json, problem, profile, renderPortal } from './portalHarness'

/** The overview reads the patient's own profile, GET /identity/me (hid-system patient-self.controller.ts), first. */
describe('patient overview', () => {
  it('shows the Health ID and name the profile returns', async () => {
    const { sent } = renderPortal(<Overview />, () => json(profile))
    expect(await screen.findByText('HID-ABC234')).toBeTruthy()
    expect(screen.getByText('Ada Example')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View profile' }).getAttribute('href')).toBe('/profile')
    // The profile is read first; then the dashboard's cards (hid-1.0 parity B3) read what today's backend serves. The
    // routes a backend before 0093 or 0094 does not serve answer 404 and are not recorded (portalHarness.tsx).
    expect(sent[0]).toEqual({ path: '/identity/me', method: 'GET', body: null })
    expect(sent.map(request => `${request.method} ${request.path}`).sort()).toEqual([
      'GET /ehr/me/records', 'GET /identity/me', 'GET /identity/me/access-history', 'GET /identity/me/access-requests',
      'GET /identity/me/notifications'])
  })

  it('reports a failed read and loads again on Try again', async () => {
    let answers = 0
    const { sent } = renderPortal(<Overview />, path => path === '/identity/me' && ++answers === 1
      ? problem(404, 'PATIENT_PROFILE_NOT_FOUND', 'The service could not answer.') : json(profile))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('The service could not answer.')
    expect(screen.queryByText('HID-ABC234')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('HID-ABC234')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(sent.filter(request => request.path === '/identity/me')).toHaveLength(2)
  })
})
