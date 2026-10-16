import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { ParticipatingFacilitiesPage } from '../routes/ParticipatingFacilities'
import { json, press, problem, renderPortal } from './portalHarness'

afterEach(() => { vi.restoreAllMocks() })

const LIST = '/identity/patient-enrollments/participating-facilities'
const anonymous = { state: { status: 'anonymous', principal: null } } as const
/** Identity's three fixed lines (hid-system patient-enrollment.service.ts WHAT_TO_BRING). */
const WHAT_TO_BRING = ['Your own phone with this registration open',
  'One original photo ID: national ID card, international passport, driver\'s licence or voter\'s card',
  'A phone number or email that can receive codes now']
const FACILITIES = [
  { name: 'Synthetic General Hospital', addressLine: '1 Example Road', town: 'Ikeja', lga: 'Ikeja', state: 'Lagos', hours: 'Mon-Fri 08:00-16:00' },
  { name: 'Synthetic Health Centre', town: 'Garki', lga: 'AMAC', state: 'FCT' },
]

/**
 * The facility route's public page (hid-system #85, ADR-063): the participating
 * facilities by name and place, and what to bring, from
 * GET .../participating-facilities, which is public and carries no id.
 */
describe('the participating facilities page', () => {
  it('lists the facilities and what to bring as Identity sends them, and starts registration on the patient\'s phone', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { sent } = renderPortal(<ParticipatingFacilitiesPage />, path =>
      path === LIST ? json({ facilities: FACILITIES, whatToBring: WHAT_TO_BRING }) : problem(500, 'UNEXPECTED', path), anonymous)

    const bring = await screen.findByRole('region', { name: 'What to bring' })
    expect(within(bring).getAllByRole('listitem').map(item => item.textContent)).toEqual(WHAT_TO_BRING)
    const facilities = screen.getByRole('region', { name: 'Participating facilities' })
    expect(within(facilities).getAllByRole('listitem').map(item => item.textContent)).toEqual([
      'Synthetic General Hospital1 Example Road, Ikeja, Ikeja LGA, Lagos StateHours: Mon-Fri 08:00-16:00',
      'Synthetic Health CentreGarki, AMAC LGA, FCT State',
    ])
    expect(screen.getByRole('heading', { level: 1, name: 'Register at a healthcare facility' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Start registration' }).getAttribute('href')).toBe('/enroll')
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/sign-in')
    expect(sent).toEqual([{ path: LIST, method: 'GET', body: null }])
    expect(setItem).not.toHaveBeenCalled()
  })

  it('says no facility is taking part while the list is empty', async () => {
    renderPortal(<ParticipatingFacilitiesPage />, () => json({ facilities: [], whatToBring: WHAT_TO_BRING }), anonymous)
    const facilities = await screen.findByRole('region', { name: 'Participating facilities' })
    expect(facilities.textContent).toContain('No healthcare facility is taking part right now. Try again later.')
  })

  it('says it could not load the list, and Try again reads it again, with focus on the list once shown', async () => {
    let answer = () => problem(503, 'UPSTREAM_UNAVAILABLE', 'A required platform service is temporarily unavailable.')
    renderPortal(<ParticipatingFacilitiesPage />, () => answer(), anonymous)
    const alert = await screen.findByRole('alert', {}, { timeout: 5000 })
    expect(alert.textContent).toContain('We could not load the list of participating facilities.')
    answer = () => json({ facilities: FACILITIES, whatToBring: WHAT_TO_BRING })
    await press(within(alert).getByRole('button', { name: 'Try again' }))
    const heading = await screen.findByRole('heading', { name: 'What to bring' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })
})
