import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dropOfferedHealthId, offeredHealthId } from '../../../ehr-blue/clinical/consent/access'
import { PatientsWorkspace, patientsStatus } from '../../../ehr-blue/clinical/patients/PatientsWorkspace'
import {
  DEMO_HOSPITAL_ID, ENCOUNTER_ID, FACILITY_ID, PATIENT_HID, PATIENT_ID, PATIENT_NAME, activePatient, allowedLookup, deniedLookup, labelled, renderPage,
} from './harness'

/**
 * Patients: the Health ID search (today's governed access), the patient open now and that patient's page with the
 * design's Next steps and Connected hospital history. Everything is fictional.
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

/** The patient page's Next steps, in order: one button per step. */
function nextSteps() {
  return Array.from(document.querySelectorAll('.hid-ehr-clinical-step button'), button => button.textContent)
}

function searchField() {
  return screen.getByLabelText('Search Patients') as HTMLInputElement
}

const REQUEST_UNAVAILABLE = 'Your role at this facility cannot send access requests: it needs identity.consent.write. Ask your organization administrator.'
const EMERGENCY_UNAVAILABLE = 'Your role at this facility cannot activate emergency access: it also needs identity.break-glass.write. Ask your organization administrator.'

/** Searches for the patient, whom the lookup refuses, and answers the refusal banner. */
async function refusedBanner() {
  api.lookupPatient.mockRejectedValue(new HidApiError(403, 'Patient access is not authorized', { code: 'PATIENT_ACCESS_DENIED' }))
  open()
  fireEvent.change(searchField(), { target: { value: PATIENT_HID } })
  fireEvent.click(screen.getByRole('button', { name: 'Verify access' }))
  return (await screen.findByText('No access to this patient yet')).closest('section')!
}

/** The text an element's aria-describedby names. */
function describedBy(element: Element) {
  return (element.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)
    .map(id => document.getElementById(id)?.textContent ?? '').join(' ')
}

