import { describe, expect, it } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { PatientProfile } from '../api'
import { ProfilePage } from '../routes/Portal'
import { described, json, openSection, press, problem, profile, renderPortal, sectionCard, sectionToggle, shownText, type Handler } from './portalHarness'

const VERIFY = '/identity/me/verification/nin'
const verifiedAnswer = { entityType: 'patient', verificationType: 'nin', provider: 'qoreid', state: 'verified', recordedAt: '2026-10-27T10:00:00.000Z' }

/** The profile read with `changes`, and `verify` for the NIN check; the profile reads verified once a check has. */
function gateway(changes: Partial<PatientProfile>, verify: () => Response = () => json(verifiedAnswer)): Handler {
  let verified = false
  return (path, method) => {
    if (path === '/identity/me' && method === 'GET') return json({ ...profile, ...changes, ...(verified ? { ninVerified: true } : {}) })
    if (path === VERIFY && method === 'POST') {
      const answer = verify()
      verified = answer.ok
      return answer
    }
    return problem(500, 'UNEXPECTED', `${method} ${path}`)
  }
}
const ninField = () => screen.getByRole('textbox', { name: 'NIN (11 digits)' })
const fillDateOfBirth = () => fireEvent.change(screen.getByLabelText('Date of birth, as on your NIN'), { target: { value: '1990-04-12' } })

/**
 * Since the sign-up without a NIN (owner decision, 2026-10-27), the NIN is added
 * on the profile: optional, and never in the way of anything else on the page.
 */
describe('Verify your NIN, on the profile', () => {
  it('is offered while the profile says ninVerified false, sends the 11 digits, then says NIN verified', async () => {
    const { sent } = renderPortal(<ProfilePage />, gateway({ ninVerified: false, assuranceState: 'SELF_ASSERTED' }))
    await openSection('Verify your NIN')
    expect(screen.getByRole('heading', { name: 'About you' })).toBeTruthy()
    const button = screen.getByRole('button', { name: 'Verify NIN' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)

    fireEvent.change(ninField(), { target: { value: '1234 567-8901' } })
    expect((ninField() as HTMLInputElement).value).toBe('12345678901')
    // The date of birth starts from the profile's, so most people only type the number; it can be changed.
    expect((screen.getByLabelText('Date of birth, as on your NIN') as HTMLInputElement).value).toBe('1991-03-04')
    expect(button.disabled).toBe(false)
    fillDateOfBirth()
    await press(button)

    const done = await screen.findByRole('heading', { name: 'NIN' })
    await waitFor(() => expect(document.activeElement).toBe(done))
    // Still open, and its heading says it is verified, as it does while closed; it stays once the profile is read again.
    expect(sectionToggle('NIN').getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: 'NIN', description: 'Verified' })).toBeTruthy()
    expect(within(sectionCard('NIN')).getByRole('status').textContent).toBe('Your NIN is verified.')
    await waitFor(() => expect(screen.getByRole('region', { name: 'Ada Example’s Health ID card' }).querySelector('[aria-label="NIN verified"]')).not.toBeNull())
    expect(document.activeElement).toBe(done)
    expect(screen.queryByRole('textbox', { name: 'NIN (11 digits)' })).toBeNull()
    expect(sent.filter(request => request.path === VERIFY)).toEqual([{ path: VERIFY, method: 'POST', body: { nin: '12345678901', dateOfBirth: '1990-04-12' } }])
  })

  it('is not shown while the profile read has no ninVerified (an Identity before it)', async () => {
    renderPortal(<ProfilePage />, gateway({ assuranceState: 'LEGACY_MIGRATED' }))
    expect(await screen.findByRole('heading', { name: 'About you' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Verify your NIN' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'NIN' })).toBeNull()
    expect(screen.queryByLabelText(/^NIN (not )?verified$/)).toBeNull()
  })

  it.each<Partial<PatientProfile>>([{ ninVerified: true, assuranceState: 'SELF_ASSERTED' }, { ninVerified: true, assuranceState: 'NIN_VERIFIED' }])(
    'says NIN verified on the card, and asks for nothing, for %j', async changes => {
      const { sent } = renderPortal(<ProfilePage />, gateway(changes))
      const card = await screen.findByRole('region', { name: 'Ada Example’s Health ID card' })
      expect(card.querySelector('[aria-label="NIN verified"]')).not.toBeNull()
      // No section to verify it, open or closed, and no field for it anywhere.
      expect(screen.queryByRole('heading', { name: 'Verify your NIN' })).toBeNull()
      expect(document.getElementById('nin-verify-number')).toBeNull()
      expect(sent.filter(request => request.path === VERIFY)).toEqual([])
    })

  it.each([
    [503, 'QOREID_PATIENT_NIN_BINDING_DISABLED', 'You can’t verify your NIN here right now. Try again later.'],
    [409, 'PATIENT_NIN_DETAILS_MISMATCH', 'This NIN doesn’t match your name and date of birth. Check them and try again.'],
    [409, 'PATIENT_NIN_BINDING_CONFLICT', 'This NIN needs a review before it can be added to your account. Contact Health ID support.'],
    [422, 'PATIENT_IDENTITY_PROFILE_INCOMPLETE', 'Your profile is missing details we need, like your date of birth. Contact Health ID support.'],
  ])('says a %i %s plainly, and keeps the card', async (status, code, text) => {
    renderPortal(<ProfilePage />, gateway({ ninVerified: false }, () => problem(status, code, 'refused')))
    await openSection('Verify your NIN')
    fireEvent.change(ninField(), { target: { value: '12345678901' } })
    fillDateOfBirth()
    await press(screen.getByRole('button', { name: 'Verify NIN' }))
    expect(shownText(await screen.findByRole('alert'))).toBe(text)
    expect(screen.getByRole('heading', { name: 'Verify your NIN' })).toBeTruthy()
    expect(ninField().getAttribute('aria-invalid')).toBeNull()
  })

  it('says a NIN that did not match at its field', async () => {
    renderPortal(<ProfilePage />, gateway({ ninVerified: false }, () => json({ ...verifiedAnswer, state: 'not_verified' })))
    await openSection('Verify your NIN')
    fireEvent.change(ninField(), { target: { value: '12345678901' } })
    fillDateOfBirth()
    await press(screen.getByRole('button', { name: 'Verify NIN' }))
    await waitFor(() => expect(ninField().getAttribute('aria-invalid')).toBe('true'))
    expect(described(ninField())).toContain('This NIN doesn’t match the name and date of birth on your profile. Check the number and try again.')
    expect(document.activeElement).toBe(ninField())
  })
})
