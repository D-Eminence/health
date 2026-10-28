import { describe, expect, it } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import type { EmergencyContact, PatientProfile } from '../api'
import type { HealthProfile, ProfileDetails } from '../profileParity'
import { COMPLETION_ITEMS, completionServed, profileCompletion } from '../routes/profileCompletion'
import { contactsToCount } from '../routes/AccountSafety'
import { ProfilePage, SettingsRedirect } from '../routes/Portal'
import { completionCard, json, press, problem, profile, renderPortal, sectionToggle, type Handler } from './portalHarness'

/**
 * "Profile completion" (hid-1.0 parity B3, contract D): twelve items of equal weight, counted in the page from what
 * the backend serves, never stored. A source the backend does not serve is left out of the count.
 */
const complete: PatientProfile = {
  ...profile, gender: 'female', dateOfBirth: '1991-03-04', state: 'Lagos', ninVerified: true,
  email: 'ada@example.com', phone: '+2348031234567', phoneVerified: false, hasPhoto: true,
}
const details: ProfileDetails = { hospitalCurrentlyUsing: 'Lagos University Teaching Hospital', hmoName: 'Hygeia HMO', rowVersion: 2 }
const health: HealthProfile = { bloodGroup: 'O+', genotype: 'AA', allergies: null, currentMedications: null, chronicConditions: null,
  medicalNotes: null, rowVersion: 1, updatedAt: '2026-10-28T09:00:00.000Z' }
const contact = { contactId: 'c-1', name: 'Chidi Okafor', relationship: 'sibling', channel: 'sms', destinationHint: '•••• 4567',
  status: 'unverified', verifiedAt: null, notifyOnEmergencyAccess: true, eligibleForEmergencyNotification: false, version: 1,
  pendingVerification: null, lastNotification: null } as EmergencyContact
const keys = (items: ReadonlyArray<{ key: string }>) => items.map(item => item.key)

