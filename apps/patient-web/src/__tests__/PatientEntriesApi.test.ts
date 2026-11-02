import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isHidApiError } from '@hid/http'
import { ownRecordFits, parsePatientEntries, type OwnRecordInput } from '../api'
import {
  forgetPatientEntriesServed, learnPatientEntriesServed, patientEntriesServed, saysPatientEntriesNotServed,
} from '../patientEntriesServed'
import { json, patientApi, problem, type Handler } from './portalHarness'

const environment = vi.hoisted(() => ({ name: 'staging' }))
vi.mock('../env', () => ({ getEnvironment: () => environment }))

/**
 * The patient-entry calls (BACKEND-NEEDS.md §1), each against a fake gateway, and the served switch they set: the Save,
 * and the records answer that lists the entries under `patientEntries` (there is no list read of its own).
 */

const ENTRY_ID = '7b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'
const DOCUMENT_ID = '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a'
const ENTRIES = '/ehr/me/patient-entries'
const RECORDS = '/ehr/me/records'
/** The records answer as the backends send it today (Novu's keys): no `patientEntries`. */
const TODAYS_RECORDS = { encounters: [], notes: [], importedRecords: [], importedHealthProfile: null, limit: 50 }
const ENTRY: OwnRecordInput = { kind: 'medicine', title: 'Amoxicillin 500 mg', facilityName: null, occurredOn: '2026-10-20', notes: null }

const refusal = async (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error)

/** A storage PUT, recorded; answered 200 unless told otherwise. */
function storage(status = 200) {
  const puts: Array<{ url: string; init: RequestInit }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    puts.push({ url: String(url), init })
    return new Response(null, { status })
  }))
  return puts
}

const intentAnswer = (url = 'https://storage.example.test/bucket/clinical/objects/one?X-Amz-Signature=fictional') => json({
  document: { id: DOCUMENT_ID, status: 'initiated', scanStatus: 'pending' },
  upload: { method: 'PUT', url, expiresInSeconds: 300, requiredHeaders: { 'content-type': 'image/png', 'x-amz-checksum-sha256': 'Zm9v' } },
}, 201)

/** The whole upload path served: the link, then the confirm. */
const uploads = (intent: () => Response = () => intentAnswer()): Handler => (path, method) => {
  if (path === `${ENTRIES}/${ENTRY_ID}/documents/upload-intents` && method === 'POST') return intent()
  if (path === `${ENTRIES}/${ENTRY_ID}/documents/${DOCUMENT_ID}/complete` && method === 'POST') {
    return json({ document: { id: DOCUMENT_ID, status: 'uploaded', scanStatus: 'pending' } })
  }
  return problem(404, 'NOT_FOUND', `Cannot ${method} ${path}`)
}

beforeEach(() => { forgetPatientEntriesServed(); environment.name = 'staging' })
afterEach(() => { vi.unstubAllGlobals() })

describe('the served switch', () => {
  it('learns served once and for all, and not served only while nothing has said otherwise', () => {
    expect(patientEntriesServed()).toBeNull()
    learnPatientEntriesServed(false)
    expect(patientEntriesServed()).toBe(false)
    learnPatientEntriesServed(true)
    learnPatientEntriesServed(false)
    expect(patientEntriesServed()).toBe(true)
    forgetPatientEntriesServed()
    expect(patientEntriesServed()).toBeNull()
  })

  it('reads only a 404 NOT_FOUND as not served', async () => {
    const unrouted = patientApi(() => problem(404, 'NOT_FOUND', 'Cannot POST'))
    expect(saysPatientEntriesNotServed(await refusal(unrouted.api.addOwnRecord(ENTRY, 'key-1')))).toBe(true)
    const refused = patientApi(() => problem(404, 'PATIENT_ENTRIES_DISABLED', 'Not here.'))
    expect(saysPatientEntriesNotServed(await refusal(refused.api.addOwnRecord(ENTRY, 'key-1')))).toBe(false)
    expect(saysPatientEntriesNotServed(new Error('Not found'))).toBe(false)
  })
})

