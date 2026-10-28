import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import type { AccessHistory, AccessRequest, PatientNotification, PatientProfile, PatientRecords } from '../api'
import type { AccessLogPage } from '../accessLog'
import {
  Overview, RECENT_ROWS, activeAccesses, attentionItems, pendingRequests, providerContributions, recentActivity,
} from '../routes/Overview'
import { ProfilePage } from '../routes/Portal'
import { json, press, problem, profile, renderPortal, type Handler } from './portalHarness'
import { forgetShareServed } from '../shareServed'

const novu = vi.hoisted(() => ({ on: true }))
vi.mock('../backendContract', () => ({ usesNovuBackend: () => novu.on }))
// Grants end relative to now: the tests' now is fixed.
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(NOW); forgetShareServed() })

/**
 * The home dashboard as hid-1.0 had it (HomeDashboard.tsx; hid-1.0 parity B3, contract D), against the backend with
 * 0093 and 0094 and against today's.
 */
const NOW = Date.parse('2026-10-28T12:00:00Z')
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString()
const patient: PatientProfile = { ...profile, gender: 'female', state: 'Lagos', ninVerified: false, email: 'ada@example.com',
  phone: '+2348031234567', phoneVerified: false, hasPhoto: false }
const grant = (id: string, status: string, expiresAt: string, facilityName = 'Lagos General'): AccessHistory['items'][number] => ({
  consentGrantId: id, scope: 'read', purpose: 'direct-care', status, startsAt: at(48), expiresAt, reason: null, facilityName })
const request = (id: string, status: string): AccessRequest => ({ accessRequestId: id, facilityId: 'f-1', facilityName: 'Lagos General',
  scope: 'read', reason: 'Follow-up', status, requestedDurationMinutes: 60, requestedAt: at(1), approvedAt: null, deniedAt: null, deniedReason: null })
const notice = (id: string, hoursAgo: number, code = 'ACCESS_REQUEST_RECEIVED'): PatientNotification => ({ id, notificationCode: code,
  resourceType: 'access-request', resourceId: null, metadata: {}, readAt: null, createdAt: at(hoursAgo) })
const logPage: AccessLogPage = { nextBefore: null, events: [
  { id: 'e-1', at: at(2), action: 'viewed', actorKind: 'clinician', actorName: 'Dr Bello', facilityName: 'Lagos General' },
  { id: 'e-2', at: at(30), action: 'access_granted', actorKind: 'facility', actorName: null, facilityName: 'Ikeja Clinic' },
] }
const records = {
  encounters: [{ id: 'enc-1', facilityId: 'f-1', encounterType: 'outpatient_visit', status: 'completed', startedAt: at(100), endedAt: at(99) }],
  notes: [{ id: 'note-1', encounterId: 'enc-1', facilityId: 'f-1', noteType: 'consultation', title: 'Malaria review', status: 'signed',
    revisionNo: 1, content: 'Private clinical text', signedAt: at(98) }],
  importedRecords: [], importedHealthProfile: { content: { blood_group: 'O+', genotype: 'AS', allergies: 'Penicillin' }, updatedAt: null }, limit: 50,
}
const savedHealth = { bloodGroup: 'B+', genotype: 'AA', allergies: 'Shellfish', currentMedications: null, chronicConditions: null,
  medicalNotes: null, rowVersion: 3, updatedAt: at(5) }
const emptyHealth = { ...savedHealth, bloodGroup: null, genotype: null, allergies: null, rowVersion: 0, updatedAt: null }

