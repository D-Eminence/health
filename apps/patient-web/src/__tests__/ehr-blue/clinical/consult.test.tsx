import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsultWorkspace, consultStatus } from '../../../ehr-blue/clinical/consult/ConsultWorkspace'
import { NOTES_ARE_DRAFTS } from '../../../ehr-blue/clinical/consult/encounters'
import { formatWhen } from '../../../ehr-blue/clinical/parts/format'
import { consultationLabel } from '../../../plainLabels'
import { ALLERGIES_NOT_SHOWN, ALLERGIES_UNREAD, NOTHING_REPORTED } from '../../../ehr-blue/clinical/patients/AllergiesCard'
import { parseAllergyList } from '../../../staff/allergies'
import { BASE, ENCOUNTER_ID, FACILITY_ID, PATIENT_HID, PATIENT_ID, PATIENT_NAME, activePatient, allowedLookup, labelled, patientBanner, renderPage } from './harness'
import { SAID_FIELDS_REFUSED, SAID_NETWORK, SAID_NOT_FOUND, SAID_UNAVAILABLE } from '../../said'

/**
 * Consultation, the list and "New consultation": the open patient's encounters (today's paging, the access re-check
 * before each read) in the design's table and quick view, and a new encounter with its draft note and diagnosis.
 * Everything is fictional.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), encounter: vi.fn(), createEncounter: vi.fn(), updateEncounter: vi.fn(),
  createConsultation: vi.fn(),
  records: vi.fn(), createRecord: vi.fn(), updateRecord: vi.fn(), updateDiagnosis: vi.fn(), noteRevisions: vi.fn(), addNoteRevision: vi.fn(),
  documents: vi.fn(), documentDownload: vi.fn(), uploadDocument: vi.fn(), reportedHealthProfile: vi.fn(), allergies: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true) }))

vi.mock('../../../staff/api', async () => ({ staffApi: api, isAllowedPatientLookup: (await import('./harness')).isAllowedPatientLookup }))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})
vi.mock('../../../staff/session', () => ({ staffSessionGeneration: () => 1, untilStaffSessionReady: async () => {} }))
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ name: 'test' }) }))
vi.mock('../../../ehr-blue/clinical/consult/orders', () => ({
  EncounterOrders: () => <p>Connected orders part</p>,
  EncounterOrderPages: () => <p>Order pages part</p>,
  orderPath: (encounterId: string, kind: string, orderId: string) => `${encounterId}/orders/${kind}/${orderId}`,
}))

const ALL = [
  'ehr.encounter.read', 'ehr.encounter.write', 'ehr.note.read', 'ehr.note.write', 'ehr.diagnosis.read', 'ehr.diagnosis.write',
  'ehr.document.read', 'ehr.document.write',
]
const ENCOUNTER = {
  id: ENCOUNTER_ID, patientId: PATIENT_ID, facilityId: FACILITY_ID, encounterType: 'ambulatory', status: 'in_progress',
  startedAt: '2026-10-30T08:00:00.000Z', chiefComplaint: 'Fever for two days', rowVersion: 1,
}
const SECOND = { ...ENCOUNTER, id: 'e2222222-0000-4000-8000-000000000002', status: 'completed', chiefComplaint: null, startedAt: '2026-09-21T08:00:00.000Z' }
const NEW_ID = 'e1111111-0000-4000-8000-000000000003'
const READ_ONLY = 'You can view this record but not change it.'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  staff.permissions = [...ALL]
  staff.activePatient = activePatient()
  staff.setActivePatient.mockImplementation(value => { staff.activePatient = value; return true })
  api.lookupPatient.mockResolvedValue(allowedLookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounters.mockResolvedValue({ items: [ENCOUNTER], nextCursor: null })
  api.encounter.mockImplementation(async (_f: string, _p: string, id: string) => ({ ...ENCOUNTER, id }))
  api.records.mockResolvedValue({ items: [], nextCursor: null })
  api.documents.mockResolvedValue({ items: [], nextCursor: null })
  api.noteRevisions.mockResolvedValue([])
  api.reportedHealthProfile.mockResolvedValue(null)
  // A backend before 0117 by default: the allergy list is not served, so the patient's own text is read instead.
  api.allergies.mockRejectedValue(new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' }))
  api.createEncounter.mockResolvedValue({ ...ENCOUNTER, id: NEW_ID, chiefComplaint: 'Cough' })
  // A backend before EHR-C5 by default: the one-call route answers 404, so "New consultation" below is today's separate
  // calls, unchanged. "New consultation in one call (EHR-C5)" serves it.
  api.createConsultation.mockRejectedValue(new HidApiError(404, 'Cannot POST', { code: 'NOT_FOUND' }))
  api.createRecord.mockImplementation(async (_f: string, _p: string, encounterId: string, kind: string) => ({ id: `${kind}-1`, patientId: PATIENT_ID, encounterId, createdAt: '2026-10-30T09:00:00.000Z' }))
})

function open(rest = '') {
  return renderPage(<ConsultWorkspace />, 'consult', rest)
}

function where() {
  return screen.queryByTestId('elsewhere')?.textContent ?? null
}

/** Where the address is now, how it got there (POP for the first entry, PUSH or REPLACE), and its router state. */
function Address() {
  const location = useLocation()
  const how = useNavigationType()
  return <p data-testid="address">{`${how} ${location.pathname} ${JSON.stringify(location.state ?? null)}`}</p>
}

/** The list opened as Home's "Orders accepted for the wrong person" link opens it: /provider/clinical with { order }. */
function openFromHome(order: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: `${BASE}/clinical`, state: { order } }]}>
      <Address />
      <Routes>
        <Route path={`${BASE}/clinical/*`} element={<ConsultWorkspace />} />
      </Routes>
    </MemoryRouter>,
  )
}

const address = () => screen.getByTestId('address').textContent

