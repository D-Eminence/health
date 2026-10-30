import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import type { LabAccession, LabExecution, LabResult, LabResultRevision, LabSpecimen, LabWorkItem } from '../../../../staff/api'
import { forgetReceiving } from '../../../../staff/orderRoutes'
import { forgetCannotCompleteServed } from '../../../../cannotCompleteServed'
import { forgetLateCorrectionServed } from '../../../../lateCorrectionServed'
import { forgetWrongPatientServed } from '../../../../wrongPatientServed'
import { Laboratory } from '../../../../ehr-blue/departments/laboratory/Laboratory'
import { laboratoryPage } from '../../../../ehr-blue/departments/laboratory/page'
import { DEMO_LABORATORY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'

/**
 * The blue Laboratory page: the target's list and record views over today's Lab API. Every request, permission check
 * and refusal path is today's Laboratory page's; the look and words are the target's.
 */
const api = vi.hoisted(() => ({
  labWorkItems: vi.fn(), createLabAccession: vi.fn(), labAccession: vi.fn(), transitionSpecimen: vi.fn(), labExecutions: vi.fn(),
  startLabExecution: vi.fn(), completeLabExecution: vi.fn(), enterLabResult: vi.fn(), correctLabResult: vi.fn(),
  verifyLabResult: vi.fn(), releaseLabResult: vi.fn(), labResultHistory: vi.fn(),
}))
const routes = vi.hoisted(() => ({ incoming: vi.fn(), cannotComplete: vi.fn(), reportWrongPatient: vi.fn(), get: vi.fn(),
  findCorrectable: vi.fn(), correctWrongPatient: vi.fn(), accept: vi.fn(), decline: vi.fn() }))
// Every staff API member the page reaches for that this test does not provide.
const unprovided = vi.hoisted(() => new Set<string>())
const session = vi.hoisted(() => ({ facility: undefined as FakeFacility | undefined }))

vi.mock('../../../../staff/App', async () => {
  const { staffContext } = await import('../harness')
  return { useStaff: () => staffContext(session.facility) }
})
vi.mock('../../../../staff/api', () => {
  const watched = <T extends object>(target: T) => new Proxy(target, {
    get(object, property) {
      if (typeof property === 'string' && !(property in object)) unprovided.add(property)
      return Reflect.get(object, property)
    },
  })
  return { staffApi: watched(api), orderRoutesApi: watched(routes) }
})

const PATIENT = 'a0000000-0000-4000-8000-0000004f9c2e'
const MASKED = 'Patient ••••4f9c2e'
const WORK = ['lab.work-item.read']
const ACCESSION = [...WORK, 'lab.accession.create', 'lab.accession.read']
const CUSTODY = [...ACCESSION, 'lab.specimen.collect', 'lab.specimen.receive', 'lab.specimen.reject']
const PROCESSING = [...ACCESSION, 'lab.execution.read', 'lab.execution.start', 'lab.execution.complete', 'lab.result.enter',
  'lab.result.correct', 'lab.result.verify', 'lab.result.release', 'lab.result.released.read']
const DENIED = 'Access denied. You are not authorized to view lab results for this patient. Results stay hidden until access is granted again.'
const CAP = 'This list can show only the 200 oldest accepted work items. Any item accepted after them is not shown and cannot be '
  + 'reached from this page: completing work or refreshing the list does not bring it into view. Contact your facility '
  + 'administrator about orders not listed here.'

const problem = (status: number, code: string, message: string) => new HidApiError(status, message, { code })

const workItem = (overrides: Partial<LabWorkItem> = {}): LabWorkItem => ({
  id: 'work-item-1', patientId: PATIENT, version: 1, status: 'accepted', testName: 'Haemoglobin',
  accessionId: null, accessionNumber: null, acceptedAt: '2026-10-09T08:00:00.000Z', ...overrides,
})
const accessioned = workItem({ accessionId: 'accession-1', accessionNumber: 'ACC-2026-000123', specimenStatuses: ['required'] })
const specimen = (status: string, overrides: Partial<LabSpecimen> = {}): LabSpecimen => ({
  id: 'specimen-1', accessionId: 'accession-1', specimenIdentifier: 'SPC-000123', specimenType: 'Venous blood', status, version: 2,
  ...overrides,
})
const accession = (specimens: LabSpecimen[]): LabAccession => ({
  id: 'accession-1', accessionNumber: 'ACC-2026-000123', workItemId: 'work-item-1', status: 'open', specimens,
})
const revision = (overrides: Partial<LabResultRevision> = {}): LabResultRevision => ({
  version: 1, resultType: 'numeric', numericValue: 7.1, textValue: null, unit: 'g/dL', referenceRange: '12.0-15.5',
  abnormalFlag: 'low', entrySource: 'manual', verificationStatus: 'unverified', releaseStatus: 'not_released',
  enteredAt: '2026-10-09T10:00:00.000Z', correctionReason: null, ...overrides,
})
const draftResult = (overrides: Partial<LabResult> = {}): LabResult => ({
  id: 'result-1', executionId: 'execution-1', status: 'entered_unverified', verificationStatus: 'unverified',
  currentVersion: 1, currentReleasedVersion: null, revisions: [revision()], ...overrides,
})
const verifiedResult = () => draftResult({ status: 'verified_not_released', verificationStatus: 'verified',
  revisions: [revision({ verificationStatus: 'verified', releaseStatus: 'verified_not_released' })] })
const publishedResult = () => draftResult({ status: 'released', verificationStatus: 'verified', currentReleasedVersion: 1,
  revisions: [revision({ verificationStatus: 'verified', releaseStatus: 'released', releasedAt: '2026-10-09T12:00:00.000Z' })] })
const execution = (overrides: Partial<LabExecution> = {}): LabExecution => ({
  id: 'execution-1', accessionId: 'accession-1', specimenId: 'specimen-1', requestedTestId: 'requested-test-1',
  test: { codeSystem: 'LOINC', code: '718-7', name: 'Hemoglobin' }, patientId: PATIENT, facilityId: DEMO_LABORATORY_ID,
  status: 'completed', method: 'Automated haematology analyser', startedAt: '2026-10-09T09:00:00.000Z',
  completedAt: '2026-10-09T09:30:00.000Z', version: 2, result: null, ...overrides,
})

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  let reject: (reason: unknown) => void = () => undefined
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function as(permissions: string[], overrides: Partial<FakeFacility> = {}) {
  session.facility = fakeFacility(permissions, overrides)
}

/** The list view's region (hidden while a record is open). */
function listView() {
  return screen.getByRole('heading', { level: 1, name: 'Laboratory' }).closest('.hid-ehr-dept') as HTMLElement
}

/** The open record's view. */
function recordView() {
  return screen.getByRole('heading', { level: 1 }).closest('.hid-ehr-dept') as HTMLElement
}

function rowOf(name: string) {
  return within(listView()).getByRole('button', { name }).closest('tr') as HTMLElement
}

function cardOf(heading: string | RegExp) {
  return screen.getByRole('heading', { name: heading }).closest('section') as HTMLElement
}

async function openRecord(name = 'Haemoglobin') {
  const row = (await screen.findByRole('button', { name })).closest('tr') as HTMLElement
  fireEvent.click(within(row).getByRole('button', { name: 'Open' }))
  await screen.findByRole('heading', { level: 1, name })
  return recordView()
}

/** Renders the page as `permissions`, opens the accessioned work and waits for its sample. */
async function openAccession(permissions: string[], value: LabAccession) {
  as(permissions)
  api.labWorkItems.mockResolvedValue({ items: [accessioned] })
  api.labAccession.mockResolvedValue(value)
  renderDept(<Laboratory />)
  await openRecord()
  await screen.findByRole('heading', { name: 'Sample SPC-000123' })
  return cardOf('Accession')
}

async function refusalOf(control: HTMLElement) {
  await waitFor(() => expect(control.getAttribute('aria-invalid')).toBe('true'))
  return document.getElementById(control.getAttribute('aria-describedby') ?? '')?.textContent
}

beforeEach(() => {
  vi.clearAllMocks()
  unprovided.clear()
  as(WORK)
  api.labWorkItems.mockResolvedValue({ items: [] })
  api.labExecutions.mockResolvedValue({ items: [] })
  routes.incoming.mockResolvedValue({ items: [], crossFacilityOrders: true, crossFacilityWork: true })
  forgetReceiving(); forgetCannotCompleteServed(); forgetLateCorrectionServed(); forgetWrongPatientServed()
})
afterEach(() => {
  // Nothing outside the provided staff API members was reached for.
  expect([...unprovided]).toEqual([])
  vi.unstubAllEnvs()
  forgetReceiving(); forgetCannotCompleteServed(); forgetLateCorrectionServed(); forgetWrongPatientServed()
})

describe('the page entry', () => {
  it('keeps its path, group, label, permission and status', () => {
    expect(laboratoryPage).toMatchObject({ path: 'lab', group: 'Diagnostics', label: 'Laboratory', permission: 'lab.work-item.read', status: 'live' })
  })
})

describe('access', () => {
  it('says the membership cannot open Laboratory without lab work-item read permission, and reads nothing', () => {
    as(['lab.accession.read', 'lab.execution.read', 'lab.result.verify'])
    renderDept(<Laboratory />)
    expect(screen.getByRole('heading', { level: 1, name: 'Laboratory' })).toBeTruthy()
    expect(screen.getByText('Permission denied. This facility membership cannot open Laboratory: it needs permission to read lab work.')).toBeTruthy()
    expect(screen.queryByRole('textbox', { name: 'Search Laboratory' })).toBeNull()
    expect(api.labWorkItems).not.toHaveBeenCalled()
  })

  it('reads nothing without a working facility', () => {
    session.facility = undefined
    renderDept(<Laboratory />)
    expect(screen.getByText(/^Permission denied\./)).toBeTruthy()
    expect(api.labWorkItems).not.toHaveBeenCalled()
  })
})

describe('the list', () => {
  it('says it is loading while the work list is read, with Refresh list unavailable but focusable', async () => {
    const pending = deferred<{ items: LabWorkItem[] }>()
    api.labWorkItems.mockReturnValue(pending.promise)
    renderDept(<Laboratory />)
    expect(screen.getByRole('status').textContent).toBe('Loading lab work…')
    const refresh = screen.getByRole('button', { name: 'Refresh list' })
    expect(refresh.getAttribute('aria-disabled')).toBe('true')
    expect((refresh as HTMLButtonElement).disabled).toBe(false)
    expect(api.labWorkItems).toHaveBeenCalledWith(DEMO_LABORATORY_ID)
    await act(async () => { pending.resolve({ items: [workItem()] }) })
    expect(await screen.findByRole('button', { name: 'Haemoglobin' })).toBeTruthy()
    expect(screen.queryByText('Loading lab work…')).toBeNull()
  })

  it('says there is no lab work yet, and reads the list again from its Refresh', async () => {
    renderDept(<Laboratory />)
    expect(await screen.findByText('No lab work yet')).toBeTruthy()
    expect(screen.getByText('Accepted lab orders for this facility appear here. Refresh to check for new work.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    api.labWorkItems.mockResolvedValue({ items: [workItem()] })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('button', { name: 'Haemoglobin' })).toBeTruthy()
    expect(api.labWorkItems).toHaveBeenCalledTimes(2)
  })

  it('shows the refusal, not the empty state, and recovers from Refresh list', async () => {
    api.labWorkItems.mockRejectedValueOnce(problem(503, 'SERVICE_UNAVAILABLE', 'The service is temporarily unavailable. Please try again shortly.'))
    api.labWorkItems.mockResolvedValue({ items: [workItem()] })
    renderDept(<Laboratory />)
    expect((await screen.findByRole('alert')).textContent).toBe('The service is temporarily unavailable. Please try again shortly.')
    expect(screen.queryByText('No lab work yet')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh list' }))
    expect(await screen.findByRole('button', { name: 'Haemoglobin' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says the module is not in service when the gateway has no Lab route', async () => {
    api.labWorkItems.mockRejectedValue(problem(404, 'API_ROUTE_NOT_FOUND', 'Not found'))
    renderDept(<Laboratory />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/^This workspace is not in service on this Health ID deployment/)
  })

  it('lists the work in the target’s columns, with masked patients only', async () => {
    const other = 'b0000000-0000-4000-8000-00000071d3a8'
    api.labWorkItems.mockResolvedValue({ items: [workItem(), workItem({ id: 'work-item-2', patientId: other, testName: 'Serum ferritin',
      accessionId: 'accession-2', accessionNumber: 'ACC-2026-000124' }), workItem({ id: 'abcdef12-3456', testName: undefined })] })
    renderDept(<Laboratory />)
    await screen.findByRole('button', { name: 'Haemoglobin' })
    const table = screen.getByRole('table', { name: 'Lab work' })
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual(['Record', 'Patient / context', 'Status', 'Updated', 'Actions'])
    const first = rowOf('Haemoglobin')
    expect(within(first).getByText('work-ite')).toBeTruthy()
    expect(within(first).getByText(MASKED)).toBeTruthy()
    expect(within(first).getByText('accepted')).toBeTruthy()
    expect(within(first).getByText(new Date('2026-10-09T08:00:00.000Z').toLocaleString())).toBeTruthy()
    expect(within(first).getByRole('button', { name: 'Quick view' })).toBeTruthy()
    expect(within(first).getByRole('button', { name: 'Open' })).toBeTruthy()
    const second = rowOf('Serum ferritin')
    expect(within(second).getByText('ACC-2026-000124')).toBeTruthy()
    expect(within(second).getByText('accessioned')).toBeTruthy()
    expect(within(second).getByText('Patient ••••71d3a8')).toBeTruthy()
    expect(within(rowOf('Lab test')).getByText('abcdef12')).toBeTruthy()
    expect(document.body.innerHTML).not.toContain(PATIENT)
    expect(document.body.innerHTML).not.toContain(other)
  })

  it('searches what is listed, and says when nothing matches', async () => {
    api.labWorkItems.mockResolvedValue({ items: [workItem(), workItem({ id: 'work-item-2', testName: 'Serum ferritin' })] })
    renderDept(<Laboratory />)
    await screen.findByRole('button', { name: 'Haemoglobin' })
    const search = screen.getByRole('searchbox', { name: 'Search Laboratory' })
    expect(search.getAttribute('placeholder')).toBe('Search saved records…')
    fireEvent.change(search, { target: { value: 'ferr' } })
    expect(screen.queryByRole('button', { name: 'Haemoglobin' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Serum ferritin' })).toBeTruthy()
    fireEvent.change(search, { target: { value: 'urea' } })
    expect(screen.getByText('No matching records')).toBeTruthy()
    expect(screen.getByText('Change your search.')).toBeTruthy()
    expect(api.labWorkItems).toHaveBeenCalledTimes(1)
  })

  it('says when the backend cut the list short at 200, and nothing of the kind below it', async () => {
    api.labWorkItems.mockResolvedValue({ items: Array.from({ length: 200 }, (_, index) => workItem({ id: `work-${index}` })) })
    const { unmount } = renderDept(<Laboratory />)
    expect(await screen.findByText(CAP)).toBeTruthy()
    unmount()
    api.labWorkItems.mockResolvedValue({ items: [workItem()] })
    renderDept(<Laboratory />)
    await screen.findByRole('button', { name: 'Haemoglobin' })
    expect(screen.queryByText(CAP)).toBeNull()
  })
})

describe('quick view', () => {
  it('shows the record’s facts in a drawer, and opens the full record from it', async () => {
    as(ACCESSION)
    api.labWorkItems.mockResolvedValue({ items: [workItem({ priority: 'urgent' })] })
    renderDept(<Laboratory />)
    fireEvent.click(within(rowOf('Haemoglobin')).getByRole('button', { name: 'Quick view' }))
    const drawer = screen.getByRole('dialog', { name: 'Record quick view' })
    expect(within(drawer).getByRole('heading', { name: 'Haemoglobin' })).toBeTruthy()
    expect(within(drawer).getByText('Patient').nextSibling?.textContent).toBe(MASKED)
    expect(within(drawer).getByText('Priority').nextSibling?.textContent).toBe('urgent')
    expect(within(drawer).getByText('Accession').nextSibling?.textContent).toBe('Not created yet')
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(within(rowOf('Haemoglobin')).getByRole('button', { name: 'Quick view' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Open full record' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Haemoglobin' })).toBeTruthy()
    expect(document.activeElement?.id).toBe('lab-record-title')
  })
})

describe('the record view', () => {
  it('opens in place with one heading, moves focus to it, and goes back to the list with focus on the row', async () => {
    api.labWorkItems.mockResolvedValue({ items: [workItem()] })
    renderDept(<Laboratory />)
    const record = await openRecord()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(document.activeElement?.id).toBe('lab-record-title')
    expect(within(record).getByText(MASKED)).toBeTruthy()
    expect(within(record).getByText('accepted')).toBeTruthy()
    // Nothing about the record goes in the address.
    expect(window.location.href).not.toMatch(/work-item-1/)
    fireEvent.click(within(record).getByRole('button', { name: 'Back to list' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Laboratory' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Haemoglobin' }))
  })

  it('opens from the record’s name too, by keyboard', async () => {
    api.labWorkItems.mockResolvedValue({ items: [workItem()] })
    renderDept(<Laboratory />)
    const name = await screen.findByRole('button', { name: 'Haemoglobin' })
    name.focus()
    // A native button: Enter and Space press it.
    fireEvent.click(name)
    expect(await screen.findByRole('heading', { level: 1, name: 'Haemoglobin' })).toBeTruthy()
  })

  it('shows the Saved record, and no actions to a member who may only read', async () => {
    api.labWorkItems.mockResolvedValue({ items: [workItem({ priority: 'routine' })] })
    renderDept(<Laboratory />)
    await openRecord()
    const saved = cardOf('Saved record')
    expect([...saved.querySelectorAll('dt')].map(term => term.textContent)).toEqual(['Test', 'Patient', 'Priority', 'Accepted', 'Accession', 'Status'])
    expect(within(cardOf('Available actions')).getByText('No further actions for your permission and this record state.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create accession' })).toBeNull()
  })
})

describe('creating an accession', () => {
  async function openForm() {
    as(ACCESSION)
    api.labWorkItems.mockResolvedValue({ items: [workItem()] })
    renderDept(<Laboratory />)
    await openRecord()
    const toggle = screen.getByRole('button', { name: 'Create accession' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    return screen.getByRole('form', { name: 'Create accession' })
  }

  it('opens its form inline from Available actions, and asks for each required field first', async () => {
    const form = await openForm()
    expect(within(form).getByText(`Haemoglobin · ${MASKED}`)).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Create accession' }))
    const type = within(form).getByRole('textbox', { name: 'Sample type' })
    expect(await refusalOf(type)).toBe('Complete this field.')
    await waitFor(() => expect(document.activeElement).toBe(type))
    fireEvent.change(type, { target: { value: 'Venous blood' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Create accession' }))
    expect(await refusalOf(within(form).getByRole('textbox', { name: 'Clinical reason' }))).toBe('Complete this field.')
    expect(api.createLabAccession).not.toHaveBeenCalled()
  })

  it('creates the accession, reads it by its new id, says so, and moves focus to it', async () => {
    const created = { ...accession([specimen('required', { id: 'specimen-7', specimenIdentifier: 'SPC-000777' })]), id: 'accession-7',
      accessionNumber: 'ACC-2026-000777' }
    api.createLabAccession.mockResolvedValue(created)
    api.labAccession.mockResolvedValue(created)
    const form = await openForm()
    api.labWorkItems.mockResolvedValue({ items: [workItem({ accessionId: 'accession-7', accessionNumber: 'ACC-2026-000777' })] })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Sample type' }), { target: { value: ' Venous blood ' } })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Clinical reason' }), { target: { value: 'Suspected anaemia' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Create accession' }))
    await waitFor(() => expect(api.labAccession).toHaveBeenCalledWith(DEMO_LABORATORY_ID, 'accession-7'))
    expect(api.createLabAccession).toHaveBeenCalledWith(DEMO_LABORATORY_ID, 'work-item-1', 'Venous blood', 'Suspected anaemia')
    expect(await screen.findByRole('heading', { name: 'Sample SPC-000777' })).toBeTruthy()
    expect(within(cardOf('Accession')).getByRole('status').textContent).toBe('Accession ACC-2026-000777 created.')
    expect(document.activeElement?.id).toBe('lab-accession-title')
    expect(screen.queryByRole('form', { name: 'Create accession' })).toBeNull()
    await waitFor(() => expect(api.labWorkItems).toHaveBeenCalledTimes(2))
    expect(document.body.innerHTML).not.toContain(PATIENT)
  })

  it('shows the service’s refusal in the form', async () => {
    api.createLabAccession.mockRejectedValue(problem(409, 'LAB_WORK_ITEM_NOT_ACCESSIONABLE', 'Lab work item is not accessionable at this facility'))
    const form = await openForm()
    fireEvent.change(within(form).getByRole('textbox', { name: 'Sample type' }), { target: { value: 'Venous blood' } })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Clinical reason' }), { target: { value: 'Suspected anaemia' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Create accession' }))
    expect((await within(form).findByRole('alert')).textContent).toBe('Lab work item is not accessionable at this facility')
    expect(api.labAccession).not.toHaveBeenCalled()
  })
})

describe('the accession', () => {
  it('says it is loading, with Refresh accession unavailable', async () => {
    const pending = deferred<LabAccession>()
    as(ACCESSION)
    api.labWorkItems.mockResolvedValue({ items: [accessioned] })
    api.labAccession.mockReturnValue(pending.promise)
    renderDept(<Laboratory />)
    await openRecord()
    const card = cardOf('Accession')
    expect(within(card).getByRole('status').textContent).toBe('Loading accession…')
    expect(within(card).getByRole('button', { name: 'Refresh accession' }).getAttribute('aria-disabled')).toBe('true')
    await act(async () => { pending.resolve(accession([specimen('received')])) })
    expect(await screen.findByRole('heading', { name: 'Sample SPC-000123' })).toBeTruthy()
    expect(within(card).getByText('Accession number').nextSibling?.textContent).toBe('ACC-2026-000123')
  })

  it('shows a refusal and no samples, then recovers from Refresh accession', async () => {
    as(CUSTODY)
    api.labWorkItems.mockResolvedValue({ items: [accessioned] })
    api.labAccession.mockRejectedValueOnce(problem(403, 'LAB_OPERATION_ACCESS_DENIED', 'Lab operation is not authorized'))
      .mockResolvedValue(accession([specimen('required')]))
    renderDept(<Laboratory />)
    await openRecord()
    const card = cardOf('Accession')
    expect((await within(card).findByRole('alert')).textContent).toBe('Lab operation is not authorized')
    expect(screen.queryByRole('heading', { name: 'Sample SPC-000123' })).toBeNull()
    const refresh = within(card).getByRole('button', { name: 'Refresh accession' })
    await waitFor(() => expect(refresh.getAttribute('aria-disabled')).toBeNull())
    fireEvent.click(refresh)
    expect(await screen.findByRole('heading', { name: 'Sample SPC-000123' })).toBeTruthy()
    expect(within(card).queryByRole('alert')).toBeNull()
  })

  it('offers no accession to a member without lab.accession.read', async () => {
    api.labWorkItems.mockResolvedValue({ items: [accessioned] })
    renderDept(<Laboratory />)
    await openRecord()
    expect(screen.queryByRole('heading', { name: 'Accession' })).toBeNull()
    expect(api.labAccession).not.toHaveBeenCalled()
  })
})

describe('sample custody', () => {
  it('offers collect and reject for a sample awaiting collection, as granted', async () => {
    await openAccession(CUSTODY, accession([specimen('required')]))
    const actions = cardOf(/^Available actions for sample SPC-000123/)
    expect(within(actions).getAllByRole('button').map(button => button.textContent)).toEqual(['Collect sample', 'Reject sample'])
  })

  it('offers receipt only with lab.specimen.receive', async () => {
    await openAccession([...ACCESSION, 'lab.specimen.collect', 'lab.specimen.reject'], accession([specimen('collected')]))
    const actions = cardOf(/^Available actions for sample/)
    expect(within(actions).getAllByRole('button').map(button => button.textContent)).toEqual(['Reject sample'])
  })

  it('offers no step without lab.specimen permissions', async () => {
    await openAccession(ACCESSION, accession([specimen('required')]))
    expect(within(cardOf(/^Available actions for sample/)).getByText('No further actions for your permission and this record state.')).toBeTruthy()
  })

  it('records collection, reads the accession again, says so, and moves focus to the next step', async () => {
    const required = specimen('required')
    await openAccession(CUSTODY, accession([required]))
    api.transitionSpecimen.mockResolvedValue(specimen('collected', { version: 3 }))
    api.labAccession.mockResolvedValue(accession([specimen('collected', { version: 3 })]))
    fireEvent.click(screen.getByRole('button', { name: 'Collect sample' }))
    const form = screen.getByRole('form', { name: 'Collect sample' })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Collection notes' }), { target: { value: 'Left arm' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Collect sample' }))
    await waitFor(() => expect(api.labAccession).toHaveBeenCalledTimes(2))
    expect(api.transitionSpecimen).toHaveBeenCalledWith(DEMO_LABORATORY_ID, 'accession-1', required, 'collect', 'Left arm')
    const receive = await screen.findByRole('button', { name: 'Receive sample' })
    await waitFor(() => expect(document.activeElement).toBe(receive))
    expect(within(cardOf('Accession')).getByRole('status').textContent).toBe('Sample collected.')
    await waitFor(() => expect(api.labWorkItems).toHaveBeenCalledTimes(2))
  })

  it('asks for a reason before rejecting a sample', async () => {
    const required = specimen('required')
    await openAccession(CUSTODY, accession([required]))
    api.transitionSpecimen.mockResolvedValue(specimen('rejected', { version: 3 }))
    fireEvent.click(screen.getByRole('button', { name: 'Reject sample' }))
    const form = screen.getByRole('form', { name: 'Reject sample' })
    const reason = within(form).getByRole('textbox', { name: 'Reason' })
    fireEvent.change(reason, { target: { value: '   ' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Reject sample' }))
    expect(await refusalOf(reason)).toBe('Complete this field.')
    expect(api.transitionSpecimen).not.toHaveBeenCalled()
    fireEvent.change(reason, { target: { value: 'Haemolysed' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Reject sample' }))
    await waitFor(() => expect(api.transitionSpecimen).toHaveBeenCalledWith(DEMO_LABORATORY_ID, 'accession-1', required, 'reject', 'Haemolysed'))
  })

  it('shows a version conflict in the form, and does not read again for it', async () => {
    await openAccession(CUSTODY, accession([specimen('required')]))
    api.transitionSpecimen.mockRejectedValue(problem(412, 'VERSION_CONFLICT', 'Specimen changed since it was loaded'))
    fireEvent.click(screen.getByRole('button', { name: 'Collect sample' }))
    const form = screen.getByRole('form', { name: 'Collect sample' })
    fireEvent.click(within(form).getByRole('button', { name: 'Collect sample' }))
    expect((await within(form).findByRole('alert')).textContent).toBe('Specimen changed since it was loaded')
    expect(api.labAccession).toHaveBeenCalledTimes(1)
  })
})

describe('processing and results', () => {
  async function openReceived(permissions: string[] = PROCESSING) {
    await openAccession(permissions, accession([specimen('received')]))
    await waitFor(() => expect(api.labExecutions).toHaveBeenCalledWith(DEMO_LABORATORY_ID, 'specimen-1'))
    await waitFor(() => expect(screen.queryByText('Loading processing…')).toBeNull())
    return cardOf(/^Available actions for sample/)
  }

  it('starts processing a received sample, asking for its details first', async () => {
    const received = specimen('received')
    const started = execution({ status: 'in_progress', completedAt: null, version: 1 })
    api.labExecutions.mockResolvedValueOnce({ items: [] }).mockResolvedValue({ items: [started] })
    api.startLabExecution.mockResolvedValue(started)
    const actions = await openReceived()
    fireEvent.click(within(actions).getByRole('button', { name: 'Start processing' }))
    const form = screen.getByRole('form', { name: 'Start processing' })
    fireEvent.click(within(form).getByRole('button', { name: 'Start processing' }))
    expect(await refusalOf(within(form).getByRole('textbox', { name: 'Processing details' }))).toBe('Complete this field.')
    fireEvent.change(within(form).getByRole('textbox', { name: 'Method' }), { target: { value: 'Analyser' } })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Processing details' }), { target: { value: 'Routine count' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Start processing' }))
    expect(await screen.findByText('Processing started.')).toBeTruthy()
    expect(api.startLabExecution).toHaveBeenCalledWith(DEMO_LABORATORY_ID, received, 'Routine count', 'Analyser')
    expect(screen.getByText('Hemoglobin · LOINC 718-7')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Complete processing' })).toBeTruthy()
  })

  it('tells a member who may only read that no processing has started', async () => {
    await openAccession([...ACCESSION, 'lab.execution.read'], accession([specimen('received')]))
    expect(await screen.findByText('No processing has started for this sample.')).toBeTruthy()
  })

  it('completes processing', async () => {
    const running = execution({ status: 'in_progress', completedAt: null, version: 1 })
    api.labExecutions.mockResolvedValueOnce({ items: [running] }).mockResolvedValue({ items: [execution()] })
    api.completeLabExecution.mockResolvedValue(execution())
    const actions = await openReceived()
    fireEvent.click(within(actions).getByRole('button', { name: 'Complete processing' }))
    const form = screen.getByRole('form', { name: 'Complete processing' })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Completion notes' }), { target: { value: 'Run passed QC' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Complete processing' }))
    expect(await screen.findByText('Processing completed.')).toBeTruthy()
    expect(api.completeLabExecution).toHaveBeenCalledWith(DEMO_LABORATORY_ID, running, 'Run passed QC')
  })

  it('saves a draft result, refusing a value that is not a number first', async () => {
    const completed = execution()
    api.labExecutions.mockResolvedValue({ items: [completed] })
    api.enterLabResult.mockResolvedValue(draftResult())
    const actions = await openReceived()
    fireEvent.click(within(actions).getByRole('button', { name: 'Save draft result' }))
    const form = screen.getByRole('form', { name: 'Save draft result' })
    const value = within(form).getByRole('spinbutton', { name: 'Result value' })
    fireEvent.click(within(form).getByRole('button', { name: 'Save draft result' }))
    expect(await refusalOf(value)).toBe('Enter a number.')
    fireEvent.change(value, { target: { value: '7.1' } })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Unit' }), { target: { value: 'g/dL' } })
    fireEvent.change(within(form).getByRole('combobox', { name: 'Flag' }), { target: { value: 'low' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save draft result' }))
    expect(await screen.findByText('Draft result saved.')).toBeTruthy()
    expect(api.enterLabResult).toHaveBeenCalledWith(DEMO_LABORATORY_ID, completed,
      { resultType: 'numeric', numericValue: 7.1, unit: 'g/dL', abnormalFlag: 'low' })
  })

  it('verifies a draft result with a review note', async () => {
    const result = draftResult()
    api.labExecutions.mockResolvedValue({ items: [execution({ result })] })
    api.verifyLabResult.mockResolvedValue(verifiedResult())
    const actions = await openReceived()
    expect(screen.getByText('Result').nextSibling?.textContent).toBe('draft result · version 1')
    expect(screen.getByText('Value').nextSibling?.textContent).toBe('7.1 g/dL · low')
    fireEvent.click(within(actions).getByRole('button', { name: 'Verify result' }))
    const form = screen.getByRole('form', { name: 'Verify result' })
    fireEvent.click(within(form).getByRole('button', { name: 'Verify result' }))
    expect(await refusalOf(within(form).getByRole('textbox', { name: 'Review note' }))).toBe('Complete this field.')
    fireEvent.change(within(form).getByRole('textbox', { name: 'Review note' }), { target: { value: 'Independent review' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Verify result' }))
    expect(await screen.findByText('Version 1 verified.')).toBeTruthy()
    expect(api.verifyLabResult).toHaveBeenCalledWith(DEMO_LABORATORY_ID, result, 'Independent review')
  })

  it('publishes a verified result, and offers no publication without lab.result.release', async () => {
    const result = verifiedResult()
    api.labExecutions.mockResolvedValue({ items: [execution({ result })] })
    api.releaseLabResult.mockResolvedValue(publishedResult())
    const actions = await openReceived()
    fireEvent.click(within(actions).getByRole('button', { name: 'Publish result' }))
    const form = screen.getByRole('form', { name: 'Publish result' })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Reviewed' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Publish result' }))
    expect(await screen.findByText('Version 1 published.')).toBeTruthy()
    expect(api.releaseLabResult).toHaveBeenCalledWith(DEMO_LABORATORY_ID, result, 'Reviewed')
  })

  it('offers to correct a published result only with lab.result.revise-released', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution({ result: publishedResult() })] })
    const actions = await openReceived()
    expect(within(actions).queryByRole('button', { name: /^Correct/ })).toBeNull()
  })

  it('records a correction of a published result as a new draft version, with its reason', async () => {
    const result = publishedResult()
    const done = execution({ result })
    api.labExecutions.mockResolvedValue({ items: [done] })
    api.correctLabResult.mockResolvedValue(draftResult({ currentVersion: 2 }))
    const actions = await openReceived([...PROCESSING, 'lab.result.revise-released'])
    fireEvent.click(within(actions).getByRole('button', { name: 'Correct published result' }))
    const form = screen.getByRole('form', { name: 'Correct published result' })
    expect((within(form).getByRole('spinbutton', { name: 'Result value' }) as HTMLInputElement).value).toBe('7.1')
    fireEvent.click(within(form).getByRole('button', { name: 'Correct published result' }))
    expect(await refusalOf(within(form).getByRole('textbox', { name: 'Reason' }))).toBe('Complete this field.')
    fireEvent.change(within(form).getByRole('spinbutton', { name: 'Result value' }), { target: { value: '7.4' } })
    fireEvent.change(within(form).getByRole('combobox', { name: 'Type of change' }), { target: { value: 'amendment' } })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Reason' }), { target: { value: 'Transcription error' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Correct published result' }))
    expect(await screen.findByText('Corrected result saved as a new draft version.')).toBeTruthy()
    expect(api.correctLabResult).toHaveBeenCalledWith(DEMO_LABORATORY_ID, done, result,
      { resultType: 'numeric', numericValue: 7.4, unit: 'g/dL', referenceRange: '12.0-15.5', abnormalFlag: 'low' }, 'Transcription error', 'amendment')
  })

  it('reads the result history only when asked, under Preserved versions & amendments', async () => {
    const result = publishedResult()
    api.labExecutions.mockResolvedValue({ items: [execution({ result })] })
    api.labResultHistory.mockResolvedValue({ ...result, revisions: [...result.revisions,
      revision({ version: 2, numericValue: 7.4, correctionReason: 'Transcription error' })] })
    await openReceived()
    const history = cardOf(/^Preserved versions & amendments/)
    expect(api.labResultHistory).not.toHaveBeenCalled()
    const toggle = within(history).getByRole('button', { name: 'View result history' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(await within(history).findByText('Version 1 · published')).toBeTruthy()
    expect(within(history).getByText('Version 2 · not published · Transcription error')).toBeTruthy()
    expect(api.labResultHistory).toHaveBeenCalledWith(DEMO_LABORATORY_ID, 'result-1')
  })

  it('hides every result and says access was denied when the processing read is refused', async () => {
    api.labExecutions.mockRejectedValue(problem(403, 'LAB_EXECUTION_ACCESS_DENIED', 'Lab execution/result access is not authorized'))
    await openAccession(PROCESSING, accession([specimen('received')]))
    expect(await screen.findByText(DENIED)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start processing' })).toBeNull()
  })

  it('hides the values when a refused verification is followed by a refused re-check', async () => {
    api.labExecutions.mockResolvedValueOnce({ items: [execution({ result: draftResult() })] })
      .mockRejectedValue(problem(403, 'LAB_EXECUTION_ACCESS_DENIED', 'Lab execution/result access is not authorized'))
    api.verifyLabResult.mockRejectedValue(problem(403, 'LAB_OPERATION_ACCESS_DENIED', 'Lab operation is not authorized'))
    const actions = await openReceived()
    expect(screen.getByText('7.1 g/dL · low')).toBeTruthy()
    fireEvent.click(within(actions).getByRole('button', { name: 'Verify result' }))
    const form = screen.getByRole('form', { name: 'Verify result' })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Review note' }), { target: { value: 'Review' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Verify result' }))
    expect(await screen.findByText(DENIED)).toBeTruthy()
    expect(screen.queryByText('7.1 g/dL · low')).toBeNull()
    expect(api.labExecutions).toHaveBeenCalledTimes(2)
  })

  it('does not re-check for a refusal answered on its merits (409)', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution({ result: draftResult() })] })
    api.verifyLabResult.mockRejectedValue(problem(409, 'LAB_RESULT_SELF_VERIFICATION', 'The person who entered a result cannot verify it'))
    const actions = await openReceived()
    fireEvent.click(within(actions).getByRole('button', { name: 'Verify result' }))
    const form = screen.getByRole('form', { name: 'Verify result' })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Review note' }), { target: { value: 'Review' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Verify result' }))
    expect((await within(form).findByRole('alert')).textContent).toBe('The person who entered a result cannot verify it')
    expect(api.labExecutions).toHaveBeenCalledTimes(1)
    expect(screen.getByText('7.1 g/dL · low')).toBeTruthy()
  })
})

