import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dropOfferedHealthId, offerHealthId, offeredHealthId } from '../../../ehr-blue/clinical/consent/access'
import { EMERGENCY_ACCESS, actionUnavailable } from '../../../ehr-blue/clinical/emergency/access'
import { EmergencyWorkspace, emergencyStatus } from '../../../ehr-blue/clinical/emergency/EmergencyWorkspace'
import { SAMPLE_NOTICE } from '../../../ehr-blue/clinical/parts/SampleBanner'
import { SampleCreate, SampleDetail, SampleList } from '../../../ehr-blue/clinical/sample/SampleWorkspace'
import { DEMO_HOSPITAL_ID, FACILITY_ID, FACILITY_NAME, PATIENT_HID, PATIENT_ID, PATIENT_NAME, activePatient, allowedLookup, deniedLookup, labelled, renderPage } from './harness'

/**
 * The Emergency workspace's live part: the design's "Emergency break-glass access" form running today's break-glass
 * flow (staff/routes/Patients.tsx), and its routes. The emergency-department board is the sample engine's; here it is
 * replaced by markers, so only where it is placed is tested. The board shows only at the four demo facilities: at a
 * real facility (the harness's FACILITY_ID, the default) this live page never leads into it.
 */

const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), breakGlass: vi.fn(), closeGrant: vi.fn(), emergencyRecords: vi.fn(),
  labReleasedResultsForOrder: vi.fn(),
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
  SampleList: vi.fn(({ id }: { id: string }) => <section data-testid="sample-list">{id}</section>),
  SampleCreate: vi.fn(({ id }: { id: string }) => <section data-testid="sample-create">{id}</section>),
  SampleDetail: vi.fn(({ id }: { id: string }) => <section data-testid="sample-detail">{id}</section>),
}))

const EMERGENCY_PERMISSIONS = ['identity.patient.read', 'identity.consent.write', 'identity.break-glass.write', 'ehr.encounter.read', 'ehr.note.read']
const ACKNOWLEDGE = 'I understand the patient is told, every view is reviewed, and access ends after 30 minutes.'
const HID_FORMAT = 'Starts with HID-, then 6 to 32 letters and digits. Health IDs never use 0, 1, I or O.'
const REASON = 'Unconscious after a road traffic collision; needs allergy and medication history before treatment'
const REASON_TOO_SHORT = 'Say why in at least 8 characters.'
const WHEN = 'Only when the patient can’t consent and care can’t wait'
const BEFORE = 'Emergency access lets you see the emergency summary without the patient’s approval. It ends by itself and every view is reviewed.'
const CONTACTS_TOLD = 'The patient’s chosen emergency contacts are told your name, this facility and the time. They never see your reason or any medical details.'
const FAILED_TITLE = 'Couldn’t open emergency access'
const emergencyLookup = { ...allowedLookup, authorization: { ...allowedLookup.authorization, breakGlass: true } }

beforeEach(() => {
  vi.clearAllMocks()
  dropOfferedHealthId()
  staff.facilityId = undefined
  staff.roles = undefined
  staff.permissions = [...EMERGENCY_PERMISSIONS]
  staff.activePatient = null
  staff.setActivePatient.mockImplementation(value => { staff.activePatient = value; return true })
  session.staffSessionGeneration.mockReturnValue(7)
  session.untilStaffSessionReady.mockResolvedValue(undefined)
  api.breakGlass.mockResolvedValue({ accessRequestId: 'request-1', consentGrantId: 'grant-1', patientId: PATIENT_ID, status: 'active', expiresAt: '2026-10-30T12:00:00.000Z' })
  api.lookupPatient.mockResolvedValue(emergencyLookup)
  api.emergencyRecords.mockReturnValue(new Promise(() => {}))
})

afterEach(() => { vi.unstubAllEnvs() })

function open(rest = '') {
  return renderPage(<EmergencyWorkspace />, 'emergency', rest)
}

