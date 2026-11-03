import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor, within } from '@testing-library/react'
import type { AccessHistory, AccessRequest, PatientNotification, PatientProfile } from '../api'
import type { AccessLogPage } from '../accessLog'
import { Overview, recentActivity } from '../routes/Overview'
import { forgetShareServed } from '../shareServed'
import { json, press, problem, profile, renderPortal, type Handler } from './portalHarness'

/**
 * Home made ready for launch (the launch audit's Home and Health ID card findings): every read that fails says so in
 * plain words with its own Try again, loading is said as loading and never as "nothing here", nothing moves under the
 * patient's finger as late reads arrive, one press of Try again reads once and leaves focus where the outcome is, the
 * patient's own actions read as theirs, and an empty Home says what will appear there.
 */
const NOW = Date.parse('2026-10-28T12:00:00Z')
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(NOW); forgetShareServed() })

const at = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString()
const patient: PatientProfile = { ...profile, gender: 'female', state: 'Lagos', ninVerified: true, email: 'ada@example.com',
  phone: '+2348031234567', phoneVerified: false, hasPhoto: false }
const grant = (id: string): AccessHistory['items'][number] => ({ consentGrantId: id, scope: 'read', purpose: 'direct-care', status: 'active',
  startsAt: at(48), expiresAt: at(-24), reason: null, facilityName: 'Lagos General' })
const request = (id: string): AccessRequest => ({ accessRequestId: id, facilityId: 'f-1', facilityName: 'Lagos General', scope: 'read',
  reason: 'Follow-up', status: 'pending', requestedDurationMinutes: 60, requestedAt: at(1), approvedAt: null, deniedAt: null, deniedReason: null })
const notice = (id: string, hoursAgo: number): PatientNotification => ({ id, notificationCode: 'SECURITY_PASSWORD_CHANGED',
  resourceType: 'account', resourceId: null, metadata: {}, readAt: null, createdAt: at(hoursAgo) })
const logPage: AccessLogPage = { nextBefore: null, events: [
  { id: 'e-1', at: at(2), action: 'viewed', actorKind: 'clinician', actorName: 'Dr Bello', facilityName: 'Lagos General' },
] }
const records = {
  encounters: [{ id: 'enc-1', facilityId: 'f-1', encounterType: 'outpatient_visit', status: 'completed', startedAt: at(100), endedAt: at(99) }],
  notes: [{ id: 'note-1', encounterId: 'enc-1', facilityId: 'f-1', noteType: 'consultation', title: 'Malaria review', status: 'signed',
    revisionNo: 1, content: 'Private clinical text', signedAt: at(98) }],
  importedRecords: [], importedHealthProfile: null, limit: 50,
}
const savedHealth = { bloodGroup: 'B+', genotype: 'AA', allergies: 'Shellfish', currentMedications: null, chronicConditions: null,
  medicalNotes: null, rowVersion: 3, updatedAt: at(5) }

/** Every read Home sends, each replaceable; a contact is on file, so only what a test changes needs attention. */
function gateway(overrides: Partial<Record<string, () => Response | Promise<Response>>> = {}): Handler {
  return (path, method) => {
    const override = overrides[path]
    if (override) return override()
    if (method !== 'GET') return problem(405, 'METHOD_NOT_ALLOWED', path)
    switch (path) {
      case '/identity/me': return json(patient)
      case '/ehr/me/records': return json(records)
      case '/identity/me/access-history': return json({ items: [grant('g-1')] })
      case '/identity/me/access-requests': return json([])
      case '/identity/me/notifications': return json([notice('n-1', 50)])
      case '/identity/me/access-log': return json(logPage)
      case '/identity/me/profile-details': return json({ hospitalCurrentlyUsing: 'Lagos University Teaching Hospital', hmoName: 'AXA', rowVersion: 1 })
      case '/ehr/me/health-profile': return json(savedHealth)
      case '/identity/me/emergency-contacts/availability': return json({ delivery: true, channels: ['sms', 'email'] })
      case '/identity/me/emergency-contacts': return json([])
      default: return problem(404, 'NOT_FOUND', path)
    }
  }
}
const served = { parityB2: true, parityB3: true }
/** A read that fails, and is not one the client tries again by itself. */
const failure = () => json({ type: 'about:blank', title: 'Unavailable', status: 503, code: 'UPSTREAM_UNAVAILABLE',
  detail: 'This information is unavailable right now.', retryable: false }, 503)
const CARD = 'Ada Example’s Health ID card'
const region = async (name: string) => within(await screen.findByRole('region', { name }))
const tiles = () => screen.queryByRole('group', { name: 'Your record at a glance' })
const tile = (href: string) => within(tiles()!).getAllByRole('link').find(link => link.getAttribute('href') === href)!
const alertWith = async (text: string) => (await screen.findByText(text)).closest<HTMLElement>('[role="alert"]')!
const focused = () => document.activeElement