/* Work from orders other facilities sent here. */
const ROUTE_ID = '9c1b2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e'
const routeCard = (overrides: Record<string, unknown> = {}) => ({ id: ROUTE_ID, reference: '9C1B2D3E', effectiveState: 'accepted',
  access: 'work', orderingFacilityName: 'Demo Hospital', ordererName: 'Dr Demo Clinician', version: 3, endedKind: null, ...overrides })
const PERSON = { fullName: 'Patient One', sex: 'female', dateOfBirth: '1990-01-01', healthIdLast4: 'AAA2' }
const routed = (overrides: Partial<LabWorkItem> & Record<string, unknown> = {}) => workItem({ id: 'w-routed', priority: 'routine',
  specimenStatuses: [], orderRoute: routeCard() as LabWorkItem['orderRoute'], patient: PERSON, ...overrides })
const local = workItem({ id: 'w-local', patientId: 'a0000000-0000-4000-8000-000000aa11bb', testName: 'Malaria parasite' })
const answer = (items: LabWorkItem[], fields: Record<string, unknown> = {}) => ({ items, crossFacilityOrders: true, crossFacilityWork: true,
  receives: true, routesHere: { waiting: false, held: true }, lateCorrection: true, ...fields })
const RECEIVE = [...ACCESSION, 'lab.order-route.receive']
const FROM = 'From Demo Hospital · Ref 9C1B2D3E · Ordered by Dr Demo Clinician'
const WP = 'This isn’t the order’s patient'
const CC = 'We can’t complete this order'

