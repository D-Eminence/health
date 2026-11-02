import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NursingWorkspace, nursingStatus } from '../../../ehr-blue/clinical/nursing/NursingWorkspace'
import { ENCOUNTER_ID, FACILITY_ID, PATIENT_HID, PATIENT_ID, PATIENT_NAME, activePatient, allowedLookup, labelled, patientBanner, renderPage } from './harness'

/**
 * Nursing observations: today's clinical notes of type "Nursing observation" (the design's category as the title,
 * details and units as the content) on the open patient's encounters, in the design's list, create page and record
 * page, where "Amend observation" is today's note revision, "Mark entered in error" sits behind "More actions" (the
 * owner's decision) and the history lists the encounter's records in the other workspaces. Everything is fictional.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), encounter: vi.fn(), records: vi.fn(), createRecord: vi.fn(),
  noteRevisions: vi.fn(), addNoteRevision: vi.fn(), updateRecord: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true) }))

vi.mock('../../../staff/api', async () => ({ staffApi: api, isAllowedPatientLookup: (await import('./harness')).isAllowedPatientLookup }))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})

const ALL = ['ehr.encounter.read', 'ehr.vital.read', 'ehr.note.read', 'ehr.note.write']
const ENCOUNTER = {
  id: ENCOUNTER_ID, patientId: PATIENT_ID, facilityId: FACILITY_ID, encounterType: 'inpatient', status: 'in_progress',
  startedAt: '2026-10-30T08:00:00.000Z', chiefComplaint: 'Observation', rowVersion: 1,
}
const NOTE_ID = 'c0000000-0000-4000-8000-000000000001'
const NEW_ID = 'c1111111-0000-4000-8000-000000000002'
const NOTE = {
  id: NOTE_ID, patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, facilityId: FACILITY_ID, createdAt: '2026-10-30T09:00:00.000Z',
  noteType: 'Nursing observation', title: 'Vitals', status: 'draft', rowVersion: '2',
}
const CONSULTATION = { ...NOTE, id: 'c2222222-0000-4000-8000-000000000003', noteType: 'Consultation', title: 'Consultation note' }
const FIRST = { id: 'revision-1', revisionNo: 1, content: 'Fictional vitals observation\n\nUnits / dose: demo', changeReason: 'Initial draft', createdAt: '2026-10-30T09:00:00.000Z' }
const READ_ONLY = 'You can view this record but not change it.'
const RECORD = `/${ENCOUNTER_ID}~${NOTE_ID}`
const VITAL_ID = 'f0000000-0000-4000-8000-000000000001'
const LAB_ID = 'b0000000-0000-4000-8000-000000000001'
const PRESCRIPTION_ID = 'd0000000-0000-4000-8000-000000000001'
const OTHER_ENCOUNTER_ID = 'e2222222-0000-4000-8000-000000000002'
const VITAL = { id: VITAL_ID, patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, facilityId: FACILITY_ID, createdAt: '2026-10-30T08:05:00.000Z', systolicMmhg: 120, diastolicMmhg: 80, rowVersion: '1' }
const LAB = { id: LAB_ID, patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T08:30:00.000Z', testDisplay: 'Malaria parasite test', status: 'active' }
const PRESCRIPTION = { id: PRESCRIPTION_ID, patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, createdAt: '2026-10-30T08:40:00.000Z', medicationDisplay: 'Paracetamol 500 mg', status: 'draft' }

let notes: unknown[]
let revisions: unknown[]
/** The encounter's records in the other workspaces, by record kind; none unless a test gives some. */
let others: Record<string, unknown[]>

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
  notes = [NOTE, CONSULTATION]
  revisions = [FIRST]
  others = {}
  api.lookupPatient.mockResolvedValue(allowedLookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounters.mockResolvedValue({ items: [ENCOUNTER], nextCursor: null })
  api.encounter.mockImplementation(async (_f: string, _p: string, id: string) => ({ ...ENCOUNTER, id }))
  api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string) => ({ items: kind === 'clinical-notes' ? notes : others[kind] ?? [], nextCursor: null }))
  api.noteRevisions.mockImplementation(async () => revisions)
  api.createRecord.mockImplementation(async (_f: string, _p: string, encounterId: string, _kind: string, body: { content: string }) => {
    const saved = { ...NOTE, ...body, id: NEW_ID, encounterId }
    notes = [saved, ...notes]
    revisions = [{ ...FIRST, content: body.content }]
    return saved
  })
  api.addNoteRevision.mockImplementation(async (_f: string, _p: string, _e: string, _n: string, input: { content: string; changeReason: string }) => {
    const revision = { id: 'revision-2', revisionNo: 2, content: input.content, changeReason: input.changeReason, createdAt: '2026-10-30T10:00:00.000Z' }
    revisions = [...revisions, revision]
    notes = [{ ...NOTE, rowVersion: '3' }]
    return revision
  })
  api.updateRecord.mockImplementation(async (_f: string, _p: string, _e: string, _k: string, _n: string, input: { status: string }) => {
    const changed = { ...NOTE, status: input.status, rowVersion: '3' }
    notes = [changed]
    return changed
  })
})

function open(rest = '') {
  return renderPage(<NursingWorkspace />, 'nursing', rest)
}

