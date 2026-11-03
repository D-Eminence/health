import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsultWorkspace } from '../../../ehr-blue/clinical/consult/ConsultWorkspace'
import { ENCOUNTER_STATUS_UPDATED, RELOAD_FAILED } from '../../../ehr-blue/clinical/consult/encounters'
import { consultationLabel } from '../../../plainLabels'
import { ENCOUNTER_ID, FACILITY_ID, PATIENT_ID, activePatient, allowedLookup, labelled, renderPage } from './harness'

/**
 * The visit page's Orders card shows the page's own order lists: each is read once when the visit opens, and a
 * consultation's cancel or entered in error, which EHR applies to its orders too (staff/routes/Clinical.tsx:82), reads
 * them again fresh, as today's page reads the records shown again (:1580-1583), so the card shows each order as EHR
 * now holds it. A refused change reads nothing. The real Orders card, not a stand-in. Everything here is fictional.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), encounter: vi.fn(), updateEncounter: vi.fn(),
  records: vi.fn(), noteRevisions: vi.fn(), documents: vi.fn(), reportedHealthProfile: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true), facilityId: undefined as string | undefined }))

vi.mock('../../../staff/api', async () => ({ staffApi: api, isAllowedPatientLookup: (await import('./harness')).isAllowedPatientLookup }))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})
vi.mock('../../../staff/session', () => ({ staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ name: 'test' }) }))

const ENCOUNTER = {
  id: ENCOUNTER_ID, patientId: PATIENT_ID, facilityId: FACILITY_ID, encounterType: 'ambulatory', status: 'in_progress',
  startedAt: '2026-10-30T08:00:00.000Z', chiefComplaint: 'Fever for two days', rowVersion: 3,
}
const RX = {
  id: 'b0000000-0000-4000-8000-000000000001', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T09:00:00.000Z',
  medicationDisplay: 'Amoxicillin (fictional)', status: 'active', rowVersion: 2,
}
const LAB = {
  id: 'c0000000-0000-4000-8000-000000000001', patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T09:05:00.000Z',
  testDisplay: 'Haemoglobin (fictional)', status: 'on_hold', rowVersion: 4,
}
/** EHR's orders before the change, and after it: only a fresh read (one started after the change) sees the new ones. */
let changed: string | null

beforeEach(() => {
  vi.clearAllMocks()
  changed = null
  staff.permissions = ['ehr.encounter.read', 'ehr.encounter.write', 'ehr.prescription.read', 'ehr.lab-request.read']
  staff.activePatient = activePatient()
  staff.setActivePatient.mockImplementation(value => { staff.activePatient = value; return true })
  api.lookupPatient.mockResolvedValue(allowedLookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounter.mockResolvedValue(ENCOUNTER)
  api.encounters.mockResolvedValue({ items: [ENCOUNTER], nextCursor: null })
  api.updateEncounter.mockImplementation(async (_f: string, _p: string, _e: string, input: { status: string }) => ({ ...ENCOUNTER, status: input.status, rowVersion: 4 }))
  api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string, page?: { fresh?: boolean }) => {
    const status = changed && page?.fresh ? changed : null
    if (kind === 'prescriptions') return { items: [status ? { ...RX, status, rowVersion: 3 } : RX], nextCursor: null }
    if (kind === 'lab-requests') return { items: [status ? { ...LAB, status, rowVersion: 5 } : LAB], nextCursor: null }
    return { items: [], nextCursor: null }
  })
  api.noteRevisions.mockResolvedValue([])
  api.documents.mockResolvedValue({ items: [], nextCursor: null })
  api.reportedHealthProfile.mockResolvedValue(null)
})

function orders() {
  return within(screen.getByRole('heading', { level: 2, name: 'Orders' }).closest('section') as HTMLElement)
}

const readsOf = (kind: string) => api.records.mock.calls.filter(call => call[3] === kind)

async function openVisit() {
  renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
  expect(await screen.findByRole('heading', { level: 1, name: consultationLabel(ENCOUNTER) })).toBeTruthy()
  await waitFor(() => expect(orders().getByRole('list', { name: 'Orders from this consultation' })).toBeTruthy())
  expect(orders().getByText('Active')).toBeTruthy()
  expect(orders().getByText('On hold')).toBeTruthy()
  // Each order under its own kind, linking to its own kind's page.
  expect(orders().getByRole('link', { name: 'Pharmacy · Amoxicillin (fictional)' }).getAttribute('href')).toBe(`/provider/clinical/${ENCOUNTER_ID}/orders/pharmacy/${RX.id}`)
  expect(orders().getByRole('link', { name: 'Laboratory · Haemoglobin (fictional)' }).getAttribute('href')).toBe(`/provider/clinical/${ENCOUNTER_ID}/orders/laboratory/${LAB.id}`)
}

/** Chooses the change behind More actions, gives a reason and sends it (confirming it in the dialog a cancel asks). */
function change(label: string) {
  const actions = within(screen.getByRole('heading', { level: 2, name: 'Actions' }).closest('section') as HTMLElement)
  fireEvent.click(actions.getByRole('button', { name: /^More actions/ }))
  fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: label }))
  fireEvent.change(actions.getByLabelText(labelled('Reason for change')), { target: { value: 'Opened on the wrong patient' } })
  fireEvent.click(actions.getAllByRole('button', { name: label }).find(button => button.getAttribute('type') === 'submit')!)
  const dialog = screen.queryByRole('alertdialog')
  if (dialog) fireEvent.click(within(dialog).getByRole('button', { name: label }))
}