describe('work from another facility', () => {
  beforeEach(() => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1') })

  it('names the ordering facility and the patient on that row and in the record only', async () => {
    as(ACCESSION)
    api.labWorkItems.mockResolvedValue(answer([routed(), local]))
    renderDept(<Laboratory />)
    await screen.findByRole('button', { name: 'Haemoglobin' })
    const row = rowOf('Haemoglobin')
    expect(within(row).getByText('Patient One, female, born 1 Jan 1990, Health ID ending AAA2')).toBeTruthy()
    expect(within(row).getByText(FROM)).toBeTruthy()
    expect(rowOf('Malaria parasite').textContent).not.toMatch(/From |Patient One/)
    const record = await openRecord()
    expect(within(record).getByText(FROM)).toBeTruthy()
    expect(within(cardOf('Saved record')).getByText('Ordering facility').nextSibling?.textContent).toBe('Demo Hospital')
    expect(within(cardOf('Saved record')).getByText('Reference').nextSibling?.textContent).toBe('9C1B2D3E')
  })

  it('asks to check the person before a sample is taken, above Create accession', async () => {
    as(ACCESSION)
    api.labWorkItems.mockResolvedValue(answer([routed()]))
    renderDept(<Laboratory />)
    await openRecord()
    const actions = cardOf('Available actions')
    const check = within(actions).getByText('Check that the person is Patient One before you take a sample.')
    const create = within(actions).getByRole('button', { name: 'Create accession' })
    expect(check.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('says to stop work on a cancelled order, and offers no accession on it', async () => {
    as(ACCESSION)
    api.labWorkItems.mockResolvedValue(answer([routed({ orderRoute: routeCard({ effectiveState: 'cancelled', access: 'read',
      endedKind: 'order_changed' }) as LabWorkItem['orderRoute'] })]))
    renderDept(<Laboratory />)
    expect(await screen.findByText('Cancelled by Demo Hospital: stop work.')).toBeTruthy()
    const record = await openRecord()
    expect(within(record).getByText('Cancelled by Demo Hospital: stop work.')).toBeTruthy()
    expect(within(record).queryByRole('button', { name: 'Create accession' })).toBeNull()
  })

  it('says a closed order when creating an accession is refused as closed', async () => {
    as(ACCESSION)
    api.labWorkItems.mockResolvedValue(answer([routed()]))
    api.createLabAccession.mockRejectedValue(problem(409, 'ORDER_ROUTE_CLOSED', 'Closed'))
    renderDept(<Laboratory />)
    await openRecord()
    fireEvent.click(screen.getByRole('button', { name: 'Create accession' }))
    const form = screen.getByRole('form', { name: 'Create accession' })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Sample type' }), { target: { value: 'Venous blood' } })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Clinical reason' }), { target: { value: 'At the counter' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Create accession' }))
    expect((await within(form).findByRole('alert')).textContent).toBe('This order from another facility is closed: it was cancelled, or '
      + 'its time for work has ended, so nothing more can be recorded on it. Refresh the list.')
  })

  it('says a step on an order that no longer lets this laboratory record is closed, not missing', async () => {
    as(CUSTODY)
    api.labWorkItems.mockResolvedValue(answer([routed({ accessionId: 'accession-1', accessionNumber: 'ACC-2026-000123' })]))
    api.labAccession.mockResolvedValue(accession([specimen('required')]))
    api.transitionSpecimen.mockRejectedValue(problem(404, 'LAB_SPECIMEN_NOT_FOUND', 'Lab specimen was not found'))
    renderDept(<Laboratory />)
    await openRecord()
    fireEvent.click(await screen.findByRole('button', { name: 'Collect sample' }))
    const form = screen.getByRole('form', { name: 'Collect sample' })
    fireEvent.click(within(form).getByRole('button', { name: 'Collect sample' }))
    expect((await within(form).findByRole('alert')).textContent).toBe('This order from another facility no longer lets you record on it: '
      + 'it has ended, or its time for work is over. You can still read what was recorded. Refresh the list.')
  })

  it('shows an accession on an ended order to be read only', async () => {
    as(CUSTODY)
    api.labWorkItems.mockResolvedValue(answer([routed({ accessionId: 'accession-1', accessionNumber: 'ACC-2026-000123',
      orderRoute: routeCard({ effectiveState: 'cancelled', access: 'read', endedKind: 'order_changed' }) as LabWorkItem['orderRoute'] })]))
    api.labAccession.mockResolvedValue(accession([specimen('required')]))
    renderDept(<Laboratory />)
    await openRecord()
    await screen.findByRole('heading', { name: 'Sample SPC-000123' })
    expect(screen.getByText('This order from another facility has ended, so nothing more can be recorded on it. You can still read what was recorded.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Collect sample' })).toBeNull()
  })

  it('says work on orders from other facilities is paused', async () => {
    api.labWorkItems.mockResolvedValue(answer([routed()], { crossFacilityWork: false }))
    renderDept(<Laboratory />)
    expect(await screen.findByText('Work on orders from other facilities is paused by Health ID.')).toBeTruthy()
  })

  it('shows Incoming at a laboratory that receives orders, and reads it', async () => {
    as(RECEIVE)
    api.labWorkItems.mockResolvedValue(answer([local]))
    renderDept(<Laboratory />)
    expect(await screen.findByRole('heading', { name: /^Incoming/ })).toBeTruthy()
    expect(routes.incoming).toHaveBeenCalledWith(DEMO_LABORATORY_ID, 'lab', undefined)
  })

  it('shows Incoming to nobody without the receive permission', async () => {
    as(ACCESSION)
    api.labWorkItems.mockResolvedValue(answer([local]))
    renderDept(<Laboratory />)
    await screen.findByRole('button', { name: 'Malaria parasite' })
    expect(screen.queryByRole('heading', { name: /^Incoming/ })).toBeNull()
    expect(routes.incoming).not.toHaveBeenCalled()
  })

  it('offers “Correct an order that has ended” once the work list says it is served', async () => {
    as(RECEIVE)
    api.labWorkItems.mockResolvedValue(answer([local]))
    renderDept(<Laboratory />)
    expect(await screen.findByText('Correct an order that has ended')).toBeTruthy()
  })
})

describe('ending an order from its record', () => {
  beforeEach(() => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1') })

  it('offers “This isn’t the order’s patient” in Available actions to a member who receives, and nothing to others', async () => {
    as(ACCESSION)
    api.labWorkItems.mockResolvedValue(answer([routed()]))
    const { unmount } = renderDept(<Laboratory />)
    await openRecord()
    expect(within(cardOf('Available actions')).queryByRole('button', { name: new RegExp(`^${WP}`) })).toBeNull()
    unmount()
    as(RECEIVE)
    renderDept(<Laboratory />)
    await openRecord()
    expect(await within(cardOf('Available actions')).findByRole('button', { name: WP })).toBeTruthy()
    expect(within(cardOf('Available actions')).queryByRole('button', { name: new RegExp(`^${CC}`) })).toBeNull()
  })

  it('ends an order it can’t complete, then says so above the list with focus on it', async () => {
    as(RECEIVE)
    api.labWorkItems.mockResolvedValueOnce(answer([routed(), local], { cannotComplete: true }))
      .mockResolvedValue(answer([local], { cannotComplete: true }))
    routes.cannotComplete.mockResolvedValue({ route: { id: ROUTE_ID, version: 4, effectiveState: 'cancelled', endedKind: 'receiving_unable' },
      reason: 'supplies_unavailable', readUntil: new Date(Date.now() - 1000).toISOString(), specimensCollected: 0, resultsRecorded: 0,
      criticalCandidates: 0, replayed: false })
    renderDept(<Laboratory />)
    await openRecord()
    const actions = cardOf('Available actions')
    fireEvent.click(await within(actions).findByRole('button', { name: `${CC}: Haemoglobin, Ref 9C1B2D3E` }))
    const form = within(actions).getByRole('form', { name: 'End this order: we can’t complete it' })
    fireEvent.click(within(form).getByRole('radio', { name: 'Reagents or test kits have run out' }))
    fireEvent.click(within(form).getByRole('checkbox', { name: /^The person we accepted this/ }))
    fireEvent.click(within(form).getByRole('button', { name: 'End it: we can’t complete it' }))
    const ended = await screen.findByText(/^Ended: Haemoglobin, reference 9C1B2D3E\./)
    expect(screen.getByRole('heading', { level: 1, name: 'Laboratory' })).toBeTruthy()
    expect(document.activeElement).toBe(ended)
    expect(routes.cannotComplete).toHaveBeenCalledWith(DEMO_LABORATORY_ID, 'lab', { id: ROUTE_ID, version: 3 },
      { reason: 'supplies_unavailable', confirmedPatient: true }, expect.any(String))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Haemoglobin' })).toBeNull())
  })

  it('ends an order accepted for the wrong person, then says so above the list', async () => {
    as(RECEIVE)
    api.labWorkItems.mockResolvedValueOnce(answer([routed(), local])).mockResolvedValue(answer([local]))
    routes.reportWrongPatient.mockResolvedValue({ route: { id: ROUTE_ID, version: 4, effectiveState: 'cancelled', endedKind: 'wrong_patient' },
      resultsVoided: 0, resultReportsMarked: 0, dispensingReversed: false, replayed: false })
    renderDept(<Laboratory />)
    await openRecord()
    const actions = cardOf('Available actions')
    fireEvent.click(await within(actions).findByRole('button', { name: WP }))
    fireEvent.click(within(actions).getByRole('radio', { name: 'I picked another patient’s order from the list' }))
    fireEvent.change(within(actions).getByLabelText('What happened, for Health ID support'), { target: { value: 'Wrong order picked' } })
    fireEvent.click(within(actions).getByRole('checkbox', { name: 'The person I accepted this order for is not Patient One.' }))
    fireEvent.click(within(actions).getByRole('button', { name: 'End this order' }))
    const ended = await screen.findByText(/^Ended: Haemoglobin, reference 9C1B2D3E\. Patient One is told in the Health ID app\./)
    expect(screen.getByRole('heading', { level: 1, name: 'Laboratory' })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(ended))
    expect(routes.reportWrongPatient).toHaveBeenCalledWith(DEMO_LABORATORY_ID, 'lab', { id: ROUTE_ID, version: 3 },
      { reason: 'wrong_order_chosen', note: 'Wrong order picked' }, expect.any(String))
  })

  it('keeps a refusal in the record, with focus, when the list read again no longer offers the form', async () => {
    as(RECEIVE)
    api.labWorkItems.mockResolvedValueOnce(answer([routed()]))
      .mockResolvedValue(answer([routed({ orderRoute: routeCard({ effectiveState: 'cancelled', access: 'read', endedKind: 'order_changed',
        version: 4 }) as LabWorkItem['orderRoute'] })]))
    routes.reportWrongPatient.mockRejectedValueOnce(problem(409, 'ORDER_ROUTE_ALREADY_ENDED', 'Ended'))
    renderDept(<Laboratory />)
    await openRecord()
    const actions = cardOf('Available actions')
    fireEvent.click(await within(actions).findByRole('button', { name: WP }))
    fireEvent.click(within(actions).getByRole('radio', { name: 'I picked another patient’s order from the list' }))
    fireEvent.change(within(actions).getByLabelText('What happened, for Health ID support'), { target: { value: 'Wrong order picked' } })
    fireEvent.click(within(actions).getByRole('checkbox', { name: 'The person I accepted this order for is not Patient One.' }))
    fireEvent.click(within(actions).getByRole('button', { name: 'End this order' }))
    const said = await waitFor(() => {
      const element = document.getElementById('lab-w-routed-said')
      if (!element) throw new Error('Not said yet')
      return element
    })
    expect(said.getAttribute('role')).toBe('alert')
    expect(said.textContent).toMatch(/^This order has already ended, so it can’t be ended here\./)
    await waitFor(() => expect(document.activeElement).toBe(said))
    expect(within(recordView()).getByText('Cancelled by Demo Hospital: stop work.')).toBeTruthy()
  })
})
