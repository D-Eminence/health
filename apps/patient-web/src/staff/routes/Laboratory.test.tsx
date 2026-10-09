import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import type { LabAccession, LabExecution, LabResult, LabResultRevision, LabSpecimen, LabWorkItem, staffApi } from '../api'
import { Laboratory } from './Operations'

/**
 * The provider Laboratory page: accepted work, specimen accession and custody,
 * analytical execution, manual results and their governance. Patient
 * authorization is enforced by the backend; the page must show a refusal as
 * an access-denied state and never keep result values on screen after it.
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

const WORK_READ = ['lab.work-item.read']
const ACCESSION_READ = [...WORK_READ, 'lab.accession.read']
const EXECUTION_READ = [...ACCESSION_READ, 'lab.execution.read']

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
const execution = (overrides: Partial<LabExecution> = {}): LabExecution => ({
  id: 'execution-1', accessionId: 'accession-1', specimenId: 'specimen-1', requestedTestId: 'requested-test-1',
  test: { codeSystem: 'LOINC', code: '718-7', name: 'Hemoglobin' }, patientId: PATIENT, facilityId: FACILITY,
  status: 'completed', method: 'Automated haematology analyser', startedAt: '2026-10-09T09:00:00.000Z',
  completedAt: '2026-10-09T09:30:00.000Z', version: 2, result: null, ...overrides,
})

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

/** Renders the page, opens the accessioned work item and waits for its specimens. */
async function openAccession(permissions: string[], value: LabAccession) {
  staff.permissions = permissions
  api.labWorkItems.mockResolvedValue({ items: [accessionedItem] })
  api.labAccession.mockResolvedValue(value)
  render(<Laboratory />)
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

/** Presses "Refresh executions" once the previous load has finished. */
async function refreshExecutions(panel: HTMLElement) {
  const button = within(panel).getByRole('button', { name: 'Refresh executions' }) as HTMLButtonElement
  await waitFor(() => expect(button.disabled).toBe(false))
  fireEvent.click(button)
}

beforeEach(() => {
  vi.resetAllMocks()
  staff.permissions = [...WORK_READ]
  api.labWorkItems.mockResolvedValue({ items: [] })
  api.labExecutions.mockResolvedValue({ items: [] })
})

describe('Laboratory page access', () => {
  it('shows the unavailable state and loads nothing without lab work-item read permission', () => {
    staff.permissions = ['lab.accession.read', 'lab.execution.read', 'lab.result.verify']
    render(<Laboratory />)

    expect(screen.getByRole('heading', { name: 'Laboratory unavailable' })).toBeTruthy()
    expect(screen.getByText('This facility membership needs lab work-item read permission.')).toBeTruthy()
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
    expect((screen.getByRole('button', { name: 'Refresh work' }) as HTMLButtonElement).disabled).toBe(true)
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
    api.labWorkItems.mockRejectedValueOnce(new HidApiError(503, 'Lab work is temporarily unavailable.', { code: 'SERVICE_UNAVAILABLE' }))
    api.labWorkItems.mockResolvedValue({ items: [workItem()] })
    render(<Laboratory />)

    expect((await screen.findByRole('alert')).textContent).toBe('Lab work is temporarily unavailable.')
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
    expect(document.body.textContent).not.toContain(PATIENT)
    expect(document.body.textContent).not.toContain(otherPatient)
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
    return card
  }

  it('requires a specimen type and clinical reason before calling the API', async () => {
    const card = await openForm()

    fireEvent.submit(formOf(within(card).getByRole('button', { name: 'Create accession' })))

    expect((await within(card).findByRole('alert')).textContent).toBe('Enter a specimen type and clinical reason.')
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
  })

  it('shows the API error when the accession cannot be created', async () => {
    api.createLabAccession.mockRejectedValue(new HidApiError(409, 'An accession already exists for this work item.', { code: 'LAB_ACCESSION_EXISTS' }))
    const card = await openForm()

    fireEvent.change(within(card).getByRole('textbox', { name: 'Specimen type' }), { target: { value: 'Venous blood' } })
    fireEvent.change(within(card).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Suspected iron deficiency anaemia' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Create accession' }))

    expect((await within(card).findByRole('alert')).textContent).toBe('An accession already exists for this work item.')
    expect(api.labAccession).not.toHaveBeenCalled()
    const retry = within(card).getByRole('button', { name: 'Create accession' }) as HTMLButtonElement
    await waitFor(() => expect(retry.disabled).toBe(false))
  })
})

