import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dropOfferedHealthId } from '../../../ehr-blue/clinical/consent/access'
import { EmergencyWorkspace } from '../../../ehr-blue/clinical/emergency/EmergencyWorkspace'
import { CONFIRM_PATIENT, SEARCH_SEEN_BY_PATIENTS, SEVERAL_MATCH } from '../../../ehr-blue/clinical/emergency/EmergencySearch'
import { ageInYears } from '../../../ehr-blue/clinical/patients/searchWords'
import { FACILITY_ID, PATIENT_ID, labelled, renderPage } from './harness'

/**
 * Emergency access by name and date of birth (hid-system 0132, ID-3b and ID-5): the reason first, then the exact first
 * name, last name and date of birth; the emergency search's cards carry no Health ID, so break-glass sends the confirmed
 * card's matchRef, and the emergency summary opens from break-glass's own answer. Only one card can be opened, once the
 * clinician ticks that it is the patient in front of them; more than one is never offered (Ola's review of #307). Every
 * patient here is fictional.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), breakGlass: vi.fn(), breakGlassByMatchRef: vi.fn(), closeGrant: vi.fn(),
  emergencyRecords: vi.fn(), labReleasedResultsForOrder: vi.fn(), emergencySearchPatients: vi.fn(),
}))
const staff = vi.hoisted(() => ({
  permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true), facilityId: undefined as string | undefined,
  roles: undefined as string[] | undefined,
}))
const session = vi.hoisted(() => ({
  staffSessionGeneration: vi.fn(() => 7), untilStaffSessionReady: vi.fn(async (_sentIn: number) => {}),
  staffSessionSignal: vi.fn(() => new AbortController().signal),
}))

vi.mock('../../../staff/api', async () => ({ staffApi: api, isAllowedPatientLookup: (await import('./harness')).isAllowedPatientLookup }))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})
vi.mock('../../../staff/session', () => session)
vi.mock('../../../ehr-blue/clinical/sample/SampleWorkspace', () => ({
  SampleList: () => null, SampleCreate: () => null, SampleDetail: () => null,
}))

const EMERGENCY_PERMISSIONS = ['identity.patient.read', 'identity.consent.write', 'identity.break-glass.write', 'ehr.encounter.read', 'ehr.note.read']
const ACKNOWLEDGE = 'I understand this is recorded with my name and my reason, the patient can see it, and access ends by itself after 30 minutes.'
const REASON = 'Unconscious after a road traffic collision; needs allergy history before treatment'
const MATCH_REF = `psr_${'C'.repeat(43)}`
const SECOND_REF = `psr_${'D'.repeat(43)}`
const CARD = {
  matchRef: MATCH_REF, matchRefExpiresAt: '2099-01-01T00:10:00.000Z', fullName: 'Bola Fictional', sex: 'male',
  dateOfBirth: '1984-02-29', healthIdLast4: 'KQ7X', ninStatus: 'not_verified' as 'verified' | 'not_verified',
}
const found = (...patients: typeof CARD[]) => ({ mode: 'emergency', outcome: 'found', reach: 'everywhere', message: null, patients })
const GRANT = { accessRequestId: 'request-1', consentGrantId: 'grant-emergency', patientId: PATIENT_ID, status: 'active', expiresAt: '2099-01-01T00:30:00.000Z' }

beforeEach(() => {
  vi.clearAllMocks()
  dropOfferedHealthId()
  staff.permissions = [...EMERGENCY_PERMISSIONS]
  staff.activePatient = null
  staff.setActivePatient.mockImplementation(value => { staff.activePatient = value; return true })
  api.emergencySearchPatients.mockResolvedValue(found(CARD))
  api.breakGlassByMatchRef.mockResolvedValue(GRANT)
  api.emergencyRecords.mockReturnValue(new Promise(() => {}))
})

function open() {
  return renderPage(<EmergencyWorkspace />, 'emergency')
}

const byName = () => fireEvent.click(screen.getByRole('button', { name: 'Name and date of birth' }))
const openButton = () => screen.queryByRole('button', { name: 'Open emergency access' }) as HTMLButtonElement | null
const confirmBox = () => screen.queryByRole('checkbox', { name: CONFIRM_PATIENT }) as HTMLInputElement | null
const reasonField = () => screen.getByRole('textbox', { name: labelled('Why do you need emergency access?') }) as HTMLTextAreaElement
const searchButton = () => screen.getByRole('button', { name: /^(Search|Searching…)$/ })

function names(first = 'Bola', last = 'Fictional', born = '1984-02-29') {
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: first } })
  fireEvent.change(screen.getByLabelText('Last name'), { target: { value: last } })
  fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: born } })
}

async function searchFor(reason = REASON) {
  byName()
  fireEvent.change(reasonField(), { target: { value: reason } })
  names()
  fireEvent.click(searchButton())
}

describe('emergency access by name and date of birth', () => {
  it('is offered beside the Health ID, and asks for the reason first', () => {
    open()
    expect(screen.getByRole('navigation', { name: 'Find the patient by' })).toBeTruthy()
    byName()
    expect(screen.queryByRole('textbox', { name: labelled('Health ID') })).toBeNull()
    const order = [reasonField(), screen.getByLabelText('First name'), screen.getByLabelText('Date of birth')]
    expect(order[0]!.compareDocumentPosition(order[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(order[1]!.compareDocumentPosition(order[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('searches nobody until the reason is given, and says so at the reason', async () => {
    open()
    byName()
    names()
    fireEvent.click(searchButton())
    await waitFor(() => expect(document.activeElement).toBe(reasonField()))
    expect(screen.getByText('Say why in at least 8 characters.')).toBeTruthy()
    expect(api.emergencySearchPatients).not.toHaveBeenCalled()
  })

  it('tells the clinician, before the search runs, that everyone it finds will see it', () => {
    open()
    byName()
    expect(screen.getByText(SEARCH_SEEN_BY_PATIENTS)).toBeTruthy()
    expect(SEARCH_SEEN_BY_PATIENTS).toBe('Everyone this search finds will see it in their access history, with this facility’s name.')
    expect(api.emergencySearchPatients).not.toHaveBeenCalled()
  })

  it('sends the exact names, the date of birth and the reason, and shows the one card with its age and no Health ID', async () => {
    open()
    await searchFor(`  ${REASON}  `)
    expect(await screen.findByText('Bola Fictional')).toBeTruthy()
    expect(api.emergencySearchPatients).toHaveBeenCalledWith(FACILITY_ID, { firstName: 'Bola', lastName: 'Fictional', dateOfBirth: '1984-02-29', reason: `  ${REASON}  ` })
    expect(screen.getByText(`Male · Born 29 Feb 1984 (age ${ageInYears('1984-02-29')}) · Health ID •••• KQ7X`)).toBeTruthy()
    expect(screen.getByText('NIN Not Verified')).toBeTruthy()
  })

  it('never chooses the one card for the clinician: Open stays off until they tick that it is the patient in front of them', async () => {
    open()
    await searchFor()
    await screen.findByText('Bola Fictional')
    expect(screen.queryByRole('radio')).toBeNull()
    expect(confirmBox()!.checked).toBe(false)
    expect(openButton()!.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: ACKNOWLEDGE }))
    await act(async () => { fireEvent.click(openButton()!) })
    expect(api.breakGlassByMatchRef).not.toHaveBeenCalled()
    fireEvent.click(confirmBox()!)
    expect(openButton()!.disabled).toBe(false)
    fireEvent.click(confirmBox()!)
    expect(openButton()!.disabled).toBe(true)
  })

  it('offers no choice and no Open when more than one person has the name and date of birth', async () => {
    api.emergencySearchPatients.mockResolvedValue(found(CARD, { ...CARD, matchRef: SECOND_REF, sex: 'female', healthIdLast4: 'P3R9' }))
    open()
    await searchFor()
    expect(await screen.findByText(SEVERAL_MATCH)).toBeTruthy()
    expect(SEVERAL_MATCH).toBe('More than one person has this name and date of birth, so their records can’t be opened safely from this search. Use the patient’s Health ID if anyone has it.')
    expect(screen.queryByRole('radio')).toBeNull()
    expect(confirmBox()).toBeNull()
    expect(screen.queryByText('Bola Fictional')).toBeNull()
    expect(openButton()).toBeNull()
    expect(api.breakGlassByMatchRef).not.toHaveBeenCalled()
  })

  it('opens emergency access for the confirmed card by its matchRef, and the summary without a Health ID lookup', async () => {
    open()
    await searchFor()
    fireEvent.click(await screen.findByRole('checkbox', { name: CONFIRM_PATIENT }))
    fireEvent.click(screen.getByRole('checkbox', { name: ACKNOWLEDGE }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open emergency access' })) })
    expect(api.breakGlassByMatchRef).toHaveBeenCalledWith(FACILITY_ID, MATCH_REF, REASON)
    expect(api.breakGlass).not.toHaveBeenCalled()
    expect(session.untilStaffSessionReady).toHaveBeenCalledWith(7)
    expect(staff.setActivePatient).toHaveBeenCalledWith({
      hid: '', healthIdLast4: 'KQ7X', purpose: 'emergency',
      lookup: {
        authorization: { decision: 'allow', expiresAt: GRANT.expiresAt, consentGrantId: 'grant-emergency', breakGlass: true, scope: 'read_records' },
        patient: { patientId: PATIENT_ID, hid: '', fullName: 'Bola Fictional', dateOfBirth: '1984-02-29', gender: 'male' },
      },
    })
    expect(await screen.findByRole('heading', { level: 1, name: 'Emergency summary' })).toBeTruthy()
    await waitFor(() => expect(api.emergencyRecords).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID))
    expect(api.lookupPatient).not.toHaveBeenCalled()
    const banner = screen.getByRole('region', { name: 'Patient: Bola Fictional' })
    expect(banner.textContent).toContain('•••• KQ7X')
  })

  it('leaves the card’s expiry to Identity: a device clock running fast does not block emergency access', async () => {
    // The device's clock says the card expired long ago; Identity, whose time it is, still knows the matchRef.
    api.emergencySearchPatients.mockResolvedValue(found({ ...CARD, matchRefExpiresAt: '2000-01-01T00:00:00.000Z' }))
    open()
    await searchFor()
    fireEvent.click(await screen.findByRole('checkbox', { name: CONFIRM_PATIENT }))
    fireEvent.click(screen.getByRole('checkbox', { name: ACKNOWLEDGE }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open emergency access' })) })
    expect(api.breakGlassByMatchRef).toHaveBeenCalledWith(FACILITY_ID, MATCH_REF, REASON)
    expect(screen.queryByText('This search result has expired. Search again.')).toBeNull()
    expect(await screen.findByRole('heading', { level: 1, name: 'Emergency summary' })).toBeTruthy()
  })

  it('says to search again when break-glass no longer knows the card, and clears the old card', async () => {
    api.breakGlassByMatchRef.mockRejectedValue(new HidApiError(404, 'Not Found', { code: 'CONSENT_RESOURCE_NOT_FOUND' }))
    open()
    await searchFor()
    fireEvent.click(await screen.findByRole('checkbox', { name: CONFIRM_PATIENT }))
    fireEvent.click(screen.getByRole('checkbox', { name: ACKNOWLEDGE }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open emergency access' })) })
    const alert = await screen.findByText('This search result has expired. Search again.')
    expect(alert).toBeTruthy()
    expect(staff.setActivePatient).not.toHaveBeenCalled()
    // Only a new search shows a card again.
    expect(screen.queryByText('Bola Fictional')).toBeNull()
    expect(confirmBox()).toBeNull()
    expect(openButton()).toBeNull()
    fireEvent.click(searchButton())
    expect(await screen.findByText('Bola Fictional')).toBeTruthy()
    expect(confirmBox()!.checked).toBe(false)
  })

  it('ends access when the emergency summary’s read is refused for a patient opened from a card', async () => {
    // The grant ended elsewhere (closed, or ended early): with no Health ID to look up again, EHR's 403 is the sign.
    api.emergencyRecords.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'CONSENT_REQUIRED' }))
    open()
    await searchFor()
    fireEvent.click(await screen.findByRole('checkbox', { name: CONFIRM_PATIENT }))
    fireEvent.click(screen.getByRole('checkbox', { name: ACKNOWLEDGE }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open emergency access' })) })
    expect(await screen.findByText('Access to this patient ended')).toBeTruthy()
    expect(staff.setActivePatient).toHaveBeenLastCalledWith(null)
    expect(screen.queryByText('Couldn’t load the emergency summary')).toBeNull()
    expect(api.lookupPatient).not.toHaveBeenCalled()
  })

  it('says more than 5 matches in plain words', async () => {
    api.emergencySearchPatients.mockResolvedValue({ mode: 'emergency', outcome: 'too_many', reach: 'everywhere', message: null, patients: [] })
    open()
    await searchFor()
    expect(await screen.findByText('More than 5 people match. Ask for a phone number or the Health ID.')).toBeTruthy()
  })

  it.each([
    [new HidApiError(423, 'Locked', { code: 'BREAK_GLASS_DISABLED' }), 'Emergency access is switched off right now, so nobody was searched for. Ask Health ID support.'],
    [new HidApiError(429, 'Too Many Requests', { code: 'PATIENT_SEARCH_LIMITED' }), 'You’ve reached the limit of 5 emergency searches an hour. Use the patient’s Health ID instead.'],
    [new HidApiError(403, 'Forbidden', { code: 'PERMISSION_DENIED' }), 'Your role at this facility can’t search for patients in an emergency. Ask your facility administrator.'],
  ])('says a refused search in plain words (%s)', async (refusal, words) => {
    api.emergencySearchPatients.mockRejectedValue(refusal)
    open()
    await searchFor()
    expect(await screen.findByText(words)).toBeTruthy()
  })

  it('counts age in whole years on the calendar, a 29 February birthday turning on 1 March', () => {
    expect(ageInYears('1984-02-29', new Date(2026, 1, 28))).toBe(41)
    expect(ageInYears('1984-02-29', new Date(2026, 2, 1))).toBe(42)
    expect(ageInYears('1990-04-12', new Date(2026, 3, 11))).toBe(35)
    expect(ageInYears('1990-04-12', new Date(2026, 3, 12))).toBe(36)
    expect(ageInYears(null)).toBeNull()
    expect(ageInYears('not a date')).toBeNull()
  })

  it('keeps the Health ID way as it was', () => {
    open()
    byName()
    fireEvent.click(screen.getByRole('button', { name: 'Health ID' }))
    const form = screen.getByRole('textbox', { name: labelled('Health ID') }).closest('form')!
    expect(within(form).queryByLabelText('First name')).toBeNull()
  })
})
