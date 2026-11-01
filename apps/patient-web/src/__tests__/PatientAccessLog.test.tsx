import { describe, expect, it } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { AccessLogEvent } from '../accessLog'
import { parseAccessLog } from '../accessLog'
import { AccessPage } from '../routes/Portal'
import { accessLogActor } from '../routes/AccessLog'
import { json, press, problem, renderPortal, shownText, type Handler, type Sent } from './portalHarness'

/**
 * "Who viewed or changed your record" (hid-1.0 parity B2, hid-system 0093): GET /identity/me/access-log?limit&before
 * answers { events: [{ id, at, action, actorKind, actorName, facilityName }], nextBefore }, newest first. Clinicians
 * and facilities are named, as hid-1.0 named them; refused attempts and record contents are never sent. An Identity
 * before 0093 answers 404, and the section is not shown.
 */
const LOG = '/identity/me/access-log'
const event = (n: number, overrides: Partial<AccessLogEvent> = {}): AccessLogEvent => ({
  id: `event-${n}`, at: `2026-10-${String(28 - (n % 20)).padStart(2, '0')}T09:${String(n % 60).padStart(2, '0')}:00Z`,
  action: 'viewed', actorKind: 'clinician', actorName: `Dr Clinician ${n}`, facilityName: 'Lagos General', ...overrides,
})

/** Access & sharing against a gateway whose access log is `log`, its Activity tab chosen; the other lists are empty. */
async function accessPage(log: Handler) {
  const view = renderPortal(<AccessPage />, (path, method, body) => {
    if (path === LOG) return log(path, method, body)
    if (path === '/identity/me/access-history') return json({ items: [] })
    return json([])
  }, {}, { parityB2: true })
  await press(within(screen.getByRole('navigation', { name: 'Access' })).getByRole('button', { name: 'Activity' }))
  return view
}
const logReads = (sent: Sent[]) => sent.filter(request => request.path === LOG)
const TITLE = 'Who viewed or changed your records'
const section = async () => await screen.findByRole('region', { name: TITLE })