describe('api.addOwnRecord', () => {
  it('sends the entry alone, with its Idempotency-Key, and answers the saved entry’s id; a 201 says served', async () => {
    const { api, sent, headers } = patientApi(() => json({ entry: { id: ENTRY_ID, source: 'patient', title: ENTRY.title } }, 201))
    const extra = { ...ENTRY, attachments: [{ contentBase64: 'AAAA' }] } as OwnRecordInput
    expect(await api.addOwnRecord(extra, 'save-key-1')).toEqual({ id: ENTRY_ID })
    expect(sent).toEqual([{ path: ENTRIES, method: 'POST', body: ENTRY }])
    expect(headers[0]?.headers.get('Idempotency-Key')).toBe('save-key-1')
    expect(patientEntriesServed()).toBe(true)
  })

  it('learns not served from its 404 NOT_FOUND, and nothing from another 404', async () => {
    const { api } = patientApi(() => problem(404, 'NOT_FOUND', 'Cannot POST /api/v1/ehr/me/patient-entries'))
    expect(await refusal(api.addOwnRecord(ENTRY, 'k'))).toMatchObject({ status: 404, code: 'NOT_FOUND' })
    expect(patientEntriesServed()).toBe(false)
    forgetPatientEntriesServed()
    const other = patientApi(() => problem(404, 'PATIENT_NOT_FOUND', 'No such patient.'))
    await refusal(other.api.addOwnRecord(ENTRY, 'k'))
    expect(patientEntriesServed()).toBeNull()
  })

  it('refuses, before sending, a body over the edge limit', async () => {
    const { api, sent } = patientApi(() => json({ entry: { id: ENTRY_ID } }, 201))
    const long = { ...ENTRY, notes: '\u0002'.repeat(1400) }
    expect(ownRecordFits(long)).toBe(false)
    expect(ownRecordFits({ ...ENTRY, notes: 'x'.repeat(2000) })).toBe(true)
    expect(await refusal(api.addOwnRecord(long, 'k'))).toMatchObject({ status: 413, code: 'PATIENT_ENTRY_TOO_LARGE' })
    expect(sent).toEqual([])
  })

  it('does not take an answer without the entry’s id as saved, or as served', async () => {
    const { api } = patientApi(() => json({ id: ENTRY_ID }, 201))
    expect(await refusal(api.addOwnRecord(ENTRY, 'k'))).toMatchObject({ code: 'INVALID_RESPONSE' })
    expect(patientEntriesServed()).toBeNull()
  })
})

