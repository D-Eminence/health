import { Profiler } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import type { LabAccession, LabExecution, LabResult, LabResultRevision, LabSpecimen, LabWorkItem, staffApi } from '../api'
import { Laboratory } from './Operations'

/**
 * The provider Laboratory page: accepted work, specimen accession and custody,
 * analytical execution, manual results and their governance. Patient
 * authorization is enforced by the backend; when the execution list is refused
 * (403) or the specimen is no longer visible (404), the page must show an
 * access-denied state and drop any result values already on screen.
 */
type StaffApi = typeof staffApi

const api = vi.hoisted(() => ({
  labWorkItems: vi.fn<StaffApi['labWorkItems']>(),
  createLabAccession: vi.fn<StaffApi['createLabAccession']>(),
  labAccession: vi.fn<StaffApi['labAccession']>(),
  transitionSpecimen: vi.fn<StaffApi['transitionSpecimen']>(),
  labExecutions: vi.fn<StaffApi['labExecutions']>(),
  startLabExecution: vi.fn<StaffApi['startLabExecution']>(),
  completeLabExecution: vi.fn<StaffApi['completeLabExecution']>(),
  enterLabResult: vi.fn<StaffApi['enterLabResult']>(),
  correctLabResult: vi.fn<StaffApi['correctLabResult']>(),
  verifyLabResult: vi.fn<StaffApi['verifyLabResult']>(),
  releaseLabResult: vi.fn<StaffApi['releaseLabResult']>(),
  labResultHistory: vi.fn<StaffApi['labResultHistory']>(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[] }))

vi.mock('../App', () => ({
  useStaff: () => ({ state: { status: 'ready', session: { actor: { facility: {
    id: 'facility-1', membershipId: 'member-1', permissions: staff.permissions,
  } } } } }),
}))
vi.mock('../api', () => ({ staffApi: api }))

const FACILITY = 'facility-1'
const PATIENT = 'a0000000-0000-4000-8000-0000004f9c2e'
const MASKED_PATIENT = '••••4f9c2e'
const ACCESS_DENIED = 'Access denied. You are not authorized to view lab results for this patient. Results stay hidden until access is granted again.'
const UNVERIFIED = 'Lab results are hidden because access to them could not be verified right now. Refresh to check again.'
const SIGNED_OUT = 'Lab results are hidden because your session has ended. Sign in again to view them.'
const TRANSCRIPTION_FIX = 'Transcription error corrected'
// What the work list says once it holds as many items as the backend sends.
const WORK_LIST_CAP_NOTICE = 'This list can show only the 200 oldest accepted work items. Any item accepted after them is not shown and cannot be reached from this page: completing work or refreshing the list does not bring it into view. Contact your facility administrator about orders not listed here.'

const WORK_READ = ['lab.work-item.read']
const ACCESSION_READ = [...WORK_READ, 'lab.accession.read']
const EXECUTION_READ = [...ACCESSION_READ, 'lab.execution.read']

/** Errors as the real client raises them, with the lab-api's own statuses, codes and messages. */
const problem = (status: number, code: string, message: string) => new HidApiError(status, message, { code })
const RESULT_ACCESS_REFUSED = 'Lab execution/result access is not authorized'
const executionAccessDenied = () => problem(403, 'LAB_EXECUTION_ACCESS_DENIED', RESULT_ACCESS_REFUSED)
const specimenNotFound = () => problem(404, 'LAB_SPECIMEN_NOT_FOUND', 'Lab specimen was not found')
const IDENTITY_UNAVAILABLE = 'Identity authorization service is unavailable'
const identityUnavailable = () => problem(503, 'IDENTITY_SERVICE_UNAVAILABLE', IDENTITY_UNAVAILABLE)
const operationRefused = () => problem(403, 'LAB_OPERATION_ACCESS_DENIED', 'Lab operation is not authorized')

const workItem = (overrides: Partial<LabWorkItem> = {}): LabWorkItem => ({
  id: 'work-item-1', patientId: PATIENT, version: 1, status: 'accepted', testName: 'Haemoglobin',
  accessionId: null, accessionNumber: null, acceptedAt: '2026-10-09T08:00:00.000Z', ...overrides,
})
const accessionedItem = workItem({ accessionId: 'accession-1', accessionNumber: 'ACC-2026-000123', specimenStatuses: ['received'] })

const specimen = (status: string, overrides: Partial<LabSpecimen> = {}): LabSpecimen => ({
  id: 'specimen-1', accessionId: 'accession-1', specimenIdentifier: 'SPC-000123', specimenType: 'Venous blood',
  status, version: 2, ...overrides,
})
const accession = (specimens: LabSpecimen[], overrides: Partial<LabAccession> = {}): LabAccession => ({
  id: 'accession-1', accessionNumber: 'ACC-2026-000123', workItemId: 'work-item-1', status: 'open', specimens, ...overrides,
})
const revision = (overrides: Partial<LabResultRevision> = {}): LabResultRevision => ({
  version: 1, resultType: 'numeric', numericValue: 7.1, textValue: null, unit: 'g/dL', referenceRange: '12.0-15.5',
  abnormalFlag: 'low', entrySource: 'manual', verificationStatus: 'unverified', releaseStatus: 'not_released',
  enteredAt: '2026-10-09T10:00:00.000Z', correctionReason: null, ...overrides,
})
const unverifiedResult = (overrides: Partial<LabResult> = {}): LabResult => ({
  id: 'result-1', executionId: 'execution-1', status: 'entered_unverified', verificationStatus: 'unverified',
  currentVersion: 1, currentReleasedVersion: null, revisions: [revision()], ...overrides,
})
const verifiedResult = (): LabResult => unverifiedResult({
  status: 'verified_not_released', verificationStatus: 'verified',
  revisions: [revision({ verificationStatus: 'verified', releaseStatus: 'verified_not_released' })],
})
const releasedResult = (): LabResult => unverifiedResult({
  status: 'released', verificationStatus: 'verified', currentReleasedVersion: 1,
  revisions: [revision({ verificationStatus: 'verified', releaseStatus: 'released' })],
})
/** `base` after a correction to 7.4 g/dL: a new current version that is unverified again. */
const correctionOf = (base: LabResult): LabResult => ({
  ...base, status: 'entered_unverified', verificationStatus: 'unverified', currentVersion: 2,
  revisions: [...base.revisions, revision({ version: 2, numericValue: 7.4, enteredAt: '2026-10-09T11:00:00.000Z', correctionReason: TRANSCRIPTION_FIX })],
})
const execution = (overrides: Partial<LabExecution> = {}): LabExecution => ({
  id: 'execution-1', accessionId: 'accession-1', specimenId: 'specimen-1', requestedTestId: 'requested-test-1',
  test: { codeSystem: 'LOINC', code: '718-7', name: 'Hemoglobin' }, patientId: PATIENT, facilityId: FACILITY,
  status: 'completed', method: 'Automated haematology analyser', startedAt: '2026-10-09T09:00:00.000Z',
  completedAt: '2026-10-09T09:30:00.000Z', version: 2, result: null, ...overrides,
})
const inProgress = () => execution({ status: 'in_progress', completedAt: null, version: 1 })

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>(settle => { resolve = settle })
  return { promise, resolve }
}

function formOf(element: HTMLElement): HTMLFormElement {
  const form = element.closest('form')
  if (!form) throw new Error('Expected the control to sit inside a form.')
  return form
}

function sectionOf(heading: string): HTMLElement {
  const section = screen.getByRole('heading', { name: heading }).parentElement
  if (!section) throw new Error(`Expected a section for "${heading}".`)
  return section
}

function optionLabels(select: HTMLElement) {
  return within(select).getAllByRole('option').map(option => option.textContent)
}

/**
 * The error a refused field is described by, once it is marked invalid: a
 * value refused before sending is reported at its field (PEHR-04).
 */
async function refusalOf(control: HTMLElement) {
  await waitFor(() => expect(control.getAttribute('aria-invalid')).toBe('true'))
  return document.getElementById(control.getAttribute('aria-describedby') ?? '')?.textContent
}

