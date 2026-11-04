import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'
import type { PatientNotification } from '../api'
import type { CardShare } from '../cardShares'
import { forgetCardSharesServed } from '../cardShares'
import { parseAccessLog } from '../accessLog'
import { ShareCard } from '../routes/ShareCard'
import { SharedCardLinksCard } from '../routes/SharedCardLinks'
import { AccessPage } from '../routes/Portal'
import { NOTIFICATION_SUBJECTS, notificationTitle } from '../routes/notificationTitles'
import { WHAT, accessLogActor, accessLogWhat } from '../routes/AccessLog'
import { json, press, problem, renderPortal, shownText, type Handler, type Sent } from './portalHarness'

/**
 * Step 8 (hid-system 0118, switched on 4 Nov 2026 after legal approval): the patient sends their card by email. Off, or where the
 * backend answers GET identity/me/card-shares 404, nothing of it is shown and nothing more is asked. On: the form (the
 * address, a private label, card only or card and records, 24 hours or 7 days), the check step that says what is shared
 * and that an earlier link to the same address ends, the done step, the list of links with End now, the inbox titles
 * and Activity's wording ("using the link sent to a•••").
 */
const flag = vi.hoisted(() => ({ on: true }))
vi.mock('../cardSharesFlag', () => ({ cardSharesEnabled: () => flag.on }))
vi.mock('../backendContract', () => ({ usesNovuBackend: () => true }))

const LIST = '/identity/me/card-shares'
/** hid-system claude/card-links-0118, services/identity-api/src/card-links/card-links.dto.ts CreateCardShareDto. */
const BACKEND_CREATE_FIELDS = ['email', 'label', 'scope', 'duration']
const share = (overrides: Partial<CardShare> = {}): CardShare => ({
  id: 'cs-1', reference: 'K7P2-QX9M', recipientEmail: 'dr.bello@example.com', label: 'Dr Bello', recipientHint: 'd•••@example.com',
  scope: 'card_and_records', duration: '24h', createdAt: '2026-11-04T09:04:00.000Z', expiresAt: '2026-11-05T09:04:00.000Z', status: 'active',
  endedAt: null, endedReason: null, lockedUntil: null, delivery: 'sent', openCount: 2, lastOpenedAt: '2026-11-04T10:20:00.000Z', ...overrides,
})
const listOf = (items: CardShare[]) => ({ items, createdToday: items.length, dailyLimit: 5, liveCount: items.filter(item => item.status === 'active').length, liveLimit: 20 })

beforeEach(() => { flag.on = true; forgetCardSharesServed() })

const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const focused = () => document.activeElement
const cardRequests = (sent: Sent[]) => sent.filter(item => item.path.startsWith(LIST))

function sendPage(handler: Handler) {
  return renderPortal(<Routes>
    <Route path="/access/share/card" element={<ShareCard />} />
    <Route path="/access" element={<p>Access and sharing page</p>} />
  </Routes>, handler, {}, { at: '/access/share/card' })
}

const listing = (items: CardShare[] = []): Handler => (path, method) => {
  if (path === LIST && method === 'GET') return json(listOf(items))
  return problem(404, 'NOT_FOUND', path)
}