describe('Consultation list', () => {
  it('is partial: encounters, notes, diagnoses and documents are live; some connected orders are sample', () => {
    expect(consultStatus).toBe('partial')
  })

  it('shows the loading state, then the patient’s encounters in the design’s table, after the access re-check', async () => {
    const page = deferred<{ items: unknown[]; nextCursor: null }>()
    api.encounters.mockReturnValueOnce(page.promise)
    open()
    expect(screen.getByRole('heading', { level: 1, name: 'Consultation' })).toBeTruthy()
    expect(await screen.findByText('Loading consultations…')).toBeTruthy()
    await act(async () => page.resolve({ items: [ENCOUNTER, SECOND], nextCursor: null }))

    const table = await screen.findByRole('table', { name: 'Consultations' })
    // One patient's chart: the second column says what the visit was for; the patient is named once, in the banner.
    expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Record', 'Complaint', 'Status', 'Started', 'Actions'])
    const link = within(table).getByRole('link', { name: consultationLabel(ENCOUNTER) })
    expect(link.getAttribute('href')).toBe(`/provider/clinical/${ENCOUNTER_ID}`)
    expect(within(table).getByText('Fever for two days')).toBeTruthy()
    expect(within(table).getByText('No chief complaint provided')).toBeTruthy()
    expect(within(table).queryByText(PATIENT_NAME)).toBeNull()
    expect(within(patientBanner()).getByText(PATIENT_NAME)).toBeTruthy()
    expect(within(table).getByText('In progress')).toBeTruthy()
    expect(within(table).getByText('Completed')).toBeTruthy()
    expect(api.encounters).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, { cursor: undefined, fresh: false })
    expect(api.lookupPatient).toHaveBeenCalledWith(FACILITY_ID, PATIENT_HID, 'direct-care')
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.encounters.mock.invocationCallOrder[0]!)
    // Nothing identifying in the address.
    expect(window.location.href).not.toContain(PATIENT_HID)
  })

  it('opens the record quick view, and Escape closes it', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: `Quick view ${consultationLabel(ENCOUNTER)}` }))
    const drawer = await screen.findByRole('dialog', { name: 'Record quick view' })
    expect(within(drawer).getByRole('heading', { level: 3, name: consultationLabel(ENCOUNTER) })).toBeTruthy()
    expect(within(drawer).getByText('Outpatient')).toBeTruthy()
    expect(within(drawer).getByText('Fever for two days')).toBeTruthy()
    // The time shown is when the consultation started: never called an update.
    expect(within(drawer).getByText(/^Started /)).toBeTruthy()
    expect(within(drawer).queryByText(/updated/i)).toBeNull()
    expect(within(drawer).getByRole('button', { name: 'Open full record' })).toBeTruthy()
    fireEvent.keyDown(drawer, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Record quick view' })).toBeNull())
  })

  it('searches the page shown and says when nothing matches', async () => {
    api.encounters.mockResolvedValue({ items: [ENCOUNTER, SECOND], nextCursor: null })
    open()
    await screen.findByRole('table', { name: 'Consultations' })
    fireEvent.change(screen.getByLabelText('Search consultations'), { target: { value: 'fever' } })
    expect(screen.getAllByRole('link', { name: /^Open / })).toHaveLength(1)
    // The time the Started column shows finds its row.
    fireEvent.change(screen.getByLabelText('Search consultations'), { target: { value: formatWhen(SECOND.startedAt) } })
    expect(screen.getAllByRole('link', { name: /^Open / })).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('Search consultations'), { target: { value: 'nothing like this' } })
    expect(screen.getByText('No matching records')).toBeTruthy()
    expect(screen.getByText('Change your search.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getAllByRole('link', { name: /^Open / })).toHaveLength(2)
  })

  it('shows today’s empty sentence when the patient has no encounters', async () => {
    api.encounters.mockResolvedValue({ items: [], nextCursor: null })
    open()
    expect(await screen.findByText('No consultations for this patient here yet.')).toBeTruthy()
    // Said once, as the empty list's title: no search was made, so nothing reads as a search that found nothing.
    expect(screen.queryByText('No matching records')).toBeNull()
    expect(screen.queryByText('Change your search.')).toBeNull()
  })

  it('parity: names the facility over the list, and says the direct-care line with "Change patient →" under the patient', async () => {
    staff.permissions = [...ALL, 'identity.patient.read']
    open()
    await screen.findByRole('table', { name: 'Consultations' })
    expect(screen.getByText('Clinical record · Demo Hospital')).toBeTruthy()
    const line = screen.getByText(/· Direct care access\./)
    expect(line.textContent).toBe(`HID ${PATIENT_HID} · Direct care access. Patient page · Change patient →`)
    expect(within(line).getByRole('link', { name: 'Change patient →' }).getAttribute('href')).toBe('/provider/patients')
  })

  it('under the patient, points a role without identity.patient.read to Access requests, never to Find a patient', async () => {
    staff.permissions = [...ALL, 'identity.consent.write']
    const view = open()
    await screen.findByRole('table', { name: 'Consultations' })
    let line = screen.getByText(/· Direct care access\./)
    expect(within(line).queryByRole('link', { name: 'Change patient →' })).toBeNull()
    expect(within(line).getByRole('link', { name: 'Access requests →' }).getAttribute('href')).toBe('/provider/requests')
    view.unmount()
    staff.permissions = [...ALL]
    open()
    await screen.findByRole('table', { name: 'Consultations' })
    line = screen.getByText(/· Direct care access\./)
    expect(line.textContent).toBe(`HID ${PATIENT_HID} · Direct care access.`)
    expect(within(line).queryAllByRole('link')).toEqual([])
  })

  it('shows a refused read as an alert', async () => {
    api.encounters.mockRejectedValue(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    open()
    expect((await screen.findByRole('alert')).textContent).toBe(SAID_UNAVAILABLE)
    expect(document.body.textContent).not.toContain('EHR is unavailable.')
  })

  it('after a failed read, Refresh reads the list afresh after the access re-check, and the alert goes', async () => {
    api.encounters.mockRejectedValueOnce(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    open()
    expect((await screen.findByRole('alert')).textContent).toBe(SAID_UNAVAILABLE)
    expect(document.body.textContent).not.toContain('EHR is unavailable.')
    const checks = api.lookupPatient.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('table', { name: 'Consultations' })).toBeTruthy()
    expect(api.encounters).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, { cursor: undefined, fresh: true })
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('pages with the backend cursor, re-checking access each time, and restarts on a cursor EHR no longer accepts', async () => {
    api.encounters.mockImplementation(async (_f: string, _p: string, page: { cursor?: string }) => {
      if (page.cursor === 'cursor-2') return { items: [SECOND], nextCursor: null }
      return { items: [ENCOUNTER], nextCursor: 'cursor-2' }
    })
    open()
    const pager = await screen.findByRole('navigation', { name: 'Consultation pages' })
    expect(within(pager).getByRole('status').textContent).toBe('Page 1')
    const previous = within(pager).getByRole('button', { name: 'Previous page' }) as HTMLButtonElement
    expect([previous.disabled, previous.getAttribute('aria-disabled')]).toEqual([false, 'true'])
    fireEvent.click(within(pager).getByRole('button', { name: 'Next page' }))
    expect(await within(pager).findByText('Page 2')).toBeTruthy()
    expect(api.encounters).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, { cursor: 'cursor-2', fresh: false })
    expect(api.lookupPatient).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('link', { name: consultationLabel(SECOND) }).getAttribute('href')).toBe(`/provider/clinical/${SECOND.id}`)

    // A failed page read is an alert; the page shown stays.
    api.encounters.mockRejectedValueOnce(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    fireEvent.click(within(pager).getByRole('button', { name: 'Previous page' }))
    expect((await screen.findByRole('alert')).textContent).toBe(`The page could not be loaded. ${SAID_UNAVAILABLE}`)
    expect(document.body.textContent).not.toContain('EHR is unavailable.')
    expect(within(pager).getByText('Page 2')).toBeTruthy()

    // Refresh re-reads the page shown; a stale cursor starts again from the newest.
    api.encounters.mockImplementation(async (_f: string, _p: string, page: { cursor?: string }) => {
      if (page.cursor === 'cursor-2') throw new HidApiError(400, 'The cursor is invalid.', { code: 'INVALID_CURSOR' })
      return { items: [ENCOUNTER], nextCursor: 'cursor-2' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('This list changed since it was opened, so it shows the newest entries again.')).toBeTruthy()
    expect(within(screen.getByRole('navigation', { name: 'Consultation pages' })).getByText('Page 1')).toBeTruthy()
    expect(api.encounters).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, { cursor: 'cursor-2', fresh: true })
    expect(api.encounters).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, { cursor: undefined, fresh: true })
  })

  it('hides the pager when there is one page', async () => {
    open()
    await screen.findByRole('table', { name: 'Consultations' })
    expect(screen.queryByRole('navigation', { name: 'Consultation pages' })).toBeNull()
  })

  it('parity: the pager is "Consultation pages": a button that cannot act stays focusable and does nothing, and the page reached is announced', async () => {
    api.encounters.mockImplementation(async (_f: string, _p: string, page: { cursor?: string }) => {
      if (page.cursor === 'cursor-2') return { items: [SECOND], nextCursor: null }
      return { items: [ENCOUNTER], nextCursor: 'cursor-2' }
    })
    open()
    const pager = await screen.findByRole('navigation', { name: 'Consultation pages' })
    const previous = within(pager).getByRole('button', { name: 'Previous page' }) as HTMLButtonElement
    const next = within(pager).getByRole('button', { name: 'Next page' }) as HTMLButtonElement
    // Marked unavailable, not disabled: it keeps focus, and a press reads nothing.
    expect(previous.disabled).toBe(false)
    expect(previous.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(previous)
    await act(async () => {})
    expect(api.encounters).toHaveBeenCalledTimes(1)
    act(() => { next.focus() })
    fireEvent.click(next)
    await waitFor(() => expect(within(pager).getByRole('status').textContent).toBe('Page 2'))
    expect(next.disabled).toBe(false)
    expect(next.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(next)
    fireEvent.click(next)
    await act(async () => {})
    expect(api.encounters).toHaveBeenCalledTimes(2)
  })

  it('offers "New consultation" as the heading’s one primary action, a real button, only when the grant allows changes', async () => {
    open()
    const create = await screen.findByRole('button', { name: 'New consultation' })
    // The heading's actions: Refresh (secondary), then the one primary, "New consultation".
    const heading = screen.getByRole('heading', { level: 1, name: 'Consultation' }).parentElement!.parentElement!
    expect(within(heading).getAllByRole('button').map(button => button.textContent)).toEqual(['Refresh', 'New consultation'])
    expect(create.className).not.toContain('secondary')
    fireEvent.click(create)
    expect(await screen.findByRole('heading', { level: 1, name: 'New consultation' })).toBeTruthy()
  })

  it('shows today’s read-only sentence in the design’s banner, with no "Create record"', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    open()
    expect(await screen.findByText(READ_ONLY)).toBeTruthy()
    // Said once, under the patient banner (the banner itself says "Read only").
    expect(screen.getAllByText('Read only').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'New consultation' })).toBeNull()
  })

  it('fails closed when write access cannot be confirmed', async () => {
    api.consentStatus.mockRejectedValue(new HidApiError(503, 'Identity is unavailable.', { code: 'UNAVAILABLE' }))
    open()
    expect(await screen.findByText('We couldn’t check whether you can make changes, so changes are off. Refresh the page to try again.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New consultation' })).toBeNull()
  })

  it('closes the patient when the access re-check is refused (403)', async () => {
    // Find a patient is offered only to a role that can open it (identity.patient.read).
    staff.permissions = [...ALL, 'identity.patient.read']
    api.lookupPatient.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'CONSENT_REQUIRED' }))
    open()
    const ended = await screen.findByRole('alert')
    expect(ended.textContent).toContain('Access to this patient ended')
    expect(ended.textContent).toContain('Open the patient again to keep working.')
    expect(within(ended).getByRole('link', { name: 'Find a patient' }).getAttribute('href')).toBe('/provider/patients')
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    expect(api.encounters).not.toHaveBeenCalled()
  })

  it('asks for a patient first when none is open', () => {
    // Find a patient is offered only to a role that can open it (identity.patient.read).
    staff.permissions = [...ALL, 'identity.patient.read']
    staff.activePatient = null
    open()
    expect(screen.getByRole('heading', { level: 1, name: 'Consultation' })).toBeTruthy()
    expect(screen.getByText('Clinical record')).toBeTruthy()
    expect(screen.getByText('Choose a patient first.')).toBeTruthy()
    // Today's sentences (staff/routes/Clinical.tsx:1375), none dropped: "documented" is today's, the rest keeps the
    // redesign's plain words (the owner's rule: no "authorized").
    expect(screen.getByText('No patient open.').parentElement!.textContent).toBe(
      'Records show only for a patient you have access to at this facility. No patient open. Open a patient with an approved request, the patient’s PIN, or documented emergency access.')
    expect(document.body.textContent).not.toMatch(/authori[sz]/i)
    expect(screen.queryByText(/Direct care access/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Find a patient' }).getAttribute('href')).toBe('/provider/patients')
    expect(api.encounters).not.toHaveBeenCalled()
  })

  it('item 4: opens the order Home links to (accepted for the wrong person) for the open patient, replacing the address with record ids only', async () => {
    staff.permissions = [...ALL, 'ehr.lab-request.read', 'ehr.prescription.read']
    for (const [kind, ours, orderId] of [['lab_request', 'laboratory', 'lab-1'], ['prescription', 'pharmacy', 'rx-1']] as const) {
      const view = openFromHome({ patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, kind, orderId })
      expect(await screen.findByText('Order pages part')).toBeTruthy()
      expect(address()).toBe(`REPLACE /provider/clinical/${ENCOUNTER_ID}/orders/${ours}/${orderId} null`)
      expect(address()).not.toContain(PATIENT_ID)
      expect(address()).not.toContain(PATIENT_HID)
      // The list is not read on the way, nor the chart sections under it.
      expect(api.encounters).not.toHaveBeenCalled()
      expect(api.reportedHealthProfile).not.toHaveBeenCalled()
      expect(api.allergies).not.toHaveBeenCalled()
      view.unmount()
    }
  })

  it('item 4: ignores a linked order of a kind the role may not read, and shows the encounters', async () => {
    for (const [kind, orderId, other] of [['lab_request', 'lab-1', 'ehr.prescription.read'], ['prescription', 'rx-1', 'ehr.lab-request.read']] as const) {
      staff.permissions = [...ALL, other]
      const view = openFromHome({ patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, kind, orderId })
      expect(await screen.findByRole('table', { name: 'Consultations' })).toBeTruthy()
      expect(screen.queryByText('Order pages part')).toBeNull()
      expect(address()).toMatch(/^POP \/provider\/clinical /)
      // The list as ever, with today's chart sections under it.
      expect(document.querySelector('.hid-ehr-clinical-today')).not.toBeNull()
      view.unmount()
    }
  })

  it('item 4: ignores a linked order for a different patient and shows the encounters', async () => {
    openFromHome({ patientId: 'a0000000-0000-4000-8000-000000000999', encounterId: ENCOUNTER_ID, kind: 'lab_request', orderId: 'lab-1' })
    expect(await screen.findByRole('table', { name: 'Consultations' })).toBeTruthy()
    expect(screen.queryByText('Order pages part')).toBeNull()
    expect(address()).toMatch(/^POP \/provider\/clinical /)
  })

  it('item 4: ignores a linked order for an emergency patient', async () => {
    staff.activePatient = activePatient('emergency')
    openFromHome({ patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, kind: 'prescription', orderId: 'rx-1' })
    expect(screen.getByText('Emergency access shows the emergency summary only')).toBeTruthy()
    await act(async () => {})
    expect(screen.queryByText('Order pages part')).toBeNull()
    expect(address()).toMatch(/^POP \/provider\/clinical /)
  })

  it('parity: under emergency access, a role that may open the emergency summary is taken there, as today’s /provider/clinical shows it', async () => {
    staff.permissions = [...ALL, 'identity.break-glass.write']
    staff.activePatient = activePatient('emergency')
    openFromHome(undefined)
    await waitFor(() => expect(address()).toBe('REPLACE /provider/emergency/summary null'))
    expect(address()).not.toContain(PATIENT_ID)
    expect(address()).not.toContain(PATIENT_HID)
    expect(screen.queryByText('Emergency access shows the emergency summary only')).toBeNull()
    expect(api.encounters).not.toHaveBeenCalled()
    expect(api.consentStatus).not.toHaveBeenCalled()
  })

  it('shows the read-only emergency notice for an emergency patient to a role that may not open the summary, and nothing to create', () => {
    staff.activePatient = activePatient('emergency')
    open()
    expect(screen.getByText('Emergency access shows the emergency summary only')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New consultation' })).toBeNull()
    expect(api.encounters).not.toHaveBeenCalled()
    expect(api.consentStatus).not.toHaveBeenCalled()
  })
})

describe('New consultation', () => {
  function fill(label: string, value: string) {
    fireEvent.change(screen.getByLabelText(labelled(label)), { target: { value } })
  }

  async function openNew() {
    open('/new')
    expect(await screen.findByRole('heading', { level: 1, name: 'New consultation' })).toBeTruthy()
    return screen.findByRole('button', { name: 'Start consultation' })
  }

  it('shows the open patient and the patient context, with the allergies the patient reported', async () => {
    api.reportedHealthProfile.mockResolvedValue({ allergies: 'Penicillin', bloodGroup: null, genotype: null, currentMedications: null, chronicConditions: null, medicalNotes: null, updatedAt: null })
    await openNew()
    // The open patient is the banner (the one-option Patient select is gone); the allergies have their own section.
    expect(screen.queryByLabelText(labelled('Patient'))).toBeNull()
    expect(within(patientBanner()).getByText(PATIENT_NAME)).toBeTruthy()
    expect(within(patientBanner()).getByText(PATIENT_HID)).toBeTruthy()
    const context = await screen.findByRole('region', { name: 'Allergies' })
    // Before 0117 (the allergy list answers 404): the patient's own words, labelled as theirs.
    expect(within(context).getByText('Allergies reported by the patient: Penicillin (entered by the patient in their Health ID portal, not clinically verified).')).toBeTruthy()
    expect(within(context).queryByText(/recorded by clinicians/)).toBeNull()
    expect(api.allergies).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, expect.any(AbortSignal))
    expect(api.reportedHealthProfile).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, expect.any(AbortSignal))
    expect(screen.getByText('Notes are saved as drafts. Signing needs its own reviewed action.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back to list' })).toBeTruthy()
  })

  it('parity: says what starting an encounter requires, and takes the complaint in a textarea, as today', async () => {
    await openNew()
    expect(screen.getByText('To start a consultation, you need current access to this patient and must give the reason for the visit.')).toBeTruthy()
    expect(screen.getByLabelText(labelled('Presenting complaint')).tagName).toBe('TEXTAREA')
  })

  describe('allergies (hid-system 0117)', () => {
    const allergy = (id: string, substance: string, severity: string, reaction: string | null, status = 'active') => ({
      id, substance, reaction, severity, status, rowVersion: 1, createdAt: '2026-10-01T09:00:00.000Z', enteredInErrorReason: null, recordedHere: false,
    })
    /** Ola's case: a clinician recorded a severe penicillin allergy and the patient entered nothing. */
    const severePenicillin = allergy('a0000000-0000-4000-8000-000000000001', 'Penicillin', 'severe', 'Anaphylaxis')

    it('shows the allergies clinicians recorded, in the EHR’s order, and never "None recorded" when there are some', async () => {
      api.allergies.mockResolvedValue({ recorded: [
        severePenicillin,
        allergy('a0000000-0000-4000-8000-000000000002', 'Latex', 'unknown', null),
        allergy('a0000000-0000-4000-8000-000000000003', 'Codeine', 'mild', 'Itch'),
      ], patientReported: { allergies: null, updatedAt: null } })
      await openNew()
      const context = await screen.findByRole('region', { name: 'Allergies' })
      expect(within(context).getByText('Allergies recorded by clinicians: Penicillin (severe: Anaphylaxis); Latex (severity not known); Codeine (mild: Itch).')).toBeTruthy()
      expect(within(context).getByText(NOTHING_REPORTED)).toBeTruthy()
      expect(context.textContent).not.toMatch(/None recorded/)
      expect(api.reportedHealthProfile).not.toHaveBeenCalled()
    })

    it('labels what the patient entered as theirs, beside what clinicians recorded', async () => {
      api.allergies.mockResolvedValue({ recorded: [severePenicillin], patientReported: { allergies: 'Sulfa drugs', updatedAt: null } })
      await openNew()
      const context = await screen.findByRole('region', { name: 'Allergies' })
      expect(within(context).getByText('Allergies recorded by clinicians: Penicillin (severe: Anaphylaxis).')).toBeTruthy()
      expect(within(context).getByText('Allergies reported by the patient: Sulfa drugs (entered by the patient in their Health ID portal, not clinically verified).')).toBeTruthy()
    })

    it('says "none" only after a read that found none', async () => {
      api.allergies.mockResolvedValue({ recorded: [], patientReported: { allergies: null, updatedAt: null } })
      const view = open('/new')
      let context = await screen.findByRole('region', { name: 'Allergies' })
      expect(within(context).getByText('Allergies recorded by clinicians: none.')).toBeTruthy()
      expect(within(context).getByText(`${NOTHING_REPORTED} Confirm allergies with the patient.`)).toBeTruthy()
      view.unmount()

      // Before 0117 only the patient's text is read: nothing is said about allergies clinicians recorded.
      api.allergies.mockRejectedValue(new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' }))
      open('/new')
      context = await screen.findByRole('region', { name: 'Allergies' })
      expect(within(context).getByText(`${NOTHING_REPORTED} Confirm allergies with the patient.`)).toBeTruthy()
      expect(context.textContent).not.toMatch(/None recorded|recorded by clinicians/)
    })

    it('never says "None recorded" when the read failed, was refused, is not served or could not be read: it says so', async () => {
      const cases: Array<[() => void, string]> = [
        [() => { api.allergies.mockRejectedValue(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' })) }, ALLERGIES_UNREAD],
        [() => { api.allergies.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'FORBIDDEN' })) }, ALLERGIES_NOT_SHOWN],
        [() => { api.allergies.mockRejectedValue(new TypeError('The answer could not be read.')) }, ALLERGIES_UNREAD],
        [() => { api.allergies.mockResolvedValue({ recorded: 'not a list' }) }, ALLERGIES_UNREAD],
        // One recorded allergy that can't be read fails the whole list (the real parser): never the rest as if complete.
        [() => { api.allergies.mockImplementation(async () => parseAllergyList({ recorded: [{ id: 'a1240000-0000-4000-8000-000000000051', substance: 'Penicillin', reaction: null, severity: 'severe', status: 'active', rowVersion: 1, createdAt: null, enteredInErrorReason: null, recordedHere: true }, { id: 'a1240000-0000-4000-8000-000000000052', substance: '', severity: 'mild', status: 'active', rowVersion: 1 }], patientReported: { allergies: null, updatedAt: null } })) }, ALLERGIES_UNREAD],
        [() => { api.reportedHealthProfile.mockRejectedValue(new HidApiError(404, 'Not found', { code: 'NOT_FOUND' })) }, ALLERGIES_NOT_SHOWN],
        [() => { api.reportedHealthProfile.mockRejectedValue(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' })) }, ALLERGIES_UNREAD],
      ]
      for (const [arrange, words] of cases) {
        api.allergies.mockRejectedValue(new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' }))
        api.reportedHealthProfile.mockResolvedValue(null)
        arrange()
        const view = open('/new')
        const context = await screen.findByRole('region', { name: 'Allergies' })
        expect(within(context).getByText(words, { exact: false })).toBeTruthy()
        expect(context.textContent).not.toMatch(/None recorded|: none\.|not entered any allergies/)
        expect(within(patientBanner()).getByText(PATIENT_NAME)).toBeTruthy()
        view.unmount()
      }
    })

    it('reads again when asked after a failure', async () => {
      api.allergies.mockRejectedValueOnce(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
        .mockResolvedValueOnce({ recorded: [severePenicillin], patientReported: { allergies: null, updatedAt: null } })
      await openNew()
      const context = await screen.findByRole('region', { name: 'Allergies' })
      fireEvent.click(within(context).getByRole('button', { name: 'Try again' }))
      expect(await within(context).findByText('Allergies recorded by clinicians: Penicillin (severe: Anaphylaxis).')).toBeTruthy()
      expect(api.allergies).toHaveBeenCalledTimes(2)
    })

    it('asks nothing without ehr.note.read, and says the allergies can’t be shown, never that there are none', async () => {
      staff.permissions = ALL.filter(permission => permission !== 'ehr.note.read')
      await openNew()
      await act(async () => {})
      expect(within(patientBanner()).getByText(PATIENT_NAME)).toBeTruthy()
      const context = screen.getByRole('region', { name: 'Allergies' })
      expect(within(context).getByText(ALLERGIES_NOT_SHOWN)).toBeTruthy()
      expect(api.allergies).not.toHaveBeenCalled()
      expect(api.reportedHealthProfile).not.toHaveBeenCalled()
    })
  })

  it('checks required fields on submit and moves focus to the first, calling nothing', async () => {
    const save = await openNew()
    expect(save.getAttribute('type')).toBe('submit')
    fireEvent.click(save)
    // Only the presenting complaint (the encounter type starts as Outpatient); the note's fields are optional.
    expect(screen.getAllByText('Complete this field.')).toHaveLength(1)
    expect(document.activeElement).toBe(screen.getByLabelText(labelled('Presenting complaint')))
    expect(screen.getByLabelText(labelled('Presenting complaint')).getAttribute('aria-invalid')).toBe('true')
    expect(api.createEncounter).not.toHaveBeenCalled()
    // A diagnosis needs its code system and code.
    fill('Diagnosis', 'Malaria')
    fireEvent.click(save)
    expect(screen.getByLabelText(labelled('Code system')).getAttribute('aria-invalid')).toBe('true')
  })

  it('offers no diagnosis fields to a role that may write diagnoses but not read them, and adds none', async () => {
    staff.permissions = ALL.filter(permission => permission !== 'ehr.diagnosis.read')
    const save = await openNew()
    for (const label of ['Diagnosis', 'Code system', 'Code', 'Clinical status', 'Verification']) expect(screen.queryByLabelText(labelled(label))).toBeNull()
    fill('Presenting complaint', 'Cough')
    fill('History', 'Three days of cough.')
    fireEvent.click(save)
    expect(await screen.findByRole('heading', { level: 1, name: consultationLabel(ENCOUNTER) })).toBeTruthy()
    expect(api.createRecord).toHaveBeenCalledTimes(1)
    expect(api.createRecord.mock.calls.filter(call => call[3] === 'diagnoses')).toHaveLength(0)
  })

  it('keeps today’s field limits', async () => {
    await openNew()
    expect((screen.getByLabelText(labelled('Presenting complaint')) as HTMLInputElement).maxLength).toBe(4000)
    expect((screen.getByLabelText(labelled('Clinical note')) as HTMLTextAreaElement).maxLength).toBe(100000)
    expect((screen.getByLabelText(labelled('Diagnosis')) as HTMLInputElement).maxLength).toBe(500)
    expect((screen.getByLabelText(labelled('Code system')) as HTMLInputElement).maxLength).toBe(255)
    expect((screen.getByLabelText(labelled('Code')) as HTMLInputElement).maxLength).toBe(100)
  })

  it('item 5: History, Examination and Clinical note are optional: type and complaint alone start the encounter, with no note', async () => {
    const save = await openNew()
    for (const label of ['History', 'Examination', 'Clinical note', 'Follow-up']) {
      const field = screen.getByLabelText(labelled(label))
      expect(field.hasAttribute('required')).toBe(false)
      // Labelled without the required " *".
      expect(screen.getByLabelText(new RegExp(`^${label}$`))).toBe(field)
    }
    fireEvent.change(screen.getByLabelText(labelled('Type of visit')), { target: { value: 'virtual' } })
    fill('Presenting complaint', 'Cough')
    fireEvent.click(save)

    expect(await screen.findByRole('heading', { level: 1, name: consultationLabel(ENCOUNTER) })).toBeTruthy()
    expect(api.createEncounter).toHaveBeenCalledTimes(1)
    expect(api.createEncounter).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID,
      { encounterType: 'virtual', status: 'in_progress', startedAt: expect.any(String), chiefComplaint: 'Cough' }, expect.any(String))
    expect(api.createRecord).not.toHaveBeenCalled()
  })

  it('item 5: writes the draft note once when any one of History, Examination, Clinical note or Follow-up has text', async () => {
    for (const label of ['History', 'Examination', 'Clinical note', 'Follow-up']) {
      const view = open('/new')
      const save = await screen.findByRole('button', { name: 'Start consultation' })
      fill('Presenting complaint', 'Cough')
      fill(label, 'Fictional text.')
      fireEvent.click(save)
      expect(await screen.findByRole('heading', { level: 1, name: consultationLabel(ENCOUNTER) })).toBeTruthy()
      const notes = api.createRecord.mock.calls.filter(call => call[3] === 'clinical-notes')
      expect(notes).toHaveLength(1)
      expect(notes[0]!.slice(0, 5)).toEqual([FACILITY_ID, PATIENT_ID, NEW_ID, 'clinical-notes', {
        noteType: 'Consultation', title: 'Consultation note', status: 'draft', content: `${label}\nFictional text.`,
      }])
      expect(api.createEncounter).toHaveBeenCalledTimes(1)
      view.unmount()
      api.createRecord.mockClear()
      api.createEncounter.mockClear()
    }
  })

  it('starts the encounter, writes its draft note and diagnosis, each after the access re-check, then opens it', async () => {
    const save = await openNew()
    fireEvent.change(screen.getByLabelText(labelled('Type of visit')), { target: { value: 'virtual' } })
    fill('Presenting complaint', 'Cough')
    fill('History', 'Three days of cough.')
    fill('Examination', 'Chest clear.')
    fill('Diagnosis', 'Upper respiratory infection')
    fill('Code system', 'ICD-10')
    fill('Code', 'J06.9')
    fill('Clinical note', 'Fluids and rest.')
    fill('Follow-up', 'Review in a week')
    // Enter in a field submits the form: the button is its submit button.
    fireEvent.submit(save.closest('form')!)

    expect(await screen.findByText('Consultation started.')).toBeTruthy()
    expect(where()).toBeNull()
    expect(api.createEncounter).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID,
      { encounterType: 'virtual', status: 'in_progress', startedAt: expect.any(String), chiefComplaint: 'Cough' }, expect.any(String))
    expect(api.createRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, NEW_ID, 'clinical-notes', {
      noteType: 'Consultation', title: 'Consultation note', status: 'draft',
      content: 'History\nThree days of cough.\n\nExamination\nChest clear.\n\nClinical note\nFluids and rest.\n\nFollow-up\nReview in a week',
    }, expect.any(String))
    expect(api.createRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, NEW_ID, 'diagnoses', {
      codeSystem: 'ICD-10', code: 'J06.9', display: 'Upper respiratory infection', clinicalStatus: 'active', verificationStatus: 'unconfirmed',
    }, expect.any(String))
    const checks = api.lookupPatient.mock.invocationCallOrder
    expect(checks.some(order => order < api.createEncounter.mock.invocationCallOrder[0]!)).toBe(true)
    expect(checks.filter(order => order > api.createEncounter.mock.invocationCallOrder[0]! && order < api.createRecord.mock.invocationCallOrder[0]!)).toHaveLength(1)
    // The new encounter's page.
    expect(screen.getByRole('heading', { level: 1, name: consultationLabel(ENCOUNTER) })).toBeTruthy()
  })

  it('shows a refused note at its field, keeps the encounter started and reuses its keys on retry', async () => {
    api.createRecord.mockRejectedValueOnce(new HidApiError(400, 'One or more request fields are invalid.', {
      code: 'VALIDATION_FAILED', details: [{ field: 'content', messages: ['content must be shorter than or equal to 100000 characters'] }],
    }))
    const save = await openNew()
    fill('Presenting complaint', 'Cough')
    fill('History', 'H')
    fill('Examination', 'E')
    fill('Clinical note', 'N')
    fireEvent.click(save)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(SAID_FIELDS_REFUSED)
    expect(document.body.textContent).not.toContain('request fields are invalid')
    expect(screen.getByLabelText(labelled('Clinical note')).getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Consultation started. Outpatient · Cough. Save again to add the rest to it.')).toBeTruthy()
    expect(screen.queryByLabelText(labelled('Presenting complaint'))).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Save the rest' }))
    expect(await screen.findByRole('heading', { level: 1, name: consultationLabel(ENCOUNTER) })).toBeTruthy()
    expect(api.createEncounter).toHaveBeenCalledTimes(1)
    expect(api.createRecord).toHaveBeenCalledTimes(2)
    expect(api.createRecord.mock.calls[1]![5]).toBe(api.createRecord.mock.calls[0]![5])
  })

  it('never writes the note twice: once saved, its fields go and a retry sends only what is left', async () => {
    api.createRecord.mockImplementation(async (_f: string, _p: string, encounterId: string, kind: string) => {
      if (kind === 'diagnoses' && api.createRecord.mock.calls.filter(call => call[3] === 'diagnoses').length === 1) {
        throw new HidApiError(400, 'One or more request fields are invalid.', {
          code: 'VALIDATION_FAILED', details: [{ field: 'code', messages: ['code must be shorter than or equal to 100 characters'] }],
        })
      }
      return { id: `${kind}-1`, patientId: PATIENT_ID, encounterId, createdAt: '2026-10-30T09:00:00.000Z' }
    })
    const save = await openNew()
    fill('Presenting complaint', 'Cough')
    fill('History', 'H')
    fill('Examination', 'E')
    fill('Diagnosis', 'Upper respiratory infection')
    fill('Code system', 'ICD-10')
    fill('Code', 'J06.9X')
    fill('Clinical note', 'N')
    fireEvent.click(save)

    expect((await screen.findByRole('alert')).textContent).toBe(SAID_FIELDS_REFUSED)
    expect(document.body.textContent).not.toContain('request fields are invalid')
    expect(screen.getByLabelText(labelled('Code')).getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Consultation started. Outpatient · Cough. The draft note is saved; change it from the consultation’s page. Save again to add the rest to it.')).toBeTruthy()
    // The saved note's fields are gone, so nothing typed there can be lost or sent as a second note.
    for (const label of ['History', 'Examination', 'Clinical note', 'Follow-up']) expect(screen.queryByLabelText(labelled(label))).toBeNull()

    fill('Code', 'J06.9')
    fireEvent.click(screen.getByRole('button', { name: 'Save the rest' }))
    expect(await screen.findByRole('heading', { level: 1, name: consultationLabel(ENCOUNTER) })).toBeTruthy()
    expect(api.createEncounter).toHaveBeenCalledTimes(1)
    expect(api.createRecord.mock.calls.filter(call => call[3] === 'clinical-notes')).toHaveLength(1)
    const diagnoses = api.createRecord.mock.calls.filter(call => call[3] === 'diagnoses')
    expect(diagnoses).toHaveLength(2)
    expect(diagnoses[1]![4]).toMatchObject({ code: 'J06.9' })
  })

  it('shows a refused encounter at its field with today’s sentences', async () => {
    api.createEncounter.mockRejectedValueOnce(new HidApiError(400, 'One or more request fields are invalid.', {
      code: 'VALIDATION_FAILED', details: [{ field: 'chiefComplaint', messages: ['chiefComplaint should not be empty'] }],
    }))
    const save = await openNew()
    fill('Presenting complaint', 'Cough')
    fill('History', 'H')
    fill('Examination', 'E')
    fill('Clinical note', 'N')
    fireEvent.click(save)
    expect((await screen.findByRole('alert')).textContent).toBe(SAID_FIELDS_REFUSED)
    expect(document.body.textContent).not.toContain('request fields are invalid')
    expect(screen.getByLabelText(labelled('Presenting complaint')).getAttribute('aria-invalid')).toBe('true')
    expect(api.createRecord).not.toHaveBeenCalled()
  })

  it('shows the read-only notice and no form under a read-only grant', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    open('/new')
    expect(await screen.findByText(READ_ONLY)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start consultation' })).toBeNull()
  })

  it('shows the emergency notice, not the form, for an emergency patient', () => {
    staff.activePatient = activePatient('emergency')
    open('/new')
    expect(screen.getByRole('heading', { level: 1, name: 'New consultation' })).toBeTruthy()
    expect(screen.getByText('Emergency access shows the emergency summary only')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start consultation' })).toBeNull()
  })

  it('ends access when the re-check before saving is refused', async () => {
    const save = await openNew()
    fill('Presenting complaint', 'Cough')
    fill('History', 'H')
    fill('Examination', 'E')
    fill('Clinical note', 'N')
    api.lookupPatient.mockRejectedValue(new HidApiError(404, 'Not found', { code: 'NOT_FOUND' }))
    fireEvent.click(save)
    const ended = await screen.findByRole('alert')
    expect(ended.textContent).toContain('Access to this patient ended')
    expect(ended.textContent).toContain('Open the patient again to keep working.')
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    expect(api.createEncounter).not.toHaveBeenCalled()
  })
})

describe('New consultation in one call (EHR-C5)', () => {
  const KEY = /^[A-Za-z0-9_-]{16,128}$/
  const NOTE = {
    noteType: 'Consultation', title: 'Consultation note', status: 'draft',
    content: 'History\nThree days of cough.\n\nExamination\nChest clear.\n\nClinical note\nFluids and rest.\n\nFollow-up\nReview in a week',
  }
  const DIAGNOSIS = { codeSystem: 'ICD-10', code: 'J06.9', display: 'Upper respiratory infection', clinicalStatus: 'active', verificationStatus: 'unconfirmed' }

  /** The 201 for the body sent: a new visit, unless `reused` gives the open visit today with its own complaint. */
  function saved(reused?: { chiefComplaint: string }) {
    return async (_f: string, _p: string, input: { visit: { encounterType: string; chiefComplaint: string } }) => ({
      encounter: {
        ...ENCOUNTER, id: NEW_ID, encounterType: input.visit.encounterType,
        chiefComplaint: reused?.chiefComplaint ?? input.visit.chiefComplaint, reusedOpenVisit: Boolean(reused),
      },
      note: null, vitals: null, diagnoses: [],
    })
  }

  beforeEach(() => {
    api.createConsultation.mockReset()
    api.createConsultation.mockImplementation(saved())
  })

  function fill(label: string, value: string) {
    fireEvent.change(screen.getByLabelText(labelled(label)), { target: { value } })
  }

  async function openNew() {
    const view = open('/new')
    expect(await screen.findByRole('heading', { level: 1, name: 'New consultation' })).toBeTruthy()
    return { view, save: await screen.findByRole('button', { name: 'Start consultation' }) }
  }

  function fillAll() {
    fireEvent.change(screen.getByLabelText(labelled('Type of visit')), { target: { value: 'virtual' } })
    fill('Presenting complaint', 'Cough')
    fill('History', 'Three days of cough.')
    fill('Examination', 'Chest clear.')
    fill('Diagnosis', 'Upper respiratory infection')
    fill('Code system', 'ICD-10')
    fill('Code', 'J06.9')
    fill('Clinical note', 'Fluids and rest.')
    fill('Follow-up', 'Review in a week')
  }

  const call = (index: number) => api.createConsultation.mock.calls[index] as [string, string, { visit: { startedAt: string } }, string]

  it('saves the visit, its draft note and its diagnosis in one call with the exact body, after the access re-check, then opens it', async () => {
    const { save } = await openNew()
    fillAll()
    fireEvent.click(save)

    expect(await screen.findByText('Consultation started.')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: consultationLabel(ENCOUNTER) })).toBeTruthy()
    expect(api.createConsultation).toHaveBeenCalledTimes(1)
    expect(api.createConsultation).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, {
      visit: { encounterType: 'virtual', status: 'in_progress', startedAt: expect.any(String), chiefComplaint: 'Cough' },
      note: NOTE,
      diagnoses: [DIAGNOSIS],
    }, expect.stringMatching(KEY))
    expect(Number.isNaN(Date.parse(call(0)[2].visit.startedAt))).toBe(false)
    // Nothing goes by the separate calls, and there is no "Save the rest".
    expect(api.createEncounter).not.toHaveBeenCalled()
    expect(api.createRecord).not.toHaveBeenCalled()
    expect(api.lookupPatient.mock.invocationCallOrder.some(order => order < api.createConsultation.mock.invocationCallOrder[0]!)).toBe(true)
  })

  it('sends only the parts today’s flow writes: the visit alone when nothing else is typed, and no part the role may not write', async () => {
    let { view, save } = await openNew()
    fill('Presenting complaint', 'Cough')
    fireEvent.click(save)
    expect(await screen.findByText('Consultation started.')).toBeTruthy()
    expect(call(0)[2]).toEqual({ visit: { encounterType: 'ambulatory', status: 'in_progress', startedAt: expect.any(String), chiefComplaint: 'Cough' } })
    view.unmount()

    // Today adds a diagnosis only with its read as well as its write, and a note only with the note write.
    staff.permissions = ALL.filter(permission => permission !== 'ehr.diagnosis.read' && permission !== 'ehr.note.write')
    ;({ view, save } = await openNew())
    for (const label of ['Diagnosis', 'History', 'Clinical note']) expect(screen.queryByLabelText(labelled(label))).toBeNull()
    fill('Presenting complaint', 'Cough')
    fireEvent.click(save)
    expect(await screen.findByText('Consultation started.')).toBeTruthy()
    expect(Object.keys(call(1)[2])).toEqual(['visit'])
  })

  it('keeps today’s fields, limits and notice', async () => {
    await openNew()
    for (const label of ['Type of visit', 'Presenting complaint', 'History', 'Examination', 'Diagnosis', 'Code system', 'Code', 'Clinical status', 'Verification', 'Clinical note', 'Follow-up']) {
      expect(screen.getByLabelText(labelled(label))).toBeTruthy()
    }
    expect((screen.getByLabelText(labelled('Presenting complaint')) as HTMLTextAreaElement).maxLength).toBe(4000)
    expect((screen.getByLabelText(labelled('Clinical note')) as HTMLTextAreaElement).maxLength).toBe(100000)
    // The words are pinned by the test of today's form above; the one-call form shows the same line.
    expect(screen.getByText(NOTES_ARE_DRAFTS)).toBeTruthy()
  })

  it('keeps the key and the body when pressed again after no answer or a server failure', async () => {
    api.createConsultation
      .mockRejectedValueOnce(new HidApiError(0, 'Failed to fetch', { code: 'NETWORK_ERROR' }))
      .mockRejectedValueOnce(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    const { save } = await openNew()
    fillAll()
    fireEvent.click(save)
    expect((await screen.findByRole('alert')).textContent).toBe(SAID_NETWORK)
    fireEvent.click(screen.getByRole('button', { name: 'Start consultation' }))
    expect(await screen.findByText(SAID_UNAVAILABLE)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Start consultation' }))
    expect(await screen.findByText('Consultation started.')).toBeTruthy()

    expect(api.createConsultation).toHaveBeenCalledTimes(3)
    // The same key and the identical body, start time included, so a save that went through answers again.
    expect(call(1)[3]).toBe(call(0)[3])
    expect(call(2)[3]).toBe(call(0)[3])
    expect(call(1)[2]).toEqual(call(0)[2])
    expect(call(2)[2]).toEqual(call(0)[2])
  })

  it('gives a new consultation a new key, and replaces the key after a final answer', async () => {
    let { view, save } = await openNew()
    fill('Presenting complaint', 'Cough')
    fireEvent.click(save)
    expect(await screen.findByText('Consultation started.')).toBeTruthy()
    view.unmount()

    ;({ view, save } = await openNew())
    fill('Presenting complaint', 'Headache')
    fireEvent.click(save)
    expect(await screen.findByText('Consultation started.')).toBeTruthy()
    expect(call(1)[3]).toMatch(KEY)
    expect(call(1)[3]).not.toBe(call(0)[3])
    view.unmount()

    // A refusal saved nothing under the key: the next press is a new save with a new key.
    api.createConsultation.mockRejectedValueOnce(new HidApiError(400, 'Invalid clinical data', { code: 'INVALID_CLINICAL_DATA' }))
    ;({ save } = await openNew())
    fill('Presenting complaint', 'Cough')
    fireEvent.click(save)
    expect(await screen.findByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Start consultation' }))
    expect(await screen.findByText('Consultation started.')).toBeTruthy()
    expect(call(3)[3]).not.toBe(call(2)[3])
    expect(new Set(api.createConsultation.mock.calls.map(item => item[3])).size).toBe(4)
  })

  it('keeps the key, and never says nothing was saved, when the key may already hold a save', async () => {
    // hid-system executeCreate: REQUEST_IN_PROGRESS and IDEMPOTENCY_RESULT_UNAVAILABLE mean the key's row exists.
    for (const code of ['REQUEST_IN_PROGRESS', 'IDEMPOTENCY_RESULT_UNAVAILABLE']) {
      api.createConsultation.mockReset()
      api.createConsultation.mockImplementation(saved())
      api.createConsultation.mockRejectedValueOnce(new HidApiError(409, 'Key in use', { code }))
      const { view, save } = await openNew()
      fillAll()
      fireEvent.click(save)
      expect((await screen.findByRole('alert')).textContent, code).toBe(
        'This consultation may already be saved. Open the patient’s consultations to check it before you save again.')
      expect(document.body.textContent).not.toContain('Nothing was saved')
      expect(document.body.textContent).not.toContain(code)
      fireEvent.click(screen.getByRole('button', { name: 'Start consultation' }))
      expect(await screen.findByText('Consultation started.')).toBeTruthy()
      expect(call(1)[3]).toBe(call(0)[3])
      expect(call(1)[2]).toEqual(call(0)[2])
      view.unmount()
    }
  })

  it('after a press with no answer, a 403 keeps the key and never says nothing was saved', async () => {
    // ConsultationPartsGuard and the consent check run before the key is looked up, so they say nothing of that press.
    const cases: Array<[HidApiError, string]> = [
      [new HidApiError(403, 'Required permission is missing', { code: 'PERMISSION_DENIED' }),
        'This consultation may already be saved. Open the patient’s consultations to check it before you save again. You don’t have access to save all of this now. Ask your facility administrator if you need it.'],
      [new HidApiError(403, 'Consent required', { code: 'CONSENT_REQUIRED' }),
        'This consultation may already be saved. Open the patient’s consultations to check it before you save again. The patient has not approved changes to their record by this facility, so it can’t be saved now.'],
    ]
    for (const [error, words] of cases) {
      api.createConsultation.mockReset()
      api.createConsultation.mockImplementation(saved())
      api.createConsultation
        .mockRejectedValueOnce(new HidApiError(0, 'Failed to fetch', { code: 'NETWORK_ERROR' }))
        .mockRejectedValueOnce(error)
      const { view, save } = await openNew()
      fillAll()
      fireEvent.click(save)
      expect((await screen.findByRole('alert')).textContent).toBe(SAID_NETWORK)
      fireEvent.click(screen.getByRole('button', { name: 'Start consultation' }))
      expect(await screen.findByText(words)).toBeTruthy()
      expect(document.body.textContent).not.toContain('Nothing was saved')
      expect(document.body.textContent).not.toContain(error.code)
      fireEvent.click(screen.getByRole('button', { name: 'Start consultation' }))
      expect(await screen.findByText('Consultation started.')).toBeTruthy()
      expect(new Set(api.createConsultation.mock.calls.map(item => item[3])).size).toBe(1)
      view.unmount()
    }
  })

  it('says each refusal in plain words, never the server’s text or code, and sends nothing else', async () => {
    const cases: Array<[HidApiError, string]> = [
      [new HidApiError(403, 'Consent required', { code: 'CONSENT_REQUIRED' }),
        'Nothing was saved. The patient has not approved changes to their record by this facility. Ask them to approve a read-and-write request first.'],
      [new HidApiError(403, 'Required permission is missing', { code: 'PERMISSION_DENIED' }),
        'Nothing was saved. You don’t have access to save all of this. Ask your facility administrator if you need it.'],
      [new HidApiError(409, 'Idempotency key reused', { code: 'IDEMPOTENCY_KEY_REUSED' }),
        'This consultation was already saved with the details as they were before your last change. Open the patient’s consultations to check it before you save again.'],
      [new HidApiError(409, 'Visit entered in error', { code: 'VISIT_ENTERED_IN_ERROR' }),
        'Nothing was saved. The patient’s visit today is marked as entered in error. Open the patient’s consultations to check it, then try again.'],
      [new HidApiError(409, 'Conflict', { code: 'SOMETHING_CONFLICTED' }),
        'Nothing was saved. This patient’s record changed meanwhile. Open the patient’s consultations to check it, then try again.'],
      [new HidApiError(400, 'Not today', { code: 'REUSE_OPEN_VISIT_STARTED_AT_NOT_TODAY' }),
        'Nothing was saved. The date or time on this device looks wrong. Check it, then save again.'],
      [new HidApiError(400, 'Invalid clinical data', { code: 'INVALID_CLINICAL_DATA' }),
        'Nothing was saved. Some details weren’t accepted. Check the details you entered and try again.'],
      [new HidApiError(400, 'Use the open visit', { code: 'CONSULTATION_USES_OPEN_VISIT' }), 'The consultation could not be started.'],
      [new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }), SAID_UNAVAILABLE],
      // A 404 that names a code of its own is the route answering, not a backend before it: no separate calls.
      [new HidApiError(404, 'Patient not found', { code: 'PATIENT_NOT_FOUND' }), SAID_NOT_FOUND],
    ]
    for (const [error, words] of cases) {
      api.createConsultation.mockRejectedValueOnce(error)
      const { view, save } = await openNew()
      fillAll()
      fireEvent.click(save)
      expect((await screen.findByRole('alert')).textContent, error.code).toBe(words)
      expect(document.body.textContent).not.toContain(error.code)
      expect(document.body.textContent).not.toContain(error.message)
      // Nothing was saved, so this is still the start of the consultation.
      expect(screen.getByRole('button', { name: 'Start consultation' })).toBeTruthy()
      view.unmount()
    }
    expect(api.createEncounter).not.toHaveBeenCalled()
    expect(api.createRecord).not.toHaveBeenCalled()
  })

  it('shows a refused part at its section, as the contract names only the part', async () => {
    api.createConsultation.mockRejectedValueOnce(new HidApiError(400, 'One or more request fields are invalid.', {
      code: 'VALIDATION_FAILED', details: [{ field: 'visit', messages: [] }, { field: 'note', messages: [] }, { field: 'diagnoses', messages: [] }],
    }))
    const { save } = await openNew()
    fillAll()
    fireEvent.click(save)
    expect((await screen.findByRole('alert')).textContent).toBe(SAID_FIELDS_REFUSED)
    expect(document.body.textContent).not.toContain('request fields are invalid')
    expect(screen.getByLabelText(labelled('Presenting complaint')).getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByLabelText(labelled('Clinical note')).getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByLabelText(labelled('Diagnosis')).getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Check the type of visit and the presenting complaint.')).toBeTruthy()
    expect(screen.getByText('Check History, Examination, Clinical note and Follow-up.')).toBeTruthy()
    expect(screen.getByText('Check the diagnosis, its code system and its code.')).toBeTruthy()
  })

  it('falls back to today’s separate calls when the route answers 404 (a backend before it), and asks it no more', async () => {
    api.createConsultation.mockRejectedValue(new HidApiError(404, 'Cannot POST', { code: 'API_ROUTE_NOT_FOUND' }))
    api.createRecord.mockRejectedValueOnce(new HidApiError(400, 'One or more request fields are invalid.', {
      code: 'VALIDATION_FAILED', details: [{ field: 'content', messages: ['content must be shorter than or equal to 100000 characters'] }],
    }))
    const { save } = await openNew()
    fillAll()
    fireEvent.click(save)

    expect((await screen.findByRole('alert')).textContent).toBe(SAID_FIELDS_REFUSED)
    expect(api.createEncounter).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID,
      { encounterType: 'virtual', status: 'in_progress', startedAt: expect.any(String), chiefComplaint: 'Cough' }, expect.any(String))
    expect(screen.getByRole('button', { name: 'Save the rest' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save the rest' }))
    expect(await screen.findByRole('heading', { level: 1, name: consultationLabel(ENCOUNTER) })).toBeTruthy()
    expect(api.createConsultation).toHaveBeenCalledTimes(1)
    expect(api.createEncounter).toHaveBeenCalledTimes(1)
    expect(api.createRecord.mock.calls.map(item => [item[3], item[4]])).toEqual([['clinical-notes', NOTE], ['clinical-notes', NOTE], ['diagnoses', DIAGNOSIS]])
    // One access re-check before the first save of the press, not a second one before the visit.
    const checks = api.lookupPatient.mock.invocationCallOrder
    expect(checks.filter(order => order > api.createConsultation.mock.invocationCallOrder[0]! && order < api.createEncounter.mock.invocationCallOrder[0]!)).toHaveLength(0)
  })

  it('on the open visit today, says the complaint typed is not on it, so it is not lost', async () => {
    api.createConsultation.mockImplementation(saved({ chiefComplaint: 'Headache' }))
    let { view, save } = await openNew()
    fill('Presenting complaint', 'Cough')
    fireEvent.click(save)
    expect(await screen.findByText('Saved on the patient’s open visit today. That visit keeps its own presenting complaint, so the one typed here is not on it: Cough. Add it to the note if it is needed.')).toBeTruthy()
    expect(screen.queryByText('Consultation started.')).toBeNull()
    view.unmount()

    api.createConsultation.mockImplementation(saved({ chiefComplaint: 'Cough' }))
    ;({ view, save } = await openNew())
    fill('Presenting complaint', 'Cough')
    fireEvent.click(save)
    expect(await screen.findByText('Saved on the patient’s open visit today.')).toBeTruthy()
  })
})
