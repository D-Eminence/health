import { findEndpoint } from '@hid/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ name: 'test', apiBaseUrl: 'https://gateway.example.test' }) }))
// The staff client binds fetch when its module loads, so each test loads it afresh.
afterEach(() => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules()
  document.cookie = 'hid_access_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

/**
 * What the blue EHR sends and reads for the allergy check at prescribing (hid-system#218 at 7fbb04aa), through the real
 * staff client with only the network stubbed (on example.test): the acknowledgement goes on a prescription's create,
 * Activate or Resume (PATCH) and send only when one is given, never as an empty member and never on a lab request; the
 * check's token is kept; the 409 and the 400 "not a substance" are read from the problem as the EHR writes it. Every
 * id and token is fictional.
 */
interface Sent { url: URL; method: string; body: unknown; headers: Headers }

async function staffClient(answer: unknown = {}, status = 200) {
  // The allergy routes are served by Novu (hid-system 0124): the client calls them only under that contract.
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  document.cookie = 'hid_access_csrf=csrf-1'
  const sent: Sent[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    sent.push({ url: new URL(String(url)), method: String(init.method), headers: new Headers(init.headers),
      body: init.body ? JSON.parse(String(init.body)) : undefined })
    const type = status >= 400 ? 'application/problem+json' : 'application/json'
    return new Response(JSON.stringify(answer), { status, headers: { 'Content-Type': type } })
  }))
  const { setStaffSessionReady } = await import('../../../staff/session')
  setStaffSessionReady(true)
  const { staffApi, orderRoutesApi } = await import('../../../staff/api')
  // Loaded with the client, so a refusal is read with the same HidApiError the client throws.
  const allergy = await import('../../../ehr-blue/clinical/parts/allergyWarning')
  return { sent, staffApi, orderRoutesApi, allergy }
}

const FACILITY = 'facility-demo-hospital'
const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const ENCOUNTER = 'e0000000-0000-4000-8000-000000000001'
const ORDER = 'c0000000-0000-4000-8000-000000000002'
const BASE = `/api/v1/ehr/patients/${PATIENT}/encounters/${ENCOUNTER}`
const TOKEN = 'b1'.repeat(32)
const ACK = { reason: 'Tolerated amoxicillin in 2024; observe for 30 minutes.', warningToken: TOKEN }
const STATUS = { expectedRowVersion: 3, changeReason: 'Ready to start', status: 'active' }
const SEND = { expectedRowVersion: 1, receivingFacilityId: 'f-2', attestationTextVersion: 'order-route-prescription-attestation-v1' }
const MESSAGE = 'Penicillin allergy: SEVERE (Anaphylaxis). This medicine is one of the penicillins, the same group. Recorded by a clinician at this facility on 3 Mar 2026.'

describe('the allergy acknowledgement on the wire', () => {
  it('Activate or Resume sends the PATCH as before, and the acknowledgement only when given', async () => {
    const { sent, staffApi } = await staffClient({ id: ORDER })
    await staffApi.updateRecord(FACILITY, PATIENT, ENCOUNTER, 'prescriptions', ORDER, STATUS)
    await staffApi.updateRecord(FACILITY, PATIENT, ENCOUNTER, 'prescriptions', ORDER, { ...STATUS, allergyAcknowledgement: ACK })
    expect(sent.map(request => [request.method, request.url.pathname])).toEqual([['PATCH', `${BASE}/prescriptions/${ORDER}`], ['PATCH', `${BASE}/prescriptions/${ORDER}`]])
    expect(sent[0]!.body).toEqual(STATUS)
    expect(sent[1]!.body).toEqual({ ...STATUS, allergyAcknowledgement: ACK })
  })

  it('a prescription’s send carries it when given; a lab request’s never does', async () => {
    const { sent, orderRoutesApi } = await staffClient({ route: {}, order: {}, replayed: false })
    await orderRoutesApi.send(FACILITY, PATIENT, ENCOUNTER, 'prescription', ORDER, SEND, 'send-key-0001')
    await orderRoutesApi.send(FACILITY, PATIENT, ENCOUNTER, 'prescription', ORDER, { ...SEND, allergyAcknowledgement: ACK }, 'send-key-0001')
    await orderRoutesApi.send(FACILITY, PATIENT, ENCOUNTER, 'lab_request', ORDER, { ...SEND, allergyAcknowledgement: ACK }, 'send-key-0002')
    const plain = { ...SEND, patientAgreed: true }
    expect(sent[0]!.body).toEqual(plain)
    expect(sent[1]!.body).toEqual({ ...plain, allergyAcknowledgement: ACK })
    // The same key: the EHR's send digest leaves the acknowledgement out, and a 409 wrote nothing.
    expect(sent[1]!.headers.get('idempotency-key')).toBe('send-key-0001')
    expect(sent[2]!.url.pathname).toBe(`${BASE}/lab-requests/${ORDER}/order-routes`)
    expect(sent[2]!.body).toEqual(plain)
  })

  it('a create carries it only when given, never as an empty member', async () => {
    const { sent, staffApi, allergy: { withAllergyAcknowledgement } } = await staffClient({ id: ORDER })
    const body = { medicationDisplay: 'Amoxicillin 500 mg capsules', frequency: 'Three times daily', instructions: 'After meals', status: 'draft' }
    await staffApi.createRecord(FACILITY, PATIENT, ENCOUNTER, 'prescriptions', withAllergyAcknowledgement(body, null), 'create-key-0001')
    await staffApi.createRecord(FACILITY, PATIENT, ENCOUNTER, 'prescriptions', withAllergyAcknowledgement(body, ACK), 'create-key-0001')
    expect(sent[0]!.body).toEqual(body)
    expect(Object.keys(sent[0]!.body as object)).not.toContain('allergyAcknowledgement')
    expect(sent[1]!.body).toEqual({ ...body, allergyAcknowledgement: ACK })
  })
})

