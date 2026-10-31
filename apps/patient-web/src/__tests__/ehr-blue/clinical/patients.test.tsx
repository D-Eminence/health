import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dropOfferedHealthId, offeredHealthId } from '../../../ehr-blue/clinical/consent/access'
import { PatientsWorkspace, patientsStatus } from '../../../ehr-blue/clinical/patients/PatientsWorkspace'
import {
  DEMO_HOSPITAL_ID, ENCOUNTER_ID, FACILITY_ID, PATIENT_HID, PATIENT_ID, PATIENT_NAME, activePatient, allowedLookup, deniedLookup, labelled, renderPage,
} from './harness'

/**
 * Patients ("Find a patient"): the Health ID search (today's governed access), the patient open now and that patient's
 * page with its Next steps and this facility's visits. Everything is fictional.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), closeGrant: vi.fn(), encounters: vi.fn(), verifyPin: vi.fn(),
  sharedWithMe: vi.fn(), staffShareInvitations: vi.fn(), acceptShareInvitation: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true), facilityId: undefined as string | undefined }))
const session = vi.hoisted(() => ({
  staffSessionGeneration: vi.fn(() => 5), untilStaffSessionReady: vi.fn(async (_sentIn: number) => {}),
  staffSessionSignal: vi.fn(() => new AbortController().signal),
}))

vi.mock('../../../staff/api', async () => ({
  staffApi: api,
  isAllowedPatientLookup: (await import('./harness')).isAllowedPatientLookup,
  ACCESS_REQUEST_STATUSES: ['pending', 'approved', 'denied', 'revoked', 'expired'],
  ACCESS_OUTCOME_FILTERS: ['active', 'closed'],
}))
vi.mock('../../../staff/App', async () => {
  const harness = await import('./harness')
  return { useStaff: () => harness.staffValue(staff as never) }
})
vi.mock('../../../staff/session', () => session)

const ALL = ['identity.patient.read', 'identity.consent.write', 'identity.consent.read', 'ehr.encounter.read', 'ehr.note.read']
const NOT_FOUND = new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' })
const HID_FORMAT = 'Starts with HID-, then 6 to 32 letters and digits. Health IDs never use 0, 1, I or O.'
const CONSENT = { patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true }
const ENCOUNTER = { id: ENCOUNTER_ID, patientId: PATIENT_ID, facilityId: FACILITY_ID, encounterType: 'ambulatory', status: 'in_progress', startedAt: '2026-10-30T08:00:00.000Z', chiefComplaint: null, rowVersion: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  dropOfferedHealthId()
  staff.permissions = [...ALL]
  staff.activePatient = null
  staff.facilityId = undefined
  staff.setActivePatient.mockImplementation(value => { staff.activePatient = value; return true })
  session.staffSessionGeneration.mockReturnValue(5)
  api.lookupPatient.mockResolvedValue(allowedLookup)
  api.consentStatus.mockResolvedValue(CONSENT)
  api.closeGrant.mockResolvedValue({})
  api.verifyPin.mockResolvedValue({ accessRequestId: 'r1', consentGrantId: 'grant-1', patientId: PATIENT_ID, status: 'active', expiresAt: '2026-10-30T12:00:00.000Z' })
  api.encounters.mockResolvedValue({ items: [ENCOUNTER], nextCursor: null })
  api.sharedWithMe.mockRejectedValue(NOT_FOUND)
  api.staffShareInvitations.mockRejectedValue(NOT_FOUND)
})

function open(rest = '') {
  return renderPage(<PatientsWorkspace />, 'patients', rest)
}

function where() {
  return screen.queryByTestId('elsewhere')?.textContent ?? null
}

/**
 * Work at Demo Hospital, one of the four demo facilities (the harness's FACILITY_ID is a real one), with this file's
 * facility-scoped fixtures there too: pages list only the working facility's encounters.
 */
function atDemoHospital() {
  staff.facilityId = DEMO_HOSPITAL_ID
  api.consentStatus.mockResolvedValue({ ...CONSENT, facilityId: DEMO_HOSPITAL_ID })
  api.encounters.mockResolvedValue({ items: [{ ...ENCOUNTER, facilityId: DEMO_HOSPITAL_ID }], nextCursor: null })
}

