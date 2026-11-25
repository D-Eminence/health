import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../staff/env', () => ({ getEnvironment: () => ({ name: 'test', apiBaseUrl: 'https://gateway.example.test' }) }))

/*
 * GET identity/registration-cases (SX-10): the path, only the query keys Identity takes (view, status, evidence, limit,
 * cursor), the facility and purpose headers, and the answer as sent. Every value here is fictional.
 */

const FACILITY = 'f0000000-0000-4000-8000-000000000001'
const ITEM = {
  caseId: 'c0000000-0000-4000-8000-000000000001', status: 'approved_new_identity', version: 2, candidateCount: 0, contactRecorded: true,
  ninStatus: 'verified', identityEvidence: 'nin', patient: { patientId: 'a0000000-0000-4000-8000-000000000001', hid: 'HID-ZDEMAAA2' },
  fullName: 'Patient One', dateOfBirth: '1990-01-02', createdAt: '2026-11-20T09:15:00.000Z', updatedAt: '2026-11-21T10:30:00.000Z',
  createdByMe: true,
}

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

async function listWith(answer: unknown, status = 200) {
  const sent: Array<{ url: string; method: string; headers: Headers }> = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), method: init?.method ?? 'GET', headers: new Headers(init?.headers) })
    return new Response(JSON.stringify(answer), { status, headers: { 'Content-Type': 'application/json' } })
  }))
  const { setStaffSessionReady } = await import('../staff/session')
  setStaffSessionReady(true)
  const { staffApi } = await import('../staff/api')
  return { sent, staffApi }
}

describe('listRegistrationCases', () => {
  it('reads My registrations for healthcare operations at the facility, with view alone in the address', async () => {
    const answer = { view: 'mine', cases: [ITEM], nextCursor: 'next-page_2' }
    const { sent, staffApi } = await listWith(answer)
    expect(await staffApi.listRegistrationCases(FACILITY, { view: 'mine' })).toEqual(answer)
    expect(sent).toHaveLength(1)
    const url = new URL(sent[0]!.url)
    expect(url.pathname).toBe('/api/v1/identity/registration-cases')
    expect([...url.searchParams.entries()]).toEqual([['view', 'mine']])
    expect(sent[0]!.method).toBe('GET')
    expect(sent[0]!.headers.get('X-Facility-ID')).toBe(FACILITY)
    expect(sent[0]!.headers.get('X-Purpose-Of-Use')).toBe('healthcare-operations')
  })

  it('sends each filter, the limit and the cursor only when given, and never a Health ID, NIN or name', async () => {
    const { sent, staffApi } = await listWith({ view: 'facility', cases: [], nextCursor: null })
    await staffApi.listRegistrationCases(FACILITY, { view: 'facility', status: 'review_required', evidence: 'none', limit: 20, cursor: 'next-page_2' })
    const url = new URL(sent[0]!.url)
    expect(Object.fromEntries(url.searchParams)).toEqual({ view: 'facility', status: 'review_required', evidence: 'none', limit: '20', cursor: 'next-page_2' })
    expect(sent[0]!.url).not.toMatch(/HID-|hid=|nin=|Patient/)
  })

  it('takes a list without nextCursor as the last page, and refuses an answer in another shape', async () => {
    const last = await listWith({ view: 'mine', cases: [ITEM] })
    expect(await last.staffApi.listRegistrationCases(FACILITY, { view: 'mine' })).toEqual({ view: 'mine', cases: [ITEM], nextCursor: null })
    vi.unstubAllGlobals(); vi.resetModules()
    const odd = await listWith({ items: [ITEM] })
    await expect(odd.staffApi.listRegistrationCases(FACILITY, { view: 'mine' })).rejects.not.toHaveProperty('code')
  })

  it.each([
    ['without a case ID', { caseId: undefined }],
    ['without a status', { status: undefined }],
    ['without a name', { fullName: undefined }],
    ['with a date of birth in another shape', { dateOfBirth: 19900102 }],
    ['without when it was started', { createdAt: undefined }],
    ['without when it was updated', { updatedAt: undefined }],
    ['without who started it', { createdByMe: 'yes' }],
  ])('refuses the whole page when a row comes %s, rather than show part of it as all of it', async (_, change) => {
    const { staffApi } = await listWith({ view: 'mine', cases: [ITEM, { ...ITEM, caseId: 'c0000000-0000-4000-8000-000000000002', ...change }], nextCursor: null })
    await expect(staffApi.listRegistrationCases(FACILITY, { view: 'mine' })).rejects.toThrow('The registration list answered in a shape this page does not read.')
  })

  it('takes a row without a date of birth', async () => {
    const answer = { view: 'mine', cases: [{ ...ITEM, dateOfBirth: null }], nextCursor: null }
    const { staffApi } = await listWith(answer)
    expect(await staffApi.listRegistrationCases(FACILITY, { view: 'mine' })).toEqual(answer)
  })

  it('passes Identity’s refusal on by its code, for the page to word', async () => {
    const { staffApi } = await listWith({ code: 'REGISTRATION_CASE_LIST_DENIED', message: 'Only staff who approve registrations can see every case at this facility.' }, 403)
    await expect(staffApi.listRegistrationCases(FACILITY, { view: 'facility' })).rejects.toMatchObject({ status: 403, code: 'REGISTRATION_CASE_LIST_DENIED' })
  })
})