async function fillAndCheck(handler: Handler, { email = 'dr.bello@example.com', label = 'Dr Bello', scope = 'Card and records', duration = '24 hours' } = {}) {
  const view = sendPage(handler)
  await screen.findByRole('heading', { name: 'Send your card by email' })
  type('Their email address', email)
  if (label) type(/Who is this\?/, label)
  fireEvent.click(screen.getByLabelText(new RegExp(`^${scope}`)))
  fireEvent.click(screen.getByLabelText(duration))
  await press(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByRole('heading', { name: 'Check and send' })
  return view
}

describe('the send flow', () => {
  it('is not offered while switched off: it opens Access and sharing and asks nothing', async () => {
    flag.on = false
    const { sent } = sendPage(listing())
    expect(await screen.findByText('Access and sharing page')).toBeTruthy()
    expect(sent).toEqual([])
  })

  it('is not offered where the backend answers 404', async () => {
    const { sent } = sendPage(() => problem(404, 'NOT_FOUND', 'Cannot GET'))
    expect(await screen.findByText('Access and sharing page')).toBeTruthy()
    expect(sent.map(item => item.path)).toEqual([LIST])
  })

  it('asks for the address, a private label, what they see and how long, 24 hours chosen first and no 30 days', async () => {
    sendPage(listing())
    const heading = await screen.findByRole('heading', { name: 'Send your card by email' })
    await waitFor(() => expect(focused()).toBe(heading))
    expect(screen.getByText('We’ll email them a link. To open it, they need a code we send to this address. Check it carefully.')).toBeTruthy()
    expect(screen.getByLabelText(/Who is this\?/)).toBeTruthy()
    expect(screen.getByText('Only you see this. It isn’t put in any email.')).toBeTruthy()
    const how = within(screen.getByRole('group', { name: 'How long' })).getAllByRole('radio')
    expect(how.map(radio => radio.closest('label')?.textContent)).toEqual(['24 hours', '7 days'])
    expect((screen.getByLabelText('24 hours') as HTMLInputElement).checked).toBe(true)
    const what = within(screen.getByRole('group', { name: 'What they’ll see' })).getAllByRole('radio')
    expect(what).toHaveLength(2)
    // No photo: the backend's card view carries none (review F5), so neither the choice nor the check step promises one.
    expect(screen.getByText('Your card: name, Health ID, blood group, genotype and allergies.')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/photo/i)
    expect(screen.getByText(/Your card and your records: visits, signed notes, older records, the health information you entered and the records you added\./)).toBeTruthy()
    expect(screen.getByText('Read only. They can’t change anything.')).toBeTruthy()
  })

  it('refuses an address that is not one, on the field', async () => {
    sendPage(listing())
    await screen.findByRole('heading', { name: 'Send your card by email' })
    type('Their email address', 'not-an-email')
    await press(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Enter an email address like name@example.com.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Check and send' })).toBeNull()
  })

  it('checks, says what is shared and that it ends the earlier link to that address, then sends with one key', async () => {
    const { sent, headers } = await fillAndCheck((path, method) => {
      if (path === LIST && method === 'GET') return json(listOf([share({ id: 'cs-old' })]))
      if (path === LIST && method === 'POST') return json({ share: share({ id: 'cs-new', openCount: 0, lastOpenedAt: null }), delivery: 'sent', replacedId: 'cs-old' }, 201)
      return problem(404, 'NOT_FOUND', path)
    })
    const check = screen.getByRole('heading', { name: 'Check and send' })
    await waitFor(() => expect(focused()).toBe(check))
    expect(screen.getByText('dr.bello@example.com')).toBeTruthy()
    expect(screen.getByText('They’ll see your Health ID card, your visits, signed notes, older records, the health information you entered and the records you added.')).toBeTruthy()
    expect(screen.getByText('They’ll also see anything added to your record until the link ends.')).toBeTruthy()
    expect(screen.getByText('They can’t change anything, but they can save, print or screenshot what they see. Ending the link stops new views; it can’t take back what they’ve already seen. Anyone who can read that inbox can open your card.')).toBeTruthy()
    expect(screen.getByText('Each time it’s opened, you’ll be told.')).toBeTruthy()
    expect(screen.getByText('This ends the link you sent to this address before.')).toBeTruthy()
    // The email they get: the link and nothing about you.
    const preview = screen.getByRole('figure', { name: 'Preview of the email dr.bello@example.com receives' })
    expect(preview.textContent).toContain('A Health ID card has been shared with you')
    expect(preview.textContent).not.toContain('Ada')
    expect(preview.textContent).not.toContain('HID-')
    await press(screen.getByRole('button', { name: 'Send my card' }))
    expect(await screen.findByRole('heading', { name: 'Your card link is on its way' })).toBeTruthy()
    const posts = cardRequests(sent).filter(item => item.method === 'POST')
    // Exactly the fields the backend's CreateCardShareDto allows (whitelist, forbidNonWhitelisted): an extra field is a 400
    // for every send (review F1). The backend records the check step's version itself.
    expect(posts).toEqual([{ path: LIST, method: 'POST', body: { email: 'dr.bello@example.com', label: 'Dr Bello', scope: 'card_and_records', duration: '24h' } }])
    expect(Object.keys(posts[0]!.body as object).every(key => BACKEND_CREATE_FIELDS.includes(key))).toBe(true)
    expect(headers.find(item => item.method === 'POST' && item.path === LIST)?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/)
    expect(screen.getByText(/Your card link is on its way to dr\.bello@example\.com\. It works until .*, or until you end it\. You’ll be told each time it’s opened\./)).toBeTruthy()
    expect(screen.getByText('The link you sent to this address before has ended.')).toBeTruthy()
    expect(screen.getByText('We’ve also emailed you to say a card link was sent, so you’ll know if anyone else sends one.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'See your shared links' }).getAttribute('href')).toBe('/access?tab=granted')
  })

  it('says card only on the check step, and not the records', async () => {
    await fillAndCheck(listing(), { scope: 'Card only', label: '', duration: '7 days' })
    expect(screen.getByText('They’ll see your Health ID card: your name, Health ID, blood group, genotype and allergies. Not your records.')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/photo/i)
    expect(screen.queryByText('They’ll also see anything added to your record until the link ends.')).toBeNull()
    expect(screen.getByText('7 days')).toBeTruthy()
  })

  it('asks about an address that looks mistyped', async () => {
    await fillAndCheck(listing(), { email: 'dr.bello@gmial.com' })
    expect(screen.getByText('Did you mean dr.bello@gmail.com? Check the address before you send.')).toBeTruthy()
  })

  it('says when it is not sure the email arrived', async () => {
    await fillAndCheck((path, method) => {
      if (path === LIST && method === 'GET') return json(listOf([]))
      return json({ share: share({ delivery: 'not_sent' }), delivery: 'not_sent', replacedId: null }, 201)
    })
    await press(screen.getByRole('button', { name: 'Send my card' }))
    expect(await screen.findByText('We aren’t sure the email arrived. You can end this link and send a new one tomorrow.')).toBeTruthy()
  })

  it('uses a new Idempotency-Key for each send, so sending again to the same address makes a new link (review F4)', async () => {
    let made = 0
    const { headers } = await fillAndCheck((path, method) => {
      if (path === LIST && method === 'GET') return json(listOf(made ? [share({ id: `cs-${made}` })] : []))
      if (path === LIST && method === 'POST') { made += 1; return json({ share: share({ id: `cs-${made}` }), delivery: 'sent', replacedId: made > 1 ? `cs-${made - 1}` : null, replayed: false }, 201) }
      return problem(404, 'NOT_FOUND', path)
    })
    await press(screen.getByRole('button', { name: 'Send my card' }))
    await screen.findByRole('heading', { name: 'Your card link is on its way' })
    await press(screen.getByRole('button', { name: 'Send to someone else' }))
    await screen.findByRole('heading', { name: 'Send your card by email' })
    type('Their email address', 'dr.bello@example.com')
    type(/Who is this\?/, 'Dr Bello')
    await press(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Check and send' })
    await press(screen.getByRole('button', { name: 'Send my card' }))
    expect(await screen.findByText('The link you sent to this address before has ended.')).toBeTruthy()
    const keys = headers.filter(item => item.method === 'POST' && item.path === LIST).map(item => item.headers.get('Idempotency-Key'))
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
  })

  it('keeps one key while the same send is tried again after a failure, and starts a new one after Back', async () => {
    let calls = 0
    const { headers } = await fillAndCheck((path, method) => {
      if (path === LIST && method === 'GET') return json(listOf([]))
      if (path === LIST && method === 'POST') { calls += 1; return calls === 1 ? problem(503, 'CARD_SHARE_UNAVAILABLE', 'x') : json({ share: share(), delivery: 'sent', replacedId: null, replayed: false }, 201) }
      return problem(404, 'NOT_FOUND', path)
    })
    await press(screen.getByRole('button', { name: 'Send my card' }))
    await screen.findByRole('alert')
    await press(screen.getByRole('button', { name: 'Send my card' }))
    await screen.findByRole('heading', { name: 'Your card link is on its way' })
    const keys = headers.filter(item => item.method === 'POST' && item.path === LIST).map(item => item.headers.get('Idempotency-Key'))
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
  })

  it('says plainly when the answer is a replay of a send already made, not that a new link is on its way', async () => {
    await fillAndCheck((path, method) => {
      if (path === LIST && method === 'GET') return json(listOf([]))
      return json({ share: share(), delivery: 'sent', replacedId: null, replayed: true }, 200)
    })
    await press(screen.getByRole('button', { name: 'Send my card' }))
    expect(await screen.findByRole('heading', { name: 'Your card was already sent' })).toBeTruthy()
    expect(screen.getByText(/We’d already sent this link to dr\.bello@example\.com\. Nothing new was sent\. It works until .*, or until you end it\./)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Your card link is on its way' })).toBeNull()
  })

  const refusals: Array<[number, string, string]> = [
    [400, 'CARD_SHARE_OWN_EMAIL', 'That’s your own email address. To see your card, open it in Health ID.'],
    [403, 'PATIENT_RECENT_AUTH_REQUIRED', 'For your security, sign out, sign in again, and send it within 10 minutes.'],
    [409, 'IDEMPOTENCY_KEY_REUSED', 'Something changed while sending. Check your shared links before trying again.'],
    [409, 'CARD_SHARE_LIVE_LIMIT', 'You have 20 card links open. End one to send another.'],
    [429, 'CARD_SHARE_CREATE_LIMITED', 'You’ve sent 5 card links today. Try again tomorrow.'],
    [429, 'CARD_SHARE_ADDRESS_LIMITED', 'You’ve sent your card to this address twice today. Try again tomorrow.'],
  ]
  it.each(refusals)('says %s %s in plain words', async (status, code, words) => {
    await fillAndCheck((path, method) => method === 'GET' ? json(listOf([])) : problem(status, code, 'server words'))
    await press(screen.getByRole('button', { name: 'Send my card' }))
    const alert = await screen.findByRole('alert')
    expect(shownText(alert)).toBe(words)
    await waitFor(() => expect(alert.contains(focused()) || focused() === alert.parentElement).toBe(true))
  })
})

describe('your card, shared by email', () => {
  function links(items: CardShare[] | Handler) {
    const handler: Handler = typeof items === 'function' ? items : listing(items)
    return renderPortal(<SharedCardLinksCard />, handler)
  }

  it('shows nothing and asks nothing while switched off', async () => {
    flag.on = false
    const { sent } = links([share()])
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByRole('heading', { name: 'Your card, shared by email' })).toBeNull()
    expect(sent).toEqual([])
  })

  it('shows nothing where the backend answers 404', async () => {
    links(() => problem(404, 'NOT_FOUND', 'Cannot GET'))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(screen.queryByRole('heading', { name: 'Your card, shared by email' })).toBeNull()
  })

  it('lists each link: who (and the label), what, until when, opens and its state', async () => {
    links([share(), share({ id: 'cs-2', recipientEmail: null, label: null, recipientHint: 'a•••@example.org', scope: 'card', status: 'ended',
      endedAt: '2026-11-03T10:00:00.000Z', endedReason: 'too_many_wrong_codes', openCount: 0, lastOpenedAt: null }),
    share({ id: 'cs-3', status: 'locked', lockedUntil: '2026-11-04T11:00:00.000Z', recipientEmail: 'b@example.net', label: null, delivery: 'not_sent', openCount: 0, lastOpenedAt: null })])
    expect(await screen.findByRole('heading', { name: 'Your card, shared by email' })).toBeTruthy()
    expect(screen.getByText('Each person needs a code we email them to open it.')).toBeTruthy()
    const rows = screen.getAllByRole('listitem')
    expect(rows[0]!.textContent).toContain('Dr Bello (dr.bello@example.com)')
    expect(rows[0]!.textContent).toContain('Card and records · Read only · Until 5 Nov 2026')
    expect(rows[0]!.textContent).toMatch(/Opened 2 times, last at/)
    expect(rows[0]!.textContent).toContain('Active')
    expect(rows[1]!.textContent).toContain('a•••@example.org')
    expect(rows[1]!.textContent).toContain('Card only')
    expect(rows[1]!.textContent).toContain('Ended: too many wrong codes')
    expect(rows[1]!.textContent).toContain('Not opened')
    expect(within(rows[1]!).queryByRole('button')).toBeNull()
    expect(rows[2]!.textContent).toContain('Paused for now')
    expect(rows[2]!.textContent).toContain('We couldn’t email this one. Try again tomorrow.')
    expect(screen.getByRole('button', { name: 'End now the link to dr.bello@example.com' })).toBeTruthy()
  })

  it('ends a link after asking once, then reads the list again with focus on its heading', async () => {
    let ended = false
    const { sent } = links((path, method) => {
      if (path === LIST && method === 'GET') return json(listOf([ended ? share({ status: 'ended', recipientEmail: null, label: null, endedAt: '2026-11-04T10:30:00.000Z', endedReason: 'patient_ended' }) : share()]))
      if (path === `${LIST}/cs-1/end` && method === 'POST') { ended = true; return json({ share: share({ status: 'ended' }) }) }
      return problem(404, 'NOT_FOUND', path)
    })
    await press(await screen.findByRole('button', { name: /^End now/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('End this link now? dr.bello@example.com won’t be able to open your card again, and anyone looking at it now is stopped within a minute. They aren’t told you ended it.')).toBeTruthy()
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'End now' })) })
    expect(await screen.findByText('Link ended. dr.bello@example.com can no longer open your card.')).toBeTruthy()
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { name: 'Your card, shared by email' })))
    expect(sent.filter(item => item.method === 'POST')).toEqual([{ path: `${LIST}/cs-1/end`, method: 'POST', body: null }])
  })

  it('says when there are none, with Send my card', async () => {
    links([])
    expect(await screen.findByText('You haven’t sent your card to anyone.')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Send my card' })[0]!.getAttribute('href')).toBe('/access/share/card')
  })

  it('says when the list could not be read, with Try again', async () => {
    links(() => problem(500, 'INTERNAL', 'boom'))
    expect(await screen.findByText(/We couldn’t load your shared links/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Try again/ })).toBeTruthy()
  })
})