/** The patient page's Next steps, in order: one native button per step, named by its title. */
function nextSteps() {
  const card = screen.queryByRole('heading', { level: 2, name: 'Next steps' })?.closest('section')
  if (!card) return []
  return Array.from(card.querySelectorAll('li button'), button => button.querySelector('div > div')?.textContent ?? '')
}

function searchField() {
  return screen.getByLabelText('Health ID') as HTMLInputElement
}

const findButton = () => screen.getByRole('button', { name: 'Find' }) as HTMLButtonElement
const REQUEST_UNAVAILABLE = 'Your role at this facility cannot ask patients for access: it needs identity.consent.write. Ask your organization administrator.'
const EMERGENCY_UNAVAILABLE = 'Your role at this facility cannot activate emergency access: it also needs identity.break-glass.write. Ask your organization administrator.'
const WRITES = ['ehr.encounter.write', 'ehr.vital.read', 'ehr.vital.write']

/** The way-in tiles: each is a button named by its title, then its hint. */
const tile = (scope: HTMLElement, title: 'Ask the patient' | 'Use their Access PIN' | 'Emergency access') =>
  within(scope).getByRole('button', { name: new RegExp(`^${title}`) }) as HTMLButtonElement

/** Searches for the patient, whom the lookup refuses, and answers the panel of ways in. */
async function refusedPanel() {
  api.lookupPatient.mockRejectedValue(new HidApiError(403, 'Patient access is not authorized', { code: 'PATIENT_ACCESS_DENIED' }))
  open()
  fireEvent.change(searchField(), { target: { value: PATIENT_HID } })
  fireEvent.click(findButton())
  return (await screen.findByText(`You don’t have access to ${PATIENT_HID} yet`)).closest<HTMLElement>('.border-t')!
}

/** The text an element's aria-describedby names. */
function describedBy(element: Element) {
  return (element.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)
    .map(id => document.getElementById(id)?.textContent ?? '').join(' ')
}