describe('Laboratory specimen custody', () => {
  const custody = [...ACCESSION_READ, 'lab.specimen.collect', 'lab.specimen.receive', 'lab.specimen.reject']

  it('offers collect and reject for a required specimen', async () => {
    const card = await openAccession(custody, accession([specimen('required')]))

    const step = within(card).getByRole('combobox', { name: 'Next step' })
    expect(optionLabels(step)).toEqual(['Mark collected', 'Reject specimen'])
    expect((step as HTMLSelectElement).value).toBe('collect')
    expect(within(card).getByText('required')).toBeTruthy()
  })

  it('limits the next steps to the granted lab.specimen permissions', async () => {
    const card = await openAccession([...ACCESSION_READ, 'lab.specimen.collect'], accession([specimen('required')]))

    expect(optionLabels(within(card).getByRole('combobox', { name: 'Next step' }))).toEqual(['Mark collected'])
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

    expect((await within(card).findByRole('alert')).textContent).toBe('Enter a rejection reason.')
    expect(api.transitionSpecimen).not.toHaveBeenCalled()

    fireEvent.change(reason, { target: { value: 'Sample haemolysed' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Record step' }))

    await waitFor(() => expect(api.transitionSpecimen).toHaveBeenCalledWith(FACILITY, 'accession-1', required, 'reject', 'Sample haemolysed'))
  })

  it('offers receipt for a collected specimen', async () => {
    const collected = specimen('collected', { version: 3 })
    const card = await openAccession(custody, accession([collected]))
    api.transitionSpecimen.mockResolvedValue(specimen('received', { version: 4 }))
    api.labAccession.mockResolvedValue(accession([specimen('received', { version: 4 })]))

    const step = within(card).getByRole('combobox', { name: 'Next step' })
    expect(optionLabels(step)).toEqual(['Mark received', 'Reject specimen'])
    expect((step as HTMLSelectElement).value).toBe('receive')
    fireEvent.change(within(card).getByRole('textbox', { name: 'Notes or condition' }), { target: { value: 'Intact, chilled' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Record step' }))

    await waitFor(() => expect(api.labAccession).toHaveBeenCalledTimes(2))
    expect(api.transitionSpecimen).toHaveBeenCalledWith(FACILITY, 'accession-1', collected, 'receive', 'Intact, chilled')
    expect(await within(card).findByText('received')).toBeTruthy()
    expect(within(card).queryByRole('combobox', { name: 'Next step' })).toBeNull()
  })

  it('shows the API error when a custody step is refused', async () => {
    const card = await openAccession(custody, accession([specimen('required')]))
    api.transitionSpecimen.mockRejectedValue(new HidApiError(409, 'The specimen changed since it was loaded. Refresh and try again.', { code: 'LAB_SPECIMEN_VERSION_CONFLICT' }))

    fireEvent.click(within(card).getByRole('button', { name: 'Record step' }))

    expect((await within(card).findByRole('alert')).textContent).toBe('The specimen changed since it was loaded. Refresh and try again.')
    expect(api.labAccession).toHaveBeenCalledTimes(1)
    expect(within(card).getByText('required')).toBeTruthy()
  })
})

describe('Laboratory analytical execution', () => {
  it('starts an execution for a received specimen', async () => {
    const received = specimen('received')
    const started = execution({ status: 'in_progress', completedAt: null, version: 1 })
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
  })

  it('requires a reason before starting an execution', async () => {
    const panel = await openExecutionPanel([...EXECUTION_READ, 'lab.execution.start'])

    fireEvent.submit(formOf(await within(panel).findByRole('button', { name: 'Start execution' })))

    expect((await within(panel).findByRole('alert')).textContent).toBe('Enter a reason to begin execution.')
    expect(api.startLabExecution).not.toHaveBeenCalled()
  })

  it('completes an in-progress execution', async () => {
    const running = execution({ status: 'in_progress', completedAt: null, version: 1 })
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

  it('does not offer completion without lab.execution.complete', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution({ status: 'in_progress', completedAt: null, version: 1 })] })
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

  it('rejects an invalid numeric value without calling the API', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution()] })
    const panel = await openExecutionPanel(permissions)

    fireEvent.click(await within(panel).findByText('Enter manual result'))
    const value = within(panel).getByRole('spinbutton', { name: 'Numeric value' })
    fireEvent.change(value, { target: { value: 'not-a-number' } })
    fireEvent.submit(formOf(value))

    expect((await within(panel).findByRole('alert')).textContent).toBe('Enter a valid numeric result.')
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
    expect((await within(panel).findByRole('alert')).textContent).toBe('Enter a reason for this decision.')
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

  it('shows the API error when a governance decision is refused', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution({ result: unverifiedResult() })] })
    api.verifyLabResult.mockRejectedValue(new HidApiError(409, 'This result version has changed. Refresh before retrying.', { code: 'LAB_RESULT_VERSION_CONFLICT' }))
    const panel = await openExecutionPanel([...EXECUTION_READ, 'lab.result.verify'])

    fireEvent.change(await within(panel).findByRole('textbox', { name: 'Verification reason' }), { target: { value: 'Independent review against QC run' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Verify result version' }))

    expect((await within(panel).findByRole('alert')).textContent).toBe('This result version has changed. Refresh before retrying.')
    expect(within(panel).queryByText('This exact result version was verified.')).toBeNull()
    expect(within(panel).getByText('entered unverified')).toBeTruthy()
    expect(api.labExecutions).toHaveBeenCalledTimes(1)
  })
})

describe('Laboratory result history', () => {
  const corrected = unverifiedResult({
    currentVersion: 2, currentReleasedVersion: 1,
    revisions: [
      revision({ verificationStatus: 'verified', releaseStatus: 'released' }),
      revision({ version: 2, numericValue: 7.4, enteredAt: '2026-10-09T11:00:00.000Z', correctionReason: 'Transcription error corrected' }),
    ],
  })

  function revisionEntry(version: number) {
    return screen.getByText(`Version ${version}`).closest('.staff-list-item') as HTMLElement
  }

  it('loads and lists every revision with its release status', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution({ result: corrected })] })
    api.labResultHistory.mockResolvedValue(corrected)
    const panel = await openExecutionPanel([...EXECUTION_READ, 'lab.result.released.read'])

    const view = await within(panel).findByRole('button', { name: 'View result history' })
    expect(within(panel).queryByText('Version 1')).toBeNull()
    fireEvent.click(view)

    expect(await within(panel).findByText('Version 1')).toBeTruthy()
    expect(api.labResultHistory).toHaveBeenCalledWith(FACILITY, 'result-1')
    expect(within(revisionEntry(1)).getByText('released')).toBeTruthy()
    expect(within(revisionEntry(1)).getByText('7.1 g/dL · low')).toBeTruthy()
    expect(within(revisionEntry(2)).getByText('not released')).toBeTruthy()
    expect(within(revisionEntry(2)).getByText('7.4 g/dL · low')).toBeTruthy()
    expect(within(revisionEntry(2)).getByText('Reason: Transcription error corrected')).toBeTruthy()
    expect(within(panel).getByRole('button', { name: 'Hide result history' })).toBeTruthy()
  })

  it('shows the history load error and no revisions', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution({ result: corrected })] })
    api.labResultHistory.mockRejectedValue(new HidApiError(503, 'Result history is temporarily unavailable.', { code: 'SERVICE_UNAVAILABLE' }))
    const panel = await openExecutionPanel([...EXECUTION_READ, 'lab.result.released.read'])

    fireEvent.click(await within(panel).findByRole('button', { name: 'View result history' }))

    expect((await within(panel).findByRole('alert')).textContent).toBe('Result history is temporarily unavailable.')
    expect(within(panel).queryByText('Version 1')).toBeNull()
    expect(within(panel).queryByText('Version 2')).toBeNull()
  })

  it('offers no history without lab.result.released.read', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution({ result: corrected })] })
    const panel = await openExecutionPanel(EXECUTION_READ)

    expect(await within(panel).findByText('Manual result · version 2')).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'View result history' })).toBeNull()
    expect(api.labResultHistory).not.toHaveBeenCalled()
  })
})