describe('the completion count', () => {
  it('counts the twelve items in order, equally', () => {
    expect(keys(COMPLETION_ITEMS)).toEqual(['email', 'phone', 'gender', 'dateOfBirth', 'state', 'photo', 'hospital', 'hmo',
      'bloodGroup', 'genotype', 'nin', 'emergencyContact'])
    expect(profileCompletion({ profile: complete, details, health, emergencyContacts: [contact] }))
      .toMatchObject({ percent: 100, counted: 12, missing: [] })
    // Each item is one twelfth: eleven of twelve is 92%, rounded.
    expect(profileCompletion({ profile: complete, details, health, emergencyContacts: [] })).toMatchObject({ percent: 92, counted: 12 })
  })

  it.each<[string, Parameters<typeof profileCompletion>[0], string]>([
    ['email', { profile: { ...complete, email: null }, details, health, emergencyContacts: [contact] }, 'email'],
    ['phone', { profile: { ...complete, phone: '' }, details, health, emergencyContacts: [contact] }, 'phone'],
    ['gender', { profile: { ...complete, gender: null }, details, health, emergencyContacts: [contact] }, 'gender'],
    ['date of birth', { profile: { ...complete, dateOfBirth: null }, details, health, emergencyContacts: [contact] }, 'dateOfBirth'],
    ['state', { profile: { ...complete, state: ' ' }, details, health, emergencyContacts: [contact] }, 'state'],
    ['photo', { profile: { ...complete, hasPhoto: false }, details, health, emergencyContacts: [contact] }, 'photo'],
    ['hospital', { profile: complete, details: { ...details, hospitalCurrentlyUsing: null }, health, emergencyContacts: [contact] }, 'hospital'],
    ['HMO', { profile: complete, details: { ...details, hmoName: null }, health, emergencyContacts: [contact] }, 'hmo'],
    ['blood group', { profile: complete, details, health: { ...health, bloodGroup: null }, emergencyContacts: [contact] }, 'bloodGroup'],
    ['genotype', { profile: complete, details, health: { ...health, genotype: null }, emergencyContacts: [contact] }, 'genotype'],
    ['NIN', { profile: { ...complete, ninVerified: false }, details, health, emergencyContacts: [contact] }, 'nin'],
    ['emergency contact', { profile: complete, details, health, emergencyContacts: [] }, 'emergencyContact'],
  ])('names a missing %s as the one thing to add', (_label, sources, key) => {
    const result = profileCompletion(sources)
    expect(keys(result.missing)).toEqual([key])
    expect(result.percent).toBe(92)
    expect(result.done).toHaveLength(11)
  })

  it('counts the email only once it is verified, where Identity says whether it is', () => {
    const sources = { details, health, emergencyContacts: [contact] }
    // A hid-1.0 account whose email was never confirmed there: on file, but not verified.
    const unconfirmed = profileCompletion({ profile: { ...complete, emailVerified: false }, ...sources })
    expect(keys(unconfirmed.missing)).toEqual(['email'])
    expect(unconfirmed.missing[0]?.label).toBe('A verified email address')
    expect(unconfirmed.percent).toBe(92)
    expect(profileCompletion({ profile: { ...complete, emailVerified: true }, ...sources }).percent).toBe(100)
    expect(keys(profileCompletion({ profile: { ...complete, email: null, emailVerified: true }, ...sources }).missing)).toEqual(['email'])
    // An Identity without the key: an email on file was confirmed by its code.
    expect(profileCompletion({ profile: complete, ...sources }).percent).toBe(100)
  })

  it('leaves out what the backend does not serve, so the percentage is over what is counted', () => {
    // Identity before 0094: no email, phone or photo keys; no coverage, health or contacts.
    const before = profileCompletion({ profile: { ...profile, gender: 'female', state: null, ninVerified: false } })
    expect(before.counted).toBe(4)
    expect(keys(before.done)).toEqual(['gender', 'dateOfBirth'])
    expect(before.percent).toBe(50)
    // EHR without the health profile, and contacts not offered: nine items.
    const noHealth = profileCompletion({ profile: complete, details, health: null, emergencyContacts: null })
    expect(noHealth).toMatchObject({ counted: 9, percent: 100 })
  })

  it('rounds to a whole percent', () => {
    const none: PatientProfile = { ...profile, gender: null, dateOfBirth: null, state: null, ninVerified: false, email: null, phone: null,
      hasPhoto: false }
    expect(profileCompletion({ profile: none, details: { hospitalCurrentlyUsing: null, hmoName: null, rowVersion: 0 },
      health: { ...health, bloodGroup: null, genotype: null }, emergencyContacts: [] })).toMatchObject({ percent: 0, counted: 12 })
    // One of twelve: 8.33 rounds to 8; seven of twelve: 58.3 rounds to 58.
    expect(profileCompletion({ profile: { ...none, gender: 'male' }, details: { hospitalCurrentlyUsing: null, hmoName: null, rowVersion: 0 },
      health: { ...health, bloodGroup: null, genotype: null }, emergencyContacts: [] }).percent).toBe(8)
    expect(profileCompletion({ profile: { ...complete, email: null, phone: null, hasPhoto: false }, details,
      health: { ...health, bloodGroup: null }, emergencyContacts: [] }).percent).toBe(58)
  })

  it('counts a NIN verified by the assurance an Identity before ninVerified gives', () => {
    const { ninVerified: _absent, ...older } = complete
    expect(keys(profileCompletion({ profile: { ...older, assuranceState: 'NIN_VERIFIED' } }).done)).toContain('nin')
    expect(keys(profileCompletion({ profile: { ...older, assuranceState: 'SELF_ASSERTED' } }).missing)).toContain('nin')
  })

  it('leaves the emergency contact out where the patient cannot add one now', () => {
    expect(contactsToCount(null)).toBeNull()
    expect(contactsToCount({ offer: null, contacts: [] })).toBeNull()
    expect(contactsToCount({ offer: { delivery: false, channels: [] }, contacts: [] })).toBeNull()
    expect(contactsToCount({ offer: { delivery: false, channels: [] }, contacts: [contact] })).toEqual([contact])
    expect(contactsToCount({ offer: { delivery: true, channels: ['sms'] }, contacts: [] })).toEqual([])
  })

  it('is shown only once Identity says whether there is a photo (hid-system 0094)', () => {
    expect(completionServed(profile)).toBe(false)
    expect(completionServed(complete)).toBe(true)
  })
})

