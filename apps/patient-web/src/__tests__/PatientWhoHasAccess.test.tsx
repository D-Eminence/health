import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import type { AccessHistory } from '../api'
import { AccessPage } from '../routes/Portal'
import { ToastProvider } from '../kasuwa/toast'
import { json, press, renderPortal, type Handler } from './portalHarness'

/**
 * "Who has access" on Access & sharing (full-visit rehearsal, 11 Nov 2026): a doctor, two lab scientists and a
 * pharmacist at one hospital each asked, and the patient approved all four. The page said "4 facilities have access
 * now" and listed the hospital four times with nothing to tell the rows apart, so the patient could not tell which
 * access to end. Fictional people and facilities only.
 */
type Item = AccessHistory['items'][number]
const grant = (id: string, extra: Partial<Item> = {}): Item => ({
  consentGrantId: `6000000${id}-0000-4000-8000-000000000001`, scope: 'write_records', purpose: 'direct-care', status: 'active',
  startsAt: '2026-11-11T13:45:00Z', expiresAt: '2026-11-11T14:45:00Z', reason: 'Follow-up', facilityName: 'Demo Hospital',
  breakGlass: false, patientRevocable: true, ...extra,
})
/** The rehearsal's four approvals at one hospital, each with the reason its staff member gave. */
const FOUR = [
  grant('1', { reason: 'Consultation for fever', startsAt: '2026-11-11T12:30:00Z', expiresAt: '2026-11-11T13:30:00Z' }),
  grant('2', { reason: 'Malaria film for the doctor', startsAt: '2026-11-11T13:41:00Z', expiresAt: '2026-11-11T14:41:00Z' }),
  grant('3', { reason: 'Second check of the malaria result', startsAt: '2026-11-11T13:42:00Z', expiresAt: '2026-11-11T14:42:00Z' }),
  grant('4', { reason: 'Dispense the prescribed medicines', startsAt: '2026-11-11T13:43:00Z', expiresAt: '2026-11-11T14:43:00Z' }),
]

/** Access & sharing on its "Who has access" tab, against a gateway whose access history is `history`. */
async function whoHasAccess(history: () => AccessHistory, handler: Handler = () => json({})) {
  const view = renderPortal(<ToastProvider><AccessPage /></ToastProvider>, (path, method, body) => {
    if (path === '/identity/me' && method === 'GET') return json({})
    if (path === '/identity/me/access-requests') return json([])
    if (path === '/identity/me/access-history') return json(history())
    return handler(path, method, body)
  })
  await press(within(await screen.findByRole('navigation', { name: 'Access' })).getByRole('button', { name: /^Who has access/ }))
  return view
}
/** A facility's heading in the list, and the rows under it. */
const facility = (name: string) => {
  const heading = screen.getByRole('heading', { level: 3, name })
  return { counts: heading.nextElementSibling?.textContent, rows: within(heading.parentElement!.nextElementSibling as HTMLElement).getAllByRole('listitem') }
}
const facilityHeadings = () => screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)

describe('who has access, counted and grouped by facility', () => {
  it('counts one facility once, however many staff members there have access', async () => {
    await whoHasAccess(() => ({ items: FOUR }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Demo Hospital has access now' })).toBeTruthy()
    expect(screen.queryByText(/facilities have access/)).toBeNull()
    expect(screen.getByText('Each row is one staff member’s access.')).toBeTruthy()
    // The tab still counts the rows open now: each is one access the patient can end.
    expect(within(screen.getByRole('navigation', { name: 'Access' })).getByRole('button', { name: /^Who has access/ }).textContent).toContain('4')
    expect(facilityHeadings()).toEqual(['Demo Hospital'])
    expect(facility('Demo Hospital').counts).toBe('4 active')
    expect(facility('Demo Hospital').rows).toHaveLength(4)
  })

  it('puts each row under its own facility, in the list\'s order, and counts only facilities with access now', async () => {
    await whoHasAccess(() => ({ items: [
      grant('1'), grant('2', { facilityName: 'Lagos General' }), grant('3'),
      grant('4', { status: 'revoked', patientRevocable: false }), grant('5', { facilityName: 'Yaba Clinic', status: 'expired', patientRevocable: false }),
    ] }))
    expect(await screen.findByRole('heading', { level: 2, name: '2 facilities have access now' })).toBeTruthy()
    expect(facilityHeadings()).toEqual(['Demo Hospital', 'Lagos General', 'Yaba Clinic'])
    expect(facility('Demo Hospital').counts).toBe('2 active · 1 past')
    expect(facility('Demo Hospital').rows).toHaveLength(3)
    expect(facility('Lagos General').counts).toBe('1 active')
    expect(facility('Yaba Clinic').counts).toBe('1 past')
  })

  it('names who holds each access under its facility: the staff member where the list gives a name, never the facility again', async () => {
    await whoHasAccess(() => ({ items: [grant('1', { clinicianName: 'Dr Tunde Example', shareLevel: 'view_only', shareDuration: '7d' }),
      grant('2', { clinicianName: null }), grant('3', { clinicianName: '  ' })] }))
    await screen.findByRole('heading', { level: 2, name: 'Demo Hospital has access now' })
    const titles = facility('Demo Hospital').rows.map(row => row.querySelector('p')?.textContent)
    // The access history names no one for an access from a request, a PIN or an emergency (only a share's clinician),
    // and no role at all: the row says a staff member, and does not guess who.
    expect(titles).toEqual(['Dr Tunde Example', 'A staff member', 'A staff member'])
    expect(screen.getAllByText('Demo Hospital')).toHaveLength(1)
  })

  it('says no one has access when every row has ended, and still lists them under their facility', async () => {
    await whoHasAccess(() => ({ items: [grant('1', { status: 'revoked', patientRevocable: false })] }))
    expect(await screen.findByRole('heading', { level: 2, name: 'No one has access now' })).toBeTruthy()
    expect(screen.getByText('Past access stays listed, with when it ended.')).toBeTruthy()
    expect(facility('Demo Hospital').counts).toBe('1 past')
  })
})
