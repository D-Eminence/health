import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import type { DocumentRecord, LabWorkItem } from '../../../../staff/api'
import { documentTypesServed, forgetDocumentTypesServed, learnDocumentTypesServed } from '../../../../documentTypes'
import type * as DocumentTypesModule from '../../../../documentTypes'
import { forgetReceiving } from '../../../../staff/orderRoutes'
import { forgetCannotCompleteServed } from '../../../../cannotCompleteServed'
import { forgetLateCorrectionServed } from '../../../../lateCorrectionServed'
import { forgetWrongPatientServed } from '../../../../wrongPatientServed'
import { Laboratory } from '../../../../ehr-blue/departments/laboratory/Laboratory'
import { WorkItemDocuments } from '../../../../ehr-blue/departments/parts/WorkItemDocuments'
import { DEMO_LABORATORY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'

/**
 * "Result documents" on the blue Laboratory request (the owner's rule of 31 Oct, documentTypes.ts), as the redesign lays
 * a request out (laboratory/work/:id: the stage card, then the Request card, then this one): a lab result attached to
 * the Lab work item, dormant until the Lab work list answers `documentTypes: true`, only on a host that may upload a
 * lab result (not pharmacy., outreach. or the admin site), and only for a member holding lab.document.read (the list)
 * or lab.document.write (the form). The host is the one seam mocked (documentTypesHere); the host table is the real one.
 * The point-of-care API answers "not switched on" throughout (harness commerceMock), so nothing waits for payment.
 * Fictional data only: Patient One, HID-ZDEMAAA2, Demo Laboratory.
 */
const api = vi.hoisted(() => ({
  labWorkItems: vi.fn(), createLabAccession: vi.fn(), transitionSpecimen: vi.fn(), labAccession: vi.fn(), labExecutions: vi.fn(),
  workItemDocuments: vi.fn(), uploadWorkItemDocument: vi.fn(), documentDownload: vi.fn(),
}))
const routes = vi.hoisted(() => ({ incoming: vi.fn() }))
const commerceApi = vi.hoisted(() => ({} as Record<string, (...args: never[]) => unknown>))
// Every staff API member the page reaches for that this test does not provide.
const unprovided = vi.hoisted(() => new Set<string>())
const session = vi.hoisted(() => ({ facility: undefined as FakeFacility | undefined }))
const host = vi.hoisted(() => ({ name: 'lab.healthidentitydirectory.com' }))

vi.mock('../../../../documentTypes', async importOriginal => {
  const actual = await importOriginal<typeof DocumentTypesModule>()
  return { ...actual, documentTypesHere: () => actual.documentTypesOn(host.name) }
})
vi.mock('../../../../ehr-blue/departments/commerce/api', async importOriginal => {
  const { commerceMock } = await import('../harness')
  return { ...(await importOriginal<object>()), commerce: commerceMock(commerceApi) }
})
vi.mock('../../../../staff/App', async () => {
  const { staffContext } = await import('../harness')
  return { useStaff: () => staffContext(session.facility) }
})
vi.mock('../../../../staff/api', () => {
  const watched = <T extends object>(target: T) => new Proxy(target, {
    get(object, property) {
      if (typeof property === 'string' && !(property in object)) unprovided.add(property)
      return Reflect.get(object, property)
    },
  })
  return { staffApi: watched(api), orderRoutesApi: watched(routes) }
})
vi.mock('../../../../staff/session', () => ({ staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ name: 'test', apiBaseUrl: 'https://gateway.example.test' }) }))

const PATIENT = 'a0000000-0000-4000-8000-0000004f9c2e'
const MASKED = 'Patient ••••4f9c2e'
const WORK = ['lab.work-item.read']
const READ = 'lab.document.read'
const WRITE = 'lab.document.write'
const DOCUMENTS = [...WORK, READ, WRITE]
const HINT = 'PDF, JPEG, PNG or TIFF, up to 50 MiB. Images are kept exactly as uploaded, and Health ID reads a lab result by '
  + 'itself once its virus scan is clean.'
