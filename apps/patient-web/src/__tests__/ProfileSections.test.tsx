import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, isInaccessible, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import type { PatientProfile } from '../api'
import type { HealthProfile, ProfileDetails } from '../profileParity'
import { ProfilePage, SettingsRedirect } from '../routes/Portal'
import { EmergencyContactsCard } from '../routes/AccountSafety'
import { focusWhenShown } from './focusWhenShown'
import { completionCard, heading, json, openContactDetails, openSection, press, problem, profile, renderPortal, sectionToggle, type Handler } from './portalHarness'

const novu = vi.hoisted(() => ({ on: true }))
vi.mock('../backendContract', () => ({ usesNovuBackend: () => novu.on }))
const environment = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
afterEach(() => { novu.on = true; environment.IS_REACT_ACT_ENVIRONMENT = undefined })

/**
 * The profile's sections, closed until the patient opens one (the owner's decision of 2026-10-28: "All those profile
 * sections should be auto collapse until click"): the same cards, showing their heading alone, each opened and closed
 * by the button in its heading, and opened by a link to it. The completion is not one: as on hid-1.0 it is always
 * shown, first. The photo, the contact details and the Access PIN are in Bio-data, the emergency contacts are in Health
 * information, and Delete account is last (the owner's decisions of 2026-10-28). There is no Settings page.
 */
const patient: PatientProfile = {
  ...profile, gender: 'female', state: 'Lagos', ninVerified: false, assuranceState: 'SELF_ASSERTED',
  email: 'ada@example.com', phone: '+2348031234567', phoneVerified: false, hasPhoto: false,
}
const details: ProfileDetails = { hospitalCurrentlyUsing: 'Lagos University Teaching Hospital', hmoName: null, rowVersion: 2 }
const health: HealthProfile = { bloodGroup: 'O+', genotype: 'AA', allergies: null, currentMedications: null, chronicConditions: null,
  medicalNotes: null, rowVersion: 1, updatedAt: '2026-10-28T09:00:00.000Z' }
const hid1 = { content: { blood_group: 'O+', genotype: 'AA', allergies: 'Penicillin' }, updatedAt: '2025-11-03T09:00:00Z' }

/** Every section the profile has, in the order it shows them. 8 of the 12 completion items are done (67%). */
const SECTIONS = ['Bio-data', 'Coverage', 'Health information', 'From your hid-1.0 account', 'Verify your NIN']

/** Each read the profile makes answered; `overrides` by "METHOD path". */
function gateway(overrides: Partial<Record<string, (body: unknown) => Response | Promise<Response>>> = {}): Handler {
  let saved = details
  return (path, method, body) => {
    const override = overrides[`${method} ${path}`]
    if (override) return override(body)
    if (path === '/identity/me' && method === 'GET') return json(patient)
    if (path === '/identity/me/photo') return problem(404, 'PHOTO_NOT_FOUND', 'No photo')
    if (path === '/identity/me/profile-details' && method === 'GET') return json(saved)
    if (path === '/identity/me/profile-details' && method === 'PUT') {
      const { expectedVersion: _version, ...fields } = body as ProfileDetails & { expectedVersion: number }
      saved = { ...fields, rowVersion: saved.rowVersion + 1 }
      return json(saved)
    }
    if (path === '/ehr/me/health-profile') return json(health)
    if (path === '/identity/me/emergency-contacts/availability') return json({ delivery: true, channels: ['sms', 'email'] })
    if (path === '/identity/me/emergency-contacts') return json([])
    if (path === '/ehr/me/records') return json({ encounters: [], notes: [], importedRecords: [], importedHealthProfile: hid1, limit: 50 })
    return problem(404, 'NOT_FOUND', `${method} ${path}`)
  }
}
const atProfile = (at: string, handler: Handler = gateway()) =>
  renderPortal(<Routes><Route path="/profile" element={<ProfilePage />} /></Routes>, handler, {}, { parityB3: true, at })