describe('Find a patient', () => {
  it('is live, has no Create record, offers Registration, and shows nothing of a patient while none is open', async () => {
    expect(patientsStatus).toBe('live')
    open()
    expect(screen.getByRole('heading', { level: 1, name: 'Find a patient' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create record' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Register a patient' }).getAttribute('href')).toBe('/provider/registration')
    expect(screen.queryByRole('region', { name: 'Open now' })).toBeNull()
    expect(screen.getByText(`It’s on the patient’s Health ID card. ${HID_FORMAT}`)).toBeTruthy()
    // Sharing is not served (404): both cards stay hidden, with no alert.
    await act(async () => {})
    expect(api.sharedWithMe).toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Shared with you' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Invitations' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('checks the Health ID at the field: focus moves there from the button, an alert from Enter in the field', async () => {
    open()
    fireEvent.click(findButton())
    expect(screen.getByText('Enter the patient’s Health ID.')).toBeTruthy()
    expect(document.activeElement).toBe(searchField())
    expect(searchField().getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(searchField())).toContain('Enter the patient’s Health ID.')
    fireEvent.change(searchField(), { target: { value: 'hid-zdem' } })
    expect(searchField().value).toBe('HID-ZDEM')
    searchField().focus()
    fireEvent.submit(searchField().closest('form')!)
    expect(screen.getByRole('alert').textContent).toBe('Check the Health ID: it starts with HID-, then 6 to 32 letters and digits, and never uses 0, 1, I or O.')
    expect(document.activeElement).toBe(searchField())
    expect(api.lookupPatient).not.toHaveBeenCalled()
  })

  it('opens an allowed patient (Enter submits) and goes to their page, whose URL names no patient', async () => {
    open()
    fireEvent.change(searchField(), { target: { value: 'hid-zdemaaa2' } })
    fireEvent.submit(searchField().closest('form')!)
    expect(await screen.findByRole('heading', { level: 1, name: PATIENT_NAME })).toBeTruthy()
    expect(api.lookupPatient).toHaveBeenCalledWith(FACILITY_ID, PATIENT_HID, 'direct-care')
    expect(staff.setActivePatient).toHaveBeenCalledWith({ hid: PATIENT_HID, lookup: allowedLookup, purpose: 'direct-care' })
    expect(document.title).not.toContain(PATIENT_NAME)
  })

  it('opens nothing when the session or facility changed while the lookup ran', async () => {
    staff.setActivePatient.mockReturnValue(false)
    open()
    fireEvent.change(searchField(), { target: { value: PATIENT_HID } })
    fireEvent.click(findButton())
    await waitFor(() => expect(staff.setActivePatient).toHaveBeenCalled())
    expect(screen.getByRole('heading', { level: 1, name: 'Find a patient' })).toBeTruthy()
  })

  it('offers the ways in for a refused patient and hands the Health ID to the request form', async () => {
    const panel = await refusedPanel()
    // In the search card, under the search.
    expect(panel.parentElement!.contains(searchField())).toBe(true)
    expect(within(panel).getByText('Patient access is not authorized')).toBeTruthy()
    expect(tile(panel, 'Use their Access PIN')).toBeTruthy()
    expect(tile(panel, 'Emergency access')).toBeTruthy()
    fireEvent.click(tile(panel, 'Ask the patient'))
    expect(where()).toBe('/provider/requests/new')
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe(PATIENT_HID)
    expect(staff.setActivePatient).not.toHaveBeenCalled()
  })

  it('verifies a refused patient’s PIN on Patients’ own page, for a role without identity.consent.write', async () => {
    staff.permissions = ['identity.patient.read', 'identity.patient-access-pin.verify']
    api.lookupPatient.mockRejectedValueOnce(new HidApiError(403, 'Patient access is not authorized', { code: 'PATIENT_ACCESS_DENIED' }))
    open()
    fireEvent.change(searchField(), { target: { value: PATIENT_HID } })
    fireEvent.click(findButton())
    const panel = (await screen.findByText(`You don’t have access to ${PATIENT_HID} yet`)).closest<HTMLElement>('.border-t')!
    fireEvent.click(tile(panel, 'Use their Access PIN'))
    // patients/pin, not External record access (requests/pin), which the frame opens only with identity.consent.write.
    expect(where()).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Use the patient’s Access PIN' })).toBeTruthy()
    expect((screen.getByLabelText(labelled('Health ID')) as HTMLInputElement).value).toBe(PATIENT_HID)
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe('')
    fireEvent.change(screen.getByLabelText(labelled('Access PIN')), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check PIN and open' }))
    expect(await screen.findByRole('heading', { level: 1, name: PATIENT_NAME })).toBeTruthy()
    expect(api.verifyPin).toHaveBeenCalledWith(FACILITY_ID, PATIENT_HID, '1234')
    expect(staff.setActivePatient).toHaveBeenCalledWith({ hid: PATIENT_HID, lookup: allowedLookup, purpose: 'direct-care' })
  })

  it('goes back to Find a patient from its PIN page', async () => {
    open('/pin')
    expect(screen.getByRole('heading', { level: 1, name: 'Use the patient’s Access PIN' })).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Back to access requests' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Find a patient' })).toBeTruthy()
  })

  it('review item 11: a role without identity.consent.write sees Ask the patient turned off with today’s sentence, and hands no Health ID over', async () => {
    staff.permissions = ['identity.patient.read', 'identity.patient-access-pin.verify']
    const panel = await refusedPanel()
    const request = tile(panel, 'Ask the patient')
    expect(request.disabled).toBe(true)
    expect(describedBy(request)).toBe(REQUEST_UNAVAILABLE)
    expect(within(panel).getByText(REQUEST_UNAVAILABLE)).toBeTruthy()
    fireEvent.click(request)
    expect(where()).toBeNull()
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe('')
    // The PIN, which needs no identity.consent.write, is still offered.
    expect(tile(panel, 'Use their Access PIN').disabled).toBe(false)
  })

  it('review item 11: a role without identity.break-glass.write sees Emergency access turned off with today’s sentence', async () => {
    // This file's role holds every permission emergency access needs but identity.break-glass.write.
    const panel = await refusedPanel()
    const emergency = tile(panel, 'Emergency access')
    expect(emergency.disabled).toBe(true)
    expect(describedBy(emergency)).toBe(EMERGENCY_UNAVAILABLE)
    expect(within(panel).getByText(EMERGENCY_UNAVAILABLE)).toBeTruthy()
    fireEvent.click(emergency)
    expect(where()).toBeNull()
    // Sending a request needs only identity.consent.write, which the role holds.
    expect(tile(panel, 'Ask the patient').disabled).toBe(false)
  })

  it('review item 11: with identity.consent.write and identity.break-glass.write, Ask the patient and Emergency access are both on', async () => {
    staff.permissions = [...ALL, 'identity.break-glass.write']
    const panel = await refusedPanel()
    for (const name of ['Ask the patient', 'Emergency access'] as const) {
      const button = tile(panel, name)
      expect(button.disabled).toBe(false)
      expect(button.getAttribute('aria-describedby')).toBeNull()
    }
    expect(screen.queryByText(REQUEST_UNAVAILABLE)).toBeNull()
    expect(screen.queryByText(EMERGENCY_UNAVAILABLE)).toBeNull()
    fireEvent.click(tile(panel, 'Emergency access'))
    expect(where()).toBe('/provider/emergency')
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe(PATIENT_HID)
  })

  it('review item 10: the search’s Health ID starts at HID-, is normalized as typed, and HID- alone is empty', () => {
    open()
    expect(searchField().value).toBe('HID-')
    fireEvent.click(findButton())
    expect(screen.getByText('Enter the patient’s Health ID.')).toBeTruthy()
    expect(api.lookupPatient).not.toHaveBeenCalled()
    fireEvent.change(searchField(), { target: { value: ' hid zdem aaa2' } })
    expect(searchField().value).toBe(PATIENT_HID)
    fireEvent.change(searchField(), { target: { value: '' } })
    expect(searchField().value).toBe('HID-')
  })

  it('closes any open patient on a lookup that is not allowed, and keeps an outage apart from a refusal', async () => {
    api.lookupPatient.mockResolvedValue(deniedLookup)
    open()
    fireEvent.change(searchField(), { target: { value: PATIENT_HID } })
    fireEvent.click(findButton())
    expect(await screen.findByText(`You don’t have access to ${PATIENT_HID} yet`)).toBeTruthy()
    expect(screen.getByText('Choose how to get it.')).toBeTruthy()
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    api.lookupPatient.mockRejectedValue(new HidApiError(503, 'Identity is unavailable', { code: 'SERVICE_UNAVAILABLE' }))
    fireEvent.click(findButton())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Couldn’t check access')
    expect(alert.textContent).toContain('Identity is unavailable')
    expect(screen.queryByText(`You don’t have access to ${PATIENT_HID} yet`)).toBeNull()
  })

  it('cannot look a patient up without identity.patient.read', () => {
    staff.permissions = ['identity.consent.write']
    open()
    expect(findButton().disabled).toBe(true)
    fireEvent.change(searchField(), { target: { value: PATIENT_HID } })
    fireEvent.submit(searchField().closest('form')!)
    expect(api.lookupPatient).not.toHaveBeenCalled()
  })

  it('shows the open patient, with the way to their page', () => {
    staff.activePatient = activePatient()
    open()
    const now = screen.getByRole('region', { name: 'Open now' })
    expect(within(now).getByText(PATIENT_NAME)).toBeTruthy()
    expect(within(now).getByText(PATIENT_HID)).toBeTruthy()
    expect(within(now).getByText('Access allowed')).toBeTruthy()
    expect(within(now).getByRole('link', { name: 'Open' }).getAttribute('href')).toBe('/provider/patients/open')
  })
})