describe('the Orders card on the visit page', () => {
  it('reads each order list once when the visit opens, after the access re-check: the card and History share them', async () => {
    await openVisit()
    await act(async () => {})
    expect(readsOf('prescriptions')).toEqual([[FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions']])
    expect(readsOf('lab-requests')).toEqual([[FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'lab-requests']])
    // The re-check comes before the visit is read.
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.encounter.mock.invocationCallOrder[0]!)
    const history = within(screen.getByRole('heading', { level: 2, name: 'History' }).closest('section') as HTMLElement)
    expect(history.getByText('Pharmacy · Amoxicillin (fictional)')).toBeTruthy()
  })

  it.each([
    ['Cancel consultation', 'cancelled', 'Cancelled'],
    ['Mark as entered in error', 'entered_in_error', 'Entered in error'],
  ])('after "%s", shows each order as EHR now holds it, read afresh', async (label, status, shown) => {
    await openVisit()
    changed = status
    api.encounter.mockResolvedValue({ ...ENCOUNTER, status, rowVersion: 4 })
    change(label)
    expect(await screen.findByText(ENCOUNTER_STATUS_UPDATED)).toBeTruthy()
    await waitFor(() => expect(orders().getAllByText(shown)).toHaveLength(2))
    expect(orders().queryByText('Active')).toBeNull()
    expect(orders().queryByText('On hold')).toBeNull()
    // Each order list is read once more, fresh (today's read after a change), and the card shows what that read said.
    expect(readsOf('prescriptions')).toHaveLength(2)
    expect(readsOf('lab-requests')).toHaveLength(2)
    expect(readsOf('prescriptions')[1]![4]).toEqual({ cursor: undefined, fresh: true })
    expect(readsOf('lab-requests')[1]![4]).toEqual({ cursor: undefined, fresh: true })
  })

  it('says the change is made only once the orders it changed are read again, as today’s page does', async () => {
    await openVisit()
    changed = 'cancelled'
    api.encounter.mockResolvedValue({ ...ENCOUNTER, status: 'cancelled', rowVersion: 4 })
    const read = api.records.getMockImplementation()!
    let answer!: () => void
    const held = new Promise<void>(resolve => { answer = resolve })
    api.records.mockImplementation(async (...args: Parameters<typeof read>) => {
      if (args[3] === 'prescriptions' && (args[4] as { fresh?: boolean } | undefined)?.fresh) await held
      return read(...args)
    })
    change('Cancel consultation')
    await waitFor(() => expect(readsOf('prescriptions')).toHaveLength(2))
    await act(async () => {})
    // Today's order (staff/routes/Clinical.tsx:1576-1584): while the prescriptions are read again, nothing says it is done.
    expect(screen.queryByText(ENCOUNTER_STATUS_UPDATED)).toBeNull()
    await act(async () => answer())
    expect(await screen.findByText(ENCOUNTER_STATUS_UPDATED)).toBeTruthy()
    // When it says so, every order already shows as EHR now holds it.
    expect(orders().getAllByText('Cancelled')).toHaveLength(2)
    expect(orders().queryByText('Active')).toBeNull()
  })

  it('says the change was saved but the orders could not be read again, as today’s page says it', async () => {
    await openVisit()
    changed = 'cancelled'
    api.encounter.mockResolvedValue({ ...ENCOUNTER, status: 'cancelled', rowVersion: 4 })
    api.records.mockRejectedValue(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    change('Cancel consultation')
    expect(await screen.findByText(ENCOUNTER_STATUS_UPDATED)).toBeTruthy()
    // Today's sentence after a re-read that failed (staff/routes/Clinical.tsx:1477), once, above the page; like today's
    // page, the lists keep what was last read (:1448-1450), checked below.
    await waitFor(() => expect(screen.getAllByRole('alert').filter(alert => alert.textContent?.startsWith(RELOAD_FAILED))).toHaveLength(1))
    expect(readsOf('prescriptions')[1]![4]).toEqual({ cursor: undefined, fresh: true })
    // The orders are not blanked: they stay as last read.
    expect(orders().getByText('Active')).toBeTruthy()
    expect(orders().getByText('On hold')).toBeTruthy()
  })

  it('reads nothing again, and keeps the orders as they were, when the cancel is refused', async () => {
    await openVisit()
    await act(async () => {})
    const reads = api.records.mock.calls.length
    api.updateEncounter.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'ENCOUNTER_RETRACTION_NOT_PERMITTED' }))
    change('Cancel consultation')
    expect(await screen.findByText(/^You can’t cancel this consultation:/)).toBeTruthy()
    await act(async () => {})
    expect(api.records.mock.calls.length).toBe(reads)
    expect(orders().getByText('Active')).toBeTruthy()
    expect(orders().getByText('On hold')).toBeTruthy()
  })

  it('reads the orders again only after a change that changes them: Put on hold reads none', async () => {
    await openVisit()
    await act(async () => {})
    const reads = api.records.mock.calls.length
    api.encounter.mockResolvedValue({ ...ENCOUNTER, status: 'on_hold', rowVersion: 4 })
    change('Put on hold')
    expect(await screen.findByText(ENCOUNTER_STATUS_UPDATED)).toBeTruthy()
    await act(async () => {})
    expect(api.records.mock.calls.length).toBe(reads)
  })
})
