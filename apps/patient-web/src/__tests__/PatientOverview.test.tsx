import { describe, expect, it } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { Overview } from '../routes/Overview'
import { json, problem, profile, renderPortal } from './portalHarness'

/** The overview reads the patient's own profile, GET /identity/me (hid-system patient-self.controller.ts). */
describe('patient overview', () => {
  it('shows the Health ID and name the profile returns', async () => {
    const { sent } = renderPortal(<Overview />, () => json(profile))
    expect(await screen.findByText('HID-ABC234')).toBeTruthy()
    expect(screen.getByText('Ada Example')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View profile →' }).getAttribute('href')).toBe('/profile')
    expect(sent).toEqual([{ path: '/identity/me', method: 'GET', body: null }])
  })

  it('reports a failed read and loads again on Try again', async () => {
    let answers = 0
    const { sent } = renderPortal(<Overview />, () => ++answers === 1
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