/** The emergency access form, one column under the page heading. */
const card = () => hidField().closest<HTMLElement>('form')!
const hidField = () => screen.getByRole('textbox', { name: labelled('Health ID') }) as HTMLInputElement
const reasonField = () => screen.getByRole('textbox', { name: labelled('Why do you need emergency access?') }) as HTMLTextAreaElement
const ackBox = () => screen.getByRole('checkbox', { name: ACKNOWLEDGE }) as HTMLInputElement
const submitButton = () => screen.getByRole('button', { name: /^(Open emergency access|Opening…)$/ }) as HTMLButtonElement

/** The text of the error tied to a control by aria-describedby. */
function errorOf(control: HTMLElement) {
  return (control.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(id => id.endsWith('-error'))
    .map(id => document.getElementById(id)?.textContent ?? '').join(' ')
}

function fill({ hid = 'hid-zdemaaa2', reason = REASON, ack = true } = {}) {
  fireEvent.change(hidField(), { target: { value: hid } })
  fireEvent.change(reasonField(), { target: { value: reason } })
  if (ack) fireEvent.click(ackBox())
}

async function record() {
  await act(async () => { fireEvent.click(submitButton()) })
}

describe('the Emergency page', () => {
  it('is partial: break-glass and the summary are live, the board is sample', () => {
    expect(emergencyStatus).toBe('partial')
  })

  it('audit 16: at a demo facility, the board’s New board entry follows the design’s roles (a Doctor’s, not a Nurse’s); the live page is unchanged', () => {
    staff.facilityId = DEMO_HOSPITAL_ID
    const doctor = open()
    expect(screen.getByRole('link', { name: 'New board entry' })).toBeTruthy()
    doctor.unmount()
    // The design gives a Nurse no Emergency module: no sample record to create, but the same live form and board.
    staff.roles = ['nurse']
    open()
    expect(screen.getByRole('heading', { level: 1, name: 'Emergency access' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'New board entry' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open emergency access' })).toBeTruthy()
    expect(screen.getByTestId('sample-list').textContent).toBe('emergency')
  })

  it('shows the heading, the live emergency access form, then the sample board', () => {
    staff.facilityId = DEMO_HOSPITAL_ID
    open()
    expect(screen.getByRole('heading', { level: 1, name: 'Emergency access' })).toBeTruthy()
    expect(within(card()).getByRole('textbox', { name: labelled('Health ID') })).toBeTruthy()
    expect(hidField().value).toBe('HID-')
    expect(card().textContent).toContain(HID_FORMAT)
    // The design asked for a reason and a justification; the request carries one reason, so the form asks once.
    expect(reasonField().tagName).toBe('TEXTAREA')
    expect(screen.queryByRole('textbox', { name: /justification/i })).toBeNull()
    expect(ackBox().checked).toBe(false)
    expect(submitButton().type).toBe('submit')
    // The design says 15 minutes; today's grant runs 30, and the acknowledgement names the real one.
    expect(document.body.textContent).not.toMatch(/15[- ]minute/)
    expect(document.body.textContent).toContain(ACKNOWLEDGE)
    // The sample board sits below the live form.
    const board = screen.getByTestId('sample-list')
    expect(board.textContent).toBe('emergency')
    expect(card().compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('names the tab “Emergency · Health ID EHR” on every page of the workspace, never the patient', () => {
    staff.activePatient = activePatient('emergency')
    for (const rest of ['', '/new', '/cfa650e2', '/summary']) {
      document.title = ''
      const view = open(rest)
      expect(document.title).toBe('Emergency · Health ID EHR')
      for (const value of [PATIENT_NAME, PATIENT_HID, PATIENT_ID]) expect(document.title).not.toContain(value)
      view.unmount()
    }
  })

  it('opens the sample board’s create page from New board entry', () => {
    staff.facilityId = DEMO_HOSPITAL_ID
    open()
    const create = screen.getByRole('link', { name: 'New board entry' })
    expect(create.getAttribute('href')).toBe('/provider/emergency/new')
    fireEvent.click(create)
    expect(screen.getByTestId('sample-create').textContent).toBe('emergency')
    expect(screen.queryByRole('textbox', { name: labelled('Health ID') })).toBeNull()
  })

  it('routes new and a record id to the sample board, and summary to the live summary', () => {
    staff.facilityId = DEMO_HOSPITAL_ID
    const first = open('/new')
    expect(screen.getByTestId('sample-create').textContent).toBe('emergency')
    first.unmount()
    const second = open('/cfa650e2')
    expect(screen.getByTestId('sample-detail').textContent).toBe('emergency')
    second.unmount()
    open('/summary')
    expect(screen.queryByTestId('sample-detail')).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Emergency summary' })).toBeTruthy()
  })

  it('at a real facility, shows the heading without New board entry and the live form, but no sample board', () => {
    open()
    expect(screen.getByRole('heading', { level: 1, name: 'Emergency access' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'New board entry' })).toBeNull()
    expect(within(card()).getByRole('textbox', { name: labelled('Health ID') })).toBeTruthy()
    expect(submitButton().type).toBe('submit')
    expect(screen.queryByTestId('sample-list')).toBeNull()
    expect(document.body.textContent).not.toContain(SAMPLE_NOTICE)
    for (const part of [SampleList, SampleCreate, SampleDetail]) expect(vi.mocked(part)).not.toHaveBeenCalled()
  })

  it('at a real facility, answers new and a record id with Record not found, and still opens the live summary', () => {
    for (const rest of ['/new', '/cfa650e2']) {
      const view = open(rest)
      expect(screen.getByRole('heading', { level: 1, name: 'Record not found' })).toBeTruthy()
      expect(screen.getByText('This record doesn’t exist, or it belongs to another facility.')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Back to list' })).toBeTruthy()
      expect(screen.queryByRole('textbox', { name: labelled('Health ID') })).toBeNull()
      expect(document.body.textContent).not.toContain(SAMPLE_NOTICE)
      view.unmount()
    }
    open('/summary')
    expect(screen.getByRole('heading', { level: 1, name: 'Emergency summary' })).toBeTruthy()
    expect(document.body.textContent).not.toContain(SAMPLE_NOTICE)
    for (const part of [SampleList, SampleCreate, SampleDetail]) expect(vi.mocked(part)).not.toHaveBeenCalled()
  })

  it('at a real facility, takes Back to list on Record not found to the live Emergency page', () => {
    open('/new')
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Emergency access' })).toBeTruthy()
    expect(card()).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'New board entry' })).toBeNull()
    for (const part of [SampleList, SampleCreate, SampleDetail]) expect(vi.mocked(part)).not.toHaveBeenCalled()
  })

  it('on main, says when to use emergency access and what it does, and nothing about emergency contacts', () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'main-v1')
    open()
    expect(within(card()).getByText(WHEN)).toBeTruthy()
    expect(card().textContent).toContain(BEFORE)
    expect(card().textContent).not.toContain(CONTACTS_TOLD)
  })

  it('on Novu, says verified emergency contacts are told, with the staff member’s name, and never the reason', () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    open()
    expect(within(card()).getByText(WHEN)).toBeTruthy()
    expect(card().textContent).toContain(`${BEFORE} ${CONTACTS_TOLD}`)
  })

  it('shows the open emergency patient, with the way back to their summary', async () => {
    staff.activePatient = activePatient('emergency')
    open()
    expect(screen.getByText(`${PATIENT_NAME} is open with emergency access`)).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Open summary' })
    // Straight to the summary, as today's link goes.
    expect(link.getAttribute('href')).toBe('/provider/emergency/summary')
    fireEvent.click(link)
    expect(await screen.findByRole('heading', { level: 1, name: 'Emergency summary' })).toBeTruthy()
  })

  it('follow-up 5: the emergency access form starts at a Health ID offered from Patients, read once', () => {
    offerHealthId(PATIENT_HID, FACILITY_ID, staff.setActivePatient)
    const first = open()
    expect(hidField().value).toBe(PATIENT_HID)
    expect(offeredHealthId(FACILITY_ID, staff.setActivePatient)).toBe('')
    first.unmount()
    open()
    expect(hidField().value).toBe('HID-')
  })

  it('follow-up 5: the emergency access form takes no Health ID offered for another facility', () => {
    offerHealthId(PATIENT_HID, DEMO_HOSPITAL_ID, staff.setActivePatient)
    open()
    expect(hidField().value).toBe('HID-')
  })

  it('shows no current emergency notice for a patient open in direct care', async () => {
    staff.activePatient = activePatient('direct-care')
    api.consentStatus.mockResolvedValue({ writeAllowed: true })
    open()
    expect(screen.queryByText(/is open with emergency access/)).toBeNull()
    expect(screen.queryByRole('link', { name: 'Open summary' })).toBeNull()
    // The list reads nothing about the open patient.
    await act(async () => {})
    expect(api.consentStatus).not.toHaveBeenCalled()
    expect(api.lookupPatient).not.toHaveBeenCalled()
  })
})

describe('the break-glass form checks what it sends', () => {
  it('normalizes the Health ID as it is typed', () => {
    open()
    fireEvent.change(hidField(), { target: { value: 'hid-zdemaaa2' } })
    expect(hidField().value).toBe(PATIENT_HID)
  })

  it('refuses an empty form at each field, moves focus to the first, and sends nothing', async () => {
    open()
    await record()
    expect(errorOf(hidField())).toBe('Enter the patient’s Health ID.')
    expect(errorOf(reasonField())).toBe(REASON_TOO_SHORT)
    expect(errorOf(ackBox())).toBe('Tick the box to go on.')
    for (const control of [hidField(), reasonField(), ackBox()]) expect(control.getAttribute('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(hidField())
    expect(api.breakGlass).not.toHaveBeenCalled()
    expect(session.staffSessionGeneration).not.toHaveBeenCalled()
  })

  it('refuses a malformed Health ID and a reason under 8 characters with today’s words', async () => {
    open()
    fill({ hid: 'HID-AB', reason: 'Fall' })
    await record()
    expect(errorOf(hidField())).toBe('Check the Health ID: it starts with HID-, then 6 to 32 letters and digits, and never uses 0, 1, I or O.')
    expect(errorOf(reasonField())).toBe(REASON_TOO_SHORT)
    expect(errorOf(ackBox())).toBe('')
    expect(ackBox().getAttribute('aria-invalid')).toBeNull()
    expect(api.breakGlass).not.toHaveBeenCalled()
  })

  it('refuses a reason of spaces only', async () => {
    open()
    fill({ reason: '           ' })
    await record()
    expect(errorOf(reasonField())).toBe(REASON_TOO_SHORT)
    expect(document.activeElement).toBe(reasonField())
  })

  it('announces a refusal made with Enter in the refused field, and keeps focus there', async () => {
    open()
    fill({ reason: 'Short' })
    reasonField().focus()
    await act(async () => { fireEvent.submit(reasonField().form!) })
    expect(screen.getByRole('alert').textContent).toBe(REASON_TOO_SHORT)
    expect(document.activeElement).toBe(reasonField())
    expect(api.breakGlass).not.toHaveBeenCalled()
  })

  it('clears a field’s problem as it changes', async () => {
    open()
    await record()
    fireEvent.change(reasonField(), { target: { value: REASON } })
    expect(errorOf(reasonField())).toBe('')
    expect(reasonField().getAttribute('aria-invalid')).toBeNull()
    expect(errorOf(hidField())).toBe('Enter the patient’s Health ID.')
  })

  it('limits the reason to today’s 500-character reason', () => {
    open()
    expect(reasonField().maxLength).toBe(500)
  })
})

describe('recording emergency access', () => {
  it('sends today’s break-glass request, waits for the session, opens the patient for emergency care and shows the summary', async () => {
    open()
    fill({ reason: `  ${REASON}  ` })
    await record()
    expect(await screen.findByRole('heading', { level: 1, name: 'Emergency summary' })).toBeTruthy()
    expect(api.breakGlass).toHaveBeenCalledWith(FACILITY_ID, PATIENT_HID, REASON)
    expect(session.untilStaffSessionReady).toHaveBeenCalledWith(7)
    expect(api.lookupPatient).toHaveBeenCalledWith(FACILITY_ID, PATIENT_HID, 'emergency')
    expect(staff.setActivePatient).toHaveBeenCalledWith({ hid: PATIENT_HID, lookup: emergencyLookup, purpose: 'emergency' })
    const order = [session.staffSessionGeneration, api.breakGlass, session.untilStaffSessionReady, api.lookupPatient, staff.setActivePatient]
      .map(fn => fn.mock.invocationCallOrder[0]!)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    // The summary is the patient's, read under the emergency purpose.
    expect(screen.getByRole('region', { name: `Patient: ${PATIENT_NAME}` })).toBeTruthy()
  })

  it('sends from the form itself, as Enter in a field does', async () => {
    open()
    fill()
    await act(async () => { fireEvent.submit(hidField().form!) })
    expect(await screen.findByRole('heading', { level: 1, name: 'Emergency summary' })).toBeTruthy()
    expect(api.breakGlass).toHaveBeenCalledTimes(1)
  })

  it('opens nothing when the session no longer accepts the patient', async () => {
    staff.setActivePatient.mockImplementation(() => false)
    open()
    fill()
    await record()
    await waitFor(() => expect(api.lookupPatient).toHaveBeenCalled())
    expect(screen.getByRole('heading', { level: 1, name: 'Emergency access' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Emergency summary' })).toBeNull()
  })

  it('closes the patient and says so when the lookup does not allow the record', async () => {
    api.lookupPatient.mockResolvedValue(deniedLookup)
    open()
    fill()
    await record()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(FAILED_TITLE)
    expect(alert.textContent).toContain('You don’t have access to this patient yet. Ask the patient, use their Access PIN, or use emergency access if it’s justified.')
    expect(staff.setActivePatient).toHaveBeenCalledWith(null)
  })

  it('shows a refused lookup as it is', async () => {
    api.lookupPatient.mockRejectedValue(new HidApiError(403, 'Patient access is not authorized', { code: 'PATIENT_ACCESS_DENIED' }))
    open()
    fill()
    await record()
    expect((await screen.findByRole('alert')).textContent).toContain('Patient access is not authorized')
    expect(staff.setActivePatient).not.toHaveBeenCalled()
  })

  it('opens nothing once the session that asked has ended', async () => {
    session.untilStaffSessionReady.mockRejectedValue(new HidApiError(0, 'Stopped because the session it belonged to ended.', { code: 'REQUEST_CANCELLED', retryable: false }))
    open()
    fill()
    await record()
    expect((await screen.findByRole('alert')).textContent).toContain('Stopped because the session it belonged to ended.')
    expect(api.lookupPatient).not.toHaveBeenCalled()
    expect(staff.setActivePatient).not.toHaveBeenCalled()
  })

  it.each([
    ['423 BREAK_GLASS_DISABLED', new HidApiError(423, 'Emergency access is currently disabled by the platform administrator', { code: 'BREAK_GLASS_DISABLED' }),
      'Emergency access is switched off right now, so the record was not opened. Ask Health ID support.'],
    ['429 EMERGENCY_PROBATION_LIMITED', new HidApiError(429, 'Too many emergency activations', { code: 'EMERGENCY_PROBATION_LIMITED' }),
      `${FACILITY_NAME} is new to Health ID: emergency access is limited to 5 times a day in its first 30 days. Contact Health ID support to lift the limit.`],
    ['400 INVALID_CONSENT_COMMAND', new HidApiError(400, 'The consent command failed integrity validation', { code: 'INVALID_CONSENT_COMMAND' }),
      'Emergency access isn’t set up for your facility, so the record was not opened. Contact support.'],
    ['any other refusal, as it is', new HidApiError(403, 'Break-glass access is not authorized', { code: 'CONSENT_COMMAND_DENIED' }),
      'Break-glass access is not authorized'],
  ])('says what a %s means, and looks nothing up', async (_name, refusal, said) => {
    api.breakGlass.mockRejectedValue(refusal)
    open()
    fill()
    await record()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(FAILED_TITLE)
    expect(alert.textContent).toContain(said)
    expect(alert.closest('form')).toBe(submitButton().form)
    expect(session.untilStaffSessionReady).not.toHaveBeenCalled()
    expect(api.lookupPatient).not.toHaveBeenCalled()
    expect(staff.setActivePatient).not.toHaveBeenCalled()
    // The form keeps what was typed, to try again.
    expect(reasonField().value).toBe(REASON)
  })

  it('says the access command failed when the refusal has no words', async () => {
    api.breakGlass.mockRejectedValue('offline')
    open()
    fill()
    await record()
    expect((await screen.findByRole('alert')).textContent).toContain('Something went wrong. Please try again.')
  })

  it('keeps the button focusable and busy while it runs, and sends once', async () => {
    let answer: (value: unknown) => void = () => {}
    api.breakGlass.mockReturnValue(new Promise(resolve => { answer = resolve }))
    open()
    fill()
    const button = submitButton()
    button.focus()
    await record()
    expect(button.textContent).toBe('Opening…')
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.disabled).toBe(false)
    expect(document.activeElement).toBe(button)
    await act(async () => { fireEvent.click(button) })
    await act(async () => { fireEvent.submit(button.form!) })
    expect(api.breakGlass).toHaveBeenCalledTimes(1)
    await act(async () => { answer({ consentGrantId: 'grant-1' }) })
    expect(await screen.findByRole('heading', { level: 1, name: 'Emergency summary' })).toBeTruthy()
  })
})

describe('a role that cannot activate emergency access', () => {
  const reason = () => document.getElementById(submitButton().getAttribute('aria-describedby') ?? '')?.textContent ?? ''

  it('is not offered the button, and is told exactly what it lacks', async () => {
    staff.permissions = ['identity.patient.read', 'identity.break-glass.write']
    open()
    expect(submitButton().disabled).toBe(true)
    expect(reason()).toBe('Your role at this facility cannot activate emergency access: it also needs identity.consent.write, and '
      + 'ehr.encounter.read and ehr.note.read to read the emergency summary. Ask your organization administrator.')
    fill()
    await act(async () => { fireEvent.submit(submitButton().form!) })
    expect(api.breakGlass).not.toHaveBeenCalled()
  })

  it.each([
    ['identity.consent.write', 'identity.consent.write'],
    ['identity.break-glass.write', 'identity.break-glass.write'],
    ['identity.patient.read', 'identity.patient.read to open the record'],
    ['ehr.note.read', 'ehr.note.read to read the emergency summary'],
  ])('without %s, names it', (missing, named) => {
    staff.permissions = EMERGENCY_PERMISSIONS.filter(permission => permission !== missing)
    open()
    expect(submitButton().disabled).toBe(true)
    expect(reason()).toContain(`also needs ${named}.`)
  })

  it('at a self-signed-up facility, tells its administrator who gives clinical access', () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    staff.permissions = ['workforce.manage', 'audit.read']
    open()
    // The harness facility carries no self-service review, so the administrator is asked as usual.
    expect(reason().endsWith('Ask your organization administrator.')).toBe(true)
  })

  it.each([
    ['pending', 'You are this facility’s administrator. Health ID support gives your own role clinical access when it checks your facility: add your licence on the Staff page.'],
    ['reviewed', 'You are this facility’s administrator. Health ID support gives your own role clinical access; ask them, or invite a colleague who holds this role.'],
  ] as const)('ends with today’s words for an administrator whose facility review is %s', (review, ending) => {
    const said = actionUnavailable(EMERGENCY_ACCESS, ['workforce.manage'], review)
    expect(said?.startsWith('Your role at this facility cannot activate emergency access: it needs ')).toBe(true)
    expect(said?.endsWith(ending)).toBe(true)
  })

  it('offers the button with every permission', () => {
    open()
    expect(submitButton().disabled).toBe(false)
    expect(submitButton().getAttribute('aria-describedby')).toBeNull()
  })
})