function valueOf(element: HTMLElement) {
  return (element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value
}

/** A full patient identifier must never reach the page: not as text, and not in any attribute. */
function expectNoFullPatientId(...others: string[]) {
  for (const id of [PATIENT, ...others]) expect(document.body.innerHTML).not.toContain(id)
}

/** Clicks a button once the load it triggered last time has finished. */
async function clickWhenEnabled(button: HTMLElement) {
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(button)
}

/**
 * Renders the page, opens the accessioned work item and waits for its specimens.
 * `onCommit` runs after every React commit, once the DOM holds what was committed.
 */
async function openAccession(permissions: string[], value: LabAccession, onCommit?: () => void) {
  staff.permissions = permissions
  api.labWorkItems.mockResolvedValue({ items: [accessionedItem] })
  api.labAccession.mockResolvedValue(value)
  render(onCommit ? <Profiler id="laboratory" onRender={onCommit}><Laboratory /></Profiler> : <Laboratory />)
  fireEvent.click(await screen.findByRole('button', { name: 'Open accession' }))
  const card = sectionOf('Specimen accession')
  await within(card).findByText('Venous blood · SPC-000123')
  expect(api.labAccession).toHaveBeenCalledWith(FACILITY, 'accession-1')
  return card
}

/**
 * Opens a received specimen and returns its analytical execution panel. The
 * executions load asynchronously, so each test first waits (findBy*) for the
 * loaded content it expects before asserting what is absent.
 */
async function openExecutionPanel(permissions: string[]) {
  await openAccession(permissions, accession([specimen('received')]))
  const panel = sectionOf('Analytical execution')
  await waitFor(() => expect(api.labExecutions).toHaveBeenCalledWith(FACILITY, 'specimen-1'))
  return panel
}

async function refreshExecutions(panel: HTMLElement) {
  await clickWhenEnabled(within(panel).getByRole('button', { name: 'Refresh executions' }))
}

async function executionsSettled(panel: HTMLElement) {
  await waitFor(() => expect(within(panel).queryByText('Loading executions…')).toBeNull())
}

beforeEach(() => {
  vi.resetAllMocks()
  staff.permissions = [...WORK_READ]
  api.labWorkItems.mockResolvedValue({ items: [] })
  api.labExecutions.mockResolvedValue({ items: [] })
})

describe('Laboratory page access', () => {
  it('shows the unavailable state, in plain words that name no permission, and loads nothing without lab work-item read permission', () => {
    staff.permissions = ['lab.accession.read', 'lab.execution.read', 'lab.result.verify']
    render(<Laboratory />)

    expect(screen.getByRole('heading', { name: 'Laboratory unavailable' })).toBeTruthy()
    expect(screen.getByText('Your role at this facility doesn’t include the lab’s work list and results. Ask your facility administrator.')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/permission|membership|work-item|lab\.work-item\.read/i)
    expect(screen.queryByRole('heading', { name: 'Laboratory' })).toBeNull()
    expect(api.labWorkItems).not.toHaveBeenCalled()
  })
})

describe('Laboratory work-item list', () => {
  it('shows a loading status while accepted work is being fetched', async () => {
    const pending = deferred<{ items: LabWorkItem[] }>()
    api.labWorkItems.mockReturnValue(pending.promise)
    render(<Laboratory />)

    expect(screen.getByRole('status').textContent).toBe('Loading…')
    // Unavailable while the list is read, yet focusable (NEW-PEHR-ACTION-FOCUS).
    expect(screen.getByRole('button', { name: 'Refresh work' }).getAttribute('aria-disabled')).toBe('true')
    expect(api.labWorkItems).toHaveBeenCalledWith(FACILITY)

    pending.resolve({ items: [workItem()] })
    expect(await screen.findByText('Haemoglobin')).toBeTruthy()
    expect(screen.queryByText('Loading…')).toBeNull()
  })

  it('shows the empty state and reloads when Refresh is pressed', async () => {
    render(<Laboratory />)

    expect(await screen.findByRole('heading', { name: 'No accepted lab work' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()

    api.labWorkItems.mockResolvedValue({ items: [workItem()] })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await screen.findByText('Haemoglobin')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'No accepted lab work' })).toBeNull()
    expect(api.labWorkItems).toHaveBeenCalledTimes(2)
    expect(api.labWorkItems).toHaveBeenLastCalledWith(FACILITY)
  })

  it('shows the load error and recovers when the work list is refreshed', async () => {
    api.labWorkItems.mockRejectedValueOnce(problem(503, 'SERVICE_UNAVAILABLE', 'The service is temporarily unavailable. Please try again shortly.'))
    api.labWorkItems.mockResolvedValue({ items: [workItem()] })
    render(<Laboratory />)

    expect((await screen.findByRole('alert')).textContent).toBe('The service is temporarily unavailable. Please try again shortly.')
    expect(screen.queryByRole('heading', { name: 'No accepted lab work' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh work' }))

    expect(await screen.findByText('Haemoglobin')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(api.labWorkItems).toHaveBeenCalledTimes(2)
  })

  it('lists accepted work with status badges and masked patient identifiers only', async () => {
    const otherPatient = 'b0000000-0000-4000-8000-00000071d3a8'
    staff.permissions = [...WORK_READ, 'lab.accession.create', 'lab.accession.read']
    api.labWorkItems.mockResolvedValue({ items: [
      workItem(),
      workItem({ id: 'work-item-2', patientId: otherPatient, testName: 'Serum ferritin', accessionId: 'accession-2', accessionNumber: 'ACC-2026-000124' }),
      workItem({ id: 'work-item-3', testName: undefined }),
    ] })
    render(<Laboratory />)

    const first = (await screen.findByText('Haemoglobin')).closest('.staff-list-item') as HTMLElement
    expect(within(first).getByText('accepted')).toBeTruthy()
    expect(within(first).getByText(new RegExp(`^Patient ${MASKED_PATIENT} · Accepted `))).toBeTruthy()
    expect(within(first).getByRole('button', { name: 'Prepare accession' })).toBeTruthy()

    const second = screen.getByText('Serum ferritin').closest('.staff-list-item') as HTMLElement
    expect(within(second).getByText('Accessioned')).toBeTruthy()
    expect(within(second).getByText('Accession ACC-2026-000124')).toBeTruthy()
    expect(within(second).getByText(/^Patient ••••71d3a8 · /)).toBeTruthy()
    expect(within(second).getByRole('button', { name: 'Open accession' })).toBeTruthy()

    expect(screen.getByText('Lab test')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Choose work' })).toBeTruthy()
    expectNoFullPatientId(otherPatient)
  })

  it('offers no accession actions without the matching accession permissions', async () => {
    api.labWorkItems.mockResolvedValue({ items: [workItem(), workItem({ id: 'work-item-2', accessionId: 'accession-2', accessionNumber: 'ACC-2026-000124' })] })
    render(<Laboratory />)

    expect(await screen.findByText('Accession ACC-2026-000124')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Prepare accession' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open accession' })).toBeNull()
  })
})

describe('Laboratory accession creation', () => {
  const permissions = [...WORK_READ, 'lab.accession.create', 'lab.accession.read']

  async function openForm() {
    staff.permissions = permissions
    api.labWorkItems.mockResolvedValue({ items: [workItem()] })
    render(<Laboratory />)
    fireEvent.click(await screen.findByRole('button', { name: 'Prepare accession' }))
    const card = sectionOf('Create specimen accession')
    expect(within(card).getByText(`Haemoglobin · Patient ${MASKED_PATIENT}`)).toBeTruthy()
    expectNoFullPatientId()
    return card
  }

  it('requires a specimen type and clinical reason before calling the API', async () => {
    const card = await openForm()

    fireEvent.submit(formOf(within(card).getByRole('button', { name: 'Create accession' })))

    expect(await refusalOf(within(card).getByRole('textbox', { name: 'Specimen type' }))).toBe('Enter a specimen type and clinical reason.')
    expect(api.createLabAccession).not.toHaveBeenCalled()
  })

  it('creates the accession and then loads it by its new id', async () => {
    const created = accession([specimen('required', { id: 'specimen-7', accessionId: 'accession-7', specimenIdentifier: 'SPC-000777' })],
      { id: 'accession-7', accessionNumber: 'ACC-2026-000777' })
    api.createLabAccession.mockResolvedValue(created)
    api.labAccession.mockResolvedValue(created)
    const card = await openForm()
    api.labWorkItems.mockResolvedValue({ items: [workItem({ accessionId: 'accession-7', accessionNumber: 'ACC-2026-000777' })] })

    fireEvent.change(within(card).getByRole('textbox', { name: 'Specimen type' }), { target: { value: ' Venous blood ' } })
    fireEvent.change(within(card).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Suspected iron deficiency anaemia' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Create accession' }))

    await waitFor(() => expect(api.labAccession).toHaveBeenCalledWith(FACILITY, 'accession-7'))
    expect(api.createLabAccession).toHaveBeenCalledWith(FACILITY, 'work-item-1', 'Venous blood', 'Suspected iron deficiency anaemia')
    const view = sectionOf('Specimen accession')
    expect(await within(view).findByText('Venous blood · SPC-000777')).toBeTruthy()
    expect(within(view).getByText('Accession ACC-2026-000777')).toBeTruthy()
    expect(within(view).getByText('required')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Create specimen accession' })).toBeNull()
    await waitFor(() => expect(api.labWorkItems).toHaveBeenCalledTimes(2))
    expectNoFullPatientId()
  })

  it('shows the API error when the accession cannot be created', async () => {
    api.createLabAccession.mockRejectedValue(problem(409, 'LAB_WORK_ITEM_NOT_ACCESSIONABLE', 'Lab work item is not accessionable at this facility'))
    const card = await openForm()

    fireEvent.change(within(card).getByRole('textbox', { name: 'Specimen type' }), { target: { value: 'Venous blood' } })
    fireEvent.change(within(card).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Suspected iron deficiency anaemia' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Create accession' }))

    expect((await within(card).findByRole('alert')).textContent).toBe('Lab work item is not accessionable at this facility')
    expect(api.labAccession).not.toHaveBeenCalled()
    const retry = within(card).getByRole('button', { name: 'Create accession' }) as HTMLButtonElement
    await waitFor(() => expect(retry.disabled).toBe(false))
  })
})

describe('Laboratory accession view', () => {
  const custody = [...ACCESSION_READ, 'lab.specimen.collect', 'lab.specimen.receive', 'lab.specimen.reject']

  it('shows a loading status while the accession is fetched', async () => {
    const pending = deferred<LabAccession>()
    staff.permissions = ACCESSION_READ
    api.labWorkItems.mockResolvedValue({ items: [accessionedItem] })
    api.labAccession.mockReturnValue(pending.promise)
    render(<Laboratory />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open accession' }))

    const card = sectionOf('Specimen accession')
    expect(within(card).getByRole('status').textContent).toBe('Loading accession…')
    expect(within(card).getByRole('button', { name: 'Refresh accession' }).getAttribute('aria-disabled')).toBe('true')
    expect(api.labAccession).toHaveBeenCalledWith(FACILITY, 'accession-1')

    pending.resolve(accession([specimen('received')]))
    expect(await within(card).findByText('Venous blood · SPC-000123')).toBeTruthy()
    await waitFor(() => expect(within(card).queryByText('Loading accession…')).toBeNull())
  })

  it.each([
    ['refused', operationRefused()],
    ['not found', problem(404, 'LAB_ACCESSION_NOT_FOUND', 'Lab accession was not found')],
  ])('shows the error and no specimens when the accession is %s, then recovers on refresh', async (_case, error) => {
    staff.permissions = custody
    api.labWorkItems.mockResolvedValue({ items: [accessionedItem] })
    api.labAccession.mockRejectedValueOnce(error).mockResolvedValue(accession([specimen('required')]))
    render(<Laboratory />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open accession' }))
    const card = sectionOf('Specimen accession')

    expect((await within(card).findByRole('alert')).textContent).toBe(error.message)
    expect(within(card).queryByText('Venous blood · SPC-000123')).toBeNull()
    expect(within(card).queryByRole('combobox', { name: 'Next step' })).toBeNull()

    await clickWhenEnabled(within(card).getByRole('button', { name: 'Refresh accession' }))

    expect(await within(card).findByText('Venous blood · SPC-000123')).toBeTruthy()
    expect(within(card).queryByRole('alert')).toBeNull()
    expect(api.labAccession).toHaveBeenCalledTimes(2)
  })

  it('removes the specimens already shown when a refresh is refused', async () => {
    const card = await openAccession(custody, accession([specimen('required')]))
    expect(within(card).getByRole('combobox', { name: 'Next step' })).toBeTruthy()
    api.labAccession.mockRejectedValueOnce(operationRefused())

    await clickWhenEnabled(within(card).getByRole('button', { name: 'Refresh accession' }))

    expect((await within(card).findByRole('alert')).textContent).toBe('Lab operation is not authorized')
    expect(api.labAccession).toHaveBeenCalledTimes(2)
    expect(within(card).queryByText('Venous blood · SPC-000123')).toBeNull()
    expect(within(card).queryByText('Accession ACC-2026-000123')).toBeNull()
    expect(within(card).queryByRole('combobox', { name: 'Next step' })).toBeNull()
  })
})

describe('Laboratory specimen custody', () => {
  const custody = [...ACCESSION_READ, 'lab.specimen.collect', 'lab.specimen.receive', 'lab.specimen.reject']

  it('offers collect and reject for a required specimen', async () => {
    const card = await openAccession(custody, accession([specimen('required')]))

    const step = within(card).getByRole('combobox', { name: 'Next step' })
    expect(optionLabels(step)).toEqual(['Mark collected', 'Reject specimen'])
    expect(valueOf(step)).toBe('collect')
    expect(within(card).getByText('required')).toBeTruthy()
  })

  it('limits the next steps to the granted lab.specimen permissions', async () => {
    const card = await openAccession([...ACCESSION_READ, 'lab.specimen.collect'], accession([specimen('required')]))

    expect(optionLabels(within(card).getByRole('combobox', { name: 'Next step' }))).toEqual(['Mark collected'])
  })

  it('does not offer receipt of a collected specimen without lab.specimen.receive', async () => {
    const card = await openAccession([...ACCESSION_READ, 'lab.specimen.collect', 'lab.specimen.reject'], accession([specimen('collected', { version: 3 })]))

    const step = within(card).getByRole('combobox', { name: 'Next step' })
    expect(optionLabels(step)).toEqual(['Reject specimen'])
    expect(valueOf(step)).toBe('reject')
    expect(within(card).getByRole('textbox', { name: 'Rejection reason' })).toBeTruthy()
  })

  it('offers no custody step without lab.specimen permissions', async () => {
    const card = await openAccession(ACCESSION_READ, accession([specimen('required')]))

    expect(within(card).queryByRole('combobox', { name: 'Next step' })).toBeNull()
    expect(within(card).queryByRole('button', { name: 'Record step' })).toBeNull()
  })

  it('records collection and reloads the accession', async () => {
    const required = specimen('required')
    const card = await openAccession(custody, accession([required]))
    api.transitionSpecimen.mockResolvedValue(specimen('collected', { version: 3 }))
    api.labAccession.mockResolvedValue(accession([specimen('collected', { version: 3 })]))

    fireEvent.change(within(card).getByRole('textbox', { name: 'Notes or condition' }), { target: { value: 'Collected at bedside, left arm' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Record step' }))

    await waitFor(() => expect(api.labAccession).toHaveBeenCalledTimes(2))
    expect(api.transitionSpecimen).toHaveBeenCalledWith(FACILITY, 'accession-1', required, 'collect', 'Collected at bedside, left arm')
    expect(api.labAccession).toHaveBeenLastCalledWith(FACILITY, 'accession-1')
    expect(await within(card).findByText('collected')).toBeTruthy()
    expect(optionLabels(within(card).getByRole('combobox', { name: 'Next step' }))).toEqual(['Mark received', 'Reject specimen'])
    await waitFor(() => expect(api.labWorkItems).toHaveBeenCalledTimes(2))
  })

  it('requires a rejection reason before rejecting a specimen', async () => {
    const required = specimen('required')
    const card = await openAccession(custody, accession([required]))
    api.transitionSpecimen.mockResolvedValue(specimen('rejected', { version: 3 }))

    fireEvent.change(within(card).getByRole('combobox', { name: 'Next step' }), { target: { value: 'reject' } })
    const reason = within(card).getByRole('textbox', { name: 'Rejection reason' })
    expect((reason as HTMLInputElement).required).toBe(true)
    fireEvent.submit(formOf(reason))

    expect(await refusalOf(reason)).toBe('Enter a rejection reason.')
    expect(api.transitionSpecimen).not.toHaveBeenCalled()

    fireEvent.change(reason, { target: { value: 'Sample haemolysed' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Record step' }))

    await waitFor(() => expect(api.transitionSpecimen).toHaveBeenCalledWith(FACILITY, 'accession-1', required, 'reject', 'Sample haemolysed'))
  })

  it('treats a whitespace-only rejection reason as missing', async () => {
    const card = await openAccession(custody, accession([specimen('required')]))

    fireEvent.change(within(card).getByRole('combobox', { name: 'Next step' }), { target: { value: 'reject' } })
    const reason = within(card).getByRole('textbox', { name: 'Rejection reason' })
    fireEvent.change(reason, { target: { value: '   ' } })
    fireEvent.submit(formOf(reason))

    expect(await refusalOf(reason)).toBe('Enter a rejection reason.')
    expect(api.transitionSpecimen).not.toHaveBeenCalled()
  })

  it('offers receipt for a collected specimen', async () => {
    const collected = specimen('collected', { version: 3 })
    const card = await openAccession(custody, accession([collected]))
    api.transitionSpecimen.mockResolvedValue(specimen('received', { version: 4 }))
    api.labAccession.mockResolvedValue(accession([specimen('received', { version: 4 })]))

    const step = within(card).getByRole('combobox', { name: 'Next step' })
    expect(optionLabels(step)).toEqual(['Mark received', 'Reject specimen'])
    expect(valueOf(step)).toBe('receive')
    fireEvent.change(within(card).getByRole('textbox', { name: 'Notes or condition' }), { target: { value: 'Intact, chilled' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Record step' }))

    await waitFor(() => expect(api.labAccession).toHaveBeenCalledTimes(2))
    expect(api.transitionSpecimen).toHaveBeenCalledWith(FACILITY, 'accession-1', collected, 'receive', 'Intact, chilled')
    expect(await within(card).findByText('received')).toBeTruthy()
    expect(within(card).queryByRole('combobox', { name: 'Next step' })).toBeNull()
  })

  it('shows the API error when a custody step is refused', async () => {
    const card = await openAccession(custody, accession([specimen('required')]))
    api.transitionSpecimen.mockRejectedValue(problem(412, 'VERSION_CONFLICT', 'Specimen changed since it was loaded'))

    fireEvent.click(within(card).getByRole('button', { name: 'Record step' }))

    expect((await within(card).findByRole('alert')).textContent).toBe('Specimen changed since it was loaded')
    expect(api.labAccession).toHaveBeenCalledTimes(1)
    expect(within(card).getByText('required')).toBeTruthy()
  })
})

describe('Laboratory analytical execution', () => {
  it('shows a loading status while executions are fetched', async () => {
    const pending = deferred<{ items: LabExecution[] }>()
    api.labExecutions.mockReturnValue(pending.promise)
    const panel = await openExecutionPanel(EXECUTION_READ)

    expect((await within(panel).findByRole('status')).textContent).toBe('Loading executions…')
    expect(within(panel).getByRole('button', { name: 'Refresh executions' }).getAttribute('aria-disabled')).toBe('true')
    expect(within(panel).queryByText('No execution has started for this specimen.')).toBeNull()

    pending.resolve({ items: [inProgress()] })
    expect(await within(panel).findByText('Hemoglobin · LOINC 718-7')).toBeTruthy()
    await executionsSettled(panel)
  })

  it('starts an execution for a received specimen', async () => {
    const received = specimen('received')
    const started = inProgress()
    api.labExecutions.mockResolvedValueOnce({ items: [] }).mockResolvedValue({ items: [started] })
    api.startLabExecution.mockResolvedValue(started)
    const panel = await openExecutionPanel([...EXECUTION_READ, 'lab.execution.start'])

    fireEvent.change(await within(panel).findByRole('textbox', { name: 'Method' }), { target: { value: 'Automated haematology analyser' } })
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Routine full blood count' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Start execution' }))

    expect(await within(panel).findByText('Analytical execution started.')).toBeTruthy()
    expect(api.startLabExecution).toHaveBeenCalledWith(FACILITY, received, 'Routine full blood count', 'Automated haematology analyser')
    expect(within(panel).getByText('in progress')).toBeTruthy()
    await waitFor(() => expect(api.labExecutions).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(within(panel).queryByRole('button', { name: 'Start execution' })).toBeNull())
    expectNoFullPatientId()
  })

  it('requires a reason before starting an execution', async () => {
    const panel = await openExecutionPanel([...EXECUTION_READ, 'lab.execution.start'])

    fireEvent.submit(formOf(await within(panel).findByRole('button', { name: 'Start execution' })))

    expect(await refusalOf(within(panel).getByRole('textbox', { name: 'Reason' }))).toBe('Enter a reason to begin execution.')
    expect(api.startLabExecution).not.toHaveBeenCalled()
    // The form stays, so the reason can be typed without a refresh.
    expect(within(panel).getByRole('button', { name: 'Start execution' })).toBeTruthy()
    expect(within(panel).getByRole('textbox', { name: 'Reason' })).toBeTruthy()
  })

  it('shows the API error when the execution cannot be started', async () => {
    api.startLabExecution.mockRejectedValue(problem(412, 'SPECIMEN_NOT_EXECUTABLE', 'Only the expected received specimen version can begin execution'))
    const panel = await openExecutionPanel([...EXECUTION_READ, 'lab.execution.start'])

    fireEvent.change(await within(panel).findByRole('textbox', { name: 'Reason' }), { target: { value: 'Routine full blood count' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Start execution' }))

    expect((await within(panel).findByRole('alert')).textContent).toBe('Only the expected received specimen version can begin execution')
    expect(api.startLabExecution).toHaveBeenCalledWith(FACILITY, specimen('received'), 'Routine full blood count', '')
    expect(within(panel).queryByText('Analytical execution started.')).toBeNull()
    expect(api.labExecutions).toHaveBeenCalledTimes(1)
  })

  it('completes an in-progress execution', async () => {
    const running = inProgress()
    const done = execution({ status: 'completed', version: 2 })
    api.labExecutions.mockResolvedValueOnce({ items: [running] }).mockResolvedValue({ items: [done] })
    api.completeLabExecution.mockResolvedValue(done)
    const panel = await openExecutionPanel([...EXECUTION_READ, 'lab.execution.complete'])

    expect(await within(panel).findByText('Hemoglobin · LOINC 718-7')).toBeTruthy()
    expect(within(panel).getByText('in progress')).toBeTruthy()
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Completion notes' }), { target: { value: 'Run within QC limits' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Complete execution' }))

    expect(await within(panel).findByText('Analytical execution was completed.')).toBeTruthy()
    expect(api.completeLabExecution).toHaveBeenCalledWith(FACILITY, running, 'Run within QC limits')
    expect(within(panel).getByText('completed')).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'Complete execution' })).toBeNull()
  })

  it('shows the API error and keeps the execution open when completion is refused', async () => {
    const running = inProgress()
    api.labExecutions.mockResolvedValue({ items: [running] })
    api.completeLabExecution.mockRejectedValue(problem(412, 'VERSION_CONFLICT', 'Execution changed or is not in progress'))
    const panel = await openExecutionPanel([...EXECUTION_READ, 'lab.execution.complete'])

    fireEvent.click(await within(panel).findByRole('button', { name: 'Complete execution' }))

    expect((await within(panel).findByRole('alert')).textContent).toBe('Execution changed or is not in progress')
    expect(api.completeLabExecution).toHaveBeenCalledWith(FACILITY, running, '')
    expect(within(panel).queryByText('Analytical execution was completed.')).toBeNull()
    expect(within(panel).getByText('in progress')).toBeTruthy()
    expect(api.labExecutions).toHaveBeenCalledTimes(1)
    await waitFor(() => expect((within(panel).getByRole('button', { name: 'Complete execution' }) as HTMLButtonElement).disabled).toBe(false))
  })

  it('does not offer completion without lab.execution.complete', async () => {
    api.labExecutions.mockResolvedValue({ items: [inProgress()] })
    const panel = await openExecutionPanel(EXECUTION_READ)

    expect(await within(panel).findByText('in progress')).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'Complete execution' })).toBeNull()
  })

  it('tells a read-only member that no execution has started', async () => {
    const panel = await openExecutionPanel(EXECUTION_READ)

    expect(await within(panel).findByText('No execution has started for this specimen.')).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'Start execution' })).toBeNull()
  })
})