/** The backend with 0093 and 0094: every card's read, each replaceable. */
function gateway(overrides: Partial<Record<string, () => Response>> = {}): Handler {
  return (path, method) => {
    const override = overrides[path]
    if (override) return override()
    if (method !== 'GET') return problem(405, 'METHOD_NOT_ALLOWED', path)
    switch (path) {
      case '/identity/me': return json(patient)
      case '/ehr/me/records': return json(records)
      case '/identity/me/access-history': return json({ items: [grant('g-1', 'active', at(-24)), grant('g-2', 'active', at(1)), grant('g-3', 'revoked', at(-24))] })
      case '/identity/me/access-requests': return json([request('r-1', 'pending'), request('r-2', 'approved'), request('r-3', 'PENDING')])
      case '/identity/me/notifications': return json([notice('n-1', 1), notice('n-2', 50, 'SECURITY_PASSWORD_CHANGED')])
      case '/identity/me/access-log': return json(logPage)
      case '/identity/me/profile-details': return json({ hospitalCurrentlyUsing: 'Lagos University Teaching Hospital', hmoName: null, rowVersion: 1 })
      case '/ehr/me/health-profile': return json(savedHealth)
      case '/identity/me/emergency-contacts/availability': return json({ delivery: true, channels: ['sms', 'email'] })
      case '/identity/me/emergency-contacts': return json([])
      default: return problem(404, 'NOT_FOUND', path)
    }
  }
}
const parity = { parityB2: true, parityB3: true }
const region = async (name: string) => within((await screen.findByRole('heading', { name })).closest('.patient-card') as HTMLElement)
const tiles = () => within(screen.getByRole('list', { name: 'Health summary' })).getAllByRole('listitem')
  .map(tile => [tile.querySelector('.patient-tile-label')?.textContent, tile.querySelector('.patient-tile-value')?.textContent])

