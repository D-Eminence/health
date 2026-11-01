import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsultWorkspace, consultStatus } from '../../../ehr-blue/clinical/consult/ConsultWorkspace'
import { BASE, ENCOUNTER_ID, FACILITY_ID, PATIENT_HID, PATIENT_ID, PATIENT_NAME, activePatient, allowedLookup, labelled, patientBanner, renderPage } from './harness'

/**
 * Consultation, the list and "New consultation": the open patient's encounters (today's paging, the access re-check
 * before each read) in the design's table and quick view, and a new encounter with its draft note and diagnosis.
 * Everything is fictional.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), encounter: vi.fn(), createEncounter: vi.fn(), updateEncounter: vi.fn(),
  records: vi.fn(), createRecord: vi.fn(), updateRecord: vi.fn(), updateDiagnosis: vi.fn(), noteRevisions: vi.fn(), addNoteRevision: vi.fn(),
  documents: vi.fn(), documentDownload: vi.fn(), uploadDocument: vi.fn(), reportedHealthProfile: vi.fn(),
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
const SECOND = { ...ENCOUNTER, id: 'e2222222-0000-4000-8000-000000000002', status: 'completed', chiefComplaint: null }
const NEW_ID = 'e1111111-0000-4000-8000-000000000003'
const READ_ONLY = 'Read-only access. This authorization does not include changes; ask the patient to approve a read-and-write request to add or change records.'

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
  api.createEncounter.mockResolvedValue({ ...ENCOUNTER, id: NEW_ID, chiefComplaint: 'Cough' })
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
    expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Record', 'Complaint', 'Status', 'Updated', 'Actions'])
    const link = within(table).getByRole('link', { name: 'e0000000' })
    expect(link.getAttribute('href')).toBe(`/provider/clinical/${ENCOUNTER_ID}`)
    expect(within(table).getByText('Fever for two days')).toBeTruthy()
    expect(within(table).getByText('No complaint recorded')).toBeTruthy()
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
    fireEvent.click(await screen.findByRole('button', { name: 'Quick view e0000000' }))
    const drawer = await screen.findByRole('dialog', { name: 'Record quick view' })
    expect(within(drawer).getByRole('heading', { level: 3, name: 'e0000000' })).toBeTruthy()
    expect(within(drawer).getByText('Outpatient')).toBeTruthy()
    expect(within(drawer).getByText('Fever for two days')).toBeTruthy()
    expect(within(drawer).getByRole('button', { name: 'Open full record' })).toBeTruthy()
    fireEvent.keyDown(drawer, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Record quick view' })).toBeNull())
  })

  it('searches the page shown and says when nothing matches', async () => {
    api.encounters.mockResolvedValue({ items: [ENCOUNTER, SECOND], nextCursor: null })
    open()
    await screen.findByRole('table', { name: 'Consultations' })
    fireEvent.change(screen.getByLabelText('Search Consultation'), { target: { value: 'fever' } })
    expect(screen.getAllByRole('link', { name: /^Open / })).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('Search Consultation'), { target: { value: 'nothing like this' } })
    expect(screen.getByText('No matching records')).toBeTruthy()
    expect(screen.getByText('Change your search.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getAllByRole('link', { name: /^Open / })).toHaveLength(2)
  })

  it('shows today’s empty sentence when the patient has no encounters', async () => {
    api.encounters.mockResolvedValue({ items: [], nextCursor: null })
    open()
    expect(await screen.findByText('No consultations for this patient here yet.')).toBeTruthy()
  })

  it('shows a refused read as an alert', async () => {
    api.encounters.mockRejectedValue(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    open()
    expect((await screen.findByRole('alert')).textContent).toBe('EHR is unavailable.')
  })

  it('after a failed read, Refresh reads the list afresh after the access re-check, and the alert goes', async () => {
    api.encounters.mockRejectedValueOnce(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    open()
    expect((await screen.findByRole('alert')).textContent).toBe('EHR is unavailable.')
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
    const pager = await screen.findByRole('navigation', { name: 'Record pages' })
    expect(within(pager).getByText('Page 1')).toBeTruthy()
    expect((within(pager).getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(pager).getByRole('button', { name: 'Next page' }))
    expect(await within(pager).findByText('Page 2')).toBeTruthy()
    expect(api.encounters).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, { cursor: 'cursor-2', fresh: false })
    expect(api.lookupPatient).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('link', { name: 'e2222222' }).getAttribute('href')).toBe(`/provider/clinical/${SECOND.id}`)

    // A failed page read is an alert; the page shown stays.
    api.encounters.mockRejectedValueOnce(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    fireEvent.click(within(pager).getByRole('button', { name: 'Previous page' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The page could not be loaded. EHR is unavailable.')
    expect(within(pager).getByText('Page 2')).toBeTruthy()

    // Refresh re-reads the page shown; a stale cursor starts again from the newest.
    api.encounters.mockImplementation(async (_f: string, _p: string, page: { cursor?: string }) => {
      if (page.cursor === 'cursor-2') throw new HidApiError(400, 'The cursor is invalid.', { code: 'INVALID_CURSOR' })
      return { items: [ENCOUNTER], nextCursor: 'cursor-2' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('This list changed since it was opened, so it shows the newest entries again.')).toBeTruthy()
    expect(within(screen.getByRole('navigation', { name: 'Record pages' })).getByText('Page 1')).toBeTruthy()
    expect(api.encounters).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, { cursor: 'cursor-2', fresh: true })
    expect(api.encounters).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, { cursor: undefined, fresh: true })
  })

  it('hides the pager when there is one page', async () => {
    open()
    await screen.findByRole('table', { name: 'Consultations' })
    expect(screen.queryByRole('navigation', { name: 'Record pages' })).toBeNull()
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
    expect(await screen.findByText('Write access could not be confirmed, so changes are unavailable. Refresh the page to try again.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New consultation' })).toBeNull()
  })

  it('closes the patient when the access re-check is refused (403)', async () => {
    api.lookupPatient.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'CONSENT_REQUIRED' }))
    open()
    const ended = await screen.findByRole('alert')
    expect(ended.textContent).toContain('Access to this patient ended')
    expect(ended.textContent).toContain('Patient access has ended. Reopen the record through governed access.')
    expect(within(ended).getByRole('link', { name: 'Find a patient' }).getAttribute('href')).toBe('/provider/patients')
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    expect(api.encounters).not.toHaveBeenCalled()
  })

  it('asks for a patient first when none is open', () => {
    staff.activePatient = null
    open()
    expect(screen.getByRole('heading', { level: 1, name: 'Consultation' })).toBeTruthy()
    expect(screen.getByText('Choose a patient first.')).toBeTruthy()
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
      // The list is not read on the way.
      expect(api.encounters).not.toHaveBeenCalled()
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

  it('shows the read-only emergency notice for an emergency patient, and nothing to create', () => {
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
    expect(within(context).getByText('Penicillin (told us by the patient, not checked by a clinician).')).toBeTruthy()
    expect(api.reportedHealthProfile).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, expect.any(AbortSignal))
    expect(screen.getByText('The note saves as a draft. Sign it on the consultation’s page.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back to list' })).toBeTruthy()
  })

  it('says no allergies are recorded when the patient reported none', async () => {
    await openNew()
    const context = await screen.findByRole('region', { name: 'Allergies' })
    expect(within(context).getByText('None recorded. Confirm with the patient.')).toBeTruthy()
  })

  it('says nothing about allergies when the read is refused, not served or unreadable, as today', async () => {
    for (const failure of [
      new HidApiError(403, 'Forbidden', { code: 'FORBIDDEN' }),
      new HidApiError(404, 'Not found', { code: 'NOT_FOUND' }),
      new TypeError('The answer could not be read.'),
    ]) {
      api.reportedHealthProfile.mockRejectedValueOnce(failure)
      const view = open('/new')
      expect(await screen.findByRole('button', { name: 'Start consultation' })).toBeTruthy()
      await waitFor(() => expect(api.reportedHealthProfile).toHaveBeenCalled())
      await act(async () => {})
      expect(within(patientBanner()).getByText(PATIENT_NAME)).toBeTruthy()
      // A section shows only when it has something to say.
      expect(screen.queryByRole('region', { name: 'Allergies' })).toBeNull()
      expect(screen.queryByText(/None recorded|couldn’t be loaded/)).toBeNull()
      view.unmount()
      api.reportedHealthProfile.mockClear()
    }
  })

  it('says the allergies could not be loaded when the service fails to answer', async () => {
    api.reportedHealthProfile.mockRejectedValue(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    await openNew()
    const context = await screen.findByRole('region', { name: 'Allergies' })
    expect(within(context).getByText('What the patient told us couldn’t be loaded. Confirm with the patient.')).toBeTruthy()
    expect(screen.queryByText(/None recorded/)).toBeNull()
  })

  it('reads no allergies and says nothing about them without ehr.note.read', async () => {
    staff.permissions = ALL.filter(permission => permission !== 'ehr.note.read')
    await openNew()
    await act(async () => {})
    expect(within(patientBanner()).getByText(PATIENT_NAME)).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Allergies' })).toBeNull()
    expect(api.reportedHealthProfile).not.toHaveBeenCalled()
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

    expect(await screen.findByRole('heading', { level: 1, name: 'Consultation e1111111' })).toBeTruthy()
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
      expect(await screen.findByRole('heading', { level: 1, name: 'Consultation e1111111' })).toBeTruthy()
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
    expect(screen.getByRole('heading', { level: 1, name: 'Consultation e1111111' })).toBeTruthy()
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
    expect(alert.textContent).toBe('One or more request fields are invalid. Content must be shorter than or equal to 100000 characters.')
    expect(screen.getByLabelText(labelled('Clinical note')).getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Consultation started. Outpatient · Cough. Save again to add the rest to it.')).toBeTruthy()
    expect(screen.queryByLabelText(labelled('Presenting complaint'))).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Save the rest' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Consultation e1111111' })).toBeTruthy()
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

    expect((await screen.findByRole('alert')).textContent).toBe('One or more request fields are invalid. Code must be shorter than or equal to 100 characters.')
    expect(screen.getByLabelText(labelled('Code')).getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('Consultation started. Outpatient · Cough. The draft note is saved; change it from the consultation’s page. Save again to add the rest to it.')).toBeTruthy()
    // The saved note's fields are gone, so nothing typed there can be lost or sent as a second note.
    for (const label of ['History', 'Examination', 'Clinical note', 'Follow-up']) expect(screen.queryByLabelText(labelled(label))).toBeNull()

    fill('Code', 'J06.9')
    fireEvent.click(screen.getByRole('button', { name: 'Save the rest' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Consultation e1111111' })).toBeTruthy()
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
    expect((await screen.findByRole('alert')).textContent).toBe('One or more request fields are invalid. Chief complaint should not be empty.')
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
    expect(ended.textContent).toContain('Patient access has ended. Reopen the record through governed access.')
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    expect(api.createEncounter).not.toHaveBeenCalled()
  })
})