describe('Laboratory manual result entry', () => {
  const permissions = [...EXECUTION_READ, 'lab.result.enter']

  it('offers manual entry for a completed execution without a result', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution()] })
    const panel = await openExecutionPanel(permissions)

    expect(await within(panel).findByText('Enter manual result')).toBeTruthy()
    expect(within(panel).getByText('Entry is unverified until an independent reviewer verifies it.')).toBeTruthy()
  })

  it('rejects a blank or non-numeric value without calling the API', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution()] })
    const panel = await openExecutionPanel(permissions)

    fireEvent.click(await within(panel).findByText('Enter manual result'))
    const value = within(panel).getByRole('spinbutton', { name: 'Numeric value' })
    // A number input sanitises non-numeric text to an empty value (in jsdom as
    // in browsers), so typed text reaches the same check as a blank field.
    fireEvent.change(value, { target: { value: 'not-a-number' } })
    expect(valueOf(value)).toBe('')
    fireEvent.submit(formOf(value))

    expect(await refusalOf(value)).toBe('Enter a valid numeric result.')
    expect(api.enterLabResult).not.toHaveBeenCalled()
  })

  it('records an unverified numeric result', async () => {
    const completed = execution()
    const entered = unverifiedResult({ revisions: [revision({ numericValue: 13.4, abnormalFlag: 'normal' })] })
    api.labExecutions.mockResolvedValueOnce({ items: [completed] }).mockResolvedValue({ items: [{ ...completed, result: entered }] })
    api.enterLabResult.mockResolvedValue(entered)
    const panel = await openExecutionPanel(permissions)

    fireEvent.click(await within(panel).findByText('Enter manual result'))
    fireEvent.change(within(panel).getByRole('spinbutton', { name: 'Numeric value' }), { target: { value: '13.4' } })
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Unit' }), { target: { value: 'g/dL' } })
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Reference range' }), { target: { value: '12.0-15.5' } })
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Abnormal flag' }), { target: { value: 'normal' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Record unverified result' }))

    expect(await within(panel).findByText('An unverified result was recorded.')).toBeTruthy()
    expect(api.enterLabResult).toHaveBeenCalledWith(FACILITY, completed, {
      resultType: 'numeric', numericValue: 13.4, unit: 'g/dL', referenceRange: '12.0-15.5', abnormalFlag: 'normal',
    })
    expect(within(panel).getByText('13.4 g/dL · normal')).toBeTruthy()
    expect(within(panel).getByText('entered unverified')).toBeTruthy()
    expect(within(panel).queryByText('Enter manual result')).toBeNull()
    expectNoFullPatientId()
  })

  it('records an unverified text result and requires its text', async () => {
    const completed = execution()
    const entered = unverifiedResult({ revisions: [revision({
      resultType: 'text', numericValue: null, textValue: 'No growth after 48 hours', unit: null, referenceRange: null, abnormalFlag: 'normal',
    })] })
    api.labExecutions.mockResolvedValueOnce({ items: [completed] }).mockResolvedValue({ items: [{ ...completed, result: entered }] })
    api.enterLabResult.mockResolvedValue(entered)
    const panel = await openExecutionPanel(permissions)

    fireEvent.click(await within(panel).findByText('Enter manual result'))
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Result type' }), { target: { value: 'text' } })
    expect(within(panel).queryByRole('spinbutton', { name: 'Numeric value' })).toBeNull()
    const text = within(panel).getByRole('textbox', { name: 'Text value' })
    fireEvent.submit(formOf(text))

    expect(await refusalOf(text)).toBe('Enter the text result.')
    expect(api.enterLabResult).not.toHaveBeenCalled()

    fireEvent.change(text, { target: { value: ' No growth after 48 hours ' } })
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Abnormal flag' }), { target: { value: 'normal' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Record unverified result' }))

    expect(await within(panel).findByText('An unverified result was recorded.')).toBeTruthy()
    expect(api.enterLabResult).toHaveBeenCalledWith(FACILITY, completed, {
      resultType: 'text', textValue: 'No growth after 48 hours', abnormalFlag: 'normal',
    })
    expect(within(panel).getByText('No growth after 48 hours · normal')).toBeTruthy()
  })

  it('shows the API error when the result cannot be recorded', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution()] })
    api.enterLabResult.mockRejectedValue(problem(412, 'EXECUTION_NOT_RESULT_ELIGIBLE', 'Result requires expected completed execution version'))
    const panel = await openExecutionPanel(permissions)

    fireEvent.click(await within(panel).findByText('Enter manual result'))
    fireEvent.change(within(panel).getByRole('spinbutton', { name: 'Numeric value' }), { target: { value: '13.4' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Record unverified result' }))

    expect((await within(panel).findByRole('alert')).textContent).toBe('Result requires expected completed execution version')
    expect(within(panel).queryByText('An unverified result was recorded.')).toBeNull()
    expect(api.labExecutions).toHaveBeenCalledTimes(1)
    await waitFor(() => expect((within(panel).getByRole('button', { name: 'Record unverified result' }) as HTMLButtonElement).disabled).toBe(false))
  })
})

describe('Laboratory result correction and amendment', () => {
  const permissions = [...EXECUTION_READ, 'lab.result.correct']

  it('records a correction of an unreleased result as a new unverified version', async () => {
    const listed = execution({ result: unverifiedResult() })
    const corrected = correctionOf(unverifiedResult())
    api.labExecutions.mockResolvedValueOnce({ items: [listed] }).mockResolvedValue({ items: [execution({ result: corrected })] })
    api.correctLabResult.mockResolvedValue(corrected)
    const panel = await openExecutionPanel(permissions)

    fireEvent.click(await within(panel).findByText('Correct or amend result'))
    const value = within(panel).getByRole('spinbutton', { name: 'Numeric value' })
    expect(valueOf(value)).toBe('7.1')
    expect(valueOf(within(panel).getByRole('textbox', { name: 'Unit' }))).toBe('g/dL')
    expect(valueOf(within(panel).getByRole('textbox', { name: 'Reference range' }))).toBe('12.0-15.5')
    expect(valueOf(within(panel).getByRole('combobox', { name: 'Abnormal flag' }))).toBe('low')
    expect(optionLabels(within(panel).getByRole('combobox', { name: 'Revision type' }))).toEqual(['Correction', 'Amendment'])

    fireEvent.change(value, { target: { value: '7.4' } })
    fireEvent.submit(formOf(value))
    expect(await refusalOf(within(panel).getByRole('textbox', { name: 'Reason' }))).toBe('Explain the correction or amendment.')
    expect(api.correctLabResult).not.toHaveBeenCalled()

    fireEvent.change(within(panel).getByRole('textbox', { name: 'Reason' }), { target: { value: TRANSCRIPTION_FIX } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Record new revision' }))

    expect(await within(panel).findByText('A new unverified result revision was recorded.')).toBeTruthy()
    expect(api.correctLabResult).toHaveBeenCalledWith(FACILITY, listed, listed.result, {
      resultType: 'numeric', numericValue: 7.4, unit: 'g/dL', referenceRange: '12.0-15.5', abnormalFlag: 'low',
    }, TRANSCRIPTION_FIX, 'correction')
    expect(within(panel).getByText('Manual result · version 2')).toBeTruthy()
    expect(within(panel).getByText('7.4 g/dL · low')).toBeTruthy()
  })

  it('does not offer to revise a released version without lab.result.revise-released', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution({ result: releasedResult() })] })
    const panel = await openExecutionPanel(permissions)

    expect(await within(panel).findByText('Manual result · version 1')).toBeTruthy()
    expect(within(panel).getByText('released')).toBeTruthy()
    expect(within(panel).queryByText('Correct or amend result')).toBeNull()
    expect(within(panel).queryByRole('button', { name: 'Record new revision' })).toBeNull()
  })

  it('records an amendment to a released version with lab.result.revise-released', async () => {
    const released = releasedResult()
    const listed = execution({ result: released })
    const amended = unverifiedResult({ currentVersion: 2, currentReleasedVersion: 1, revisions: [
      revision({ verificationStatus: 'verified', releaseStatus: 'released' }),
      revision({ version: 2, referenceRange: '11.5-15.5', enteredAt: '2026-10-09T11:00:00.000Z', correctionReason: 'Age-specific reference range applied' }),
    ] })
    api.labExecutions.mockResolvedValueOnce({ items: [listed] }).mockResolvedValue({ items: [execution({ result: amended })] })
    api.correctLabResult.mockResolvedValue(amended)
    const panel = await openExecutionPanel([...permissions, 'lab.result.revise-released'])

    fireEvent.click(await within(panel).findByText('Correct or amend result'))
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Reference range' }), { target: { value: '11.5-15.5' } })
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Revision type' }), { target: { value: 'amendment' } })
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Age-specific reference range applied' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Record new revision' }))

    expect(await within(panel).findByText('A new unverified result revision was recorded.')).toBeTruthy()
    expect(api.correctLabResult).toHaveBeenCalledWith(FACILITY, listed, released, {
      resultType: 'numeric', numericValue: 7.1, unit: 'g/dL', referenceRange: '11.5-15.5', abnormalFlag: 'low',
    }, 'Age-specific reference range applied', 'amendment')
    expect(within(panel).getByText('Manual result · version 2')).toBeTruthy()
    expect(within(panel).getByText('entered unverified')).toBeTruthy()
  })
})

describe('Laboratory result verification and release', () => {
  it('verifies the exact unverified result version with a reason', async () => {
    const unverified = unverifiedResult()
    const verified = verifiedResult()
    api.labExecutions.mockResolvedValueOnce({ items: [execution({ result: unverified })] })
      .mockResolvedValue({ items: [execution({ result: verified })] })
    api.verifyLabResult.mockResolvedValue(verified)
    const panel = await openExecutionPanel([...EXECUTION_READ, 'lab.result.verify'])

    expect(await within(panel).findByText('Manual result · version 1')).toBeTruthy()
    expect(within(panel).getByText('entered unverified')).toBeTruthy()
    const reason = within(panel).getByRole('textbox', { name: 'Verification reason' })
    fireEvent.submit(formOf(reason))
    expect(await refusalOf(reason)).toBe('Enter a reason for this decision.')
    expect(api.verifyLabResult).not.toHaveBeenCalled()

    fireEvent.change(reason, { target: { value: 'Independent review against QC run' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Verify result version' }))

    expect(await within(panel).findByText('This exact result version was verified.')).toBeTruthy()
    expect(api.verifyLabResult).toHaveBeenCalledWith(FACILITY, unverified, 'Independent review against QC run')
    expect(within(panel).getByText('verified not released')).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'Verify result version' })).toBeNull()
  })

  it('releases a verified result version', async () => {
    const verified = verifiedResult()
    const released = releasedResult()
    api.labExecutions.mockResolvedValueOnce({ items: [execution({ result: verified })] })
      .mockResolvedValue({ items: [execution({ result: released })] })
    api.releaseLabResult.mockResolvedValue(released)
    const panel = await openExecutionPanel([...EXECUTION_READ, 'lab.result.verify', 'lab.result.release'])

    const reason = await within(panel).findByRole('textbox', { name: 'Release reason' })
    expect(within(panel).queryByRole('button', { name: 'Verify result version' })).toBeNull()
    fireEvent.change(reason, { target: { value: 'Clinically reviewed for release' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Release result version' }))

    expect(await within(panel).findByText('This exact verified result version was released.')).toBeTruthy()
    expect(api.releaseLabResult).toHaveBeenCalledWith(FACILITY, verified, 'Clinically reviewed for release')
    expect(within(panel).getByText('released')).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'Release result version' })).toBeNull()
  })

  it('does not offer release without lab.result.release', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution({ result: verifiedResult() })] })
    const panel = await openExecutionPanel([...EXECUTION_READ, 'lab.result.verify'])

    expect(await within(panel).findByText('verified not released')).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'Release result version' })).toBeNull()
  })

  it('shows the API error when a verification is refused', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution({ result: unverifiedResult() })] })
    api.verifyLabResult.mockRejectedValue(problem(412, 'VERSION_CONFLICT', 'Result version changed since review'))
    const panel = await openExecutionPanel([...EXECUTION_READ, 'lab.result.verify'])

    fireEvent.change(await within(panel).findByRole('textbox', { name: 'Verification reason' }), { target: { value: 'Independent review against QC run' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Verify result version' }))

    expect((await within(panel).findByRole('alert')).textContent).toBe('Result version changed since review')
    expect(within(panel).queryByText('This exact result version was verified.')).toBeNull()
    expect(within(panel).getByText('entered unverified')).toBeTruthy()
    expect(api.labExecutions).toHaveBeenCalledTimes(1)
  })

  it('shows the API error when a release is refused', async () => {
    const verified = verifiedResult()
    api.labExecutions.mockResolvedValue({ items: [execution({ result: verified })] })
    api.releaseLabResult.mockRejectedValue(problem(409, 'RESULT_NOT_VERIFIED', 'Exact result version is not verified'))
    const panel = await openExecutionPanel([...EXECUTION_READ, 'lab.result.release'])

    fireEvent.change(await within(panel).findByRole('textbox', { name: 'Release reason' }), { target: { value: 'Clinically reviewed for release' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Release result version' }))

    expect((await within(panel).findByRole('alert')).textContent).toBe('Exact result version is not verified')
    expect(api.releaseLabResult).toHaveBeenCalledWith(FACILITY, verified, 'Clinically reviewed for release')
    expect(within(panel).queryByText('This exact verified result version was released.')).toBeNull()
    expect(within(panel).getByText('verified not released')).toBeTruthy()
    expect(api.labExecutions).toHaveBeenCalledTimes(1)
  })
})

describe('Laboratory result history', () => {
  const permissions = [...EXECUTION_READ, 'lab.result.released.read']
  // The execution list was loaded before a correction; the history endpoint
  // returns the newer aggregate, so version 2 can only come from the history.
  const listed = () => execution({ result: releasedResult() })
  const history = () => correctionOf(releasedResult())

  function revisionEntry(version: number) {
    return screen.getByText(`Version ${version}`).closest('.staff-list-item') as HTMLElement
  }

  it('loads the history only when opened and lists every revision with its release status', async () => {
    api.labExecutions.mockResolvedValue({ items: [listed()] })
    api.labResultHistory.mockResolvedValue(history())
    const panel = await openExecutionPanel(permissions)

    const view = await within(panel).findByRole('button', { name: 'View result history' })
    expect(within(panel).queryByText('Version 1')).toBeNull()
    expect(api.labResultHistory).not.toHaveBeenCalled()
    fireEvent.click(view)

    expect(await within(panel).findByText('Version 2')).toBeTruthy()
    expect(api.labResultHistory).toHaveBeenCalledTimes(1)
    expect(api.labResultHistory).toHaveBeenCalledWith(FACILITY, 'result-1')
    expect(within(revisionEntry(1)).getByText('released')).toBeTruthy()
    expect(within(revisionEntry(1)).getByText('7.1 g/dL · low')).toBeTruthy()
    expect(within(revisionEntry(1)).getByText('Reference range: 12.0-15.5')).toBeTruthy()
    expect(within(revisionEntry(2)).getByText('not released')).toBeTruthy()
    expect(within(revisionEntry(2)).getByText('7.4 g/dL · low')).toBeTruthy()
    expect(within(revisionEntry(2)).getByText(`Reason: ${TRANSCRIPTION_FIX}`)).toBeTruthy()
    expect(within(panel).getByRole('button', { name: 'Hide result history' })).toBeTruthy()
    expectNoFullPatientId()
  })

  // hid-system #51: every revision in a Lab result response carries releasedAt, null until released.
  it('says when each released revision was released, and nothing for one not released', async () => {
    const releasedAt = '2026-10-09T10:30:00.000Z'
    const base = releasedResult()
    api.labExecutions.mockResolvedValue({ items: [listed()] })
    api.labResultHistory.mockResolvedValue(correctionOf({ ...base, revisions: base.revisions.map(item => ({ ...item, releasedAt })) }))
    const panel = await openExecutionPanel(permissions)

    fireEvent.click(await within(panel).findByRole('button', { name: 'View result history' }))

    expect(await within(panel).findByText('Version 2')).toBeTruthy()
    expect(within(revisionEntry(1)).getByText(`Released ${new Date(releasedAt).toLocaleString()}`)).toBeTruthy()
    expect(within(revisionEntry(2)).queryByText(/^Released /)).toBeNull()
  })

  it('shows a loading status while the history is fetched', async () => {
    const pending = deferred<LabResult>()
    api.labExecutions.mockResolvedValue({ items: [listed()] })
    api.labResultHistory.mockReturnValue(pending.promise)
    const panel = await openExecutionPanel(permissions)

    fireEvent.click(await within(panel).findByRole('button', { name: 'View result history' }))

    expect((await within(panel).findByText('Loading result history…')).getAttribute('role')).toBe('status')
    expect(within(panel).getByRole('button', { name: 'Refresh history' }).getAttribute('aria-disabled')).toBe('true')
    pending.resolve(history())
    expect(await within(panel).findByText('Version 2')).toBeTruthy()
    expect(within(panel).queryByText('Loading result history…')).toBeNull()
  })

  it('reloads the history when Refresh history is pressed', async () => {
    api.labExecutions.mockResolvedValue({ items: [listed()] })
    api.labResultHistory.mockResolvedValueOnce(releasedResult()).mockResolvedValue(history())
    const panel = await openExecutionPanel(permissions)

    fireEvent.click(await within(panel).findByRole('button', { name: 'View result history' }))
    expect(await within(panel).findByText('Version 1')).toBeTruthy()
    expect(within(panel).queryByText('Version 2')).toBeNull()

    await clickWhenEnabled(within(panel).getByRole('button', { name: 'Refresh history' }))

    expect(await within(panel).findByText('Version 2')).toBeTruthy()
    expect(api.labResultHistory).toHaveBeenCalledTimes(2)
    expect(api.labResultHistory).toHaveBeenLastCalledWith(FACILITY, 'result-1')
  })

  it('reloads the open history when the result gains a new version', async () => {
    const corrected = correctionOf(unverifiedResult())
    api.labExecutions.mockResolvedValueOnce({ items: [execution({ result: unverifiedResult() })] })
      .mockResolvedValue({ items: [execution({ result: corrected })] })
    api.labResultHistory.mockResolvedValueOnce(unverifiedResult()).mockResolvedValue(corrected)
    api.correctLabResult.mockResolvedValue(corrected)
    const panel = await openExecutionPanel([...permissions, 'lab.result.correct'])

    fireEvent.click(await within(panel).findByRole('button', { name: 'View result history' }))
    expect(await within(panel).findByText('Version 1')).toBeTruthy()
    expect(api.labResultHistory).toHaveBeenCalledTimes(1)

    fireEvent.click(within(panel).getByText('Correct or amend result'))
    fireEvent.change(within(panel).getByRole('spinbutton', { name: 'Numeric value' }), { target: { value: '7.4' } })
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Reason' }), { target: { value: TRANSCRIPTION_FIX } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Record new revision' }))

    expect(await within(panel).findByText('Version 2')).toBeTruthy()
    expect(api.labResultHistory).toHaveBeenCalledTimes(2)
    expect(api.labResultHistory).toHaveBeenLastCalledWith(FACILITY, 'result-1')
  })

  it('shows the history load error and no revisions', async () => {
    api.labExecutions.mockResolvedValue({ items: [listed()] })
    api.labResultHistory.mockRejectedValue(identityUnavailable())
    const panel = await openExecutionPanel(permissions)

    fireEvent.click(await within(panel).findByRole('button', { name: 'View result history' }))

    expect((await within(panel).findByRole('alert')).textContent).toBe(IDENTITY_UNAVAILABLE)
    expect(within(panel).queryByText('Version 1')).toBeNull()
    expect(within(panel).queryByText('Version 2')).toBeNull()
  })

  it('hides revisions already listed when a history refresh fails', async () => {
    api.labExecutions.mockResolvedValue({ items: [listed()] })
    api.labResultHistory.mockResolvedValueOnce(history()).mockRejectedValue(identityUnavailable())
    const panel = await openExecutionPanel(permissions)
    fireEvent.click(await within(panel).findByRole('button', { name: 'View result history' }))
    expect(await within(panel).findByText('Version 2')).toBeTruthy()

    await clickWhenEnabled(within(panel).getByRole('button', { name: 'Refresh history' }))

    expect((await within(panel).findByRole('alert')).textContent).toBe(IDENTITY_UNAVAILABLE)
    expect(within(panel).queryByText('Version 1')).toBeNull()
    expect(within(panel).queryByText('Version 2')).toBeNull()
    expect(within(panel).queryByText(`Reason: ${TRANSCRIPTION_FIX}`)).toBeNull()
    expect(within(panel).queryByText('7.4 g/dL · low')).toBeNull()
  })

  it('offers no history without lab.result.released.read', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution({ result: correctionOf(releasedResult()) })] })
    const panel = await openExecutionPanel(EXECUTION_READ)

    expect(await within(panel).findByText('Manual result · version 2')).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'View result history' })).toBeNull()
    expect(api.labResultHistory).not.toHaveBeenCalled()
  })
})

