import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import type { DocumentRecord, PharmacyWorkItem } from '../../../../staff/api'
import { documentTypesServed, forgetDocumentTypesServed } from '../../../../documentTypes'
import type * as DocumentTypesModule from '../../../../documentTypes'
import { Pharmacy } from '../../../../ehr-blue/departments/pharmacy/Pharmacy'
import { DEMO_PHARMACY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'
import {
  accepted, AMOXICILLIN, CREATE, deferred, dispensed, DISPENSING_READ, expectNoFullPatientIds, METFORMIN, otherActions, PATIENT_A, PATIENT_B,
  PRESCRIPTIONS, prescriptionCard, READ, recorded, REVERSE, routeCard, showTab,
} from './fixtures'

/**
 * "Prescription sheets" on the blue Pharmacy record (the owner's rule of 31 Oct, documentTypes.ts), as the redesign lays
 * a prescription out (pharmacy/prescriptions/:id: the picking view, and beside it the Prescription card, this one, then
 * Other actions): a prescription sheet attached to the Pharmacy work item, dormant until the Pharmacy work list answers
 * `documentTypes: true`, on every facility host (not outreach. or the admin site), and only for a member holding
 * pharmacy.document.read (the list) or pharmacy.document.write (the form). The host is the one seam mocked
 * (documentTypesHere); the host table is the real one. The point-of-care API answers "not switched on" throughout
 * (harness commerceMock), so nothing waits for payment. Fictional data only: Patient One, HID-ZDEMAAA2, Demo Pharmacy.
 */
const session = vi.hoisted(() => ({ facility: undefined as FakeFacility | undefined }))
const api = vi.hoisted(() => ({ pharmacyWorkItems: vi.fn(), dispense: vi.fn(), dispensing: vi.fn(), reverseDispensing: vi.fn(),
  workItemDocuments: vi.fn(), uploadWorkItemDocument: vi.fn(), documentDownload: vi.fn() }))
const strays = vi.hoisted(() => new Set<string>())
const host = vi.hoisted(() => ({ name: 'pharmacy.healthidentitydirectory.com' }))
const commerceApi = vi.hoisted(() => ({} as Record<string, (...args: never[]) => unknown>))

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
vi.mock('../../../../staff/api', () => ({
  staffApi: new Proxy(api, { get(target, key) {
    if (typeof key === 'string' && !(key in target)) strays.add(key)
    return target[key as keyof typeof target]
  } }),
  orderRoutesApi: {},
}))
vi.mock('../../../../staff/session', () => ({ staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))
vi.mock('../../../../staff/env', () => ({ getEnvironment: () => ({ name: 'test', apiBaseUrl: 'https://gateway.example.test' }) }))

const DOC_READ = 'pharmacy.document.read'
const DOC_WRITE = 'pharmacy.document.write'
const DOCUMENTS = [READ, CREATE, DOC_READ, DOC_WRITE]
const HINT = 'PDF, JPEG, PNG or TIFF, up to 50 MiB.'
const ATTACHED = 'Prescription sheet attached. It can be opened once its virus scan is clean.'

const sheet = (overrides: Partial<DocumentRecord> = {}): DocumentRecord => ({
  id: 'd0000000-0000-4000-8000-000000000011', patientId: PATIENT_A, encounterId: null, pharmacyWorkItemId: accepted.id,
  fileName: 'prescription-sheet.png', mediaType: 'image/png', sizeBytes: 40960, status: 'available', scanStatus: 'clean',
  createdAt: '2026-10-08T10:00:00.000Z', documentType: 'prescription_sheet', ...overrides,
})
const served = (items: PharmacyWorkItem[] = [accepted, dispensed]) => ({ items, documentTypes: true })
const page = (items: DocumentRecord[]) => ({ items, nextCursor: null, documentTypes: true })
const png = () => new File([new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])], 'demo-prescription.png', { type: 'image/png' })

function working(permissions: string[]) {
  session.facility = fakeFacility(permissions, { id: DEMO_PHARMACY_ID, name: 'Demo Pharmacy', roles: ['pharmacist'] })
}

async function openRecord(name = AMOXICILLIN) {
  renderDept(<Pharmacy />, { route: PRESCRIPTIONS })
  fireEvent.click(await screen.findByRole('button', { name }))
  await screen.findByRole('heading', { level: 1, name })
}