function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>(done => { resolve = done })
  return { promise, resolve }
}

/**
 * A fast double click as a browser delivers it: two clicks, each its own event. React renders the first and starts its
 * read before the second lands, but has not yet drawn the loading state that takes the button away.
 */
async function clickTwice(button: HTMLElement) {
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  await Promise.resolve()
  button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

describe('HCS-04: blood group, genotype and allergies that could not be read', () => {
  it('says so under the card, with Try again, and puts them on the card once they load', async () => {
    let failed = true
    renderPortal(<Overview />, gateway({ '/ehr/me/health-profile': () => failed ? failure() : json(savedHealth) }), {}, served)
    const card = await screen.findByRole('region', { name: CARD })
    const alert = await alertWith('Couldn’t load your blood group, genotype and allergies')
    // Right under the card, before anything else on the page.
    expect(card.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await waitFor(() => expect(tiles()).not.toBeNull())
    expect(alert.compareDocumentPosition(tiles()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    failed = false
    await press(within(alert).getByRole('button', { name: 'Try again loading your blood group, genotype and allergies' }))
    await waitFor(() => expect(within(card).getByText('Shellfish')).toBeTruthy())
    expect(screen.queryByText('Couldn’t load your blood group, genotype and allergies')).toBeNull()
    // Focus goes to the card, where the outcome is.
    await waitFor(() => expect(focused()).toBe(card))
  })

  it('says nothing where the backend does not serve health information (404)', async () => {
    renderPortal(<Overview />, gateway({ '/ehr/me/health-profile': () => problem(404, 'NOT_FOUND', 'Cannot GET') }), {}, served)
    await screen.findByText('Malaria review')
    expect(screen.queryByText('Couldn’t load your blood group, genotype and allergies')).toBeNull()
  })
})

describe('HCS-07: access requests and activity that could not be read', () => {
  it('says the access requests could not be checked, with Try again, and shows a waiting request once it loads', async () => {
    let failed = true
    renderPortal(<Overview />, gateway({ '/identity/me/access-requests': () => failed ? failure() : json([request('r-1')]) }), {}, served)
    const alert = await alertWith('Couldn’t check for access requests')
    failed = false
    await press(within(alert).getByRole('button', { name: 'Try again checking for access requests' }))
    expect(await screen.findByText('Lagos General wants to see your records')).toBeTruthy()
    expect(screen.queryByText('Couldn’t check for access requests')).toBeNull()
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { level: 1 })))
  })

  it('says some activity could not be loaded rather than that there is none, and loads it again', async () => {
    let failed = true
    renderPortal(<Overview />, gateway({ '/identity/me/access-log': () => failed ? failure() : json(logPage),
      '/identity/me/notifications': () => json([]) }), {}, served)
    const activity = await region('Activity')
    const alert = (await activity.findByText('Couldn’t load some of your activity')).closest<HTMLElement>('[role="alert"]')!
    expect(activity.queryByText(/you’ll see it here/)).toBeNull()
    expect(activity.queryByText('No activity yet')).toBeNull()
    failed = false
    await press(within(alert).getByRole('button', { name: 'Try again loading who viewed or changed your records' }))
    expect(await activity.findByText('Dr Bello at Lagos General: viewed your record')).toBeTruthy()
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { name: 'Activity' })))
  })

  it('still shows the activity that did load when the notifications could not be read', async () => {
    renderPortal(<Overview />, gateway({ '/identity/me/notifications': failure }), {}, served)
    const activity = await region('Activity')
    expect(await activity.findByText('Dr Bello at Lagos General: viewed your record')).toBeTruthy()
    expect(activity.getByRole('button', { name: 'Try again loading recent activity' })).toBeTruthy()
  })
})

describe('HCS-08: the tiles while loading and after a failed read', () => {
  it('says a count is loading, to a screen reader too, with no "…"', async () => {
    const answer = deferred()
    renderPortal(<Overview />, gateway({ '/ehr/me/records': () => answer.promise }), {}, served)
    await waitFor(() => expect(tiles()).not.toBeNull())
    const count = tile('/records')
    expect(count.textContent).not.toContain('…')
    expect(within(count).getByText('Loading').className).toContain('sr-only')
    await act(async () => { answer.resolve(json(records)) })
  })

  it('shows a dash and says the count could not be loaded, for the records and for the facilities with access', async () => {
    renderPortal(<Overview />, gateway({ '/ehr/me/records': failure, '/identity/me/access-history': failure }), {}, served)
    await screen.findByText('Couldn’t load your records')
    await waitFor(() => expect(tile('/access').textContent).toContain('Couldn’t load'))
    for (const href of ['/records', '/access']) {
      expect(tile(href).textContent).not.toContain('…')
      expect(tile(href).textContent).toContain('—')
      expect(tile(href).textContent).toContain('Couldn’t load')
    }
  })
})

