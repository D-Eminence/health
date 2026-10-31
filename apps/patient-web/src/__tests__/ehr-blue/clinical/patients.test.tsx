import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type * as Contracts from '@hid/contracts'
import { HidApiError } from '@hid/http'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dropOfferedHealthId, offeredHealthId } from '../../../ehr-blue/clinical/consent/access'
import { formatWhen } from '../../../ehr-blue/clinical/parts/format'
import { PatientsWorkspace, patientsStatus } from '../../../ehr-blue/clinical/patients/PatientsWorkspace'
import {
  BASE, DEMO_HOSPITAL_ID, ENCOUNTER_ID, FACILITY_ID, PATIENT_HID, PATIENT_ID, PATIENT_NAME, activePatient, allowedLookup, deniedLookup, labelled, renderPage,
} from './harness'

/**
 * Patients: the Health ID search (today's governed access), the patient open now and that patient's page with the
 * design's Next steps and Connected hospital history. Everything is fictional.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), closeGrant: vi.fn(), encounters: vi.fn(), verifyPin: vi.fn(),
  sharedWithMe: vi.fn(), staffShareInvitations: vi.fn(), acceptShareInvitation: vi.fn(), reportedHealthProfile: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true), facilityId: undefined as string | undefined, roles: undefined as string[] | undefined }))
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
/**
 * The registry gives Accept the same permission as the invitation list (identity.consent.write), so a role that sees an
 * invitation may accept it. A test can make Accept need another (fictional) permission, to see the role check hold.
 */
const registry = vi.hoisted(() => ({ acceptNeeds: null as string[] | null }))
vi.mock('@hid/contracts', async importOriginal => {
  const actual = await importOriginal<typeof Contracts>()
  const findEndpoint: typeof actual.findEndpoint = name => {
    const endpoint = actual.findEndpoint(name)
    return name === 'identity.staffShareInvitationAccept' && endpoint && registry.acceptNeeds
      ? { ...endpoint, permissions: { POST: registry.acceptNeeds } } : endpoint
  }
  return { ...actual, findEndpoint }
})

