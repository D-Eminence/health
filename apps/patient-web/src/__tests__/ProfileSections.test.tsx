import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, isInaccessible, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import type { PatientProfile } from '../api'
import type { HealthProfile, ProfileDetails } from '../profileParity'
import { ProfilePage } from '../routes/Portal'
import { ProfileCompletionCard } from '../routes/ProfileCompletion'
import { profileCompletion } from '../routes/profileCompletion'
import { focusWhenShown } from './focusWhenShown'
import { heading, json, openSection, press, problem, profile, renderPortal, sectionToggle, type Handler } from './portalHarness'

const novu = vi.hoisted(() => ({ on: true }))
vi.mock('../backendContract', () => ({ usesNovuBackend: () => novu.on }))
const environment = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
afterEach(() => { novu.on = true; environment.IS_REACT_ACT_ENVIRONMENT = undefined })

/**
 * The profile's sections, closed until the patient opens one (the owner's decision of 2026-10-28: "All those profile
 * sections should be auto collapse until click"): the same cards, showing their heading alone, each opened and closed
 * by the button in its heading, and opened by a link to it.
 */
const patient: PatientProfile = {
  ...profile, gender: 'female', state: 'Lagos', ninVerified: false, assuranceState: 'SELF_ASSERTED',
  email: 'ada@example.com', phone: '+2348031234567', phoneVerified: false, hasPhoto: false,
}
const details: ProfileDetails = { hospitalCurrentlyUsing: 'Lagos University Teaching Hospital', hmoName: null, rowVersion: 2 }
const health: HealthProfile = { bloodGroup: 'O+', genotype: 'AA', allergies: null, currentMedications: null, chronicConditions: null,
  medicalNotes: null, rowVersion: 1, updatedAt: '2026-10-28T09:00:00.000Z' }
const hid1 = { content: { blood_group: 'O+', genotype: 'AA', allergies: 'Penicillin' }, updatedAt: '2025-11-03T09:00:00Z' }

/** Every section the profile has, in the order it shows them: 8 of the 12 completion items are done (67%). */
const SECTIONS = ['Profile completion', 'Bio-data', 'Contact details', 'Photo', 'Coverage', 'Health information',
  'From your hid-1.0 account', 'Verify your NIN']

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
    // Nothing inside can be reached while closed: not a link, a field or a button.
    expect(screen.queryByRole('link', { name: 'A profile photo' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change email address' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'HMO name' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Blood group' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'National Identification Number' })).toBeNull()
    // The only buttons are the headings'.
    expect(screen.getAllByRole('button')).toEqual(SECTIONS.map(sectionToggle))
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

  it('opens what it holds: the completion\'s list, the contact changes, the forms', async () => {
    renderPortal(<ProfilePage />, gateway(), {}, { parityB3: true })
    expect(within(await openSection('Profile completion')).getByRole('link', { name: 'A profile photo' })).toBeTruthy()
    expect(within(await openSection('Contact details')).getByRole('button', { name: 'Change email address' })).toBeTruthy()
    expect(within(await openSection('Coverage')).getByRole('textbox', { name: 'HMO name' })).toBeTruthy()
    expect(within(await openSection('Health information')).getByRole('combobox', { name: 'Blood group' })).toBeTruthy()
    expect(within(await openSection('Verify your NIN')).getByRole('textbox', { name: 'National Identification Number' })).toBeTruthy()
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
    // information, 6 of 10 are done.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Profile completion', description: '60% complete' })).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Health information', description: 'Could not load' })).toBeTruthy()
    for (const name of ['Bio-data', 'Contact details', 'Photo', 'Coverage', 'From your hid-1.0 account', 'Verify your NIN']) {
      expect(sectionToggle(name).getAttribute('aria-describedby'), name).toBeNull()
    }
    // The read's alert is there once it is opened.
    expect(within(await openSection('Health information')).getByRole('alert').textContent).toContain('EHR is unavailable.')
  })

  it('keeps what was typed while it is closed, and opens with it again', async () => {
    renderPortal(<ProfilePage />, gateway(), {}, { parityB3: true })
    const coverage = within(await openSection('Coverage'))
    fireEvent.change(coverage.getByRole('textbox', { name: 'HMO name' }), { target: { value: 'Hygeia HMO' } })
    const contact = within(await openSection('Contact details'))
    await press(contact.getByRole('button', { name: 'Change email address' }))
    fireEvent.change(contact.getByRole('textbox', { name: 'New email address' }), { target: { value: 'new.address@example.com' } })

    await click(sectionToggle('Coverage'))
    await click(sectionToggle('Contact details'))
    expect(screen.queryByRole('textbox', { name: 'HMO name' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'New email address' })).toBeNull()

    await openSection('Coverage')
    expect((coverage.getByRole('textbox', { name: 'HMO name' }) as HTMLInputElement).value).toBe('Hygeia HMO')
    expect((coverage.getByRole('button', { name: 'Save coverage' }) as HTMLButtonElement).disabled).toBe(false)
    await openSection('Contact details')
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Profile completion', description: '75% complete' })).toBeTruthy())
    expect(isOpen('Profile completion')).toBe(false)
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
    const completion = profileCompletion({ profile: patient, details, health, emergencyContacts: [] })
    renderPortal(<ProfileCompletionCard completion={completion} />, gateway())
    expect(within(heading('Profile completion')).queryByRole('button')).toBeNull()
    expect(screen.getByRole('link', { name: 'A profile photo' })).toBeTruthy()
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
    ['contact-details', 'Contact details'], ['bio-data', 'Bio-data'], ['photo', 'Photo'], ['health-information', 'Health information'],
    ['nin-verification', 'Verify your NIN'], ['profile-completion', 'Profile completion'],
  ])('to #%s opens %s, and only it', async (id, name) => {
    atProfile(`/profile#${id}`)
    await allShown()
    await waitFor(() => expect(document.activeElement).toBe(sectionToggle(name)))
    expect(SECTIONS.filter(isOpen)).toEqual([name])
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
    const link = within(await openSection('Profile completion')).getByRole('link', { name: 'Your HMO' })
    await press(link)
    expect(document.activeElement).toBe(toggle)
    expect(openAsFocused).toBe('true')
    expect(isOpen('Profile completion')).toBe(true)
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