function type(scope: HTMLElement, label: string, value: string) {
  fireEvent.change(within(scope).getByLabelText(labelled(label)), { target: { value } })
}

function control(scope: HTMLElement, label: string) {
  return within(scope).getByLabelText(labelled(label)) as HTMLInputElement
}

function described(element: Element) {
  return (element.getAttribute('aria-describedby') ?? '').split(' ').map(id => document.getElementById(id)?.textContent ?? '').join(' ')
}

describe('Nursing observations list', () => {
  it('is live: every part runs on today’s clinical notes', () => {
    expect(nursingStatus).toBe('live')
  })

  it('shows the loading state, then the patient’s nursing observations only, after the access re-check', async () => {
    const page = deferred<{ items: unknown[]; nextCursor: null }>()
    api.encounters.mockReturnValueOnce(page.promise)
    open()
    expect(screen.getByRole('heading', { level: 1, name: 'Nursing observations' })).toBeTruthy()
    expect(await screen.findByText('Loading records…')).toBeTruthy()
    await act(async () => page.resolve({ items: [ENCOUNTER], nextCursor: null }))

    const table = await screen.findByRole('table', { name: 'Nursing observations' })
    const links = within(table).getAllByRole('link', { name: /^c/ })
    expect(links.map(link => link.textContent)).toEqual(['c0000000'])
    expect(links[0]!.getAttribute('href')).toBe(`/provider/nursing/${ENCOUNTER_ID}~${NOTE_ID}`)
    // One patient's chart: the patient is named once, in the banner, not on each row.
    expect(within(table).queryByText(PATIENT_NAME)).toBeNull()
    expect(within(patientBanner()).getByText(PATIENT_NAME)).toBeTruthy()
    expect(within(table).getByText('Draft')).toBeTruthy()
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.encounters.mock.invocationCallOrder[0]!)
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes')
    // A note's content is read only when it is opened, as today.
    expect(api.noteRevisions).not.toHaveBeenCalled()
    expect(window.location.href).not.toContain(PATIENT_HID)
  })

  it('names the tab after the workspace, and repeats each record’s own id under its link, not its visit’s', async () => {
    document.title = ''
    open()
    const table = await screen.findByRole('table', { name: 'Nursing observations' })
    expect(document.title).toBe('Nursing observations · Health ID EHR')
    expect(within(table).getAllByText('c0000000').map(element => element.tagName)).toEqual(['A', 'SPAN'])
    expect(within(table).queryByText('e0000000')).toBeNull()
  })

  it('opens the record quick view, and Escape closes it', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Quick view c0000000' }))
    const drawer = await screen.findByRole('dialog', { name: 'Record quick view' })
    expect(within(drawer).getByText('Vitals')).toBeTruthy()
    expect(within(drawer).getByText('e0000000')).toBeTruthy()
    expect(within(drawer).getByRole('button', { name: 'Open full record' }).tagName).toBe('BUTTON')
    fireEvent.keyDown(drawer, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Record quick view' })).toBeNull())
  })

  it('has the empty states and shows refused reads', async () => {
    notes = [CONSULTATION]
    let view = open()
    expect(await screen.findByText('Nothing recorded yet.')).toBeTruthy()
    view.unmount()
    api.encounters.mockResolvedValue({ items: [], nextCursor: null })
    view = open()
    expect(await screen.findByText('No consultations for this patient here yet. Start one first.')).toBeTruthy()
    view.unmount()
    api.encounters.mockRejectedValue(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    view = open()
    expect((await screen.findByRole('alert')).textContent).toBe('EHR is unavailable.')
    view.unmount()
    api.encounters.mockResolvedValue({ items: [ENCOUNTER], nextCursor: null })
    api.records.mockRejectedValue(new HidApiError(403, 'This role may not read notes.', { code: 'FORBIDDEN' }))
    open()
    expect((await screen.findByRole('alert')).textContent).toBe('This role may not read notes.')
  })

  it('says so, and reads nothing, when the role may not read notes', async () => {
    staff.permissions = ['ehr.vital.read']
    open()
    expect(screen.getByText('Your role at this facility can’t open visit records. Ask your facility administrator.')).toBeTruthy()
    await act(async () => {})
    expect(api.encounters).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'New observation' })).toBeNull()
  })

  it('shows the read-only notice and nothing to create when the grant does not allow changes', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    open()
    expect(await screen.findByText(READ_ONLY)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New observation' })).toBeNull()
  })

  it('closes the patient when the access re-check is refused (404)', async () => {
    api.lookupPatient.mockRejectedValue(new HidApiError(404, 'Not found', { code: 'NOT_FOUND' }))
    open()
    const ended = await screen.findByRole('alert')
    expect(ended.textContent).toContain('Access to this patient ended')
    expect(ended.textContent).toContain('Open the patient again to keep working.')
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
  })

  it('gives an emergency patient the read-only gate, and asks for a patient when none is open', () => {
    staff.activePatient = activePatient('emergency')
    const view = open()
    expect(screen.getByText('Emergency access shows the emergency summary only')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New observation' })).toBeNull()
    expect(api.records).not.toHaveBeenCalled()
    view.unmount()
    staff.activePatient = null
    open()
    expect(screen.getByText('Choose a patient first.')).toBeTruthy()
  })

  it('opens "New nursing observations" from New observation', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'New observation' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'New nursing observations' })).toBeTruthy()
  })
})

