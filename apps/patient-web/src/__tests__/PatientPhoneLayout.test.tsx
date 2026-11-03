import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import type { PatientProfile } from '../api'
import { ProfilePage } from '../routes/Portal'
import { ProfileSection, OpenSectionsContext } from '../routes/ProfileSection'
import { ShareRecords } from '../routes/ShareRecords'
import { countryName } from '../profileParity'
import { json, openContactDetails, openSection, problem, profile, renderPortal, type Handler } from './portalHarness'

const novu = vi.hoisted(() => ({ on: true }))
vi.mock('../backendContract', () => ({ usesNovuBackend: () => novu.on }))
afterEach(() => { novu.on = true })

/**
 * What the preview walkthrough of 2 November 2026 found on the patient pages at 320 to 390px (headless Chromium against
 * the mock gateway; docs/LOG.md has the measurements). jsdom lays nothing out, so these guard the classes that fix
 * each one, and the country's name. Fictional people only.
 */
const classesOf = (element: Element | null) => (element?.getAttribute('class') ?? '').split(/\s+/)

describe('the share steps on a phone', () => {
  it('gives each step its own width, so "Access" is not cut short at 320px', async () => {
    // Equal shares (flex-1) left "Access" 37 of its 42px at 320px, ending "Acc…". Each step now takes its name's
    // width, and the lines between them take what is left; the last, with no line after it, takes no more.
    renderPortal(<Routes><Route path="/access/share" element={<ShareRecords />} /></Routes>,
      (path, method) => path === '/identity/me/share-invitations' && method === 'GET'
        ? json({ items: [], limits: { maxOpen: 20, maxNewPerDay: 5, remainingToday: 4 } })
        : problem(404, 'NOT_FOUND', `${method} ${path}`),
      {}, { parityB4: true, at: '/access/share' })
    const list = await screen.findByRole('list', { name: /^Step 1 of 3$/ })
    const steps = within(list).getAllByRole('listitem')
    expect(steps.map(step => step.textContent)).toEqual(['1Who', '2Access', '3Check'])
    for (const step of steps) expect(classesOf(step)).not.toContain('flex-1')
    // Where even that is short, as with Android's larger text in a WebView at 320px (1.15x), only "Access" gives way:
    // "Who" does not shrink (flex-[1_0_auto]) and "Check" takes no more than its name (flex-none). Both shrinking cut
    // both, "W…" and "Acce…".
    expect(classesOf(steps[0]!)).toContain('flex-[1_0_auto]')
    expect(classesOf(steps[1]!)).toContain('flex-auto')
    expect(classesOf(steps.at(-1)!)).toContain('flex-none')
  })

  it('leaves 6px between a step\'s parts on a phone, so the names stay whole up to 1.2x text at 320px', async () => {
    // Measured in Chromium with the names and numbers enlarged: 8px gaps cut "Access" from 1.15x at 320px.
    renderPortal(<Routes><Route path="/access/share" element={<ShareRecords />} /></Routes>,
      (path, method) => path === '/identity/me/share-invitations' && method === 'GET'
        ? json({ items: [], limits: { maxOpen: 20, maxNewPerDay: 5, remainingToday: 4 } })
        : problem(404, 'NOT_FOUND', `${method} ${path}`),
      {}, { parityB4: true, at: '/access/share' })
    const list = await screen.findByRole('list', { name: /^Step 1 of 3$/ })
    for (const element of [list, ...within(list).getAllByRole('listitem')]) {
      expect(classesOf(element)).toEqual(expect.arrayContaining(['gap-1.5', 'sm:gap-2']))
    }
  })
})