const ATTACHED = 'Result document attached. It can be opened once its virus scan is clean.'
const NOT_HERE = 'Lab results can be uploaded only in the EHR, Lab or Migrate.'

const workItem = (overrides: Partial<LabWorkItem> = {}): LabWorkItem => ({
  id: 'work-item-1', patientId: PATIENT, version: 1, status: 'accepted', testName: 'Haemoglobin',
  accessionId: null, accessionNumber: null, acceptedAt: '2026-10-09T08:00:00.000Z', ...overrides,
})
const document = (overrides: Partial<DocumentRecord> = {}): DocumentRecord => ({
  id: 'd0000000-0000-4000-8000-000000000001', patientId: PATIENT, encounterId: null, labWorkItemId: 'work-item-1',
  fileName: 'full-blood-count.jpg', mediaType: 'image/jpeg', sizeBytes: '20480', status: 'available', scanStatus: 'clean',
  createdAt: '2026-10-09T09:30:00.000Z', documentType: 'lab_result', ...overrides,
})
const pending = document({ id: 'd0000000-0000-4000-8000-000000000002', fileName: 'haemoglobin-report.pdf', mediaType: 'application/pdf',
  sizeBytes: 102400, scanStatus: 'pending' })
const served = (items: LabWorkItem[] = [workItem()]) => ({ items, documentTypes: true })
const page = (items: DocumentRecord[]) => ({ items, nextCursor: null, documentTypes: true })
const jpeg = () => new File([new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0xFF, 0xD9])], 'demo-lab-result.jpg', { type: 'image/jpeg' })

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason: unknown) => void = () => undefined
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function as(permissions: string[]) {
  session.facility = fakeFacility(permissions)
}

/** The work list's address in the frame; a request opens below it. */
const WORK_LIST = '/provider/laboratory/work'

function renderPage() {
  return renderDept(<Laboratory />, { route: WORK_LIST })
}

/** A request's card button on the work list, named by its next action, then who and which tests. */
function findCard(test = 'Haemoglobin') {
  return screen.findByRole('button', { name: new RegExp(`, ${test}$`) })
}

async function openRecord(test = 'Haemoglobin') {
  fireEvent.click(await findCard(test))
  await screen.findByRole('heading', { level: 1, name: test })
}

/** Back to the work list, from the open request. */
function backToList() {
  fireEvent.click(screen.getByRole('link', { name: 'Back to the work list' }))
}

/** A card of the open request, by its heading. */
function cardTitled(name: string) {
  return screen.getByRole('heading', { name }).closest('section') as HTMLElement
}

function card() {
  return cardTitled('Result documents')
}

function fileField() {
  return within(card()).getByLabelText(/^Lab result file/) as HTMLInputElement
}

function choose(file: File | null) {
  fireEvent.change(fileField(), { target: { files: file ? [file] : [] } })
}

function attach() {
  fireEvent.click(within(card()).getByRole('button', { name: 'Attach result document' }))
}

/** Every argument the page passed to any staff API call, as text. */
function everythingSent() {
  return JSON.stringify(Object.values({ ...api, ...routes }).flatMap(mock => mock.mock.calls))
}

beforeEach(() => {
  for (const key of Object.keys(commerceApi)) delete commerceApi[key]
  vi.clearAllMocks()
  unprovided.clear()
  host.name = 'lab.healthidentitydirectory.com'
  as(DOCUMENTS)
  api.labWorkItems.mockResolvedValue(served())
  api.labExecutions.mockResolvedValue({ items: [] })
  api.workItemDocuments.mockResolvedValue(page([document(), pending]))
  api.uploadWorkItemDocument.mockResolvedValue('d0000000-0000-4000-8000-000000000003')
  api.documentDownload.mockResolvedValue({ url: 'https://storage.example.test/signed/full-blood-count.jpg', expiresInSeconds: 60 })
  forgetDocumentTypesServed(); forgetReceiving(); forgetCannotCompleteServed(); forgetLateCorrectionServed(); forgetWrongPatientServed()
})
afterEach(() => {
  // Nothing outside the provided staff API members was reached for.
  expect([...unprovided]).toEqual([])
  // Nothing about the work or its documents reaches the address or the browser's storage.
  expect(window.location.hash).toBe('')
  expect(window.localStorage.length).toBe(0)
  expect(window.sessionStorage.length).toBe(0)
  vi.unstubAllEnvs()
  forgetDocumentTypesServed(); forgetReceiving(); forgetCannotCompleteServed(); forgetLateCorrectionServed(); forgetWrongPatientServed()
})

