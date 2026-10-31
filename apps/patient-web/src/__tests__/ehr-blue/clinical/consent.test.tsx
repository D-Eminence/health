import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dropOfferedHealthId, offerHealthId, offeredHealthId } from '../../../ehr-blue/clinical/consent/access'
import { ConsentWorkspace, consentStatus } from '../../../ehr-blue/clinical/consent/ConsentWorkspace'
import { CROSS_INSTITUTION } from '../../../ehr-blue/clinical/consent/RequestDetail'
import { ACKNOWLEDGE } from '../../../ehr-blue/clinical/emergency/BreakGlass'
import { formatWhen } from '../../../ehr-blue/clinical/parts/format'
import { FACILITY_ID, PATIENT_HID, PATIENT_ID, activePatient, allowedLookup, deniedLookup, labelled, renderPage } from './harness'

/**
 * External record access: today's access requests (list, outcomes, Close access), a new request and the patient PIN,
 * drawn as the design's list, create and record pages. Everything is fictional.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), listAccessRequests: vi.fn(), requestAccess: vi.fn(), verifyPin: vi.fn(), closeGrant: vi.fn(),
  breakGlass: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[], activePatient: null as unknown, setActivePatient: vi.fn((_value: unknown) => true) }))
const session = vi.hoisted(() => ({
  staffSessionGeneration: vi.fn(() => 3), untilStaffSessionReady: vi.fn(async (_sentIn: number) => {}),
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

const SENT = 'Request r0000000-0000-4000-8000-000000000001 is pending. The patient must approve before records are available.'
const ALL = ['identity.patient.read', 'identity.consent.write', 'identity.patient-access-pin.verify', 'identity.break-glass.write', 'ehr.encounter.read', 'ehr.note.read']

function request(overrides: Record<string, unknown> = {}) {
  return {
    accessRequestId: 'r0000000-0000-4000-8000-000000000001', patientId: PATIENT_ID, scope: 'read_records', purposeOfUse: 'direct-care',
    reason: 'Follow-up consultation', status: 'pending', requestedDurationMinutes: 30, requestedAt: '2026-10-30T09:00:00.000Z',
    approvedAt: null, deniedAt: null, deniedReason: null, ...overrides,
  }
}

const ACTIVE = request({
  accessRequestId: 'r0000000-0000-4000-8000-000000000002', reason: 'Review of results', status: 'approved', effectiveStatus: 'active',
  approvedAt: '2026-10-30T09:05:00.000Z', consentGrantId: 'grant-1', grantExpiresAt: '2026-10-30T10:05:00.000Z', authorizationMethod: 'patient_approval',
})
const DENIED = request({
  accessRequestId: 'r0000000-0000-4000-8000-000000000003', reason: 'Medication review', status: 'denied', deniedAt: '2026-10-30T09:10:00.000Z',
  deniedReason: 'Not my clinician', effectiveStatus: 'denied',
})

beforeEach(() => {
  vi.clearAllMocks()
  dropOfferedHealthId()
  staff.permissions = [...ALL]
  staff.activePatient = null
  staff.setActivePatient.mockImplementation(value => { staff.activePatient = value; return true })
  session.staffSessionGeneration.mockReturnValue(3)
  session.untilStaffSessionReady.mockResolvedValue(undefined)
  api.listAccessRequests.mockResolvedValue([request(), ACTIVE, DENIED])
  api.requestAccess.mockResolvedValue(request())
  api.verifyPin.mockResolvedValue({ accessRequestId: 'r1', consentGrantId: 'grant-1', patientId: PATIENT_ID, status: 'active', expiresAt: '2026-10-30T12:00:00.000Z' })
  api.lookupPatient.mockResolvedValue(allowedLookup)
  api.closeGrant.mockResolvedValue({})
  api.breakGlass.mockResolvedValue({ accessRequestId: 'request-9', consentGrantId: 'grant-9', patientId: PATIENT_ID, status: 'active', expiresAt: '2026-10-30T12:00:00.000Z' })
  api.consentStatus.mockResolvedValue({ writeAllowed: true })
})

function open(rest = '') {
  return renderPage(<ConsentWorkspace />, 'consent', rest)
}

function where() {
  return screen.queryByTestId('elsewhere')?.textContent ?? null
}

describe('External record access list', () => {
  it('is live, titled as the sidebar names it, and lists this facility’s requests with today’s outcomes', async () => {
    expect(consentStatus).toBe('live')
    open()
    expect(screen.getByRole('heading', { level: 1, name: 'External record access' })).toBeTruthy()
    expect(screen.getByText('Loading requests…')).toBeTruthy()
    const table = await screen.findByRole('table', { name: 'Access requests' })
    expect(api.listAccessRequests).toHaveBeenCalledWith(FACILITY_ID, undefined)
    expect(within(table).getByRole('link', { name: 'Follow-up consultation' }).getAttribute('href')).toBe('/provider/requests/r0000000-0000-4000-8000-000000000001')
    expect(within(table).getAllByText('Patient ••••0001')).toHaveLength(3)
    expect(within(table).getByText('Waiting for the patient')).toBeTruthy()
    expect(within(table).getByText('Access active')).toBeTruthy()
    expect(within(table).getByText('Denied by the patient')).toBeTruthy()
    expect(within(table).getByText(/^Patient approval · until /)).toBeTruthy()
    expect(within(table).getByText('Not my clinician')).toBeTruthy()
    // No patient name or Health ID anywhere on the list.
    expect(document.body.textContent).not.toContain(PATIENT_HID)
  })

  it('opens a request in the quick view, which Escape closes, and Create record goes to the new request', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Quick view Review of results' }))
    const drawer = screen.getByRole('dialog', { name: 'Record quick view' })
    expect(within(drawer).getByText('Read records')).toBeTruthy()
    fireEvent.keyDown(drawer, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Record quick view' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Create record' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'New external record access' })).toBeTruthy()
  })

  it('audit 5: the heading’s only action is Create record, with identity.consent.write; no PIN button, Status select or Refresh', async () => {
    open()
    await screen.findByRole('table', { name: 'Access requests' })
    const heading = screen.getByRole('heading', { level: 1, name: 'External record access' }).closest<HTMLElement>('.hid-ehr-page-heading')!
    expect(within(heading).getAllByRole('button').map(button => button.textContent)).toEqual(['Create record'])
    expect(screen.queryByRole('button', { name: 'Verify patient PIN' })).toBeNull()
    expect(screen.queryByLabelText('Status')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull()
  })

  it('audit 5: offers no Create record without identity.consent.write, and still lists the requests', async () => {
    staff.permissions = ALL.filter(permission => permission !== 'identity.consent.write')
    open()
    expect(await screen.findByRole('table', { name: 'Access requests' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create record' })).toBeNull()
  })

  it('audit 5: the patient PIN page is still served at its own address', () => {
    open('/pin')
    expect(screen.getByRole('heading', { level: 1, name: 'Patient PIN access' })).toBeTruthy()
  })

  it('audit 5: reads every status once, with no status filter, and the search matches a request’s status as well as its words', async () => {
    open()
    await screen.findByRole('table', { name: 'Access requests' })
    expect(api.listAccessRequests).toHaveBeenCalledTimes(1)
    expect(api.listAccessRequests).toHaveBeenCalledWith(FACILITY_ID, undefined)
    const search = () => screen.getByLabelText('Search External record access')
    fireEvent.change(search(), { target: { value: 'medication' } })
    expect(screen.queryByRole('link', { name: 'Follow-up consultation' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Medication review' })).toBeTruthy()
    // The status a filter used to choose is found by searching for it.
    fireEvent.change(search(), { target: { value: 'waiting for the patient' } })
    expect(screen.getByRole('link', { name: 'Follow-up consultation' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Review of results' })).toBeNull()
    fireEvent.change(search(), { target: { value: 'access active' } })
    expect(screen.getByRole('link', { name: 'Review of results' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Medication review' })).toBeNull()
    fireEvent.change(search(), { target: { value: 'nothing like it' } })
    expect(screen.getByText('No matching records')).toBeTruthy()
    expect(screen.getByText('Change your search.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getAllByText('Patient ••••0001')).toHaveLength(3)
    expect(api.listAccessRequests).toHaveBeenCalledTimes(1)
  })

  it('says why the list could not be read, in today’s words', async () => {
    api.listAccessRequests.mockRejectedValue(new HidApiError(403, 'Denied', { code: 'CONSENT_COMMAND_DENIED' }))
    open()
    expect((await screen.findByRole('alert')).textContent).toBe('Your role at this facility cannot list access requests. Ask an administrator to review your assignment.')
  })

  it('shows today’s empty state', async () => {
    api.listAccessRequests.mockResolvedValue([])
    open()
    expect(await screen.findByText('No access requests')).toBeTruthy()
    expect(screen.getByText('Requests you send for this facility will appear here.')).toBeTruthy()
  })

  it('audit 5: keeps today’s Refresh only where the list could not be read, and reads again with it', async () => {
    api.listAccessRequests.mockRejectedValueOnce(new HidApiError(503, 'Unavailable', { code: 'SERVICE_UNAVAILABLE' }))
    open()
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('table', { name: 'Access requests' })).toBeTruthy()
    expect(api.listAccessRequests).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull()
  })

  it('audit 5: still says the list shows the 100 most recent requests when it holds 100', async () => {
    api.listAccessRequests.mockResolvedValue(Array.from({ length: 100 }, (_, index) => request({ accessRequestId: `r-${index}` })))
    open()
    expect(await screen.findByText('Showing the 100 most recent requests.')).toBeTruthy()
  })
})

describe('New external record access', () => {
  it('audit 18: the form card opens with the form, not an introductory sentence', () => {
    open('/new')
    expect(screen.queryByText('Ask the patient to approve access. A pending request does not expose their record.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Send access request' })).toBeTruthy()
  })

  it('checks the Health ID, reason and duration at their fields before sending anything', async () => {
    open('/new')
    const form = screen.getByRole('button', { name: 'Send access request' }).closest('form')!
    // Today always asks for 60 minutes: 60 is the default, and less may be chosen.
    expect((screen.getByLabelText(labelled('Duration (minutes, max 60)')) as HTMLInputElement).value).toBe('60')
    fireEvent.submit(form)
    expect(await screen.findByText('Enter the patient’s Health ID.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText(labelled('Health ID')))
    expect(screen.getByText('Enter a clinical reason of at least 8 characters.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(labelled('Health ID')), { target: { value: 'hid-zdem' } })
    fireEvent.change(screen.getByLabelText(labelled('Duration (minutes, max 60)')), { target: { value: '90' } })
    fireEvent.submit(form)
    expect(await screen.findByText('Check the Health ID: it starts with HID-, then 6 to 32 letters and digits, and never uses 0, 1, I or O.')).toBeTruthy()
    expect(screen.getByText('Access duration must be 1–60 minutes.')).toBeTruthy()
    expect(api.requestAccess).not.toHaveBeenCalled()
  })

  it('sends the request with the chosen scope and duration, and opens it waiting for the patient', async () => {
    open('/new')
    fireEvent.change(screen.getByLabelText(labelled('Health ID')), { target: { value: 'hid-zdemaaa2' } })
    fireEvent.change(screen.getByLabelText(labelled('Purpose of access')), { target: { value: '  Follow-up consultation ' } })
    fireEvent.change(screen.getByLabelText(labelled('Access scope')), { target: { value: 'write_records' } })
    fireEvent.change(screen.getByLabelText(labelled('Duration (minutes, max 60)')), { target: { value: '45' } })
    fireEvent.submit(screen.getByLabelText(labelled('Purpose of access')).closest('form')!)
    await waitFor(() => expect(api.requestAccess).toHaveBeenCalledWith(FACILITY_ID, PATIENT_HID, 'write_records', 'Follow-up consultation', 45))
    expect(await screen.findByRole('heading', { level: 1, name: 'Follow-up consultation' })).toBeTruthy()
    expect(screen.getByText(SENT)).toBeTruthy()
    expect(screen.getByText('The patient must approve before records are available.')).toBeTruthy()
  })

  it('takes a Health ID offered from Patients once', async () => {
    offerHealthId(PATIENT_HID, FACILITY_ID, staff.setActivePatient)
    open('/new')
    expect((screen.getByLabelText(labelled('Health ID')) as HTMLInputElement).value).toBe(PATIENT_HID)
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe('')
  })

  it('takes no Health ID offered in an earlier staff period, and drops it', () => {
    // A facility switch (even back to this facility) starts a new period: today's setActivePatient is made anew.
    offerHealthId(PATIENT_HID, FACILITY_ID, vi.fn())
    open('/new')
    expect((screen.getByLabelText(labelled('Health ID')) as HTMLInputElement).value).toBe('HID-')
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe('')
  })

  it('review item 10: the request’s Health ID starts at HID-, is normalized as typed, and HID- alone is empty', async () => {
    open('/new')
    const field = () => screen.getByLabelText(labelled('Health ID')) as HTMLInputElement
    expect(field().value).toBe('HID-')
    fireEvent.change(screen.getByLabelText(labelled('Purpose of access')), { target: { value: 'Follow-up consultation' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send access request' }))
    // Today's sentence for an empty Health ID, not the form's "Complete this field.".
    expect(await screen.findByText('Enter the patient’s Health ID.')).toBeTruthy()
    expect(screen.queryByText('Complete this field.')).toBeNull()
    expect(document.activeElement).toBe(field())
    expect(api.requestAccess).not.toHaveBeenCalled()
    fireEvent.change(field(), { target: { value: ' hid-zdem aaa2 ' } })
    expect(field().value).toBe(PATIENT_HID)
    fireEvent.change(field(), { target: { value: '' } })
    expect(field().value).toBe('HID-')
    fireEvent.change(field(), { target: { value: 'HID-HID-zdemaaa2' } })
    expect(field().value).toBe(PATIENT_HID)
    // Only the Health ID is normalized: the purpose keeps what was typed.
    expect((screen.getByLabelText(labelled('Purpose of access')) as HTMLInputElement).value).toBe('Follow-up consultation')
    fireEvent.click(screen.getByRole('button', { name: 'Send access request' }))
    await waitFor(() => expect(api.requestAccess).toHaveBeenCalledWith(FACILITY_ID, PATIENT_HID, 'read_records', 'Follow-up consultation', 60))
  })

  it('confirms a request just sent while its page is read, and when it cannot be read', async () => {
    // Each read gets its own promise, made when the page asks for it, so none is refused before the page holds it.
    const fails: Array<(reason: unknown) => void> = []
    api.listAccessRequests.mockImplementation(() => new Promise((_resolve, reject) => { fails.push(reject) }))
    open('/new')
    fireEvent.change(screen.getByLabelText(labelled('Health ID')), { target: { value: PATIENT_HID } })
    fireEvent.change(screen.getByLabelText(labelled('Purpose of access')), { target: { value: 'Follow-up consultation' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send access request' }))
    expect(await screen.findByText('Loading requests…')).toBeTruthy()
    expect(screen.getByText(SENT)).toBeTruthy()
    // The page shows "Loading requests…" before its read is asked for: fail the reads only once one has been.
    await waitFor(() => expect(fails.length).toBeGreaterThan(0))
    await act(async () => { for (const fail of fails) fail(new HidApiError(503, 'Unavailable', { code: 'SERVICE_UNAVAILABLE' })) })
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(SENT)).toBeTruthy()
  })

  it('confirms a request just sent that the list does not hold yet', async () => {
    api.listAccessRequests.mockResolvedValue([ACTIVE])
    open('/new')
    fireEvent.change(screen.getByLabelText(labelled('Health ID')), { target: { value: PATIENT_HID } })
    fireEvent.change(screen.getByLabelText(labelled('Purpose of access')), { target: { value: 'Follow-up consultation' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send access request' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Record not found' })).toBeTruthy()
    expect(screen.getByText(SENT)).toBeTruthy()
  })

  it('shows a refusal from the server and keeps what was typed', async () => {
    api.requestAccess.mockRejectedValue(new HidApiError(404, 'Patient was not found or is not available', { code: 'PATIENT_NOT_FOUND' }))
    open('/new')
    fireEvent.change(screen.getByLabelText(labelled('Health ID')), { target: { value: PATIENT_HID } })
    fireEvent.change(screen.getByLabelText(labelled('Purpose of access')), { target: { value: 'Follow-up consultation' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send access request' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Patient was not found or is not available')
    expect((screen.getByLabelText(labelled('Purpose of access')) as HTMLInputElement).value).toBe('Follow-up consultation')
  })

  it('names the permission a role lacks and offers no submit', () => {
    staff.permissions = ['identity.patient.read']
    open('/new')
    expect(screen.getByText('Your role at this facility cannot send access requests: it needs identity.consent.write. Ask your organization administrator.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Send access request' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('Patient PIN access', () => {
  it('verifies the PIN without spaces, waits for the session, then opens the patient through the lookup', async () => {
    open('/pin')
    expect(screen.getByRole('heading', { level: 1, name: 'Patient PIN access' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText(labelled('Health ID')), { target: { value: 'hid-zdemaaa2' } })
    expect((screen.getByLabelText(labelled('Health ID')) as HTMLInputElement).value).toBe(PATIENT_HID)
    const pin = screen.getByLabelText(labelled('Patient access PIN')) as HTMLInputElement
    expect(pin.type).toBe('password')
    fireEvent.change(pin, { target: { value: '12 34' } })
    fireEvent.submit(pin.closest('form')!)
    await waitFor(() => expect(where()).toBe('/provider/patients/open'))
    expect(api.verifyPin).toHaveBeenCalledWith(FACILITY_ID, PATIENT_HID, '1234')
    expect(session.untilStaffSessionReady).toHaveBeenCalledWith(3)
    expect(api.lookupPatient).toHaveBeenCalledWith(FACILITY_ID, PATIENT_HID, 'direct-care')
    expect(session.untilStaffSessionReady.mock.invocationCallOrder[0]!).toBeLessThan(api.lookupPatient.mock.invocationCallOrder[0]!)
    expect(staff.setActivePatient).toHaveBeenCalledWith({ hid: PATIENT_HID, lookup: allowedLookup, purpose: 'direct-care' })
  })

  it('refuses a short PIN at its field, as an alert from Enter in the field, and sends nothing', async () => {
    open('/pin')
    fireEvent.change(screen.getByLabelText(labelled('Health ID')), { target: { value: PATIENT_HID } })
    const pin = screen.getByLabelText(labelled('Patient access PIN'))
    fireEvent.change(pin, { target: { value: '12 3' } })
    pin.focus()
    fireEvent.submit(pin.closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toBe('Enter the patient’s 4 to 8 digit access PIN.')
    expect(pin.getAttribute('aria-invalid')).toBe('true')
    expect(api.verifyPin).not.toHaveBeenCalled()
  })

  it('opens nothing when the lookup is not allowed, or the session changed meanwhile', async () => {
    api.lookupPatient.mockResolvedValue(deniedLookup)
    open('/pin')
    fireEvent.change(screen.getByLabelText(labelled('Health ID')), { target: { value: PATIENT_HID } })
    fireEvent.change(screen.getByLabelText(labelled('Patient access PIN')), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify PIN and open' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The backend has not granted access to this patient. Request approval, verify their PIN, or use documented emergency access when justified.')
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    api.lookupPatient.mockResolvedValue(allowedLookup)
    staff.setActivePatient.mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Verify PIN and open' }))
    await waitFor(() => expect(api.lookupPatient).toHaveBeenCalledTimes(2))
    await act(async () => {})
    expect(where()).toBeNull()
  })

  it('shows the PIN refusal as the server words it', async () => {
    api.verifyPin.mockRejectedValue(new HidApiError(403, 'Patient access PIN is not valid', { code: 'PATIENT_ACCESS_PIN_INVALID' }))
    open('/pin')
    fireEvent.change(screen.getByLabelText(labelled('Health ID')), { target: { value: PATIENT_HID } })
    fireEvent.change(screen.getByLabelText(labelled('Patient access PIN')), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify PIN and open' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Patient access PIN is not valid')
    expect(api.lookupPatient).not.toHaveBeenCalled()
  })

  it('review item 10: the PIN form’s Health ID starts at HID-, is normalized as typed, and HID- alone is empty', async () => {
    open('/pin')
    const field = () => screen.getByLabelText(labelled('Health ID')) as HTMLInputElement
    expect(field().value).toBe('HID-')
    fireEvent.change(screen.getByLabelText(labelled('Patient access PIN')), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify PIN and open' }))
    expect(await screen.findByText('Enter the patient’s Health ID.')).toBeTruthy()
    expect(document.activeElement).toBe(field())
    expect(field().getAttribute('aria-invalid')).toBe('true')
    expect(api.verifyPin).not.toHaveBeenCalled()
    fireEvent.change(field(), { target: { value: '' } })
    expect(field().value).toBe('HID-')
    fireEvent.change(field(), { target: { value: ' hid zdemaaa2' } })
    expect(field().value).toBe(PATIENT_HID)
  })

  it('review item 10: the PIN form starts at a Health ID offered from Patients, read once', () => {
    offerHealthId(PATIENT_HID, FACILITY_ID, staff.setActivePatient)
    open('/pin')
    expect((screen.getByLabelText(labelled('Health ID')) as HTMLInputElement).value).toBe(PATIENT_HID)
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe('')
  })

  it('names what a role lacks to verify a PIN', () => {
    staff.permissions = ['identity.patient-access-pin.verify']
    open('/pin')
    expect(screen.getByText('Your role at this facility cannot verify a patient’s PIN: it also needs identity.patient.read to open the record. Ask your organization administrator.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Verify PIN and open' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

const cardOf = (title: string) => screen.getByRole('heading', { level: 2, name: title }).closest<HTMLElement>('section')!

describe('An access request’s page', () => {
  it('audit 6: shows a pending request as waiting, with no actions, and no Next steps or break-glass in Available actions', async () => {
    open('/r0000000-0000-4000-8000-000000000001')
    expect(await screen.findByRole('heading', { level: 1, name: 'Follow-up consultation' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Saved record' })).toBeTruthy()
    expect(screen.getByText('The patient must approve before records are available.')).toBeTruthy()
    const actions = cardOf('Available actions')
    expect(within(actions).getByText('No further actions for your permission and this record state.')).toBeTruthy()
    expect(within(actions).queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByRole('heading', { name: 'Next steps' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Close access' })).toBeNull()
  })

  it('audit 6: puts the design’s Cross-institution history card after Saved record and Available actions, with its words', async () => {
    open('/r0000000-0000-4000-8000-000000000001')
    await screen.findByRole('heading', { level: 1, name: 'Follow-up consultation' })
    const cross = cardOf('Cross-institution history')
    expect(within(cross).getByText(CROSS_INSTITUTION)).toBeTruthy()
    expect(CROSS_INSTITUTION).toBe('Local hospital care does not require an external access grant. External content is removed immediately on expiry or revocation.')
    expect(cardOf('Available actions').compareDocumentPosition(cross) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // A pending request has no category to view yet: only the emergency step.
    expect(within(cross).queryByRole('button', { name: 'View authorized category' })).toBeNull()
    expect(within(cross).getAllByRole('button').map(button => button.textContent)).toEqual(['Emergency break-glass access'])
  })

  it('audit 6: an active or approved request offers View authorized category, which opens Patients; the banner keeps its words without a link', async () => {
    const approved = request({ accessRequestId: 'r0000000-0000-4000-8000-000000000004', reason: 'Approved review', status: 'approved', approvedAt: '2026-10-30T09:20:00.000Z' })
    api.listAccessRequests.mockResolvedValue([request(), ACTIVE, DENIED, approved])
    const first = open('/r0000000-0000-4000-8000-000000000004')
    await screen.findByRole('heading', { level: 1, name: 'Approved review' })
    expect(within(cardOf('Cross-institution history')).getByRole('button', { name: 'View authorized category' })).toBeTruthy()
    first.unmount()
    open('/r0000000-0000-4000-8000-000000000002')
    await screen.findByRole('heading', { level: 1, name: 'Review of results' })
    const banner = screen.getByText('Already approved? Verify with the server before opening the chart.').closest<HTMLElement>('section')!
    expect(within(banner).queryByRole('link')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Verify access on Patients →' })).toBeNull()
    const cross = cardOf('Cross-institution history')
    const buttons = within(cross).getAllByRole('button')
    expect(buttons.map(button => button.textContent)).toEqual(['View authorized category', 'Emergency break-glass access'])
    expect(buttons[0]!.className).not.toContain('secondary')
    fireEvent.click(buttons[0]!)
    expect(where()).toBe('/provider/patients')
  })

  it('audit 6: offers no View authorized category for a denied, expired, closed or revoked request', async () => {
    const ended = ['expired', 'closed', 'revoked'].map((effectiveStatus, index) => request({
      accessRequestId: `r0000000-0000-4000-8000-00000000001${index}`, reason: `Ended ${effectiveStatus}`, status: 'approved', effectiveStatus,
      approvedAt: '2026-10-30T09:05:00.000Z', consentGrantId: `grant-${index}`,
    }))
    api.listAccessRequests.mockResolvedValue([DENIED, ...ended])
    for (const id of ['r0000000-0000-4000-8000-000000000003', ...ended.map(item => item.accessRequestId)]) {
      const view = open(`/${id}`)
      await screen.findByRole('heading', { name: 'Cross-institution history' })
      expect(screen.queryByRole('button', { name: 'View authorized category' })).toBeNull()
      view.unmount()
    }
  })

  it('audit 6: Emergency break-glass access opens today’s break-glass form inside the card, and closes it again', async () => {
    open('/r0000000-0000-4000-8000-000000000001')
    await screen.findByRole('heading', { level: 1, name: 'Follow-up consultation' })
    const cross = cardOf('Cross-institution history')
    const toggle = within(cross).getByRole('button', { name: 'Emergency break-glass access' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Record emergency access' })).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const form = within(cross).getByRole('button', { name: 'Record emergency access' }).closest('form')!
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)!.contains(form)).toBe(true)
    expect((within(cross).getByRole('textbox', { name: labelled('Health ID') }) as HTMLInputElement).value).toBe('HID-')
    expect(within(cross).getByRole('textbox', { name: labelled('Emergency reason') })).toBeTruthy()
    expect(within(cross).getByRole('textbox', { name: labelled('Clinical justification') })).toBeTruthy()
    expect(within(cross).getByRole('checkbox', { name: labelled(ACKNOWLEDGE) })).toBeTruthy()
    expect(cross.querySelector('.hid-ehr-clinical-emergency-notice')!.textContent).toContain('Use emergency access only when the patient cannot consent and care cannot wait.')
    // The form is the card's: the page has no second "Emergency break-glass access" card.
    expect(screen.queryByRole('heading', { name: 'Emergency break-glass access' })).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Record emergency access' })).toBeNull()
    expect(where()).toBeNull()
  })

  it('audit 6: the inline form runs today’s break-glass flow and opens the Emergency workspace’s read-only summary', async () => {
    open('/r0000000-0000-4000-8000-000000000001')
    await screen.findByRole('heading', { level: 1, name: 'Follow-up consultation' })
    fireEvent.click(screen.getByRole('button', { name: 'Emergency break-glass access' }))
    const cross = cardOf('Cross-institution history')
    fireEvent.click(within(cross).getByRole('button', { name: 'Record emergency access' }))
    // Checked at its fields first, as on the Emergency page: nothing is sent.
    expect(await within(cross).findByText('Enter the patient’s Health ID.')).toBeTruthy()
    expect(api.breakGlass).not.toHaveBeenCalled()
    fireEvent.change(within(cross).getByRole('textbox', { name: labelled('Health ID') }), { target: { value: 'hid-zdemaaa2' } })
    fireEvent.change(within(cross).getByRole('textbox', { name: labelled('Emergency reason') }), { target: { value: 'Unconscious on arrival' } })
    fireEvent.change(within(cross).getByRole('textbox', { name: labelled('Clinical justification') }), { target: { value: 'Needs medication history' } })
    fireEvent.click(within(cross).getByRole('checkbox', { name: labelled(ACKNOWLEDGE) }))
    await act(async () => { fireEvent.click(within(cross).getByRole('button', { name: 'Record emergency access' })) })
    await waitFor(() => expect(where()).toBe('/provider/emergency/summary'))
    expect(api.breakGlass).toHaveBeenCalledWith(FACILITY_ID, PATIENT_HID, 'Unconscious on arrival\nClinical justification: Needs medication history')
    expect(session.untilStaffSessionReady).toHaveBeenCalledWith(3)
    expect(api.lookupPatient).toHaveBeenCalledWith(FACILITY_ID, PATIENT_HID, 'emergency')
    expect(staff.setActivePatient).toHaveBeenCalledWith({ hid: PATIENT_HID, lookup: allowedLookup, purpose: 'emergency' })
  })

  it('audit 6: the inline form shows a break-glass refusal in today’s words and opens nothing', async () => {
    api.breakGlass.mockRejectedValue(new HidApiError(423, 'Disabled', { code: 'BREAK_GLASS_DISABLED' }))
    open('/r0000000-0000-4000-8000-000000000001')
    await screen.findByRole('heading', { level: 1, name: 'Follow-up consultation' })
    fireEvent.click(screen.getByRole('button', { name: 'Emergency break-glass access' }))
    const cross = cardOf('Cross-institution history')
    fireEvent.change(within(cross).getByRole('textbox', { name: labelled('Health ID') }), { target: { value: PATIENT_HID } })
    fireEvent.change(within(cross).getByRole('textbox', { name: labelled('Emergency reason') }), { target: { value: 'Unconscious on arrival' } })
    fireEvent.change(within(cross).getByRole('textbox', { name: labelled('Clinical justification') }), { target: { value: 'Needs medication history' } })
    fireEvent.click(within(cross).getByRole('checkbox', { name: labelled(ACKNOWLEDGE) }))
    await act(async () => { fireEvent.click(within(cross).getByRole('button', { name: 'Record emergency access' })) })
    expect((await within(cross).findByRole('alert')).textContent).toBe('Emergency access is switched off for Health ID right now, so the record was not opened. Ask your Health ID administrator.')
    expect(api.lookupPatient).not.toHaveBeenCalled()
    expect(staff.setActivePatient).not.toHaveBeenCalled()
    expect(where()).toBeNull()
  })

  it('audit 6: a role that may not use emergency access is not offered it on the request’s page', async () => {
    staff.permissions = ALL.filter(permission => permission !== 'identity.break-glass.write')
    const first = open('/r0000000-0000-4000-8000-000000000002')
    await screen.findByRole('heading', { level: 1, name: 'Review of results' })
    expect(screen.queryByRole('button', { name: 'Emergency break-glass access' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Record emergency access' })).toBeNull()
    expect(within(cardOf('Cross-institution history')).getAllByRole('button').map(button => button.textContent)).toEqual(['View authorized category'])
    first.unmount()
    // A pending request then has nothing to offer in the card but its words.
    open('/r0000000-0000-4000-8000-000000000001')
    await screen.findByRole('heading', { level: 1, name: 'Follow-up consultation' })
    const cross = cardOf('Cross-institution history')
    expect(within(cross).getByText(CROSS_INSTITUTION)).toBeTruthy()
    expect(within(cross).queryAllByRole('button')).toHaveLength(0)
  })

  it('audit 19: Saved record names the reason and the duration as the design does ("Reason", "Duration")', async () => {
    open('/r0000000-0000-4000-8000-000000000001')
    await screen.findByRole('heading', { name: 'Saved record' })
    const saved = cardOf('Saved record')
    expect(within(saved).getByText('Reason')).toBeTruthy()
    expect(within(saved).getByText('Follow-up consultation')).toBeTruthy()
    expect(within(saved).getByText('Duration')).toBeTruthy()
    expect(within(saved).queryByText('Purpose of access')).toBeNull()
    expect(within(saved).queryByText('Duration (minutes)')).toBeNull()
  })

  it('shows the latest change as Saved, as the list’s Updated does', async () => {
    open('/r0000000-0000-4000-8000-000000000003')
    expect(await screen.findByText(`Saved ${formatWhen('2026-10-30T09:10:00.000Z')}`)).toBeTruthy()
    expect(screen.queryByText(`Saved ${formatWhen('2026-10-30T09:00:00.000Z')}`)).toBeNull()
  })

  it('shows the patient’s reason for denying', async () => {
    open('/r0000000-0000-4000-8000-000000000003')
    expect(await screen.findByRole('heading', { level: 1, name: 'Medication review' })).toBeTruthy()
    expect(screen.getAllByText('Not my clinician').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Denied by the patient').length).toBeGreaterThan(0)
  })

  it('review item 9: Close access closes an active grant at once, with no confirmation, and ends the open patient it opened', async () => {
    staff.activePatient = activePatient()
    open('/r0000000-0000-4000-8000-000000000002')
    api.listAccessRequests.mockResolvedValue([{ ...ACTIVE, effectiveStatus: 'closed' }])
    fireEvent.click(await screen.findByRole('button', { name: 'Close access' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(await screen.findByText('Access was closed by the backend.')).toBeTruthy()
    expect(api.closeGrant).toHaveBeenCalledWith(FACILITY_ID, 'grant-1', 'Clinician closed completed patient access')
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
    expect(screen.getByRole('alert').textContent).toContain('Access to this patient ended')
    expect(screen.getAllByText('Closed by you').length).toBeGreaterThan(0)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('review item 9: Close access sends one close even on a double press, while the first is on its way', async () => {
    let finish: (value: unknown) => void = () => {}
    api.closeGrant.mockReturnValue(new Promise(resolve => { finish = resolve }))
    open('/r0000000-0000-4000-8000-000000000002')
    const button = await screen.findByRole('button', { name: 'Close access' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(button.getAttribute('aria-busy')).toBe('true')
    api.listAccessRequests.mockResolvedValue([{ ...ACTIVE, effectiveStatus: 'closed' }])
    await act(async () => { finish({}) })
    expect(await screen.findByText('Access was closed by the backend.')).toBeTruthy()
    expect(api.closeGrant).toHaveBeenCalledTimes(1)
  })

  it('says an access that had already ended was refreshed', async () => {
    api.closeGrant.mockRejectedValue(new HidApiError(409, 'Conflict', { code: 'CONSENT_COMMAND_CONFLICT' }))
    open('/r0000000-0000-4000-8000-000000000002')
    fireEvent.click(await screen.findByRole('button', { name: 'Close access' }))
    expect((await screen.findByRole('alert')).textContent).toBe('This access had already ended. The list has been refreshed.')
    expect(api.listAccessRequests).toHaveBeenCalledTimes(2)
    expect(staff.setActivePatient).not.toHaveBeenCalled()
    // The grant is still listed as active: Close access is offered again, and closes at once.
    expect(screen.getByRole('button', { name: 'Close access' })).toBeTruthy()
  })

  it('shows the request loading, and a list refusal in today’s words', async () => {
    // Each read gets its own promise, made when the page asks for it, so none is refused before the page holds it.
    const fails: Array<(reason: unknown) => void> = []
    api.listAccessRequests.mockImplementation(() => new Promise((_resolve, reject) => { fails.push(reject) }))
    open('/r0000000-0000-4000-8000-000000000001')
    expect(screen.getByText('Loading requests…')).toBeTruthy()
    await waitFor(() => expect(fails.length).toBeGreaterThan(0))
    await act(async () => { for (const fail of fails) fail(new HidApiError(403, 'Forbidden', { code: 'FACILITY_ACCESS_DENIED' })) })
    expect((await screen.findByRole('alert')).textContent).toBe('Select a facility where you are an active member to see your access requests.')
  })

  it('names a request it cannot find', async () => {
    open('/r0000000-0000-4000-8000-00000000ffff')
    expect(await screen.findByRole('heading', { level: 1, name: 'Record not found' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'External record access' })).toBeTruthy()
  })
})

describe('The Health ID hand-off', () => {
  it('drops a Health ID read for another facility or another session, so it is not read later either', () => {
    offerHealthId(PATIENT_HID, FACILITY_ID, staff.setActivePatient)
    expect(offeredHealthId('facility-other', staff.setActivePatient)).toBe('')
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe('')
    offerHealthId(PATIENT_HID, FACILITY_ID, staff.setActivePatient)
    session.staffSessionGeneration.mockReturnValue(4)
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe('')
    session.staffSessionGeneration.mockReturnValue(3)
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe('')
  })

  it('drops a Health ID nobody read as its session ends', () => {
    const ending = new AbortController()
    session.staffSessionSignal.mockReturnValue(ending.signal)
    offerHealthId(PATIENT_HID, FACILITY_ID, staff.setActivePatient)
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe(PATIENT_HID)
    ending.abort()
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe('')
  })
})