describe('HCS-09: Home while it loads', () => {
  it('says activity is loading, and never that there is none, until it has been read', async () => {
    const notices = deferred()
    const log = deferred()
    renderPortal(<Overview />, gateway({ '/identity/me/notifications': () => notices.promise, '/identity/me/access-log': () => log.promise }), {}, served)
    const card = await screen.findByRole('region', { name: 'Activity' })
    expect(within(card).getByRole('status', { name: 'Loading activity' })).toBeTruthy()
    expect(card.getAttribute('aria-busy')).toBe('true')
    expect(within(card).queryByText(/you’ll see it here/)).toBeNull()
    expect(within(card).queryByText('No activity yet')).toBeNull()
    await act(async () => { notices.resolve(json([])); log.resolve(json(logPage)) })
    expect(await within(card).findByText('Dr Bello at Lagos General: viewed your record')).toBeTruthy()
    expect(card.getAttribute('aria-busy')).toBeNull()
  })

  it('says the latest from the providers is loading, and that the card is busy', async () => {
    const answer = deferred()
    renderPortal(<Overview />, gateway({ '/ehr/me/records': () => answer.promise }), {}, served)
    const card = await screen.findByRole('region', { name: 'Latest from your providers' })
    expect(within(card).getByRole('status', { name: 'Loading the latest from your providers' })).toBeTruthy()
    expect(card.getAttribute('aria-busy')).toBe('true')
    await act(async () => { answer.resolve(json(records)) })
    expect(await within(card).findByText('Malaria review')).toBeTruthy()
    expect(card.getAttribute('aria-busy')).toBeNull()
  })

  it('shows the tiles only once what goes above them is known, so they do not move', async () => {
    const requests = deferred()
    const contacts = deferred()
    renderPortal(<Overview />, gateway({ '/identity/me/access-requests': () => requests.promise,
      '/identity/me/emergency-contacts': () => contacts.promise, '/identity/me/profile-details': () => json({ hospitalCurrentlyUsing: null, hmoName: null, rowVersion: 1 }) }),
    {}, served)
    await screen.findByRole('region', { name: CARD })
    expect(screen.getByRole('status', { name: 'Loading your overview' })).toBeTruthy()
    expect(tiles()).toBeNull()
    await act(async () => { requests.resolve(json([request('r-1')])) })
    expect(tiles()).toBeNull()
    expect(screen.queryByText('Lagos General wants to see your records')).toBeNull()
    await act(async () => { contacts.resolve(json([])) })
    // All at once: the request, what is left to do, then the tiles.
    await waitFor(() => expect(tiles()).not.toBeNull())
    const alert = screen.getByText('Lagos General wants to see your records')
    const checklist = screen.getByRole('heading', { name: 'Finish your Health ID' })
    expect(alert.compareDocumentPosition(checklist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(checklist.compareDocumentPosition(tiles()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('status', { name: 'Loading your overview' })).toBeNull()
  })
})

describe('HCS-09: the requests answering before the profile', () => {
  it('still waits for what the profile lacks before drawing the tiles', async () => {
    const me = deferred()
    const contacts = deferred()
    renderPortal(<Overview />, gateway({ '/identity/me': () => me.promise, '/identity/me/emergency-contacts': () => contacts.promise }), {}, served)
    // The requests answer while the profile is still being read.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
    await act(async () => { me.resolve(json(patient)) })
    await screen.findByRole('region', { name: CARD })
    expect(tiles()).toBeNull()
    await act(async () => { contacts.resolve(json([])) })
    await waitFor(() => expect(tiles()).not.toBeNull())
  })
})

describe('HCS-10: the patient\'s own actions in Activity', () => {
  it('says whom the patient gave access, and whose access they ended', () => {
    const own: AccessLogPage = { nextBefore: null, events: [
      { id: 'p-1', at: at(3), action: 'access_granted', actorKind: 'patient', actorName: null, facilityName: 'Lagos General Hospital' },
      { id: 'p-2', at: at(4), action: 'access_ended', actorKind: 'patient', actorName: null, facilityName: 'Ikeja Clinic' },
      { id: 'p-3', at: at(5), action: 'access_granted', actorKind: 'patient', actorName: null, facilityName: null },
      { id: 'p-4', at: at(6), action: 'changed', actorKind: 'patient', actorName: null, facilityName: null },
    ] }
    expect(recentActivity(own, []).map(row => row.text)).toEqual([
      'You gave Lagos General Hospital access', 'You ended Ikeja Clinic’s access', 'You gave a facility access', 'You changed your record'])
  })

  it('keeps naming the facility or clinician for what others did', () => {
    const theirs: AccessLogPage = { nextBefore: null, events: [
      { id: 'f-1', at: at(3), action: 'access_granted', actorKind: 'facility', actorName: null, facilityName: 'Ikeja Clinic' },
    ] }
    expect(recentActivity(theirs, []).map(row => row.text)).toEqual(['Ikeja Clinic: got access to your record'])
  })
})

describe('HCS-20: Try again on Home', () => {
  it('reads the profile once however fast Try again is pressed twice', async () => {
    let reads = 0
    const { sent } = renderPortal(<Overview />, gateway({ '/identity/me': () => ++reads === 1 ? failure() : json(patient) }), {}, served)
    await clickTwice(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('HID-ABC234')).toBeTruthy()
    expect(sent.filter(item => item.path === '/identity/me')).toHaveLength(2)
  })

  it('reads the records once however fast their Try again is pressed twice', async () => {
    let reads = 0
    const { sent } = renderPortal(<Overview />, gateway({ '/ehr/me/records': () => ++reads === 1 ? failure() : json(records) }), {}, served)
    const contributions = await region('Latest from your providers')
    await clickTwice(await contributions.findByRole('button', { name: 'Try again loading recent provider contributions' }))
    expect(await contributions.findByText('Malaria review')).toBeTruthy()
    expect(sent.filter(item => item.path === '/ehr/me/records')).toHaveLength(2)
  })

  it('leaves focus on the records card\'s heading once they load, or on the new Try again when they fail again', async () => {
    let reads = 0
    renderPortal(<Overview />, gateway({ '/ehr/me/records': () => ++reads <= 2 ? failure() : json(records) }), {}, served)
    const contributions = await region('Latest from your providers')
    await press(await contributions.findByRole('button', { name: 'Try again loading recent provider contributions' }))
    await waitFor(() => expect(focused()).toBe(contributions.getByRole('button', { name: 'Try again loading recent provider contributions' })))
    await press(contributions.getByRole('button', { name: 'Try again loading recent provider contributions' }))
    expect(await contributions.findByText('Malaria review')).toBeTruthy()
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { name: 'Latest from your providers' })))
  })

  it('leaves focus on the Activity heading once the notifications load', async () => {
    let reads = 0
    renderPortal(<Overview />, gateway({ '/identity/me/notifications': () => ++reads === 1 ? failure() : json([notice('n-1', 50)]) }), {}, served)
    const activity = await region('Activity')
    await press(await activity.findByRole('button', { name: 'Try again loading recent activity' }))
    expect(await activity.findByText('Your Health ID password was changed')).toBeTruthy()
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { name: 'Activity' })))
  })
})