/** What the button in a section's heading opens. */
const content = (name: string) => document.getElementById(sectionToggle(name).getAttribute('aria-controls') ?? '') as HTMLElement
const isOpen = (name: string) => sectionToggle(name).getAttribute('aria-expanded') === 'true'
async function allShown() {
  for (const name of SECTIONS) await screen.findByRole('heading', { name, level: 2 })
}
const click = (element: HTMLElement) => act(async () => { fireEvent.click(element) })

describe('a section of the profile', () => {
  it('is shown closed, its heading alone, with nothing in it reachable', async () => {
    renderPortal(<ProfilePage />, gateway(), {}, { parityB3: true })
    await allShown()
    for (const name of SECTIONS) {
      const toggle = sectionToggle(name)
      expect(toggle.getAttribute('aria-expanded'), name).toBe('false')
      expect(toggle.closest('h2')?.parentElement?.id, name).toBe(content(name).id.replace(/-content$/, ''))
      expect(content(name).hidden, name).toBe(true)
      expect(isInaccessible(content(name)), name).toBe(true)
    }
    // Nothing inside can be reached while closed: not a field or a button.
    expect(isInaccessible(screen.getByLabelText('Add profile photo'))).toBe(true)
    expect(screen.queryByRole('button', { name: 'Change email address' })).toBeNull()
    expect(isInaccessible(screen.getByLabelText('Set PIN'))).toBe(true)
    expect(screen.queryByRole('textbox', { name: 'HMO name' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Blood group' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add emergency contact' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'National Identification Number' })).toBeNull()
    // The only buttons are the headings'.
    expect(screen.getAllByRole('button')).toEqual(SECTIONS.map(sectionToggle))
    // The completion is shown in full, first, above every section.
    const completion = await completionCard()
    expect(completion.getAttribute('aria-expanded')).toBeNull()
    expect(within(completion).getByRole('link', { name: 'A profile photo' })).toBeTruthy()
    expect(completion.compareDocumentPosition(heading('Bio-data')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.each(SECTIONS)('%s opens on a click on its heading, alone, and closes on another', async name => {
    renderPortal(<ProfilePage />, gateway(), {}, { parityB3: true })
    await allShown()
    await click(sectionToggle(name))
    expect(isOpen(name)).toBe(true)
    expect(content(name).hidden).toBe(false)
    expect(isInaccessible(content(name))).toBe(false)
    expect(SECTIONS.filter(isOpen)).toEqual([name])
    await click(sectionToggle(name))
    expect(isOpen(name)).toBe(false)
    expect(content(name).hidden).toBe(true)
  })

  it('opens what it holds: the photo and the contact changes in Bio-data, the forms, the emergency contacts', async () => {
    renderPortal(<ProfilePage />, gateway(), {}, { parityB3: true })
    const bio = within(await openSection('Bio-data'))
    expect(bio.getByLabelText('Add profile photo')).toBeTruthy()
    expect(bio.getByRole('button', { name: 'Change email address' })).toBeTruthy()
    expect(bio.getByLabelText('Set PIN')).toBeTruthy()
    expect(within(await openSection('Coverage')).getByRole('textbox', { name: 'HMO name' })).toBeTruthy()
    const health = within(await openSection('Health information'))
    expect(health.getByRole('combobox', { name: 'Blood group' })).toBeTruthy()
    expect(health.getByRole('button', { name: 'Add emergency contact' })).toBeTruthy()
    expect(within(await openSection('Verify your NIN')).getByRole('textbox', { name: 'National Identification Number' })).toBeTruthy()
  })

  it('has no Photo or Contact details section: both are in Bio-data, the email and phone after its rows, with no heading', async () => {
    renderPortal(<ProfilePage />, gateway(), {}, { parityB3: true })
    await allShown()
    expect(screen.queryByRole('heading', { name: 'Contact details' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Photo' })).toBeNull()
    expect(screen.queryByText('Contact details')).toBeNull()
    const bio = await openSection('Bio-data')
    const block = await openContactDetails()
    expect(content('Bio-data').contains(block)).toBe(true)
    expect(block.querySelector('h2, h3')).toBeNull()
    expect(within(block).getByText('a•••@example.com')).toBeTruthy()
    // After the Bio-data rows, and the photo before them.
    const rows = within(bio).getByText('Identity assurance').closest('dl') as HTMLElement
    expect(rows.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(bio).getByLabelText('Add profile photo').compareDocumentPosition(rows) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('ends Bio-data with the Access PIN, after the email and phone, under a small heading', async () => {
    renderPortal(<ProfilePage />, gateway(), {}, { parityB3: true })
    const bio = await openSection('Bio-data')
    const pin = within(bio).getByRole('heading', { name: 'Access PIN', level: 3 }).parentElement as HTMLElement
    expect(pin.id).toBe('access-pin')
    expect((bio.querySelector('#contact-details') as HTMLElement).compareDocumentPosition(pin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(pin).getByText('Not configured')).toBeTruthy()
    expect(document.getElementById('access-pin-hint')?.textContent).toBe('4 to 8 digits. You must have signed in within the last 10 minutes to change it.')
    expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull()
  })

  it('holds the emergency contacts in Health information, after its form, with no section or card of their own', async () => {
    renderPortal(<ProfilePage />, gateway(), {}, { parityB3: true })
    await allShown()
    expect(screen.queryByRole('heading', { name: 'Emergency contacts', level: 2 })).toBeNull()
    const health = await openSection('Health information')
    const block = health.querySelector('#emergency-contacts') as HTMLElement
    expect(block.closest('.patient-card')).toBe(health)
    expect(block.classList.contains('patient-card')).toBe(false)
    expect(within(block).getByRole('heading', { name: 'Emergency contacts', level: 3 })).toBeTruthy()
    const save = within(health).getByRole('button', { name: 'Save health information' })
    expect(save.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(block).getByText('If a health worker opens your record in an emergency, verified contacts are told who opened it, where and when. Never medical details.')).toBeTruthy()
    expect(within(block).getByText('Up to 5 contacts.')).toBeTruthy()
  })

  it('shows Health information without the emergency contacts where their routes are not served (404)', async () => {
    renderPortal(<ProfilePage />, gateway({
      'GET /identity/me/emergency-contacts/availability': () => problem(404, 'NOT_FOUND', 'Cannot GET'),
      'GET /identity/me/emergency-contacts': () => problem(404, 'NOT_FOUND', 'Cannot GET'),
    }), {}, { parityB3: true })
    const health = await openSection('Health information')
    expect(within(health).getByRole('combobox', { name: 'Blood group' })).toBeTruthy()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(document.getElementById('emergency-contacts')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Emergency contacts' })).toBeNull()
  })

  it('ends with Delete account, closed, where it is served', async () => {
    renderPortal(<ProfilePage />, gateway({
      'GET /identity/me/account-deletion': () => json({ waitingPeriodSeconds: 1_209_600, confirmationTtlSeconds: 600, request: null }),
    }), {}, { parityB3: true })
    const toggle = await screen.findByRole('button', { name: 'Delete account' })
    await allShown()
    const order = screen.getAllByRole('heading', { level: 2 }).map(title => title.textContent)
    expect(order.at(-1)).toBe('Delete account')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Continue to delete account' })).toBeNull()
    const card = within(await openSection('Delete account'))
    expect(card.getByText('Deleting your account signs you out everywhere and withdraws provider access and your Access PIN, sharing invitations and emergency contacts; your Health ID and medical records are kept, and after 14 days it can’t be undone.')).toBeTruthy()
    expect(card.getByText('You must have signed in within the last 10 minutes.')).toBeTruthy()
    expect(card.getByRole('button', { name: 'Continue to delete account' })).toBeTruthy()
    expect(toggle.getAttribute('aria-describedby')).toBeNull()
  })

  it('says in the closed Delete account heading that its status could not be read, or that a deletion is scheduled', async () => {
    const first = renderPortal(<ProfilePage />, gateway({
      'GET /identity/me/account-deletion': () => problem(500, 'INTERNAL', 'Account deletion is unavailable.'),
    }), {}, { parityB3: true })
    const failed = await screen.findByRole('button', { name: 'Delete account', description: 'Could not load' })
    expect(failed.getAttribute('aria-expanded')).toBe('false')
    expect(within(await openSection('Delete account')).getByRole('alert').textContent).toContain('Account deletion is unavailable.')
    first.view.unmount()

    renderPortal(<ProfilePage />, gateway({
      'GET /identity/me/account-deletion': () => json({ waitingPeriodSeconds: 1_209_600, confirmationTtlSeconds: 600, request: {
        requestId: 'req-1', state: 'pending', requestedAt: '2026-10-08T10:00:00Z', confirmationExpiresAt: null,
        scheduledFor: '2026-10-22T10:00:00Z', blockedReasonCode: null, cancelledAt: null, cancellable: true } }),
    }), {}, { parityB3: true })
    const scheduled = await screen.findByRole('button', { name: 'Delete account', description: 'Scheduled' })
    expect(scheduled.getAttribute('aria-expanded')).toBe('false')
  })

  it('has a heading that is a button in the tab order, which the browser presses with Enter or Space', async () => {
    renderPortal(<ProfilePage />, gateway(), {}, { parityB3: true })
    await allShown()
    const toggle = screen.getByRole('button', { name: 'Coverage', expanded: false }) as HTMLButtonElement
    expect(toggle).toBe(sectionToggle('Coverage'))
    expect(toggle.parentElement).toBe(heading('Coverage'))
    expect(heading('Coverage').tagName).toBe('H2')
    // A native button, never a form's submit, focusable from the keyboard.
    expect([toggle.tagName, toggle.type, toggle.tabIndex, toggle.disabled]).toEqual(['BUTTON', 'button', 0, false])
    toggle.focus()
    expect(document.activeElement).toBe(toggle)
    // A key alone changes nothing: the click the browser sends for it does, so one key never opens and closes it.
    fireEvent.keyDown(toggle, { key: 'Enter' })
    fireEvent.keyUp(toggle, { key: 'Enter' })
    fireEvent.keyDown(toggle, { key: ' ' })
    fireEvent.keyUp(toggle, { key: ' ' })
    expect(isOpen('Coverage')).toBe(false)
    // Enter: the browser sends a click as the key goes down.
    fireEvent.keyDown(toggle, { key: 'Enter' })
    await click(toggle)
    expect(isOpen('Coverage')).toBe(true)
    expect(document.activeElement).toBe(toggle)
    // Space: a click as the key comes up.
    fireEvent.keyDown(toggle, { key: ' ' })
    fireEvent.keyUp(toggle, { key: ' ' })
    await click(toggle)
    expect(isOpen('Coverage')).toBe(false)
    expect(document.activeElement).toBe(toggle)
  })

  it('says in its heading what helps the patient decide to open it, from what the page has read', async () => {
    renderPortal(<ProfilePage />, gateway({ 'GET /ehr/me/health-profile': () => problem(503, 'UPSTREAM_UNAVAILABLE', 'EHR is unavailable.') }),
      {}, { parityB3: true })
    await allShown()
    // The heading is named by its title; what it says beside it is the button's description. Without the health
    // information, 6 of 10 are done, which the completion, always shown, says.
    await waitFor(async () => expect((await completionCard()).textContent).toContain('60% complete'))
    expect(screen.getByRole('button', { name: 'Health information', description: 'Could not load' })).toBeTruthy()
    for (const name of ['Bio-data', 'Coverage', 'From your hid-1.0 account', 'Verify your NIN']) {
      expect(sectionToggle(name).getAttribute('aria-describedby'), name).toBeNull()
    }
    // The read's alert is there once it is opened.
    expect(within(await openSection('Health information')).getByRole('alert').textContent).toContain('EHR is unavailable.')
  })

  it('keeps what was typed while it is closed, and opens with it again', async () => {
    renderPortal(<ProfilePage />, gateway(), {}, { parityB3: true })
    const coverage = within(await openSection('Coverage'))
    fireEvent.change(coverage.getByRole('textbox', { name: 'HMO name' }), { target: { value: 'Hygeia HMO' } })
    const contact = within(await openContactDetails())
    await press(contact.getByRole('button', { name: 'Change email address' }))
    fireEvent.change(contact.getByRole('textbox', { name: 'New email address' }), { target: { value: 'new.address@example.com' } })

    await click(sectionToggle('Coverage'))
    await click(sectionToggle('Bio-data'))
    expect(screen.queryByRole('textbox', { name: 'HMO name' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'New email address' })).toBeNull()

    await openSection('Coverage')
    expect((coverage.getByRole('textbox', { name: 'HMO name' }) as HTMLInputElement).value).toBe('Hygeia HMO')
    expect((coverage.getByRole('button', { name: 'Save coverage' }) as HTMLButtonElement).disabled).toBe(false)
    await openSection('Bio-data')
    expect((contact.getByRole('textbox', { name: 'New email address' }) as HTMLInputElement).value).toBe('new.address@example.com')
  })

  it('stays open after a save, with focus on its heading', async () => {
    renderPortal(<ProfilePage />, gateway(), {}, { parityB3: true })
    const coverage = within(await openSection('Coverage'))
    fireEvent.change(coverage.getByRole('textbox', { name: 'HMO name' }), { target: { value: 'Hygeia HMO' } })
    await press(coverage.getByRole('button', { name: 'Save coverage' }))
    expect(await coverage.findByText('Your coverage details were saved.')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(heading('Coverage')))
    expect(isOpen('Coverage')).toBe(true)
    // The completion read again counts the HMO: 9 of 12.
    await waitFor(async () => expect((await completionCard()).textContent).toContain('75% complete'))
    expect(SECTIONS.filter(isOpen)).toEqual(['Coverage'])
  })

  it('is open or closed in the page\'s memory only, and closed again when the page is next opened', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const { view } = renderPortal(<ProfilePage />, gateway(), {}, { parityB3: true })
    await openSection('Coverage')
    await openSection('Health information')
    expect(setItem).not.toHaveBeenCalled()
    view.unmount()
    renderPortal(<ProfilePage />, gateway(), {}, { parityB3: true })
    await allShown()
    expect(SECTIONS.filter(isOpen)).toEqual([])
  })

  it('is the open card it was where it is shown off the profile page', async () => {
    renderPortal(<EmergencyContactsCard alone />, gateway())
    expect(within(await screen.findByRole('heading', { name: 'Health information' })).queryByRole('button')).toBeNull()
    expect(screen.getByRole('button', { name: 'Add emergency contact' })).toBeTruthy()
  })
})

describe('a link to a section of the profile', () => {
  it('opens it in the commit that shows it, after its read, with focus on its heading\'s button', async () => {
    let answer!: () => void
    const read = new Promise<void>(resolve => { answer = resolve })
    atProfile('/profile#coverage', gateway({ 'GET /identity/me/profile-details': async () => { await read; return json(details) } }))
    await screen.findByRole('heading', { name: 'Bio-data' })
    expect(screen.queryByRole('heading', { name: 'Coverage' })).toBeNull()
    const shown = focusWhenShown(() => document.querySelector<HTMLElement>('#coverage h2 > button'))
    // Answered outside act, as a fetch's answer arrives: React renders the section in one task, and runs effects later.
    environment.IS_REACT_ACT_ENVIRONMENT = false
    answer()
    const { element, focused } = await shown
    expect(element.getAttribute('aria-expanded')).toBe('true')
    expect(focused).toBe(element)
    environment.IS_REACT_ACT_ENVIRONMENT = undefined
    await allShown()
    expect(SECTIONS.filter(isOpen)).toEqual(['Coverage'])
    expect(within(content('Coverage')).getByRole('textbox', { name: 'HMO name' })).toBeTruthy()
  })

  it.each([
    ['bio-data', 'Bio-data'], ['health-information', 'Health information'], ['nin-verification', 'Verify your NIN'],
  ])('to #%s opens %s, and only it', async (id, name) => {
    atProfile(`/profile#${id}`)
    await allShown()
    await waitFor(() => expect(document.activeElement).toBe(sectionToggle(name)))
    expect(SECTIONS.filter(isOpen)).toEqual([name])
  })

  it.each([['/profile#emergency-contacts'], ['/settings#emergency-contacts']])('to %s opens Health information, alone, with focus on the emergency contacts', async at => {
    renderPortal(<Routes><Route path="/profile" element={<ProfilePage />} /><Route path="/settings" element={<SettingsRedirect />} /></Routes>,
      gateway(), {}, { parityB3: true, at })
    await allShown()
    const title = await screen.findByRole('heading', { name: 'Emergency contacts', level: 3 })
    await waitFor(() => expect(document.activeElement).toBe(title))
    expect(SECTIONS.filter(isOpen)).toEqual(['Health information'])
    expect(content('Health information').contains(title)).toBe(true)
  })

  it('to /settings opens the profile, every section closed', async () => {
    renderPortal(<Routes><Route path="/profile" element={<ProfilePage />} /><Route path="/settings" element={<SettingsRedirect />} /></Routes>,
      gateway(), {}, { parityB3: true, at: '/settings' })
    expect(await screen.findByRole('heading', { name: 'Your profile', level: 1 })).toBeTruthy()
    await allShown()
    expect(SECTIONS.filter(isOpen)).toEqual([])
  })

  it('to #emergency-contacts on hid-system main, before the health information is served, opens Health information holding them alone', async () => {
    novu.on = false
    atProfile('/profile#emergency-contacts', gateway({ 'GET /ehr/me/health-profile': () => problem(404, 'NOT_FOUND', 'Cannot GET') }))
    const title = await screen.findByRole('heading', { name: 'Emergency contacts', level: 3 })
    await waitFor(() => expect(document.activeElement).toBe(title))
    // Main sends no hid-1.0 health details, so there is no section for them.
    const order = screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent)
    expect(order).toEqual(['Profile completion', 'Bio-data', 'Coverage', 'Health information', 'Verify your NIN'])
    expect(isOpen('Health information')).toBe(true)
    expect(within(content('Health information')).queryByRole('combobox', { name: 'Blood group' })).toBeNull()
    expect(within(content('Health information')).getByRole('button', { name: 'Add emergency contact' })).toBeTruthy()
  })

  it('to #access-pin opens Bio-data, alone, with focus on the Access PIN heading', async () => {
    atProfile('/profile#access-pin')
    await allShown()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Access PIN', level: 3 })))
    expect(SECTIONS.filter(isOpen)).toEqual(['Bio-data'])
  })

  it('to #contact-details opens Bio-data, alone, with focus on the email and phone', async () => {
    atProfile('/profile#contact-details')
    await allShown()
    await waitFor(() => expect(document.activeElement).toBe(document.getElementById('contact-details')))
    expect(SECTIONS.filter(isOpen)).toEqual(['Bio-data'])
    expect(within(content('Bio-data')).getByRole('button', { name: 'Change email address' })).toBeTruthy()
  })

  it('to #profile-completion opens nothing, and takes focus to the completion\'s heading', async () => {
    atProfile('/profile#profile-completion')
    await allShown()
    await waitFor(() => expect(document.activeElement).toBe(heading('Profile completion')))
    expect(SECTIONS.filter(isOpen)).toEqual([])
  })

  it('stays closed once the patient closes it, until a link names it again', async () => {
    atProfile('/profile#coverage')
    await allShown()
    await waitFor(() => expect(document.activeElement).toBe(sectionToggle('Coverage')))
    const toggle = sectionToggle('Coverage')
    await press(toggle)
    expect(isOpen('Coverage')).toBe(false)
    // The completion's "Your HMO" names it again: it is open by the time focus reaches it, in the same commit.
    let openAsFocused: string | null = null
    toggle.addEventListener('focus', () => { openAsFocused = toggle.getAttribute('aria-expanded') })
    const link = within(await completionCard()).getByRole('link', { name: 'Your HMO' })
    await press(link)
    expect(document.activeElement).toBe(toggle)
    expect(openAsFocused).toBe('true')
  })

  it('with a # that does not decode, or names no section, opens nothing', async () => {
    for (const at of ['/profile#%E0%A4%A', '/profile#%', '/profile#nothing-here']) {
      const { view } = atProfile(at)
      await allShown()
      expect(SECTIONS.filter(isOpen), at).toEqual([])
      view.unmount()
    }
  })
})