/** Back to the list, from the open record (the arrow before its title). */
function backToList() {
  fireEvent.click(screen.getByRole('button', { name: 'Back to prescriptions' }))
}

function card() {
  return screen.getByRole('heading', { name: 'Prescription sheets' }).closest('section') as HTMLElement
}

function choose(file: File | null) {
  fireEvent.change(within(card()).getByLabelText(/^Prescription sheet file/), { target: { files: file ? [file] : [] } })
}

function attach() {
  fireEvent.click(within(card()).getByRole('button', { name: 'Attach prescription sheet' }))
}

beforeEach(() => {
  for (const key of Object.keys(commerceApi)) delete commerceApi[key]
  vi.resetAllMocks()
  strays.clear()
  host.name = 'pharmacy.healthidentitydirectory.com'
  working(DOCUMENTS)
  api.pharmacyWorkItems.mockResolvedValue(served())
  api.workItemDocuments.mockResolvedValue(page([sheet()]))
  api.uploadWorkItemDocument.mockResolvedValue('d0000000-0000-4000-8000-000000000012')
  api.documentDownload.mockResolvedValue({ url: 'https://storage.example.test/signed/prescription-sheet.png', expiresInSeconds: 60 })
  forgetDocumentTypesServed()
})
afterEach(() => {
  expect([...strays]).toEqual([])
  // Nothing about the work or its documents reaches the address or the browser's storage.
  expect(window.location.hash).toBe('')
  expect(window.localStorage.length).toBe(0)
  expect(window.sessionStorage.length).toBe(0)
  forgetDocumentTypesServed()
})

describe('dormant until the Pharmacy work list says the document types are served', () => {
  it.each([
    ['says nothing of them', {}],
    ['answers documentTypes: false', { documentTypes: false }],
  ])('shows no card, reads no documents and sends no new field when the list %s', async (_said, fields) => {
    api.pharmacyWorkItems.mockResolvedValue({ items: [accepted, dispensed], ...fields })
    await openRecord()
    await waitFor(() => expect(documentTypesServed()).toBe(false))
    // The record shows exactly as it does without the document types: the prescription, and the picking view.
    expect(prescriptionCard()).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Pick and hand over' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Prescription sheets' })).toBeNull()
    expect(screen.queryByLabelText(/^Prescription sheet file/)).toBeNull()
    expect(api.workItemDocuments).not.toHaveBeenCalled()
    expect(api.uploadWorkItemDocument).not.toHaveBeenCalled()
    expect(api.documentDownload).not.toHaveBeenCalled()
    expect(api.pharmacyWorkItems.mock.calls).toEqual([[DEMO_PHARMACY_ID]])
    const sent = JSON.stringify(Object.values(api).flatMap(mock => mock.mock.calls))
    expect(sent).not.toMatch(/documentType|labWorkItemId|pharmacyWorkItemId|prescription_sheet/)
  })
})