describe('New nursing observations', () => {
  async function openNew() {
    open('/new')
    const save = await screen.findByRole('button', { name: 'Save observation' })
    return save.closest('form')!
  }

  it('saves the observation as today’s draft clinical note after the access re-check, then opens it', async () => {
    const form = await openNew()
    // Only the encounters are read for the "Visit"; no notes.
    expect(api.encounters).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, { cursor: undefined, fresh: false })
    expect(api.records).not.toHaveBeenCalled()
    // The open patient is the banner (the one-option Patient select is gone).
    expect(screen.queryByLabelText(labelled('Patient'))).toBeNull()
    expect(within(patientBanner()).getByText(PATIENT_NAME)).toBeTruthy()
    const category = control(form, 'Category') as unknown as HTMLSelectElement
    expect(Array.from(category.options).map(option => option.textContent)).toEqual(['Select…', 'Vitals', 'Medication administration', 'Handover', 'Care task'])
    type(form, 'Visit', ENCOUNTER_ID)
    type(form, 'Category', 'Medication administration')
    type(form, 'What you observed or gave', 'Gave paracetamol by mouth')
    type(form, 'Dose and unit, if you gave something', '500 mg')
    // Enter in a field submits the form: the button is its submit button.
    fireEvent.submit(form)

    expect(await screen.findByText('Saved.')).toBeTruthy()
    expect(api.createRecord).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', {
      noteType: 'Nursing observation', title: 'Medication administration', status: 'draft', content: 'Gave paracetamol by mouth\n\nUnits / dose: 500 mg',
    }, expect.any(String))
    expect(api.lookupPatient.mock.invocationCallOrder.at(-2)!).toBeLessThan(api.createRecord.mock.invocationCallOrder[0]!)
    expect(screen.getByRole('heading', { level: 1, name: 'c1111111' })).toBeTruthy()
    const saved = screen.getByRole('heading', { level: 2, name: 'Saved record' }).closest('section')!
    expect(await within(saved).findByText('Gave paracetamol by mouth')).toBeTruthy()
    expect(within(saved).getByText('500 mg')).toBeTruthy()
  })

  it('checks the required fields, and shows a server refusal at its field; a retry reuses the key', async () => {
    const form = await openNew()
    fireEvent.click(within(form).getByRole('button', { name: 'Save observation' }))
    expect(within(form).getAllByText('Complete this field.')).toHaveLength(3)
    expect(document.activeElement).toBe(control(form, 'Visit'))
    expect(api.createRecord).not.toHaveBeenCalled()

    api.createRecord.mockRejectedValueOnce(new HidApiError(400, 'One or more request fields are invalid.', {
      code: 'VALIDATION_FAILED', details: [{ field: 'title', messages: ['title must be shorter than or equal to 240 characters'] }],
    }))
    type(form, 'Visit', ENCOUNTER_ID)
    type(form, 'Category', 'Handover')
    type(form, 'What you observed or gave', 'Settled overnight')
    fireEvent.click(within(form).getByRole('button', { name: 'Save observation' }))
    expect((await within(form).findByRole('alert')).textContent).toBe('One or more request fields are invalid. Title must be shorter than or equal to 240 characters.')
    expect(described(control(form, 'Category'))).toContain('Title must be shorter than or equal to 240 characters.')
    type(form, 'Category', 'Handover')
    fireEvent.click(within(form).getByRole('button', { name: 'Save observation' }))
    await screen.findByText('Saved.')
    expect(api.createRecord.mock.calls[1]![5]).toBe(api.createRecord.mock.calls[0]![5])
  })

  it('offers no form under a read-only grant, nor without note write permission', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    const view = open('/new')
    expect(await screen.findByText(READ_ONLY)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save observation' })).toBeNull()
    view.unmount()
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
    staff.permissions = ['ehr.vital.read', 'ehr.note.read']
    open('/new')
    expect((await screen.findByRole('alert')).textContent).toBe('Your role can’t add this record.')
    expect(screen.queryByRole('button', { name: 'Save observation' })).toBeNull()
  })
})

