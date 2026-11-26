import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsultWorkspace } from '../../../ehr-blue/clinical/consult/ConsultWorkspace'
import { NO_CONSENT, OPEN_PATIENT_AGAIN } from '../../../ehr-blue/clinical/consult/encounters'
import { VITALS_RECORDED } from '../../../ehr-blue/clinical/consult/Vitals'
import { TriageWorkspace } from '../../../ehr-blue/clinical/triage/TriageWorkspace'
import {
  EIE_ALREADY, EIE_CHANGED, EIE_DONE, EIE_FAILED, EIE_NOT_FOUND, EIE_NO_ROLE, EIE_UNAVAILABLE, EIE_WARNING, RETRACTED_SINCE, RETRACTED_TEXT, vitalName,
  vitalSummary,
} from '../../../ehr-blue/clinical/triage/vitals'
import { consultationLabel } from '../../../plainLabels'
import { ENCOUNTER_ID, FACILITY_ID, PATIENT_HID, PATIENT_ID, activePatient, allowedLookup, labelled, renderPage } from './harness'

/**
 * EHR-C8b on the blue pages (Novu, hid-system 0142): "Mark as entered in error" for one vitals reading, on its record
 * page in Triage & Vitals and on each row of the consultation's Vitals card. It is offered only to a role that may
 * write vitals, with write access, on a reading not already withdrawn; it asks for the reason and is sent in one press
 * from that form, its warning beside the button and no dialog (release D confirms no entered in error, as C8a and the
 * note's), with the row version, and reads the vitals again with those entered in error, which then show classic's "Entered in error" badge
 * and RETRACTED_TEXT, never struck through (release D keeps classic's vitals display). Every refusal is in plain words,
 * never the service's own text or code. Everything here is fictional.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), encounter: vi.fn(), records: vi.fn(), createRecord: vi.fn(),
  vitalCorrections: vi.fn(), correctVital: vi.fn(), markVitalEnteredInError: vi.fn(), reportedHealthProfile: vi.fn(), allergies: vi.fn(),
  noteRevisions: vi.fn(), documents: vi.fn(),
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

const ALL = ['ehr.encounter.read', 'ehr.vital.read', 'ehr.vital.write']
const ENCOUNTER = {
  id: ENCOUNTER_ID, patientId: PATIENT_ID, facilityId: FACILITY_ID, encounterType: 'ambulatory', status: 'in_progress',
  startedAt: '2026-10-30T08:00:00.000Z', chiefComplaint: 'Fever, headache', rowVersion: 1,
}
const VITAL_ID = 'f0000000-0000-4000-8000-000000000001'
const VITAL = {
  id: VITAL_ID, patientId: PATIENT_ID, encounterId: ENCOUNTER_ID, facilityId: FACILITY_ID, createdAt: '2026-10-30T08:05:00.000Z',
  systolicMmhg: 120, diastolicMmhg: 80, pulseBpm: 72, temperatureC: '36.6', currentCorrectionNo: 0, rowVersion: '3',
  status: 'recorded', statusChangedAt: null,
}
const WITHDRAWN = { ...VITAL, status: 'entered_in_error', statusChangedAt: '2026-10-30T09:00:00.000Z', rowVersion: '4' }
const RECORD = `/${ENCOUNTER_ID}~${VITAL_ID}`
const REASON = 'Recorded on the wrong patient'
/** The service's own words, which never reach the page. */
const SERVER_WORDS = 'Server words that must not be shown'
const refused = (status: number, code: string) => new HidApiError(status, SERVER_WORDS, { code })