describe('a profile section\'s heading on a phone', () => {
  function section(state: string) {
    render(<OpenSectionsContext.Provider value={{ isOpen: () => false, toggle: () => undefined }}>
      <ProfileSection id="health-information" title="Health information" state={state}><p>Blood group</p></ProfileSection>
    </OpenSectionsContext.Provider>)
    return screen.getByRole('button', { name: 'Health information' })
  }

  it('puts the state under the title when both do not fit, rather than squeezing the title', () => {
    // "Saved 20 Oct 2026, 07:00" kept its width (shrink-0) and left "Health information" 49px at 320px, on two lines.
    const button = section('Saved 20 Oct 2026, 07:00')
    const state = document.getElementById('health-information-state')!
    const title = within(button).getByText('Health information')
    expect(state.parentElement).toBe(title.parentElement)
    expect(classesOf(state.parentElement)).toEqual(expect.arrayContaining(['flex', 'flex-wrap', 'min-w-0', 'flex-1']))
    expect(classesOf(state)).not.toContain('shrink-0')
  })

  it('still reads the state as the button\'s description, not its name', () => {
    const button = section('Saved 20 Oct 2026, 07:00')
    expect(button.getAttribute('aria-describedby')).toBe('health-information-state')
    expect(document.getElementById('health-information-state')!.textContent).toBe('Saved 20 Oct 2026, 07:00')
  })
})

/** The profile page with `patient`; Bio-data is "About you". */
function profilePage(patient: PatientProfile) {
  const handler: Handler = (path, method) => {
    if (path === '/identity/me' && method === 'GET') return json(patient)
    if (path === '/identity/me/photo') return problem(404, 'PHOTO_NOT_FOUND', 'No photo')
    if (path === '/identity/me/profile-details') return json({ hospitalCurrentlyUsing: null, hmoName: null, rowVersion: 1 })
    if (path === '/ehr/me/health-profile') return json({ bloodGroup: null, genotype: null, allergies: null, currentMedications: null,
      chronicConditions: null, medicalNotes: null, rowVersion: 0, updatedAt: null })
    if (path === '/identity/me/emergency-contacts/availability') return json({ delivery: true, channels: ['sms'] })
    if (path === '/identity/me/emergency-contacts') return json([])
    return problem(404, 'NOT_FOUND', `${method} ${path}`)
  }
  return renderPortal(<Routes><Route path="/profile" element={<ProfilePage />} /></Routes>, handler, {}, { parityB3: true, at: '/profile' })
}
const withContact = (overrides: Partial<PatientProfile> = {}): PatientProfile =>
  ({ ...profile, email: 'adaeze.okafor@example.test', emailVerified: true, phone: '+2348031234567', phoneVerified: true, hasPhoto: false, ...overrides })

describe('the email and phone in About you on a phone', () => {
  it('lets a long address wrap, and puts Change under it when the two do not fit side by side', async () => {
    // "a•••@example.test" is 122px; at 320px it had 83px beside Change and ran under the button.
    profilePage(withContact())
    const contact = await openContactDetails()
    const email = within(contact).getByText('a•••@example.test')
    expect(classesOf(email)).toEqual(expect.arrayContaining(['min-w-0', '[overflow-wrap:anywhere]']))
    const value = email.closest('dd')!
    // At least 8rem beside "Email", not an equal share of none (flex-1): where that and Change do not fit on one line,
    // the row (flex-wrap) moves Change to a line of its own. Its natural width instead (flex-auto) left "Phone" alone on
    // its line at 320px, the number and its badge going under it.
    expect(classesOf(value)).toContain('flex-[1_1_8rem]')
    expect(classesOf(value)).not.toContain('flex-1')
    expect(classesOf(value.parentElement)).toContain('flex-wrap')
    const phone = within(contact).getByText('+234 •••• 4567')
    expect(classesOf(phone)).toEqual(expect.arrayContaining(['min-w-0', '[overflow-wrap:anywhere]']))
  })
})

describe('the country in About you', () => {
  it('names the country where Health ID holds its two-letter code', async () => {
    profilePage(withContact({ country: 'NG' }))
    const about = await openSection('About you')
    const term = within(about).getByText('Country', { selector: 'dt' })
    expect(term.nextElementSibling?.textContent).toBe('Nigeria')
  })

  it.each([
    ['NG', 'Nigeria'],
    ['gh', 'Ghana'],
    ['GB', 'United Kingdom'],
    ['Nigeria', 'Nigeria'],
    // Not a country's code: shown as Health ID holds it, not as "Unknown Region".
    ['ZZ', 'ZZ'],
    ['XX', 'XX'],
    [' NG ', 'Nigeria'],
  ])('shows %j as %j', (held, shown) => {
    expect(countryName(held)).toBe(shown)
  })
})