describe('HCS-24: an empty Home', () => {
  it('says what will appear in each section, drawn as an empty state, with the next step', async () => {
    renderPortal(<Overview />, gateway({
      '/ehr/me/records': () => json({ encounters: [], notes: [], importedRecords: [], importedHealthProfile: null, limit: 50 }),
      '/identity/me/notifications': () => json([]), '/identity/me/access-log': () => json({ events: [], nextBefore: null }),
      '/identity/me/access-history': () => json({ items: [] }),
    }), {}, served)
    const contributions = await region('Latest from your providers')
    expect(await contributions.findByText('No visits or notes yet')).toBeTruthy()
    expect(contributions.getByText('Show your Health ID card at your next visit. Visits and notes appear here once a provider signs them.')).toBeTruthy()
    const activity = await region('Activity')
    expect(await activity.findByText('No activity yet')).toBeTruthy()
    expect(activity.getByText('When a hospital asks to see your records, opens them or is given access, you’ll see it here.')).toBeTruthy()
    // The shared empty state's drawing, in both.
    for (const name of ['Latest from your providers', 'Activity']) {
      const drawings = Array.from(screen.getByRole('region', { name }).querySelectorAll('svg')).filter(svg => svg.getAttribute('viewBox') === '0 0 120 96')
      expect(drawings).toHaveLength(1)
    }
  })
})

describe('HCS-28: a profile answer with nothing in it', () => {
  it('says the Health ID could not be read, with Try again and a way to reach support', async () => {
    let reads = 0
    // An answer with no body: the client reads it as nothing (a body of "null" it calls unreadable, and tries again).
    const { sent } = renderPortal(<Overview />, gateway({ '/identity/me': () => ++reads === 1 ? new Response(null, { status: 204 }) : json(patient) }), {}, served)
    expect(await screen.findByText('We couldn’t read your Health ID')).toBeTruthy()
    expect(screen.queryByText(/returned/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Email support' }).getAttribute('href')).toBe('mailto:support@healthidentitydirectory.com')
    await press(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('HID-ABC234')).toBeTruthy()
    expect(sent.filter(item => item.path === '/identity/me')).toHaveLength(2)
  })
})