describe('Nursing observation record', () => {
  async function openRecord() {
    open(RECORD)
    expect(await screen.findByRole('heading', { level: 1, name: 'c0000000' })).toBeTruthy()
  }

  function saved() {
    return screen.getByRole('heading', { level: 2, name: 'Saved record' }).closest('section')!
  }

  async function amendForm() {
    fireEvent.click(await screen.findByRole('button', { name: 'Amend observation' }))
    return screen.getAllByRole('button', { name: 'Amend observation' }).at(-1)!.closest('form')!
  }

  it('shows the saved record with the note’s latest revision, read when it is opened', async () => {
    const read = deferred<unknown[]>()
    api.noteRevisions.mockReturnValueOnce(read.promise)
    await openRecord()
    expect(within(saved()).getByText('Loading note revisions…')).toBeTruthy()
    await act(async () => read.resolve([FIRST]))
    const card = saved()
    expect(within(card).getByText('e0000000')).toBeTruthy()
    expect(within(card).getByText('Vitals')).toBeTruthy()
    expect(within(card).getByText('Fictional vitals observation')).toBeTruthy()
    expect(within(card).getByText('demo')).toBeTruthy()
    expect(api.noteRevisions).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, NOTE_ID)
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.encounter.mock.invocationCallOrder[0]!)
    expect(within(patientBanner()).getByText(PATIENT_NAME)).toBeTruthy()
    expect(within(patientBanner()).getByText(new RegExp(PATIENT_HID))).toBeTruthy()
  })

  it('says a consultation note is not found here', async () => {
    open(`/${ENCOUNTER_ID}~${CONSULTATION.id}`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Record not found' })).toBeTruthy()
    expect(screen.getByText('This record doesn’t exist, or it belongs to another facility.')).toBeTruthy()
  })

  it('amends as today’s note revision, after the access re-check, and keeps what it replaced', async () => {
    await openRecord()
    const form = await amendForm()
    type(form, 'Corrected record', 'Corrected vitals observation')
    type(form, 'Reason', 'Wrong patient bed')
    api.lookupPatient.mockClear()
    fireEvent.submit(form)

    expect(await screen.findByText('A new note revision was recorded.')).toBeTruthy()
    expect(api.addNoteRevision).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, NOTE_ID, {
      expectedRowVersion: 2, changeReason: 'Wrong patient bed', content: 'Corrected vitals observation\n\nUnits / dose: demo',
    }, expect.any(String))
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.addNoteRevision.mock.invocationCallOrder[0]!)
    expect(api.records).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', { fresh: true })
    expect(await within(saved()).findByText('Corrected vitals observation')).toBeTruthy()
    const versions = screen.getByRole('heading', { level: 2, name: 'Earlier versions' }).closest('section')!
    expect(within(versions).getByText(/^30 Oct 2026, \d\d:\d\d · draft · Wrong patient bed$/)).toBeTruthy()
    expect(within(versions).getByText('Fictional vitals observation')).toBeTruthy()
    expect(document.activeElement?.textContent).toBe('Available actions')
  })

  it('refuses as today: revised content and a reason of three characters; a refusal shows in the form and a retry reuses the key', async () => {
    await openRecord()
    const form = await amendForm()
    fireEvent.click(within(form).getByRole('button', { name: 'Amend observation' }))
    expect(within(form).getByText('Enter the revised note content.')).toBeTruthy()
    expect(within(form).getByText('Give a reason of at least 3 characters.')).toBeTruthy()
    expect(document.activeElement).toBe(control(form, 'Corrected record'))

    api.addNoteRevision.mockRejectedValueOnce(new HidApiError(412, 'The note changed since it was loaded.', { code: 'ROW_VERSION_MISMATCH' }))
    type(form, 'Corrected record', 'Corrected vitals observation')
    type(form, 'Reason', 'Wrong patient bed')
    fireEvent.click(within(form).getByRole('button', { name: 'Amend observation' }))
    expect((await within(form).findByRole('alert')).textContent).toBe('The note changed since it was loaded.')
    fireEvent.click(within(form).getByRole('button', { name: 'Amend observation' }))
    await screen.findByText('A new note revision was recorded.')
    expect(api.addNoteRevision.mock.calls[1]![5]).toBe(api.addNoteRevision.mock.calls[0]![5])
  })

  it('offers no amendment when the content cannot be read, under a read-only grant, or once entered in error', async () => {
    api.noteRevisions.mockRejectedValue(new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' }))
    let view = open(RECORD)
    expect((await screen.findByRole('alert')).textContent).toBe('EHR is unavailable.')
    const none = screen.getByText('Nothing more to do here.')
    expect(none.className).toBe('hid-ehr-clinical-note')
    expect(screen.queryByRole('button', { name: 'Mark entered in error' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull()
    view.unmount()
    api.noteRevisions.mockImplementation(async () => revisions)
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    view = open(RECORD)
    expect(await screen.findByText(READ_ONLY)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Amend observation' })).toBeNull()
    view.unmount()
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
    notes = [{ ...NOTE, status: 'entered_in_error' }]
    open(RECORD)
    expect(await screen.findByText('Entered in error')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Amend observation' })).toBeNull()
  })

  it('closes the patient when the re-check before an amendment is refused', async () => {
    await openRecord()
    const form = await amendForm()
    type(form, 'Corrected record', 'Corrected vitals observation')
    type(form, 'Reason', 'Wrong patient bed')
    api.lookupPatient.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'CONSENT_REQUIRED' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Amend observation' }))
    expect(await screen.findByText('Access to this patient ended')).toBeTruthy()
    expect(api.addNoteRevision).not.toHaveBeenCalled()
  })

  function actions() {
    return screen.getByRole('heading', { level: 2, name: 'Available actions' }).closest('section')!
  }

  /** The design's actions shown in the card (not "More actions"). */
  function actionNames() {
    return within(actions()).queryAllByRole('button', { expanded: false }).filter(button => !button.hasAttribute('aria-haspopup')).map(button => button.textContent)
  }

  function moreButton() {
    return within(actions()).queryByRole('button', { name: /^More actions/ })
  }

  /** The items behind "More actions": opens the menu, reads them, and closes it again with Escape. */
  function moreNames() {
    const button = moreButton()
    if (!button) return []
    fireEvent.click(button)
    const menu = within(actions()).getByRole('menu', { name: 'More actions' })
    const names = within(menu).getAllByRole('menuitem').map(item => item.textContent)
    fireEvent.keyDown(menu, { key: 'Escape' })
    return names
  }

  /** Opens one of the note's status changes (from "More actions" when it is there) and gives its reason: its form and its submit button. */
  async function statusForm(label: string, reason = 'Charted on the wrong bed') {
    if (label === 'Mark entered in error') {
      fireEvent.click(await within(actions()).findByRole('button', { name: 'More actions' }))
      fireEvent.click(within(actions()).getByRole('menuitem', { name: label }))
    } else {
      fireEvent.click(await within(actions()).findByRole('button', { name: label, expanded: false }))
    }
    const submit = within(actions()).getAllByRole('button', { name: label }).find(button => button.getAttribute('type') === 'submit')!
    const form = submit.closest('form')!
    if (reason) type(form, 'Reason for change', reason)
    return { form, submit }
  }

  function dialog() {
    return screen.getByRole('alertdialog')
  }

  it('offers today’s note status changes by status, next to the amendment, once the content has been read', async () => {
    const read = deferred<unknown[]>()
    api.noteRevisions.mockReturnValueOnce(read.promise)
    let view = open(RECORD)
    expect(await screen.findByText('Loading note revisions…')).toBeTruthy()
    expect(within(actions()).queryByRole('button', { name: 'Sign note' })).toBeNull()
    expect(moreButton()).toBeNull()
    await act(async () => read.resolve([FIRST]))
    expect(actionNames()).toEqual(['Amend observation', 'Sign note'])
    expect(moreNames()).toEqual(['Mark entered in error'])
    view.unmount()

    for (const status of ['signed', 'amended']) {
      notes = [{ ...NOTE, status }]
      view = open(RECORD)
      await screen.findByRole('button', { name: 'More actions' })
      expect(actionNames()).toEqual(['Amend observation'])
      expect(moreNames()).toEqual(['Mark entered in error'])
      view.unmount()
    }

    // As today: no status change for a note whose revisions hold no content, nor without note write permission.
    notes = [NOTE]
    revisions = []
    view = open(RECORD)
    await screen.findByRole('heading', { level: 1, name: 'c0000000' })
    expect(await within(saved()).findByText('No note content is available.')).toBeTruthy()
    expect(actionNames()).toEqual(['Amend observation'])
    expect(moreButton()).toBeNull()
    view.unmount()
    revisions = [FIRST]
    staff.permissions = ALL.filter(permission => permission !== 'ehr.note.write')
    await openRecord()
    expect(await within(saved()).findByText('Fictional vitals observation')).toBeTruthy()
    expect(actionNames()).toEqual([])
    expect(moreButton()).toBeNull()
    expect(within(actions()).getByText('Nothing more to do here.')).toBeTruthy()
  })

  it('signs a draft only after SIGN is typed, with a reason, after the access re-check', async () => {
    await openRecord()
    const { form, submit } = await statusForm('Sign note', '')
    fireEvent.click(submit)
    expect(within(form).getByText('Give a reason of at least 3 characters.')).toBeTruthy()
    type(form, 'Reason for change', 'ok')
    fireEvent.click(submit)
    expect(within(form).getByText('Give a reason of at least 3 characters.')).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()

    type(form, 'Reason for change', 'Reviewed with the nurse in charge')
    fireEvent.click(submit)
    expect(within(dialog()).getByRole('heading', { name: 'Sign note?' })).toBeTruthy()
    expect(within(dialog()).getByText('Check the details first. This changes the saved record; the change is kept in its history.')).toBeTruthy()
    const confirm = within(dialog()).getByRole('button', { name: 'Sign note' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.change(within(dialog()).getByLabelText('Type SIGN to confirm'), { target: { value: 'sign' } })
    expect(confirm.disabled).toBe(true)
    fireEvent.change(within(dialog()).getByLabelText('Type SIGN to confirm'), { target: { value: 'SIGN' } })
    expect(confirm.disabled).toBe(false)
    api.lookupPatient.mockClear()
    fireEvent.click(confirm)

    expect(await screen.findByText('Clinical note status updated.')).toBeTruthy()
    expect(api.updateRecord).toHaveBeenCalledTimes(1)
    expect(api.updateRecord.mock.calls[0]).toEqual([FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', NOTE_ID,
      { expectedRowVersion: 2, changeReason: 'Reviewed with the nurse in charge', status: 'signed' }])
    expect(api.lookupPatient).toHaveBeenCalledTimes(1)
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.updateRecord.mock.invocationCallOrder[0]!)
    expect(api.records).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', { fresh: true })
    await waitFor(() => expect(actionNames()).toEqual(['Amend observation']))
    expect(document.activeElement?.textContent).toBe('Available actions')
    expect(within(saved()).getByText('Fictional vitals observation')).toBeTruthy()
    expect(moreNames()).toEqual(['Mark entered in error'])
  })

  it('marks a note entered in error after the plain decision dialog; Cancel keeps the form and its reason', async () => {
    notes = [{ ...NOTE, status: 'signed' }]
    await openRecord()
    const { form, submit } = await statusForm('Mark entered in error')
    fireEvent.click(submit)
    expect(within(dialog()).getByRole('heading', { name: 'Mark entered in error?' })).toBeTruthy()
    expect(within(dialog()).queryByLabelText(/to confirm/)).toBeNull()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(api.updateRecord).not.toHaveBeenCalled()
    expect(form.isConnected).toBe(true)
    expect(control(form, 'Reason for change').value).toBe('Charted on the wrong bed')
    await waitFor(() => expect(submit.getAttribute('aria-disabled')).toBeNull())

    fireEvent.click(submit)
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Mark entered in error' }))
    expect(await screen.findByText('Clinical note status updated.')).toBeTruthy()
    expect(api.updateRecord.mock.calls[0]).toEqual([FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'clinical-notes', NOTE_ID,
      { expectedRowVersion: 2, changeReason: 'Charted on the wrong bed', status: 'entered_in_error' }])
    expect(await within(actions()).findByText('Nothing more to do here.')).toBeTruthy()
    expect(moreButton()).toBeNull()
    expect(screen.getAllByText('Entered in error').length).toBeGreaterThan(0)
  })

  it('"Cancel" closes the "Mark entered in error" form More actions opened, changing nothing, with focus back on the menu button', async () => {
    notes = [{ ...NOTE, status: 'signed' }]
    await openRecord()
    const { form } = await statusForm('Mark entered in error')
    const cancel = within(form).getByRole('button', { name: 'Cancel' })
    expect(cancel.getAttribute('type')).toBe('button')
    act(() => { cancel.focus() })
    fireEvent.click(cancel)
    expect(form.isConnected).toBe(false)
    expect(within(actions()).queryByLabelText(labelled('Reason for change'))).toBeNull()
    expect(document.activeElement).toBe(moreButton())
    expect(api.updateRecord).not.toHaveBeenCalled()
    // "Amend observation", the design's own action, toggles with its button and carries no "Cancel".
    fireEvent.click(within(actions()).getByRole('button', { name: 'Amend observation', expanded: false }))
    expect(within(actions()).queryByRole('button', { name: 'Cancel' })).toBeNull()
  })

  it('shows a refused status change in its form, a 412 included, as today, and reads nothing again', async () => {
    api.updateRecord.mockRejectedValueOnce(new HidApiError(412, 'The record changed since it was read.', { code: 'ROW_VERSION_MISMATCH' }))
    await openRecord()
    const { form, submit } = await statusForm('Mark entered in error')
    const reads = api.records.mock.calls.length
    fireEvent.click(submit)
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Mark entered in error' }))
    expect((await within(form).findByRole('alert')).textContent).toBe('The record changed since it was read.')
    expect(api.records.mock.calls.length).toBe(reads)
    expect(screen.queryByText('Clinical note status updated.')).toBeNull()

    api.updateRecord.mockRejectedValueOnce('no answer')
    fireEvent.click(submit)
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Mark entered in error' }))
    await waitFor(() => expect(within(form).getByRole('alert').textContent).toBe('Status could not be changed.'))
  })

  it('asks for a reload when the note’s version cannot be sent back, and sends nothing', async () => {
    notes = [{ ...NOTE, rowVersion: null }]
    await openRecord()
    const { form, submit } = await statusForm('Sign note')
    fireEvent.click(submit)
    expect((await within(form).findByRole('alert')).textContent).toBe('Reload the record before changing its status.')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(api.updateRecord).not.toHaveBeenCalled()
  })

  it('closes the patient when the re-check before a status change is refused', async () => {
    await openRecord()
    const { submit } = await statusForm('Sign note')
    fireEvent.click(submit)
    fireEvent.change(within(dialog()).getByLabelText('Type SIGN to confirm'), { target: { value: 'SIGN' } })
    api.lookupPatient.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'CONSENT_REQUIRED' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Sign note' }))
    expect(await screen.findByText('Access to this patient ended')).toBeTruthy()
    expect(api.updateRecord).not.toHaveBeenCalled()
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
  })

  it('offers no status change under a read-only grant', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    await openRecord()
    expect(await screen.findByText(READ_ONLY)).toBeTruthy()
    expect(within(actions()).queryByRole('button', { name: 'Sign note' })).toBeNull()
    expect(within(actions()).queryByRole('button', { name: 'Mark entered in error' })).toBeNull()
    expect(moreButton()).toBeNull()
  })

  it('gives an emergency patient the read-only gate', () => {
    staff.activePatient = activePatient('emergency')
    open(RECORD)
    expect(screen.getByText('Emergency access shows the emergency summary only')).toBeTruthy()
    expect(api.encounter).not.toHaveBeenCalled()
    expect(api.records).not.toHaveBeenCalled()
  })

  it('audit 11: Available actions shows the design’s actions; "Mark entered in error" is behind a More actions menu at the end of the card', async () => {
    await openRecord()
    const more = await within(actions()).findByRole('button', { name: 'More actions' })
    expect(actionNames()).toEqual(['Amend observation', 'Sign note'])
    // A real menu button, after the design's action list.
    expect(more.tagName).toBe('BUTTON')
    expect(more.getAttribute('type')).toBe('button')
    expect(more.getAttribute('aria-haspopup')).toBe('menu')
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(more.parentElement?.previousElementSibling?.className).toBe('hid-ehr-clinical-action-list')
    expect(within(actions()).queryByRole('menu')).toBeNull()

    fireEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    const menu = within(actions()).getByRole('menu', { name: 'More actions' })
    expect(more.getAttribute('aria-controls')).toBe(menu.id)
    const item = within(menu).getByRole('menuitem', { name: 'Mark entered in error' })
    expect(document.activeElement).toBe(item)

    // Choosing it closes the menu, gives the button focus back and opens today's form: its reason, its submit.
    fireEvent.click(item)
    expect(within(actions()).queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(more)
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(more.textContent).toContain('Mark entered in error open')
    const submit = within(actions()).getAllByRole('button', { name: 'Mark entered in error' }).find(button => button.getAttribute('type') === 'submit')!
    const form = submit.closest('form')!
    expect(control(form, 'Reason for change')).toBeTruthy()
    // Its form opens under the menu, in the same card.
    expect(form.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()

    // Choosing it again keeps its form open with what was typed, as the consultation page's menu does.
    type(form, 'Reason for change', 'Charted on the wrong bed')
    fireEvent.click(more)
    fireEvent.click(within(actions()).getByRole('menuitem', { name: 'Mark entered in error' }))
    expect(form.isConnected).toBe(true)
    expect(control(form, 'Reason for change').value).toBe('Charted on the wrong bed')
    expect(more.textContent).toContain('Mark entered in error open')
    // An action button still closes it, as before.
    fireEvent.click(within(actions()).getByRole('button', { name: 'Amend observation', expanded: false }))
    expect(form.isConnected).toBe(false)
    expect(more.textContent).not.toContain('open')
    expect(api.updateRecord).not.toHaveBeenCalled()
  })

  it('audit 11: the More actions menu works from the keyboard, and Escape or a press outside closes it', async () => {
    await openRecord()
    const more = await within(actions()).findByRole('button', { name: 'More actions' })
    fireEvent.keyDown(more, { key: 'ArrowDown' })
    let menu = within(actions()).getByRole('menu')
    const item = within(menu).getByRole('menuitem', { name: 'Mark entered in error' })
    expect(document.activeElement).toBe(item)
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
      fireEvent.keyDown(menu, { key })
      expect(document.activeElement).toBe(item)
    }
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(within(actions()).queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(more)
    // Nothing was opened or sent.
    expect(within(actions()).queryByLabelText(labelled('Reason for change'))).toBeNull()

    fireEvent.keyDown(more, { key: 'ArrowUp' })
    menu = within(actions()).getByRole('menu')
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Mark entered in error' }))
    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(within(actions()).queryByRole('menu')).toBeNull())
    expect(api.updateRecord).not.toHaveBeenCalled()
  })

  function history() {
    return screen.getByRole('heading', { level: 2, name: 'History' }).closest('section')!
  }

  function historyRows() {
    return within(history()).getAllByRole('listitem').map(row => {
      const link = within(row).queryByRole('link')
      return [link?.textContent ?? row.firstElementChild?.textContent, link?.getAttribute('href') ?? null]
    })
  }

  it('audit 15: the history lists the visit first, then the encounter’s Triage & Vitals, Laboratory and Pharmacy, each a link; never other observations', async () => {
    staff.permissions = [...ALL, 'ehr.lab-request.read', 'ehr.prescription.read']
    const otherObservation = { ...NOTE, id: 'c3333333-0000-4000-8000-000000000004', status: 'signed' }
    notes = [NOTE, otherObservation, CONSULTATION]
    others = {
      // A record of another encounter or patient is never listed here.
      vitals: [VITAL, { ...VITAL, id: 'f9999999-0000-4000-8000-000000000009', encounterId: OTHER_ENCOUNTER_ID }],
      'lab-requests': [LAB, { ...LAB, id: 'b9999999-0000-4000-8000-000000000009', patientId: 'a9999999-0000-4000-8000-000000000009' }],
      prescriptions: [PRESCRIPTION],
    }
    await openRecord()
    await waitFor(() => expect(within(history()).queryByText('Loading records…')).toBeNull())
    expect(historyRows()).toEqual([
      ['Consultation · e0000000', `/provider/clinical/${ENCOUNTER_ID}`],
      ['Triage & Vitals · f0000000', `/provider/triage/${ENCOUNTER_ID}~${VITAL_ID}`],
      ['Laboratory · Malaria parasite test', `/provider/clinical/${ENCOUNTER_ID}/orders/laboratory/${LAB_ID}`],
      ['Pharmacy · Paracetamol 500 mg', `/provider/clinical/${ENCOUNTER_ID}/orders/pharmacy/${PRESCRIPTION_ID}`],
    ])
    const rows = within(history()).getAllByRole('listitem')
    expect(rows.map(row => row.lastElementChild?.textContent)).toEqual(['In progress', 'Final', 'Active', 'Draft'])
    expect(within(history()).queryByText(/c3333333/)).toBeNull()
    // Each kind is read once, as the encounter page reads it: the record's own read is the only notes read.
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'vitals')
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'lab-requests')
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'prescriptions')
    expect(api.records.mock.calls.filter(call => call[3] === 'clinical-notes')).toHaveLength(1)
    expect(window.location.href).not.toContain(PATIENT_HID)
  })

  it('audit 15: each kind is read only by a role that may read it; a read in progress or refused says so in the history', async () => {
    others = { vitals: [VITAL], 'lab-requests': [LAB], prescriptions: [PRESCRIPTION] }
    staff.permissions = ['ehr.note.read', 'ehr.note.write']
    let view = open(RECORD)
    await screen.findByRole('heading', { level: 1, name: 'c0000000' })
    await act(async () => {})
    // Without encounter read the visit is named, not linked; nothing else is read.
    expect(historyRows()).toEqual([['Consultation · e0000000', null]])
    expect(api.records.mock.calls.map(call => call[3])).toEqual(['clinical-notes'])
    view.unmount()

    staff.permissions = [...ALL, 'ehr.lab-request.read', 'ehr.prescription.read']
    const vitalsRead = deferred<{ items: unknown[]; nextCursor: null }>()
    api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string) => {
      if (kind === 'vitals') return vitalsRead.promise
      if (kind === 'lab-requests') throw new HidApiError(503, 'EHR is unavailable.', { code: 'UNAVAILABLE' })
      return { items: kind === 'clinical-notes' ? notes : others[kind] ?? [], nextCursor: null }
    })
    view = open(RECORD)
    await screen.findByRole('heading', { level: 1, name: 'c0000000' })
    expect(await within(history()).findByText('Loading records…')).toBeTruthy()
    await act(async () => vitalsRead.resolve({ items: [VITAL], nextCursor: null }))
    expect(within(history()).queryByText('Loading records…')).toBeNull()
    expect(within(history()).getByRole('alert').textContent).toBe('EHR is unavailable.')
    // The other rows still show, and the record itself is unaffected.
    expect(historyRows().map(row => row[0])).toEqual(['Consultation · e0000000', 'Triage & Vitals · f0000000', 'Pharmacy · Paracetamol 500 mg'])
    expect(within(saved()).getByText('Fictional vitals observation')).toBeTruthy()
    view.unmount()
  })

  it('audit 15: a kind past its first page shows today’s "Record pages" in the history; a cursor EHR no longer accepts starts it again with today’s notice', async () => {
    const OLDER = { ...VITAL, id: 'f3333333-0000-4000-8000-000000000003', createdAt: '2026-10-30T07:00:00.000Z' }
    let refuseCursor = false
    api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string, page?: { cursor?: string; fresh?: boolean }) => {
      if (kind !== 'vitals') return { items: kind === 'clinical-notes' ? notes : others[kind] ?? [], nextCursor: null }
      if (page?.cursor === 'vitals-2') {
        if (refuseCursor) throw new HidApiError(400, 'The cursor is no longer valid.', { code: 'INVALID_CURSOR' })
        return { items: [OLDER], nextCursor: null }
      }
      return { items: [VITAL], nextCursor: 'vitals-2' }
    })
    await openRecord()
    const pages = await within(history()).findByRole('group', { name: 'Triage & Vitals' })
    expect(within(pages).getByRole('navigation', { name: 'Record pages' })).toBeTruthy()
    expect(within(pages).getByText('Page 1')).toBeTruthy()
    expect(historyRows().map(row => row[0])).toEqual(['Consultation · e0000000', 'Triage & Vitals · f0000000'])
    // Only the list that has more than one page shows a pager.
    expect(within(history()).getAllByRole('group')).toEqual([pages])

    // The next page is today's page read (its cursor, not fresh), and its rows replace the first page's.
    fireEvent.click(within(pages).getByRole('button', { name: 'Next page' }))
    expect(await within(history()).findByText('Triage & Vitals · f3333333')).toBeTruthy()
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'vitals', { cursor: 'vitals-2', fresh: false })
    expect(within(pages).getByText('Page 2')).toBeTruthy()
    expect(historyRows()).toContainEqual(['Triage & Vitals · f3333333', `/provider/triage/${ENCOUNTER_ID}~${OLDER.id}`])
    expect(within(history()).queryByText('Triage & Vitals · f0000000')).toBeNull()

    // Back to the first page, then forward with a cursor EHR no longer accepts: the list starts again, saying so.
    fireEvent.click(within(pages).getByRole('button', { name: 'Previous page' }))
    expect(await within(history()).findByText('Triage & Vitals · f0000000')).toBeTruthy()
    refuseCursor = true
    fireEvent.click(within(history()).getByRole('button', { name: 'Next page' }))
    expect(await within(history()).findByText('This list changed since it was opened, so it shows the newest entries again.')).toBeTruthy()
    expect(within(history()).getByText('Triage & Vitals · f0000000')).toBeTruthy()
    expect(api.records).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'vitals', { cursor: undefined, fresh: true })
    // The record itself is unaffected.
    expect(within(saved()).getByText('Fictional vitals observation')).toBeTruthy()
    expect(window.location.href).not.toContain('vitals-2')
  })

  it('audit 15: Laboratory and Pharmacy rows link only for a role that may open Consultation (encounter read)', async () => {
    staff.permissions = ['ehr.note.read', 'ehr.note.write', 'ehr.lab-request.read', 'ehr.prescription.read']
    others = { 'lab-requests': [LAB], prescriptions: [PRESCRIPTION] }
    open(RECORD)
    await screen.findByRole('heading', { level: 1, name: 'c0000000' })
    await waitFor(() => expect(within(history()).queryByText('Loading records…')).toBeNull())
    // Named, not linked: Consultation (where the visit and its orders open) needs encounter read.
    expect(historyRows()).toEqual([
      ['Consultation · e0000000', null],
      ['Laboratory · Malaria parasite test', null],
      ['Pharmacy · Paracetamol 500 mg', null],
    ])
    expect(within(history()).queryByRole('link')).toBeNull()
  })
})
