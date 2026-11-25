import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsultWorkspace } from '../../../ehr-blue/clinical/consult/ConsultWorkspace'
import {
  COMPLETED_ERROR_WARNING, ENCOUNTER_CHANGED, ENCOUNTER_NOT_FOUND, ENCOUNTER_STATUS_UPDATED, IMPORTED_VISIT, NO_CONSENT, OPEN_ORDERS,
  OPEN_PATIENT_AGAIN, SIGNED_NOTES,
} from '../../../ehr-blue/clinical/consult/encounters'
import { consultationLabel } from '../../../plainLabels'
import { ENCOUNTER_ID, FACILITY_ID, PATIENT_HID, PATIENT_ID, activePatient, allowedLookup, labelled, renderPage } from './harness'

/**
 * EHR-C8a on the blue consultation page (Novu, Release A): a completed consultation offers "Mark as entered in error"
 * under More actions, to a role that may change consultations, with write access, except on the visit that holds the
 * imported paper records. It asks for the reason, says what it does in the form and in its dialog, sends the row
 * version, and reads the visit and its records again. Each refusal says what to do first, in plain words, with the way
 * to the card it names; a stale version is read again as before. Everything here is fictional.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), encounter: vi.fn(), createEncounter: vi.fn(), updateEncounter: vi.fn(),
  records: vi.fn(), createRecord: vi.fn(), updateRecord: vi.fn(), updateDiagnosis: vi.fn(), noteRevisions: vi.fn(), addNoteRevision: vi.fn(),
  documents: vi.fn(), documentDownload: vi.fn(), uploadDocument: vi.fn(), reportedHealthProfile: vi.fn(), vitalCorrections: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true), facilityId: undefined as string | undefined }))

vi.mock('../../../staff/api', async () => ({ staffApi: api, isAllowedPatientLookup: (await import('./harness')).isAllowedPatientLookup }))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})
vi.mock('../../../staff/session', () => ({ staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ name: 'test' }) }))
vi.mock('../../../ehr-blue/clinical/consult/orders', () => ({
  EncounterOrders: () => <p>Connected orders</p>,
  EncounterOrderPages: () => <p>Order pages part</p>,
  orderPath: (encounterId: string, kind: string, orderId: string) => `${encounterId}/orders/${kind}/${orderId}`,
}))

const ALL = [
  'ehr.encounter.read', 'ehr.encounter.write', 'ehr.note.read', 'ehr.note.write', 'ehr.vital.read', 'ehr.prescription.read', 'ehr.lab-request.read',
]
const COMPLETED = {
  id: ENCOUNTER_ID, patientId: PATIENT_ID, facilityId: FACILITY_ID, encounterType: 'ambulatory', status: 'completed',
  startedAt: '2026-10-30T08:00:00.000Z', chiefComplaint: 'Fever for two days', rowVersion: 6, importedPaperRecords: false,
}
const WITHDRAWN = { ...COMPLETED, status: 'entered_in_error', rowVersion: 7 }
const REASON = 'Opened on the wrong patient'
const LABEL = 'Mark as entered in error'
/** The service's own words, which never reach the page. */
const SERVER_WORDS = 'Server words that must not be shown'
const refused = (status: number, code: string) => new HidApiError(status, SERVER_WORDS, { code })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  staff.facilityId = undefined
  staff.permissions = [...ALL]
  staff.activePatient = activePatient()
  staff.setActivePatient.mockImplementation(value => { staff.activePatient = value; return true })
  api.lookupPatient.mockResolvedValue(allowedLookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounter.mockResolvedValue(COMPLETED)
  api.encounters.mockResolvedValue({ items: [COMPLETED], nextCursor: null })
  api.records.mockResolvedValue({ items: [], nextCursor: null })
  api.noteRevisions.mockResolvedValue([])
  api.documents.mockResolvedValue({ items: [], nextCursor: null })
  api.vitalCorrections.mockResolvedValue([])
  api.reportedHealthProfile.mockResolvedValue(null)
  api.updateEncounter.mockImplementation(async () => { api.encounter.mockResolvedValue(WITHDRAWN); return WITHDRAWN })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

/** The memory router's address (window.location never moves under MemoryRouter). */
function Address() {
  const location = useLocation()
  return <p data-testid="address">{`${location.pathname}${location.search}${location.hash}`}</p>
}

async function openEncounter() {
  render(
    <MemoryRouter initialEntries={[`/provider/clinical/${ENCOUNTER_ID}`]}>
      <Address />
      <Routes><Route path="/provider/clinical/*" element={<ConsultWorkspace />} /></Routes>
    </MemoryRouter>,
  )
  expect(await screen.findByRole('heading', { level: 1, name: consultationLabel(COMPLETED) })).toBeTruthy()
}

function actions() {
  return within(screen.getByRole('heading', { level: 2, name: 'Actions' }).closest('section') as HTMLElement)
}

/** What More actions offers (none: no menu). */
function menuLabels(): string[] {
  const more = actions().queryByRole('button', { name: /^More actions/ })
  if (!more) return []
  fireEvent.click(more)
  const labels = within(screen.getByRole('menu')).getAllByRole('menuitem').map(item => item.textContent ?? '')
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  return labels
}

function submitOf(name: string) {
  return actions().getAllByRole('button', { name }).find(button => button.getAttribute('type') === 'submit')!
}

/** Chooses "Mark as entered in error", gives the reason, presses its submit and says yes in the dialog. */
function markEnteredInError() {
  fireEvent.click(actions().getByRole('button', { name: /^More actions/ }))
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: LABEL }))
  fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: REASON } })
  fireEvent.click(submitOf(LABEL))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: LABEL }))
}