describe('api.records, which lists the records the patient added', () => {
  const testEntry = { id: ENTRY_ID, source: 'patient', kind: 'test', title: 'Malaria test', facilityName: 'Lagos General Hospital',
    occurredOn: '2026-10-20', notes: '', createdAt: '2026-10-21T08:00:00.000Z', documents: [
      { id: DOCUMENT_ID, fileName: 'slip.jpg', mediaType: 'image/jpeg', sizeBytes: '812345', status: 'uploaded', scanStatus: 'clean', createdAt: '2026-10-21T08:01:00.000Z' },
      { id: 'no-name', mediaType: 'image/jpeg', sizeBytes: 1, status: 'uploaded', scanStatus: 'clean', createdAt: '2026-10-21T08:01:00.000Z' },
      { id: 'odd', fileName: 'odd.png', mediaType: 'image/png', sizeBytes: 'many', status: 'quarantined', scanStatus: 'infected', createdAt: '2026-10-21T08:02:00.000Z' },
    ] }

  it('reads them from the records answer, leaving out what it cannot read; the key says served', async () => {
    const { api, sent } = patientApi(() => json({ ...TODAYS_RECORDS, patientEntries: [
      testEntry,
      { id: 'clinician', source: 'clinician', kind: 'visit', title: 'Not the patient’s', occurredOn: '2026-10-20', createdAt: '2026-10-21T08:00:00.000Z' },
      { id: 'no-title', source: 'patient', kind: 'visit', occurredOn: '2026-10-20', createdAt: '2026-10-21T08:00:00.000Z' },
      'not an entry',
    ] }))
    const records = await api.records()
    // The records' one read, and nothing else: no read of the entries of their own.
    expect(sent).toEqual([{ path: RECORDS, method: 'GET', body: null }])
    expect(records.patientEntries).toEqual([{
      id: ENTRY_ID, source: 'patient', kind: 'test', title: 'Malaria test', facilityName: 'Lagos General Hospital', occurredOn: '2026-10-20',
      notes: null, createdAt: '2026-10-21T08:00:00.000Z', documents: [
        { id: DOCUMENT_ID, fileName: 'slip.jpg', mediaType: 'image/jpeg', sizeBytes: 812345, status: 'uploaded', scanStatus: 'clean', createdAt: '2026-10-21T08:01:00.000Z' },
        // A status it does not know reads as not yet cleared, never as clean; a size that is not a number is left out.
        { id: 'odd', fileName: 'odd.png', mediaType: 'image/png', sizeBytes: null, status: 'uploaded', scanStatus: 'pending', createdAt: '2026-10-21T08:02:00.000Z' },
      ] }])
    expect(records.encounters).toEqual([])
    expect(patientEntriesServed()).toBe(true)
  })

  it('says served for an empty list too', async () => {
    const { api } = patientApi(() => json({ ...TODAYS_RECORDS, patientEntries: [] }))
    expect((await api.records()).patientEntries).toEqual([])
    expect(patientEntriesServed()).toBe(true)
  })

  it('learns not served from an answer without the key, only while nothing has said served', async () => {
    const { api, sent } = patientApi(() => json(TODAYS_RECORDS))
    const records = await api.records()
    expect('patientEntries' in records).toBe(false)
    expect(patientEntriesServed()).toBe(false)
    learnPatientEntriesServed(true)
    await api.records()
    expect(patientEntriesServed()).toBe(true)
    expect(sent.map(request => request.path)).toEqual([RECORDS, RECORDS])
  })

  it('leaves out a key that is not a list, and learns nothing from it', async () => {
    for (const patientEntries of [{ items: [testEntry] }, null, 'entries']) {
      forgetPatientEntriesServed()
      const { api } = patientApi(() => json({ ...TODAYS_RECORDS, patientEntries }))
      const records = await api.records()
      expect('patientEntries' in records, JSON.stringify(patientEntries)).toBe(false)
      expect(patientEntriesServed()).toBeNull()
    }
  })

  it('learns nothing from records that could not be read', async () => {
    const { api } = patientApi(() => json({ code: 'EHR_UNAVAILABLE', detail: 'Records are unavailable.', retryable: false }, 503))
    await refusal(api.records())
    expect(patientEntriesServed()).toBeNull()
  })

  it('has a parser that reads only a list', () => {
    expect(parsePatientEntries({ items: [] })).toBeNull()
    expect(parsePatientEntries([])).toEqual([])
    expect(parsePatientEntries([testEntry, {}])).toHaveLength(1)
  })
})

describe('api.withdrawOwnRecord', () => {
  it('posts the removal with no body and reads its answer', async () => {
    const { api, sent } = patientApi(() => json({ entry: { id: ENTRY_ID, status: 'withdrawn', withdrawnAt: '2026-10-22T09:00:00.000Z' } }))
    expect(await api.withdrawOwnRecord(ENTRY_ID)).toEqual({ id: ENTRY_ID, status: 'withdrawn', withdrawnAt: '2026-10-22T09:00:00.000Z' })
    expect(sent).toEqual([{ path: `${ENTRIES}/${ENTRY_ID}/withdraw`, method: 'POST', body: null }])
  })

  it('does not take an answer that does not say withdrawn as done', async () => {
    const { api } = patientApi(() => json({ entry: { id: ENTRY_ID, status: 'live' } }))
    expect(await refusal(api.withdrawOwnRecord(ENTRY_ID))).toMatchObject({ code: 'INVALID_RESPONSE' })
  })
})