describe('Laboratory result access denied', () => {
  // lab.result.correct renders the correction form, which pre-fills the current
  // value into inputs, so the checks below also cover values held in controls.
  const permissions = [...EXECUTION_READ, 'lab.execution.start', 'lab.result.enter', 'lab.result.correct', 'lab.result.verify', 'lab.result.released.read']
  const visibleValue = '7.1 g/dL · low'

  /** Values may sit in text, in form controls or in attributes; none may remain. */
  function expectNoResultValues() {
    expect(document.body.textContent).not.toContain('7.1')
    expect(document.body.textContent).not.toContain('g/dL')
    expect(screen.queryAllByDisplayValue(/7\.1/)).toHaveLength(0)
    expect(document.body.innerHTML).not.toContain('7.1')
    expect(document.body.innerHTML).not.toContain('12.0-15.5')
  }

  /** Proves the value checks above are meaningful: the value is on screen in text, a control and an attribute. */
  async function expectResultValuesShown(panel: HTMLElement) {
    expect(await within(panel).findByText(visibleValue)).toBeTruthy()
    expect(screen.queryAllByDisplayValue('7.1')).toHaveLength(1)
    expect(document.body.innerHTML).toContain('12.0-15.5')
  }

  it('shows the access-denied state when executions are refused on first load', async () => {
    api.labExecutions.mockRejectedValue(executionAccessDenied())
    const panel = await openExecutionPanel(permissions)

    expect((await within(panel).findByRole('alert')).textContent).toBe(ACCESS_DENIED)
    await executionsSettled(panel)
    expect(api.labExecutions).toHaveBeenCalledWith(FACILITY, 'specimen-1')
    expect(screen.queryByText(RESULT_ACCESS_REFUSED)).toBeNull()
    expect(within(panel).queryByRole('button', { name: 'Start execution' })).toBeNull()
  })

  it('removes result values already on screen when a refresh is refused', async () => {
    api.labExecutions.mockResolvedValueOnce({ items: [execution({ result: unverifiedResult() })] })
    const panel = await openExecutionPanel(permissions)
    await expectResultValuesShown(panel)

    api.labExecutions.mockRejectedValueOnce(executionAccessDenied())
    await refreshExecutions(panel)

    expect((await within(panel).findByRole('alert')).textContent).toBe(ACCESS_DENIED)
    await executionsSettled(panel)
    expect(api.labExecutions).toHaveBeenCalledTimes(2)
    expect(api.labExecutions).toHaveBeenLastCalledWith(FACILITY, 'specimen-1')
    expectNoResultValues()
    expect(within(panel).queryByText('Hemoglobin · LOINC 718-7')).toBeNull()
    expect(within(panel).queryByText('Correct or amend result')).toBeNull()
    expect(within(panel).queryByRole('button', { name: 'Verify result version' })).toBeNull()
    expect(within(panel).queryByRole('button', { name: 'View result history' })).toBeNull()
    expect(within(panel).queryByRole('button', { name: 'Start execution' })).toBeNull()
    expectNoFullPatientId()
  })

  it('removes result values when the specimen is no longer visible after access is revoked', async () => {
    api.labExecutions.mockResolvedValueOnce({ items: [execution({ result: unverifiedResult() })] })
    const panel = await openExecutionPanel(permissions)
    await expectResultValuesShown(panel)

    api.labExecutions.mockRejectedValueOnce(specimenNotFound())
    await refreshExecutions(panel)

    expect((await within(panel).findByRole('alert')).textContent).toBe(ACCESS_DENIED)
    await executionsSettled(panel)
    expect(screen.queryByText('Lab specimen was not found')).toBeNull()
    expectNoResultValues()
    expect(within(panel).queryByRole('button', { name: 'Start execution' })).toBeNull()
  })

  it('removes a text result already on screen when a refresh is refused', async () => {
    const finding = 'Gram-positive cocci in clusters'
    api.labExecutions.mockResolvedValueOnce({ items: [execution({ result: unverifiedResult({ revisions: [revision({
      resultType: 'text', numericValue: null, textValue: finding, unit: null, referenceRange: null, abnormalFlag: 'abnormal',
    })] }) })] })
    const panel = await openExecutionPanel(permissions)
    expect(await within(panel).findByText(`${finding} · abnormal`)).toBeTruthy()
    expect(screen.queryAllByDisplayValue(finding)).toHaveLength(1)

    api.labExecutions.mockRejectedValueOnce(executionAccessDenied())
    await refreshExecutions(panel)

    expect((await within(panel).findByRole('alert')).textContent).toBe(ACCESS_DENIED)
    await executionsSettled(panel)
    expect(document.body.innerHTML).not.toContain('Gram-positive')
    expect(screen.queryAllByDisplayValue(/Gram-positive/)).toHaveLength(0)
  })

  it('withdraws the start form when a refresh is refused', async () => {
    api.labExecutions.mockResolvedValueOnce({ items: [] }).mockRejectedValue(executionAccessDenied())
    const panel = await openExecutionPanel(permissions)
    expect(await within(panel).findByRole('button', { name: 'Start execution' })).toBeTruthy()

    await refreshExecutions(panel)

    expect((await within(panel).findByRole('alert')).textContent).toBe(ACCESS_DENIED)
    await executionsSettled(panel)
    expect(within(panel).queryByRole('button', { name: 'Start execution' })).toBeNull()
    expect(within(panel).queryByRole('textbox', { name: 'Reason' })).toBeNull()
  })

  it('withdraws the no-execution message from a read-only member when a refresh is refused', async () => {
    api.labExecutions.mockResolvedValueOnce({ items: [] }).mockRejectedValue(executionAccessDenied())
    const panel = await openExecutionPanel(EXECUTION_READ)
    expect(await within(panel).findByText('No execution has started for this specimen.')).toBeTruthy()

    await refreshExecutions(panel)

    expect((await within(panel).findByRole('alert')).textContent).toBe(ACCESS_DENIED)
    await executionsSettled(panel)
    expect(within(panel).queryByText('No execution has started for this specimen.')).toBeNull()
  })

  it('removes released history and the success notice when the reload after a decision is refused', async () => {
    const unverified = unverifiedResult()
    api.labExecutions.mockResolvedValueOnce({ items: [execution({ result: unverified })] })
      .mockRejectedValue(executionAccessDenied())
    api.labResultHistory.mockResolvedValue(unverified)
    api.verifyLabResult.mockResolvedValue(verifiedResult())
    const panel = await openExecutionPanel(permissions)
    fireEvent.click(await within(panel).findByRole('button', { name: 'View result history' }))
    expect(await within(panel).findByText('Version 1')).toBeTruthy()

    fireEvent.change(within(panel).getByRole('textbox', { name: 'Verification reason' }), { target: { value: 'Independent review against QC run' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Verify result version' }))

    await waitFor(() => expect(within(panel).getByRole('alert').textContent).toBe(ACCESS_DENIED))
    await executionsSettled(panel)
    expect(api.verifyLabResult).toHaveBeenCalledWith(FACILITY, unverified, 'Independent review against QC run')
    expect(api.labExecutions).toHaveBeenCalledTimes(2)
    expect(within(panel).queryByText('This exact result version was verified.')).toBeNull()
    expect(within(panel).queryByText('Version 1')).toBeNull()
    expectNoResultValues()
  })

  it('shows the verification-unavailable state, not access denied, when Identity is unavailable on first load', async () => {
    api.labExecutions.mockRejectedValue(identityUnavailable())
    const panel = await openExecutionPanel(permissions)

    expect((await within(panel).findByRole('alert')).textContent).toBe(UNVERIFIED)
    await executionsSettled(panel)
    expect(screen.queryByText(ACCESS_DENIED)).toBeNull()
    expect(screen.queryByText(IDENTITY_UNAVAILABLE)).toBeNull()
    expect(within(panel).queryByRole('button', { name: 'Start execution' })).toBeNull()
  })

  it('shows results again once a refresh is authorized', async () => {
    api.labExecutions.mockRejectedValueOnce(executionAccessDenied())
      .mockResolvedValue({ items: [execution({ result: unverifiedResult() })] })
    const panel = await openExecutionPanel(permissions)
    expect((await within(panel).findByRole('alert')).textContent).toBe(ACCESS_DENIED)

    await refreshExecutions(panel)

    expect(await within(panel).findByText(visibleValue)).toBeTruthy()
    expect(within(panel).queryByRole('alert')).toBeNull()
  })

  describe('after a refused Lab action', () => {
    // A 403 or 404 from an action may mean read access has ended too, or only that
    // this write is not allowed (for example under break-glass). The page re-checks
    // by reloading the executions: the values stay only if that reload is authorized.
    const actions = [...permissions, 'lab.result.release', 'lab.execution.complete']
    const verificationReason = 'Independent review against QC run'

    async function verify(panel: HTMLElement) {
      fireEvent.change(within(panel).getByRole('textbox', { name: 'Verification reason' }), { target: { value: verificationReason } })
      fireEvent.click(within(panel).getByRole('button', { name: 'Verify result version' }))
    }

    async function expectAccessEnded(panel: HTMLElement) {
      await waitFor(() => expect(within(panel).getByRole('alert').textContent).toBe(ACCESS_DENIED))
      await executionsSettled(panel)
      expect(api.labExecutions).toHaveBeenCalledTimes(2)
      expect(api.labExecutions).toHaveBeenLastCalledWith(FACILITY, 'specimen-1')
      expect(screen.queryByText(RESULT_ACCESS_REFUSED)).toBeNull()
      expectNoResultValues()
      expect(within(panel).queryByText('Hemoglobin · LOINC 718-7')).toBeNull()
    }

    it('hides the values when a refused verification means read access has ended', async () => {
      const unverified = unverifiedResult()
      api.labExecutions.mockResolvedValueOnce({ items: [execution({ result: unverified })] }).mockRejectedValue(executionAccessDenied())
      api.verifyLabResult.mockRejectedValue(executionAccessDenied())
      const panel = await openExecutionPanel(actions)
      await expectResultValuesShown(panel)

      await verify(panel)

      await expectAccessEnded(panel)
      expect(api.verifyLabResult).toHaveBeenCalledWith(FACILITY, unverified, verificationReason)
    })

    it('keeps the values and shows the refusal when the re-check is still authorized', async () => {
      // A fresh response object on every load, as from the network.
      api.labExecutions.mockImplementation(async () => ({ items: [execution({ result: unverifiedResult() })] }))
      api.verifyLabResult.mockRejectedValue(executionAccessDenied())
      const panel = await openExecutionPanel(actions)
      await expectResultValuesShown(panel)

      await verify(panel)

      await waitFor(() => expect(api.labExecutions).toHaveBeenCalledTimes(2))
      await executionsSettled(panel)
      expect((await within(panel).findByRole('alert')).textContent).toBe(RESULT_ACCESS_REFUSED)
      expect(screen.queryByText(ACCESS_DENIED)).toBeNull()
      expect(within(panel).getByText(visibleValue)).toBeTruthy()
      expect(within(panel).queryByText('This exact result version was verified.')).toBeNull()
      expect(api.verifyLabResult).toHaveBeenCalledTimes(1)
      expect(api.labExecutions).toHaveBeenCalledTimes(2)
    })

    it('hides the values when a refused release is followed by a hidden specimen (404)', async () => {
      const verified = verifiedResult()
      api.labExecutions.mockResolvedValueOnce({ items: [execution({ result: verified })] }).mockRejectedValue(specimenNotFound())
      api.releaseLabResult.mockRejectedValue(problem(404, 'LAB_RESULT_NOT_FOUND', 'Lab result was not found'))
      const panel = await openExecutionPanel(actions)
      await expectResultValuesShown(panel)

      fireEvent.change(within(panel).getByRole('textbox', { name: 'Release reason' }), { target: { value: 'Clinically reviewed for release' } })
      fireEvent.click(within(panel).getByRole('button', { name: 'Release result version' }))

      await expectAccessEnded(panel)
      expect(api.releaseLabResult).toHaveBeenCalledWith(FACILITY, verified, 'Clinically reviewed for release')
      expect(screen.queryByText('Lab result was not found')).toBeNull()
    })

    it('hides the values when a refused correction means read access has ended', async () => {
      api.labExecutions.mockResolvedValueOnce({ items: [execution({ result: unverifiedResult() })] }).mockRejectedValue(executionAccessDenied())
      api.correctLabResult.mockRejectedValue(executionAccessDenied())
      const panel = await openExecutionPanel(actions)
      await expectResultValuesShown(panel)

      fireEvent.click(within(panel).getByText('Correct or amend result'))
      fireEvent.change(within(panel).getByRole('spinbutton', { name: 'Numeric value' }), { target: { value: '7.4' } })
      fireEvent.change(within(panel).getByRole('textbox', { name: 'Reason' }), { target: { value: TRANSCRIPTION_FIX } })
      fireEvent.click(within(panel).getByRole('button', { name: 'Record new revision' }))

      await expectAccessEnded(panel)
      expect(api.correctLabResult).toHaveBeenCalledTimes(1)
      expect(document.body.innerHTML).not.toContain('7.4')
    })

    it('hides the values when a refused history read means read access has ended', async () => {
      api.labExecutions.mockResolvedValueOnce({ items: [execution({ result: unverifiedResult() })] }).mockRejectedValue(executionAccessDenied())
      api.labResultHistory.mockRejectedValue(executionAccessDenied())
      const panel = await openExecutionPanel(actions)
      await expectResultValuesShown(panel)

      fireEvent.click(within(panel).getByRole('button', { name: 'View result history' }))

      await expectAccessEnded(panel)
      expect(api.labResultHistory).toHaveBeenCalledWith(FACILITY, 'result-1')
    })

    it('keeps the values without a re-check when the history is not released yet (404)', async () => {
      // Released-result readers get 404 until a version is released. A fresh response
      // object on every load, as from the network, would also expose a refetch loop.
      api.labExecutions.mockImplementation(async () => ({ items: [execution({ result: unverifiedResult() })] }))
      api.labResultHistory.mockRejectedValue(problem(404, 'LAB_RESULT_NOT_FOUND', 'Lab result was not found'))
      const panel = await openExecutionPanel(actions)
      await expectResultValuesShown(panel)

      fireEvent.click(within(panel).getByRole('button', { name: 'View result history' }))

      expect((await within(panel).findByRole('alert')).textContent).toBe('Lab result was not found')
      // A later explicit refresh is the second load, so the 404 caused no re-check.
      await refreshExecutions(panel)
      await waitFor(() => expect(api.labExecutions).toHaveBeenCalledTimes(2))
      await executionsSettled(panel)
      expect(screen.queryByText(ACCESS_DENIED)).toBeNull()
      expect(within(panel).getByText(visibleValue)).toBeTruthy()
      expect(api.labResultHistory).toHaveBeenCalledTimes(1)
      expect(api.labExecutions).toHaveBeenCalledTimes(2)
    })

    it('hides the values when the history of a released result is no longer visible (404)', async () => {
      api.labExecutions.mockResolvedValueOnce({ items: [execution({ result: releasedResult() })] }).mockRejectedValue(specimenNotFound())
      api.labResultHistory.mockRejectedValue(problem(404, 'LAB_RESULT_NOT_FOUND', 'Lab result was not found'))
      const panel = await openExecutionPanel(actions)
      expect(await within(panel).findByText(visibleValue)).toBeTruthy()

      fireEvent.click(within(panel).getByRole('button', { name: 'View result history' }))

      await expectAccessEnded(panel)
      expect(api.labResultHistory).toHaveBeenCalledWith(FACILITY, 'result-1')
    })

    it('hides the execution when a refused completion means read access has ended', async () => {
      const running = inProgress()
      api.labExecutions.mockResolvedValueOnce({ items: [running] }).mockRejectedValue(executionAccessDenied())
      api.completeLabExecution.mockRejectedValue(executionAccessDenied())
      const panel = await openExecutionPanel(actions)

      fireEvent.click(await within(panel).findByRole('button', { name: 'Complete execution' }))

      await expectAccessEnded(panel)
      expect(api.completeLabExecution).toHaveBeenCalledWith(FACILITY, running, '')
      expect(within(panel).queryByRole('button', { name: 'Complete execution' })).toBeNull()
    })

    it('hides the execution when a refused result entry means read access has ended', async () => {
      api.labExecutions.mockResolvedValueOnce({ items: [execution()] }).mockRejectedValue(executionAccessDenied())
      api.enterLabResult.mockRejectedValue(executionAccessDenied())
      const panel = await openExecutionPanel(actions)

      fireEvent.click(await within(panel).findByText('Enter manual result'))
      fireEvent.change(within(panel).getByRole('spinbutton', { name: 'Numeric value' }), { target: { value: '13.4' } })
      fireEvent.click(within(panel).getByRole('button', { name: 'Record unverified result' }))

      await expectAccessEnded(panel)
      expect(api.enterLabResult).toHaveBeenCalledTimes(1)
      expect(document.body.innerHTML).not.toContain('13.4')
    })

    it('hides the values of every specimen of the patient once one panel finds access has ended', async () => {
      const second = specimen('received', { id: 'specimen-2', specimenIdentifier: 'SPC-000124', specimenType: 'Serum' })
      const potassium = execution({ id: 'execution-2', specimenId: 'specimen-2', test: { codeSystem: 'LOINC', code: '2823-3', name: 'Potassium' },
        result: unverifiedResult({ id: 'result-2', executionId: 'execution-2', revisions: [revision({ numericValue: 9.9, unit: 'mmol/L', referenceRange: '3.5-5.1' })] }) })
      let firstPanelLoads = 0
      api.labExecutions.mockImplementation(async (_facility, specimenId) => {
        if (specimenId === 'specimen-2') return { items: [potassium] }
        if (++firstPanelLoads === 1) return { items: [execution({ result: unverifiedResult() })] }
        throw executionAccessDenied()
      })
      api.verifyLabResult.mockRejectedValue(executionAccessDenied())
      await openAccession(actions, accession([specimen('received'), second]))
      const [first, other] = screen.getAllByRole('heading', { name: 'Analytical execution' }).map(heading => heading.parentElement as HTMLElement)
      if (!first || !other) throw new Error('Expected one execution panel per received specimen.')
      expect(await within(first).findByText(visibleValue)).toBeTruthy()
      expect(await within(other).findByText('9.9 mmol/L · low')).toBeTruthy()

      fireEvent.change(within(first).getAllByRole('textbox', { name: 'Verification reason' })[0] as HTMLElement, { target: { value: verificationReason } })
      fireEvent.click(within(first).getByRole('button', { name: 'Verify result version' }))

      await waitFor(() => expect(within(first).getByRole('alert').textContent).toBe(ACCESS_DENIED))
      await waitFor(() => expect(within(other).getByRole('alert').textContent).toBe(ACCESS_DENIED))
      expectNoResultValues()
      expect(document.body.innerHTML).not.toContain('9.9')
      expect(document.body.innerHTML).not.toContain('3.5-5.1')
      expect(screen.queryAllByDisplayValue(/9\.9/)).toHaveLength(0)
      // Hiding a sibling's values needs no further request, so nothing can loop.
      expect(api.labExecutions.mock.calls.filter(([, id]) => id === 'specimen-2')).toHaveLength(1)
    })

    it('shows every specimen again after a refresh of the accession once access returns', async () => {
      const second = specimen('received', { id: 'specimen-2', specimenIdentifier: 'SPC-000124', specimenType: 'Serum' })
      const potassium = execution({ id: 'execution-2', specimenId: 'specimen-2', test: { codeSystem: 'LOINC', code: '2823-3', name: 'Potassium' },
        result: unverifiedResult({ id: 'result-2', executionId: 'execution-2', revisions: [revision({ numericValue: 9.9, unit: 'mmol/L', referenceRange: '3.5-5.1' })] }) })
      let refused = true
      api.labExecutions.mockImplementation(async (_facility, specimenId) => {
        if (specimenId === 'specimen-2') return { items: [potassium] }
        if (refused) throw executionAccessDenied()
        return { items: [execution({ result: unverifiedResult() })] }
      })
      const card = await openAccession(actions, accession([specimen('received'), second]))
      await waitFor(() => expect(screen.getAllByText(ACCESS_DENIED)).toHaveLength(2))
      expect(document.body.innerHTML).not.toContain('9.9')

      refused = false
      await clickWhenEnabled(within(card).getByRole('button', { name: 'Refresh accession' }))

      expect(await screen.findByText(visibleValue)).toBeTruthy()
      expect(await screen.findByText('9.9 mmol/L · low')).toBeTruthy()
      expect(screen.queryByText(ACCESS_DENIED)).toBeNull()

      // Access ends again: the refresh reset the shared signal, so both hide again.
      refused = true
      const [first] = screen.getAllByRole('heading', { name: 'Analytical execution' }).map(heading => heading.parentElement as HTMLElement)
      if (!first) throw new Error('Expected the first execution panel.')
      await refreshExecutions(first)
      await waitFor(() => expect(screen.getAllByText(ACCESS_DENIED)).toHaveLength(2))
      expectNoResultValues()
      expect(document.body.innerHTML).not.toContain('9.9')
    })

    describe('for a member who can run executions but not read them', () => {
      // Without lab.execution.read the panel cannot reload, so it cannot re-check.
      const runner = [...ACCESSION_READ, 'lab.execution.start', 'lab.execution.complete', 'lab.result.enter', 'lab.result.released.read']

      async function startAndComplete() {
        api.startLabExecution.mockResolvedValue(inProgress())
        await openAccession(runner, accession([specimen('received')]))
        const panel = sectionOf('Analytical execution')
        fireEvent.change(within(panel).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Begin analysis' } })
        fireEvent.click(within(panel).getByRole('button', { name: 'Start execution' }))
        expect(await within(panel).findByText('Hemoglobin · LOINC 718-7')).toBeTruthy()
        return panel
      }

      it('hides the execution at once when an action is refused', async () => {
        api.completeLabExecution.mockRejectedValue(executionAccessDenied())
        const panel = await startAndComplete()

        fireEvent.click(within(panel).getByRole('button', { name: 'Complete execution' }))

        await waitFor(() => expect(within(panel).getByRole('alert').textContent).toBe(ACCESS_DENIED))
        expect(within(panel).queryByText('Hemoglobin · LOINC 718-7')).toBeNull()
        expect(api.labExecutions).not.toHaveBeenCalled()
      })

      it('keeps the result when its history is not released yet (404)', async () => {
        api.completeLabExecution.mockResolvedValue(execution())
        api.enterLabResult.mockResolvedValue(unverifiedResult())
        api.labResultHistory.mockRejectedValue(problem(404, 'LAB_RESULT_NOT_FOUND', 'Lab result was not found'))
        const panel = await startAndComplete()
        fireEvent.click(within(panel).getByRole('button', { name: 'Complete execution' }))
        fireEvent.click(await within(panel).findByText('Enter manual result'))
        fireEvent.change(within(panel).getByRole('spinbutton', { name: 'Numeric value' }), { target: { value: '7.1' } })
        fireEvent.click(within(panel).getByRole('button', { name: 'Record unverified result' }))
        expect(await within(panel).findByText(visibleValue)).toBeTruthy()

        fireEvent.click(within(panel).getByRole('button', { name: 'View result history' }))

        expect((await within(panel).findByRole('alert')).textContent).toBe('Lab result was not found')
        expect(screen.queryByText(ACCESS_DENIED)).toBeNull()
        expect(within(panel).getByText(visibleValue)).toBeTruthy()
        expect(api.labExecutions).not.toHaveBeenCalled()
      })
    })
  })

  describe('when access to results cannot be verified', () => {
    // A successful execution-list read is the only thing that confirms the caller may
    // still read these results. Without one (outage, network failure, server error,
    // ended session) the page fails closed: it removes the values it already shows.
    const actions = [...permissions, 'lab.result.release', 'lab.execution.complete']
    const networkFailure = () => new HidApiError(0, 'We could not reach the service. Check your connection and try again.', { code: 'NETWORK_ERROR' })
    const resultLoad = () => ({ items: [execution({ result: unverifiedResult() })] })

    /** The unavailable state: a fixed message, and nothing of the patient's results or identity. */
    async function expectUnverified(panel: HTMLElement) {
      await waitFor(() => expect(within(panel).getByRole('alert').textContent).toBe(UNVERIFIED))
      await executionsSettled(panel)
      expect(screen.queryByText(ACCESS_DENIED)).toBeNull()
      expect(screen.queryByText(IDENTITY_UNAVAILABLE)).toBeNull()
      expectNoResultValues()
      expectNoFullPatientId()
      expect(within(panel).queryByText('Hemoglobin · LOINC 718-7')).toBeNull()
      expect(within(panel).queryByRole('button', { name: 'Start execution' })).toBeNull()
    }

    function panels() {
      const found = screen.getAllByRole('heading', { name: 'Analytical execution' }).map(heading => heading.parentElement as HTMLElement)
      if (found.length !== 2 || !found[0] || !found[1]) throw new Error('Expected one execution panel per received specimen.')
      return [found[0], found[1]] as const
    }

    const second = specimen('received', { id: 'specimen-2', specimenIdentifier: 'SPC-000124', specimenType: 'Serum' })
    const potassium = () => execution({ id: 'execution-2', specimenId: 'specimen-2', test: { codeSystem: 'LOINC', code: '2823-3', name: 'Potassium' },
      result: unverifiedResult({ id: 'result-2', executionId: 'execution-2', revisions: [revision({ numericValue: 9.9, unit: 'mmol/L', referenceRange: '3.5-5.1' })] }) })
    function expectNoPotassium() {
      expect(document.body.innerHTML).not.toContain('9.9')
      expect(document.body.innerHTML).not.toContain('3.5-5.1')
      expect(screen.queryAllByDisplayValue(/9\.9/)).toHaveLength(0)
    }

    it('hides results already on screen when a refresh hits an Identity outage (503)', async () => {
      api.labExecutions.mockResolvedValueOnce(resultLoad()).mockRejectedValue(identityUnavailable())
      const panel = await openExecutionPanel(permissions)
      await expectResultValuesShown(panel)

      await refreshExecutions(panel)

      await expectUnverified(panel)
      expect(api.labExecutions).toHaveBeenCalledTimes(2)
    })

    it.each([
      ['a network failure', networkFailure],
      ['a timeout (408)', () => new HidApiError(408, 'The request timed out.', { code: 'REQUEST_TIMEOUT' })],
      ['an unreadable response (502)', () => new HidApiError(502, 'The service returned an unreadable response.', { code: 'INVALID_RESPONSE' })],
      ['a server error (500)', () => new HidApiError(500, 'Unexpected server error', { code: 'SERVER_ERROR' })],
      ['an error that is not an API error', () => new TypeError('Failed to fetch')],
      // Answered on its merits, but still not a read that confirms access.
      ['a bad request (400)', () => problem(400, 'BAD_REQUEST', 'Request could not be processed')],
      ['a conflict (409)', () => problem(409, 'CONFLICT', 'Conflict')],
      ['an unprocessable request (422)', () => problem(422, 'UNPROCESSABLE', 'Unprocessable')],
      ['rate limiting (429)', () => problem(429, 'RATE_LIMITED', 'Too many requests')],
    ])('hides results already on screen when a refresh fails with %s', async (_label, failure) => {
      api.labExecutions.mockResolvedValueOnce(resultLoad()).mockRejectedValue(failure())
      const panel = await openExecutionPanel(permissions)
      await expectResultValuesShown(panel)

      await refreshExecutions(panel)

      await expectUnverified(panel)
    })

    it('hides results when a refused action is followed by a re-check that fails', async () => {
      api.labExecutions.mockResolvedValueOnce(resultLoad()).mockRejectedValue(identityUnavailable())
      api.verifyLabResult.mockRejectedValue(executionAccessDenied())
      const panel = await openExecutionPanel(actions)
      await expectResultValuesShown(panel)

      fireEvent.change(within(panel).getByRole('textbox', { name: 'Verification reason' }), { target: { value: 'Independent review against QC run' } })
      fireEvent.click(within(panel).getByRole('button', { name: 'Verify result version' }))

      await expectUnverified(panel)
      expect(api.labExecutions).toHaveBeenCalledTimes(2)
    })

    it('re-checks when an action fails with an outage and hides results when the re-check also fails', async () => {
      api.labExecutions.mockResolvedValueOnce(resultLoad()).mockRejectedValue(networkFailure())
      api.verifyLabResult.mockRejectedValue(identityUnavailable())
      const panel = await openExecutionPanel(actions)
      await expectResultValuesShown(panel)

      fireEvent.change(within(panel).getByRole('textbox', { name: 'Verification reason' }), { target: { value: 'Independent review against QC run' } })
      fireEvent.click(within(panel).getByRole('button', { name: 'Verify result version' }))

      await expectUnverified(panel)
      expect(api.labExecutions).toHaveBeenCalledTimes(2)
    })

    it('keeps results for a reader whose re-check succeeds after an action fails with an outage', async () => {
      // A fresh response per load, as from the network. The read confirms access, so the
      // values stay (a break-glass reader may read but not write) and the action's error shows.
      api.labExecutions.mockImplementation(async () => resultLoad())
      api.verifyLabResult.mockRejectedValue(identityUnavailable())
      const panel = await openExecutionPanel(actions)
      await expectResultValuesShown(panel)

      fireEvent.change(within(panel).getByRole('textbox', { name: 'Verification reason' }), { target: { value: 'Independent review against QC run' } })
      fireEvent.click(within(panel).getByRole('button', { name: 'Verify result version' }))

      await waitFor(() => expect(api.labExecutions).toHaveBeenCalledTimes(2))
      await executionsSettled(panel)
      expect((await within(panel).findByRole('alert')).textContent).toBe(IDENTITY_UNAVAILABLE)
      expect(screen.queryByText(UNVERIFIED)).toBeNull()
      expect(within(panel).getByText(visibleValue)).toBeTruthy()
    })

    it('keeps every specimen\'s results, also while the re-check is in flight, when a refused write is followed by a confirming read', async () => {
      // Break-glass: the write is refused but the read is allowed. Nothing may hide, not even briefly.
      const confirming = deferred<{ items: LabExecution[] }>()
      let firstLoads = 0
      api.labExecutions.mockImplementation(async (_facility, specimenId) => {
        if (specimenId === 'specimen-2') return { items: [potassium()] }
        return ++firstLoads === 1 ? resultLoad() : confirming.promise
      })
      api.verifyLabResult.mockRejectedValue(executionAccessDenied())
      await openAccession(actions, accession([specimen('received'), second]))
      const [first, other] = panels()
      expect(await within(first).findByText(visibleValue)).toBeTruthy()
      expect(await within(other).findByText('9.9 mmol/L · low')).toBeTruthy()

      fireEvent.change(within(first).getByRole('textbox', { name: 'Verification reason' }), { target: { value: 'Independent review against QC run' } })
      fireEvent.click(within(first).getByRole('button', { name: 'Verify result version' }))

      await waitFor(() => expect(firstLoads).toBe(2))
      expect(within(first).getByText(visibleValue)).toBeTruthy()
      expect(within(other).getByText('9.9 mmol/L · low')).toBeTruthy()
      await act(async () => { confirming.resolve(resultLoad()) })
      await executionsSettled(first)
      expect(within(first).getByRole('alert').textContent).toBe(RESULT_ACCESS_REFUSED)
      expect(within(first).getByText(visibleValue)).toBeTruthy()
      expect(within(other).getByText('9.9 mmol/L · low')).toBeTruthy()
      expect(within(other).queryByRole('alert')).toBeNull()
      expect(screen.queryByText(ACCESS_DENIED)).toBeNull()
      expect(api.labExecutions.mock.calls.filter(([, id]) => id === 'specimen-2')).toHaveLength(1)
    })

    it('does not re-check, or hide, for a refusal answered on its merits (409)', async () => {
      // If this wrongly re-checked, the failing reload below would hide the values.
      api.labExecutions.mockResolvedValueOnce({ items: [execution({ result: verifiedResult() })] }).mockRejectedValue(identityUnavailable())
      api.releaseLabResult.mockRejectedValue(problem(409, 'RESULT_NOT_VERIFIED', 'Exact result version is not verified'))
      const panel = await openExecutionPanel(actions)
      expect(await within(panel).findByText(visibleValue)).toBeTruthy()

      fireEvent.change(within(panel).getByRole('textbox', { name: 'Release reason' }), { target: { value: 'Clinically reviewed for release' } })
      fireEvent.click(within(panel).getByRole('button', { name: 'Release result version' }))

      expect((await within(panel).findByRole('alert')).textContent).toBe('Exact result version is not verified')
      // An explicit refresh is the second load, so the 409 caused no re-check.
      api.labExecutions.mockResolvedValue({ items: [execution({ result: verifiedResult() })] })
      await refreshExecutions(panel)
      await waitFor(() => expect(api.labExecutions).toHaveBeenCalledTimes(2))
      await executionsSettled(panel)
      expect(within(panel).getByText(visibleValue)).toBeTruthy()
      expect(screen.queryByText(UNVERIFIED)).toBeNull()
    })

    it('hides results at once for a member who cannot re-check when an action fails with an outage', async () => {
      const runner = [...ACCESSION_READ, 'lab.execution.start', 'lab.execution.complete']
      api.startLabExecution.mockResolvedValue(inProgress())
      api.completeLabExecution.mockRejectedValue(identityUnavailable())
      await openAccession(runner, accession([specimen('received')]))
      const panel = sectionOf('Analytical execution')
      fireEvent.change(within(panel).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Begin analysis' } })
      fireEvent.click(within(panel).getByRole('button', { name: 'Start execution' }))
      fireEvent.click(await within(panel).findByRole('button', { name: 'Complete execution' }))

      await waitFor(() => expect(within(panel).getByRole('alert').textContent).toBe(UNVERIFIED))
      expect(within(panel).queryByText('Hemoglobin · LOINC 718-7')).toBeNull()
      expect(api.labExecutions).not.toHaveBeenCalled()
    })

    it('hides every specimen of the patient when one panel cannot verify access', async () => {
      let firstLoads = 0
      api.labExecutions.mockImplementation(async (_facility, specimenId) => {
        if (specimenId === 'specimen-2') return { items: [potassium()] }
        if (++firstLoads === 1) return resultLoad()
        throw identityUnavailable()
      })
      await openAccession(actions, accession([specimen('received'), second]))
      const [first, other] = panels()
      expect(await within(first).findByText(visibleValue)).toBeTruthy()
      expect(await within(other).findByText('9.9 mmol/L · low')).toBeTruthy()

      await refreshExecutions(first)

      await expectUnverified(first)
      await waitFor(() => expect(within(other).getByRole('alert').textContent).toBe(UNVERIFIED))
      expectNoPotassium()
      // Hiding a sibling needs no request of its own.
      expect(api.labExecutions.mock.calls.filter(([, id]) => id === 'specimen-2')).toHaveLength(1)
    })

    it('hides a sibling again after its own refresh restored it, when access fails again', async () => {
      let firstLoads = 0
      api.labExecutions.mockImplementation(async (_facility, specimenId) => {
        if (specimenId === 'specimen-2') return { items: [potassium()] }
        if (++firstLoads === 1) return resultLoad()
        throw identityUnavailable()
      })
      await openAccession(actions, accession([specimen('received'), second]))
      const [first, other] = panels()
      expect(await within(other).findByText('9.9 mmol/L · low')).toBeTruthy()
      await refreshExecutions(first)
      await waitFor(() => expect(within(other).getByRole('alert').textContent).toBe(UNVERIFIED))

      // The sibling's own read confirms access for it, so its values return.
      await refreshExecutions(other)
      expect(await within(other).findByText('9.9 mmol/L · low')).toBeTruthy()

      // A second failure must hide it again, not only the first one.
      await refreshExecutions(first)
      await waitFor(() => expect(within(other).getByRole('alert').textContent).toBe(UNVERIFIED))
      expectNoPotassium()
    })

    it('treats the never-released history 404 as expected, not as a reason to re-check or hide', async () => {
      // If the 404 wrongly triggered a re-check, the failing reload would hide the values.
      api.labExecutions.mockResolvedValueOnce(resultLoad()).mockRejectedValue(identityUnavailable())
      api.labResultHistory.mockRejectedValue(problem(404, 'LAB_RESULT_NOT_FOUND', 'Lab result was not found'))
      const panel = await openExecutionPanel(actions)
      await expectResultValuesShown(panel)

      fireEvent.click(within(panel).getByRole('button', { name: 'View result history' }))

      expect((await within(panel).findByRole('alert')).textContent).toBe('Lab result was not found')
      expect(within(panel).getByText(visibleValue)).toBeTruthy()
      expect(screen.queryByText(ACCESS_DENIED)).toBeNull()
      expect(screen.queryByText(UNVERIFIED)).toBeNull()
      expect(api.labExecutions).toHaveBeenCalledTimes(1)
    })

    it('re-checks when the history read fails with an outage and hides results when the re-check fails', async () => {
      api.labExecutions.mockResolvedValueOnce(resultLoad()).mockRejectedValue(identityUnavailable())
      api.labResultHistory.mockRejectedValue(identityUnavailable())
      const panel = await openExecutionPanel(actions)
      await expectResultValuesShown(panel)

      fireEvent.click(within(panel).getByRole('button', { name: 'View result history' }))

      await expectUnverified(panel)
      expect(api.labExecutions).toHaveBeenCalledTimes(2)
    })

    it('restores results only once a refresh has confirmed access', async () => {
      const pending = deferred<{ items: LabExecution[] }>()
      api.labExecutions.mockResolvedValueOnce(resultLoad()).mockRejectedValueOnce(identityUnavailable())
        .mockReturnValueOnce(pending.promise)
      const panel = await openExecutionPanel(permissions)
      await expectResultValuesShown(panel)
      await refreshExecutions(panel)
      await expectUnverified(panel)

      await refreshExecutions(panel)

      // While the re-check is in flight nothing of the result is shown.
      expect(await within(panel).findByText('Loading executions…')).toBeTruthy()
      expectNoResultValues()
      pending.resolve(resultLoad())
      expect(await within(panel).findByText(visibleValue)).toBeTruthy()
      expect(within(panel).queryByRole('alert')).toBeNull()
      expect(api.labExecutions).toHaveBeenCalledTimes(3)
    })

    it('ignores a sibling request that answers after access was found to have ended', async () => {
      const late = deferred<{ items: LabExecution[] }>()
      let firstLoads = 0, otherLoads = 0
      api.labExecutions.mockImplementation(async (_facility, specimenId) => {
        if (specimenId === 'specimen-2') return ++otherLoads === 1 ? { items: [potassium()] } : late.promise
        if (++firstLoads === 1) return resultLoad()
        throw executionAccessDenied()
      })
      await openAccession(actions, accession([specimen('received'), second]))
      const [first, other] = panels()
      expect(await within(other).findByText('9.9 mmol/L · low')).toBeTruthy()
      expect(await within(first).findByText(visibleValue)).toBeTruthy()

      // The sibling's refresh is still in flight when the first panel is refused.
      await refreshExecutions(other)
      await waitFor(() => expect(otherLoads).toBe(2))
      await refreshExecutions(first)
      await waitFor(() => expect(within(other).getByRole('alert').textContent).toBe(ACCESS_DENIED))

      // Let the late answer and everything it schedules run, then prove it restored nothing.
      await act(async () => { late.resolve({ items: [potassium()] }) })
      expect(within(other).queryByText('Loading executions…')).toBeNull()
      expect(within(other).getByRole('alert').textContent).toBe(ACCESS_DENIED)
      expectNoPotassium()
    })

    describe('when a sibling\'s read is in flight as another specimen hides the results', () => {
      // A hide must void every sibling read already sent, at once: no commit may show a
      // sibling's values once the denial is on screen, not even for the one render before
      // the siblings' own effects run. Every commit is recorded to prove it.
      async function siblingsLoaded() {
        const commits: string[] = []
        let refuseFirst: (error: unknown) => void = () => undefined
        const otherRefresh = deferred<{ items: LabExecution[] }>()
        let firstLoads = 0, otherLoads = 0
        api.labExecutions.mockImplementation((_facility, specimenId) => {
          if (specimenId === 'specimen-2') {
            otherLoads += 1
            return otherLoads === 1 ? Promise.resolve({ items: [potassium()] }) : otherLoads === 2 ? otherRefresh.promise : Promise.resolve({ items: [potassium()] })
          }
          firstLoads += 1
          return firstLoads === 1 ? Promise.resolve(resultLoad()) : new Promise((_resolve, reject) => { refuseFirst = reject })
        })
        await openAccession(actions, accession([specimen('received'), second]), () => { commits.push(document.body.innerHTML) })
        const [first, other] = panels()
        expect(await within(first).findByText(visibleValue)).toBeTruthy()
        expect(await within(other).findByText('9.9 mmol/L · low')).toBeTruthy()

        // The sibling's refresh is sent and stays in flight; then the first panel refreshes too.
        await refreshExecutions(other)
        await waitFor(() => expect(otherLoads).toBe(2))
        await refreshExecutions(first)
        await waitFor(() => expect(firstLoads).toBe(2))
        return { commits, first, other, otherRefresh, refuseFirst: (error: unknown) => refuseFirst(error), otherLoads: () => otherLoads }
      }

      /** No commit from the first one that shows the denial onwards holds a value of either specimen. */
      function expectNothingShownSinceTheHide(commits: string[]) {
        const hiddenFrom = commits.findIndex(html => html.includes(ACCESS_DENIED))
        expect(hiddenFrom).toBeGreaterThanOrEqual(0)
        for (const html of commits.slice(hiddenFrom)) {
          for (const fragment of ['9.9', '3.5-5.1', '7.1', '12.0-15.5']) expect(html).not.toContain(fragment)
        }
      }

      it.each([
        ['after the hide, before any effect has run', 'after'],
        ['just before the hide, in the same render', 'before'],
      ])('never shows the sibling\'s values when its read answers %s, and shows them again only after a fresh read', async (_label, order) => {
        const { commits, first, other, otherRefresh, refuseFirst, otherLoads } = await siblingsLoaded()

        await act(async () => {
          if (order === 'after') {
            refuseFirst(executionAccessDenied())
            // Let the refusal's handlers run and request the hide; nothing renders inside act.
            for (let tick = 0; tick < 5; tick += 1) await Promise.resolve()
            otherRefresh.resolve({ items: [potassium()] })
          } else {
            otherRefresh.resolve({ items: [potassium()] })
            refuseFirst(executionAccessDenied())
          }
        })

        expect(within(first).getByRole('alert').textContent).toBe(ACCESS_DENIED)
        expect(within(other).getByRole('alert').textContent).toBe(ACCESS_DENIED)
        expectNothingShownSinceTheHide(commits)
        expectNoResultValues()
        expectNoPotassium()
        expect(otherLoads()).toBe(2)

        // Only a fresh read, sent after the hide and answered, shows the sibling's values again.
        const beforeRefresh = commits.length
        await refreshExecutions(other)
        expect(await within(other).findByText('9.9 mmol/L · low')).toBeTruthy()
        expect(otherLoads()).toBe(3)
        expect(within(other).queryByRole('alert')).toBeNull()
        expect(within(first).getByRole('alert').textContent).toBe(ACCESS_DENIED)
        expectNoResultValues()
        const restoredAt = commits.findIndex((html, index) => index >= beforeRefresh && html.includes('9.9 mmol/L'))
        expect(restoredAt).toBeGreaterThanOrEqual(beforeRefresh)
      })

      it('ignores a sibling\'s action that answers after the hide, before any effect has run', async () => {
        const commits: string[] = []
        let refuseFirst: (error: unknown) => void = () => undefined
        const completion = deferred<LabExecution>()
        let firstLoads = 0, otherLoads = 0
        const runningPotassium = () => execution({ ...potassium(), status: 'in_progress', completedAt: null, version: 1, result: null })
        api.labExecutions.mockImplementation((_facility, specimenId) => {
          if (specimenId === 'specimen-2') { otherLoads += 1; return Promise.resolve({ items: [runningPotassium()] }) }
          firstLoads += 1
          return firstLoads === 1 ? Promise.resolve(resultLoad()) : new Promise((_resolve, reject) => { refuseFirst = reject })
        })
        api.completeLabExecution.mockReturnValue(completion.promise)
        await openAccession(actions, accession([specimen('received'), second]), () => { commits.push(document.body.innerHTML) })
        const [first, other] = panels()
        expect(await within(first).findByText(visibleValue)).toBeTruthy()
        fireEvent.click(await within(other).findByRole('button', { name: 'Complete execution' }))
        await refreshExecutions(first)
        await waitFor(() => expect(firstLoads).toBe(2))
        const hideAt = commits.length

        await act(async () => {
          refuseFirst(executionAccessDenied())
          for (let tick = 0; tick < 5; tick += 1) await Promise.resolve()
          completion.resolve(potassium())
        })

        expect(within(other).getByRole('alert').textContent).toBe(ACCESS_DENIED)
        for (const html of commits.slice(hideAt)) {
          for (const fragment of ['9.9', 'Analytical execution was completed.']) expect(html).not.toContain(fragment)
        }
        expectNothingShownSinceTheHide(commits.slice(hideAt))
        // The late answer neither shows anything nor sets off a read of its own.
        expect(otherLoads).toBe(1)
      })

      it('never shows a sibling\'s answer that arrives after a hide, when nothing of the sibling was on screen', async () => {
        // Both panels were hidden once; the first was restored by its own refresh and the sibling's
        // refresh is in flight, showing nothing. A second refusal must void that read at once.
        const commits: string[] = []
        let refuseFirst: (error: unknown) => void = () => undefined
        const otherRefresh = deferred<{ items: LabExecution[] }>()
        let firstLoads = 0, otherLoads = 0
        api.labExecutions.mockImplementation((_facility, specimenId) => {
          if (specimenId === 'specimen-2') {
            otherLoads += 1
            return otherLoads === 2 ? otherRefresh.promise : Promise.resolve({ items: [potassium()] })
          }
          firstLoads += 1
          if (firstLoads === 2) return Promise.reject(executionAccessDenied())
          if (firstLoads === 4) return new Promise((_resolve, reject) => { refuseFirst = reject })
          return Promise.resolve(resultLoad())
        })
        await openAccession(actions, accession([specimen('received'), second]), () => { commits.push(document.body.innerHTML) })
        const [first, other] = panels()
        expect(await within(other).findByText('9.9 mmol/L · low')).toBeTruthy()
        await refreshExecutions(first)
        await waitFor(() => expect(screen.getAllByText(ACCESS_DENIED)).toHaveLength(2))
        await refreshExecutions(first)
        expect(await within(first).findByText(visibleValue)).toBeTruthy()
        await refreshExecutions(other)
        await waitFor(() => expect(otherLoads).toBe(2))
        await refreshExecutions(first)
        await waitFor(() => expect(firstLoads).toBe(4))
        const hideAt = commits.length

        await act(async () => {
          refuseFirst(executionAccessDenied())
          for (let tick = 0; tick < 5; tick += 1) await Promise.resolve()
          otherRefresh.resolve({ items: [potassium()] })
        })

        expect(commits.length).toBeGreaterThan(hideAt)
        for (const html of commits.slice(hideAt)) {
          for (const fragment of ['9.9', '3.5-5.1']) expect(html).not.toContain(fragment)
        }
        expect(within(other).getByRole('alert').textContent).toBe(ACCESS_DENIED)
        expectNothingShownSinceTheHide(commits.slice(hideAt))
        expectNoPotassium()
        expect(otherLoads).toBe(2)
      })
    })

    it('ignores the failure of a read that a newer, confirming read has replaced', async () => {
      // Only the newest read decides. An older one failing late must not hide what it confirmed.
      let failSuperseded: (error: unknown) => void = () => undefined
      api.labExecutions.mockResolvedValueOnce(resultLoad())
        .mockReturnValueOnce(new Promise((_resolve, reject) => { failSuperseded = reject }))
        .mockResolvedValue(resultLoad())
      api.verifyLabResult.mockRejectedValue(identityUnavailable())
      const panel = await openExecutionPanel(actions)
      await expectResultValuesShown(panel)

      await refreshExecutions(panel)
      await waitFor(() => expect(api.labExecutions).toHaveBeenCalledTimes(2))
      fireEvent.change(within(panel).getByRole('textbox', { name: 'Verification reason' }), { target: { value: 'Independent review against QC run' } })
      fireEvent.click(within(panel).getByRole('button', { name: 'Verify result version' }))
      await waitFor(() => expect(api.labExecutions).toHaveBeenCalledTimes(3))
      await executionsSettled(panel)

      await act(async () => { failSuperseded(identityUnavailable()) })
      expect(within(panel).getByText(visibleValue)).toBeTruthy()
      expect(screen.queryByText(UNVERIFIED)).toBeNull()
      expect(api.labExecutions).toHaveBeenCalledTimes(3)
    })

    it('keeps a sibling hidden when its superseded refresh and then its completion answer after the hide', async () => {
      // The sibling's late refresh confirms nothing, so the completion after it must not show values either.
      const superseded = deferred<{ items: LabExecution[] }>()
      const completion = deferred<LabExecution>()
      let firstLoads = 0, otherLoads = 0
      api.labExecutions.mockImplementation((_facility, specimenId) => {
        if (specimenId === 'specimen-2') {
          otherLoads += 1
          if (otherLoads === 1) return Promise.resolve({ items: [execution({ ...potassium(), status: 'in_progress', completedAt: null, version: 1, result: null })] })
          return otherLoads === 2 ? superseded.promise : new Promise(() => undefined)
        }
        if (++firstLoads === 1) return Promise.resolve(resultLoad())
        return Promise.reject(executionAccessDenied())
      })
      api.completeLabExecution.mockReturnValue(completion.promise)
      await openAccession(actions, accession([specimen('received'), second]))
      const [first, other] = panels()
      expect(await within(first).findByText(visibleValue)).toBeTruthy()

      fireEvent.click(await within(other).findByRole('button', { name: 'Complete execution' }))
      await refreshExecutions(other)
      await waitFor(() => expect(otherLoads).toBe(2))
      await refreshExecutions(first)
      await waitFor(() => expect(within(other).getByRole('alert').textContent).toBe(ACCESS_DENIED))

      await act(async () => { superseded.resolve({ items: [potassium()] }) })
      await act(async () => { completion.resolve(potassium()) })
      expect(within(other).getByRole('alert').textContent).toBe(ACCESS_DENIED)
      expect(within(other).queryByText('Potassium · LOINC 2823-3')).toBeNull()
      expect(within(other).queryByText('Analytical execution was completed.')).toBeNull()
      expectNoPotassium()
      expect(otherLoads).toBe(2)
    })

    it('ignores an action result that answers after the results were hidden', async () => {
      const verification = deferred<LabResult>()
      api.labExecutions.mockResolvedValueOnce(resultLoad()).mockRejectedValue(identityUnavailable())
      api.verifyLabResult.mockReturnValue(verification.promise)
      const panel = await openExecutionPanel(actions)
      await expectResultValuesShown(panel)

      fireEvent.change(within(panel).getByRole('textbox', { name: 'Verification reason' }), { target: { value: 'Independent review against QC run' } })
      fireEvent.click(within(panel).getByRole('button', { name: 'Verify result version' }))
      await refreshExecutions(panel)
      await expectUnverified(panel)

      await act(async () => { verification.resolve(verifiedResult()) })
      expect(api.verifyLabResult).toHaveBeenCalledTimes(1)
      expect(within(panel).getByRole('alert').textContent).toBe(UNVERIFIED)
      expect(within(panel).queryByText('This exact result version was verified.')).toBeNull()
      expectNoResultValues()
      // Nothing re-checked on the late answer's behalf.
      expect(api.labExecutions).toHaveBeenCalledTimes(2)
    })

    it('re-checks when an action fails with an error that is not an API error', async () => {
      api.labExecutions.mockResolvedValueOnce(resultLoad()).mockRejectedValue(identityUnavailable())
      api.verifyLabResult.mockRejectedValue(new TypeError('Failed to fetch'))
      const panel = await openExecutionPanel(actions)
      await expectResultValuesShown(panel)

      fireEvent.change(within(panel).getByRole('textbox', { name: 'Verification reason' }), { target: { value: 'Independent review against QC run' } })
      fireEvent.click(within(panel).getByRole('button', { name: 'Verify result version' }))

      await expectUnverified(panel)
      expect(api.labExecutions).toHaveBeenCalledTimes(2)
    })

    it('ignores a completion that answers after the results were hidden', async () => {
      const completion = deferred<LabExecution>()
      api.labExecutions.mockResolvedValueOnce({ items: [inProgress()] }).mockRejectedValue(identityUnavailable())
      api.completeLabExecution.mockReturnValue(completion.promise)
      const panel = await openExecutionPanel(actions)

      fireEvent.click(await within(panel).findByRole('button', { name: 'Complete execution' }))
      await refreshExecutions(panel)
      await expectUnverified(panel)

      await act(async () => { completion.resolve(execution()) })
      expect(api.completeLabExecution).toHaveBeenCalledTimes(1)
      expect(within(panel).getByRole('alert').textContent).toBe(UNVERIFIED)
      expect(within(panel).queryByText('Analytical execution was completed.')).toBeNull()
      expect(within(panel).queryByText('Hemoglobin · LOINC 718-7')).toBeNull()
      expect(api.labExecutions).toHaveBeenCalledTimes(2)
    })

    it('updates normally again after a refresh has confirmed access', async () => {
      const unverified = unverifiedResult()
      api.labExecutions.mockResolvedValueOnce({ items: [execution({ result: unverified })] }).mockRejectedValueOnce(identityUnavailable())
        .mockResolvedValueOnce({ items: [execution({ result: unverified })] }).mockResolvedValue({ items: [execution({ result: verifiedResult() })] })
      api.verifyLabResult.mockResolvedValue(verifiedResult())
      const panel = await openExecutionPanel(actions)
      await expectResultValuesShown(panel)
      await refreshExecutions(panel)
      await expectUnverified(panel)
      await refreshExecutions(panel)
      expect(await within(panel).findByText(visibleValue)).toBeTruthy()

      fireEvent.change(within(panel).getByRole('textbox', { name: 'Verification reason' }), { target: { value: 'Independent review against QC run' } })
      fireEvent.click(within(panel).getByRole('button', { name: 'Verify result version' }))

      expect(await within(panel).findByText('This exact result version was verified.')).toBeTruthy()
      expect(await within(panel).findByText('verified not released')).toBeTruthy()
      expect(api.verifyLabResult).toHaveBeenCalledWith(FACILITY, unverified, 'Independent review against QC run')
    })

    it('shows the session-ended state, not a refresh hint, when a refresh fails because the session ended (401)', async () => {
      api.labExecutions.mockResolvedValueOnce(resultLoad()).mockRejectedValue(new HidApiError(401, 'Please sign in to continue.', { code: 'UNAUTHENTICATED' }))
      const panel = await openExecutionPanel(permissions)
      await expectResultValuesShown(panel)

      await refreshExecutions(panel)

      await waitFor(() => expect(within(panel).getByRole('alert').textContent).toBe(SIGNED_OUT))
      await executionsSettled(panel)
      expectNoResultValues()
      expectNoFullPatientId()
      expect(screen.queryByText(UNVERIFIED)).toBeNull()
    })

    it.each([
      ['a network failure', networkFailure, UNVERIFIED],
      ['a timeout (408)', () => new HidApiError(408, 'The request timed out.', { code: 'REQUEST_TIMEOUT' }), UNVERIFIED],
      ['a server error (500)', () => new HidApiError(500, 'Unexpected server error', { code: 'SERVER_ERROR' }), UNVERIFIED],
      ['an unreadable response (502)', () => new HidApiError(502, 'The service returned an unreadable response.', { code: 'INVALID_RESPONSE' }), UNVERIFIED],
      ['an ended session (401)', () => new HidApiError(401, 'Please sign in to continue.', { code: 'UNAUTHENTICATED' }), SIGNED_OUT],
    ])('re-checks after a verification that fails with %s and hides results when the re-check fails too', async (_label, failure, message) => {
      api.labExecutions.mockResolvedValueOnce(resultLoad()).mockRejectedValue(failure())
      api.verifyLabResult.mockRejectedValue(failure())
      const panel = await openExecutionPanel(actions)
      await expectResultValuesShown(panel)

      fireEvent.change(within(panel).getByRole('textbox', { name: 'Verification reason' }), { target: { value: 'Independent review against QC run' } })
      fireEvent.click(within(panel).getByRole('button', { name: 'Verify result version' }))

      await waitFor(() => expect(within(panel).getByRole('alert').textContent).toBe(message))
      await executionsSettled(panel)
      expect(api.labExecutions).toHaveBeenCalledTimes(2)
      expectNoResultValues()
    })

    it('re-checks after a result entry fails with an outage and hides results when the re-check fails', async () => {
      api.labExecutions.mockResolvedValueOnce({ items: [execution()] }).mockRejectedValue(identityUnavailable())
      api.enterLabResult.mockRejectedValue(identityUnavailable())
      const panel = await openExecutionPanel(actions)

      fireEvent.click(await within(panel).findByText('Enter manual result'))
      fireEvent.change(within(panel).getByRole('spinbutton', { name: 'Numeric value' }), { target: { value: '13.4' } })
      fireEvent.click(within(panel).getByRole('button', { name: 'Record unverified result' }))

      await expectUnverified(panel)
      expect(api.labExecutions).toHaveBeenCalledTimes(2)
      expect(document.body.innerHTML).not.toContain('13.4')
    })

    it('re-checks after a completion fails with a server error and hides the execution when the re-check fails', async () => {
      api.labExecutions.mockResolvedValueOnce({ items: [inProgress()] }).mockRejectedValue(new HidApiError(500, 'Unexpected server error', { code: 'SERVER_ERROR' }))
      api.completeLabExecution.mockRejectedValue(new HidApiError(500, 'Unexpected server error', { code: 'SERVER_ERROR' }))
      const panel = await openExecutionPanel(actions)

      fireEvent.click(await within(panel).findByRole('button', { name: 'Complete execution' }))

      await expectUnverified(panel)
      expect(api.labExecutions).toHaveBeenCalledTimes(2)
    })

    it.each([
      ['refused (403)', executionAccessDenied, ACCESS_DENIED],
      ['answered with an outage (503)', identityUnavailable, UNVERIFIED],
    ])('re-checks when starting an execution is %s and hides every specimen when the re-check fails', async (_label, failure, message) => {
      let otherLoads = 0, firstLoads = 0
      api.labExecutions.mockImplementation(async (_facility, specimenId) => {
        if (specimenId === 'specimen-2') { if (++otherLoads === 1) return { items: [] }; throw failure() }
        if (++firstLoads === 1) return resultLoad()
        throw failure()
      })
      api.startLabExecution.mockRejectedValue(failure())
      await openAccession(actions, accession([specimen('received'), second]))
      const [first, other] = panels()
      expect(await within(first).findByText(visibleValue)).toBeTruthy()

      fireEvent.change(await within(other).findByRole('textbox', { name: 'Reason' }), { target: { value: 'Begin analysis' } })
      fireEvent.click(within(other).getByRole('button', { name: 'Start execution' }))

      await waitFor(() => expect(within(first).getByRole('alert').textContent).toBe(message))
      await waitFor(() => expect(within(other).getByRole('alert').textContent).toBe(message))
      expect(otherLoads).toBe(2)
      expectNoResultValues()
    })

    it.each([
      ['refused (403)', executionAccessDenied],
      ['answered with an outage (503)', identityUnavailable],
    ])('keeps the start error and the start form when starting is %s and the re-check confirms access', async (_label, failure) => {
      api.labExecutions.mockImplementation(async () => ({ items: [] }))
      api.startLabExecution.mockRejectedValue(failure())
      const panel = await openExecutionPanel(actions)

      fireEvent.change(await within(panel).findByRole('textbox', { name: 'Reason' }), { target: { value: 'Begin analysis' } })
      fireEvent.click(within(panel).getByRole('button', { name: 'Start execution' }))

      await waitFor(() => expect(api.labExecutions).toHaveBeenCalledTimes(2))
      await executionsSettled(panel)
      expect((await within(panel).findByRole('alert')).textContent).toBe(failure().message)
      expect(within(panel).getByRole('button', { name: 'Start execution' })).toBeTruthy()
      expect(screen.queryByText(ACCESS_DENIED)).toBeNull()
      expect(screen.queryByText(UNVERIFIED)).toBeNull()
    })

    it('does not bring back an old start error when results return after a hide', async () => {
      const notExecutable = 'Only the expected received specimen version can begin execution'
      api.labExecutions.mockResolvedValueOnce({ items: [] }).mockRejectedValueOnce(identityUnavailable()).mockResolvedValue({ items: [] })
      api.startLabExecution.mockRejectedValue(problem(412, 'SPECIMEN_NOT_EXECUTABLE', notExecutable))
      const panel = await openExecutionPanel(actions)
      fireEvent.change(await within(panel).findByRole('textbox', { name: 'Reason' }), { target: { value: 'Begin analysis' } })
      fireEvent.click(within(panel).getByRole('button', { name: 'Start execution' }))
      expect(await within(panel).findByText(notExecutable)).toBeTruthy()

      await refreshExecutions(panel)
      await expectUnverified(panel)
      await refreshExecutions(panel)

      expect(await within(panel).findByRole('button', { name: 'Start execution' })).toBeTruthy()
      expect(within(panel).queryByText(notExecutable)).toBeNull()
      expect(within(panel).queryByRole('alert')).toBeNull()
    })

    it('re-checks a history read refused after the history was closed', async () => {
      let refuseHistory: (error: unknown) => void = () => undefined
      api.labExecutions.mockResolvedValueOnce({ items: [execution({ result: releasedResult() })] }).mockRejectedValue(executionAccessDenied())
      api.labResultHistory.mockReturnValue(new Promise<LabResult>((_resolve, reject) => { refuseHistory = reject }))
      const panel = await openExecutionPanel(actions)
      expect(await within(panel).findByText(visibleValue)).toBeTruthy()

      fireEvent.click(within(panel).getByRole('button', { name: 'View result history' }))
      fireEvent.click(within(panel).getByRole('button', { name: 'Hide result history' }))
      await act(async () => { refuseHistory(executionAccessDenied()) })

      await waitFor(() => expect(within(panel).getByRole('alert').textContent).toBe(ACCESS_DENIED))
      await executionsSettled(panel)
      expect(api.labExecutions).toHaveBeenCalledTimes(2)
      expectNoResultValues()
    })

    describe('after a refused specimen step', () => {
      // Collect, receive and reject act on the same patient's accession. A step that fails
      // with a doubt re-reads the accession in place and every panel re-reads its results,
      // while the step keeps its error and what was typed into it.
      const custody = [...actions, 'lab.specimen.collect', 'lab.specimen.reject']
      const pendingSpecimen = specimen('required', { id: 'specimen-2', specimenIdentifier: 'SPC-000124', specimenType: 'Serum' })
      const notes = 'Tube label checked twice'

      /** Answers on a later task, as the network does, so React never merges the reload into one render. */
      function later<T>(answer: () => T): Promise<Awaited<T>> {
        return new Promise((resolve, reject) => setTimeout(() => { try { resolve(answer() as Awaited<T>) } catch (caught) { reject(caught) } }, 0))
      }

      async function collectPendingSpecimen(card: HTMLElement) {
        fireEvent.change(within(card).getByRole('textbox', { name: 'Notes or condition' }), { target: { value: notes } })
        const step = within(card).getAllByRole('button', { name: 'Record step' })[0]
        if (!step) throw new Error('Expected a specimen step form.')
        fireEvent.click(step)
      }

      /** The pending specimen's step form still shows its error and the notes typed into it. */
      function expectStepFailureShown(card: HTMLElement, message: string) {
        const form = formOf(within(card).getByRole('button', { name: 'Record step' }))
        expect(within(form).getByRole('alert').textContent).toBe(message)
        expect(valueOf(within(form).getByRole('textbox', { name: 'Notes or condition' }))).toBe(notes)
      }

      async function accessionSettled(card: HTMLElement) {
        await waitFor(() => expect(within(card).queryByText('Loading accession…')).toBeNull())
      }

      it.each([
        ['refused (403), as for a break-glass reader', operationRefused],
        ['answered with an outage (503)', identityUnavailable],
        ['lost to a network failure', networkFailure],
      ])('keeps the step error, the typed notes and the re-read results when a step is %s and the re-check confirms access', async (_label, failure) => {
        let firstLoads = 0
        api.labExecutions.mockImplementation(async () => ++firstLoads === 1 ? resultLoad() : { items: [execution({ result: correctionOf(unverifiedResult()) })] })
        api.transitionSpecimen.mockRejectedValue(failure())
        const card = await openAccession(custody, accession([specimen('received'), pendingSpecimen]))
        expect(await within(card).findByText(visibleValue)).toBeTruthy()
        api.labAccession.mockImplementation(() => later(() => accession([specimen('received'), pendingSpecimen])))

        await collectPendingSpecimen(card)

        await waitFor(() => expect(api.labAccession).toHaveBeenCalledTimes(2))
        // The panel re-read once, and shows what that read returned.
        expect(await within(card).findByText('7.4 g/dL · low')).toBeTruthy()
        await accessionSettled(card)
        await executionsSettled(card)
        expect(api.labExecutions).toHaveBeenCalledTimes(2)
        expectStepFailureShown(card, failure().message)
        expect(screen.queryByText(UNVERIFIED)).toBeNull()
        expect(screen.queryByText(ACCESS_DENIED)).toBeNull()
      })

      it('hides the results, and keeps the step error, when the re-read of the results fails', async () => {
        api.labExecutions.mockResolvedValueOnce(resultLoad()).mockRejectedValue(identityUnavailable())
        api.transitionSpecimen.mockRejectedValue(operationRefused())
        const card = await openAccession(custody, accession([specimen('received'), pendingSpecimen]))
        expect(await within(card).findByText(visibleValue)).toBeTruthy()
        api.labAccession.mockImplementation(() => later(() => accession([specimen('received'), pendingSpecimen])))

        await collectPendingSpecimen(card)

        const panel = sectionOf('Analytical execution')
        await expectUnverified(panel)
        await accessionSettled(card)
        expect(api.labExecutions).toHaveBeenCalledTimes(2)
        expectStepFailureShown(card, 'Lab operation is not authorized')
      })

      it('keeps the results on screen while the re-check reads them again', async () => {
        const confirming = deferred<{ items: LabExecution[] }>()
        api.labExecutions.mockResolvedValueOnce(resultLoad()).mockReturnValueOnce(confirming.promise)
        api.transitionSpecimen.mockRejectedValue(operationRefused())
        const card = await openAccession(custody, accession([specimen('received'), pendingSpecimen]))
        expect(await within(card).findByText(visibleValue)).toBeTruthy()
        api.labAccession.mockImplementation(() => later(() => accession([specimen('received'), pendingSpecimen])))

        await collectPendingSpecimen(card)

        await waitFor(() => expect(api.labExecutions).toHaveBeenCalledTimes(2))
        expect(within(card).getByText(visibleValue)).toBeTruthy()
        await act(async () => { confirming.resolve(resultLoad()) })
        await accessionSettled(card)
        expect(within(card).getByText(visibleValue)).toBeTruthy()
        expect(screen.queryByText(ACCESS_DENIED)).toBeNull()
      })

      it('re-checks again when a later step fails too, and hides the results when that re-check fails', async () => {
        api.labExecutions.mockResolvedValueOnce(resultLoad()).mockResolvedValueOnce(resultLoad()).mockRejectedValue(identityUnavailable())
        api.transitionSpecimen.mockRejectedValue(operationRefused())
        const card = await openAccession(custody, accession([specimen('received'), pendingSpecimen]))
        expect(await within(card).findByText(visibleValue)).toBeTruthy()
        api.labAccession.mockImplementation(() => later(() => accession([specimen('received'), pendingSpecimen])))
        await collectPendingSpecimen(card)
        await waitFor(() => expect(api.labExecutions).toHaveBeenCalledTimes(2))
        await accessionSettled(card)
        await executionsSettled(card)
        expect(within(card).getByText(visibleValue)).toBeTruthy()

        await clickWhenEnabled(within(card).getByRole('button', { name: 'Record step' }))

        await expectUnverified(sectionOf('Analytical execution'))
        await accessionSettled(card)
        expect(api.labAccession).toHaveBeenCalledTimes(3)
        expect(api.labExecutions).toHaveBeenCalledTimes(3)
        expectStepFailureShown(card, 'Lab operation is not authorized')
      })

      it('shows what the server recorded when a step went through but its answer was lost', async () => {
        api.labExecutions.mockImplementation(async () => resultLoad())
        api.transitionSpecimen.mockRejectedValue(networkFailure())
        const card = await openAccession([...custody, 'lab.specimen.receive'], accession([specimen('received'), pendingSpecimen]))
        expect(await within(card).findByText(visibleValue)).toBeTruthy()
        api.labAccession.mockImplementation(() => later(() => accession([specimen('received'), { ...pendingSpecimen, status: 'collected', version: 3 }])))

        await collectPendingSpecimen(card)

        expect(await within(card).findByText('collected')).toBeTruthy()
        await accessionSettled(card)
        expect(within(card).queryByText('required')).toBeNull()
        expect(optionLabels(within(card).getByRole('combobox', { name: 'Next step' }))).toEqual(['Mark received', 'Reject specimen'])
        expect(within(card).getByText(visibleValue)).toBeTruthy()
      })

      it.each([
        ['the newer re-read is refused and the older one confirms late', false],
        ['the newer re-read confirms and the older one fails late', true],
      ])('lets only the newest accession re-read decide when %s', async (_label, newerConfirms) => {
        const accessionGone = 'Lab accession was not found'
        const third = specimen('required', { id: 'specimen-3', specimenIdentifier: 'SPC-000125', specimenType: 'Plasma' })
        const current = () => accession([specimen('received'), pendingSpecimen, third])
        const reads: Array<{ resolve: (value: LabAccession) => void; reject: (error: unknown) => void }> = []
        api.labExecutions.mockImplementation(async () => resultLoad())
        api.transitionSpecimen.mockRejectedValue(identityUnavailable())
        const card = await openAccession(custody, current())
        expect(await within(card).findByText(visibleValue)).toBeTruthy()
        api.labAccession.mockImplementation(() => new Promise<LabAccession>((resolve, reject) => { reads.push({ resolve, reject }) }))

        // Two steps fail one after the other, so two re-reads of the accession are in flight.
        for (const step of within(card).getAllByRole('button', { name: 'Record step' })) {
          const before = api.labAccession.mock.calls.length
          fireEvent.click(step)
          await waitFor(() => expect(api.labAccession).toHaveBeenCalledTimes(before + 1))
        }
        const [older, newer] = reads
        if (!older || !newer) throw new Error('Expected two accession re-reads in flight.')

        if (newerConfirms) {
          await act(async () => { newer.resolve(current()) })
          await act(async () => { older.reject(problem(404, 'LAB_ACCESSION_NOT_FOUND', accessionGone)) })
          expect(within(card).getByText('Venous blood · SPC-000123')).toBeTruthy()
          expect(within(card).queryByText(accessionGone)).toBeNull()
          expect(await within(card).findByText(visibleValue)).toBeTruthy()
        } else {
          await act(async () => { newer.reject(problem(404, 'LAB_ACCESSION_NOT_FOUND', accessionGone)) })
          expect(within(card).getByRole('alert').textContent).toBe(accessionGone)
          await act(async () => { older.resolve(current()) })
          expect(within(card).getByRole('alert').textContent).toBe(accessionGone)
          expect(within(card).queryByText('Venous blood · SPC-000123')).toBeNull()
          expectNoResultValues()
        }
        expect(api.labAccession).toHaveBeenCalledTimes(3)
      })

      it('hides the results when the accession can no longer be read', async () => {
        const accessionGone = 'Lab accession was not found'
        api.labExecutions.mockImplementation(async () => resultLoad())
        api.transitionSpecimen.mockRejectedValue(operationRefused())
        const card = await openAccession(custody, accession([specimen('received'), pendingSpecimen]))
        expect(await within(card).findByText(visibleValue)).toBeTruthy()
        api.labAccession.mockImplementation(() => later(() => { throw problem(404, 'LAB_ACCESSION_NOT_FOUND', accessionGone) }))

        await collectPendingSpecimen(card)

        await waitFor(() => expect(within(card).getByRole('alert').textContent).toBe(accessionGone))
        expect(api.labAccession).toHaveBeenCalledTimes(2)
        expectNoResultValues()
        expect(within(card).queryByRole('heading', { name: 'Analytical execution' })).toBeNull()
        expect(within(card).queryByText('Venous blood · SPC-000123')).toBeNull()
      })

      it.each([
        ['refused (403)', operationRefused, ACCESS_DENIED],
        ['refused because the session ended (401)', () => new HidApiError(401, 'Please sign in to continue.', { code: 'UNAUTHENTICATED' }), SIGNED_OUT],
        ['answered with an outage (503)', identityUnavailable, UNVERIFIED],
      ])('hides results at once, with the reason, for a member who cannot re-read them when a step is %s', async (_label, failure, message) => {
        const runner = [...ACCESSION_READ, 'lab.execution.start', 'lab.specimen.collect']
        api.startLabExecution.mockResolvedValue(inProgress())
        api.transitionSpecimen.mockRejectedValue(failure())
        const card = await openAccession(runner, accession([specimen('received'), pendingSpecimen]))
        const panel = sectionOf('Analytical execution')
        fireEvent.change(within(panel).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Begin analysis' } })
        fireEvent.click(within(panel).getByRole('button', { name: 'Start execution' }))
        expect(await within(panel).findByText('Hemoglobin · LOINC 718-7')).toBeTruthy()
        api.labAccession.mockImplementation(() => later(() => accession([specimen('received'), pendingSpecimen])))

        await collectPendingSpecimen(card)

        await waitFor(() => expect(within(panel).getByRole('alert').textContent).toBe(message))
        await accessionSettled(card)
        expect(within(panel).queryByText('Hemoglobin · LOINC 718-7')).toBeNull()
        expect(api.labExecutions).not.toHaveBeenCalled()
        expectStepFailureShown(card, failure().message)

        // An explicit refresh starts over: the panel mounts afresh and offers a start again.
        await clickWhenEnabled(within(card).getByRole('button', { name: 'Refresh accession' }))
        expect(await within(card).findByRole('button', { name: 'Start execution' })).toBeTruthy()
        await accessionSettled(card)
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
        expect(within(card).getByRole('button', { name: 'Start execution' })).toBeTruthy()
        expect(screen.queryByText(message)).toBeNull()
      })

      it.each([
        ['a step failed with an outage', 'step'],
        ['a completion was refused', 'completion'],
      ])('offers a member who cannot read executions a fresh start once a step is recorded, after %s hid the panel', async (_label, hiddenBy) => {
        const runner = [...ACCESSION_READ, 'lab.execution.start', 'lab.execution.complete', 'lab.specimen.collect']
        api.startLabExecution.mockResolvedValue(inProgress())
        const collected = { ...pendingSpecimen, status: 'collected', version: 3 }
        api.completeLabExecution.mockRejectedValue(executionAccessDenied())
        const card = await openAccession(runner, accession([specimen('received'), pendingSpecimen]))
        const panel = sectionOf('Analytical execution')
        fireEvent.change(within(panel).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Begin analysis' } })
        fireEvent.click(within(panel).getByRole('button', { name: 'Start execution' }))
        expect(await within(panel).findByText('Hemoglobin · LOINC 718-7')).toBeTruthy()
        api.labAccession.mockImplementation(() => later(() => accession([specimen('received'), pendingSpecimen])))
        if (hiddenBy === 'step') {
          api.transitionSpecimen.mockRejectedValueOnce(identityUnavailable())
          await collectPendingSpecimen(card)
          await waitFor(() => expect(within(panel).getByRole('alert').textContent).toBe(UNVERIFIED))
          await accessionSettled(card)
        } else {
          fireEvent.click(within(panel).getByRole('button', { name: 'Complete execution' }))
          await waitFor(() => expect(within(panel).getByRole('alert').textContent).toBe(ACCESS_DENIED))
        }
        api.transitionSpecimen.mockResolvedValue(collected)
        api.labAccession.mockImplementation(() => later(() => accession([specimen('received'), collected])))

        await clickWhenEnabled(within(card).getByRole('button', { name: 'Record step' }))

        expect(await within(card).findByText('collected')).toBeTruthy()
        expect(await within(card).findByRole('button', { name: 'Start execution' })).toBeTruthy()
        await accessionSettled(card)
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
        expect(within(card).getByRole('button', { name: 'Start execution' })).toBeTruthy()
        expect(screen.queryByText(UNVERIFIED)).toBeNull()
        expect(screen.queryByText(ACCESS_DENIED)).toBeNull()
      })

      it('does not reload for a step refused on its merits (412)', async () => {
        api.labExecutions.mockImplementation(async () => resultLoad())
        api.transitionSpecimen.mockRejectedValue(problem(412, 'VERSION_CONFLICT', 'Specimen changed since it was loaded'))
        const card = await openAccession(custody, accession([specimen('received'), pendingSpecimen]))
        expect(await within(card).findByText(visibleValue)).toBeTruthy()

        await collectPendingSpecimen(card)

        expect(await within(card).findByText('Specimen changed since it was loaded')).toBeTruthy()
        expect(api.labExecutions).toHaveBeenCalledTimes(1)
        // An explicit refresh is the second accession load, so the 412 caused no reload.
        await clickWhenEnabled(within(card).getByRole('button', { name: 'Refresh accession' }))
        await waitFor(() => expect(api.labAccession).toHaveBeenCalledTimes(2))
      })

      it.each([
        ['Refresh accession', async (card: HTMLElement) => { await clickWhenEnabled(within(card).getByRole('button', { name: 'Refresh accession' })) }],
        ['a recorded step', async (card: HTMLElement) => { api.transitionSpecimen.mockResolvedValue(pendingSpecimen); await collectPendingSpecimen(card) }],
      ])('reads each specimen\'s results once when the accession reloads after %s', async (_label, reload) => {
        api.labExecutions.mockImplementation(async (_facility, specimenId) => specimenId === 'specimen-2' ? { items: [potassium()] } : resultLoad())
        const card = await openAccession(custody, accession([specimen('received'), second, specimen('required', { id: 'specimen-3', specimenIdentifier: 'SPC-000125', specimenType: 'Plasma' })]))
        expect(await within(card).findByText(visibleValue)).toBeTruthy()
        expect(await within(card).findByText('9.9 mmol/L · low')).toBeTruthy()
        api.labAccession.mockImplementation(() => later(() => accession([specimen('received'), second, specimen('required', { id: 'specimen-3', specimenIdentifier: 'SPC-000125', specimenType: 'Plasma' })])))

        await reload(card)

        await waitFor(() => expect(api.labAccession).toHaveBeenCalledTimes(2))
        await accessionSettled(card)
        expect(await within(card).findByText(visibleValue)).toBeTruthy()
        expect(await within(card).findByText('9.9 mmol/L · low')).toBeTruthy()
        for (const panel of panels()) await executionsSettled(panel)
        expect(api.labExecutions.mock.calls.filter(([, id]) => id === 'specimen-1')).toHaveLength(2)
        expect(api.labExecutions.mock.calls.filter(([, id]) => id === 'specimen-2')).toHaveLength(2)
      })
    })

    it('shows nothing from an action that answers while the confirming refresh is still in flight', async () => {
      const completion = deferred<LabExecution>()
      const confirming = deferred<{ items: LabExecution[] }>()
      api.labExecutions.mockResolvedValueOnce({ items: [inProgress()] }).mockRejectedValueOnce(identityUnavailable())
        .mockReturnValueOnce(confirming.promise)
      api.completeLabExecution.mockReturnValue(completion.promise)
      const panel = await openExecutionPanel(actions)

      fireEvent.click(await within(panel).findByRole('button', { name: 'Complete execution' }))
      await refreshExecutions(panel)
      await expectUnverified(panel)
      await refreshExecutions(panel)
      await act(async () => { completion.resolve(execution({ result: unverifiedResult() })) })

      expect(within(panel).queryByText('Hemoglobin · LOINC 718-7')).toBeNull()
      expect(within(panel).queryByText('Analytical execution was completed.')).toBeNull()
      expectNoResultValues()
      await act(async () => { confirming.resolve({ items: [inProgress()] }) })
      expect(await within(panel).findByText('Hemoglobin · LOINC 718-7')).toBeTruthy()
    })

    it('offers a member who cannot read executions a fresh start after the accession is refreshed', async () => {
      const runner = [...ACCESSION_READ, 'lab.execution.start', 'lab.execution.complete']
      api.startLabExecution.mockResolvedValue(inProgress())
      api.completeLabExecution.mockRejectedValue(executionAccessDenied())
      const card = await openAccession(runner, accession([specimen('received')]))
      const panel = sectionOf('Analytical execution')
      fireEvent.change(within(panel).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Begin analysis' } })
      fireEvent.click(within(panel).getByRole('button', { name: 'Start execution' }))
      fireEvent.click(await within(panel).findByRole('button', { name: 'Complete execution' }))
      await waitFor(() => expect(within(panel).getByRole('alert').textContent).toBe(ACCESS_DENIED))

      await clickWhenEnabled(within(card).getByRole('button', { name: 'Refresh accession' }))

      expect(await screen.findByRole('button', { name: 'Start execution' })).toBeTruthy()
      // The remounted panel's effects have all run, and none of them hid it again.
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
      expect(screen.getByRole('button', { name: 'Start execution' })).toBeTruthy()
      expect(screen.queryByText(ACCESS_DENIED)).toBeNull()
    })

    it('shows nothing of the patient\'s results or identity in the unavailable state', async () => {
      const consoles = (['log', 'info', 'warn', 'error', 'debug'] as const).map(level => vi.spyOn(console, level).mockImplementation(() => undefined))
      const finding = 'Gram-positive cocci in clusters'
      api.labExecutions.mockResolvedValueOnce({ items: [
        execution({ result: unverifiedResult() }),
        execution({ id: 'execution-3', test: { codeSystem: 'LOINC', code: '600-7', name: 'Blood culture' }, result: unverifiedResult({ id: 'result-3', executionId: 'execution-3',
          revisions: [revision({ resultType: 'text', numericValue: null, textValue: finding, unit: null, referenceRange: null, abnormalFlag: 'abnormal' })] }) }),
      ] }).mockRejectedValue(identityUnavailable())
      const panel = await openExecutionPanel(actions)
      await expectResultValuesShown(panel)
      expect(await within(panel).findByText(`${finding} · abnormal`)).toBeTruthy()

      await refreshExecutions(panel)

      await expectUnverified(panel)
      for (const fragment of ['Gram-positive', 'g/dL', 'Hemoglobin', 'Blood culture', 'result-1', 'result-3', 'execution-1', 'IDENTITY_SERVICE_UNAVAILABLE']) {
        expect(document.body.innerHTML).not.toContain(fragment)
      }
      expect(screen.queryAllByDisplayValue(/Gram-positive|7\.1/)).toHaveLength(0)
      // Nor in anything written to the console.
      const written = JSON.stringify(consoles.flatMap(spy => spy.mock.calls))
      for (const fragment of [PATIENT, '7.1', 'g/dL', 'Gram-positive']) expect(written).not.toContain(fragment)
    })
  })
})

describe('the result history toggle says whether the history is open', () => {
  it('reports aria-expanded false while closed and true once opened', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution({ result: releasedResult() })] })
    api.labResultHistory.mockResolvedValue(releasedResult())
    const panel = await openExecutionPanel([...EXECUTION_READ, 'lab.result.released.read'])
    const toggle = await within(panel).findByRole('button', { name: 'View result history' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(within(panel).getByRole('button', { name: 'Hide result history' }).getAttribute('aria-expanded')).toBe('true')
    await within(panel).findByText('Version 1')
  })
})

describe('the Laboratory work list says when the backend cut it short', () => {
  // Lab lists at most 200 work items, oldest accepted first, with no status filter and no
  // further page (lab-work-items.service.ts list): completing work never makes room.
  const many = (count: number) => Array.from({ length: count }, (_, n) => workItem({ id: `work-item-${n}` }))

  it('says that newer items cannot be reached from this page, and whom to ask, when the list holds 200', async () => {
    api.labWorkItems.mockResolvedValue({ items: many(200) })
    render(<Laboratory />)
    expect((await screen.findByText(/oldest accepted work items/)).textContent).toBe(WORK_LIST_CAP_NOTICE)
  })

  it('says nothing of the kind for a shorter list', async () => {
    api.labWorkItems.mockResolvedValue({ items: many(12) })
    render(<Laboratory />)
    await screen.findAllByText('Haemoglobin')
    expect(screen.queryByText(/oldest accepted work items/)).toBeNull()
  })
})