function noCodesOrServerWords() {
  const shown = document.body.textContent ?? ''
  expect(shown).not.toContain(SERVER_WORDS)
  expect(shown).not.toMatch(/[A-Z]{3,}_[A-Z_]{3,}/)
  expect(shown).not.toMatch(/permission|unverified/i)
  expect(shown).not.toMatch(/[–—]/)
  expect(shown).not.toContain(PATIENT_ID)
  // The Health ID is in the patient banner only, never in an address.
  for (const link of screen.queryAllByRole('link')) expect(link.getAttribute('href') ?? '').not.toContain(PATIENT_HID)
}

describe('Consultation: a completed visit marked as entered in error (EHR-C8a)', () => {
  it('offers it on a completed visit, says what it does, and sends the reason and row version', async () => {
    await openEncounter()
    expect(menuLabels()).toEqual([LABEL])
    fireEvent.click(actions().getByRole('button', { name: /^More actions/ }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: LABEL }))
    // Its own warning, tied to the submit, not the one about closing a visit's records.
    const warning = actions().getByText(COMPLETED_ERROR_WARNING)
    expect(submitOf(LABEL).getAttribute('aria-describedby')).toBe(warning.id)
    expect(actions().queryByText(/Closing or cancelling/)).toBeNull()
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: `  ${REASON} ` } })
    fireEvent.click(submitOf(LABEL))
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByRole('heading', { name: `${LABEL}?` })).toBeTruthy()
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)!.textContent).toBe(COMPLETED_ERROR_WARNING)
    expect(api.updateEncounter).not.toHaveBeenCalled()
    const checks = api.lookupPatient.mock.calls.length
    api.records.mockClear()
    fireEvent.click(within(dialog).getByRole('button', { name: LABEL }))
    expect(await screen.findByText(ENCOUNTER_STATUS_UPDATED)).toBeTruthy()
    expect(api.updateEncounter).toHaveBeenCalledTimes(1)
    expect(api.updateEncounter).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, { expectedRowVersion: 6, changeReason: REASON, status: 'entered_in_error' })
    // The access re-check before the change and before the visit is read again; then the visit's lists are read again.
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 2)
    expect(api.records.mock.calls.map(call => call[3]).sort()).toEqual(['clinical-notes', 'lab-requests', 'prescriptions', 'vitals'])
    expect(screen.getAllByText('Entered in error').length).toBeGreaterThan(0)
    expect(menuLabels()).toEqual([])
    noCodesOrServerWords()
  })

  it('is not offered on the imported paper records visit, on an earlier backend, or to a role that may not change consultations', async () => {
    api.encounter.mockResolvedValue({ ...COMPLETED, importedPaperRecords: true })
    let view = renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(await screen.findByRole('heading', { level: 1, name: consultationLabel(COMPLETED) })).toBeTruthy()
    expect(menuLabels()).not.toContain(LABEL)
    view.unmount()
    api.encounter.mockResolvedValue(COMPLETED)
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    view = renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(await screen.findByRole('heading', { level: 1, name: consultationLabel(COMPLETED) })).toBeTruthy()
    expect(menuLabels()).not.toContain(LABEL)
    view.unmount()
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    staff.permissions = ALL.filter(permission => permission !== 'ehr.encounter.write')
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(await screen.findByRole('heading', { level: 1, name: consultationLabel(COMPLETED) })).toBeTruthy()
    expect(menuLabels()).not.toContain(LABEL)
  })

  it.each([
    ['VISIT_HAS_OPEN_ORDERS', OPEN_ORDERS, 'Go to Orders', 'Orders'],
    ['VISIT_HAS_SIGNED_NOTES', SIGNED_NOTES, 'Go to Notes', 'Notes'],
  ])('says %s plainly, with the way to the card, and changes and reads nothing', async (code, words, link, card) => {
    api.updateEncounter.mockRejectedValue(refused(409, code))
    await openEncounter()
    const reads = api.encounter.mock.calls.length
    markEnteredInError()
    const alert = await actions().findByRole('alert')
    expect(alert.textContent).toBe(`${words} ${link}`)
    // Not a stale visit: not read again, not said to have changed, and the form keeps the reason.
    expect(api.encounter.mock.calls.length).toBe(reads)
    expect(screen.queryByText(ENCOUNTER_CHANGED)).toBeNull()
    expect(screen.queryByText(ENCOUNTER_STATUS_UPDATED)).toBeNull()
    expect((actions().getByLabelText(labelled('Reason for change')) as HTMLInputElement).value).toBe(REASON)
    // The link takes focus to the card it names, and the address never changes.
    const jump = within(alert).getByRole('link', { name: link })
    fireEvent.click(jump)
    expect(document.activeElement?.textContent?.startsWith(card)).toBe(true)
    expect(screen.getByTestId('address').textContent).toBe(`/provider/clinical/${ENCOUNTER_ID}`)
    noCodesOrServerWords()
  })

  it.each([
    ['IMPORTED_VISIT_NOT_ENTERED_IN_ERROR', 409, IMPORTED_VISIT],
    ['ENCOUNTER_NOT_FOUND', 404, ENCOUNTER_NOT_FOUND],
    ['CONSENT_REQUIRED', 403, NO_CONSENT],
    ['PURPOSE_OF_USE_REQUIRED', 400, OPEN_PATIENT_AGAIN],
  ])('says %s in plain words, the form kept', async (code, status, words) => {
    api.updateEncounter.mockRejectedValue(refused(status, code))
    await openEncounter()
    markEnteredInError()
    expect((await actions().findByRole('alert')).textContent).toBe(words)
    expect(screen.queryByText(ENCOUNTER_CHANGED)).toBeNull()
    expect((actions().getByLabelText(labelled('Reason for change')) as HTMLInputElement).value).toBe(REASON)
    noCodesOrServerWords()
  })

  it('puts a missing reason on the reason field', async () => {
    api.updateEncounter.mockRejectedValue(refused(400, 'CHANGE_REASON_REQUIRED'))
    await openEncounter()
    markEnteredInError()
    expect(await actions().findByText('Give a reason of at least 3 characters.')).toBeTruthy()
    noCodesOrServerWords()
  })

  it.each([
    ['VERSION_CONFLICT', 412],
    ['INVALID_ENCOUNTER_TRANSITION', 409],
  ])('reads the visit again after %s and says it changed', async (code, status) => {
    api.updateEncounter.mockRejectedValue(refused(status, code))
    await openEncounter()
    api.encounter.mockResolvedValue(WITHDRAWN)
    const reads = api.encounter.mock.calls.length
    markEnteredInError()
    expect((await screen.findByRole('alert')).textContent).toBe(ENCOUNTER_CHANGED)
    await waitFor(() => expect(api.encounter.mock.calls.length).toBe(reads + 1))
    expect(menuLabels()).toEqual([])
    noCodesOrServerWords()
  })
})
