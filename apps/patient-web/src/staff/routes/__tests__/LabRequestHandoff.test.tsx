import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Clinical } from '../Clinical'

/**
 * Lab requests and Lab since hid-system #56 and #51 (lab-requests.service.ts,
 * lab-executions.service.ts; INTERFACE_CONTRACT.md "Lab requests" and Lab
 * "Released results"). EHR saves a request, then, when it is active, asks Lab to
 * accept it; Lab's answer cannot undo the save. A create Lab did not take answers
 * 409 LAB_HANDOFF_REFUSED or 502 LAB_HANDOFF_UNCONFIRMED for a request that is
 * saved and active; an activation or resume answers `labHandoff`; a saved active
 * request is sent (again) with POST .../lab-work-item; and a clinician reads the
 * released results of the work item Lab accepted from the request.
 */
const api = vi.hoisted(() => ({
  lookupPatient: vi.fn(), consentStatus: vi.fn(), encounters: vi.fn(), encounter: vi.fn(), records: vi.fn(), createRecord: vi.fn(),
  updateRecord: vi.fn(), sendLabRequestToLab: vi.fn(), labReleasedResultsForOrder: vi.fn(),
}))
const staff = vi.hoisted(() => ({ activePatient: null as unknown, permissions: [] as string[] }))

vi.mock('../../api', () => ({
  isAllowedPatientLookup: (lookup: { authorization: { decision: string }; patient?: unknown }) =>
    lookup.authorization.decision === 'allow' && !!lookup.patient,
  staffApi: api,
}))
vi.mock('../../App', () => ({
  useStaff: () => ({
    state: { status: 'ready', session: { actor: { id: 'staff-1', displayName: 'Ada Clinician', facility: {
      id: 'facility-1', membershipId: 'member-1', name: 'General Hospital', roles: ['doctor'], permissions: staff.permissions,
    } } } },
    activePatient: staff.activePatient,
    setActivePatient: vi.fn(),
  }),
}))

const PATIENT = 'a0000000-0000-4000-8000-000000000001'
const ENCOUNTER = 'e0000000-0000-4000-8000-000000000001'
const REQUEST = '0f2b6d0e-6a55-4b4c-9a7e-2f4b8c1d3e5a'
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const READ_WRITE = ['ehr.encounter.read', 'ehr.lab-request.read', 'ehr.lab-request.write']
const SENDER = [...READ_WRITE, 'lab.work-item.accept']
const lookup = { patient: { patientId: PATIENT, hid: 'HID-ABCDEF', fullName: 'Ada Patient', version: 1 },
  authorization: { decision: 'allow', consentGrantId: null, expiresAt: '2026-10-11T09:00:00.000Z', breakGlass: false } }
const base = { patientId: PATIENT, encounterId: ENCOUNTER, facilityId: 'facility-1', createdAt: '2026-10-10T08:05:00.000Z' }
const labRequest = (status: string, rowVersion = '1') => ({ ...base, id: REQUEST, testCodeSystem: 'LOINC', testCode: '718-7',
  testDisplay: 'Haemoglobin', priority: 'routine', status, clinicalInformation: null, rowVersion })

let records: Record<string, unknown[]>

beforeEach(() => {
  vi.clearAllMocks()
  staff.activePatient = { hid: 'HID-ABCDEF', purpose: 'direct-care', lookup }
  staff.permissions = SENDER
  records = { 'lab-requests': [] }
  api.lookupPatient.mockResolvedValue(lookup)
  api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care', readAllowed: true, writeAllowed: true })
  api.encounters.mockResolvedValue({ items: [{ id: ENCOUNTER, patientId: PATIENT, facilityId: 'facility-1',
    encounterType: 'ambulatory', status: 'in_progress', startedAt: '2026-10-10T08:00:00.000Z', chiefComplaint: null, rowVersion: 1 }], nextCursor: null })
  api.records.mockImplementation(async (_facility: string, _patient: string, _encounter: string, kind: string) =>
    ({ items: records[kind] ?? [], nextCursor: null }))
})

async function openLabRequests() {
  render(<MemoryRouter><Clinical /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('tab', { name: 'Lab requests' }))
}