describe('the overview with patient parity served', () => {
  it('shows the black Health ID card: name, the Health ID as plain text, the NIN badge, the completion and the two buttons', async () => {
    renderPortal(<Overview />, gateway(), {}, parity)
    const card = await region('Ada Example')
    expect((await screen.findByRole('heading', { name: 'Ada Example' })).closest('.patient-identity-card')).toBeTruthy()
    expect(card.getByText('HID-ABC234').className).toContain('patient-hid-plain')
    expect(card.queryByRole('button', { name: 'Copy HID' })).toBeNull()
    expect(card.getByText('NIN not verified')).toBeTruthy()
    expect(card.getByText('AE')).toBeTruthy()
    // No photo, HMO, verified NIN or emergency contact: 8 of 12 is 67%.
    expect(await card.findByText('67%')).toBeTruthy()
    expect(card.getByRole('link', { name: 'Share Records' }).getAttribute('href')).toBe('/access')
    expect(card.getByRole('link', { name: 'Add Health Information' }).getAttribute('href')).toBe('/profile#health-information')
    expect(card.getByRole('link', { name: 'See what is missing from your profile' }).getAttribute('href')).toBe('/profile#profile-completion')
  })

  it('shows the Health ID on the profile bio-data as plain text, with no Copy HID button', async () => {
    renderPortal(<ProfilePage />, gateway(), {}, parity)
    const bio = await region('Bio-data')
    expect(bio.getByText('HID-ABC234').className).toContain('patient-hid-plain')
    expect(bio.queryByRole('button', { name: 'Copy HID' })).toBeNull()
  })

  it('shows the health summary tiles from what the patient entered, and the active accesses', async () => {
    renderPortal(<Overview />, gateway(), {}, parity)
    await waitFor(() => expect(tiles()).toEqual([['Blood group', 'B+'], ['Genotype', 'AA'], ['Allergies', 'Shellfish'], ['Active accesses', '1']]))
  })

  it('shows what the patient kept in hid-1.0 while they have entered nothing', async () => {
    renderPortal(<Overview />, gateway({ '/ehr/me/health-profile': () => json(emptyHealth) }), {}, parity)
    await waitFor(() => expect(tiles().slice(0, 3)).toEqual([['Blood group', 'O+'], ['Genotype', 'AS'], ['Allergies', 'Penicillin']]))
  })

  it('shows nothing from hid-1.0 once the patient has saved their own, even with every field cleared', async () => {
    renderPortal(<Overview />, gateway({ '/ehr/me/health-profile': () => json({ ...emptyHealth, rowVersion: 3, updatedAt: at(1) }) }), {}, parity)
    // The records, with the hid-1.0 details, are read: they are not shown as the patient's current health.
    await screen.findByText('Malaria review')
    await waitFor(() => expect(tiles().slice(0, 3)).toEqual([['Blood group', 'Not added'], ['Genotype', 'Not added'], ['Allergies', 'Not added']]))
  })

  it('lists what needs attention, each a link to where it is done', async () => {
    renderPortal(<Overview />, gateway(), {}, parity)
    const card = await region('Attention required')
    await waitFor(() => expect(card.getAllByRole('link').map(link => [link.textContent, link.getAttribute('href')])).toEqual([
      ['2 access requests are waiting for your decision →', '/access'],
      ['Your NIN is not verified yet →', '/profile#nin-verification'],
      ['Your profile is 67% complete →', '/profile#profile-completion'],
      ['You have no emergency contact →', '/settings#emergency-contacts'],
    ]))
  })

  it('shows the newest activity from the access log and the notifications, and the latest provider contributions without their content', async () => {
    renderPortal(<Overview />, gateway(), {}, parity)
    const activity = await region('Recent activity')
    await waitFor(() => expect(activity.getAllByRole('link').map(link => link.textContent)).toEqual([
      'A facility asked to access your health information', 'Dr Bello at Lagos General: viewed your record',
      'Ikeja Clinic: was given access to your record', 'Your Health ID password was changed']))
    const contributions = await region('Recent provider contributions')
    await waitFor(() => expect(contributions.getByText('Malaria review')).toBeTruthy())
    expect(contributions.getByText('outpatient visit')).toBeTruthy()
    expect(contributions.queryByText('Private clinical text')).toBeNull()
    expect(screen.queryByText('Private clinical text')).toBeNull()
  })

  it('says a card could not be read, with its own Try again, and keeps the rest', async () => {
    let failed = true
    renderPortal(<Overview />, gateway({ '/ehr/me/records': () => failed ? problem(503, 'UPSTREAM_UNAVAILABLE', 'Records are unavailable.') : json(records) }), {}, parity)
    const contributions = await region('Recent provider contributions')
    expect((await contributions.findByRole('alert')).textContent).toContain('Records are unavailable.')
    expect(screen.getByRole('heading', { name: 'Recent activity' })).toBeTruthy()
    failed = false
    await press(contributions.getByRole('button', { name: 'Try again loading recent provider contributions' }))
    expect(await contributions.findByText('Malaria review')).toBeTruthy()
  })

  it('takes Add Health Information to the profile\'s health information, with focus on it', async () => {
    renderPortal(<Routes><Route path="/" element={<Overview />} /><Route path="/profile" element={<ProfilePage />} /></Routes>, gateway(), {}, parity)
    await press(await screen.findByRole('link', { name: 'Add Health Information' }))
    const heading = await screen.findByRole('heading', { name: 'Health information' })
    await waitFor(() => expect(document.activeElement).toBe(heading))
  })
})