const ALL = ['identity.patient.read', 'identity.consent.write', 'identity.consent.read', 'ehr.encounter.read', 'ehr.note.read']
const NOT_FOUND = new HidApiError(404, 'Cannot GET', { code: 'NOT_FOUND' })
const HID_FORMAT = 'Starts with HID-, then 6 to 32 letters and digits. Health IDs never use 0, 1, I or O.'
const CONSENT = { patientId: PATIENT_ID, facilityId: FACILITY_ID, purpose: 'direct-care', readAllowed: true, writeAllowed: true }
const ENCOUNTER = { id: ENCOUNTER_ID, patientId: PATIENT_ID, facilityId: FACILITY_ID, encounterType: 'ambulatory', status: 'in_progress', startedAt: '2026-10-30T08:00:00.000Z', chiefComplaint: null, rowVersion: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  dropOfferedHealthId()
  registry.acceptNeeds = null
  staff.permissions = [...ALL]
  staff.activePatient = null
  staff.facilityId = undefined
  staff.roles = undefined
  staff.setActivePatient.mockImplementation(value => { staff.activePatient = value; return true })
  session.staffSessionGeneration.mockReturnValue(5)
  api.lookupPatient.mockResolvedValue(allowedLookup)
  api.consentStatus.mockResolvedValue(CONSENT)
  api.closeGrant.mockResolvedValue({})
  api.verifyPin.mockResolvedValue({ accessRequestId: 'r1', consentGrantId: 'grant-1', patientId: PATIENT_ID, status: 'active', expiresAt: '2026-10-30T12:00:00.000Z' })
  api.encounters.mockResolvedValue({ items: [ENCOUNTER], nextCursor: null })
  api.sharedWithMe.mockRejectedValue(NOT_FOUND)
  api.staffShareInvitations.mockRejectedValue(NOT_FOUND)
  // The patient has stated nothing about their health: no Allergies row.
  api.reportedHealthProfile.mockResolvedValue(null)
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

/** The line under the patient page's heading (the design's "[status] Saved …"). */
function metaLine() {
  return document.querySelector<HTMLElement>('.hid-ehr-clinical-meta')!
}

/** The patient page's Saved record, label to value. */
function savedRecord() {
  const card = screen.getByRole('heading', { name: 'Saved record' }).closest('section')!
  const labels = Array.from(card.querySelectorAll('dt'), term => term.textContent ?? '')
  const values = Array.from(card.querySelectorAll('dd'), value => value.textContent ?? '')
  return Object.fromEntries(labels.map((label, index) => [label, values[index]]))
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
    // Audit 7: the Emergency workspace's own break-glass page.
    expect(where()).toBe('/provider/emergency/break-glass')
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
  it('shows the access line, the saved facts, the Next steps and this facility’s encounters', async () => {
    staff.activePatient = activePatient()
    open('/open')
    expect(screen.getByRole('heading', { level: 1, name: PATIENT_NAME })).toBeTruthy()
    expect(within(metaLine()).getByText('Access allowed')).toBeTruthy()
    expect(savedRecord()).toEqual(expect.objectContaining({ Name: PATIENT_NAME, 'Date of birth': '4/12/1990', Sex: 'Female', 'Health ID': PATIENT_HID, Access: 'Direct care' }))
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
    expect(nextSteps()).toEqual([])
    expect(screen.queryByRole('button', { name: 'Open consent' })).toBeNull()
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe('')
    expect(await screen.findByRole('link', { name: 'Consultation · e0000000' })).toBeTruthy()
  })

  it('hand-off 01: reads no encounters without ehr.encounter.read, Consultation’s permission, and offers no Open clinical record', async () => {
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
    expect(buttons.map(button => button.textContent)).toEqual(['Close my grant', 'Open appointments', 'Register walk-in visit', 'Open consent'])
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
    expect(nextSteps()).toEqual(['Open appointments', 'Register walk-in visit', 'Open consent'])
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(where()).toBe(path)
    expect(offeredHealthId(DEMO_HOSPITAL_ID, staff.setActivePatient)).toBe('')
    expect(where()).not.toContain(PATIENT_HID)
    expect(where()).not.toContain(PATIENT_ID)
  })

  // The design's roles decide a sample (frame/sampleAccess.ts): a Hospital Admin opens neither Appointments nor Patient visits.
  it('offers a demo facility\'s administrator no appointments or walk-in visit, which would only send them Home', () => {
    atDemoHospital()
    staff.roles = ['org_admin']
    staff.activePatient = activePatient()
    open('/open')
    expect(nextSteps()).toEqual(['Open consent'])
    expect(screen.queryByRole('button', { name: 'Open appointments' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Register walk-in visit' })).toBeNull()
  })

  it('leads into no sample at a real facility: no appointments or walk-in visit, while consent and the encounters work', async () => {
    staff.activePatient = activePatient()
    const first = open('/open')
    expect(screen.getByRole('heading', { name: 'Next steps' })).toBeTruthy()
    expect(nextSteps()).toEqual(['Open consent'])
    expect(screen.queryByRole('button', { name: 'Open appointments' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Register walk-in visit' })).toBeNull()
    fireEvent.click(await screen.findByRole('link', { name: 'Consultation · e0000000' }))
    expect(where()).toBe(`/provider/clinical/${ENCOUNTER_ID}`)
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
    // The read starts after the access check: fail it only once it has been asked for.
    await waitFor(() => expect(api.encounters).toHaveBeenCalled())
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
    expect(within(metaLine()).getByText('Read only')).toBeTruthy()
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

const SHARE = { consentGrantId: 'grant-9', patientId: PATIENT_ID, hid: PATIENT_HID, fullName: PATIENT_NAME, level: 'view_only', duration: '7d', scope: 'read_records', startsAt: '2026-10-29T08:00:00.000Z', expiresAt: '2026-11-05T08:00:00.000Z' }
const INVITATION = { invitationId: 'inv-1', reference: 'AB12', inviteeName: null, level: 'clinical_review', duration: '24h', createdAt: '2026-10-29T08:00:00.000Z', expiresAt: '2026-11-05T08:00:00.000Z' }
const ACCEPTED = 'You accepted invitation AB12. The patient must now confirm before you can open their record. Once they do, they appear under Shared with you.'
const OPEN_SHARED_UNAVAILABLE = 'Your role at this facility cannot open a patient’s record: it needs identity.patient.read. Ask your organization administrator.'

/** The Patients list's rows, each as the text of its five cells. */
function tableRows() {
  const table = screen.getByRole('table', { name: 'Patients' })
  return within(table).getAllByRole('row').slice(1)
}

/** The row whose Record cell names `name`. */
function rowOf(name: string) {
  const row = tableRows().find(candidate => candidate.querySelector('td')?.textContent?.startsWith(name))
  if (!row) throw new Error(`No row for ${name}`)
  return row
}

function quickView() {
  return screen.getByRole('dialog', { name: 'Record quick view' })
}

describe('Patient sharing', () => {
  it('lists patients shared with this clinician and opens one through the same lookup', async () => {
    api.sharedWithMe.mockResolvedValue([SHARE])
    api.staffShareInvitations.mockResolvedValue({ eligible: true, items: [] })
    open()
    expect(await screen.findByText('No invitations are waiting for your sign-in email.')).toBeTruthy()
    const row = rowOf(PATIENT_NAME)
    fireEvent.click(within(row).getByRole('button', { name: `Open ${PATIENT_NAME}` }))
    expect(await screen.findByRole('heading', { level: 1, name: PATIENT_NAME })).toBeTruthy()
    expect(api.lookupPatient).toHaveBeenCalledWith(FACILITY_ID, PATIENT_HID, 'direct-care')
  })

  it('accepts an invitation and says what happens next', async () => {
    api.staffShareInvitations.mockResolvedValue({ eligible: true, items: [INVITATION] })
    api.acceptShareInvitation.mockResolvedValue({ invitationId: 'inv-1', status: 'accepted', acceptedAt: '2026-10-30T08:00:00.000Z', replayed: false })
    open()
    fireEvent.click(within(await waitFor(() => rowOf('Invitation AB12'))).getByRole('button', { name: 'Quick view Invitation AB12' }))
    fireEvent.click(within(quickView()).getByRole('button', { name: 'Accept invitation AB12' }))
    const result = await screen.findByText(ACCEPTED)
    expect(document.activeElement).toBe(result)
    expect(api.acceptShareInvitation).toHaveBeenCalledWith(FACILITY_ID, 'inv-1')
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

describe('Design audit', () => {
  it('audit 1: offers Create record only with identity.registration.write, and it opens today’s Patient registration carrying nothing', async () => {
    const without = open()
    expect(screen.queryByRole('button', { name: 'Create record' })).toBeNull()
    without.unmount()
    staff.permissions = [...ALL, 'identity.registration.write']
    staff.activePatient = activePatient()
    open()
    const heading = screen.getByRole('heading', { level: 1, name: 'Patients' }).parentElement!.parentElement!
    const create = within(heading).getByRole('button', { name: 'Create record' })
    fireEvent.click(create)
    expect(where()).toBe('/provider/registration')
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe('')
    expect(staff.setActivePatient).not.toHaveBeenCalled()
  })

  it('audit 2: a share is a row after the open patient: name over Health ID in Patient / context, the level badge, until its day, opened by the lookup', async () => {
    staff.activePatient = activePatient()
    api.sharedWithMe.mockResolvedValue([{ ...SHARE, consentGrantId: 'grant-8', hid: 'HID-ZDEMBBB3', fullName: 'Patient Two', startsAt: '2026-10-28T07:00:00.000Z' }])
    api.staffShareInvitations.mockResolvedValue({ eligible: true, items: [INVITATION] })
    open()
    await waitFor(() => expect(tableRows()).toHaveLength(3))
    expect(tableRows().map(row => row.querySelector('td')?.textContent)).toEqual([
      `${PATIENT_NAME}Direct care`, 'Patient TwoShared with you', 'Invitation AB1224 hours · sent 29 Oct 2026',
    ])
    // Patient / context holds the name over the Health ID, as on the open patient's row and in the design.
    expect(tableRows().map(row => row.querySelectorAll('td')[1]?.textContent)).toEqual([
      `${PATIENT_NAME}${PATIENT_HID}`, 'Patient TwoHID-ZDEMBBB3', 'Clinical Review',
    ])
    // Updated, as on every row of the design: when the share began, and when the invitation was sent.
    expect(tableRows().slice(1).map(row => row.querySelectorAll('td')[3]?.textContent)).toEqual([formatWhen('2026-10-28T07:00:00.000Z'), formatWhen(INVITATION.createdAt)])
    expect(formatWhen(INVITATION.createdAt)).not.toBe('')
    // The two cards are gone: their rows are in the one list.
    expect(screen.queryByRole('heading', { name: 'Shared with you' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Invitations' })).toBeNull()
    const row = rowOf('Patient Two')
    expect(within(row).getByText('View Only')).toBeTruthy()
    expect(within(row).getByText('until 5 Nov 2026')).toBeTruthy()
    expect(within(row).getByText('Shared with you')).toBeTruthy()
    // An action, not a link: the address names no patient.
    expect(within(row).queryByRole('link')).toBeNull()
    const name = within(row).getByRole('button', { name: 'Patient Two' })
    expect(name.classList.contains('hid-ehr-clinical-link')).toBe(true)
    api.lookupPatient.mockResolvedValue({ ...allowedLookup, patient: { ...allowedLookup.patient, patientId: 'a0000000-0000-4000-8000-000000000002', hid: 'HID-ZDEMBBB3', fullName: 'Patient Two' } })
    fireEvent.click(name)
    expect(await screen.findByRole('heading', { level: 1, name: 'Patient Two' })).toBeTruthy()
    expect(api.lookupPatient).toHaveBeenCalledWith(FACILITY_ID, 'HID-ZDEMBBB3', 'direct-care')
  })

  it('audit 2: a share’s quick view opens it through the lookup with Open full record, and closes', async () => {
    api.sharedWithMe.mockResolvedValue([SHARE])
    open()
    fireEvent.click(within(await waitFor(() => rowOf(PATIENT_NAME))).getByRole('button', { name: `Quick view ${PATIENT_NAME}` }))
    expect(within(quickView()).getByText(PATIENT_HID)).toBeTruthy()
    expect(within(quickView()).getByText('View Only')).toBeTruthy()
    expect(within(quickView()).getByText('5 Nov 2026')).toBeTruthy()
    fireEvent.click(within(quickView()).getByRole('button', { name: 'Open full record' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await screen.findByRole('heading', { level: 1, name: PATIENT_NAME })).toBeTruthy()
    expect(api.lookupPatient).toHaveBeenCalledWith(FACILITY_ID, PATIENT_HID, 'direct-care')
  })

  it('audit 2: a refused share shows today’s access options, as a refused search does', async () => {
    api.sharedWithMe.mockResolvedValue([SHARE])
    api.lookupPatient.mockRejectedValue(new HidApiError(403, 'Patient access is not authorized', { code: 'PATIENT_ACCESS_DENIED' }))
    open()
    fireEvent.click(within(await waitFor(() => rowOf(PATIENT_NAME))).getByRole('button', { name: `Open ${PATIENT_NAME}` }))
    const banner = (await screen.findByText('No access to this patient yet')).closest('section')!
    expect(within(banner).getByText('Patient access is not authorized')).toBeTruthy()
    expect(where()).toBeNull()
  })

  it('audit 2: while a lookup runs, a share’s buttons say they are unavailable and a press does nothing', async () => {
    api.sharedWithMe.mockResolvedValue([SHARE])
    let answer: (value: unknown) => void = () => {}
    api.lookupPatient.mockReturnValue(new Promise(resolve => { answer = resolve }))
    open()
    fireEvent.change(searchField(), { target: { value: PATIENT_HID } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify access' }))
    const row = await waitFor(() => rowOf(PATIENT_NAME))
    const button = within(row).getByRole('button', { name: `Open ${PATIENT_NAME}` })
    await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('true'))
    expect(within(row).getByRole('button', { name: PATIENT_NAME }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(button)
    expect(api.lookupPatient).toHaveBeenCalledTimes(1)
    await act(async () => { answer(allowedLookup) })
    expect(await screen.findByRole('heading', { level: 1, name: PATIENT_NAME })).toBeTruthy()
  })

  it('audit 2: a role that cannot look a patient up sees each share disabled with today’s reason', async () => {
    staff.permissions = ['identity.consent.write']
    api.sharedWithMe.mockResolvedValue([SHARE])
    open()
    const row = await waitFor(() => rowOf(PATIENT_NAME))
    for (const name of [PATIENT_NAME, `Open ${PATIENT_NAME}`]) {
      const button = within(row).getByRole('button', { name }) as HTMLButtonElement
      expect(button.disabled).toBe(true)
      expect(describedBy(button)).toBe(OPEN_SHARED_UNAVAILABLE)
    }
    fireEvent.click(within(row).getByRole('button', { name: `Quick view ${PATIENT_NAME}` }))
    const full = within(quickView()).getByRole('button', { name: 'Open full record' }) as HTMLButtonElement
    expect(full.disabled).toBe(true)
    expect(describedBy(full)).toBe(OPEN_SHARED_UNAVAILABLE)
    expect(api.lookupPatient).not.toHaveBeenCalled()
  })

  it('audit 2: an invitation is an “invited” row that opens nothing; its quick view holds Accept, which closes it and says what happened', async () => {
    api.staffShareInvitations.mockResolvedValue({ eligible: true, items: [{ ...INVITATION, inviteeName: 'Dr Demo' }] })
    let answer: (value: unknown) => void = () => {}
    api.acceptShareInvitation.mockReturnValue(new Promise(resolve => { answer = resolve }))
    open()
    const row = await waitFor(() => rowOf('Invitation AB12'))
    expect(within(row).getByText('invited')).toBeTruthy()
    expect(within(row).getByText('open until 5 Nov 2026')).toBeTruthy()
    expect(within(row).getByText('Clinical Review')).toBeTruthy()
    expect(within(row).getByText('To Dr Demo')).toBeTruthy()
    // No patient is named and nothing opens: no link, no "Open →", only the quick view.
    expect(within(row).queryByRole('link')).toBeNull()
    expect(within(row).getAllByRole('button').map(button => button.textContent)).toEqual(['Quick view'])
    expect(within(row).queryByRole('button', { name: 'Accept invitation AB12' })).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: 'Quick view Invitation AB12' }))
    const drawer = quickView()
    expect(within(drawer).getByText('Patients can invite you by email to see their record. Accept here, signed in with that email; the patient then confirms, and is not named until they do.')).toBeTruthy()
    expect(within(drawer).queryByRole('button', { name: 'Open full record' })).toBeNull()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Accept invitation AB12' }))
    expect(within(drawer).getByRole('button', { name: 'Accept invitation AB12' }).textContent).toContain('Accepting…')
    await act(async () => { answer({ invitationId: 'inv-1', status: 'accepted', acceptedAt: '2026-10-30T08:00:00.000Z', replayed: false }) })
    expect(screen.queryByRole('dialog')).toBeNull()
    const result = screen.getByText(ACCEPTED)
    expect(result.closest('[role="status"]')).not.toBeNull()
    expect(document.activeElement).toBe(result)
    expect(screen.queryByText('Invitation AB12')).toBeNull()
  })

  it('audit 2: a refused Accept closes the quick view, focuses today’s refusal and keeps a still-waiting invitation', async () => {
    api.staffShareInvitations.mockResolvedValue({ eligible: true, items: [INVITATION] })
    api.acceptShareInvitation.mockRejectedValue(new HidApiError(403, 'Forbidden', { code: 'SHARE_PROVIDER_NOT_ELIGIBLE' }))
    open()
    fireEvent.click(within(await waitFor(() => rowOf('Invitation AB12'))).getByRole('button', { name: 'Quick view Invitation AB12' }))
    fireEvent.click(within(quickView()).getByRole('button', { name: 'Accept invitation AB12' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Your role at this facility cannot receive patient records through Health ID.')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(alert.parentElement)
    expect(rowOf('Invitation AB12')).toBeTruthy()
  })

  it('audit 2: an invitation that is gone leaves the list, with today’s words', async () => {
    api.staffShareInvitations.mockResolvedValue({ eligible: true, items: [INVITATION] })
    api.acceptShareInvitation.mockRejectedValue(new HidApiError(409, 'Conflict', { code: 'SHARE_INVITATION_NOT_PENDING' }))
    open()
    fireEvent.click(within(await waitFor(() => rowOf('Invitation AB12'))).getByRole('button', { name: 'Quick view Invitation AB12' }))
    fireEvent.click(within(quickView()).getByRole('button', { name: 'Accept invitation AB12' }))
    expect((await screen.findByRole('alert')).textContent).toBe('This invitation has already been accepted, cancelled or has ended.')
    expect(screen.queryByText('Invitation AB12')).toBeNull()
    expect(screen.getByText('No authorized patient')).toBeTruthy()
  })

  it('audit 2: what the sharing lists said shows under the list, in today’s words', async () => {
    api.sharedWithMe.mockRejectedValue(new HidApiError(503, '', { code: 'SERVICE_UNAVAILABLE' }))
    api.staffShareInvitations.mockResolvedValue({ eligible: false, items: [] })
    const first = open()
    expect(await screen.findByText('The patients shared with you could not be loaded.')).toBeTruthy()
    expect(screen.getByText('Only a doctor, clinician or nurse at a facility Health ID has checked can accept invitations. Your role here cannot, so invitations sent to your email are not shown. Switch to such a facility to see them.')).toBeTruthy()
    // Under the (empty) list, in its card.
    const note = screen.getByText('The patients shared with you could not be loaded.')
    expect(screen.getByText('No authorized patient').compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(note.closest('.hid-ehr-card')).toBe(searchField().closest('.hid-ehr-card'))
    first.unmount()
    api.sharedWithMe.mockResolvedValue([])
    api.staffShareInvitations.mockRejectedValue(new HidApiError(500, 'Invitations are unavailable', { code: 'INTERNAL' }))
    open()
    expect(await screen.findByText('No patient has shared their record with you here.')).toBeTruthy()
    expect(screen.getByText('Invitations are unavailable')).toBeTruthy()
    // Nothing shared and nothing open: the list still says how to open a patient.
    expect(screen.getByText('No authorized patient')).toBeTruthy()
  })

  it('audit 3: the meta line is the access the patient is open under, with Read only when changes are unavailable; no patient header', async () => {
    staff.activePatient = activePatient()
    api.consentStatus.mockResolvedValue({ ...CONSENT, writeAllowed: false })
    open('/open')
    const meta = metaLine()
    expect(meta.parentElement?.querySelector('h1')).toBeTruthy()
    expect(within(meta).getByText('Access allowed')).toBeTruthy()
    expect(await within(meta).findByText('Read only')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Patient' })).toBeNull()
    // Owner decision 4: the labels are written properly.
    const labels = Object.keys(savedRecord())
    expect(labels).toEqual(expect.arrayContaining(['Name', 'Date of birth', 'Sex', 'Health ID']))
    expect(labels).not.toContain('Dob')
    expect(labels).not.toContain('Health Id')
  })

  it('audit 3: an emergency patient’s meta line says Emergency access, never Read only', async () => {
    staff.activePatient = activePatient('emergency')
    open('/open')
    const meta = metaLine()
    expect(within(meta).getByText('Emergency access')).toBeTruthy()
    expect(within(meta).queryByText('Read only')).toBeNull()
    expect(savedRecord()).toEqual(expect.objectContaining({ Access: 'Emergency (read-only)' }))
  })

  it('audit 4: Next steps are the design’s three, with no Open clinical record', () => {
    atDemoHospital()
    staff.activePatient = activePatient()
    open('/open')
    expect(nextSteps()).toEqual(['Open appointments', 'Register walk-in visit', 'Open consent'])
    expect(screen.queryByRole('button', { name: 'Open clinical record' })).toBeNull()
  })

  it('audit 7: the refused lookup’s Emergency break-glass access opens the Emergency break-glass page, and stays disabled with today’s reason without the permission', async () => {
    const without = await refusedBanner()
    const disabled = within(without).getByRole('button', { name: 'Emergency break-glass access' }) as HTMLButtonElement
    expect(disabled.disabled).toBe(true)
    expect(describedBy(disabled)).toBe(EMERGENCY_UNAVAILABLE)
    cleanup()
    staff.permissions = [...ALL, 'identity.break-glass.write']
    const banner = await refusedBanner()
    fireEvent.click(within(banner).getByRole('button', { name: 'Emergency break-glass access' }))
    expect(where()).toBe('/provider/emergency/break-glass')
    expect(where()).not.toContain(PATIENT_HID)
  })

  it('follow-up 5: the refused lookup’s Emergency break-glass access hands its Health ID to the break-glass form, and none without the permission', async () => {
    const without = await refusedBanner()
    fireEvent.click(within(without).getByRole('button', { name: 'Emergency break-glass access' }))
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe('')
    cleanup()
    staff.permissions = [...ALL, 'identity.break-glass.write']
    const banner = await refusedBanner()
    fireEvent.click(within(banner).getByRole('button', { name: 'Emergency break-glass access' }))
    // Offered in memory for the form, never in the address.
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe(PATIENT_HID)
    expect(where()).not.toContain(PATIENT_HID)
  })

  it('audit 9: Saved record lists the patient-reported allergies, read for direct care with ehr.note.read', async () => {
    staff.activePatient = activePatient()
    api.reportedHealthProfile.mockResolvedValue({ bloodGroup: null, genotype: null, allergies: 'Fictional Med A', currentMedications: null, chronicConditions: null, medicalNotes: null, updatedAt: null })
    open('/open')
    await waitFor(() => expect(savedRecord().Allergies).toBe('Fictional Med A (patient-reported)'))
    expect(Object.keys(savedRecord()).at(-1)).toBe('Allergies')
    expect(api.reportedHealthProfile).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, expect.any(AbortSignal))
  })

  it('audit 9: a profile without allergies says Not stated, as today’s card does', async () => {
    staff.activePatient = activePatient()
    api.reportedHealthProfile.mockResolvedValue({ bloodGroup: 'O+', genotype: null, allergies: null, currentMedications: null, chronicConditions: null, medicalNotes: null, updatedAt: null })
    open('/open')
    await waitFor(() => expect(savedRecord().Allergies).toBe('Not stated (patient-reported)'))
  })

  it('audit 9: no Allergies row while it loads, without ehr.note.read, under emergency access, or when refused (403) or not served (404)', async () => {
    staff.activePatient = activePatient()
    api.reportedHealthProfile.mockReturnValue(new Promise(() => {}))
    const loading = open('/open')
    await act(async () => {})
    expect(savedRecord().Allergies).toBeUndefined()
    loading.unmount()
    for (const status of [403, 404]) {
      api.reportedHealthProfile.mockRejectedValue(new HidApiError(status, 'No', { code: status === 403 ? 'FORBIDDEN' : 'NOT_FOUND' }))
      const refused = open('/open')
      await act(async () => {})
      expect(savedRecord().Allergies).toBeUndefined()
      expect(screen.queryByRole('alert')).toBeNull()
      refused.unmount()
    }
    api.reportedHealthProfile.mockClear()
    staff.permissions = ALL.filter(permission => permission !== 'ehr.note.read')
    const unpermitted = open('/open')
    await act(async () => {})
    expect(savedRecord().Allergies).toBeUndefined()
    unpermitted.unmount()
    staff.permissions = [...ALL]
    staff.activePatient = activePatient('emergency')
    open('/open')
    await act(async () => {})
    expect(savedRecord().Allergies).toBeUndefined()
    expect(api.reportedHealthProfile).not.toHaveBeenCalled()
  })

  it('audit 9: another failure says so in today’s words, and today’s retry reads again', async () => {
    staff.activePatient = activePatient()
    api.reportedHealthProfile.mockRejectedValueOnce(new HidApiError(503, 'Unavailable', { code: 'SERVICE_UNAVAILABLE' }))
    api.reportedHealthProfile.mockResolvedValueOnce({ bloodGroup: null, genotype: null, allergies: 'Fictional Med A', currentMedications: null, chronicConditions: null, medicalNotes: null, updatedAt: null })
    open('/open')
    await waitFor(() => expect(savedRecord().Allergies).toBe('What the patient entered about their health could not be loaded. Retry patient-reported health information'))
    fireEvent.click(screen.getByRole('button', { name: 'Retry patient-reported health information' }))
    await waitFor(() => expect(savedRecord().Allergies).toBe('Fictional Med A (patient-reported)'))
    expect(api.reportedHealthProfile).toHaveBeenCalledTimes(2)
  })
})

const HOW_TO_OPEN = 'No authorized patient. Open a patient using an approved request, patient PIN, or documented emergency access.'
const SHARED_INTRO = 'Patients who chose to share their record with you at this facility. Opening one checks access with the server.'
const ACCEPT_ANSWER = { invitationId: 'inv-1', status: 'accepted', acceptedAt: '2026-10-30T08:00:00.000Z', replayed: false }
const PATIENT_TWO_ID = 'a0000000-0000-4000-8000-000000000002'
const lookupTwo = {
  patient: { ...allowedLookup.patient, patientId: PATIENT_TWO_ID, hid: 'HID-ZDEMBBB3', fullName: 'Patient Two' },
  authorization: { ...allowedLookup.authorization, consentGrantId: 'grant-2' },
}

/** A patient-reported profile with only `allergies` stated. */
function profile(allergies: string | null) {
  return { bloodGroup: null, genotype: null, allergies, currentMedications: null, chronicConditions: null, medicalNotes: null, updatedAt: null }
}

/** The Patients workspace as renderPage draws it, so a test can draw it again after the session changes. */
function page(rest = '') {
  return (
    <MemoryRouter initialEntries={[`${BASE}/patients${rest}`]}>
      <Routes><Route path={`${BASE}/patients/*`} element={<PatientsWorkspace />} /></Routes>
    </MemoryRouter>
  )
}

/** Lets every pending promise settle (one task later), so a test can tell "nothing shown" from "not answered yet". */
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

describe('Design audit: kept rules of the sharing rows and the Allergies row', () => {
  it('audit 2: an Accept that ends after the user closed its quick view and moved on leaves focus where they put it', async () => {
    api.staffShareInvitations.mockResolvedValue({ eligible: true, items: [INVITATION] })
    let answer: (value: unknown) => void = () => {}
    api.acceptShareInvitation.mockReturnValue(new Promise(resolve => { answer = resolve }))
    open()
    fireEvent.click(within(await waitFor(() => rowOf('Invitation AB12'))).getByRole('button', { name: 'Quick view Invitation AB12' }))
    fireEvent.click(within(quickView()).getByRole('button', { name: 'Accept invitation AB12' }))
    fireEvent.keyDown(quickView(), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    searchField().focus()
    await act(async () => { answer(ACCEPT_ANSWER) })
    // Still said, in the status region; only focus stays (today's useFocusById ifLost).
    expect(screen.getByText(ACCEPTED).closest('[role="status"]')).not.toBeNull()
    expect(document.activeElement).toBe(searchField())
    expect(screen.queryByText('Invitation AB12')).toBeNull()
  })

  it('audit 2: with only an invitation listed and no patient open, the list still says how a patient is opened', async () => {
    api.sharedWithMe.mockResolvedValue([])
    api.staffShareInvitations.mockResolvedValue({ eligible: true, items: [INVITATION] })
    const first = open()
    await waitFor(() => expect(tableRows()).toHaveLength(1))
    const how = screen.getByText(HOW_TO_OPEN)
    expect(screen.getByRole('table', { name: 'Patients' }).compareDocumentPosition(how) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(how.closest('.hid-ehr-card')).toBe(searchField().closest('.hid-ehr-card'))
    expect(screen.getByText('No patient has shared their record with you here.')).toBeTruthy()
    first.unmount()
    // With a patient open, that patient's row comes first and the sentence is not needed.
    staff.activePatient = activePatient()
    api.sharedWithMe.mockResolvedValue([{ ...SHARE, consentGrantId: 'grant-8', hid: 'HID-ZDEMBBB3', fullName: 'Patient Two' }])
    open()
    await waitFor(() => expect(tableRows()).toHaveLength(3))
    expect(screen.queryByText(HOW_TO_OPEN)).toBeNull()
  })

  it('audit 2: a share’s quick view keeps today’s sentence that opening one checks access with the server', async () => {
    api.sharedWithMe.mockResolvedValue([SHARE])
    api.staffShareInvitations.mockResolvedValue({ eligible: true, items: [INVITATION] })
    open()
    fireEvent.click(within(await waitFor(() => rowOf(PATIENT_NAME))).getByRole('button', { name: `Quick view ${PATIENT_NAME}` }))
    const intro = within(quickView()).getByText(SHARED_INTRO)
    expect(intro.compareDocumentPosition(within(quickView()).getByRole('button', { name: 'Open full record' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.keyDown(quickView(), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // An invitation's quick view has its own sentence, not this one.
    fireEvent.click(within(rowOf('Invitation AB12')).getByRole('button', { name: 'Quick view Invitation AB12' }))
    expect(within(quickView()).queryByText(SHARED_INTRO)).toBeNull()
  })

  it('audit 2: a role the registry does not let accept sees Accept disabled in the quick view, and nothing is accepted', async () => {
    registry.acceptNeeds = ['identity.share-invitation.accept']
    api.staffShareInvitations.mockResolvedValue({ eligible: true, items: [INVITATION] })
    open()
    fireEvent.click(within(await waitFor(() => rowOf('Invitation AB12'))).getByRole('button', { name: 'Quick view Invitation AB12' }))
    const accept = within(quickView()).getByRole('button', { name: 'Accept invitation AB12' }) as HTMLButtonElement
    expect(accept.disabled).toBe(true)
    fireEvent.click(accept)
    await settle()
    expect(api.acceptShareInvitation).not.toHaveBeenCalled()
    expect(rowOf('Invitation AB12')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('audit 2: no share or invitation rows while their lists load, and the list says no patient is open', async () => {
    api.sharedWithMe.mockReturnValue(new Promise(() => {}))
    api.staffShareInvitations.mockReturnValue(new Promise(() => {}))
    open()
    await settle()
    expect(api.sharedWithMe).toHaveBeenCalledWith(FACILITY_ID, expect.any(AbortSignal))
    expect(api.staffShareInvitations).toHaveBeenCalledWith(FACILITY_ID, expect.any(AbortSignal))
    expect(screen.queryByRole('button', { name: /^Quick view / })).toBeNull()
    expect(screen.getByText('No authorized patient')).toBeTruthy()
    expect(screen.getByText('Open a patient using an approved request, patient PIN, or documented emergency access.')).toBeTruthy()
    expect(screen.queryByText(HOW_TO_OPEN)).toBeNull()
    expect(screen.queryByText('No invitations are waiting for your sign-in email.')).toBeNull()
    expect(screen.queryByText('No patient has shared their record with you here.')).toBeNull()
  })

  it('audit 2: another facility drops what Accept did, and what it refused, at the one before', async () => {
    api.staffShareInvitations.mockResolvedValue({ eligible: true, items: [INVITATION, { ...INVITATION, invitationId: 'inv-2', reference: 'CD34' }] })
    api.acceptShareInvitation.mockResolvedValueOnce(ACCEPT_ANSWER)
      .mockRejectedValueOnce(new HidApiError(403, 'Forbidden', { code: 'SHARE_PERMISSION_DENIED' }))
    const view = render(page())
    fireEvent.click(within(await waitFor(() => rowOf('Invitation AB12'))).getByRole('button', { name: 'Quick view Invitation AB12' }))
    fireEvent.click(within(quickView()).getByRole('button', { name: 'Accept invitation AB12' }))
    expect(await screen.findByText(ACCEPTED)).toBeTruthy()
    staff.facilityId = DEMO_HOSPITAL_ID
    view.rerender(page())
    expect(screen.queryByText(ACCEPTED)).toBeNull()
    await waitFor(() => expect(api.staffShareInvitations).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, expect.any(AbortSignal)))
    fireEvent.click(within(await waitFor(() => rowOf('Invitation CD34'))).getByRole('button', { name: 'Quick view Invitation CD34' }))
    fireEvent.click(within(quickView()).getByRole('button', { name: 'Accept invitation CD34' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Sharing is not available for your account at this facility.')
    expect(api.acceptShareInvitation).toHaveBeenLastCalledWith(DEMO_HOSPITAL_ID, 'inv-2')
    staff.facilityId = undefined
    view.rerender(page())
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('Sharing is not available for your account at this facility.')).toBeNull()
  })

  it('audit 9: a failure that is not the service’s answer (a plain Error, or a read that throws at once) shows no Allergies row and no retry', async () => {
    staff.activePatient = activePatient()
    api.reportedHealthProfile.mockRejectedValue(new Error('offline'))
    const rejected = open('/open')
    await settle()
    expect(savedRecord().Allergies).toBeUndefined()
    expect(screen.queryByRole('button', { name: 'Retry patient-reported health information' })).toBeNull()
    rejected.unmount()
    api.reportedHealthProfile.mockImplementation(() => { throw new TypeError('not a function') })
    open('/open')
    await settle()
    // This row's failure, never the page's.
    expect(screen.getByRole('heading', { level: 1, name: PATIENT_NAME })).toBeTruthy()
    expect(savedRecord().Allergies).toBeUndefined()
    expect(screen.queryByRole('button', { name: 'Retry patient-reported health information' })).toBeNull()
    expect(api.reportedHealthProfile).toHaveBeenCalledTimes(2)
  })

  it('audit 9: an answer for the patient open before is never shown for the patient open now', async () => {
    staff.activePatient = activePatient()
    let answerOne: (value: unknown) => void = () => {}
    let answerTwo: (value: unknown) => void = () => {}
    api.reportedHealthProfile
      .mockReturnValueOnce(new Promise(resolve => { answerOne = resolve }))
      .mockReturnValueOnce(new Promise(resolve => { answerTwo = resolve }))
    const view = render(page('/open'))
    // Patient One's re-check and encounters are done before Patient Two opens.
    expect(await screen.findByRole('link', { name: 'Consultation · e0000000' })).toBeTruthy()
    expect(api.reportedHealthProfile).toHaveBeenCalledWith(FACILITY_ID, PATIENT_ID, expect.any(AbortSignal))
    api.lookupPatient.mockResolvedValue(lookupTwo)
    api.consentStatus.mockResolvedValue({ ...CONSENT, patientId: PATIENT_TWO_ID })
    staff.activePatient = { hid: 'HID-ZDEMBBB3', purpose: 'direct-care', lookup: lookupTwo }
    view.rerender(page('/open'))
    expect(screen.getByRole('heading', { level: 1, name: 'Patient Two' })).toBeTruthy()
    await waitFor(() => expect(api.reportedHealthProfile).toHaveBeenLastCalledWith(FACILITY_ID, PATIENT_TWO_ID, expect.any(AbortSignal)))
    await act(async () => { answerOne(profile('Fictional Med A')) })
    await settle()
    expect(savedRecord().Name).toBe('Patient Two')
    expect(savedRecord().Allergies).toBeUndefined()
    expect(screen.queryByText(/Fictional Med A/)).toBeNull()
    await act(async () => { answerTwo(profile('Fictional Med B')) })
    await waitFor(() => expect(savedRecord().Allergies).toBe('Fictional Med B (patient-reported)'))
  })
})