describe('The open patient’s page', () => {
  it('shows the patient, the access, the Next steps and this facility’s visits', async () => {
    staff.activePatient = activePatient()
    open('/open')
    expect(screen.getByRole('heading', { level: 1, name: PATIENT_NAME })).toBeTruthy()
    expect(screen.getByText(/^\d+ years · Female · born 12 Apr 1990$/)).toBeTruthy()
    expect(screen.getAllByText(PATIENT_HID).length).toBeGreaterThan(0)
    expect(screen.getByText('You have access')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Next steps' })).toBeTruthy()
    const visit = await screen.findByRole('button', { name: /^Consultation · e0000000/ })
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.encounters.mock.invocationCallOrder[0]!)
    expect(api.encounters).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID)
    fireEvent.click(visit)
    expect(where()).toBe(`/provider/clinical/${ENCOUNTER_ID}`)
  })

  it('hands the Health ID to the request form from Ask for more access', () => {
    staff.activePatient = activePatient()
    open('/open')
    fireEvent.click(screen.getByRole('button', { name: /^Ask for more access/ }))
    expect(where()).toBe('/provider/requests/new')
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe(PATIENT_HID)
  })

  it('hand-off 01: offers Ask for more access only with identity.consent.write, so no Health ID is handed to a page the role cannot open', async () => {
    staff.permissions = ['identity.patient.read', 'ehr.encounter.read']
    staff.activePatient = activePatient()
    open('/open')
    expect(screen.getByRole('heading', { level: 2, name: 'Next steps' })).toBeTruthy()
    expect(nextSteps()).toEqual([])
    expect(screen.queryByRole('button', { name: /^Ask for more access/ })).toBeNull()
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe('')
    expect(screen.getByRole('button', { name: 'Open chart' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: /^Consultation · e0000000/ })).toBeTruthy()
  })

  it('hand-off 01: offers Open chart and the visits only with ehr.encounter.read, Consultation’s permission, and reads no encounters without it', async () => {
    staff.permissions = ['identity.patient.read', 'identity.consent.write']
    staff.activePatient = activePatient()
    open('/open')
    expect(nextSteps()).toEqual(['Ask for more access'])
    expect(screen.queryByRole('button', { name: 'Open chart' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Visits here' })).toBeNull()
    await act(async () => {})
    expect(api.encounters).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /^Ask for more access/ }))
    expect(where()).toBe('/provider/requests/new')
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe(PATIENT_HID)
  })

  it('hand-off 01: offers Start a consultation and Record vitals only to a role that may write them', () => {
    staff.permissions = [...ALL, ...WRITES]
    staff.activePatient = activePatient()
    const first = open('/open')
    expect(nextSteps()).toEqual(['Start a consultation', 'Record vitals', 'Ask for more access'])
    fireEvent.click(screen.getByRole('button', { name: /^Start a consultation/ }))
    expect(where()).toBe('/provider/clinical/new')
    first.unmount()
    const second = open('/open')
    fireEvent.click(screen.getByRole('button', { name: /^Record vitals/ }))
    expect(where()).toBe('/provider/triage/new')
    second.unmount()
    // Each step needs its own write permission.
    staff.permissions = [...ALL, 'ehr.vital.read', 'ehr.vital.write']
    const third = open('/open')
    expect(nextSteps()).toEqual(['Record vitals', 'Ask for more access'])
    third.unmount()
    staff.permissions = [...ALL, 'ehr.encounter.write', 'ehr.vital.read']
    open('/open')
    expect(nextSteps()).toEqual(['Start a consultation', 'Ask for more access'])
  })

  it('hand-off 01: a role with neither sees bare Next steps at a real facility, and the sample walk-in visit at a demo one', async () => {
    staff.permissions = ['identity.patient.read']
    staff.activePatient = activePatient()
    const real = open('/open')
    expect(screen.getByRole('heading', { level: 2, name: 'Next steps' })).toBeTruthy()
    expect(nextSteps()).toEqual([])
    real.unmount()
    atDemoHospital()
    open('/open')
    expect(nextSteps()).toEqual(['Register a walk-in visit'])
    await act(async () => {})
    expect(api.encounters).not.toHaveBeenCalled()
  })

  it('hand-off 01: each step is a native button in reading order, after End my access', () => {
    atDemoHospital()
    staff.permissions = [...ALL, ...WRITES]
    staff.activePatient = activePatient()
    open('/open')
    expect(nextSteps()).toEqual(['Start a consultation', 'Record vitals', 'Register a walk-in visit', 'Ask for more access'])
    const end = screen.getByRole('button', { name: 'End my access' })
    const steps = Array.from(screen.getByRole('heading', { level: 2, name: 'Next steps' }).closest('section')!.querySelectorAll('li button'))
    for (const button of steps) {
      expect(button.tagName).toBe('BUTTON')
      expect(button.getAttribute('type')).toBe('button')
      expect(button.getAttribute('tabindex')).toBeNull()
      expect((button as HTMLButtonElement).disabled).toBe(false)
      expect(end.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('hand-off 01: Register a walk-in visit goes to the sample’s new form at a demo facility, carrying nothing of the patient', () => {
    atDemoHospital()
    staff.activePatient = activePatient()
    open('/open')
    fireEvent.click(screen.getByRole('button', { name: /^Register a walk-in visit/ }))
    expect(where()).toBe('/provider/journey/new')
    expect(offeredHealthId(DEMO_HOSPITAL_ID, staff.setActivePatient)).toBe('')
    expect(where()).not.toContain(PATIENT_HID)
    expect(where()).not.toContain(PATIENT_ID)
  })

  it('leads into no sample at a real facility: no walk-in visit, while the chart and Ask for more access work', () => {
    staff.activePatient = activePatient()
    const first = open('/open')
    expect(nextSteps()).toEqual(['Ask for more access'])
    expect(screen.queryByRole('button', { name: /^Register a walk-in visit/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /appointment/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open chart' }))
    expect(where()).toBe('/provider/clinical')
    first.unmount()
    open('/open')
    fireEvent.click(screen.getByRole('button', { name: /^Ask for more access/ }))
    expect(where()).toBe('/provider/requests/new')
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe(PATIENT_HID)
  })

  it('shows the visits loading, then a failure to read them', async () => {
    staff.activePatient = activePatient()
    let fail: (reason: unknown) => void = () => {}
    api.encounters.mockReturnValue(new Promise((_resolve, reject) => { fail = reject }))
    open('/open')
    expect(await screen.findByRole('status', { name: 'Loading visits' })).toBeTruthy()
    await act(async () => { fail('offline') })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Couldn’t load visits')
    expect(alert.textContent).toContain('Please try again.')
  })

  it('says when this facility has no visits for the patient, and how to start one only to a role that may', async () => {
    staff.activePatient = activePatient()
    api.encounters.mockResolvedValue({ items: [], nextCursor: null })
    const first = open('/open')
    expect(await screen.findByText('No visits at this facility yet.')).toBeTruthy()
    first.unmount()
    staff.permissions = [...ALL, ...WRITES]
    open('/open')
    expect(await screen.findByText('No visits at this facility yet. Start a consultation to begin one.')).toBeTruthy()
  })

  it('shows that access ended when the re-check is refused', async () => {
    staff.activePatient = activePatient()
    api.lookupPatient.mockRejectedValue(new HidApiError(403, 'Patient access is not authorized', { code: 'PATIENT_ACCESS_DENIED' }))
    open('/open')
    expect(await screen.findByText('Access to this patient ended')).toBeTruthy()
    expect(screen.getByText('Open the patient again to keep working.')).toBeTruthy()
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    expect(api.encounters).not.toHaveBeenCalled()
  })

  it('keeps an emergency patient read-only: no visit, consent or chart steps, and no encounters read', async () => {
    // At a demo facility, where the visit step would otherwise show: emergency access alone hides it.
    atDemoHospital()
    staff.permissions = [...ALL, ...WRITES]
    staff.activePatient = activePatient('emergency')
    open('/open')
    expect(screen.getByText(`Emergency access shows the emergency summary only. Nothing can be added or changed for ${PATIENT_NAME}.`)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Next steps' })).toBeNull()
    expect(nextSteps()).toEqual([])
    expect(screen.queryByRole('button', { name: /^Register a walk-in visit/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Ask for more access/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open chart' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Visits here' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open emergency summary' }))
    expect(where()).toBe('/provider/emergency/summary')
    expect(api.encounters).not.toHaveBeenCalled()
    expect(api.consentStatus).not.toHaveBeenCalled()
  })

  it('flags a read-only grant once, and offers nothing that writes', async () => {
    staff.permissions = [...ALL, ...WRITES]
    staff.activePatient = activePatient()
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    open('/open')
    expect(await screen.findByText('You can see this record but not add to it. To make changes, ask the patient to let you see and add to their records.')).toBeTruthy()
    expect(screen.getByText('View only')).toBeTruthy()
    expect(nextSteps()).toEqual(['Ask for more access'])
  })

  it('ends my access at once, as today, then shows no open patient and says so', async () => {
    staff.activePatient = activePatient()
    open('/open')
    fireEvent.click(screen.getByRole('button', { name: 'End my access' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    const said = await screen.findByText('Your access has ended.')
    expect(said.closest('[role="status"]')).toBeTruthy()
    expect(api.closeGrant).toHaveBeenCalledTimes(1)
    expect(api.closeGrant).toHaveBeenCalledWith(FACILITY_ID, 'grant-1', 'Clinician closed completed patient access')
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    expect(screen.getByRole('heading', { level: 1, name: 'Find a patient' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Open now' })).toBeNull()
  })

  it('keeps the patient open and says why when ending access is refused', async () => {
    api.closeGrant.mockRejectedValue(new HidApiError(409, 'This access had already ended', { code: 'CONSENT_COMMAND_CONFLICT' }))
    staff.activePatient = activePatient()
    open('/open')
    fireEvent.click(screen.getByRole('button', { name: 'End my access' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Couldn’t end access')
    expect(alert.textContent).toContain('This access had already ended')
    expect(staff.setActivePatient).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { level: 1, name: PATIENT_NAME })).toBeTruthy()
  })

  it('names what a role lacks to end its access', () => {
    staff.permissions = ['identity.patient.read']
    staff.activePatient = activePatient()
    open('/open')
    const button = screen.getByRole('button', { name: 'End my access' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent)
      .toBe('Your role at this facility cannot end your access: it needs identity.consent.write. Ask your organization administrator.')
    fireEvent.click(button)
    expect(api.closeGrant).not.toHaveBeenCalled()
  })

  it('says to choose a patient when none is open', () => {
    open('/open')
    expect(screen.getByText('Choose a patient first.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Find a patient' }).getAttribute('href')).toBe('/provider/patients')
  })
})

describe('Patient sharing', () => {
  it('lists patients shared with this clinician and opens one through the same lookup', async () => {
    api.sharedWithMe.mockResolvedValue([{ consentGrantId: 'grant-9', patientId: PATIENT_ID, hid: PATIENT_HID, fullName: PATIENT_NAME, level: 'view_only', duration: '7d', scope: 'read_records', startsAt: '2026-10-29T08:00:00.000Z', expiresAt: '2026-11-05T08:00:00.000Z' }])
    api.staffShareInvitations.mockResolvedValue({ eligible: true, items: [] })
    open()
    expect(await screen.findByRole('heading', { name: 'Shared with you' })).toBeTruthy()
    // No invitations waiting: that card does not show (a section shows only when it has something in it).
    await act(async () => {})
    expect(api.staffShareInvitations).toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Invitations' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: `Open ${PATIENT_NAME}’s record` }))
    expect(await screen.findByRole('heading', { level: 1, name: PATIENT_NAME })).toBeTruthy()
    expect(api.lookupPatient).toHaveBeenCalledWith(FACILITY_ID, PATIENT_HID, 'direct-care')
  })

  it('accepts an invitation and says what happens next', async () => {
    api.staffShareInvitations.mockResolvedValue({ eligible: true, items: [{ invitationId: 'inv-1', reference: 'AB12', inviteeName: null, level: 'clinical_review', duration: '24h', createdAt: '2026-10-29T08:00:00.000Z', expiresAt: '2026-11-05T08:00:00.000Z' }] })
    api.acceptShareInvitation.mockResolvedValue({ invitationId: 'inv-1', status: 'accepted', acceptedAt: '2026-10-30T08:00:00.000Z', replayed: false })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Accept invitation AB12' }))
    const result = await screen.findByText('Accepted. Once the patient confirms, they appear under Shared with you.')
    expect(result.closest('[role="status"]')).toBeTruthy()
    expect(document.activeElement).toBe(result)
    expect(api.acceptShareInvitation).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Accept invitation AB12' })).toBeNull()
  })

  it('reads no sharing without identity.consent.write', async () => {
    staff.permissions = ['identity.patient.read']
    open()
    await act(async () => {})
    expect(api.sharedWithMe).not.toHaveBeenCalled()
    expect(api.staffShareInvitations).not.toHaveBeenCalled()
  })
})
