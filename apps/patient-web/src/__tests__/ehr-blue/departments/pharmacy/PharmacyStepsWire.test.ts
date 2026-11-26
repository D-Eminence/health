import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ name: 'test', apiBaseUrl: 'https://gateway.example.test' }) }))
// The staff client binds fetch when its module loads, so each test loads it afresh.
afterEach(() => {
  vi.unstubAllGlobals(); vi.resetModules()
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

/**
 * hid-system ORD-4 (INTERFACE_CONTRACT "ORD-4", its "Work item answers" and "Screen change"), through the real staff
 * client with only the network stubbed (on example.test): the work list's `pharmacyStep` and `pharmacistAcceptance` are
 * kept together only for a step and an `acceptedWith` the page knows, left out when absent or unknown, and refused only
 * for a wrong type; Accept sends exactly the item's version with its facility, purpose and the caller's key. Every id
 * here is fictional.
 */
interface Sent { url: URL; method: string; body: unknown; headers: Headers }

async function staffClient(answer: unknown, status = 200) {
  // Several answers in one test: a fresh client for each, bound to its own fetch.
  vi.resetModules()
  document.cookie = 'hid_access_csrf=csrf-1'
  const sent: Sent[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    sent.push({ url: new URL(String(url)), method: String(init.method), headers: new Headers(init.headers),
      body: init.body ? JSON.parse(String(init.body)) : undefined })
    const type = status >= 400 ? 'application/problem+json' : 'application/json'
    return new Response(JSON.stringify(answer), { status, headers: { 'Content-Type': type } })
  }))
  const { setStaffSessionReady } = await import('../../../../staff/session')
  setStaffSessionReady(true)
  const { staffApi } = await import('../../../../staff/api')
  return { sent, staffApi }
}

const FACILITY = '98d00002-0000-4000-8000-000000000003'
const ITEM = { id: 'a0000000-0000-4000-8000-0000000000a1', patientId: 'p-1', version: 1, acceptedAt: '2026-11-20T09:40:00.000Z',
  medication: { display: 'Amoxicillin 500 mg capsule' }, dispensing: null }
const ACCEPTANCE = { acceptedAt: '2026-11-20T09:52:00.000Z', acceptedByMembershipId: 'm0000000-0000-4000-8000-000000000001', acceptedWith: 'accept' }

async function listed(fields: Record<string, unknown>) {
  const { staffApi } = await staffClient({ items: [{ ...ITEM, ...fields }] })
  return staffApi.pharmacyWorkItems(FACILITY)
}

describe('the work list’s steps', () => {
  it('today’s answer, with no step, reads exactly as it came', async () => {
    const list = await listed({})
    expect(list.items[0]).toEqual(ITEM)
    expect(list.items[0]).not.toHaveProperty('pharmacyStep')
    expect(list.items[0]).not.toHaveProperty('pharmacistAcceptance')
  })

  it('keeps a known step with its acceptance, or with null', async () => {
    expect((await listed({ pharmacyStep: 'accepted', pharmacistAcceptance: ACCEPTANCE })).items[0])
      .toEqual({ ...ITEM, pharmacyStep: 'accepted', pharmacistAcceptance: ACCEPTANCE })
    for (const step of ['received', 'dispensed', 'dispensing_reversed']) {
      expect((await listed({ pharmacyStep: step, pharmacistAcceptance: null })).items[0]).toEqual({ ...ITEM, pharmacyStep: step, pharmacistAcceptance: null })
    }
    for (const acceptedWith of ['dispensing', 'order_route', 'hand_off']) {
      expect((await listed({ pharmacyStep: 'dispensed', pharmacistAcceptance: { ...ACCEPTANCE, acceptedWith } })).items[0]?.pharmacistAcceptance)
        .toEqual({ ...ACCEPTANCE, acceptedWith })
    }
  })

  it('leaves both out, and the item reads as today, for a step or an acceptedWith it does not know', async () => {
    for (const fields of [
      { pharmacyStep: 'on_hold', pharmacistAcceptance: ACCEPTANCE },
      { pharmacyStep: 'on_hold' },
      { pharmacyStep: 'accepted', pharmacistAcceptance: { ...ACCEPTANCE, acceptedWith: 'phone_call' } },
      { pharmacyStep: 'accepted', pharmacistAcceptance: { acceptedWith: 'phone_call' } },
    ]) expect((await listed(fields)).items[0]).toEqual(ITEM)
  })

  it('refuses only a wrong type, as an unreadable answer', async () => {
    for (const fields of [
      { pharmacyStep: null },
      { pharmacyStep: 2, pharmacistAcceptance: null },
      { pharmacyStep: 'received' },
      { pharmacyStep: 'accepted', pharmacistAcceptance: 'yes' },
      { pharmacyStep: 'accepted', pharmacistAcceptance: [ACCEPTANCE] },
      { pharmacyStep: 'accepted', pharmacistAcceptance: { ...ACCEPTANCE, acceptedWith: 1 } },
      { pharmacyStep: 'accepted', pharmacistAcceptance: { ...ACCEPTANCE, acceptedWith: undefined } },
      { pharmacyStep: 'accepted', pharmacistAcceptance: { ...ACCEPTANCE, acceptedAt: '' } },
      { pharmacyStep: 'accepted', pharmacistAcceptance: { ...ACCEPTANCE, acceptedAt: undefined } },
      { pharmacyStep: 'accepted', pharmacistAcceptance: { ...ACCEPTANCE, acceptedByMembershipId: 7 } },
    ]) await expect(listed(fields)).rejects.toMatchObject({ name: 'HidApiError', status: 502, code: 'INVALID_RESPONSE' })
  })
})