/** The profile with every B3 source served, the profile read with `changes`. */
function gateway(changes: Partial<PatientProfile>, overrides: Partial<Record<string, () => Response>> = {}): Handler {
  return (path, method) => {
    const override = overrides[`${method} ${path}`]
    if (override) return override()
    if (path === '/identity/me' && method === 'GET') return json({ ...complete, ...changes })
    if (path === '/identity/me/photo') return problem(404, 'PHOTO_NOT_FOUND', 'No photo')
    if (path === '/identity/me/profile-details') return json(details)
    if (path === '/ehr/me/health-profile') return json(health)
    if (path === '/identity/me/emergency-contacts/availability') return json({ delivery: true, channels: ['sms', 'email'] })
    if (path === '/identity/me/emergency-contacts') return json([])
    if (path === '/ehr/me/records') return json({ encounters: [], notes: [], importedRecords: [], importedHealthProfile: null, limit: 50 })
    return problem(404, 'NOT_FOUND', `${method} ${path}`)
  }
}
const card = async () => within(await completionCard())

describe('Profile completion, on the profile', () => {
  it('shows the percentage and links each missing item to where it is filled in', async () => {
    renderPortal(<ProfilePage />, gateway({ hasPhoto: false, state: null }), {}, { parityB3: true })
    const shown = await card()
    expect(shown.getByText('75%')).toBeTruthy()
    const links = shown.getAllByRole('link').map(link => [link.textContent, link.getAttribute('href')])
    expect(links).toEqual([['Your state', '/profile#bio-data'], ['A profile photo', '/profile#bio-data'],
      ['An emergency contact', '/profile#emergency-contacts']])
  })

  it('is a card always shown, first, not a section that opens: no button, and every section after it closed', async () => {
    renderPortal(<ProfilePage />, gateway({ hasPhoto: false, state: null }), {}, { parityB3: true })
    const shown = await completionCard()
    expect(shown.id).toBe('profile-completion')
    expect(within(shown).queryByRole('button')).toBeNull()
    expect(shown.querySelector('[hidden]')).toBeNull()
    expect(shown.querySelector('.patient-completion-bar')).not.toBeNull()
    expect(shown.compareDocumentPosition(sectionToggle('Bio-data')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(sectionToggle('Bio-data').getAttribute('aria-expanded')).toBe('false')
  })

  it('takes "An emergency contact" to the emergency contacts in Health information, opened, with focus on their heading', async () => {
    renderPortal(<Routes><Route path="/profile" element={<ProfilePage />} /></Routes>, gateway({}), {}, { parityB3: true, at: '/profile' })
    await press(await (await card()).findByRole('link', { name: 'An emergency contact' }))
    const title = await screen.findByRole('heading', { name: 'Emergency contacts', level: 3 })
    await waitFor(() => expect(document.activeElement).toBe(title))
    expect(sectionToggle('Health information').getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById('health-information-content')?.contains(title)).toBe(true)
  })

  it('takes a missing item\'s link to its section on the same page, opened, with focus on the section\'s heading', async () => {
    renderPortal(<Routes><Route path="/profile" element={<ProfilePage />} /></Routes>, gateway({}, {
      'GET /ehr/me/health-profile': () => json({ ...health, bloodGroup: null }),
      'GET /identity/me/profile-details': () => json({ ...details, hmoName: null }),
    }), {}, { parityB3: true, at: '/profile' })
    const shown = await card()
    // Pressed with the keyboard: the link it follows still holds focus as the address changes.
    await press(await shown.findByRole('link', { name: 'Your blood group' }))
    // On the button in the section's heading, which says it is open.
    await waitFor(() => expect(document.activeElement).toBe(sectionToggle('Health information')))
    expect(sectionToggle('Health information').getAttribute('aria-expanded')).toBe('true')
    // Another item of the same list, from the same page again.
    await press(shown.getByRole('link', { name: 'Your HMO' }))
    await waitFor(() => expect(document.activeElement).toBe(sectionToggle('Coverage')))
    expect(sectionToggle('Coverage').getAttribute('aria-expanded')).toBe('true')
  })

  it('takes "A verified email address" to the email in Bio-data, opened, where the email can be verified', async () => {
    renderPortal(<Routes><Route path="/profile" element={<ProfilePage />} /></Routes>, gateway({ emailVerified: false }), {}, { parityB3: true, at: '/profile' })
    const link = await (await card()).findByRole('link', { name: 'A verified email address' })
    expect(link.getAttribute('href')).toBe('/profile#contact-details')
    await press(link)
    const block = document.getElementById('contact-details') as HTMLElement
    await waitFor(() => expect(document.activeElement).toBe(block))
    expect(sectionToggle('Bio-data').getAttribute('aria-expanded')).toBe('true')
    expect(within(block).getByRole('button', { name: 'Verify email address' })).toBeTruthy()
  })

  it('says the profile is complete when nothing is missing', async () => {
    renderPortal(<ProfilePage />, gateway({}, {
      'GET /identity/me/emergency-contacts': () => json([contact]),
      'GET /identity/me/photo': () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { 'content-type': 'image/jpeg' } }),
    }), {}, { parityB3: true })
    const shown = await card()
    expect(shown.getByText('100%')).toBeTruthy()
    expect(shown.getByText('Your profile is complete.')).toBeTruthy()
    expect(shown.queryAllByRole('link')).toHaveLength(0)
  })

  it('leaves out a source that failed, rather than counting it missing', async () => {
    renderPortal(<ProfilePage />, gateway({}, { 'GET /ehr/me/health-profile': () => problem(503, 'UPSTREAM_UNAVAILABLE', 'EHR is unavailable.') }),
      {}, { parityB3: true })
    const shown = await card()
    // Ten counted: the emergency contact is missing, the blood group and genotype are not counted.
    expect(shown.getByText('90%')).toBeTruthy()
    expect(shown.getAllByRole('link').map(link => link.textContent)).toEqual(['An emergency contact'])
  })

  it('is not shown by an Identity before 0094, which asks nothing more of it', async () => {
    const { sent } = renderPortal(<ProfilePage />, (path, method) => path === '/identity/me' && method === 'GET' ? json(profile)
      : problem(404, 'NOT_FOUND', path))
    expect(await screen.findByRole('heading', { name: 'Bio-data' })).toBeTruthy()
    await screen.findByText('Ada Example')
    expect(screen.queryByRole('heading', { name: 'Profile completion' })).toBeNull()
    // Only the profile, and what the parts moved from Settings read for themselves (the emergency contacts in Health
    // information, Delete account): nothing for the completion.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(sent.filter(request => !/^\/identity\/me(\/emergency-contacts(\/availability)?|\/account-deletion)?$/.test(request.path))).toEqual([])
  })
})

describe('a link to a section', () => {
  it.each([
    ['the profile', '/profile#%E0%A4%A', 'Your profile', 'Bio-data'],
    ['the old settings', '/settings#%', 'Your profile', 'Bio-data'],
  ])('to %s with a # that does not decode names no section, and the page is shown', async (_label, at, title, card) => {
    renderPortal(<Routes><Route path="/profile" element={<ProfilePage />} /><Route path="/settings" element={<SettingsRedirect />} /></Routes>,
      gateway({}), {}, { parityB3: true, at })
    expect(await screen.findByRole('heading', { name: title, level: 1 })).toBeTruthy()
    expect(await screen.findByRole('heading', { name: card })).toBeTruthy()
  })
})