describe('Share Records (hid-1.0 parity B4, hid-system 0095)', () => {
  it('opens the share flow once the backend serves sharing (its probe answers 200)', async () => {
    const { sent } = renderPortal(<Overview />, gateway({ '/identity/me/share-invitations': () => json({ items: [],
      limits: { maxOpen: 20, maxNewPerDay: 5, remainingToday: 5 } }) }), {}, { ...parity, parityB4: true })
    await waitFor(() => expect(screen.getByRole('link', { name: 'Share Records' }).getAttribute('href')).toBe('/access/share'))
    expect(sent.filter(item => item.path === '/identity/me/share-invitations')).toHaveLength(1)
  })

  it('opens Access and consent where sharing is not served (404), and says nothing', async () => {
    renderPortal(<Overview />, gateway({ '/identity/me/share-invitations': () => problem(404, 'NOT_FOUND', 'Cannot GET') }), {},
      { ...parity, parityB4: true })
    expect((await screen.findByRole('link', { name: 'Share Records' })).getAttribute('href')).toBe('/access')
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})

describe('the overview on today\'s backend', () => {
  it('shows no completion, health tiles, Add Health Information or NIN badge where none is served, and asks nothing more', async () => {
    const { sent } = renderPortal(<Overview />, gateway({ '/identity/me': () => json(profile) }))
    await screen.findByText('HID-ABC234')
    await waitFor(() => expect(tiles()).toEqual([['Active accesses', '1']]))
    expect(screen.queryByText(/% of your profile is complete/)).toBeNull()
    expect(screen.queryByRole('link', { name: 'Add Health Information' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Share Records' })).toBeTruthy()
    expect(screen.queryByText(/NIN (not )?verified/)).toBeNull()
    // Only the pending requests need attention here.
    const attention = await region('Attention required')
    expect(attention.getAllByRole('link').map(link => link.textContent)).toEqual(['2 access requests are waiting for your decision →'])
    expect(sent.some(item => item.path.startsWith('/identity/me/emergency-contacts'))).toBe(false)
    expect(sent.some(item => item.path === '/identity/me/photo')).toBe(false)
  })

  it('shows no attention card when nothing needs it', async () => {
    renderPortal(<Overview />, gateway({ '/identity/me': () => json(profile), '/identity/me/access-requests': () => json([]) }))
    await screen.findByText('HID-ABC234')
    await screen.findByRole('heading', { name: 'Recent activity' })
    expect(screen.queryByRole('heading', { name: 'Attention required' })).toBeNull()
  })
})

describe('what the overview counts', () => {
  it('counts only active grants that have not ended', () => {
    expect(activeAccesses({ items: [grant('a', 'active', at(-1)), grant('b', 'active', at(1)), grant('c', 'expired', at(-1)),
      grant('d', 'revoked', at(-1))] }, NOW)).toBe(1)
    expect(activeAccesses(null)).toBe(0)
    expect(activeAccesses({ items: 'none' } as unknown as AccessHistory)).toBe(0)
  })

  it('counts pending requests whatever their case', () => {
    expect(pendingRequests([request('a', 'pending'), request('b', 'Pending'), request('c', 'denied')])).toBe(2)
    expect(pendingRequests(null)).toBe(0)
  })

  it('merges the access log and the notifications, newest first, at most five', () => {
    const notices = Array.from({ length: 6 }, (_, index) => notice(`n-${index}`, index * 10 + 5))
    const rows = recentActivity(logPage, notices)
    expect(rows).toHaveLength(RECENT_ROWS)
    expect(rows.map(row => row.id)).toEqual(['log-e-1', 'notice-n-0', 'notice-n-1', 'notice-n-2', 'log-e-2'])
    expect(rows[0]).toMatchObject({ to: '/access', text: 'Dr Bello at Lagos General: viewed your record' })
    expect(rows[1]).toMatchObject({ to: '/notifications' })
    expect(recentActivity(null, null)).toEqual([])
  })

  it('lists the latest signed notes and encounters, newest first, never an unsigned note', () => {
    const answer = { ...records, notes: [...records.notes, { ...records.notes[0]!, id: 'note-2', title: 'Draft', signedAt: null }] } as unknown as PatientRecords
    expect(providerContributions(answer).map(row => [row.kind, row.title])).toEqual([['Clinical note', 'Malaria review'], ['Encounter', 'outpatient visit']])
    expect(providerContributions({ encounters: 'x' } as unknown as PatientRecords)).toEqual([])
  })

  it('needs attention only for what it can say', () => {
    expect(attentionItems({ profile, requests: [], completion: null, contacts: null })).toEqual([])
    expect(attentionItems({ profile: { ...profile, ninVerified: true }, requests: [request('a', 'pending')],
      completion: { percent: 100, counted: 12, done: [], missing: [] }, contacts: [{}] }).map(item => item.text))
      .toEqual(['1 access request is waiting for your decision'])
  })
})