describe('Laboratory result access denied', () => {
  const permissions = [...EXECUTION_READ, 'lab.execution.start', 'lab.result.enter', 'lab.result.verify', 'lab.result.released.read']
  const visibleValue = '7.1 g/dL · low'

  function expectNoResultValues() {
    expect(screen.queryByText(/7\.1/)).toBeNull()
    expect(document.body.textContent).not.toContain('7.1')
    expect(document.body.textContent).not.toContain('g/dL')
  }

  it('shows the access-denied state when executions are refused on first load', async () => {
    api.labExecutions.mockRejectedValue(new HidApiError(403, 'Lab execution access denied', { code: 'LAB_EXECUTION_ACCESS_DENIED' }))
    const panel = await openExecutionPanel(permissions)

    expect((await within(panel).findByRole('alert')).textContent).toBe(ACCESS_DENIED)
    expect(api.labExecutions).toHaveBeenCalledWith(FACILITY, 'specimen-1')
    expect(screen.queryByText('Lab execution access denied')).toBeNull()
    expect(within(panel).queryByRole('button', { name: 'Start execution' })).toBeNull()
    expect(within(panel).queryByText('No execution has started for this specimen.')).toBeNull()
    expect(within(panel).queryByText(/^Manual result/)).toBeNull()
    expectNoResultValues()
  })

  it('removes result values already on screen when a refresh is refused', async () => {
    api.labExecutions.mockResolvedValueOnce({ items: [execution({ result: unverifiedResult() })] })
    const panel = await openExecutionPanel(permissions)
    expect(await within(panel).findByText(visibleValue)).toBeTruthy()

    api.labExecutions.mockRejectedValueOnce(new HidApiError(403, 'Lab execution access denied', { code: 'LAB_EXECUTION_ACCESS_DENIED' }))
    await refreshExecutions(panel)

    expect((await within(panel).findByRole('alert')).textContent).toBe(ACCESS_DENIED)
    expect(api.labExecutions).toHaveBeenCalledTimes(2)
    expect(api.labExecutions).toHaveBeenLastCalledWith(FACILITY, 'specimen-1')
    expectNoResultValues()
    expect(within(panel).queryByText('Hemoglobin · LOINC 718-7')).toBeNull()
    expect(within(panel).queryByRole('button', { name: 'Verify result version' })).toBeNull()
    expect(within(panel).queryByRole('button', { name: 'View result history' })).toBeNull()
    expect(within(panel).queryByRole('button', { name: 'Start execution' })).toBeNull()
  })

  it('removes result values when the specimen is no longer visible after access is revoked', async () => {
    api.labExecutions.mockResolvedValueOnce({ items: [execution({ result: unverifiedResult() })] })
    const panel = await openExecutionPanel(permissions)
    expect(await within(panel).findByText(visibleValue)).toBeTruthy()

    api.labExecutions.mockRejectedValueOnce(new HidApiError(404, 'Lab specimen not found', { code: 'LAB_SPECIMEN_NOT_FOUND' }))
    await refreshExecutions(panel)

    expect((await within(panel).findByRole('alert')).textContent).toBe(ACCESS_DENIED)
    expect(screen.queryByText('Lab specimen not found')).toBeNull()
    expectNoResultValues()
    expect(within(panel).queryByRole('button', { name: 'Start execution' })).toBeNull()
  })

  it('removes released history and the success notice when the reload after a decision is refused', async () => {
    const unverified = unverifiedResult()
    api.labExecutions.mockResolvedValueOnce({ items: [execution({ result: unverified })] })
      .mockRejectedValue(new HidApiError(403, 'Lab execution access denied', { code: 'LAB_EXECUTION_ACCESS_DENIED' }))
    api.labResultHistory.mockResolvedValue(unverified)
    api.verifyLabResult.mockResolvedValue(verifiedResult())
    const panel = await openExecutionPanel(permissions)
    fireEvent.click(await within(panel).findByRole('button', { name: 'View result history' }))
    expect(await within(panel).findByText('Version 1')).toBeTruthy()

    fireEvent.change(within(panel).getByRole('textbox', { name: 'Verification reason' }), { target: { value: 'Independent review against QC run' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Verify result version' }))

    await waitFor(() => expect(within(panel).getByRole('alert').textContent).toBe(ACCESS_DENIED))
    expect(api.verifyLabResult).toHaveBeenCalledWith(FACILITY, unverified, 'Independent review against QC run')
    expect(api.labExecutions).toHaveBeenCalledTimes(2)
    expect(within(panel).queryByText('This exact result version was verified.')).toBeNull()
    expect(within(panel).queryByText('Version 1')).toBeNull()
    expectNoResultValues()
  })

  it('shows the server message, not the access-denied state, when Identity is unavailable', async () => {
    api.labExecutions.mockRejectedValue(new HidApiError(503, 'Patient authorization is temporarily unavailable. Try again shortly.', { code: 'IDENTITY_SERVICE_UNAVAILABLE' }))
    const panel = await openExecutionPanel(permissions)

    expect((await within(panel).findByRole('alert')).textContent).toBe('Patient authorization is temporarily unavailable. Try again shortly.')
    expect(screen.queryByText(ACCESS_DENIED)).toBeNull()
    expect(within(panel).queryByRole('button', { name: 'Start execution' })).toBeNull()
    expectNoResultValues()
  })

  it('shows results again once a refresh is authorized', async () => {
    api.labExecutions.mockRejectedValueOnce(new HidApiError(403, 'Lab execution access denied', { code: 'LAB_EXECUTION_ACCESS_DENIED' }))
      .mockResolvedValue({ items: [execution({ result: unverifiedResult() })] })
    const panel = await openExecutionPanel(permissions)
    expect((await within(panel).findByRole('alert')).textContent).toBe(ACCESS_DENIED)

    await refreshExecutions(panel)

    expect(await within(panel).findByText(visibleValue)).toBeTruthy()
    expect(within(panel).queryByRole('alert')).toBeNull()
  })
})