describe('the allergy check and its refusals on the wire', () => {
  it('reads the check with its token, and refuses an answer without one', async () => {
    const answer = { matches: [{ source: 'recorded', allergyId: 'aaaaaaaa-0000-4000-8000-000000000001', allergyIds: ['aaaaaaaa-0000-4000-8000-000000000001'],
      substance: 'Penicillin', reaction: 'Anaphylaxis', severity: 'severe', matchKind: 'same_class', className: 'penicillins',
      recordedHere: true, recordedOn: '2026-03-03T09:15:00.000Z', message: MESSAGE }], acknowledgementRequired: true, warningToken: TOKEN }
    const first = await staffClient(answer)
    const check = await first.staffApi.allergyCheck(FACILITY, PATIENT, { medicationDisplay: 'Amoxicillin 500 mg capsules' })
    expect(first.sent[0]!.method).toBe('POST')
    expect(first.sent[0]!.url.pathname).toBe(`/api/v1/ehr/patients/${PATIENT}/allergy-check`)
    expect(first.sent[0]!.body).toEqual({ medicationDisplay: 'Amoxicillin 500 mg capsules' })
    expect(first.sent[0]!.headers.get('x-purpose-of-use')).toBe('direct-care')
    expect(check.warningToken).toBe(TOKEN)
    expect(check.matches[0]).toMatchObject({ severity: 'severe', reaction: 'Anaphylaxis', recordedHere: true, message: MESSAGE })

    vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules()
    const second = await staffClient({ matches: [], acknowledgementRequired: false })
    await expect(second.staffApi.allergyCheck(FACILITY, PATIENT, { medicationDisplay: 'Paracetamol 1 g' })).rejects.toThrow()
  })

  it('reads the 409’s warnings and token from the problem’s errors', async () => {
    const problem = {
      type: 'https://problems.example.test/allergy-acknowledgement-required', title: 'CONFLICT', status: 409,
      detail: 'The allergy warning changed since it was shown. Check the allergies again and give a reason to go ahead.',
      correlationId: 'req-1', code: 'ALLERGY_ACKNOWLEDGEMENT_REQUIRED',
      errors: [{ field: 'allergyAcknowledgement', messages: [MESSAGE] }, { field: 'allergyAcknowledgement.warningToken', messages: ['c'.repeat(64)] }],
    }
    const { staffApi, allergy } = await staffClient(problem, 409)
    const caught = await staffApi.updateRecord(FACILITY, PATIENT, ENCOUNTER, 'prescriptions', ORDER, { ...STATUS, allergyAcknowledgement: ACK })
      .then(() => null, (error: unknown) => error)
    expect(allergy.readAllergyRefusal(caught, true)).toEqual({ messages: [MESSAGE], warningToken: 'c'.repeat(64), changedSinceShown: true })
  })

  it('keeps the code of each refused part of the 409 (7fbb04aa), after the token’s entry, and reads it by code', async () => {
    const problem = {
      type: 'https://problems.example.test/allergy-acknowledgement-required', title: 'CONFLICT', status: 409,
      detail: 'The reason to go ahead after the allergy warning was not accepted. Check the allergies and give a reason to go ahead.',
      correlationId: 'req-2', code: 'ALLERGY_ACKNOWLEDGEMENT_REQUIRED',
      errors: [
        { field: 'allergyAcknowledgement', messages: [MESSAGE] },
        { field: 'allergyAcknowledgement.warningToken', messages: [TOKEN] },
        { field: 'allergyAcknowledgement.rejected', code: 'ALLERGY_ACKNOWLEDGEMENT_REASON_INVALID',
          messages: ['The reason must be 10 to 500 characters, with at least one word, and no control characters other than new lines.'] },
        { field: 'allergyAcknowledgement.rejected', code: 'ALLERGY_WARNING_TOKEN_INVALID', messages: ['The allergy warning was not identified. Check the allergies again.'] },
      ],
    }
    const { staffApi, allergy } = await staffClient(problem, 409)
    const caught = await staffApi.updateRecord(FACILITY, PATIENT, ENCOUNTER, 'prescriptions', ORDER, { ...STATUS, allergyAcknowledgement: ACK })
      .then(() => null, (error: unknown) => error)
    expect((caught as { details: unknown }).details).toEqual(problem.errors)
    // The refused parts are not warning lines; the token is found after them; neither part is "changed".
    expect(allergy.readAllergyRefusal(caught, true)).toEqual({ messages: [MESSAGE], warningToken: TOKEN, changedSinceShown: false,
      reasonRefused: 'invalid', tokenRefused: true })
  })

  it('reads the allergy list whole, and refuses it whole when one recorded allergy can’t be read (L9)', async () => {
    const allergy = (id: string, substance: string) => ({ id, substance, reaction: null, severity: 'moderate', status: 'active', rowVersion: 1,
      createdAt: '2026-11-01T09:00:00.000Z', enteredInErrorReason: null, recordedHere: true })
    const good = { recorded: [allergy('a1240000-0000-4000-8000-000000000061', 'Penicillin'), allergy('a1240000-0000-4000-8000-000000000062', 'Latex')],
      patientReported: { allergies: 'Peanuts', updatedAt: null } }
    const first = await staffClient(good)
    expect((await first.staffApi.allergies(FACILITY, PATIENT)).recorded.map(item => item.substance)).toEqual(['Penicillin', 'Latex'])
    expect(first.sent[0]!.url.pathname).toBe(`/api/v1/ehr/patients/${PATIENT}/allergies`)

    vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules()
    const second = await staffClient({ ...good, recorded: [good.recorded[0], { ...good.recorded[1], status: 'superseded' }] })
    await expect(second.staffApi.allergies(FACILITY, PATIENT)).rejects.toThrow('The allergies could not be read.')
  })

  it('reads 400 ALLERGY_NOT_A_SUBSTANCE when "NKDA" is recorded as an allergy', async () => {
    const { staffApi, allergy } = await staffClient({ title: 'BAD_REQUEST', status: 400, code: 'ALLERGY_NOT_A_SUBSTANCE',
      detail: 'Record the medicine or substance the patient reacts to. "No known allergies" is not recorded as an allergy.' }, 400)
    const caught = await staffApi.addAllergy(FACILITY, PATIENT, { substance: 'NKDA', severity: 'unknown' }, 'allergy-key-00000001')
      .then(() => null, (error: unknown) => error)
    expect(allergy.isNotASubstanceRefusal(caught)).toBe(true)
  })
})

