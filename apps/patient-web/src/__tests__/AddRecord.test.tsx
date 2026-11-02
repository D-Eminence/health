import { createHash } from 'node:crypto'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { ToastProvider } from '../kasuwa/toast'
import { AddRecordDrawer } from '../routes/AddRecord'
import {
  PATIENT_ENTRY_MAX_FILE_BYTES, PATIENT_ENTRY_MAX_FILES, PATIENT_ENTRY_MEDIA_TYPES, PATIENT_UPLOAD_DAILY_LIMIT_CODE, PATIENT_UPLOAD_DAILY_LIMIT_FILES,
} from '../api'
import { forgetPatientEntriesServed, patientEntriesServed } from '../patientEntriesServed'
import { json, press, problem, renderPortal, shownText, type Handler, type Sent } from './portalHarness'
import { NEVER_LEFT, PLAIN_JPEG, contains, gpsTaggedJpeg, metadataPng } from './photoFixtures'

vi.mock('../env', () => ({ getEnvironment: () => ({ name: 'staging' }) }))

/**
 * "Add a record" (BACKEND-NEEDS.md §1): the entry is saved with no file bytes in it, then each photo or file goes up
 * under it as staff uploads do (an upload link, a PUT of the very File to it, a confirm). Dormant until a backend serves
 * it: today's 404 NOT_FOUND on the Save keeps today's words, and nothing of a file leaves the device.
 */

const ENTRY_ID = '7b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'
const ENTRIES = '/ehr/me/patient-entries'
const STORAGE = 'https://storage.example.test'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const bytesOf = (text: string) => new TextEncoder().encode(text)
// A photo is walked and kept only without its metadata (photoMetadata.ts), so it has to be a JPEG: this one has none to
// take out, so what goes up is its every byte (photoMetadata.test.ts and the tests at the end take metadata out).
const photo = (name = 'result-slip.jpg', content: Uint8Array = PLAIN_JPEG) =>
  new File([new Uint8Array(content)], name, { type: 'image/jpeg', lastModified: 1 })
const pdf = (name = 'discharge.pdf', content = '%PDF-1.7 fictional discharge summary') =>
  new File([bytesOf(content)], name, { type: 'application/pdf', lastModified: 2 })

interface Options {
  save?: (body: unknown) => Response | Promise<Response>
  intent?: (body: { fileName: string }) => Response | undefined
  complete?: (documentId: string) => Response | undefined
}

/** One log of what reached the gateway and the storage, in the order it did. */
let log: string[]

/** The gateway: the facility list the place field offers, and the patient-entry routes as `options` answer them. */
function gateway(options: Options = {}): Handler {
  return (path, method, body) => {
    if (path === '/identity/patient-enrollments/participating-facilities') {
      return json({ facilities: [{ name: 'Lagos General Hospital', town: 'Ikeja', lga: 'Ikeja', state: 'Lagos' }], whatToBring: [] })
    }
    log.push(`${method} ${path}`)
    if (path === ENTRIES && method === 'POST') return options.save?.(body) ?? json({ entry: { id: ENTRY_ID } }, 201)
    if (path === `${ENTRIES}/${ENTRY_ID}/documents/upload-intents` && method === 'POST') {
      const file = body as { fileName: string; mediaType: string }
      const id = `doc-${file.fileName}`
      return options.intent?.(file) ?? json({
        document: { id, status: 'initiated', scanStatus: 'pending' },
        upload: { method: 'PUT', url: `${STORAGE}/bucket/clinical/objects/${id}?X-Amz-Signature=fictional`, expiresInSeconds: 300,
          requiredHeaders: { 'content-type': file.mediaType, 'x-amz-meta-declared-sha256': 'from-the-intent' } },
      }, 201)
    }
    const complete = path.match(/^\/ehr\/me\/patient-entries\/[^/]+\/documents\/([^/]+)\/complete$/)
    if (complete && method === 'POST') return options.complete?.(complete[1]!) ?? json({ document: { id: complete[1]!, status: 'uploaded', scanStatus: 'pending' } })
    return problem(404, 'NOT_FOUND', `Cannot ${method} ${path}`)
  }
}

interface Put { url: string; body: unknown; headers: Headers; credentials: RequestCredentials | undefined; signal: AbortSignal | null | undefined }

/**
 * The signed storage link, on its own host: each PUT is recorded and answered by `answer` (its number, from 1), or held
 * when it says 'hold' until the test lets it go. Like a browser's fetch, a PUT whose signal is aborted rejects at once.
 */
function storage(answer: (put: number) => Response | 'hold' = () => new Response(null, { status: 200 })) {
  const puts: Put[] = []
  const held: Array<(response: Response) => void> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    expect(new URL(String(url)).origin).toBe(STORAGE)
    log.push(`PUT ${new URL(String(url)).pathname}`)
    puts.push({ url: String(url), body: init.body, headers: new Headers(init.headers), credentials: init.credentials, signal: init.signal })
    const aborted = () => new DOMException('The operation was aborted.', 'AbortError')
    if (init.signal?.aborted) throw aborted()
    const reply = answer(puts.length)
    return new Promise<Response>((resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(aborted()), { once: true })
      if (reply === 'hold') held.push(resolve)
      else resolve(reply)
    })
  }))
  return { puts, held }
}

