import { describe, expect, it } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import type { AccessHistory, AccessRequest } from '../api'
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
/** A time as the page shows it (en-NG, this browser's time zone): "11 Nov 2026, 14:45". */
const at = (value: string) => new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
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

  it('still lists an access whose facility is not named, under a heading that says so', async () => {
    await whoHasAccess(() => ({ items: [grant('1'), grant('2', { facilityName: null as unknown as string })] }))
    expect(await screen.findByRole('heading', { level: 2, name: '2 facilities have access now' })).toBeTruthy()
    expect(facilityHeadings()).toEqual(['Demo Hospital', 'Facility not named'])
    expect(facility('Facility not named').rows).toHaveLength(1)
  })

  it('says no one has access when every row has ended, and still lists them under their facility', async () => {
    await whoHasAccess(() => ({ items: [grant('1', { status: 'revoked', patientRevocable: false })] }))
    expect(await screen.findByRole('heading', { level: 2, name: 'No one has access now' })).toBeTruthy()
    expect(screen.getByText('Past access stays listed, with when it ended.')).toBeTruthy()
    expect(facility('Demo Hospital').counts).toBe('1 past')
  })
})

describe('each access says what, until when and why', () => {
  it('gives each row what the staff member can do, when it starts and ends with the time, and the reason they gave', async () => {
    await whoHasAccess(() => ({ items: FOUR }))
    await screen.findByRole('heading', { level: 2, name: 'Demo Hospital has access now' })
    const rows = facility('Demo Hospital').rows
    FOUR.forEach((item, index) => {
      const text = rows[index]!.textContent
      expect(text).toContain('Can view and add records')
      expect(text).toContain(`From ${at(item.startsAt)} until ${at(item.expiresAt)}`)
      expect(text).toContain(`Reason given: “${item.reason}”`)
    })
    // The time is said, not only the day: "until 11 Nov 2026, 14:41". Each day and time stays on one line on a phone.
    expect(rows[1]!.textContent).toMatch(/until \d{1,2} Nov 2026, \d{2}:\d{2}/)
    expect([...rows[1]!.querySelectorAll('p > span.whitespace-nowrap')].map(time => time.textContent)).toEqual([at(FOUR[1]!.startsAt), at(FOUR[1]!.expiresAt)])
    // No two rows read the same, and no two End access buttons are named the same.
    expect(new Set(rows.map(row => row.textContent)).size).toBe(4)
    const ends = screen.getAllByRole('button', { name: /^End access for/ }).map(button => button.textContent)
    expect(new Set(ends).size).toBe(4)
    expect(ends[2]).toContain('reason given: Second check of the malaria result')
  })

  it('says an access ended early, and gives no reason line for the patient\'s own share', async () => {
    await whoHasAccess(() => ({ items: [
      grant('1', { reason: 'Shared by the patient', clinicianName: 'Dr Tunde Example', shareLevel: 'view_only', shareDuration: '7d' }),
      grant('2', { status: 'revoked', patientRevocable: false }),
    ] }))
    await screen.findByRole('heading', { level: 2, name: 'Demo Hospital has access now' })
    const [share, ended] = facility('Demo Hospital').rows
    expect(share!.textContent).toContain('Shared by you · View Only')
    expect(share!.textContent).not.toContain('Reason given')
    expect(ended!.textContent).toContain(`From ${at('2026-11-11T13:45:00Z')} · ended before ${at('2026-11-11T14:45:00Z')}`)
    expect(ended!.textContent).not.toContain(' until ')
  })
})