describe('the contract registry describes what this page reads at hid-system#218 7fbb04aa', () => {
  it('the allergy check: the 409’s rejected parts, read by code, and the rule failures that are now that 409, not a 400', () => {
    const note = findEndpoint('ehr.allergyCheck')?.note ?? ''
    for (const words of ['allergyAcknowledgement.rejected', 'by code', 'ALLERGY_ACKNOWLEDGEMENT_MISSING', 'ALLERGY_ACKNOWLEDGEMENT_REASON_MISSING',
      'ALLERGY_ACKNOWLEDGEMENT_REASON_INVALID', 'ALLERGY_WARNING_TOKEN_INVALID', 'ALLERGY_WARNING_TOKEN_STALE', 'instead of a 400']) {
      expect(note).toContain(words)
    }
  })

  it('the prescription reads: allergyAcknowledgements on each, where absent means it can’t be shown, and each step, handoff included', () => {
    for (const name of ['ehr.prescriptions', 'ehr.prescription']) {
      const note = findEndpoint(name)?.note ?? ''
      expect(note).toContain('allergyAcknowledgements')
      expect(note).toContain('createdByMembershipId')
      expect(note).toContain('absent')
      expect(note).toContain('stage (create, activate, resume, send, or handoff')
    }
  })

  it('the allergy check: a send to another facility is checked for a draft and an active prescription alike', () => {
    const note = findEndpoint('ehr.allergyCheck')?.note ?? ''
    expect(note).toContain('a send to another facility (of a draft or an active prescription alike)')
    expect(note).not.toContain('a send of a draft')
  })

  it('entered in error: each refusal the chart reads, 409 ALLERGY_ALREADY_ENTERED_IN_ERROR included (L10)', () => {
    const note = findEndpoint('ehr.allergyEnteredInError')?.note ?? ''
    for (const words of ['409 ALLERGY_RECORDED_ELSEWHERE', '409 ALLERGY_ALREADY_ENTERED_IN_ERROR', '412 VERSION_CONFLICT']) expect(note).toContain(words)
  })

  it('the emergency read: allergies { recorded, patientReported }, where absent means they can’t be shown', () => {
    const note = findEndpoint('ehr.emergencyRecords')?.note ?? ''
    expect(note).toContain('allergies { recorded, patientReported }')
    expect(note).toContain('absent')
  })
})