describe('Access and sharing, with card links served', () => {
  it('offers Send my card in the header and lists the links under Who has access', async () => {
    renderPortal(<AccessPage />, (path, method) => {
      if (path === LIST && method === 'GET') return json(listOf([share()]))
      if (path === '/identity/me/access-history') return json({ items: [] })
      return json([])
    }, {}, { at: '/access?tab=granted' })
    expect(await screen.findByRole('heading', { name: 'Your card, shared by email' })).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Send my card' }).some(link => link.getAttribute('href') === '/access/share/card')).toBe(true)
  })
})

describe('the inbox and Activity', () => {
  const notice = (code: string, metadata: Record<string, unknown>): PatientNotification => ({ id: 'n', notificationCode: code, resourceType: 'card-share',
    resourceId: 'cs-1', metadata, readAt: null, createdAt: '2026-11-04T10:00:00.000Z' })

  it('names opens, locks and a link ended for wrong codes by the address hint, and never more', () => {
    expect(notificationTitle(notice('SHARED_CARD_OPENED', { recipientHint: 'd•••@gmail.com', reference: 'K7P2-QX9M' })))
      .toBe('Someone opened your card using the link sent to d•••@gmail.com')
    expect(notificationTitle(notice('SHARED_CARD_LOCKED', { recipientHint: 'd•••@gmail.com' })))
      .toBe('Too many wrong codes were entered for your card link to d•••@gmail.com. It’s paused for an hour.')
    // The backend's codes (INTERFACE_CONTRACT §33): SHARED_CARD_ENDED with reason too_many_wrong_codes, and SHARED_CARD_STOPPED.
    expect(notificationTitle(notice('SHARED_CARD_ENDED', { recipientHint: 'd•••@gmail.com', reference: 'K7P2-QX9M', reason: 'too_many_wrong_codes' })))
      .toBe('We ended your card link to d•••@gmail.com because of too many wrong codes. Send a new one if you still want to share.')
    expect(notificationTitle(notice('SHARED_CARD_ENDED', { recipientHint: 'd•••@gmail.com' })))
      .toBe('Your card link to d•••@gmail.com has ended.')
    expect(notificationTitle(notice('SHARED_CARD_STOPPED', { recipientHint: 'd•••@gmail.com', reference: 'K7P2-QX9M' })))
      .toBe('The person at d•••@gmail.com asked us to stop card emails, so your card link to them has ended.')
    expect(notificationTitle(notice('SHARED_CARD_OPENED', {}))).toBe('Someone opened your card using a link you sent')
    expect(NOTIFICATION_SUBJECTS['card-share']).toBe('Shared card')
  })

  it('reads the card events in Activity, worded "using the link sent to a•••"', () => {
    const page = parseAccessLog({ events: [
      { id: 'e1', at: '2026-11-04T10:00:00Z', action: 'card_opened', actorKind: 'card_recipient', actorName: 'd•••@gmail.com', facilityName: null, recipientHint: 'd•••@gmail.com' },
      { id: 'e2', at: '2026-11-04T09:00:00Z', action: 'card_shared', actorKind: 'patient', actorName: null, facilityName: null, recipientHint: 'd•••@gmail.com' },
      { id: 'e3', at: '2026-11-04T08:00:00Z', action: 'card_ended', actorKind: 'patient', actorName: null, facilityName: null, recipientHint: 'd•••@gmail.com' },
    ], nextBefore: null })
    expect(page.events.map(event => [accessLogActor(event), accessLogWhat(event)])).toEqual([
      ['Someone', 'Opened your shared card using the link sent to d•••@gmail.com'],
      ['You', 'Sent your card using the link sent to d•••@gmail.com'],
      ['You', 'Ended the card link sent to d•••@gmail.com'],
    ])
    expect(WHAT.viewed).toBe('Viewed your record')
  })
})