/** The Records page's use of the drawer: open, closed by its own controls, and opened again with "Add a record". */
function Host({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(true)
  return <ToastProvider>
    <button type="button" onClick={() => setOpen(true)}>Add a record</button>
    <AddRecordDrawer open={open} onClose={() => setOpen(false)} onSaved={onSaved} />
  </ToastProvider>
}

function renderDrawer(options: Options = {}) {
  const onSaved = vi.fn()
  const view = renderPortal(<Host onSaved={onSaved} />, gateway(options))
  return { ...view, onSaved }
}

/** The portal around the Records page: its toasts outlive the page, which the patient can leave (Back) while the drawer is open. */
function Portal() {
  const [onPage, setOnPage] = useState(true)
  return <ToastProvider>
    <button type="button" onClick={() => setOnPage(false)}>Leave the page</button>
    {onPage && <AddRecordDrawer open onClose={() => setOnPage(false)} />}
  </ToastProvider>
}

/** Chromium moves focus to the page as the focused Save is disabled for the run (jsdom keeps it there): done by hand. */
function loseFocus() {
  document.body.tabIndex = -1
  document.body.focus()
  document.body.removeAttribute('tabindex')
  expect(document.activeElement).toBe(document.body)
}

const dialog = () => screen.getByRole('dialog', { name: 'Add a record' })
const cameraInput = () => dialog().querySelector<HTMLInputElement>('input[type=file][capture]')!
const uploadInput = () => dialog().querySelector<HTMLInputElement>('input[type=file][multiple]')!

async function pick(input: HTMLInputElement, ...files: File[]) {
  await act(async () => { fireEvent.change(input, { target: { files } }) })
}

/** Fills the entry as a patient does: the kind, a name, the place, the date and a note. */
function fill() {
  fireEvent.click(screen.getByRole('radio', { name: 'Test result' }))
  fireEvent.change(screen.getByLabelText('Name it'), { target: { value: '  Malaria test ' } })
  fireEvent.change(screen.getByLabelText(/Where were you treated/), { target: { value: 'Lagos General Hospital' } })
  fireEvent.change(screen.getByLabelText('When'), { target: { value: '2026-10-20' } })
  fireEvent.change(screen.getByLabelText(/Anything else to note/), { target: { value: 'Positive, given ACT' } })
}

const SAVED_BODY = { kind: 'test', title: 'Malaria test', facilityName: 'Lagos General Hospital', occurredOn: '2026-10-20', notes: 'Positive, given ACT' }

const entryRequests = (sent: Sent[]) => sent.filter(request => request.path.startsWith(ENTRIES))
const headerOf = (headers: ReturnType<typeof renderPortal>['headers'], path: string, at = 0) =>
  headers.filter(request => request.path === path && request.method === 'POST')[at]?.headers.get('Idempotency-Key')
const intentPath = `${ENTRIES}/${ENTRY_ID}/documents/upload-intents`

beforeEach(() => { forgetPatientEntriesServed(); log = []; vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:https://portal.test/${Math.random()}`); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {}) })
afterEach(() => { vi.unstubAllGlobals() })

describe('Add a record, before a backend serves it', () => {
  it('saves the entry alone, says it isn’t set up on the 404 NOT_FOUND, and sends no file at all', async () => {
    const { puts } = storage()
    const { sent, headers, onSaved } = renderDrawer({ save: () => problem(404, 'NOT_FOUND', 'Cannot POST /api/v1/ehr/me/patient-entries') })
    fill()
    await pick(cameraInput(), photo())
    await pick(uploadInput(), pdf())
    await press(screen.getByRole('button', { name: 'Save record' }))

    const alert = await screen.findByText('This isn’t set up for your account. Contact support. What you entered is still here.')
    expect(shownText(alert.closest('[role]') as HTMLElement)).toContain('Couldn’t add your record')
    // The Save is the entry alone: no attachments, no file name, no byte of either file.
    expect(entryRequests(sent)).toEqual([{ path: ENTRIES, method: 'POST', body: SAVED_BODY }])
    expect(headerOf(headers, ENTRIES)).toMatch(UUID)
    for (const request of sent) expect(JSON.stringify(request.body ?? null)).not.toMatch(/result-slip|discharge|exact bytes|PDF-1\.7|contentBase64/)
    // No upload link was asked for and nothing went to storage.
    expect(log).toEqual([`POST ${ENTRIES}`])
    expect(puts).toEqual([])
    expect(patientEntriesServed()).toBe(false)
    // What was entered is still there, and nothing was said to be saved.
    expect(screen.getByLabelText('Name it')).toHaveProperty('value', '  Malaria test ')
    expect(screen.getByText('result-slip.jpg')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save record' })).toHaveProperty('disabled', false)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('sends the same Save with the same key when it is pressed again unchanged, and a new key once it changes', async () => {
    const { sent, headers } = renderDrawer({ save: () => problem(404, 'NOT_FOUND', 'Cannot POST') })
    fill()
    await press(screen.getByRole('button', { name: 'Save record' }))
    await screen.findByText(/This isn’t set up for your account/)
    await press(screen.getByRole('button', { name: 'Save record' }))
    await waitFor(() => expect(entryRequests(sent)).toHaveLength(2))
    expect(headerOf(headers, ENTRIES, 1)).toBe(headerOf(headers, ENTRIES, 0))
    fireEvent.change(screen.getByLabelText(/Anything else to note/), { target: { value: 'Negative after treatment' } })
    await press(screen.getByRole('button', { name: 'Save record' }))
    await waitFor(() => expect(entryRequests(sent)).toHaveLength(3))
    expect(headerOf(headers, ENTRIES, 2)).not.toBe(headerOf(headers, ENTRIES, 0))
  })

  it('reads only the Save’s 404 NOT_FOUND as not set up: a 404 with its own code says its own words', async () => {
    renderDrawer({ save: () => problem(404, 'PATIENT_NOT_FOUND', 'Your record could not be found.') })
    fill()
    await press(screen.getByRole('button', { name: 'Save record' }))
    expect(await screen.findByText('Your record could not be found.')).toBeTruthy()
    expect(screen.queryByText(/isn’t set up/)).toBeNull()
    expect(patientEntriesServed()).toBeNull()
  })

  it('does not send a Save over the edge limit of 8000 bytes, and says so plainly', async () => {
    const { sent } = renderDrawer()
    fill()
    // Pasted text whose characters JSON escapes (6 bytes each): within the field's 2000 characters, over 8000 bytes.
    fireEvent.change(screen.getByLabelText(/Anything else to note/), { target: { value: `Copied from the slip ${'\u0002'.repeat(1970)}` } })
    await press(screen.getByRole('button', { name: 'Save record' }))
    expect(await screen.findByText('It’s too long to send. Shorten the notes, then save again. What you entered is still here.')).toBeTruthy()
    expect(entryRequests(sent)).toEqual([])
  })
})

describe('Add a record, once a backend serves it', () => {
  it('saves the entry, then sends each file in turn: its exact bytes hashed, the upload link, the very File, the confirm', async () => {
    const { puts } = storage()
    const { sent, headers, onSaved } = renderDrawer()
    fill()
    const first = photo(), second = pdf()
    await pick(cameraInput(), first)
    await pick(uploadInput(), second)
    await press(screen.getByRole('button', { name: 'Save record' }))

    expect(await screen.findByText('Record added')).toBeTruthy()
    expect(screen.getByText('Malaria test is in your records, marked “added by you”.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(patientEntriesServed()).toBe(true)

    // In this order: the entry, then for each file its link, its PUT and its confirm.
    expect(log).toEqual([
      `POST ${ENTRIES}`,
      `POST ${intentPath}`, '/bucket/clinical/objects/doc-result-slip.jpg', `POST ${ENTRIES}/${ENTRY_ID}/documents/doc-result-slip.jpg/complete`,
      `POST ${intentPath}`, '/bucket/clinical/objects/doc-discharge.pdf', `POST ${ENTRIES}/${ENTRY_ID}/documents/doc-discharge.pdf/complete`,
    ].map(line => line.startsWith('/') ? `PUT ${line}` : line))
    expect(entryRequests(sent)[0]).toEqual({ path: ENTRIES, method: 'POST', body: SAVED_BODY })
    const saveKey = headerOf(headers, ENTRIES)
    expect(saveKey).toMatch(UUID)

    // Each upload link is asked for with the file's name, type, size and the SHA-256 of its exact bytes, and a key of its own.
    const intents = entryRequests(sent).filter(request => request.path === intentPath)
    expect(intents.map(request => request.body)).toEqual([
      { fileName: 'result-slip.jpg', mediaType: 'image/jpeg', sizeBytes: first.size, sha256Hex: sha256(PLAIN_JPEG) },
      { fileName: 'discharge.pdf', mediaType: 'application/pdf', sizeBytes: second.size, sha256Hex: sha256(bytesOf('%PDF-1.7 fictional discharge summary')) },
    ])
    const fileKeys = [headerOf(headers, intentPath, 0), headerOf(headers, intentPath, 1)]
    for (const key of fileKeys) expect(key).toMatch(UUID)
    expect(new Set([saveKey, ...fileKeys]).size).toBe(3)

    // The PUT carries the photo as walked, a new File of its name and type (this one had no metadata to take out, so
    // every byte of it), and the PDF's very File, with the signed headers and no cookies; the confirm has no body.
    const sentPhoto = puts[0]?.body as File
    expect([sentPhoto.name, sentPhoto.type]).toEqual(['result-slip.jpg', 'image/jpeg'])
    expect([...new Uint8Array(await sentPhoto.arrayBuffer())]).toEqual([...PLAIN_JPEG])
    expect(puts[1]?.body).toBe(second)
    expect(puts[0]?.headers.get('content-type')).toBe('image/jpeg')
    expect(puts[0]?.headers.get('x-amz-meta-declared-sha256')).toBe('from-the-intent')
    expect(puts.every(put => put.credentials === 'omit')).toBe(true)
    for (const request of entryRequests(sent).filter(request => request.path.endsWith('/complete'))) expect(request.body).toBeNull()
  })

  it('saves an entry with no photos with the Save alone', async () => {
    const { puts } = storage()
    const { onSaved } = renderDrawer()
    fill()
    await press(screen.getByRole('button', { name: 'Save record' }))
    expect(await screen.findByText('Record added')).toBeTruthy()
    expect(log).toEqual([`POST ${ENTRIES}`])
    expect(puts).toEqual([])
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('keeps the drawer open when a file fails after the entry is saved, and Try again sends only that file under the same entry and key', async () => {
    let failing = true
    const { puts } = storage(put => put === 2 && failing ? new Response(null, { status: 500 }) : new Response(null, { status: 200 }))
    const { sent, headers, onSaved } = renderDrawer()
    fill()
    await pick(cameraInput(), photo())
    await pick(uploadInput(), pdf())
    await press(screen.getByRole('button', { name: 'Save record' }))

    const alert = (await screen.findByText(/Your record was saved\./)).closest('[role]') as HTMLElement
    expect(shownText(alert)).toContain('Your record was saved. 1 of your photos or files didn’t upload.')
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(within(dialog()).getByText(/discharge\.pdf/).parentElement?.textContent).toContain('Didn’t upload')
    expect(within(dialog()).getByText(/result-slip\.jpg/).parentElement?.textContent).toContain('Uploaded')
    // The saved fields are kept from changing, and no photo can be added or removed under the saved entry.
    expect(screen.getByLabelText('Name it')).toHaveProperty('readOnly', true)
    expect(screen.getByLabelText('Name it')).toHaveProperty('value', 'Malaria test')
    expect(screen.getByLabelText(/Anything else to note/)).toHaveProperty('readOnly', true)
    expect(screen.getByLabelText('When')).toHaveProperty('readOnly', true)
    expect(screen.getByRole('radio', { name: 'Visit' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: /Take a photo/ })).toHaveProperty('disabled', true)
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull()
    expect(onSaved).not.toHaveBeenCalled()

    failing = false
    await press(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Record added')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onSaved).toHaveBeenCalledTimes(1)

    // One Save only; the failed file's link asked for again under the same entry with the same key; the good one not again.
    expect(entryRequests(sent).filter(request => request.path === ENTRIES)).toHaveLength(1)
    const intents = entryRequests(sent).filter(request => request.path === intentPath).map(request => (request.body as { fileName: string }).fileName)
    expect(intents).toEqual(['result-slip.jpg', 'discharge.pdf', 'discharge.pdf'])
    expect(headerOf(headers, intentPath, 2)).toBe(headerOf(headers, intentPath, 1))
    expect(headerOf(headers, intentPath, 1)).not.toBe(headerOf(headers, intentPath, 0))
    expect(puts).toHaveLength(3)
    expect(log.filter(line => line.endsWith('/complete'))).toEqual([
      `POST ${ENTRIES}/${ENTRY_ID}/documents/doc-result-slip.jpg/complete`, `POST ${ENTRIES}/${ENTRY_ID}/documents/doc-discharge.pdf/complete`,
    ])
  })

  it('counts a file as uploaded when Try again’s replayed link says its earlier try was confirmed: no PUT, no confirm', async () => {
    const { puts } = storage()
    let links = 0
    const { sent, headers, onSaved } = renderDrawer({
      // Each confirm reaches the server, which confirms it, but its answer is lost on the way back.
      complete: () => problem(503, 'EHR_UNAVAILABLE', 'The service is unavailable.'),
      // The link asked for again with the same key, once its file is confirmed (BACKEND-NEEDS.md §1).
      intent: file => ++links <= 2 ? undefined : json({ type: 'about:blank', title: 'PATIENT_DOCUMENT_ALREADY_UPLOADED', status: 409,
        code: 'PATIENT_DOCUMENT_ALREADY_UPLOADED', detail: 'This file is already uploaded.',
        document: { id: `doc-${file.fileName}`, status: 'uploaded', scanStatus: 'pending' } }, 409),
    })
    fill()
    await pick(cameraInput(), photo())
    await pick(uploadInput(), pdf())
    await press(screen.getByRole('button', { name: 'Save record' }))
    const alert = (await screen.findByText(/Your record was saved\./)).closest('[role]') as HTMLElement
    expect(shownText(alert)).toContain('2 of your photos or files didn’t upload.')
    expect(onSaved).not.toHaveBeenCalled()

    await press(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Record added')).toBeTruthy()
    expect(screen.getByText('Malaria test is in your records, marked “added by you”.')).toBeTruthy()
    expect(screen.queryByText(/didn’t upload/)).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onSaved).toHaveBeenCalledTimes(1)

    // Try again asked each link again with that file's own key, and sent nothing after its 409: no PUT, no confirm.
    expect(log).toEqual([
      `POST ${ENTRIES}`,
      `POST ${intentPath}`, 'PUT /bucket/clinical/objects/doc-result-slip.jpg', `POST ${ENTRIES}/${ENTRY_ID}/documents/doc-result-slip.jpg/complete`,
      `POST ${intentPath}`, 'PUT /bucket/clinical/objects/doc-discharge.pdf', `POST ${ENTRIES}/${ENTRY_ID}/documents/doc-discharge.pdf/complete`,
      `POST ${intentPath}`, `POST ${intentPath}`,
    ])
    expect(puts).toHaveLength(2)
    expect(headerOf(headers, intentPath, 2)).toBe(headerOf(headers, intentPath, 0))
    expect(headerOf(headers, intentPath, 3)).toBe(headerOf(headers, intentPath, 1))
    expect(entryRequests(sent).filter(request => request.path === ENTRIES)).toHaveLength(1)
  })

  it('says Waiting, not “Didn’t upload”, for a file still to go up again during Try again', async () => {
    // First run: the first photo goes up, the other two don't. Try again: the second is held on its way.
    const { puts, held } = storage(put => put === 2 || put === 3 ? new Response(null, { status: 500 }) : put === 4 ? 'hold' : new Response(null, { status: 200 }))
    renderDrawer()
    fill()
    await pick(uploadInput(), photo('first.jpg'), photo('second.jpg'), pdf())
    await press(screen.getByRole('button', { name: 'Save record' }))
    await screen.findByText(/Your record was saved\./)
    const row = (name: string) => within(dialog()).getByText(name).parentElement?.textContent ?? ''
    expect([row('first.jpg'), row('second.jpg'), row('discharge.pdf')].map(text => text.split(' · ').at(-1)))
      .toEqual(['Uploaded', 'Didn’t upload', 'Didn’t upload'])

    await press(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(puts).toHaveLength(4))
    expect([row('first.jpg'), row('second.jpg'), row('discharge.pdf')].map(text => text.split(' · ').at(-1)))
      .toEqual(['Uploaded', 'Uploading…', 'Waiting'])
    expect(within(dialog()).queryByText(/Didn’t upload/)).toBeNull()
    expect(screen.queryByText(/Your record was saved\./)).toBeNull()

    await act(async () => { held[0]!(new Response(null, { status: 200 })) })
    expect(await screen.findByText('Record added')).toBeTruthy()
    expect(puts).toHaveLength(5)
  })

  it('counts a refused upload link as a file that didn’t upload, never as “not set up”', async () => {
    storage()
    renderDrawer({ intent: () => problem(404, 'NOT_FOUND', 'Cannot POST') })
    fill()
    await pick(cameraInput(), photo())
    await press(screen.getByRole('button', { name: 'Save record' }))
    const alert = (await screen.findByText(/Your record was saved\./)).closest('[role]') as HTMLElement
    expect(shownText(alert)).toContain('1 of your photos or files didn’t upload.')
    expect(screen.queryByText(/isn’t set up/)).toBeNull()
    // No PUT without an upload link.
    expect(log).toEqual([`POST ${ENTRIES}`, `POST ${intentPath}`])
  })

  it('closing after a failure says the record was saved, keeps it, and starts afresh', async () => {
    storage(() => new Response(null, { status: 503 }))
    const { onSaved } = renderDrawer()
    fill()
    await pick(cameraInput(), photo())
    await screen.findByText('result-slip.jpg')
    await press(screen.getByRole('button', { name: 'Save record' }))
    await screen.findByText(/Your record was saved\./)
    await press(within(dialog()).getAllByRole('button', { name: 'Close' }).at(-1)!)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByText('Your record was saved')).toBeTruthy()
    expect(screen.getByText('1 of your photos or files didn’t upload.')).toBeTruthy()
    expect(onSaved).toHaveBeenCalledTimes(1)
    await press(screen.getByRole('button', { name: 'Add a record' }))
    expect(screen.getByLabelText('Name it')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Name it')).toHaveProperty('readOnly', false)
    expect(screen.queryByText('result-slip.jpg')).toBeNull()
  })
})

describe('closing or leaving while it saves', () => {
  it('closing mid-upload stops the PUT on its way and sends nothing more, and says the record was saved', async () => {
    const { puts } = storage(() => 'hold')
    const { onSaved } = renderDrawer()
    fill()
    await pick(cameraInput(), photo())
    await pick(uploadInput(), pdf())
    await press(screen.getByRole('button', { name: 'Save record' }))
    await waitFor(() => expect(puts).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'Save record' })).toHaveProperty('disabled', true)

    await press(within(dialog()).getAllByRole('button', { name: 'Close' })[0]!)
    expect(puts[0]?.signal?.aborted).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByText('Your record was saved')).toBeTruthy()
    expect(screen.getByText('2 of your photos or files didn’t upload.')).toBeTruthy()
    expect(onSaved).toHaveBeenCalledTimes(1)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    // Neither the first file's confirm nor the second file's link was ever asked for.
    expect(log).toEqual([`POST ${ENTRIES}`, `POST ${intentPath}`, 'PUT /bucket/clinical/objects/doc-result-slip.jpg'])
  })

  it('closing before the Save is answered stops it, sends no file, and keeps what was entered', async () => {
    const { puts } = storage()
    let answer: (response: Response) => void = () => {}
    const { sent } = renderDrawer({ save: () => new Promise<Response>(resolve => { answer = resolve }) })
    fill()
    await pick(cameraInput(), photo())
    await press(screen.getByRole('button', { name: 'Save record' }))
    await waitFor(() => expect(entryRequests(sent)).toHaveLength(1))
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByText('Saving stopped')).toBeTruthy()
    // A late 201 for the stopped Save sends nothing after it.
    await act(async () => { answer(json({ entry: { id: ENTRY_ID } }, 201)); await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(log).toEqual([`POST ${ENTRIES}`])
    expect(puts).toEqual([])
    await press(screen.getByRole('button', { name: 'Add a record' }))
    expect(screen.getByLabelText('Name it')).toHaveProperty('value', '  Malaria test ')
    expect(screen.getByText('result-slip.jpg')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save record' })).toHaveProperty('disabled', false)
  })

  it('leaving the page mid-upload stops the PUT and sends nothing more', async () => {
    const { puts } = storage(() => 'hold')
    const { view } = renderDrawer()
    fill()
    await pick(cameraInput(), photo())
    await press(screen.getByRole('button', { name: 'Save record' }))
    await waitFor(() => expect(puts).toHaveLength(1))
    view.unmount()
    expect(puts[0]?.signal?.aborted).toBe(true)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(log.filter(line => line.endsWith('/complete'))).toEqual([])
  })
})

describe('what stays in the browser, and where focus goes', () => {
  it('keeps each photo only as an object URL in memory, lets each go with its file, and stores nothing', async () => {
    storage()
    const stored = [vi.spyOn(Storage.prototype, 'setItem'), vi.spyOn(window.indexedDB ?? { open: () => null }, 'open')]
    const created = vi.mocked(URL.createObjectURL), revoked = vi.mocked(URL.revokeObjectURL)
    renderDrawer()
    fill()
    await pick(cameraInput(), photo('first.jpg'))
    await pick(uploadInput(), photo('second.jpg'), pdf())
    // A preview for each photo, none for the PDF, and never the bytes themselves.
    expect(created).toHaveBeenCalledTimes(2)
    const [first, second] = created.mock.results.map(result => result.value as string)
    expect([...dialog().querySelectorAll('img')].map(image => image.getAttribute('src'))).toEqual([first, second])
    expect(dialog().innerHTML).not.toMatch(/data:|base64/)
    await press(screen.getByRole('button', { name: 'Remove first.jpg' }))
    expect(revoked.mock.calls.map(([url]) => url)).toEqual([first])
    await press(screen.getByRole('button', { name: 'Save record' }))
    expect(await screen.findByText('Record added')).toBeTruthy()
    expect(revoked.mock.calls.map(([url]) => url)).toContain(second)
    for (const spy of stored) expect(spy).not.toHaveBeenCalled()
  })

  it('lets a preview go when the drawer is closed after a failure, and when the page is left', async () => {
    storage(() => new Response(null, { status: 500 }))
    const revoked = () => vi.mocked(URL.revokeObjectURL).mock.calls.map(([url]) => url)
    const { view } = renderDrawer()
    fill()
    await pick(cameraInput(), photo('kept-until-closed.jpg'))
    const shown = vi.mocked(URL.createObjectURL).mock.results[0]?.value as string
    await press(screen.getByRole('button', { name: 'Save record' }))
    await screen.findByText(/Your record was saved\./)
    expect(revoked()).not.toContain(shown)
    await press(within(dialog()).getAllByRole('button', { name: 'Close' }).at(-1)!)
    expect(revoked()).toContain(shown)

    await press(screen.getByRole('button', { name: 'Add a record' }))
    await pick(cameraInput(), photo('left-with-the-page.jpg'))
    const left = vi.mocked(URL.createObjectURL).mock.results[1]?.value as string
    view.unmount()
    expect(revoked()).toContain(left)
  })

  it('gives focus back to Save when the Save is refused and focus was lost while it saved', async () => {
    renderDrawer({ save: () => { loseFocus(); return problem(404, 'NOT_FOUND', 'Cannot POST /api/v1/ehr/me/patient-entries') } })
    fill()
    await press(screen.getByRole('button', { name: 'Save record' }))
    await screen.findByText(/This isn’t set up for your account/)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save record' })))
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })

  it('gives focus back to Try again when a file didn’t upload and focus was lost while it saved', async () => {
    // Focus is lost before the PUT answers.
    storage(() => { loseFocus(); return new Response(null, { status: 500 }) })
    renderDrawer()
    fill()
    await pick(cameraInput(), photo())
    await press(screen.getByRole('button', { name: 'Save record' }))
    await screen.findByText(/Your record was saved\./)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' })))
  })

  it('says the record was saved, and what didn’t upload, when the page is left mid-upload', async () => {
    const { puts } = storage(() => 'hold')
    renderPortal(<Portal />, gateway())
    fill()
    await pick(cameraInput(), photo())
    await pick(uploadInput(), pdf())
    await press(screen.getByRole('button', { name: 'Save record' }))
    await waitFor(() => expect(puts).toHaveLength(1))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Leave the page', hidden: true })) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(puts[0]?.signal?.aborted).toBe(true)
    expect(await screen.findByText('Your record was saved')).toBeTruthy()
    expect(screen.getByText('2 of your photos or files didn’t upload.')).toBeTruthy()
  })

  it('says nothing when the page is left before the Save is answered', async () => {
    renderPortal(<Portal />, gateway({ save: () => new Promise<Response>(() => {}) }))
    fill()
    await pick(cameraInput(), photo())
    await press(screen.getByRole('button', { name: 'Save record' }))
    await waitFor(() => expect(log).toEqual([`POST ${ENTRIES}`]))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Leave the page', hidden: true })) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(/Your record was saved|Saving stopped|Record added/)).toBeNull()
  })
})

describe('what the drawer takes', () => {
  it('offers only JPEG and PNG photos and PDFs, and refuses anything else in plain words', async () => {
    renderDrawer()
    expect(cameraInput().getAttribute('accept')).toBe('image/jpeg,image/png')
    expect(uploadInput().getAttribute('accept')).toBe('image/jpeg,image/png,application/pdf')
    // The drawer's own limits (it imports only types from api.ts) are the ones the upload enforces again.
    expect(uploadInput().getAttribute('accept')).toBe(PATIENT_ENTRY_MEDIA_TYPES.join(','))
    expect([PATIENT_ENTRY_MAX_FILES, PATIENT_ENTRY_MAX_FILE_BYTES]).toEqual([5, 10 * 1024 * 1024])
    for (const [name, type] of [['IMG_0001.heic', 'image/heic'], ['scan.webp', 'image/webp'], ['funny.gif', 'image/gif'], ['scan.tiff', 'image/tiff'], ['notes.docx', '']]) {
      await pick(uploadInput(), new File([bytesOf('x')], name!, { type }))
      expect(screen.getByRole('alert').textContent).toBe(`${name} can’t be added. Choose a photo (JPEG or PNG) or a PDF.`)
      expect(screen.queryByText(name!, { selector: 'span' })).toBeNull()
    }
    await pick(uploadInput(), new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'huge.pdf', { type: 'application/pdf' }))
    expect(screen.getByRole('alert').textContent).toBe('huge.pdf is over 10 MB.')
    await pick(uploadInput(), new File([], 'empty.png', { type: 'image/png' }))
    expect(screen.getByRole('alert').textContent).toBe('empty.png is empty.')
    await pick(uploadInput(), new File([new Uint8Array(10 * 1024 * 1024)], 'just-fits.pdf', { type: 'application/pdf' }))
    expect(screen.getByText('just-fits.pdf')).toBeTruthy()
  })

  it('takes up to 5', async () => {
    renderDrawer()
    await pick(uploadInput(), ...[1, 2, 3, 4, 5, 6].map(n => photo(`page-${n}.jpg`)))
    expect(screen.getByRole('alert').textContent).toBe('You can add up to 5 photos or files.')
    expect(screen.getByText('page-5.jpg')).toBeTruthy()
    expect(screen.queryByText('page-6.jpg')).toBeNull()
    expect(screen.getByRole('button', { name: /Take a photo/ })).toHaveProperty('disabled', true)
  })
})

describe('a photo’s metadata, taken out before it leaves the device (NDPA data minimisation)', () => {
  const blobBytes = async (blob: unknown) => new Uint8Array(await (blob as Blob).arrayBuffer())

  it('sends a GPS-tagged photo without its metadata: its preview, PUT, SHA-256 and size are of the stripped bytes; a PDF goes as it is', async () => {
    const { puts } = storage()
    const { sent, onSaved } = renderDrawer()
    fill()
    const jpeg = gpsTaggedJpeg(), png = metadataPng()
    const taken = new File([jpeg.file], 'IMG_20261020_093012.jpg', { type: 'image/jpeg', lastModified: 3 })
    const scanned = new File([png.file], 'scan.png', { type: 'image/png', lastModified: 4 })
    const document = pdf()
    await pick(cameraInput(), taken)
    await pick(uploadInput(), scanned, document)
    expect(screen.queryByRole('alert')).toBeNull()

    // What is previewed is what will be sent: the stripped bytes, never the picked file.
    const previewed = vi.mocked(URL.createObjectURL).mock.calls.map(([blob]) => blob)
    expect(previewed).toHaveLength(2)
    expect(previewed).not.toContain(taken)
    expect([...await blobBytes(previewed[0])]).toEqual([...jpeg.stripped])
    expect([...await blobBytes(previewed[1])]).toEqual([...png.stripped])

    await press(screen.getByRole('button', { name: 'Save record' }))
    expect(await screen.findByText('Record added')).toBeTruthy()
    expect(onSaved).toHaveBeenCalledTimes(1)

    // The upload links are asked for with the stripped bytes' size and SHA-256.
    expect(jpeg.stripped.length).toBeLessThan(jpeg.file.length)
    expect(entryRequests(sent).filter(request => request.path === intentPath).map(request => request.body)).toEqual([
      { fileName: 'IMG_20261020_093012.jpg', mediaType: 'image/jpeg', sizeBytes: jpeg.stripped.length, sha256Hex: sha256(jpeg.stripped) },
      { fileName: 'scan.png', mediaType: 'image/png', sizeBytes: png.stripped.length, sha256Hex: sha256(png.stripped) },
      { fileName: 'discharge.pdf', mediaType: 'application/pdf', sizeBytes: document.size, sha256Hex: sha256(bytesOf('%PDF-1.7 fictional discharge summary')) },
    ])
    // Each photo's PUT is a new File of its name and type with exactly those bytes; the PDF's is the very File.
    expect(puts).toHaveLength(3)
    const [jpegPut, pngPut] = [puts[0]?.body as File, puts[1]?.body as File]
    expect([jpegPut.name, jpegPut.type, pngPut.name, pngPut.type]).toEqual(['IMG_20261020_093012.jpg', 'image/jpeg', 'scan.png', 'image/png'])
    expect(jpegPut).not.toBe(taken)
    expect([...await blobBytes(jpegPut)]).toEqual([...jpeg.stripped])
    expect([...await blobBytes(pngPut)]).toEqual([...png.stripped])
    expect(puts[2]?.body).toBe(document)

    // Nothing of where it was taken, the phone, the comments or the picture appended after it reached the wire.
    const wire = [...await Promise.all(puts.map(put => blobBytes(put.body))), ...sent.map(request => bytesOf(JSON.stringify(request.body ?? null)))]
    for (const sentBytes of wire) for (const needle of NEVER_LEFT) expect(contains(sentBytes, needle), String(needle)).toBe(false)
  })

  it('refuses a photo that can’t be prepared safely, in plain words, and never sends it', async () => {
    const { puts } = storage()
    const { sent } = renderDrawer()
    fill()
    const { file } = gpsTaggedJpeg()
    const refused: Array<[string, File]> = [
      // Cut short inside its EXIF: its metadata can't be walked past, so it can't be taken out with certainty.
      ['cut-short.jpg', new File([file.subarray(0, 60)], 'cut-short.jpg', { type: 'image/jpeg' })],
      // Bytes that are not the type the file says.
      ['renamed.jpg', new File([metadataPng().file], 'renamed.jpg', { type: 'image/jpeg' })],
      // A photo under a PDF's name would go up with its metadata.
      ['photo.pdf', new File([file], 'photo.pdf', { type: 'application/pdf' })],
    ]
    for (const [name, refusedFile] of refused) {
      await pick(uploadInput(), refusedFile)
      expect(screen.getByRole('alert').textContent).toBe(`${name} couldn’t be prepared safely. Try another photo.`)
      expect(screen.queryByText(name, { selector: 'span' })).toBeNull()
    }
    // Picked with a good one, only the good one is taken.
    await pick(uploadInput(), photo('good.jpg'), refused[0]![1])
    expect(screen.getByRole('alert').textContent).toBe('cut-short.jpg couldn’t be prepared safely. Try another photo.')
    expect(screen.getByText('good.jpg')).toBeTruthy()
    expect(vi.mocked(URL.createObjectURL)).toHaveBeenCalledTimes(1)
    // Picking sent nothing at all.
    expect(log).toEqual([])
    expect(puts).toEqual([])

    await press(screen.getByRole('button', { name: 'Save record' }))
    expect(await screen.findByText('Record added')).toBeTruthy()
    expect(entryRequests(sent).filter(request => request.path === intentPath).map(request => (request.body as { fileName: string }).fileName)).toEqual(['good.jpg'])
    expect(puts).toHaveLength(1)
    for (const request of sent) expect(JSON.stringify(request.body ?? null)).not.toMatch(/cut-short|renamed|photo\.pdf/)
  })

  it('waits for a photo being prepared: it isn’t listed, and nothing can be picked or saved, until it is ready', async () => {
    const { puts } = storage()
    const { sent, view } = renderDrawer()
    fill()
    let ready: (buffer: ArrayBuffer) => void = () => {}
    const slow = photo('slow.jpg')
    Object.defineProperty(slow, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>(resolve => { ready = resolve }) })
    await pick(cameraInput(), slow)
    expect(dialog().querySelector('#own-record-photos')?.getAttribute('aria-busy')).toBe('true')
    expect(screen.queryByText('slow.jpg')).toBeNull()
    expect(screen.getByRole('button', { name: 'Save record' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: /Take a photo/ })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: /Upload a file/ })).toHaveProperty('disabled', true)
    // The form sent (Enter in a field) saves nothing meanwhile.
    await act(async () => { fireEvent.submit(dialog().querySelector('form')!) })
    expect(entryRequests(sent)).toEqual([])

    await act(async () => { ready(PLAIN_JPEG.slice().buffer) })
    await waitFor(() => expect(screen.getByText('slow.jpg')).toBeTruthy())
    expect(dialog().querySelector('#own-record-photos')?.hasAttribute('aria-busy')).toBe(false)
    expect(screen.getByRole('button', { name: 'Save record' })).toHaveProperty('disabled', false)

    // A page left while a photo is prepared keeps nothing of it, and makes no preview.
    const created = vi.mocked(URL.createObjectURL).mock.calls.length
    const another = photo('left-behind.jpg')
    Object.defineProperty(another, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>(resolve => { ready = resolve }) })
    await pick(uploadInput(), another)
    view.unmount()
    await act(async () => { ready(PLAIN_JPEG.slice().buffer) })
    expect(vi.mocked(URL.createObjectURL).mock.calls.length).toBe(created)
    expect(puts).toEqual([])
  })
})

describe('the day’s limit of 10 files, which the backend enforces', () => {
  const dailyLimit = () => problem(429, PATIENT_UPLOAD_DAILY_LIMIT_CODE, 'You have reached today’s upload limit.')
  const row = (name: string) => within(dialog()).getByText(name).parentElement?.textContent ?? ''

  it('says so plainly when an upload link answers 429 PATIENT_UPLOAD_DAILY_LIMIT_REACHED, offers no Try again, and closing keeps the record', async () => {
    expect([PATIENT_UPLOAD_DAILY_LIMIT_FILES, PATIENT_UPLOAD_DAILY_LIMIT_CODE]).toEqual([10, 'PATIENT_UPLOAD_DAILY_LIMIT_REACHED'])
    const { puts } = storage()
    const { sent, onSaved } = renderDrawer({ intent: file => { if (file.fileName === 'discharge.pdf') { loseFocus(); return dailyLimit() } return undefined } })
    fill()
    await pick(cameraInput(), photo())
    await pick(uploadInput(), pdf())
    await press(screen.getByRole('button', { name: 'Save record' }))

    const alert = (await screen.findByText(/Your record was saved\./)).closest('[role]') as HTMLElement
    expect(shownText(alert)).toContain('Your record was saved. 1 of your photos or files didn’t upload. You’ve added 10 files today. '
      + 'You can add more tomorrow. Close to keep your record without them.')
    expect(shownText(alert)).not.toMatch(/Try again/)
    expect(row('discharge.pdf').split(' · ').at(-1)).toBe('Over today’s limit')
    expect(row('result-slip.jpg').split(' · ').at(-1)).toBe('Uploaded')
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    // Focus, lost while it ran, comes back to Close: there is nothing to try again.
    const closeButton = within(dialog()).getAllByRole('button', { name: 'Close' }).at(-1)!
    await waitFor(() => expect(document.activeElement).toBe(closeButton))
    // Nothing more for the refused file: no PUT, no confirm, and the form sent again sends nothing.
    const sentSoFar = [`POST ${ENTRIES}`, `POST ${intentPath}`, 'PUT /bucket/clinical/objects/doc-result-slip.jpg',
      `POST ${ENTRIES}/${ENTRY_ID}/documents/doc-result-slip.jpg/complete`, `POST ${intentPath}`]
    expect(log).toEqual(sentSoFar)
    await act(async () => { fireEvent.submit(dialog().querySelector('form')!) })
    expect(log).toEqual(sentSoFar)
    expect(puts).toHaveLength(1)
    expect(onSaved).not.toHaveBeenCalled()

    // Closing keeps the record, and says why the file isn't in it.
    await press(closeButton)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByText('Your record was saved')).toBeTruthy()
    expect(screen.getByText('1 of your photos or files didn’t upload. You’ve added 10 files today. You can add more tomorrow.')).toBeTruthy()
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(entryRequests(sent).some(request => request.path.endsWith('/withdraw'))).toBe(false)
  })

  it('offers Try again only for a file that failed otherwise, never for one the limit refused', async () => {
    let failing = true
    const { puts } = storage(() => failing ? new Response(null, { status: 500 }) : new Response(null, { status: 200 }))
    const { sent, onSaved } = renderDrawer({ intent: file => file.fileName === 'discharge.pdf' ? dailyLimit() : undefined })
    fill()
    await pick(cameraInput(), photo())
    await pick(uploadInput(), pdf())
    await press(screen.getByRole('button', { name: 'Save record' }))
    const alert = (await screen.findByText(/Your record was saved\./)).closest('[role]') as HTMLElement
    expect(shownText(alert)).toContain('Your record was saved. 2 of your photos or files didn’t upload. You’ve added 10 files today. '
      + 'You can add more tomorrow. Try again, or close to keep your record without them.')
    expect([row('result-slip.jpg'), row('discharge.pdf')].map(text => text.split(' · ').at(-1))).toEqual(['Didn’t upload', 'Over today’s limit'])

    failing = false
    await press(screen.getByRole('button', { name: 'Try again' }))
    // Only the photo was sent again; the record isn't complete without the PDF, so the drawer stays, with no Try again.
    const again = (await screen.findByText(/Your record was saved\./)).closest('[role]') as HTMLElement
    expect(shownText(again)).toContain('1 of your photos or files didn’t upload. You’ve added 10 files today. You can add more tomorrow. Close to keep')
    expect([row('result-slip.jpg'), row('discharge.pdf')].map(text => text.split(' · ').at(-1))).toEqual(['Uploaded', 'Over today’s limit'])
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.queryByText('Record added')).toBeNull()
    expect(entryRequests(sent).filter(request => request.path === intentPath).map(request => (request.body as { fileName: string }).fileName))
      .toEqual(['result-slip.jpg', 'discharge.pdf', 'result-slip.jpg'])
    expect(puts).toHaveLength(2)
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('takes any other 429 (a rate limit on the way) as a file that didn’t upload, with Try again', async () => {
    storage()
    renderDrawer({ intent: () => problem(429, 'RATE_LIMITED', 'Too many requests.') })
    fill()
    await pick(cameraInput(), photo())
    await press(screen.getByRole('button', { name: 'Save record' }))
    const alert = (await screen.findByText(/Your record was saved\./)).closest('[role]') as HTMLElement
    expect(shownText(alert)).toContain('Your record was saved. 1 of your photos or files didn’t upload. Try again, or close to keep your record without them.')
    expect(shownText(alert)).not.toMatch(/today/)
    expect(row('result-slip.jpg').split(' · ').at(-1)).toBe('Didn’t upload')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})