describe('Patients list', () => {
  it('is live, has no Create record, and says how to open a patient while none is open', async () => {
    expect(patientsStatus).toBe('live')
    open()
    expect(screen.getByRole('heading', { level: 1, name: 'Patients' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create record' })).toBeNull()
    expect(screen.getByText('No authorized patient')).toBeTruthy()
    expect(screen.getByText('Open a patient using an approved request, patient PIN, or documented emergency access.')).toBeTruthy()
    expect(screen.getByText(HID_FORMAT)).toBeTruthy()
    // Sharing is not served (404): both cards stay hidden, with no alert.
    await act(async () => {})
    expect(api.sharedWithMe).toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Shared with you' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Invitations' })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('checks the Health ID at the field: focus moves there from the button, an alert from Enter in the field', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Verify access' }))
    expect(screen.getByText('Enter the patient’s Health ID.')).toBeTruthy()
    expect(document.activeElement).toBe(searchField())
    expect(searchField().getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(searchField(), { target: { value: 'hid-zdem' } })
    expect(searchField().value).toBe('HID-ZDEM')
    // "Verify access", then "Clear search", on one line (one actions row).
    const verify = screen.getByRole('button', { name: 'Verify access' })
    expect(screen.getByRole('button', { name: 'Clear search' }).parentElement).toBe(verify.parentElement)
    expect(verify.nextElementSibling).toBe(screen.getByRole('button', { name: 'Clear search' }))
    searchField().focus()
    fireEvent.submit(searchField().closest('form')!)
    expect(screen.getByRole('alert').textContent).toBe('Check the Health ID: it starts with HID-, then 6 to 32 letters and digits, and never uses 0, 1, I or O.')
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
    fireEvent.click(screen.getByRole('button', { name: 'Verify access' }))
    await waitFor(() => expect(staff.setActivePatient).toHaveBeenCalled())
    expect(screen.getByRole('heading', { level: 1, name: 'Patients' })).toBeTruthy()
  })

  it('offers the access options for a refused patient and hands the Health ID to the request form', async () => {
    api.lookupPatient.mockRejectedValue(new HidApiError(403, 'Patient access is not authorized', { code: 'PATIENT_ACCESS_DENIED' }))
    open()
    fireEvent.change(searchField(), { target: { value: PATIENT_HID } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify access' }))
    const banner = (await screen.findByText('No access to this patient yet')).closest('section')!
    // In the search card, after the search: the card's rule gives it its space under "Verify access".
    expect(banner.parentElement?.classList.contains('hid-ehr-card')).toBe(true)
    expect(banner.previousElementSibling).not.toBeNull()
    expect(within(banner).getByText('Patient access is not authorized')).toBeTruthy()
    expect(within(banner).getByRole('button', { name: 'Verify patient PIN' })).toBeTruthy()
    expect(within(banner).getByRole('button', { name: 'Emergency break-glass access' })).toBeTruthy()
    fireEvent.click(within(banner).getByRole('button', { name: 'Request access' }))
    expect(where()).toBe('/provider/requests/new')
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe(PATIENT_HID)
    expect(staff.setActivePatient).not.toHaveBeenCalled()
  })

  it('verifies a refused patient’s PIN on Patients’ own page, for a role without identity.consent.write', async () => {
    staff.permissions = ['identity.patient.read', 'identity.patient-access-pin.verify']
    api.lookupPatient.mockRejectedValueOnce(new HidApiError(403, 'Patient access is not authorized', { code: 'PATIENT_ACCESS_DENIED' }))
    open()
    fireEvent.change(searchField(), { target: { value: PATIENT_HID } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify access' }))
    const banner = (await screen.findByText('No access to this patient yet')).closest('section')!
    fireEvent.click(within(banner).getByRole('button', { name: 'Verify patient PIN' }))
    // patients/pin, not External record access (requests/pin), which the frame opens only with identity.consent.write.
    expect(where()).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Patient PIN access' })).toBeTruthy()
    expect((screen.getByLabelText(labelled('Health ID')) as HTMLInputElement).value).toBe(PATIENT_HID)
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe('')
    fireEvent.change(screen.getByLabelText(labelled('Patient access PIN')), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify PIN and open' }))
    expect(await screen.findByRole('heading', { level: 1, name: PATIENT_NAME })).toBeTruthy()
    expect(api.verifyPin).toHaveBeenCalledWith(FACILITY_ID, PATIENT_HID, '1234')
    expect(staff.setActivePatient).toHaveBeenCalledWith({ hid: PATIENT_HID, lookup: allowedLookup, purpose: 'direct-care' })
  })

  it('goes back to Patients from its PIN page', async () => {
    open('/pin')
    expect(screen.getByRole('heading', { level: 1, name: 'Patient PIN access' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Patients' })).toBeTruthy()
  })

  it('review item 11: a role without identity.consent.write sees Request access disabled with today’s sentence, and hands no Health ID over', async () => {
    staff.permissions = ['identity.patient.read', 'identity.patient-access-pin.verify']
    const banner = await refusedBanner()
    const request = within(banner).getByRole('button', { name: 'Request access' }) as HTMLButtonElement
    expect(request.disabled).toBe(true)
    expect(describedBy(request)).toBe(REQUEST_UNAVAILABLE)
    expect(within(banner).getByText(REQUEST_UNAVAILABLE)).toBeTruthy()
    fireEvent.click(request)
    expect(where()).toBeNull()
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe('')
    // The PIN, which needs no identity.consent.write, is still offered.
    expect((within(banner).getByRole('button', { name: 'Verify patient PIN' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('review item 11: a role without identity.break-glass.write sees Emergency break-glass access disabled with today’s sentence', async () => {
    // This file's role holds every permission emergency access needs but identity.break-glass.write.
    const banner = await refusedBanner()
    const emergency = within(banner).getByRole('button', { name: 'Emergency break-glass access' }) as HTMLButtonElement
    expect(emergency.disabled).toBe(true)
    expect(describedBy(emergency)).toBe(EMERGENCY_UNAVAILABLE)
    expect(within(banner).getByText(EMERGENCY_UNAVAILABLE)).toBeTruthy()
    fireEvent.click(emergency)
    expect(where()).toBeNull()
    // Sending a request needs only identity.consent.write, which the role holds.
    expect((within(banner).getByRole('button', { name: 'Request access' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('review item 11: with identity.consent.write and identity.break-glass.write, Request access and Emergency break-glass access are both enabled', async () => {
    staff.permissions = [...ALL, 'identity.break-glass.write']
    const banner = await refusedBanner()
    for (const name of ['Request access', 'Emergency break-glass access']) {
      const button = within(banner).getByRole('button', { name }) as HTMLButtonElement
      expect(button.disabled).toBe(false)
      expect(button.getAttribute('aria-describedby')).toBeNull()
    }
    expect(screen.queryByText(REQUEST_UNAVAILABLE)).toBeNull()
    expect(screen.queryByText(EMERGENCY_UNAVAILABLE)).toBeNull()
    fireEvent.click(within(banner).getByRole('button', { name: 'Emergency break-glass access' }))
    expect(where()).toBe('/provider/emergency')
  })

  it('review item 10: the search’s Health ID starts at HID-, is normalized as typed, and HID- alone is empty', () => {
    open()
    expect(searchField().value).toBe('HID-')
    fireEvent.click(screen.getByRole('button', { name: 'Verify access' }))
    expect(screen.getByText('Enter the patient’s Health ID.')).toBeTruthy()
    expect(api.lookupPatient).not.toHaveBeenCalled()
    fireEvent.change(searchField(), { target: { value: ' hid zdem aaa2' } })
    expect(searchField().value).toBe(PATIENT_HID)
    fireEvent.change(searchField(), { target: { value: '' } })
    expect(searchField().value).toBe('HID-')
    // Only the HID- the field starts with: nothing typed, so no "Clear search".
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    fireEvent.change(searchField(), { target: { value: 'hid-zdemaaa2' } })
    // Clear search goes back to the field's start, HID-.
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(searchField().value).toBe('HID-')
    expect(document.activeElement).toBe(searchField())
  })

  it('closes any open patient on a lookup that is not allowed, and keeps an outage apart from a refusal', async () => {
    api.lookupPatient.mockResolvedValue(deniedLookup)
    open()
    fireEvent.change(searchField(), { target: { value: PATIENT_HID } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify access' }))
    expect(await screen.findByText('The backend has not granted access to this patient. Request approval, verify their PIN, or use documented emergency access when justified.')).toBeTruthy()
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    api.lookupPatient.mockRejectedValue(new HidApiError(503, 'Identity is unavailable', { code: 'SERVICE_UNAVAILABLE' }))
    fireEvent.click(screen.getByRole('button', { name: 'Verify access' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Identity is unavailable')
    expect(screen.queryByText('No access to this patient yet')).toBeNull()
  })

  it('cannot verify access without identity.patient.read', () => {
    staff.permissions = ['identity.consent.write']
    open()
    expect((screen.getByRole('button', { name: 'Verify access' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('lists the open patient, with a quick view that Escape closes', async () => {
    staff.activePatient = activePatient()
    open()
    const table = screen.getByRole('table', { name: 'Patients' })
    expect(within(table).getByRole('link', { name: PATIENT_NAME }).getAttribute('href')).toBe('/provider/patients/open')
    expect(within(table).getByText(PATIENT_HID)).toBeTruthy()
    expect(within(table).getByText('Access allowed')).toBeTruthy()
    fireEvent.click(within(table).getByRole('button', { name: `Quick view ${PATIENT_NAME}` }))
    const drawer = screen.getByRole('dialog', { name: 'Record quick view' })
    expect(within(drawer).getByText('Direct care')).toBeTruthy()
    fireEvent.keyDown(drawer, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('The open patient’s page', () => {
  it('shows the patient header, the saved facts, the Next steps and this facility’s encounters', async () => {
    staff.activePatient = activePatient()
    open('/open')
    expect(screen.getByRole('heading', { level: 1, name: PATIENT_NAME })).toBeTruthy()
    const header = screen.getByRole('region', { name: 'Patient' })
    expect(within(header).getByText(PATIENT_HID)).toBeTruthy()
    expect(within(header).getByText('Female')).toBeTruthy()
    expect(within(header).getByText(/^\d+ years \(born 4\/12\/1990\)$/)).toBeTruthy()
    expect(within(header).getByText('Access allowed')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Next steps' })).toBeTruthy()
    const history = await screen.findByRole('link', { name: 'Consultation · e0000000' })
    expect(history.getAttribute('href')).toBe(`/provider/clinical/${ENCOUNTER_ID}`)
    expect(api.lookupPatient.mock.invocationCallOrder[0]!).toBeLessThan(api.encounters.mock.invocationCallOrder[0]!)
    expect(api.encounters).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID)
    fireEvent.click(screen.getByRole('button', { name: 'Open consent' }))
    expect(where()).toBe('/provider/requests/new')
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe(PATIENT_HID)
  })

  it('hand-off 01: offers Open consent only with identity.consent.write, so no Health ID is handed to a page the role cannot open', async () => {
    staff.permissions = ['identity.patient.read', 'ehr.encounter.read']
    staff.activePatient = activePatient()
    open('/open')
    expect(screen.getByRole('heading', { level: 3, name: 'Next steps' })).toBeTruthy()
    expect(nextSteps()).toEqual(['Open clinical record'])
    expect(screen.queryByRole('button', { name: 'Open consent' })).toBeNull()
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe('')
    expect(await screen.findByRole('link', { name: 'Consultation · e0000000' })).toBeTruthy()
  })

  it('hand-off 01: offers Open clinical record only with ehr.encounter.read, Consultation’s permission, and reads no encounters without it', async () => {
    staff.permissions = ['identity.patient.read', 'identity.consent.write']
    staff.activePatient = activePatient()
    open('/open')
    expect(nextSteps()).toEqual(['Open consent'])
    expect(screen.queryByRole('button', { name: 'Open clinical record' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Connected hospital history' })).toBeNull()
    await act(async () => {})
    expect(api.encounters).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Open consent' }))
    expect(where()).toBe('/provider/requests/new')
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe(PATIENT_HID)
  })

  it('hand-off 01: a role with neither sees the design’s bare Next steps at a real facility, and the two sample steps at a demo one', async () => {
    staff.permissions = ['identity.patient.read']
    staff.activePatient = activePatient()
    const real = open('/open')
    expect(screen.getByRole('heading', { level: 3, name: 'Next steps' })).toBeTruthy()
    expect(nextSteps()).toEqual([])
    real.unmount()
    // The design's own capture (a receptionist): "Open appointments" and "Register walk-in visit" only.
    atDemoHospital()
    open('/open')
    expect(nextSteps()).toEqual(['Open appointments', 'Register walk-in visit'])
    await act(async () => {})
    expect(api.encounters).not.toHaveBeenCalled()
  })

  it('hand-off 01: each step is a native button in reading order, after Close my grant', () => {
    atDemoHospital()
    staff.activePatient = activePatient()
    open('/open')
    const actions = screen.getByRole('heading', { name: 'Available actions' }).closest('section')!
    const buttons = within(actions).getAllByRole('button')
    expect(buttons.map(button => button.textContent)).toEqual(['Close my grant', 'Open appointments', 'Register walk-in visit', 'Open consent', 'Open clinical record'])
    for (const button of buttons) {
      expect(button.tagName).toBe('BUTTON')
      expect(button.getAttribute('type')).toBe('button')
      expect(button.getAttribute('tabindex')).toBeNull()
      expect((button as HTMLButtonElement).disabled).toBe(false)
    }
  })

  // Appointments and patient visits are sample workspaces: their steps show only at the four demo facilities. Each
  // opens the sample's new form, as the design's hand-off does, carrying nothing of the live patient.
  it.each([
    ['Open appointments', '/provider/appointments/new'],
    ['Register walk-in visit', '/provider/journey/new'],
  ])('hand-off 01: %s goes to %s at a demo facility', (label, path) => {
    atDemoHospital()
    staff.activePatient = activePatient()
    open('/open')
    expect(nextSteps()).toEqual(['Open appointments', 'Register walk-in visit', 'Open consent', 'Open clinical record'])
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(where()).toBe(path)
    expect(offeredHealthId(DEMO_HOSPITAL_ID, staff.setActivePatient)).toBe('')
    expect(where()).not.toContain(PATIENT_HID)
    expect(where()).not.toContain(PATIENT_ID)
  })

  it('leads into no sample at a real facility: no appointments or walk-in visit, while consent and the clinical record work', () => {
    staff.activePatient = activePatient()
    const first = open('/open')
    expect(screen.getByRole('heading', { name: 'Next steps' })).toBeTruthy()
    expect(nextSteps()).toEqual(['Open consent', 'Open clinical record'])
    expect(screen.queryByRole('button', { name: 'Open appointments' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Register walk-in visit' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open clinical record' }))
    expect(where()).toBe('/provider/clinical')
    first.unmount()
    open('/open')
    fireEvent.click(screen.getByRole('button', { name: 'Open consent' }))
    expect(where()).toBe('/provider/requests/new')
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe(PATIENT_HID)
  })

  it('shows the history loading, then a failure to read it in today’s words', async () => {
    staff.activePatient = activePatient()
    let fail: (reason: unknown) => void = () => {}
    api.encounters.mockReturnValue(new Promise((_resolve, reject) => { fail = reject }))
    open('/open')
    expect(await screen.findByText('Loading encounters…')).toBeTruthy()
    await act(async () => { fail('offline') })
    expect((await screen.findByRole('alert')).textContent).toBe('Encounters could not be loaded.')
  })

  it('says when this facility has no encounters for the patient', async () => {
    staff.activePatient = activePatient()
    api.encounters.mockResolvedValue({ items: [], nextCursor: null })
    open('/open')
    expect(await screen.findByText('No encounters are available for this patient and facility.')).toBeTruthy()
  })

  it('shows that access ended when the re-check is refused', async () => {
    staff.activePatient = activePatient()
    api.lookupPatient.mockRejectedValue(new HidApiError(403, 'Patient access is not authorized', { code: 'PATIENT_ACCESS_DENIED' }))
    open('/open')
    expect(await screen.findByText('Access to this patient ended')).toBeTruthy()
    expect(screen.getByText('Patient access has ended. Reopen the record through governed access.')).toBeTruthy()
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    expect(api.encounters).not.toHaveBeenCalled()
  })

  it('keeps an emergency patient read-only: no visit, consent or chart steps, and no encounters read', async () => {
    // At a demo facility, where the visit step would otherwise show: emergency access alone hides it.
    atDemoHospital()
    staff.activePatient = activePatient('emergency')
    open('/open')
    expect(screen.getByText('Emergency access is read-only')).toBeTruthy()
    expect(nextSteps()).toEqual(['Open the emergency summary'])
    expect(screen.queryByRole('button', { name: 'Register walk-in visit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open consent' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Connected hospital history' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open the emergency summary' }))
    expect(where()).toBe('/provider/emergency/summary')
    expect(api.encounters).not.toHaveBeenCalled()
    expect(api.consentStatus).not.toHaveBeenCalled()
  })

  it('flags a read-only grant with today’s sentence', async () => {
    staff.activePatient = activePatient()
    api.consentStatus.mockResolvedValue({ patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    open('/open')
    expect(await screen.findByText('Read-only access. This authorization does not include changes; ask the patient to approve a read-and-write request to add or change records.')).toBeTruthy()
    expect(within(screen.getByRole('group', { name: 'Flags' })).getByText('Read only')).toBeTruthy()
  })

  it('closes my grant at once, as today, then lists no patient and says so', async () => {
    staff.activePatient = activePatient()
    open('/open')
    fireEvent.click(screen.getByRole('button', { name: 'Close my grant' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(await screen.findByText('Access was closed by the backend.')).toBeTruthy()
    expect(api.closeGrant).toHaveBeenCalledWith(FACILITY_ID, 'grant-1', 'Clinician closed completed patient access')
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    expect(screen.getByRole('heading', { level: 1, name: 'Patients' })).toBeTruthy()
    expect(screen.getByText('No authorized patient')).toBeTruthy()
  })

  it('names what a role lacks to close its grant', () => {
    staff.permissions = ['identity.patient.read']
    staff.activePatient = activePatient()
    open('/open')
    const button = screen.getByRole('button', { name: 'Close my grant' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent)
      .toBe('Your role at this facility cannot close this grant: it needs identity.consent.write. Ask your organization administrator.')
  })

  it('says to choose a patient when none is open', () => {
    open('/open')
    expect(screen.getByText('Choose a patient first.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to patient access →' })).toBeTruthy()
  })
})

describe('Patient sharing', () => {
  it('lists patients shared with this clinician and opens one through the same lookup', async () => {
    api.sharedWithMe.mockResolvedValue([{ consentGrantId: 'grant-9', patientId: PATIENT_ID, hid: PATIENT_HID, fullName: PATIENT_NAME, level: 'view_only', duration: '7d', scope: 'read_records', startsAt: '2026-10-29T08:00:00.000Z', expiresAt: '2026-11-05T08:00:00.000Z' }])
    api.staffShareInvitations.mockResolvedValue({ eligible: true, items: [] })
    open()
    expect(await screen.findByRole('heading', { name: 'Shared with you' })).toBeTruthy()
    expect(screen.getByText('No invitations are waiting for your sign-in email.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: `Open ${PATIENT_NAME}’s record` }))
    expect(await screen.findByRole('heading', { level: 1, name: PATIENT_NAME })).toBeTruthy()
    expect(api.lookupPatient).toHaveBeenCalledWith(FACILITY_ID, PATIENT_HID, 'direct-care')
  })

  it('accepts an invitation and says what happens next', async () => {
    api.staffShareInvitations.mockResolvedValue({ eligible: true, items: [{ invitationId: 'inv-1', reference: 'AB12', inviteeName: null, level: 'clinical_review', duration: '24h', createdAt: '2026-10-29T08:00:00.000Z', expiresAt: '2026-11-05T08:00:00.000Z' }] })
    api.acceptShareInvitation.mockResolvedValue({ invitationId: 'inv-1', status: 'accepted', acceptedAt: '2026-10-30T08:00:00.000Z', replayed: false })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Accept invitation AB12' }))
    const result = await screen.findByText('You accepted invitation AB12. The patient must now confirm before you can open their record. Once they do, they appear under Shared with you.')
    expect(document.activeElement).toBe(result)
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