// A required field's label ends in a marker the reader does not hear.
function labelled(label: string) { return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\*?$`) }

function type(scope: HTMLElement, label: string, value: string) {
  fireEvent.change(within(scope).getByLabelText(labelled(label)), { target: { value } })
}

function value(scope: HTMLElement, label: string) {
  return (within(scope).getByLabelText(labelled(label)) as HTMLInputElement).value
}

/** Fills the lab request form for an active request and creates it. */
async function createActiveRequest() {
  await openLabRequests()
  const form = (await screen.findByRole('button', { name: 'Create lab request' })).closest('form')!
  type(form, 'Test code system', 'LOINC')
  type(form, 'Test code', '718-7')
  type(form, 'Test display', 'Haemoglobin')
  type(form, 'Request handling', 'active')
  fireEvent.click(within(form).getByRole('button', { name: 'Create lab request' }))
  return form
}

const FRESH_FIRST_PAGE = ['facility-1', PATIENT, ENCOUNTER, 'lab-requests', { cursor: undefined, fresh: true }]

describe('creating an active lab request that Lab did not take', () => {
  it.each([
    ['refused', new HidApiError(409, `Lab request ${REQUEST} is saved and active in the EHR, but Lab refused it (LAB_ACCESS_DENIED); send it to Lab again once that is resolved`, { code: 'LAB_HANDOFF_REFUSED' }), /Lab refused it \(LAB_ACCESS_DENIED\)/],
    ['did not confirm', new HidApiError(502, 'The service could not complete the request.', { code: 'LAB_HANDOFF_UNCONFIRMED' }), /Lab did not confirm it/],
  ])('shows a request Lab %s as saved and active, reloads the list and clears the form', async (_case, refusal, says) => {
    api.createRecord.mockImplementation(async () => { records['lab-requests'] = [labRequest('active')]; throw refusal })
    const form = await createActiveRequest()

    const status = await screen.findByText(/^Lab request saved and active in the EHR/)
    expect(status.closest('[role="alert"]')).toBe(status)
    expect(status.textContent).toMatch(says)
    expect(status.textContent).toMatch(/Send to Lab/)
    expect(document.body.textContent).not.toMatch(UUID)
    expect(api.records).toHaveBeenLastCalledWith(...FRESH_FIRST_PAGE)
    // The form is cleared, so the request is not created a second time.
    expect(value(form, 'Test display')).toBe('')
    expect(value(form, 'Test code')).toBe('')
    expect(screen.queryByText(/accepted by Lab/)).toBeNull()
    // The work continues at the saved request's Send to Lab control.
    const send = await screen.findByRole('button', { name: 'Send to Lab' })
    await waitFor(() => expect(document.activeElement).toBe(send))
  })

  it('offers a role that cannot send to Lab only a draft, and says who can create an active request', async () => {
    staff.permissions = READ_WRITE
    await openLabRequests()
    const handling = await screen.findByLabelText(labelled('Request handling'))
    expect(within(handling).getAllByRole('option').map(option => (option as HTMLOptionElement).value)).toEqual(['draft'])
    expect(document.getElementById('lab-request-draft-warning')!.textContent)
      .toMatch(/Only someone who may send requests to Lab can activate it or create an active request/)
  })

  it('creates the next request with a new key after a request Lab did not take', async () => {
    api.createRecord.mockRejectedValueOnce(new HidApiError(502, 'The service could not complete the request.', { code: 'LAB_HANDOFF_UNCONFIRMED' }))
    api.createRecord.mockResolvedValueOnce({ ...labRequest('active'), labWorkItem: { id: 'work-item-1' }, labHandoff: { state: 'accepted' } })
    const form = await createActiveRequest()
    await screen.findByText(/^Lab request saved and active in the EHR/)
    type(form, 'Test code system', 'LOINC')
    type(form, 'Test code', '718-7')
    type(form, 'Test display', 'Haemoglobin')
    type(form, 'Request handling', 'active')
    fireEvent.click(within(form).getByRole('button', { name: 'Create lab request' }))
    await waitFor(() => expect(api.createRecord).toHaveBeenCalledTimes(2))
    expect(api.createRecord.mock.calls[1]![5]).not.toBe(api.createRecord.mock.calls[0]![5])
  })

  it('says a created request was accepted only when Lab accepted it', async () => {
    api.createRecord.mockResolvedValue({ ...labRequest('active'), labWorkItem: { id: 'work-item-1' }, labHandoff: { state: 'accepted' } })
    await createActiveRequest()
    expect(await screen.findByText('Active lab request created and accepted by Lab.')).toBeTruthy()
  })

  it('does not call a replayed create that Lab holds at an earlier version accepted', async () => {
    api.createRecord.mockImplementation(async () => {
      records['lab-requests'] = [labRequest('active', '2')]
      return { ...labRequest('active', '2'), labWorkItem: null, labHandoff: { state: 'already_accepted', code: 'LAB_ORDER_ALREADY_ACCEPTED' } }
    })
    await createActiveRequest()
    expect(await screen.findByText(/Lab holds an earlier version/)).toBeTruthy()
    expect(screen.queryByText(/accepted by Lab/)).toBeNull()
    // Send to Lab could only answer LAB_ORDER_ALREADY_ACCEPTED again: the work continues at the request.
    const title = await screen.findByText('Haemoglobin', { selector: 'strong' })
    await waitFor(() => expect(document.activeElement).toBe(title))
  })

  it('takes a 201 without a body as a saved request, not as a failure to save', async () => {
    api.createRecord.mockImplementation(async () => { records['lab-requests'] = [labRequest('active')]; return undefined })
    const form = await createActiveRequest()
    expect(await screen.findByText('Active lab request created and accepted by Lab.')).toBeTruthy()
    expect(within(form).queryByRole('alert')).toBeNull()
    expect(value(form, 'Test display')).toBe('')
  })
})

describe('activating or resuming a lab request', () => {
  async function statusForm() {
    return (await screen.findByLabelText(labelled('New status'))).closest('form')!
  }

  function options(form: HTMLElement) {
    return within(within(form).getByLabelText(labelled('New status'))).getAllByRole('option')
      .map(option => [(option as HTMLOptionElement).value, option.textContent])
  }

  it('offers a draft activation that sends it to Lab, and a held request only its resumption', async () => {
    records['lab-requests'] = [labRequest('draft')]
    await openLabRequests()
    expect(options(await statusForm())).toEqual([['cancelled', 'Cancel'], ['entered_in_error', 'Mark entered in error'],
      ['active', 'Activate and send to Lab']])
  })

  it('offers a held request only its resumption, and says why nothing else is offered', async () => {
    records['lab-requests'] = [labRequest('on_hold')]
    await openLabRequests()
    expect(options(await statusForm())).toEqual([['active', 'Resume and send to Lab']])
    expect(screen.getByText(/Putting this request on hold was not passed to Lab/)).toBeTruthy()
  })

  // EHR activates or resumes a request for a role without lab.work-item.accept without
  // sending it to Lab (labHandoff not_sent), and that role can neither send nor cancel it then.
  it('offers a role that cannot send to Lab no activation of a draft, and says who can activate it', async () => {
    staff.permissions = READ_WRITE
    records['lab-requests'] = [labRequest('draft')]
    await openLabRequests()
    expect(options(await statusForm())).toEqual([['cancelled', 'Cancel'], ['entered_in_error', 'Mark entered in error']])
    expect(screen.getByText(/only someone who may send requests to Lab can activate it/)).toBeTruthy()
  })

  it('offers a role that cannot send to Lab no resumption of a held request, and says who can resume it', async () => {
    staff.permissions = READ_WRITE
    records['lab-requests'] = [labRequest('on_hold')]
    await openLabRequests()
    expect(await screen.findByText(/only someone who may send requests to Lab can resume it/)).toBeTruthy()
    expect(screen.queryByLabelText(labelled('New status'))).toBeNull()
  })

  it('tells a role that cannot send to Lab who can send an active request Lab may not have', async () => {
    staff.permissions = READ_WRITE
    records['lab-requests'] = [labRequest('active')]
    await openLabRequests()
    expect(await screen.findByText(/someone who may send requests to Lab must use Send to Lab on it/)).toBeTruthy()
  })

  it('offers no status change for an active request, and says what is not passed to Lab', async () => {
    records['lab-requests'] = [labRequest('active')]
    await openLabRequests()
    expect(await screen.findByText(/Holding, cancelling, completing or marking it entered in error is not passed to Lab/)).toBeTruthy()
    expect(screen.queryByLabelText(labelled('New status'))).toBeNull()
  })

  async function activate(handoff: unknown, from = 'draft') {
    records['lab-requests'] = [labRequest(from)]
    api.updateRecord.mockImplementation(async () => {
      records['lab-requests'] = [labRequest('active', '2')]
      return { ...labRequest('active', '2'), labWorkItem: null, ...(handoff === undefined ? {} : { labHandoff: handoff }) }
    })
    await openLabRequests()
    const form = await statusForm()
    type(form, 'New status', 'active')
    type(form, 'Reason for change', 'Ready to order')
    fireEvent.click(within(form).getByRole('button', { name: 'Update status' }))
    await waitFor(() => expect(api.updateRecord).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER, 'lab-requests', REQUEST,
      { expectedRowVersion: 1, changeReason: 'Ready to order', status: 'active' }))
  }

  it('says an activation Lab accepted was accepted', async () => {
    await activate({ state: 'accepted' })
    expect(await screen.findByText('Lab request activated and accepted by Lab.')).toBeTruthy()
  })

  it('says a saved activation Lab did not accept was not accepted, and offers to send it again', async () => {
    await activate({ state: 'failed', status: 502, code: 'LAB_SERVICE_UNAVAILABLE' })
    const said = await screen.findByText(/did not accept/)
    expect(said.textContent).toMatch(/LAB_SERVICE_UNAVAILABLE/)
    expect(said.textContent).toMatch(/Send to Lab/)
    const send = await screen.findByRole('button', { name: 'Send to Lab' })
    await waitFor(() => expect(document.activeElement).toBe(send))
  })

  it('reloads the list and says the request changed when Lab found it no longer current', async () => {
    await activate({ state: 'failed', status: 409, code: 'LAB_ORDER_NOT_CURRENT' })
    expect(await screen.findByText(/changed again/)).toBeTruthy()
    expect(api.records).toHaveBeenLastCalledWith(...FRESH_FIRST_PAGE)
  })

  it('says a change Lab holds at an earlier version is not in Lab', async () => {
    await activate({ state: 'already_accepted', code: 'LAB_ORDER_ALREADY_ACCEPTED' })
    expect((await screen.findByText(/Lab holds an earlier version/)).textContent).toMatch(/not in Lab/)
    expect(screen.queryByText(/accepted by Lab\./)).toBeNull()
  })

  // The role was offered the activation, but no longer held lab.work-item.accept when EHR made it.
  it('says an activation was not sent when EHR finds the role cannot send requests to Lab', async () => {
    await activate({ state: 'not_sent', code: 'LAB_PERMISSION_ABSENT' })
    expect(await screen.findByText(/your role cannot send requests to Lab/)).toBeTruthy()
  })

  it('says Lab was not asked when the EHR reports nothing about Lab', async () => {
    await activate(undefined)
    expect(await screen.findByText(/Lab was not asked/)).toBeTruthy()
    expect(screen.queryByText(/accepted by Lab/)).toBeNull()
  })

  // An EHR before #56 tells Lab nothing of a resumption. It sent a request to Lab only when it was
  // created active, so Lab may hold the version it accepted then, or never have received it: a request
  // activated from a draft was never sent, and one Lab refused at creation stayed active.
  it('says a resumption the EHR reports nothing about was not told to Lab, which may hold its earlier version or never have had it', async () => {
    await activate(undefined, 'on_hold')
    const said = await screen.findByText(/^Lab request resumed in the EHR/)
    expect(said.textContent).toMatch(/Lab was not told of the resumption/)
    expect(said.textContent).toMatch(/it may hold the version it accepted before the hold/)
    expect(said.textContent).toMatch(/or may never have received this request/)
    // Contacting the laboratory is not left optional: neither possibility is known to be the case.
    expect(said.textContent).toMatch(/Contact the laboratory to confirm the test is ordered\.$/)
    expect(said.textContent).not.toMatch(/if the test is still needed/)
    expect(said.textContent).not.toMatch(/does not have it/)
  })

  it('moves to the request, not to Send to Lab, when Lab holds an earlier version of a resumed request', async () => {
    await activate({ state: 'already_accepted', code: 'LAB_ORDER_ALREADY_ACCEPTED' }, 'on_hold')
    await screen.findByText(/Lab holds an earlier version/)
    const title = await screen.findByText('Haemoglobin', { selector: 'strong' })
    await waitFor(() => expect(document.activeElement).toBe(title))
  })

  it('says the list was not reloaded only once, when reading it again fails', async () => {
    records['lab-requests'] = [labRequest('draft')]
    api.updateRecord.mockResolvedValue({ ...labRequest('active', '2'), labWorkItem: null,
      labHandoff: { state: 'failed', status: 409, code: 'LAB_ORDER_NOT_CURRENT' } })
    await openLabRequests()
    const form = await statusForm()
    api.records.mockRejectedValue(new Error('Service unavailable'))
    type(form, 'New status', 'active')
    type(form, 'Reason for change', 'Ready to order')
    fireEvent.click(within(form).getByRole('button', { name: 'Update status' }))
    const said = await screen.findByText(/changed again/)
    expect(said.textContent).toMatch(/The list could not be reloaded/)
    expect(said.textContent).not.toMatch(/list was reloaded/)
  })
})

describe('sending a saved active lab request to Lab', () => {
  it.each([
    ['without lab.work-item.accept', READ_WRITE, 'active'],
    ['without ehr.lab-request.write', ['ehr.encounter.read', 'ehr.lab-request.read', 'lab.work-item.accept'], 'active'],
    ['for a draft', SENDER, 'draft'],
    ['for a cancelled request', SENDER, 'cancelled'],
  ])('offers no Send to Lab %s', async (_case, permissions, status) => {
    staff.permissions = permissions
    records['lab-requests'] = [labRequest(status)]
    await openLabRequests()
    await screen.findByText('Haemoglobin')
    expect(screen.queryByRole('button', { name: 'Send to Lab' })).toBeNull()
  })

  it('offers no Send to Lab under read-only access', async () => {
    api.consentStatus.mockResolvedValue({ patientId: PATIENT, facilityId: 'facility-1', purpose: 'direct-care', readAllowed: true, writeAllowed: false })
    records['lab-requests'] = [labRequest('active')]
    await openLabRequests()
    await screen.findByText(/Read-only access/)
    expect(screen.queryByRole('button', { name: 'Send to Lab' })).toBeNull()
  })

  it('rechecks access, then sends the version shown with a key of its own', async () => {
    records['lab-requests'] = [labRequest('active', '3')]
    api.sendLabRequestToLab.mockResolvedValue({ id: 'work-item-1' })
    await openLabRequests()
    api.lookupPatient.mockClear()
    fireEvent.click(await screen.findByRole('button', { name: 'Send to Lab' }))
    await waitFor(() => expect(api.sendLabRequestToLab).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER, REQUEST, 3, expect.any(String)))
    expect(api.lookupPatient.mock.invocationCallOrder[0]).toBeLessThan(api.sendLabRequestToLab.mock.invocationCallOrder[0]!)
    expect(await screen.findByText(/Lab accepted this lab request/)).toBeTruthy()
  })

  it('says to send again when Lab did not confirm, without the request ID, and sends again with the same key', async () => {
    records['lab-requests'] = [labRequest('active', '3')]
    api.sendLabRequestToLab.mockRejectedValueOnce(new HidApiError(502, 'The service could not complete the request.', { code: 'LAB_HANDOFF_UNCONFIRMED' }))
    api.sendLabRequestToLab.mockResolvedValueOnce({ id: 'work-item-1' })
    await openLabRequests()
    fireEvent.click(await screen.findByRole('button', { name: 'Send to Lab' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/send again/i)
    expect(document.body.textContent).not.toMatch(UUID)
    fireEvent.click(screen.getByRole('button', { name: 'Send to Lab' }))
    await waitFor(() => expect(api.sendLabRequestToLab).toHaveBeenCalledTimes(2))
    expect(api.sendLabRequestToLab.mock.calls[1]![5]).toBe(api.sendLabRequestToLab.mock.calls[0]![5])
  })

  it.each([
    ['412 LAB_REQUEST_VERSION_CONFLICT', new HidApiError(412, 'Lab acceptance must bind to the current exact lab request version', { code: 'LAB_REQUEST_VERSION_CONFLICT' }), /changed since it was loaded/],
    ['409 LAB_ORDER_NOT_CURRENT', new HidApiError(409, 'Lab order is not current', { code: 'LAB_ORDER_NOT_CURRENT' }), /changed since it was loaded/],
    ['409 LAB_REQUEST_NOT_ELIGIBLE', new HidApiError(409, 'Only an active lab request can be sent to Lab', { code: 'LAB_REQUEST_NOT_ELIGIBLE' }), /no longer active/],
  ])('reloads the list when the request changed (%s)', async (_case, refusal, says) => {
    records['lab-requests'] = [labRequest('active', '3')]
    api.sendLabRequestToLab.mockRejectedValue(refusal)
    await openLabRequests()
    api.records.mockClear()
    fireEvent.click(await screen.findByRole('button', { name: 'Send to Lab' }))
    expect(await screen.findByText(says)).toBeTruthy()
    expect(api.records).toHaveBeenCalledWith('facility-1', PATIENT, ENCOUNTER, 'lab-requests', { cursor: undefined, fresh: true })
  })

  it('says the list could not be reloaded, and not that it was, when reading it again fails', async () => {
    records['lab-requests'] = [labRequest('active', '3')]
    api.sendLabRequestToLab.mockRejectedValue(new HidApiError(412, 'Lab acceptance must bind to the current exact lab request version', { code: 'LAB_REQUEST_VERSION_CONFLICT' }))
    await openLabRequests()
    api.records.mockRejectedValue(new Error('Service unavailable'))
    fireEvent.click(await screen.findByRole('button', { name: 'Send to Lab' }))
    const said = await screen.findByText(/changed since it was loaded/)
    expect(said.textContent).toMatch(/The list could not be reloaded/)
    expect(said.textContent).not.toMatch(/list was reloaded/)
  })

  it('does not say the list could not be reloaded when another list replaced the read', async () => {
    staff.permissions = [...SENDER, 'ehr.note.read']
    records['lab-requests'] = [labRequest('active', '3')]
    api.sendLabRequestToLab.mockRejectedValue(new HidApiError(412, 'Lab acceptance must bind to the current exact lab request version', { code: 'LAB_REQUEST_VERSION_CONFLICT' }))
    await openLabRequests()
    let reread: (value: unknown) => void = () => {}
    api.records.mockImplementationOnce(() => new Promise(resolve => { reread = resolve }))
    fireEvent.click(await screen.findByRole('button', { name: 'Send to Lab' }))
    await waitFor(() => expect(api.records).toHaveBeenLastCalledWith(...FRESH_FIRST_PAGE))
    // The clinician moves to the notes while the requests are read again.
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }))
    reread({ items: [labRequest('active', '4')], nextCursor: null })
    const said = await screen.findByText(/changed since it was loaded/)
    expect(said.textContent).not.toMatch(/could not be reloaded/)
  })

  it('says when Lab does not allow the clinician to accept the order', async () => {
    records['lab-requests'] = [labRequest('active', '3')]
    api.sendLabRequestToLab.mockRejectedValue(new HidApiError(403, 'Lab access denied', { code: 'LAB_ACCESS_DENIED' }))
    await openLabRequests()
    fireEvent.click(await screen.findByRole('button', { name: 'Send to Lab' }))
    expect(await screen.findByText('Lab does not allow you to accept this order for this patient.')).toBeTruthy()
  })

  it('says a request Lab holds at an earlier version was not sent', async () => {
    records['lab-requests'] = [labRequest('active', '3')]
    api.sendLabRequestToLab.mockRejectedValue(new HidApiError(409, 'Lab already accepted this order', { code: 'LAB_ORDER_ALREADY_ACCEPTED' }))
    await openLabRequests()
    fireEvent.click(await screen.findByRole('button', { name: 'Send to Lab' }))
    expect((await screen.findByText(/earlier version/)).textContent).toMatch(/contact the laboratory/i)
  })
})