describe('the upload steps', () => {
  it('asks for a link with the file’s details and its own key, and confirms with no body', async () => {
    const { api, sent, headers } = patientApi(uploads())
    const intent = await api.ownRecordUploadIntent(ENTRY_ID, { fileName: 'slip.png', mediaType: 'image/png', sizeBytes: 3, sha256Hex: 'a'.repeat(64) }, 'file-key-1')
    expect(intent.document.id).toBe(DOCUMENT_ID)
    expect(intent.upload).toMatchObject({ method: 'PUT', expiresInSeconds: 300 })
    expect(await api.completeOwnRecordDocument(ENTRY_ID, DOCUMENT_ID)).toEqual({ id: DOCUMENT_ID, status: 'uploaded', scanStatus: 'pending' })
    expect(sent).toEqual([
      { path: `${ENTRIES}/${ENTRY_ID}/documents/upload-intents`, method: 'POST', body: { fileName: 'slip.png', mediaType: 'image/png', sizeBytes: 3, sha256Hex: 'a'.repeat(64) } },
      { path: `${ENTRIES}/${ENTRY_ID}/documents/${DOCUMENT_ID}/complete`, method: 'POST', body: null },
    ])
    expect(headers[0]?.headers.get('Idempotency-Key')).toBe('file-key-1')
    expect(headers[1]?.headers.get('Idempotency-Key')).toBeNull()
  })

  it('refuses a link that is not a PUT', async () => {
    const { api } = patientApi(uploads(() => json({ document: { id: DOCUMENT_ID }, upload: { method: 'POST', url: 'https://storage.example.test/x', requiredHeaders: {} } }, 201)))
    expect(await refusal(api.ownRecordUploadIntent(ENTRY_ID, { fileName: 'a.png', mediaType: 'image/png', sizeBytes: 1, sha256Hex: 'a'.repeat(64) }, 'k')))
      .toMatchObject({ code: 'INVALID_RESPONSE' })
  })
})