describe('ending one access among several at a facility', () => {
  it('ends the access of the row chosen, shows its times and reason first, and says the facility keeps the others', async () => {
    let items = FOUR
    const { sent } = await whoHasAccess(() => ({ items }), (path, method) => {
      if (method !== 'POST') return json({}, 404)
      items = items.map(item => path.includes(item.consentGrantId) ? { ...item, status: 'revoked', patientRevocable: false } : item)
      return json({ consentGrantId: FOUR[2]!.consentGrantId, status: 'revoked', replayed: false })
    })
    await screen.findByRole('heading', { level: 2, name: 'Demo Hospital has access now' })
    await press(within(facility('Demo Hospital').rows[2]!).getByRole('button', { name: /^End access for/ }))
    const drawer = within(screen.getByRole('dialog', { name: 'End access' }))
    expect(drawer.getByText('A staff member at Demo Hospital')).toBeTruthy()
    const term = (name: string) => drawer.getByText(name, { selector: 'dt' }).nextElementSibling?.textContent
    expect(term('From')).toBe(at(FOUR[2]!.startsAt))
    expect(term('Until')).toBe(at(FOUR[2]!.expiresAt))
    expect(term('Reason given')).toBe('Second check of the malaria result')
    // The purpose in the patient's words, never Identity's code.
    expect(term('Purpose')).toBe('Your care')
    expect(drawer.queryByText('direct-care')).toBeNull()

    fireEvent.change(drawer.getByRole('textbox', { name: 'Why are you ending it?' }), { target: { value: 'Test is done' } })
    await press(drawer.getByRole('button', { name: 'End access' }))
    expect(await screen.findByText('This access at Demo Hospital has ended. Other access there is still open, listed below.')).toBeTruthy()
    expect(screen.queryByText('Demo Hospital can no longer see your records.')).toBeNull()
    expect(sent.filter(request => request.method === 'POST')).toEqual([{ method: 'POST', body: { reason: 'Test is done' },
      path: `/identity/me/consent-grants/${FOUR[2]!.consentGrantId}/revoke` }])
    expect(await screen.findByText('3 active · 1 past')).toBeTruthy()
  })

  it('says the facility can no longer see the records when its last access ends', async () => {
    let items = [grant('1', { reason: 'Consultation for fever' })]
    await whoHasAccess(() => ({ items }), () => {
      items = items.map(item => ({ ...item, status: 'revoked', patientRevocable: false }))
      return json({ consentGrantId: items[0]!.consentGrantId, status: 'revoked', replayed: false })
    })
    await press(await screen.findByRole('button', { name: /^End access for Demo Hospital/ }))
    const drawer = within(screen.getByRole('dialog', { name: 'End access' }))
    fireEvent.change(drawer.getByRole('textbox', { name: 'Why are you ending it?' }), { target: { value: 'No longer needed' } })
    await press(drawer.getByRole('button', { name: 'End access' }))
    expect(await screen.findByText('Demo Hospital can no longer see your records.')).toBeTruthy()
  })
})

describe('the requests, told apart the same way', () => {
  const request = (id: string, extra: Partial<AccessRequest>): AccessRequest => ({
    accessRequestId: `7000000${id}-0000-4000-8000-000000000001`, facilityId: 'facility-1', facilityName: 'Demo Hospital',
    scope: 'write_records', reason: 'Follow-up', status: 'pending', requestedDurationMinutes: 60,
    requestedAt: new Date(Date.now() - 2 * 60_000).toISOString(), approvedAt: null, deniedAt: null, deniedReason: null, ...extra,
  })

  it('says on each request from one facility who asks, what for, for how long and the reason they gave', async () => {
    renderPortal(<ToastProvider><AccessPage /></ToastProvider>, (path, method) => {
      if (path === '/identity/me' && method === 'GET') return json({})
      if (path === '/identity/me/access-history') return json({ items: [] })
      return json([
        request('1', { reason: 'Malaria film for the doctor' }),
        request('2', { reason: 'Second check of the malaria result', scope: 'read_records' }),
        request('3', { reason: 'Dispense the prescribed medicines', requestedDurationMinutes: 120 }),
        request('4', { reason: 'Consultation for fever', status: 'approved', approvedAt: new Date().toISOString() }),
      ])
    })
    const rows = await screen.findAllByRole('button', { name: /^Demo Hospital/ })
    const text = rows.map(row => row.textContent)
    expect(text[0]).toContain('A staff member wants to view and add records for 60 minutes · 2 min ago')
    expect(text[0]).toContain('Reason given: “Malaria film for the doctor”')
    expect(text[1]).toContain('A staff member wants to view your records for 60 minutes')
    expect(text[1]).toContain('Reason given: “Second check of the malaria result”')
    expect(text[2]).toContain('A staff member wants to view and add records for 2 hours')
    expect(text[3]).toContain('A staff member asked to view and add records · 2 min ago')
    expect(text[3]).toContain('Reason given: “Consultation for fever”')
    expect(new Set(text).size).toBe(4)
  })
})
