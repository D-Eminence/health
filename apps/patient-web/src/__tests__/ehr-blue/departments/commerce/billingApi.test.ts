import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The billing client against hid-system BILL-1 (claude/sprint-billing-backend): healthcare-operations on every billing
 * request, the facility in its header and never a Health ID in an address, BILL-1's answer shapes taken as the pages
 * read them, each refusal in BILL-1's words (never "permission"), and served.ts learning from each answer whether
 * billing answers at a facility. Every facility, bill and person here is fictional.
 */
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ name: 'local', apiBaseUrl: 'https://gateway.test' }) }))

const FACILITY = 'a0000000-0000-4000-8000-000000000001'
const BILL = 'b0000000-0000-4000-8000-000000000002'

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())

const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const problem = (code: string, status: number, detail = 'server words') => answer({ type: 'about:blank', title: code, status, detail, code }, status)

async function client(...responses: Response[]) {
  const fetch = vi.fn()
  for (const response of responses) fetch.mockResolvedValueOnce(response)
  vi.stubGlobal('fetch', fetch)
  const { setStaffSessionReady } = await import('../../../../staff/session')
  setStaffSessionReady(true)
  const api = await import('../../../../ehr-blue/departments/commerce/api')
  const served = await import('../../../../ehr-blue/departments/commerce/served')
  return { fetch, ...api, ...served }
}