describe('served, for a member who reads and attaches pharmacy documents', () => {
  it('lists the work item’s prescription sheets beside the prescription, read with its own patient', async () => {
    await openRecord()
    const documents = card()
    expect(await within(documents).findByText('prescription-sheet.png')).toBeTruthy()
    expect(api.workItemDocuments).toHaveBeenCalledTimes(1)
    expect(api.workItemDocuments).toHaveBeenCalledWith(DEMO_PHARMACY_ID, PATIENT_A, { kind: 'pharmacy', id: accepted.id })
    expect(within(documents).getByText('Prescription sheet')).toBeTruthy()
    expect(within(documents).getByText('image/png · 40 KiB · scan: clean')).toBeTruthy()
    expect(within(documents).getByRole('button', { name: 'Open file' })).toBeTruthy()
    // A supporting card with its own h2, in the record's side column, after the Prescription card.
    expect(screen.getByRole('heading', { level: 2, name: 'Prescription sheets' })).toBeTruthy()
    expect(documents.parentElement).toBe(prescriptionCard().parentElement)
    expect(prescriptionCard().compareDocumentPosition(documents) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('comes before Other actions, on a dispensing that may be reversed', async () => {
    working([...DOCUMENTS, DISPENSING_READ, REVERSE])
    api.workItemDocuments.mockResolvedValue(page([sheet({ patientId: PATIENT_B, pharmacyWorkItemId: dispensed.id })]))
    renderDept(<Pharmacy />, { route: PRESCRIPTIONS })
    await screen.findByRole('button', { name: AMOXICILLIN })
    showTab('All')
    fireEvent.click(screen.getByRole('button', { name: METFORMIN }))
    await screen.findByRole('heading', { level: 1, name: METFORMIN })
    expect(await within(card()).findByText('prescription-sheet.png')).toBeTruthy()
    expect(api.workItemDocuments).toHaveBeenCalledWith(DEMO_PHARMACY_ID, PATIENT_B, { kind: 'pharmacy', id: dispensed.id })
    expect(card().parentElement).toBe(otherActions().parentElement)
    expect(card().compareDocumentPosition(otherActions()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('offers no Open file until the virus scan is clean, and says when there are none', async () => {
    api.workItemDocuments.mockResolvedValueOnce(page([sheet({ scanStatus: 'pending' })]))
    await openRecord()
    expect(await within(card()).findByText('image/png · 40 KiB · scan: pending')).toBeTruthy()
    expect(within(card()).queryByRole('button', { name: 'Open file' })).toBeNull()
    backToList()
    api.workItemDocuments.mockResolvedValueOnce(page([]))
    fireEvent.click(await screen.findByRole('button', { name: AMOXICILLIN }))
    expect(await within(card()).findByText('No prescription sheets yet.')).toBeTruthy()
    expect(api.workItemDocuments).toHaveBeenCalledTimes(2)
  })

  it('opens a clean sheet from its signed storage link only', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await openRecord()
    fireEvent.click(await within(card()).findByRole('button', { name: 'Open file' }))
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://storage.example.test/signed/prescription-sheet.png', '_blank', 'noopener,noreferrer'))
    expect(api.documentDownload).toHaveBeenCalledWith(DEMO_PHARMACY_ID, 'd0000000-0000-4000-8000-000000000011')
    api.documentDownload.mockResolvedValue({ url: 'http://storage.example.test/signed/prescription-sheet.png', expiresInSeconds: 60 })
    fireEvent.click(within(card()).getByRole('button', { name: 'Open file' }))
    expect((await within(card()).findByRole('alert')).textContent).toBe('The document could not be opened.')
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('attaches a prescription sheet to the Pharmacy work item, the very File chosen, then reads the sheets again', async () => {
    await openRecord()
    await within(card()).findByText('prescription-sheet.png')
    expect(within(card()).getByText(HINT)).toBeTruthy()
    const file = png()
    const upload = deferred<string>()
    api.uploadWorkItemDocument.mockReturnValue(upload.promise)
    choose(file)
    attach()
    expect(await within(card()).findByRole('button', { name: 'Attaching…' })).toBeTruthy()
    expect(api.uploadWorkItemDocument).toHaveBeenCalledWith(DEMO_PHARMACY_ID, PATIENT_A, { kind: 'pharmacy', id: accepted.id }, file,
      'prescription_sheet')
    expect(api.uploadWorkItemDocument.mock.calls[0]![3]).toBe(file)
    api.workItemDocuments.mockResolvedValue(page([sheet(),
      sheet({ id: 'd0000000-0000-4000-8000-000000000012', fileName: 'demo-prescription.png', sizeBytes: file.size, scanStatus: 'pending' })]))
    await act(async () => { upload.resolve('d0000000-0000-4000-8000-000000000012') })
    expect(await within(card()).findByText(ATTACHED)).toBeTruthy()
    expect(await within(card()).findByText('demo-prescription.png')).toBeTruthy()
    expect(api.workItemDocuments).toHaveBeenCalledTimes(2)
    // The record's own status region says nothing of it: the card says it.
    expect(recorded()).toBe('')
  })

  it('refuses a file of another type before sending, with today’s words', async () => {
    await openRecord()
    choose(new File(['Demo Pharmacy'], 'notes.txt', { type: 'text/plain' }))
    attach()
    expect(await within(card()).findByText('Use PDF, JPEG, PNG, or TIFF, up to 50 MiB.')).toBeTruthy()
    expect(api.uploadWorkItemDocument).not.toHaveBeenCalled()
  })

  it('says a refusal in the backend’s own words: the lab-result wording is the Lab card’s only', async () => {
    api.uploadWorkItemDocument.mockRejectedValueOnce(new HidApiError(403, 'Pharmacy document access is not authorized', { code: 'FORBIDDEN' }))
    await openRecord()
    choose(png())
    attach()
    expect((await within(card()).findByRole('alert')).textContent).toBe('Pharmacy document access is not authorized')
    api.uploadWorkItemDocument.mockRejectedValueOnce(new HidApiError(403, 'This document type is not allowed here', { code: 'DOCUMENT_TYPE_NOT_ALLOWED_HERE' }))
    attach()
    await waitFor(() => expect(within(card()).getByRole('alert').textContent).toBe('This document type is not allowed here'))
    expect(within(card()).queryByText(ATTACHED)).toBeNull()
  })
})

describe('permissions', () => {
  it('without pharmacy.document.read: the form only, and the sheets are never read', async () => {
    working([READ, DOC_WRITE])
    await openRecord()
    choose(png())
    attach()
    expect(await within(card()).findByText(ATTACHED)).toBeTruthy()
    expect(within(card()).queryByRole('list')).toBeNull()
    expect(api.workItemDocuments).not.toHaveBeenCalled()
  })

  it('without pharmacy.document.write: the list only, with no form', async () => {
    working([READ, DOC_READ])
    await openRecord()
    expect(await within(card()).findByText('prescription-sheet.png')).toBeTruthy()
    expect(within(card()).queryByRole('button', { name: 'Attach prescription sheet' })).toBeNull()
  })

  it('without either: no card, and nothing read', async () => {
    working([READ, CREATE, 'lab.document.read', 'lab.document.write', 'ehr.document.write'])
    await openRecord()
    await waitFor(() => expect(documentTypesServed()).toBe(true))
    expect(screen.queryByRole('heading', { name: 'Prescription sheets' })).toBeNull()
    expect(api.workItemDocuments).not.toHaveBeenCalled()
  })

  it('offers no form on a prescription whose order from another facility has closed', async () => {
    const closed: PharmacyWorkItem = { ...accepted, orderRoute: routeCard({ effectiveState: 'cancelled', access: 'read', endedKind: 'order_changed' }) }
    api.pharmacyWorkItems.mockResolvedValue(served([closed]))
    await openRecord()
    expect(await within(card()).findByText('prescription-sheet.png')).toBeTruthy()
    expect(within(card()).queryByRole('button', { name: 'Attach prescription sheet' })).toBeNull()
  })
})

describe('hosts', () => {
  it.each(['outreach.healthidentitydirectory.com', 'outreach.staging.healthidentitydirectory.com', 'admin.healthidentitydirectory.com',
    'admin.staging.healthidentitydirectory.com'])('shows no card and reads nothing on %s', async name => {
    host.name = name
    await openRecord()
    await waitFor(() => expect(documentTypesServed()).toBe(true))
    expect(screen.queryByRole('heading', { name: 'Prescription sheets' })).toBeNull()
    expect(api.workItemDocuments).not.toHaveBeenCalled()
  })

  it.each(['ehr.healthidentitydirectory.com', 'lab.healthidentitydirectory.com', 'migrate.staging.healthidentitydirectory.com',
    'pharmacy.staging.healthidentitydirectory.com', 'localhost'])('shows the card on %s', async name => {
    host.name = name
    await openRecord()
    expect(await within(card()).findByText('prescription-sheet.png')).toBeTruthy()
  })
})

describe('the patient', () => {
  it('stays masked on the pharmacy’s own work: the card names no one and shows no full patient ID', async () => {
    await openRecord()
    await within(card()).findByText('prescription-sheet.png')
    choose(png())
    attach()
    await within(card()).findByText(ATTACHED)
    expect(screen.getAllByText(`Patient ••••${PATIENT_A.slice(-6)}`).length).toBeGreaterThan(0)
    expect(card().textContent).not.toContain('Patient')
    expect(window.document.body.innerHTML).not.toContain('Patient One')
    expectNoFullPatientIds()
    expect(api.uploadWorkItemDocument.mock.calls[0]![1]).toBe(PATIENT_A)
  })
})