describe('who viewed or changed your record', () => {
  it('lists each event newest first: who, at which facility, what, and when', async () => {
    await accessPage(() => json({ events: [
      event(1, { at: '2026-10-28T09:15:00Z' }),
      event(2, { action: 'changed', actorName: 'Dr Ada Obi', at: '2026-10-27T14:00:00Z' }),
      event(3, { action: 'access_granted', actorKind: 'facility', actorName: null, facilityName: 'Yaba Clinic', at: '2026-10-26T08:00:00Z' }),
      event(4, { action: 'access_ended', actorKind: 'patient', actorName: null, facilityName: 'Yaba Clinic', at: '2026-10-25T08:00:00Z' }),
      event(5, { action: 'emergency_access', actorName: 'Dr Emeka', facilityName: 'Ikeja Hospital', at: '2026-10-24T08:00:00Z' }),
    ], nextBefore: null }))
    const card = await section()
    const rows = await within(card).findAllByRole('listitem')
    expect(rows.map(row => row.textContent)).toEqual([
      expect.stringMatching(/^Dr Clinician 1 at Lagos GeneralViewed your record28 Oct 2026, \d{2}:15$/),
      expect.stringMatching(/^Dr Ada Obi at Lagos GeneralChanged your record27 Oct 2026/),
      expect.stringMatching(/^Yaba ClinicGot access to your record26 Oct 2026/),
      expect.stringMatching(/^YouAccess to your record ended25 Oct 2026/),
      expect.stringMatching(/^Dr Emeka at Ikeja HospitalOpened your record in an emergency24 Oct 2026/),
    ])
    expect(rows[0]!.querySelector('time')?.getAttribute('dateTime')).toBe('2026-10-28T09:15:00Z')
    expect(within(card).queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it('asks for 50 at a time, then the older page "Show more" names, and moves focus to the first one added', async () => {
    const first = Array.from({ length: 50 }, (_, index) => event(index))
    const second = [event(50), event(51)]
    const queries: Array<string | null> = []
    const { sent } = await accessPage(() => {
      queries.push(null)
      return json(queries.length === 1 ? { events: first, nextBefore: 'cursor-50' } : { events: second, nextBefore: null })
    })
    const card = await section()
    expect(await within(card).findAllByRole('listitem')).toHaveLength(50)
    const more = within(card).getByRole('button', { name: 'Show more' })
    more.focus()
    await act(async () => { fireEvent.click(more) })
    await waitFor(() => expect(within(card).getAllByRole('listitem')).toHaveLength(52))
    expect(within(card).queryByRole('button', { name: 'Show more' })).toBeNull()
    expect(document.activeElement).toBe(within(card).getAllByRole('listitem')[50])
    expect(logReads(sent)).toHaveLength(2)
  })

  it('is not shown where Identity does not serve the log (404), and says nothing', async () => {
    const { sent } = await accessPage(() => problem(404, 'NOT_FOUND', 'Cannot GET /api/v1/identity/me/access-log'))
    await waitFor(() => expect(logReads(sent)).toHaveLength(1))
    await waitFor(() => expect(screen.queryByRole('heading', { name: TITLE })).toBeNull())
    expect(screen.queryByRole('region', { name: TITLE })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says when no one has', async () => {
    await accessPage(() => json({ events: [], nextBefore: null }))
    const card = await section()
    expect(await within(card).findByText('No one has viewed or changed your records yet.')).toBeTruthy()
  })

  it('goes on through older pages that add nothing (a stretch of only the patient\'s own reads), a bounded number', async () => {
    let reads = 0
    const { sent } = await accessPage(() => (reads += 1) < 3 ? json({ events: [], nextBefore: `cursor-${reads}` })
      : json({ events: [event(7)], nextBefore: null }))
    const card = await section()
    expect(await within(card).findByText('Dr Clinician 7 at Lagos General')).toBeTruthy()
    expect(logReads(sent)).toHaveLength(3)
    expect(within(card).queryByText('No one has viewed or changed your records yet.')).toBeNull()
  })

  it('does not say no one has while older entries remain, and says what "Show more" found when it adds nothing', async () => {
    let reads = 0
    let last = false
    const { sent } = await accessPage(() => { reads += 1; return json({ events: [], nextBefore: last && reads > 6 ? null : `cursor-${reads}` }) })
    const card = await section()
    expect(await within(card).findByText('Nothing recent. Tap Show more to look further back.')).toBeTruthy()
    expect(within(card).queryByText('No one has viewed or changed your records yet.')).toBeNull()
    expect(logReads(sent)).toHaveLength(3)
    const more = within(card).getByRole('button', { name: 'Show more' })
    more.focus()
    await act(async () => { fireEvent.click(more) })
    await waitFor(() => expect(within(card).getByRole('status').textContent)
      .toBe('Nothing found here. Tap Show more to look further back.'))
    expect(logReads(sent)).toHaveLength(6)
    expect(document.activeElement).toBe(within(card).getByRole('button', { name: 'Show more' }))
    // At the end of the log: said, and focus goes to the section's heading, as the button is gone.
    last = true
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Show more' })) })
    await waitFor(() => expect(within(card).getByRole('status').textContent).toBe('There’s nothing older.'))
    expect(within(card).queryByRole('button', { name: 'Show more' })).toBeNull()
    expect(within(card).getByText('No one has viewed or changed your records yet.')).toBeTruthy()
    expect(document.activeElement).toBe(within(card).getByRole('heading', { name: TITLE }))
  })

  it('says a failed read with Try again, which reads it again', async () => {
    let fail = true
    await accessPage(() => fail ? problem(400, 'INVALID_CURSOR', 'The access log could not be read.') : json({ events: [event(1)], nextBefore: null }))
    const card = await section()
    expect(await within(card).findByText('The access log could not be read.')).toBeTruthy()
    fail = false
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Try again' })) })
    expect(await within(card).findByText('Dr Clinician 1 at Lagos General')).toBeTruthy()
  })

  it('says a failed "Show more" beside it, keeping what is shown', async () => {
    let reads = 0
    await accessPage(() => (reads += 1) === 1 ? json({ events: [event(1)], nextBefore: 'cursor-1' })
      : problem(400, 'INVALID_CURSOR', 'Older events could not be read.'))
    const card = await section()
    await within(card).findByText('Dr Clinician 1 at Lagos General')
    const more = within(card).getByRole('button', { name: 'Show more' })
    more.focus()
    await act(async () => { fireEvent.click(more) })
    expect(shownText(await within(card).findByRole('alert'))).toBe('Older events could not be read.')
    expect(within(card).getAllByRole('listitem')).toHaveLength(1)
    expect(document.activeElement).toBe(more)
  })
})

describe('the access log as read (parseAccessLog)', () => {
  it('keeps the events it can name, and drops any it cannot', () => {
    expect(parseAccessLog({ events: [
      event(1),
      { ...event(2), action: 'refused' },
      { ...event(3), actorKind: 'robot' },
      { ...event(4), at: 'not a time' },
      { ...event(5), id: '' },
      'nonsense',
      { ...event(6), actorName: '   ', facilityName: 7 },
    ], nextBefore: 'next' })).toEqual({ events: [event(1), { ...event(6), actorName: null, facilityName: null }], nextBefore: 'next' })
    expect(parseAccessLog({ events: [], nextBefore: '' })).toEqual({ events: [], nextBefore: null })
    expect(parseAccessLog({ events: [] })).toEqual({ events: [], nextBefore: null })
  })

  it('refuses an answer that is not a page', () => {
    expect(() => parseAccessLog([])).toThrow()
    expect(() => parseAccessLog(null)).toThrow()
    expect(() => parseAccessLog({ events: 'x' })).toThrow()
  })

  it('names who did it in words', () => {
    expect(accessLogActor(event(1, { actorKind: 'clinician', actorName: null, facilityName: null }))).toBe('A health worker')
    expect(accessLogActor(event(1, { actorKind: 'facility', facilityName: null, actorName: null }))).toBe('A health facility')
    expect(accessLogActor(event(1, { actorKind: 'support' }))).toBe('Health ID support')
    expect(accessLogActor(event(1, { actorKind: 'system', facilityName: null }))).toBe('Health ID')
    expect(accessLogActor(event(1, { actorKind: 'patient' }))).toBe('You')
  })
})