describe('api.uploadOwnRecordDocument', () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  const png = () => new File([bytes], 'slip.png', { type: 'image/png' })

  it('hashes the exact bytes, asks for the link, PUTs the very File without cookies, then confirms', async () => {
    const puts = storage()
    const { api, sent, headers } = patientApi(uploads())
    const file = png()
    expect(await api.uploadOwnRecordDocument(ENTRY_ID, file, 'file-key-1'))
      .toEqual({ alreadyUploaded: false, document: { id: DOCUMENT_ID, status: 'uploaded', scanStatus: 'pending' } })
    expect(sent[0]?.body).toEqual({ fileName: 'slip.png', mediaType: 'image/png', sizeBytes: bytes.length, sha256Hex: createHash('sha256').update(bytes).digest('hex') })
    expect(headers[0]?.headers.get('Idempotency-Key')).toBe('file-key-1')
    expect(puts).toHaveLength(1)
    expect(puts[0]?.url).toBe('https://storage.example.test/bucket/clinical/objects/one?X-Amz-Signature=fictional')
    expect(puts[0]?.init).toMatchObject({ method: 'PUT', credentials: 'omit', redirect: 'error' })
    expect(puts[0]?.init.body).toBe(file)
    expect(new Headers(puts[0]?.init.headers).get('x-amz-checksum-sha256')).toBe('Zm9v')
    expect(sent.map(request => request.path)).toEqual([`${ENTRIES}/${ENTRY_ID}/documents/upload-intents`, `${ENTRIES}/${ENTRY_ID}/documents/${DOCUMENT_ID}/complete`])
  })

  it('takes a plain-http link to this machine only in the local environment', async () => {
    const local = 'http://localhost:9000/bucket/one'
    storage()
    environment.name = 'staging'
    const staging = patientApi(uploads(() => intentAnswer(local)))
    expect(await refusal(staging.api.uploadOwnRecordDocument(ENTRY_ID, png(), 'k'))).toMatchObject({ code: 'INVALID_UPLOAD_URL' })
    expect(staging.sent.map(request => request.path)).toEqual([`${ENTRIES}/${ENTRY_ID}/documents/upload-intents`])
    const puts = storage()
    environment.name = 'local'
    const here = patientApi(uploads(() => intentAnswer(local)))
    await here.api.uploadOwnRecordDocument(ENTRY_ID, png(), 'k')
    expect(puts.map(put => put.url)).toEqual([local])
  })

  it('counts a file as uploaded when its replayed link says an earlier try was confirmed, and sends nothing more', async () => {
    const puts = storage()
    const { api, sent, headers } = patientApi(uploads(() => json({ type: 'about:blank', title: 'PATIENT_DOCUMENT_ALREADY_UPLOADED', status: 409,
      code: 'PATIENT_DOCUMENT_ALREADY_UPLOADED', detail: 'This file is already uploaded.',
      document: { id: DOCUMENT_ID, status: 'uploaded', scanStatus: 'clean' } }, 409)))
    expect(await api.uploadOwnRecordDocument(ENTRY_ID, png(), 'file-key-1')).toEqual({ alreadyUploaded: true, document: null })
    expect(headers[0]?.headers.get('Idempotency-Key')).toBe('file-key-1')
    // No PUT and no confirm.
    expect(puts).toEqual([])
    expect(sent.map(request => request.path)).toEqual([`${ENTRIES}/${ENTRY_ID}/documents/upload-intents`])
  })

  it('takes no other refusal of the link as uploaded: another 409, or that code with another status', async () => {
    const puts = storage()
    for (const [status, code] of [[409, 'IDEMPOTENCY_KEY_REUSED'], [409, 'PATIENT_DOCUMENT_UPLOAD_INCOMPLETE'], [404, 'PATIENT_DOCUMENT_ALREADY_UPLOADED']] as const) {
      const { api, sent } = patientApi(uploads(() => problem(status, code, 'Refused.')))
      expect(await refusal(api.uploadOwnRecordDocument(ENTRY_ID, png(), 'k')), code).toMatchObject({ status, code })
      expect(sent.map(request => request.path)).toEqual([`${ENTRIES}/${ENTRY_ID}/documents/upload-intents`])
    }
    expect(puts).toEqual([])
  })

  it('does not confirm a file whose PUT failed', async () => {
    storage(403)
    const { api, sent } = patientApi(uploads())
    expect(await refusal(api.uploadOwnRecordDocument(ENTRY_ID, png(), 'k'))).toMatchObject({ code: 'UPLOAD_FAILED' })
    expect(sent.map(request => request.path)).toEqual([`${ENTRIES}/${ENTRY_ID}/documents/upload-intents`])
  })

  it('sends nothing once its signal is aborted, and nothing for a file the entry cannot take', async () => {
    const puts = storage()
    const { api, sent } = patientApi(uploads())
    const controller = new AbortController()
    controller.abort()
    expect(await refusal(api.uploadOwnRecordDocument(ENTRY_ID, png(), 'k', controller.signal))).toMatchObject({ code: 'REQUEST_CANCELLED' })
    for (const file of [new File([bytes], 'a.heic', { type: 'image/heic' }), new File([], 'empty.png', { type: 'image/png' }),
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' })]) {
      const error = await refusal(api.uploadOwnRecordDocument(ENTRY_ID, file, 'k'))
      expect(isHidApiError(error) && error.code, file.name).toBe('PATIENT_DOCUMENT_NOT_ACCEPTED')
    }
    expect(sent).toEqual([])
    expect(puts).toEqual([])
  })
})