/**
 * hid-system Q132 A (INTERFACE_CONTRACT "Q132 A", its "Work item answers" and `@hid/api-client`'s rules): a dispensed
 * item's `changedAfterDispensing` is kept with a known `change`, kept without an unknown one, left out when absent, and a
 * broken one fails the whole list, never a dispensed item shown without its notice.
 */
describe('the work list’s change after dispensing', () => {
  const DISPENSED = { ...ITEM, dispensing: { id: 'd0000000-0000-4000-8000-0000000000d1', reversed: false } }
  const CHANGED_AT = '2026-11-20T08:15:00.000Z'
  const notice = (change: unknown, changeCount: unknown = 1) => ({ change, changedAt: CHANGED_AT, changeCount })

  async function listedDispensed(fields: Record<string, unknown>) {
    const { staffApi } = await staffClient({ items: [{ ...DISPENSED, ...fields }] })
    return staffApi.pharmacyWorkItems(FACILITY)
  }

  it('today’s answer, with no notice, reads exactly as it came', async () => {
    const list = await listedDispensed({})
    expect(list.items[0]).toEqual(DISPENSED)
    expect(list.items[0]).not.toHaveProperty('changedAfterDispensing')
  })

  it('keeps each change the page knows, with its time and count, and drops any other key', async () => {
    for (const [index, change] of ['on_hold', 'cancelled', 'entered_in_error', 'edited', 'resumed'].entries()) {
      expect((await listedDispensed({ changedAfterDispensing: notice(change, index + 1) })).items[0])
        .toEqual({ ...DISPENSED, changedAfterDispensing: { change, changedAt: CHANGED_AT, changeCount: index + 1 } })
    }
    expect((await listedDispensed({ changedAfterDispensing: { ...notice('on_hold', 2), prescriptionVersion: 7, prescriptionId: 'x' } }))
      .items[0]?.changedAfterDispensing).toStrictEqual({ change: 'on_hold', changedAt: CHANGED_AT, changeCount: 2 })
  })

  it('keeps the notice without its change for a change it does not know, or none', async () => {
    for (const changedAfterDispensing of [notice('stopped_at_the_counter', 3), notice('ON_HOLD'), notice(''),
      { changedAt: CHANGED_AT, changeCount: 1 }]) {
      const item = (await listedDispensed({ changedAfterDispensing })).items[0]
      expect(item?.changedAfterDispensing).toStrictEqual({ changedAt: CHANGED_AT, changeCount: changedAfterDispensing.changeCount })
    }
  })

  it('keeps it beside the item’s steps', async () => {
    const fields = { pharmacyStep: 'dispensing_reversed', pharmacistAcceptance: { ...ACCEPTANCE, acceptedWith: 'dispensing' },
      changedAfterDispensing: notice('cancelled', 2) }
    expect((await listedDispensed(fields)).items[0]).toEqual({ ...DISPENSED, ...fields })
  })

  it('fails the whole list for a broken notice, as an unreadable answer', async () => {
    for (const changedAfterDispensing of [
      null, [notice('cancelled')], 'cancelled', 1, true, {},
      { change: 'cancelled', changeCount: 1 }, notice('cancelled', 0), notice('cancelled', -1), notice('cancelled', 1.5),
      notice('cancelled', '2'), notice('cancelled', null), { change: 'cancelled', changedAt: CHANGED_AT },
      notice('cancelled', Number.MAX_SAFE_INTEGER + 1), { ...notice('cancelled'), changedAt: '' }, { ...notice('cancelled'), changedAt: 5 },
      { ...notice('cancelled'), changedAt: null }, notice(null), notice(3), notice(['cancelled']),
    ]) await expect(listedDispensed({ changedAfterDispensing })).rejects.toMatchObject({ name: 'HidApiError', status: 502, code: 'INVALID_RESPONSE' })
    const { staffApi } = await staffClient({ items: [DISPENSED, { ...DISPENSED, id: 'a0000000-0000-4000-8000-0000000000a2', changedAfterDispensing: null }] })
    await expect(staffApi.pharmacyWorkItems(FACILITY)).rejects.toMatchObject({ status: 502, code: 'INVALID_RESPONSE' })
  })
})