describe('dormant until the Lab work list says the document types are served', () => {
  it.each([
    ['says nothing of them', {}],
    ['answers documentTypes: false', { documentTypes: false }],
    ['answers documentTypes as text', { documentTypes: 'true' }],
  ])('shows no card, reads no documents and sends no new field when the list %s', async (_said, fields) => {
    api.labWorkItems.mockResolvedValue({ items: [workItem()], ...fields })
    renderPage()
    await openRecord()
    await waitFor(() => expect(documentTypesServed()).toBe(false))
    // The request shows exactly as it does without the document types: its stage, and what is known of it.
    expect(screen.getByRole('heading', { name: 'Request' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Result documents' })).toBeNull()
    expect(screen.queryByLabelText(/^Lab result file/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Attach result document' })).toBeNull()
    expect(api.workItemDocuments).not.toHaveBeenCalled()
    expect(api.uploadWorkItemDocument).not.toHaveBeenCalled()
    expect(api.documentDownload).not.toHaveBeenCalled()
    // The work list is read exactly as today, and nothing the page sent names a type or a work item's documents.
    expect(api.labWorkItems.mock.calls).toEqual([[DEMO_LABORATORY_ID]])
    expect(everythingSent()).not.toMatch(/documentType|labWorkItemId|pharmacyWorkItemId|lab_result/)
  })

  it('learns it is served from the Lab work list itself', async () => {
    renderPage()
    await findCard()
    await waitFor(() => expect(documentTypesServed()).toBe(true))
    // The list itself shows nothing new; the documents are the open record's.
    expect(screen.queryByRole('heading', { name: 'Result documents' })).toBeNull()
    expect(api.workItemDocuments).not.toHaveBeenCalled()
  })
})

describe('work with no patient on Health ID', () => {
  // A walk-in served without a Health ID has no patient to keep a document on: no card, nothing read.
  it.each(['lab', 'pharmacy'] as const)('shows no %s card and reads nothing, though served', kind => {
    learnDocumentTypesServed(true)
    const permissions = kind === 'lab' ? ['lab.document.read', 'lab.document.write'] : ['pharmacy.document.read', 'pharmacy.document.write']
    const { container } = render(<WorkItemDocuments kind={kind} facilityId={DEMO_LABORATORY_ID} workItemId="walk-in-1" patientId=""
      permissions={permissions} writable />)
    expect(container.innerHTML).toBe('')
    expect(api.workItemDocuments).not.toHaveBeenCalled()
  })
})

describe('served, for a member who reads and attaches lab documents', () => {
  it('lists the work item’s documents, read with the work item’s own patient', async () => {
    renderPage()
    await openRecord()
    const documents = card()
    expect(await within(documents).findByText('full-blood-count.jpg')).toBeTruthy()
    expect(api.workItemDocuments).toHaveBeenCalledTimes(1)
    expect(api.workItemDocuments).toHaveBeenCalledWith(DEMO_LABORATORY_ID, PATIENT, { kind: 'lab', id: 'work-item-1' })
    const [clean, scanning] = within(documents).getAllByRole('listitem')
    expect(within(clean!).getByText('Lab result')).toBeTruthy()
    expect(within(clean!).getByText('image/jpeg · 20 KiB · scan: clean')).toBeTruthy()
    expect(within(scanning!).getByText('haemoglobin-report.pdf')).toBeTruthy()
    expect(within(scanning!).getByText('application/pdf · 100 KiB · scan: pending')).toBeTruthy()
    // "Open file" only once the virus scan is clean.
    expect(within(clean!).getByRole('button', { name: 'Open file' })).toBeTruthy()
    expect(within(scanning!).queryByRole('button', { name: 'Open file' })).toBeNull()
  })

  it('is a supporting card of the request: after the stage card and the Request card, with its own h2', async () => {
    renderPage()
    await openRecord()
    const documents = card()
    expect(screen.getByRole('heading', { level: 2, name: 'Result documents' })).toBeTruthy()
    const stage = window.document.getElementById('lab-stage-title')!.closest('section') as HTMLElement
    for (const before of [stage, cardTitled('Request')]) {
      expect(before.compareDocumentPosition(documents) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('comes before Also on this request, where a walk-in request asked for other tests too', async () => {
    const request = { request: { id: 'request-1', number: 'LR-0001' } } as Partial<LabWorkItem>
    api.labWorkItems.mockResolvedValue(served([workItem(request), workItem({ ...request, id: 'work-item-2', testName: 'Serum ferritin' })]))
    renderPage()
    // One card for the request, named by both tests; it opens the first.
    fireEvent.click(await findCard('Haemoglobin, Serum ferritin'))
    await screen.findByRole('heading', { level: 1, name: 'Haemoglobin' })
    expect(await within(card()).findByText('full-blood-count.jpg')).toBeTruthy()
    expect(card().compareDocumentPosition(cardTitled('Also on this request')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Its documents are this work item's, never the other test's.
    expect(api.workItemDocuments.mock.calls).toEqual([[DEMO_LABORATORY_ID, PATIENT, { kind: 'lab', id: 'work-item-1' }]])
  })

  it('says when there are none yet, and when they could not be read', async () => {
    api.workItemDocuments.mockResolvedValueOnce(page([]))
    renderPage()
    await openRecord()
    expect(await within(card()).findByText('No result documents yet.')).toBeTruthy()
    backToList()
    api.workItemDocuments.mockRejectedValueOnce(new HidApiError(403, 'Lab document access is not authorized', { code: 'FORBIDDEN' }))
    await openRecord()
    expect((await within(card()).findByRole('alert')).textContent).toBe('Lab document access is not authorized')
  })

  it('reads them once for each request opened, not again when a step reads the work list again under it', async () => {
    as([...DOCUMENTS, 'lab.accession.create', 'lab.accession.read', 'lab.specimen.collect'])
    const specimen = { id: 'specimen-1', accessionId: 'accession-1', specimenIdentifier: 'SPC-000123', specimenType: 'Venous blood', version: 2 }
    const made = { id: 'accession-1', accessionNumber: 'ACC-2026-000123', workItemId: 'work-item-1', status: 'open',
      specimens: [{ ...specimen, status: 'required' }] }
    api.createLabAccession.mockResolvedValue(made)
    api.transitionSpecimen.mockResolvedValue({ ...specimen, status: 'collected', version: 3 })
    api.labAccession.mockResolvedValue({ ...made, specimens: [{ ...specimen, status: 'collected', version: 3 }] })
    renderPage()
    await openRecord()
    await within(card()).findByText('full-blood-count.jpg')
    // Collecting its sample reads the work list again and renders the request with the work as now listed.
    api.labWorkItems.mockResolvedValue(served([workItem({ accessionId: 'accession-1', accessionNumber: 'ACC-2026-000123',
      specimenStatuses: ['collected'] })]))
    fireEvent.change(screen.getByRole('textbox', { name: 'Sample' }), { target: { value: 'Venous blood' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Why the test' }), { target: { value: 'Routine check' } })
    const collect = screen.getByRole('button', { name: 'Collect sample' })
    collect.focus()
    fireEvent.click(collect)
    const sheet = await screen.findByRole('dialog', { name: 'Collect the sample' })
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Collect sample' })) })
    expect(await screen.findByText('Sample collected. Print the label.')).toBeTruthy()
    await waitFor(() => expect(api.labWorkItems).toHaveBeenCalledTimes(2))
    await act(async () => { await Promise.resolve() })
    expect(window.document.getElementById('lab-stage-title')?.textContent).toBe('Testing')
    expect(api.workItemDocuments).toHaveBeenCalledTimes(1)
    expect(within(card()).getByText('full-blood-count.jpg')).toBeTruthy()
    // Opened again, it is read again.
    backToList()
    await openRecord()
    await waitFor(() => expect(api.workItemDocuments).toHaveBeenCalledTimes(2))
  })

  it('leaves out a document the answer gives for another patient or another work item', async () => {
    api.workItemDocuments.mockResolvedValue(page([document(),
      document({ id: 'd-other-patient', fileName: 'someone-else.pdf', patientId: 'a0000000-0000-4000-8000-000000aa11bb' }),
      document({ id: 'd-other-work', fileName: 'other-work.pdf', labWorkItemId: 'work-item-9' })]))
    renderPage()
    await openRecord()
    await within(card()).findByText('full-blood-count.jpg')
    expect(within(card()).queryByText('someone-else.pdf')).toBeNull()
    expect(within(card()).queryByText('other-work.pdf')).toBeNull()
  })

  it('names no type it does not know, and offers no Open file on an upload never completed', async () => {
    api.workItemDocuments.mockResolvedValue(page([document({ documentType: 'imaging_report' }),
      document({ id: 'd-initiated', fileName: 'unfinished.png', mediaType: 'image/png', status: 'initiated', scanStatus: 'clean' })]))
    renderPage()
    await openRecord()
    const [unknown, initiated] = await within(card()).findAllByRole('listitem')
    expect(unknown!.textContent).not.toMatch(/Lab result|Clinical document|imaging/i)
    expect(within(initiated!).getByText('image/png · 20 KiB')).toBeTruthy()
    expect(within(initiated!).getByText(/Upload not completed\. Only the person who started it can finish it: attach the file again\./)).toBeTruthy()
    expect(within(initiated!).queryByRole('button', { name: 'Open file' })).toBeNull()
  })

  it('opens a clean document from its signed storage link, in a tab of its own', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderPage()
    await openRecord()
    await within(card()).findByText('full-blood-count.jpg')
    fireEvent.click(within(card()).getByRole('button', { name: 'Open file' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://storage.example.test/signed/full-blood-count.jpg', '_blank', 'noopener,noreferrer'))
    expect(api.documentDownload).toHaveBeenCalledWith(DEMO_LABORATORY_ID, 'd0000000-0000-4000-8000-000000000001')
  })

  it('never opens a link that is not a signed storage link', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    api.documentDownload.mockResolvedValue({ url: 'javascript:alert(1)', expiresInSeconds: 60 })
    renderPage()
    await openRecord()
    await within(card()).findByText('full-blood-count.jpg')
    fireEvent.click(within(card()).getByRole('button', { name: 'Open file' }))
    expect((await within(card()).findByRole('alert')).textContent).toBe('The document could not be opened.')
    expect(open).not.toHaveBeenCalled()
  })

  it('offers the file field with today’s accepted types and the hint', async () => {
    renderPage()
    await openRecord()
    const field = fileField()
    expect(field.type).toBe('file')
    expect(field.accept).toBe('.pdf,.jpg,.jpeg,.png,.tif,.tiff')
    expect(within(card()).getByText(HINT)).toBeTruthy()
    expect(field.getAttribute('aria-describedby')).toContain(within(card()).getByText(HINT).id)
  })

  it('attaches a lab result to the Lab work item, the very File chosen, then reads the documents again', async () => {
    renderPage()
    await openRecord()
    await within(card()).findByText('full-blood-count.jpg')
    const file = jpeg()
    const upload = deferred<string>()
    api.uploadWorkItemDocument.mockReturnValue(upload.promise)
    choose(file)
    attach()
    const button = await within(card()).findByRole('button', { name: 'Attaching…' })
    expect(button.getAttribute('aria-busy')).toBe('true')
    // A second press while it runs sends nothing more.
    fireEvent.click(button)
    expect(api.uploadWorkItemDocument).toHaveBeenCalledTimes(1)
    expect(api.uploadWorkItemDocument).toHaveBeenCalledWith(DEMO_LABORATORY_ID, PATIENT, { kind: 'lab', id: 'work-item-1' }, file, 'lab_result')
    expect(api.uploadWorkItemDocument.mock.calls[0]![3]).toBe(file)
    api.workItemDocuments.mockResolvedValue(page([document(), pending,
      document({ id: 'd0000000-0000-4000-8000-000000000003', fileName: 'demo-lab-result.jpg', sizeBytes: file.size, scanStatus: 'pending' })]))
    await act(async () => { upload.resolve('d0000000-0000-4000-8000-000000000003') })
    expect(await within(card()).findByText(ATTACHED)).toBeTruthy()
    expect(within(card()).getByText(ATTACHED).closest('[role="status"]')).toBeTruthy()
    expect(await within(card()).findByText('demo-lab-result.jpg')).toBeTruthy()
    expect(api.workItemDocuments).toHaveBeenCalledTimes(2)
    expect(api.workItemDocuments).toHaveBeenLastCalledWith(DEMO_LABORATORY_ID, PATIENT, { kind: 'lab', id: 'work-item-1' })
    expect(within(card()).getByRole('button', { name: 'Attach result document' })).toBeTruthy()
    expect(within(card()).queryByRole('alert')).toBeNull()
  })

  it('reads the documents no more once the record was left while its attach ran', async () => {
    renderPage()
    await openRecord()
    await within(card()).findByText('full-blood-count.jpg')
    const upload = deferred<string>()
    api.uploadWorkItemDocument.mockReturnValue(upload.promise)
    choose(jpeg())
    attach()
    await within(card()).findByRole('button', { name: 'Attaching…' })
    backToList()
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Result documents' })).toBeNull())
    await act(async () => { upload.resolve('d0000000-0000-4000-8000-000000000003') })
    await act(async () => { await Promise.resolve() })
    expect(api.uploadWorkItemDocument).toHaveBeenCalledTimes(1)
    // The card is no longer shown, so nothing reads its documents again.
    expect(api.workItemDocuments).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['no file', null, 'Select a file first.'],
    ['an empty file', new File([], 'empty.pdf', { type: 'application/pdf' }), 'Select a file first.'],
    ['a file of another type', new File(['Patient One'], 'notes.txt', { type: 'text/plain' }), 'Use PDF, JPEG, PNG, or TIFF, up to 50 MiB.'],
  ])('refuses %s before sending, with today’s words on the field, and moves focus to it', async (_case, file, message) => {
    renderPage()
    await openRecord()
    choose(file)
    attach()
    await waitFor(() => expect(fileField().getAttribute('aria-invalid')).toBe('true'))
    const described = (fileField().getAttribute('aria-describedby') ?? '').split(' ').map(id => window.document.getElementById(id)?.textContent)
    expect(described).toContain(message)
    await waitFor(() => expect(window.document.activeElement).toBe(fileField()))
    expect(api.uploadWorkItemDocument).not.toHaveBeenCalled()
  })

  it('refuses a file over 50 MiB before sending', async () => {
    renderPage()
    await openRecord()
    const file = jpeg()
    Object.defineProperty(file, 'size', { value: 52_428_801 })
    choose(file)
    attach()
    expect(await within(card()).findByText('Use PDF, JPEG, PNG, or TIFF, up to 50 MiB.')).toBeTruthy()
    expect(api.uploadWorkItemDocument).not.toHaveBeenCalled()
  })

  it('says the backend’s refusal of a lab result on this host in the core’s words (403)', async () => {
    host.name = 'localhost'
    api.uploadWorkItemDocument.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'DOCUMENT_TYPE_NOT_ALLOWED_HERE' }))
    renderPage()
    await openRecord()
    await within(card()).findByText('full-blood-count.jpg')
    choose(jpeg())
    attach()
    expect((await within(card()).findByRole('alert')).textContent).toBe(NOT_HERE)
    expect(within(card()).queryByText(ATTACHED)).toBeNull()
    expect(api.workItemDocuments).toHaveBeenCalledTimes(1)
    expect(within(card()).getByRole('button', { name: 'Attach result document' })).toBeTruthy()
  })

  it('says any other refusal in the backend’s words', async () => {
    api.uploadWorkItemDocument.mockRejectedValue(new HidApiError(413, 'The file is too large', { code: 'DOCUMENT_TOO_LARGE' }))
    renderPage()
    await openRecord()
    choose(jpeg())
    attach()
    expect((await within(card()).findByRole('alert')).textContent).toBe('The file is too large')
  })
})

describe('permissions', () => {
  it('without lab.document.read: the form only, and the documents are never read, even after an attach', async () => {
    as([...WORK, WRITE])
    renderPage()
    await openRecord()
    expect(card()).toBeTruthy()
    expect(within(card()).queryByRole('list')).toBeNull()
    choose(jpeg())
    attach()
    expect(await within(card()).findByText(ATTACHED)).toBeTruthy()
    expect(api.uploadWorkItemDocument).toHaveBeenCalledTimes(1)
    expect(api.workItemDocuments).not.toHaveBeenCalled()
  })

  it('without lab.document.write: the list only, with no form', async () => {
    as([...WORK, READ])
    renderPage()
    await openRecord()
    expect(await within(card()).findByText('full-blood-count.jpg')).toBeTruthy()
    expect(within(card()).queryByLabelText(/^Lab result file/)).toBeNull()
    expect(within(card()).queryByRole('button', { name: 'Attach result document' })).toBeNull()
  })

  it('without either: no card, and nothing read', async () => {
    as([...WORK, 'ehr.document.read', 'ehr.document.write', 'pharmacy.document.read', 'pharmacy.document.write'])
    renderPage()
    await openRecord()
    await waitFor(() => expect(documentTypesServed()).toBe(true))
    expect(screen.queryByRole('heading', { name: 'Result documents' })).toBeNull()
    expect(api.workItemDocuments).not.toHaveBeenCalled()
  })

  it('offers no form on work whose order from another facility has closed, and still lists its documents', async () => {
    api.labWorkItems.mockResolvedValue(served([workItem({ orderRoute: { id: '9c1b2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e', reference: '9C1B2D3E',
      effectiveState: 'cancelled', access: 'read', orderingFacilityName: 'Demo Hospital', version: 4, endedKind: 'order_changed' } as LabWorkItem['orderRoute'] })]))
    renderPage()
    await openRecord()
    expect(await within(card()).findByText('full-blood-count.jpg')).toBeTruthy()
    expect(within(card()).queryByRole('button', { name: 'Attach result document' })).toBeNull()
  })
})

describe('hosts', () => {
  it.each([
    'pharmacy.healthidentitydirectory.com', 'pharmacy.staging.healthidentitydirectory.com', 'outreach.healthidentitydirectory.com',
    'admin.healthidentitydirectory.com', 'admin.staging.healthidentitydirectory.com',
  ])('shows no card and reads nothing on %s', async name => {
    host.name = name
    renderPage()
    await openRecord()
    await waitFor(() => expect(documentTypesServed()).toBe(true))
    expect(screen.queryByRole('heading', { name: 'Result documents' })).toBeNull()
    expect(api.workItemDocuments).not.toHaveBeenCalled()
  })

  it.each(['ehr.healthidentitydirectory.com', 'lab.staging.healthidentitydirectory.com', 'migrate.healthidentitydirectory.com', 'localhost'])(
    'shows the card on %s', async name => {
      host.name = name
      renderPage()
      await openRecord()
      expect(await within(card()).findByText('full-blood-count.jpg')).toBeTruthy()
    })
})

describe('the patient', () => {
  it('stays masked on a lab’s own work: the card names no one and shows no full patient ID', async () => {
    renderPage()
    await openRecord()
    await within(card()).findByText('full-blood-count.jpg')
    choose(jpeg())
    attach()
    await within(card()).findByText(ATTACHED)
    expect(screen.getAllByText(MASKED).length).toBeGreaterThan(0)
    expect(card().textContent).not.toContain('Patient')
    const markup = window.document.body.innerHTML
    expect(markup).not.toContain('Patient One')
    expect(markup).not.toContain(PATIENT)
    expect(markup).not.toContain(PATIENT.slice(0, 8))
    // The patient sent is the work item's own, as the list carries it.
    expect(api.uploadWorkItemDocument.mock.calls[0]![1]).toBe(PATIENT)
  })
})