let vitals: unknown[]

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  staff.facilityId = undefined
  staff.permissions = [...ALL]
  staff.activePatient = activePatient()
  staff.setActivePatient.mockImplementation(value => { staff.activePatient = value; return true })
  vitals = [VITAL]
  api.lookupPatient.mockResolvedValue(allowedLookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounters.mockResolvedValue({ items: [ENCOUNTER], nextCursor: null })
  api.encounter.mockResolvedValue(ENCOUNTER)
  api.records.mockImplementation(async (_f: string, _p: string, _e: string, kind: string) => ({ items: kind === 'vitals' ? vitals : [], nextCursor: null }))
  api.vitalCorrections.mockResolvedValue([])
  api.reportedHealthProfile.mockResolvedValue(null)
  api.allergies.mockRejectedValue(new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' }))
  api.noteRevisions.mockResolvedValue([])
  api.documents.mockResolvedValue({ items: [], nextCursor: null })
  api.markVitalEnteredInError.mockImplementation(async () => { vitals = [WITHDRAWN]; return WITHDRAWN })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function vitalsReads() {
  return api.records.mock.calls.filter(call => call[3] === 'vitals')
}

async function openRecord() {
  renderPage(<TriageWorkspace />, 'triage', RECORD)
  expect(await screen.findByRole('heading', { level: 1, name: vitalName(VITAL) })).toBeTruthy()
}

function actions() {
  return within(screen.getByRole('heading', { level: 2, name: 'Available actions' }).closest('section') as HTMLElement)
}

/** Opens "Mark as entered in error" in `scope`, types the reason and presses its submit, which sends it: no dialog asks. */
async function withdraw(scope: ReturnType<typeof within>, reason = REASON) {
  fireEvent.click(await scope.findByRole('button', { name: 'Mark as entered in error' }))
  fireEvent.change(scope.getByLabelText(labelled('Reason for change')), { target: { value: reason } })
  const submit = scope.getAllByRole('button', { name: 'Mark as entered in error' }).find((button: HTMLElement) => button.getAttribute('type') === 'submit')!
  fireEvent.click(submit)
  return submit
}

function noCodesOrServerWords() {
  const shown = document.body.textContent ?? ''
  expect(shown).not.toContain(SERVER_WORDS)
  expect(shown).not.toMatch(/[A-Z]{3,}_[A-Z_]{3,}/)
  expect(shown).not.toMatch(/permission/i)
  expect(shown).not.toMatch(/[–—]/)
  expect(shown).not.toContain(VITAL_ID)
  expect(shown).not.toContain(PATIENT_ID)
}

describe('Triage & Vitals record: Mark as entered in error', () => {
  it('reads the reading with those entered in error, so a withdrawn reading’s page still opens, said in words', async () => {
    vitals = [WITHDRAWN]
    await openRecord()
    expect(vitalsReads()[0]).toEqual([FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'vitals', { includeEnteredInError: true }])
    expect(screen.getByText(RETRACTED_TEXT)).toBeTruthy()
    expect(screen.getAllByText('Entered in error').length).toBeGreaterThan(0)
    // Nothing more can be done to it.
    expect(actions().queryByRole('button', { name: 'Mark as entered in error' })).toBeNull()
    expect(actions().queryByRole('button', { name: 'Correct these vitals' })).toBeNull()
    expect(actions().getByText('Nothing more to do here.')).toBeTruthy()
  })

  it('asks for the reason, then one press sends the row version, with no dialog, and reads the vitals again with those entered in error', async () => {
    await openRecord()
    expect(actions().getByRole('button', { name: 'Correct these vitals' })).toBeTruthy()
    // A short reason is refused before anything is sent.
    await withdraw(actions(), 'no')
    expect(actions().getByText('Give a reason of at least 3 characters.')).toBeTruthy()
    expect(api.markVitalEnteredInError).not.toHaveBeenCalled()
    const submit = actions().getAllByRole('button', { name: 'Mark as entered in error' }).find(button => button.getAttribute('type') === 'submit')!
    // What it does is said in the form, beside its submit and tied to it, as C8a's COMPLETED_ERROR_WARNING is.
    const warning = document.getElementById(submit.getAttribute('aria-describedby')!)!
    expect(warning.textContent).toBe(EIE_WARNING)
    expect(warning.closest('form')).toBe(submit.closest('form'))
    fireEvent.change(actions().getByLabelText(labelled('Reason for change')), { target: { value: `  ${REASON}  ` } })
    api.records.mockClear()
    const checks = api.lookupPatient.mock.calls.length
    // One press sends it: release D confirms no entered in error, so no dialog asks first.
    fireEvent.click(submit)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(await screen.findByText(EIE_DONE)).toBeTruthy()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(api.markVitalEnteredInError).toHaveBeenCalledTimes(1)
    expect(api.markVitalEnteredInError).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, VITAL_ID, { expectedRowVersion: 3, changeReason: REASON })
    // The access re-check first, then the change, then the read again, fresh and with those entered in error.
    expect(api.lookupPatient.mock.calls.length).toBe(checks + 1)
    expect(api.lookupPatient.mock.invocationCallOrder.at(-1)!).toBeLessThan(api.markVitalEnteredInError.mock.invocationCallOrder[0]!)
    await waitFor(() => expect(vitalsReads()).toEqual([[FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'vitals', { fresh: true, includeEnteredInError: true }]]))
    // The page stays, now showing the reading withdrawn, with nothing more to do.
    expect(await screen.findByText(RETRACTED_TEXT)).toBeTruthy()
    expect(actions().queryByRole('button', { name: 'Mark as entered in error' })).toBeNull()
    expect(actions().queryByRole('button', { name: 'Correct these vitals' })).toBeNull()
    noCodesOrServerWords()
  })

  it('sends once for one press of its form’s button, and no dialog ever shows', async () => {
    await openRecord()
    await withdraw(actions())
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(api.markVitalEnteredInError).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('treats a reading already entered in error as done, and reads it again', async () => {
    api.markVitalEnteredInError.mockImplementation(async () => { vitals = [WITHDRAWN]; throw refused(409, 'VITAL_ALREADY_ENTERED_IN_ERROR') })
    await openRecord()
    await withdraw(actions())
    expect(await screen.findByText(EIE_ALREADY)).toBeTruthy()
    expect(await screen.findByText(RETRACTED_TEXT)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    noCodesOrServerWords()
  })

  it('reads the reading again after a version conflict, says it changed, and asks again', async () => {
    api.markVitalEnteredInError.mockImplementation(async () => { vitals = [{ ...VITAL, rowVersion: '5' }]; throw refused(412, 'VERSION_CONFLICT') })
    await openRecord()
    await withdraw(actions())
    expect((await screen.findByRole('alert')).textContent).toBe(`${EIE_CHANGED} The list was reloaded.`)
    expect(screen.queryByText(EIE_DONE)).toBeNull()
    // The form went; the action is offered again, now against the version read.
    expect(actions().queryByLabelText(labelled('Reason for change'))).toBeNull()
    api.markVitalEnteredInError.mockResolvedValue(WITHDRAWN)
    await withdraw(actions())
    await waitFor(() => expect(api.markVitalEnteredInError).toHaveBeenCalledTimes(2))
    expect(api.markVitalEnteredInError).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, VITAL_ID, { expectedRowVersion: 5, changeReason: REASON })
    noCodesOrServerWords()
  })

  it.each([
    ['VITALS_STATUS_UNAVAILABLE', 503, EIE_UNAVAILABLE],
    ['VITAL_NOT_FOUND', 404, EIE_NOT_FOUND],
    ['CONSENT_REQUIRED', 403, NO_CONSENT],
    ['PERMISSION_DENIED', 403, EIE_NO_ROLE],
    ['PURPOSE_OF_USE_REQUIRED', 400, OPEN_PATIENT_AGAIN],
  ])('says %s in plain words in the form, keeping the reason, and changes nothing', async (code, status, words) => {
    // Each says first that nothing was changed, as its siblings do.
    expect(words.startsWith('Nothing was changed. ')).toBe(true)
    api.markVitalEnteredInError.mockRejectedValue(refused(status, code))
    await openRecord()
    await withdraw(actions())
    expect((await actions().findByRole('alert')).textContent).toBe(words)
    expect((actions().getByLabelText(labelled('Reason for change')) as HTMLInputElement).value).toBe(REASON)
    expect(screen.queryByText(EIE_DONE)).toBeNull()
    noCodesOrServerWords()
  })

  it('puts a missing reason (CHANGE_REASON_REQUIRED) on the reason', async () => {
    api.markVitalEnteredInError.mockRejectedValue(refused(400, 'CHANGE_REASON_REQUIRED'))
    await openRecord()
    await withdraw(actions())
    expect(await actions().findByText('Give a reason of at least 3 characters.')).toBeTruthy()
    noCodesOrServerWords()
  })

  it('puts a VALIDATION_FAILED that names the reason at the reason', async () => {
    api.markVitalEnteredInError.mockRejectedValue(new HidApiError(400, SERVER_WORDS, {
      code: 'VALIDATION_FAILED', details: [{ field: 'changeReason', messages: ['changeReason must be shorter than or equal to 500 characters'] }],
    }))
    await openRecord()
    await withdraw(actions())
    expect(await actions().findByText('Use 500 characters or fewer.')).toBeTruthy()
    noCodesOrServerWords()
  })

  it.each([
    ['naming another field', [{ field: 'expectedRowVersion', messages: ['expectedRowVersion must not be less than 1'] }]],
    ['naming no field', undefined],
  ])('says a VALIDATION_FAILED %s in the form, never pointing at the reason', async (_case, details) => {
    api.markVitalEnteredInError.mockRejectedValue(new HidApiError(400, SERVER_WORDS, { code: 'VALIDATION_FAILED', details }))
    await openRecord()
    await withdraw(actions())
    expect((await actions().findByRole('alert')).textContent).toBe(EIE_FAILED)
    expect(actions().queryByText('Give a reason of at least 3 characters.')).toBeNull()
    const reason = actions().getByLabelText(labelled('Reason for change')) as HTMLInputElement
    expect(reason.getAttribute('aria-invalid')).not.toBe('true')
    expect(reason.value).toBe(REASON)
    expect(screen.queryByText(EIE_DONE)).toBeNull()
    noCodesOrServerWords()
  })

  it('is offered only to a role that may write vitals, with write access, on Novu', async () => {
    staff.permissions = ALL.filter(permission => permission !== 'ehr.vital.write')
    let view = renderPage(<TriageWorkspace />, 'triage', RECORD)
    expect(await screen.findByRole('heading', { level: 1, name: vitalName(VITAL) })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Mark as entered in error' })).toBeNull()
    view.unmount()
    staff.permissions = [...ALL]
    // The write check is asked once per open patient (chart.tsx): a read-only grant is a patient opened again.
    staff.activePatient = activePatient()
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    view = renderPage(<TriageWorkspace />, 'triage', RECORD)
    expect(await screen.findByText('You can view this record but not change it.')).toBeTruthy()
    expect(await screen.findByRole('heading', { level: 1, name: vitalName(VITAL) })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Mark as entered in error' })).toBeNull()
    view.unmount()
    // An earlier backend has no such route: its vitals are read as before and only corrected.
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    staff.activePatient = activePatient()
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true })
    api.records.mockClear()
    renderPage(<TriageWorkspace />, 'triage', RECORD)
    expect(await screen.findByRole('button', { name: 'Correct these vitals' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Mark as entered in error' })).toBeNull()
    expect(vitalsReads()[0]).toEqual([FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'vitals'])
  })

  it('says a correction refused because the reading was withdrawn meanwhile (VITAL_ENTERED_IN_ERROR) in plain words', async () => {
    api.correctVital.mockImplementation(async () => { vitals = [WITHDRAWN]; throw refused(409, 'VITAL_ENTERED_IN_ERROR') })
    await openRecord()
    fireEvent.click(actions().getByRole('button', { name: 'Correct these vitals' }))
    const form = actions().getByRole('button', { name: 'Save correction' }).closest('form')!
    fireEvent.change(within(form).getByLabelText(labelled('Pulse (bpm)')), { target: { value: '78' } })
    fireEvent.change(within(form).getByLabelText(labelled('Reason for correction')), { target: { value: 'Repeat reading' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save correction' }))
    expect((await screen.findByRole('alert')).textContent).toBe(`${RETRACTED_SINCE} The list was reloaded.`)
    expect(await screen.findByText(RETRACTED_TEXT)).toBeTruthy()
    noCodesOrServerWords()
  })

  it('opens one form at a time', async () => {
    await openRecord()
    fireEvent.click(actions().getByRole('button', { name: 'Correct these vitals' }))
    expect(actions().getByRole('button', { name: 'Save correction' })).toBeTruthy()
    fireEvent.click(actions().getByRole('button', { name: 'Mark as entered in error' }))
    expect(actions().queryByRole('button', { name: 'Save correction' })).toBeNull()
    expect(actions().getByLabelText(labelled('Reason for change'))).toBeTruthy()
    // The button that closes the form names what it closes, as "Close correction" does.
    expect(actions().queryByRole('button', { name: 'Close' })).toBeNull()
    fireEvent.click(actions().getByRole('button', { name: 'Close entered in error' }))
    expect(actions().queryByLabelText(labelled('Reason for change'))).toBeNull()
  })
})

describe('Triage & Vitals list: a reading entered in error', () => {
  it('lists it with its status in words, never struck through', async () => {
    vitals = [WITHDRAWN]
    renderPage(<TriageWorkspace />, 'triage')
    const table = await screen.findByRole('table', { name: 'Triage & Vitals' })
    expect(vitalsReads()[0]).toEqual([FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'vitals', { includeEnteredInError: true }])
    const row = within(within(table).getByRole('link', { name: vitalName(VITAL) }).closest('tr') as HTMLElement)
    expect(row.getByText('Entered in error')).toBeTruthy()
    const value = row.getByText(/120\/80/)
    for (let node: HTMLElement | null = value; node; node = node.parentElement) {
      expect(getComputedStyle(node).textDecoration).not.toContain('line-through')
      expect(node.className).not.toMatch(/withdrawn/)
    }
    noCodesOrServerWords()
  })
})

describe('New triage & vitals: earlier vitals', () => {
  it('leaves a reading entered in error out of the earlier vitals, and reads no corrections for it', async () => {
    const OTHER_ID = 'f0000000-0000-4000-8000-000000000002'
    vitals = [
      { ...WITHDRAWN, systolicMmhg: 180, diastolicMmhg: 110, currentCorrectionNo: 1 },
      { ...VITAL, id: OTHER_ID, createdAt: '2026-10-30T08:30:00.000Z', pulseBpm: 64 },
    ]
    renderPage(<TriageWorkspace />, 'triage', '/new')
    expect(await screen.findByRole('button', { name: 'Save record' })).toBeTruthy()
    const context = within(screen.getByRole('region', { name: 'Allergies and earlier vitals' }))
    await waitFor(() => expect(context.getAllByText(/^Vitals · /)).toHaveLength(1))
    expect(vitalsReads()[0]![4]).toEqual({ includeEnteredInError: true })
    expect(context.queryByText(/Entered in error/)).toBeNull()
    expect(context.queryByText(/180/)).toBeNull()
    expect(context.getByText('64')).toBeTruthy()
    expect(api.vitalCorrections).not.toHaveBeenCalled()
    noCodesOrServerWords()
  })
})

describe('Consultation Vitals card: Mark as entered in error on each row', () => {
  async function vitalsCard() {
    renderPage(<ConsultWorkspace />, 'consult', `/${ENCOUNTER_ID}`)
    expect(await screen.findByRole('heading', { level: 1, name: consultationLabel(ENCOUNTER) })).toBeTruthy()
    const card = within(screen.getByRole('heading', { level: 2, name: 'Vitals' }).closest('section') as HTMLElement)
    // Each row is titled as classic's ("Vitals recorded", release D), with classic's one-line summary of its values.
    await card.findByRole('link', { name: VITALS_RECORDED })
    return card
  }

  it('withdraws one reading and reads the visit’s vitals again, the reading then labelled in classic’s words, not struck through', async () => {
    const card = await vitalsCard()
    const row = () => within((card.getByRole('link', { name: VITALS_RECORDED })).closest('li') as HTMLElement)
    // Before: classic's summary and no badge.
    expect(row().getByText(vitalSummary(VITAL))).toBeTruthy()
    expect(row().queryByText('Entered in error')).toBeNull()
    expect(row().queryByText(RETRACTED_TEXT)).toBeNull()
    expect(vitalsReads()[0]).toEqual([FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'vitals', { includeEnteredInError: true }])
    api.records.mockClear()
    // One press of the row form's button sends it, with no dialog, as on the record page.
    await withdraw(row())
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(await card.findByText(EIE_DONE)).toBeTruthy()
    expect(api.markVitalEnteredInError).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, VITAL_ID, { expectedRowVersion: 3, changeReason: REASON })
    await waitFor(() => expect(vitalsReads()).toEqual([[FACILITY_ID, PATIENT_ID, ENCOUNTER_ID, 'vitals', { cursor: undefined, fresh: true, includeEnteredInError: true }]]))
    expect(await row().findByText(RETRACTED_TEXT)).toBeTruthy()
    // Classic's warning badge and words for a reading entered in error; its values still shown, never struck through.
    expect(row().getByText('Entered in error')).toBeTruthy()
    const values = row().getByText(vitalSummary(WITHDRAWN))
    for (let node: HTMLElement | null = values; node; node = node.parentElement) {
      expect(getComputedStyle(node).textDecoration).not.toContain('line-through')
      expect(node.className).not.toMatch(/withdrawn/)
    }
    expect(row().queryByRole('button', { name: 'Mark as entered in error' })).toBeNull()
    expect(row().queryByRole('button', { name: 'Correct these vitals' })).toBeNull()
    noCodesOrServerWords()
  })

  it('says a version conflict in the card and reads the vitals again', async () => {
    api.markVitalEnteredInError.mockRejectedValue(refused(412, 'VERSION_CONFLICT'))
    const card = await vitalsCard()
    const row = within((card.getByRole('link', { name: VITALS_RECORDED })).closest('li') as HTMLElement)
    await withdraw(row)
    expect((await card.findByRole('alert')).textContent).toBe(`${EIE_CHANGED} The list was reloaded.`)
    expect(card.queryByText(EIE_DONE)).toBeNull()
    noCodesOrServerWords()
  })

  it('offers no withdrawal without the vitals write, and never shows the Health ID in a link', async () => {
    staff.permissions = ['ehr.encounter.read', 'ehr.vital.read']
    const card = await vitalsCard()
    await card.findByRole('link', { name: VITALS_RECORDED })
    expect(card.queryByRole('button', { name: 'Mark as entered in error' })).toBeNull()
    for (const link of screen.queryAllByRole('link')) expect(link.getAttribute('href') ?? '').not.toContain(PATIENT_HID)
    await act(async () => {})
  })
})