describe('a billing request', () => {
  it('runs for healthcare operations at the facility, with an Idempotency-Key on every write', async () => {
    const { fetch, commerce } = await client(answer({ items: [], nextPage: null, page: 1 }), answer({ id: BILL, version: 6 }))
    await commerce.bills(FACILITY, { source: 'visit', q: 'B-000412' })
    await commerce.voidPayment(FACILITY, BILL, 'c0000000-0000-4000-8000-000000000003', 'Refund: returned', 5, 'key-0000000000000001')
    const [readUrl, read] = fetch.mock.calls[0]!
    expect(new URL(String(readUrl)).search).toBe('?source=visit&q=B-000412')
    expect(new Headers(read.headers).get('X-Purpose-Of-Use')).toBe('healthcare-operations')
    expect(new Headers(read.headers).get('X-Facility-ID')).toBe(FACILITY)
    const [, write] = fetch.mock.calls[1]!
    expect(new Headers(write.headers).get('Idempotency-Key')).toBe('key-0000000000000001')
    expect(JSON.parse(String(write.body))).toEqual({ reason: 'Refund: returned', expectedVersion: 5 })
  })

  it('sends the till a payment is cancelled at with a day per till, and none otherwise', async () => {
    const { fetch, commerce } = await client(answer({ id: BILL, version: 6 }), answer({ id: BILL, version: 7 }))
    await commerce.voidPayment(FACILITY, BILL, 'c0000000-0000-4000-8000-000000000003', 'Refund: returned', 5, 'key-0000000000000002', 'd0000000-0000-4000-8000-000000000004')
    await commerce.voidPayment(FACILITY, BILL, 'c0000000-0000-4000-8000-000000000003', 'Recorded twice', 6, 'key-0000000000000003', null)
    expect(JSON.parse(String(fetch.mock.calls[0]![1].body))).toEqual({ reason: 'Refund: returned', expectedVersion: 5, tillId: 'd0000000-0000-4000-8000-000000000004' })
    expect(JSON.parse(String(fetch.mock.calls[1]![1].body))).toEqual({ reason: 'Recorded twice', expectedVersion: 6 })
  })

  it('never sends a search shaped like a Health ID or an 11-digit NIN, and says why in BILL-1’s words', async () => {
    const { fetch, commerce } = await client()
    for (const q of ['HID-ZDEMAAA2', 'hid-zdemaaa2', '123 4567 8901']) {
      const bills = await commerce.bills(FACILITY, { q })
      expect(bills).toEqual({ ok: false, error: 'Search by bill number, receipt number or name. Do not type a Health ID or NIN here.',
        code: 'BILLING_SEARCH_TEXT_NOT_ALLOWED', status: 400 })
      expect((await commerce.catalogueItems(FACILITY, { q })).ok).toBe(false)
      expect((await commerce.stock(FACILITY, { q })).ok).toBe(false)
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('takes the price list’s `more` and the day’s `{ shift }` as the pages read them, and a receipt of stock’s `items`', async () => {
    const day = { id: 'day-1', scope: 'facility', totals: [], version: 1 }
    const { commerce } = await client(
      answer({ items: [{ id: 'item-1' }], page: 2, pageSize: 50, more: true }),
      answer({ shift: day, scope: 'facility' }),
      answer({ shift: null, scope: 'cashier' }),
      answer({ items: [{ catalogueItemId: 'cat-1' }] }, 201))
    expect(await commerce.catalogueItems(FACILITY, { page: 2 })).toEqual({ ok: true, data: { items: [{ id: 'item-1' }], nextPage: 3 } })
    expect(await commerce.currentShift(FACILITY)).toEqual({ ok: true, data: day })
    expect(await commerce.currentShift(FACILITY)).toEqual({ ok: true, data: null })
    expect(await commerce.receiveStock(FACILITY, { lines: [] })).toEqual({ ok: true, data: { lines: [{ catalogueItemId: 'cat-1' }] } })
  })

  it('reads 404 BILLING_NOT_AVAILABLE as not switched on, and a missing bill as a missing bill', async () => {
    const { commerce } = await client(problem('BILLING_NOT_AVAILABLE', 404), problem('BILL_NOT_FOUND', 404))
    expect(await commerce.bill(FACILITY, BILL)).toEqual({ ok: false, notAvailable: true })
    expect(await commerce.bill(FACILITY, BILL)).toMatchObject({ ok: false, error: 'This was not found at this facility.', code: 'BILL_NOT_FOUND' })
  })

  it('says each refusal in BILL-1’s words, and a role’s refusal without "permission"', async () => {
    const { commerce } = await client(problem('OVERPAYMENT', 409), problem('SECOND_PERSON_REQUIRED', 403), problem('FORBIDDEN', 403),
      problem('VERSION_CONFLICT', 412), problem('OUT_OF_STOCK', 409), problem('VALIDATION_FAILED', 400))
    const words = []
    for (let index = 0; index < 6; index += 1) {
      const result = await commerce.recordPayment(FACILITY, BILL, { method: 'cash', amountKobo: 100 })
      if (!result.ok && !result.notAvailable) words.push(result.error)
    }
    expect(words).toEqual(['That is more than is due. Enter the amount due or less.',
      'Another member of staff must do this, not the person who recorded the payment.',
      'Your role here does not include this. Ask a billing officer or administrator.',
      'Someone else changed this. Reload it and try again.', 'Not enough in stock.',
      // No billing screen marks a field from the server's refusal: no "highlighted fields".
      'Some details weren’t accepted. Check them and try again.'])
    expect(words.join(' ')).not.toMatch(/permission/i)
  })
})

describe('whether billing answers at a facility', () => {
  it('opens the billing pages after an answer, and keeps them shut after a 404 or a gateway’s own refusal', async () => {
    const { commerce, pointOfCareOpen, billingServed } = await client(problem('BILLING_NOT_AVAILABLE', 404), problem('UNEXPECTED', 418),
      answer({ date: '2026-11-26', billedKobo: 0, collectedKobo: 0, waivedKobo: 0, hmoCoveredKobo: 0, outstandingKobo: 0, billCount: 0 }),
      problem('BILLING_NOT_AVAILABLE', 404))
    await commerce.billSummary(FACILITY)
    expect(billingServed(FACILITY)).toBe(false)
    await commerce.billSummary(FACILITY)
    expect(billingServed(FACILITY)).toBe(false)
    await commerce.billSummary(FACILITY)
    expect(pointOfCareOpen(FACILITY)).toBe(true)
    // Once it has answered, it stays open for the page's life.
    await commerce.billSummary(FACILITY)
    expect(pointOfCareOpen(FACILITY)).toBe(true)
  })

  it('learns from a refusal in BILL-1’s own words, but not from the lab’s proposed routes', async () => {
    const { commerce, billingServed } = await client(problem('LAB_WALK_IN_X', 409), problem('BILLING_NOT_ALLOWED', 403))
    await commerce.labWalkIn(FACILITY, { patient: { name: 'Test', ageYears: 30, sex: 'female', phone: '+2348000000000' }, tests: [], priority: 'routine' })
    expect(billingServed(FACILITY)).toBe(null)
    await commerce.outstanding(FACILITY)
    expect(billingServed(FACILITY)).toBe(true)
  })

  it('always opens at the four demo facilities, and keeps the lab’s walk-ins and queued prescriptions there only', async () => {
    const { pointOfCareOpen, labCounterOpen, walkInQueueOpen, learnBillingServed } = await client()
    expect(pointOfCareOpen('98d00002-0000-4000-8000-000000000001')).toBe(true)
    expect(pointOfCareOpen(FACILITY)).toBe(false)
    learnBillingServed(FACILITY, true)
    expect(pointOfCareOpen(FACILITY)).toBe(true)
    expect(labCounterOpen(FACILITY)).toBe(false)
    expect(walkInQueueOpen(FACILITY)).toBe(false)
    expect(labCounterOpen('98d00002-0000-4000-8000-000000000002')).toBe(true)
  })
})

describe('Lagos days and times', () => {
  it('leaves dates and times to @hid/ui/display (P2-4): the billing client has no formatter of its own', async () => {
    const api = await client() as Record<string, unknown>
    expect(api.lagosDay).toBeUndefined()
    expect(api.lagosTime).toBeUndefined()
  })
})