describe('the patient\'s preview of what a card link shows', () => {
  it('shows their own card and records as a card-and-records link does, and says it is a preview', async () => {
    const { CardLinkPreview } = await import('../routes/CardReceiver')
    const { profile } = await import('./portalHarness')
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:own-photo')
    const { sent } = renderPortal(<CardLinkPreview />, path => {
      if (path === '/identity/me') return json({ ...profile, hasPhoto: true })
      if (path === '/identity/me/photo') return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'content-type': 'image/png' } })
      if (path === '/ehr/me/records') return json({ encounters: [{ id: 'e1', facilityId: 'f', encounterType: 'outpatient', status: 'completed', startedAt: '2026-10-20T09:00:00Z', endedAt: null }],
        notes: [], limit: 50 })
      return problem(404, 'NOT_FOUND', path)
    }, {}, { at: '/card/preview', parityB3: true })
    expect(await screen.findByText('This is what someone you send your card to sees.')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Ada Example’s Health ID card' })).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Visits' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Records they added' })).toBeTruthy()
    expect(sent.some(item => item.path.startsWith('/card-share/'))).toBe(false)
    // The person a link goes to never sees the photo (the backend shares none), so the preview does not show it either.
    await waitFor(() => expect(sent.some(item => item.path === '/identity/me/photo')).toBe(true))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(document.querySelector('img[src="blob:own-photo"]')).toBeNull()
  })
})

describe('signing in again on the way to the send flow', () => {
  it('returns to /access/share/card, and never to the page a link opens', async () => {
    const { PORTAL_RETURN_PATHS } = await import('../sso/handOff')
    expect(PORTAL_RETURN_PATHS).toContain('/access/share/card')
    expect(PORTAL_RETURN_PATHS).not.toContain('/card')
    expect(PORTAL_RETURN_PATHS.some(path => path.startsWith('/card/stop'))).toBe(false)
  })
})