describe('Accept on the wire', () => {
  it('sends exactly the item’s version, with the facility, direct care and the caller’s key', async () => {
    const { sent, staffApi } = await staffClient({ workItemId: ITEM.id, pharmacyStep: 'accepted', pharmacistAcceptance: ACCEPTANCE, alreadyAccepted: false }, 201)
    const answer = await staffApi.acceptPharmacyWorkItem(FACILITY, ITEM, 'accept-key-0000000001')
    expect(answer).toEqual({ workItemId: ITEM.id, pharmacyStep: 'accepted', pharmacistAcceptance: ACCEPTANCE, alreadyAccepted: false })
    expect(sent).toHaveLength(1)
    expect([sent[0]!.method, sent[0]!.url.pathname]).toEqual(['POST', `/api/v1/pharmacy/work-items/${ITEM.id}/accept`])
    expect(sent[0]!.body).toEqual({ expectedWorkItemVersion: 1 })
    expect(sent[0]!.headers.get('X-Facility-Id')).toBe(FACILITY)
    expect(sent[0]!.headers.get('X-Purpose-Of-Use')).toBe('direct-care')
    expect(sent[0]!.headers.get('Idempotency-Key')).toBe('accept-key-0000000001')
  })

  it('keeps the withdrawn reason of a refusal, for the page to branch on', async () => {
    const { staffApi } = await staffClient({ status: 409, code: 'PHARMACY_PRESCRIPTION_NOT_DISPENSABLE', withdrawnReason: 'changed',
      detail: 'This prescription can no longer be dispensed here' }, 409)
    await expect(staffApi.acceptPharmacyWorkItem(FACILITY, ITEM, 'accept-key-0000000002'))
      .rejects.toMatchObject({ code: 'PHARMACY_PRESCRIPTION_NOT_DISPENSABLE', withdrawnReason: 'changed' })
  })
})

describe('staff names on the wire (SX-9)', () => {
  const MEMBER = 'c0000000-0000-4000-8000-0000000000c1'
  const NAMES = { facilityId: FACILITY, staff: [{ membershipId: MEMBER, name: 'Bola Fictional', current: true },
    { membershipId: 'c0000000-0000-4000-8000-0000000000c2', name: null, current: false }], complete: true }

  it('asks for the ids given, at the facility, under healthcare operations, and keeps a null name', async () => {
    const { sent, staffApi } = await staffClient(NAMES)
    expect(await staffApi.facilityStaffNames(FACILITY, [MEMBER])).toEqual(NAMES)
    expect(sent).toHaveLength(1)
    expect([sent[0]!.method, sent[0]!.url.pathname]).toEqual(['GET', '/api/v1/identity/facility-staff-names'])
    expect(sent[0]!.url.searchParams.get('membershipIds')).toBe(MEMBER)
    expect([...sent[0]!.url.searchParams.keys()]).toEqual(['membershipIds'])
    expect(sent[0]!.headers.get('X-Facility-Id')).toBe(FACILITY)
    expect(sent[0]!.headers.get('X-Purpose-Of-Use')).toBe('healthcare-operations')
  })

  it('leaves out a row it can’t read, and refuses an answer in another shape', async () => {
    const { staffApi } = await staffClient({ ...NAMES, staff: [...NAMES.staff, { membershipId: 'x', name: 3, current: true }, null] })
    expect((await staffApi.facilityStaffNames(FACILITY, [MEMBER])).staff).toEqual(NAMES.staff)
    for (const answer of [{ staff: [] }, { ...NAMES, staff: null }, { ...NAMES, complete: 'yes' }]) {
      const fresh = await staffClient(answer)
      await expect(fresh.staffApi.facilityStaffNames(FACILITY, [MEMBER])).rejects.toMatchObject({ status: 502, code: 'INVALID_RESPONSE' })
    }
  })

  it('sends nothing for no ids or more than 100', async () => {
    const { sent, staffApi } = await staffClient(NAMES)
    await expect(staffApi.facilityStaffNames(FACILITY, [])).rejects.toThrow(RangeError)
    await expect(staffApi.facilityStaffNames(FACILITY, Array.from({ length: 101 }, () => MEMBER))).rejects.toThrow(RangeError)
    expect(sent).toHaveLength(0)
  })
})
