import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes, useLocation } from 'react-router-dom'
import { HidApiError } from '@hid/http'
import type { LabAccession, LabExecution, LabResult, LabResultRevision, LabSpecimen, LabWorkItem } from '../../../../staff/api'
import { forgetReceiving } from '../../../../staff/orderRoutes'
import { forgetCannotCompleteServed } from '../../../../cannotCompleteServed'
import { forgetLateCorrectionServed } from '../../../../lateCorrectionServed'
import { forgetWrongPatientServed } from '../../../../wrongPatientServed'
import { Laboratory } from '../../../../ehr-blue/departments/laboratory/Laboratory'
import { labPages, laboratoryPage } from '../../../../ehr-blue/departments/laboratory/page'
import { DEMO_LABORATORY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'

/**
 * The Laboratory's work list and requests as the owner rebuilt them (laboratory/work by stage tabs, a request at
 * laboratory/work/:id with the one step to do now, each save that names the patient confirmed first), over today's Lab
 * API. Every request, permission check and refusal path is today's Laboratory page's.
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

const commerceApi = vi.hoisted(() => ({} as Record<string, (...args: never[]) => unknown>))
vi.mock('../../../../ehr-blue/departments/commerce/api', async importOriginal => {
  const { commerceMock } = await import('../harness')
  return { ...(await importOriginal<object>()), commerce: commerceMock(commerceApi) }
})
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
const DENIED = 'You can’t see lab results for this patient right now. They stay hidden until your access is back.'
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

/** The work list's address in the frame; a request opens below it. */
const WORK_LIST = '/provider/laboratory/work'

/** The router's address, shown for the test: where the page put the user. */
function Where() {
  return <output data-testid="where" hidden>{useLocation().pathname}{useLocation().search}</output>
}
const where = () => screen.getByTestId('where').textContent

function renderPage(route = WORK_LIST) {
  return renderDept(<><Laboratory /><Where /></>, { route })
}

/** A request's card button, named by its next action, then who and which tests. */
function cardButton(test: string) {
  return screen.getByRole('button', { name: new RegExp(`, ${test}$`) })
}
async function findCard(test: string) {
  return screen.findByRole('button', { name: new RegExp(`, ${test}$`) })
}

/** A card of the record, by its heading. */
function cardOf(heading: string | RegExp) {
  return screen.getByRole('heading', { name: heading }).closest('section') as HTMLElement
}

/** The stage card's body: what to do now. */
function stageCard() {
  return document.getElementById('lab-stage-title')!.closest('section') as HTMLElement
}

/** Where an order from another facility came from, on the open request. */
const routedLines = () => document.querySelector('.hid-ehr-dept-laboratory-routed') as HTMLElement

/** The request's facts, by term. */
function requestFacts() {
  return Object.fromEntries([...cardOf('Request').querySelectorAll('dt')].map(term => [term.textContent, term.nextElementSibling?.textContent]))
}

async function openRecord(test = 'Haemoglobin') {
  fireEvent.click(await findCard(test))
  await screen.findByRole('heading', { level: 1, name: test })
}

/** Renders the page as `permissions`, opens the accessioned work and waits for its record to be read. */
async function openAccession(permissions: string[], value: LabAccession, item: LabWorkItem = accessioned) {
  as(permissions)
  api.labWorkItems.mockResolvedValue({ items: [item] })
  api.labAccession.mockResolvedValue(value)
  renderPage()
  await openRecord()
  await waitFor(() => expect(api.labAccession).toHaveBeenCalledWith(DEMO_LABORATORY_ID, 'accession-1'))
  await waitFor(() => expect(within(stageCard()).queryByText('Loading…')).toBeNull())
}

/** What each alert in `scope` says. */
const alertsIn = (scope: HTMLElement) => within(scope).queryAllByRole('alert').map(alert => alert.textContent ?? '')

/** Presses a button as a pointer does: it takes focus first, which a confirm sheet gives back as it closes. */
function press(button: HTMLElement) {
  button.focus()
  fireEvent.click(button)
}

async function refusalOf(control: HTMLElement) {
  await waitFor(() => expect(control.getAttribute('aria-invalid')).toBe('true'))
  return document.getElementById(control.getAttribute('aria-describedby') ?? '')?.textContent
}

/** Answers a confirm sheet, by its title, with its confirm (or Cancel). */
async function answerSheet(title: string, answer: string) {
  const sheet = await screen.findByRole('dialog', { name: title })
  await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: answer })) })
  return sheet
}

beforeEach(() => {
  for (const key of Object.keys(commerceApi)) delete commerceApi[key]
  vi.clearAllMocks()
  unprovided.clear()
  as(WORK)
  api.labWorkItems.mockResolvedValue({ items: [] })
  api.labExecutions.mockResolvedValue({ items: [] })
  routes.incoming.mockResolvedValue({ items: [], crossFacilityOrders: true, crossFacilityWork: true })
  forgetReceiving(); forgetCannotCompleteServed(); forgetLateCorrectionServed(); forgetWrongPatientServed()
})
afterEach(() => {
  // Nothing outside the provided staff API members was reached for, and nothing kept in the browser.
  expect([...unprovided]).toEqual([])
  expect(window.localStorage.length).toBe(0)
  expect(window.sessionStorage.length).toBe(0)
  vi.unstubAllEnvs()
  forgetReceiving(); forgetCannotCompleteServed(); forgetLateCorrectionServed(); forgetWrongPatientServed()
})

describe('the page entries', () => {
  it('keeps the hospital’s Laboratory entry, with today’s refusal at its address', () => {
    expect(laboratoryPage).toMatchObject({ path: 'laboratory', group: 'Diagnostics', label: 'Laboratory', permission: 'lab.work-item.read', status: 'live' })
    renderDept(<>{laboratoryPage.refusal}</>)
    expect(screen.getByRole('heading', { level: 1, name: 'Laboratory unavailable' })).toBeTruthy()
    expect(screen.getByText('This facility membership needs lab work-item read permission.')).toBeTruthy()
  })

  it('lists the lab’s pages in order, each with the permission it needs', () => {
    expect(labPages.filter(page => page.listed === undefined).map(page => [page.path, page.label, page.permission])).toEqual([
      ['laboratory/new', 'New request', 'lab.walk-in.create'],
      ['laboratory/work/*', 'Work list', 'lab.work-item.read'],
      ['laboratory/results/*', 'Results', 'lab.work-item.read'],
      ['laboratory/tests', 'Tests & prices', 'billing.catalogue.read'],
      ['laboratory/till', 'Till / End of day', 'billing.shift.own'],
      ['laboratory/settings', 'Payment setup', 'billing.settings.manage'],
    ])
  })

  it.each([
    ['/provider/laboratory', WORK_LIST],
    ['/provider/laboratory?work=work-item-1', `${WORK_LIST}/work-item-1`],
  ])('takes the old address %s to %s', (from, to) => {
    renderDept(<Routes><Route path="/provider/laboratory" element={laboratoryPage.element} /><Route path="*" element={<Where />} /></Routes>, { route: from })
    expect(where()).toBe(to)
  })
})

describe('access', () => {
  it('says the membership cannot open the work list without lab work-item read permission, and reads nothing', () => {
    as(['lab.accession.read', 'lab.execution.read', 'lab.result.verify'])
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Work list' })).toBeTruthy()
    expect(screen.getByText('You can’t open the lab here')).toBeTruthy()
    expect(screen.getByText('Your role needs permission to see lab work.')).toBeTruthy()
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(api.labWorkItems).not.toHaveBeenCalled()
  })

  it('reads nothing without a working facility, nor a request opened by its address', () => {
    session.facility = undefined
    renderPage(`${WORK_LIST}/work-item-1`)
    expect(screen.getByText('You can’t open the lab here')).toBeTruthy()
    expect(api.labWorkItems).not.toHaveBeenCalled()
    expect(api.labAccession).not.toHaveBeenCalled()
  })
})

describe('the work list', () => {
  it('says it is loading while the work list is read, with Refresh busy but focusable', async () => {
    const pending = deferred<{ items: LabWorkItem[] }>()
    api.labWorkItems.mockReturnValue(pending.promise)
    renderPage()
    expect(screen.getByRole('status', { name: 'Loading the work list' })).toBeTruthy()
    const refresh = screen.getByRole('button', { name: 'Refresh' })
    expect(refresh.getAttribute('aria-disabled')).toBe('true')
    expect(refresh.getAttribute('aria-busy')).toBe('true')
    expect((refresh as HTMLButtonElement).disabled).toBe(false)
    // A press while it reads does nothing.
    fireEvent.click(refresh)
    expect(api.labWorkItems).toHaveBeenCalledTimes(1)
    expect(api.labWorkItems).toHaveBeenCalledWith(DEMO_LABORATORY_ID)
    await act(async () => { pending.resolve({ items: [workItem()] }) })
    expect(await findCard('Haemoglobin')).toBeTruthy()
    expect(screen.queryByRole('status', { name: 'Loading the work list' })).toBeNull()
    expect(refresh.getAttribute('aria-disabled')).toBeNull()
  })

  it('says there is no lab work yet, and reads the list again from its Refresh', async () => {
    renderPage()
    expect(await screen.findByText('Nothing in Waiting for sample')).toBeTruthy()
    expect(screen.getByText('New requests show here.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    api.labWorkItems.mockResolvedValue({ items: [workItem()] })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await findCard('Haemoglobin')).toBeTruthy()
    expect(api.labWorkItems).toHaveBeenCalledTimes(2)
  })

  it('shows the refusal, not the empty state, and recovers from Try again', async () => {
    api.labWorkItems.mockRejectedValueOnce(problem(503, 'SERVICE_UNAVAILABLE', 'The service is temporarily unavailable. Please try again shortly.'))
    api.labWorkItems.mockResolvedValue({ items: [workItem()] })
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Couldn’t load the work list')).toBeTruthy()
    expect(within(alert).getByText('The service is temporarily unavailable. Please try again shortly.')).toBeTruthy()
    expect(screen.queryByText('Nothing in Waiting for sample')).toBeNull()
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await findCard('Haemoglobin')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says the module is not in service when the gateway has no Lab route', async () => {
    api.labWorkItems.mockRejectedValue(problem(404, 'API_ROUTE_NOT_FOUND', 'Not found'))
    renderPage()
    expect((await screen.findByRole('alert')).textContent).toMatch(/This workspace is not in service on this Health ID deployment/)
  })

  it('shows each request as a card with its one next action, masked patients only', async () => {
    const other = 'b0000000-0000-4000-8000-00000071d3a8'
    api.labWorkItems.mockResolvedValue({ items: [workItem(), workItem({ id: 'work-item-2', patientId: other, testName: 'Serum ferritin',
      accessionId: 'accession-2', accessionNumber: 'ACC-2026-000124' }), workItem({ id: 'abcdef12-3456', testName: undefined })] })
    renderPage()
    const first = await findCard('Haemoglobin')
    expect(first.getAttribute('type')).toBe('button')
    expect(first.textContent).toBe(`Collect sample: ${MASKED}, Haemoglobin`)
    const card = first.closest('li')!
    expect(within(card).getByText(MASKED)).toBeTruthy()
    expect(within(card).getByText('Haemoglobin')).toBeTruthy()
    expect(within(card).getByText(/^Waiting /)).toBeTruthy()
    expect(cardButton('Serum ferritin').textContent).toBe('Collect sample: Patient ••••71d3a8, Serum ferritin')
    expect(cardButton('Lab test')).toBeTruthy()
    expect(document.body.innerHTML).not.toContain(PATIENT)
    expect(document.body.innerHTML).not.toContain(other)
  })

  it('sorts urgent work first and marks it, then the longest waiting', async () => {
    api.labWorkItems.mockResolvedValue({ items: [workItem({ id: 'w-old', testName: 'Old', acceptedAt: '2026-10-09T07:00:00.000Z' }),
      workItem({ id: 'w-new', testName: 'New', acceptedAt: '2026-10-09T09:00:00.000Z' }),
      workItem({ id: 'w-urgent', testName: 'Urgent one', priority: 'urgent', acceptedAt: '2026-10-09T10:00:00.000Z' })] })
    renderPage()
    await findCard('Old')
    const list = screen.getByRole('list', { name: 'Waiting for sample' })
    expect(within(list).getAllByRole('listitem').map(item => within(item).getByRole('button').textContent?.split(', ').at(-1))).toEqual(['Urgent one', 'Old', 'New'])
    expect(within(cardButton('Urgent one').closest('li')!).getByText('Urgent')).toBeTruthy()
  })

  it('puts each request under its stage, opens on the first with work waiting, and keeps the stage in the address', async () => {
    api.labWorkItems.mockResolvedValue({ items: [workItem({ id: 'w-testing', testName: 'Received test', accessionId: 'accession-9', specimenStatuses: ['received'] }),
      workItem({ id: 'w-collected', testName: 'Collected test', accessionId: 'accession-8', specimenStatuses: ['collected'] })] })
    renderPage()
    await findCard('Received test')
    const stages = screen.getByRole('navigation', { name: 'Stage' })
    expect(within(stages).getAllByRole('button').map(stage => [stage.textContent, stage.getAttribute('aria-pressed')])).toEqual([
      ['Waiting for sample0', 'false'], ['Testing2', 'true'], ['Enter results0', 'false'], ['Check & release0', 'false'], ['Done0', 'false']])
    expect(cardButton('Collected test').textContent).toMatch(/^Receive sample:/)
    expect(cardButton('Received test').textContent).toMatch(/^Start test:/)
    fireEvent.click(within(stages).getByRole('button', { name: /^Waiting for sample/ }))
    expect(where()).toBe(`${WORK_LIST}?stage=collect`)
    expect(screen.getByText('Nothing in Waiting for sample')).toBeTruthy()
  })

  it('searches what is listed, and says when nothing matches', async () => {
    api.labWorkItems.mockResolvedValue({ items: [workItem(), workItem({ id: 'work-item-2', testName: 'Serum ferritin', accessionNumber: 'ACC-2026-000124' })] })
    renderPage()
    await findCard('Haemoglobin')
    const search = screen.getByRole('searchbox', { name: 'Search the work list' })
    expect(search.getAttribute('placeholder')).toBe('Name, phone, test or number')
    fireEvent.change(search, { target: { value: 'ferr' } })
    expect(screen.queryByRole('button', { name: /, Haemoglobin$/ })).toBeNull()
    expect(cardButton('Serum ferritin')).toBeTruthy()
    fireEvent.change(search, { target: { value: '000124' } })
    expect(cardButton('Serum ferritin')).toBeTruthy()
    fireEvent.change(search, { target: { value: 'urea' } })
    expect(screen.getByText('Nothing matches')).toBeTruthy()
    expect(screen.getByText('Check the spelling, or try another stage.')).toBeTruthy()
    expect(api.labWorkItems).toHaveBeenCalledTimes(1)
  })

  it('says when the backend cut the list short at 200, and nothing of the kind below it', async () => {
    api.labWorkItems.mockResolvedValue({ items: Array.from({ length: 200 }, (_, index) => workItem({ id: `work-${index}` })) })
    const { unmount } = renderPage()
    expect(await screen.findByText(CAP)).toBeTruthy()
    unmount()
    api.labWorkItems.mockResolvedValue({ items: [workItem()] })
    renderPage()
    await findCard('Haemoglobin')
    expect(screen.queryByText(CAP)).toBeNull()
  })
})

describe('the request', () => {
  it('opens at its own address with one heading, focus on it, and goes back to the list with focus on its card', async () => {
    api.labWorkItems.mockResolvedValue({ items: [workItem()] })
    renderPage()
    await openRecord()
    expect(screen.getAllByRole('heading', { level: 1 }).map(heading => heading.textContent)).toEqual(['Haemoglobin'])
    await waitFor(() => expect(document.activeElement?.id).toBe('lab-record-title'))
    // Only the work item's id is in the address, never anything about the patient.
    expect(where()).toBe(`${WORK_LIST}/work-item-1`)
    expect(screen.getByRole('region', { name: `Patient: ${MASKED}` }).textContent).toContain('Health ID not sent')
    const progress = screen.getByRole('list', { name: 'Progress' })
    expect(within(progress).getAllByRole('listitem').find(step => step.getAttribute('aria-current') === 'step')?.textContent).toBe('Waiting for sample, now')
    fireEvent.click(screen.getByRole('link', { name: 'Back to the work list' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Work list' })).toBeTruthy()
    expect(where()).toBe(`${WORK_LIST}?stage=collect`)
    await waitFor(() => expect(document.activeElement).toBe(cardButton('Haemoglobin')))
  })

  it('opens straight from its address, as a shared link or a refresh would', async () => {
    api.labWorkItems.mockResolvedValue({ items: [workItem()] })
    renderPage(`${WORK_LIST}/work-item-1`)
    expect(await screen.findByRole('heading', { level: 1, name: 'Haemoglobin' })).toBeTruthy()
  })

  it('goes back to the list when its address names work the list doesn’t hold', async () => {
    api.labWorkItems.mockResolvedValue({ items: [workItem()] })
    renderPage(`${WORK_LIST}/work-item-9`)
    await waitFor(() => expect(where()).toBe(WORK_LIST))
    expect(screen.getByRole('heading', { level: 1, name: 'Work list' })).toBeTruthy()
  })

  it('shows what is known of the request, and nothing to do to a member who may only read', async () => {
    api.labWorkItems.mockResolvedValue({ items: [workItem({ priority: 'routine' })] })
    renderPage()
    await openRecord()
    expect(Object.keys(requestFacts())).toEqual(['Test', 'Priority', 'Waiting'])
    expect(requestFacts()).toMatchObject({ Test: 'Haemoglobin', Priority: 'Routine' })
    expect(within(stageCard()).getByText('Your role can’t collect samples. Ask a colleague who can.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Collect sample' })).toBeNull()
  })
})

describe('collecting the first sample (the accession is made with it)', () => {
  async function openCollect(permissions = [...ACCESSION, 'lab.specimen.collect']) {
    as(permissions)
    api.labWorkItems.mockResolvedValue({ items: [workItem()] })
    renderPage()
    await openRecord()
    return stageCard()
  }
  const sampleBox = () => screen.getByRole('textbox', { name: 'Sample' })
  const reasonBox = () => screen.getByRole('textbox', { name: 'Why the test' })

  it('asks for the sample and why the test is done before anything is sent', async () => {
    const card = await openCollect()
    fireEvent.click(within(card).getByRole('button', { name: 'Collect sample' }))
    expect(await refusalOf(sampleBox())).toBe('Choose or type the sample, like Blood.')
    expect(document.activeElement).toBe(sampleBox())
    // A common sample is one press away.
    const blood = within(screen.getByRole('group', { name: 'Common samples' })).getByRole('button', { name: 'Blood' })
    fireEvent.click(blood)
    expect(blood.getAttribute('aria-pressed')).toBe('true')
    expect((sampleBox() as HTMLInputElement).value).toBe('Blood')
    fireEvent.click(within(card).getByRole('button', { name: 'Collect sample' }))
    expect(await refusalOf(reasonBox())).toBe('Say why the test is done, as on the request.')
    expect(document.activeElement).toBe(reasonBox())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.createLabAccession).not.toHaveBeenCalled()
    expect(api.transitionSpecimen).not.toHaveBeenCalled()
  })

  it('asks to confirm the patient, and sends nothing when cancelled', async () => {
    const card = await openCollect()
    fireEvent.change(sampleBox(), { target: { value: 'Venous blood' } })
    fireEvent.change(reasonBox(), { target: { value: 'Suspected anaemia' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Collect sample' }))
    const sheet = await screen.findByRole('dialog', { name: 'Collect the sample' })
    expect(within(sheet).getByRole('region', { name: `Patient: ${MASKED}` })).toBeTruthy()
    expect(within(sheet).getByText('Check the name with the person before you take it.')).toBeTruthy()
    await answerSheet('Collect the sample', 'Cancel')
    expect(api.createLabAccession).not.toHaveBeenCalled()
  })

  it('makes the accession, collects its sample, reads it by its new id, says so, and moves focus to the label', async () => {
    const created = { ...accession([specimen('required', { id: 'specimen-7', specimenIdentifier: 'SPC-000777' })]), id: 'accession-7',
      accessionNumber: 'ACC-2026-000777' }
    api.createLabAccession.mockResolvedValue(created)
    api.transitionSpecimen.mockResolvedValue(specimen('collected', { id: 'specimen-7', specimenIdentifier: 'SPC-000777', version: 3 }))
    api.labAccession.mockResolvedValue({ ...created, specimens: [specimen('collected', { id: 'specimen-7', specimenIdentifier: 'SPC-000777', version: 3 })] })
    const card = await openCollect()
    api.labWorkItems.mockResolvedValue({ items: [workItem({ accessionId: 'accession-7', accessionNumber: 'ACC-2026-000777', specimenStatuses: ['collected'] })] })
    fireEvent.change(sampleBox(), { target: { value: ' Venous blood ' } })
    fireEvent.change(reasonBox(), { target: { value: ' Suspected anaemia ' } })
    fireEvent.change(screen.getByRole('textbox', { name: /^Collection notes/ }), { target: { value: ' Left arm ' } })
    press(within(card).getByRole('button', { name: 'Collect sample' }))
    await answerSheet('Collect the sample', 'Collect sample')
    await waitFor(() => expect(api.labAccession).toHaveBeenCalledWith(DEMO_LABORATORY_ID, 'accession-7'))
    expect(api.createLabAccession).toHaveBeenCalledWith(DEMO_LABORATORY_ID, 'work-item-1', 'Venous blood', 'Suspected anaemia')
    expect(api.transitionSpecimen).toHaveBeenCalledWith(DEMO_LABORATORY_ID, 'accession-7', created.specimens[0], 'collect', 'Left arm')
    expect(api.createLabAccession.mock.invocationCallOrder[0]).toBeLessThan(api.transitionSpecimen.mock.invocationCallOrder[0]!)
    expect(await screen.findByText('Sample collected. Print the label.')).toBeTruthy()
    const label = await screen.findByRole('button', { name: 'Print label' })
    await waitFor(() => expect(document.activeElement).toBe(label))
    expect(document.getElementById('lab-stage-title')?.textContent).toBe('Testing')
    expect(requestFacts()['Sample number']).toBe('ACC-2026-000777')
    await waitFor(() => expect(api.labWorkItems).toHaveBeenCalledTimes(2))
    expect(document.body.innerHTML).not.toContain(PATIENT)
  })

  it('shows the service’s refusal of the accession where the step is, and collects nothing', async () => {
    api.createLabAccession.mockRejectedValue(problem(409, 'LAB_WORK_ITEM_NOT_ACCESSIONABLE', 'Lab work item is not accessionable at this facility'))
    const card = await openCollect()
    fireEvent.change(sampleBox(), { target: { value: 'Venous blood' } })
    fireEvent.change(reasonBox(), { target: { value: 'Suspected anaemia' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Collect sample' }))
    await answerSheet('Collect the sample', 'Collect sample')
    expect((await within(card).findByRole('alert')).textContent).toContain('Lab work item is not accessionable at this facility')
    expect(api.labAccession).not.toHaveBeenCalled()
    expect(api.transitionSpecimen).not.toHaveBeenCalled()
  })

  it('makes nothing twice: a retry after the collect failed collects on the accession already made', async () => {
    const created = { ...accession([specimen('required')]), id: 'accession-7' }
    api.createLabAccession.mockResolvedValue(created)
    api.transitionSpecimen.mockRejectedValueOnce(problem(503, 'SERVICE_UNAVAILABLE', 'The service is temporarily unavailable.'))
      .mockResolvedValue(specimen('collected', { version: 3 }))
    api.labAccession.mockResolvedValue({ ...created, specimens: [specimen('collected', { version: 3 })] })
    const card = await openCollect()
    fireEvent.change(sampleBox(), { target: { value: 'Venous blood' } })
    fireEvent.change(reasonBox(), { target: { value: 'Suspected anaemia' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Collect sample' }))
    await answerSheet('Collect the sample', 'Collect sample')
    expect((await within(card).findByRole('alert')).textContent).toContain('The service is temporarily unavailable.')
    fireEvent.click(within(card).getByRole('button', { name: 'Collect sample' }))
    await answerSheet('Collect the sample', 'Collect sample')
    expect(await screen.findByText('Sample collected. Print the label.')).toBeTruthy()
    expect(api.createLabAccession).toHaveBeenCalledTimes(1)
    expect(api.transitionSpecimen).toHaveBeenCalledTimes(2)
    expect(api.transitionSpecimen).toHaveBeenLastCalledWith(DEMO_LABORATORY_ID, 'accession-7', created.specimens[0], 'collect', '')
  })

  it('is not offered without lab.specimen.collect', async () => {
    await openCollect(ACCESSION)
    expect(within(stageCard()).getByText('Your role can’t collect samples. Ask a colleague who can.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Collect sample' })).toBeNull()
  })
})

describe('the accession', () => {
  it('says it is loading, then shows its sample', async () => {
    const pending = deferred<LabAccession>()
    as(ACCESSION)
    api.labWorkItems.mockResolvedValue({ items: [accessioned] })
    api.labAccession.mockReturnValue(pending.promise)
    renderPage()
    await openRecord()
    expect(within(stageCard()).getByRole('status').textContent).toBe('Loading…')
    await act(async () => { pending.resolve(accession([specimen('required')])) })
    await waitFor(() => expect(within(stageCard()).queryByText('Loading…')).toBeNull())
    expect(requestFacts()['Sample number']).toBe('ACC-2026-000123')
  })

  it('shows a refusal, then recovers from Try again', async () => {
    as(CUSTODY)
    api.labWorkItems.mockResolvedValue({ items: [accessioned] })
    api.labAccession.mockRejectedValueOnce(problem(403, 'LAB_OPERATION_ACCESS_DENIED', 'Lab operation is not authorized'))
      .mockResolvedValue(accession([specimen('required')]))
    renderPage()
    await openRecord()
    const alert = (await screen.findByText('Couldn’t load this request')).closest('[role="alert"]') as HTMLElement
    expect(within(alert).getByText('Lab operation is not authorized')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Collect sample' })).toBeNull()
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: 'Collect sample' })).toBeTruthy()
    expect(alertsIn(stageCard())).toEqual([])
  })

  it('is not read for a member without lab.accession.read', async () => {
    api.labWorkItems.mockResolvedValue({ items: [accessioned] })
    renderPage()
    await openRecord()
    expect(api.labAccession).not.toHaveBeenCalled()
  })
})

describe('sample custody', () => {
  it('collects a sample waiting on its accession, confirmed, reads the record again and says so', async () => {
    const required = specimen('required')
    await openAccession(CUSTODY, accession([required]))
    expect(within(stageCard()).getByText('Venous blood, SPC-000123')).toBeTruthy()
    api.transitionSpecimen.mockResolvedValue(specimen('collected', { version: 3 }))
    api.labAccession.mockResolvedValue(accession([specimen('collected', { version: 3 })]))
    fireEvent.change(screen.getByRole('textbox', { name: /^Collection notes/ }), { target: { value: 'Left arm' } })
    fireEvent.click(within(stageCard()).getByRole('button', { name: 'Collect sample' }))
    await answerSheet('Collect the sample', 'Collect sample')
    await waitFor(() => expect(api.labAccession).toHaveBeenCalledTimes(2))
    expect(api.createLabAccession).not.toHaveBeenCalled()
    expect(api.transitionSpecimen).toHaveBeenCalledWith(DEMO_LABORATORY_ID, 'accession-1', required, 'collect', 'Left arm')
    expect(await screen.findByText('Sample collected. Print the label.')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Receive sample' })).toBeTruthy()
    await waitFor(() => expect(api.labWorkItems).toHaveBeenCalledTimes(2))
  })

  it('shows a version conflict where the step is, and does not read again for it', async () => {
    await openAccession(CUSTODY, accession([specimen('required')]))
    api.transitionSpecimen.mockRejectedValue(problem(412, 'VERSION_CONFLICT', 'Specimen changed since it was loaded'))
    fireEvent.click(within(stageCard()).getByRole('button', { name: 'Collect sample' }))
    await answerSheet('Collect the sample', 'Collect sample')
    expect((await within(stageCard()).findByRole('alert')).textContent).toContain('Specimen changed since it was loaded')
    expect(api.labAccession).toHaveBeenCalledTimes(1)
  })

  it('receives a collected sample with its condition, and offers rejecting it, as granted', async () => {
    const collected = specimen('collected')
    await openAccession(CUSTODY, accession([collected]))
    expect(within(stageCard()).getAllByRole('button').map(button => button.textContent)).toEqual(['Print label', 'Reject sample', 'Receive sample'])
    api.transitionSpecimen.mockResolvedValue(specimen('received', { version: 3 }))
    fireEvent.change(screen.getByRole('textbox', { name: /^Condition on arrival/ }), { target: { value: ' Good ' } })
    fireEvent.click(within(stageCard()).getByRole('button', { name: 'Receive sample' }))
    await waitFor(() => expect(api.transitionSpecimen).toHaveBeenCalledWith(DEMO_LABORATORY_ID, 'accession-1', collected, 'receive', 'Good'))
    expect(await screen.findByText('Sample received. Start the test.')).toBeTruthy()
  })

  it('offers receipt only with lab.specimen.receive', async () => {
    await openAccession([...ACCESSION, 'lab.specimen.collect', 'lab.specimen.reject'], accession([specimen('collected')]))
    expect(within(stageCard()).queryByRole('button', { name: 'Receive sample' })).toBeNull()
    expect(within(stageCard()).getByRole('button', { name: 'Reject sample' })).toBeTruthy()
  })

  it('offers no step without lab.specimen permissions', async () => {
    await openAccession(ACCESSION, accession([specimen('collected')]))
    expect(within(stageCard()).getByText('Your role can’t receive samples.')).toBeTruthy()
    expect(within(stageCard()).queryByRole('button', { name: /sample$/ })).toBeNull()
  })

  it('asks why before rejecting a sample', async () => {
    const collected = specimen('collected')
    await openAccession(CUSTODY, accession([collected]))
    api.transitionSpecimen.mockResolvedValue(specimen('rejected', { version: 3 }))
    fireEvent.click(within(stageCard()).getByRole('button', { name: 'Reject sample' }))
    const reason = screen.getByRole('textbox', { name: 'Why reject it' })
    expect(reason.id).toBe('lab-reject-specimen-1')
    fireEvent.change(reason, { target: { value: '   ' } })
    fireEvent.click(within(stageCard()).getAllByRole('button', { name: 'Reject sample' }).at(-1)!)
    expect(await refusalOf(reason)).toBe('Say why, like “Haemolysed” or “Not labelled”.')
    expect(document.activeElement).toBe(reason)
    expect(api.transitionSpecimen).not.toHaveBeenCalled()
    fireEvent.change(reason, { target: { value: ' Haemolysed ' } })
    fireEvent.click(within(stageCard()).getAllByRole('button', { name: 'Reject sample' }).at(-1)!)
    await waitFor(() => expect(api.transitionSpecimen).toHaveBeenCalledWith(DEMO_LABORATORY_ID, 'accession-1', collected, 'reject', 'Haemolysed'))
    expect(await screen.findByText('Sample rejected.')).toBeTruthy()
  })
})

describe('testing and results', () => {
  async function openReceived(permissions: string[] = PROCESSING) {
    await openAccession(permissions, accession([specimen('received')]), workItem({ accessionId: 'accession-1', accessionNumber: 'ACC-2026-000123', specimenStatuses: ['received'] }))
    if (permissions.includes('lab.execution.read')) await waitFor(() => expect(api.labExecutions).toHaveBeenCalledWith(DEMO_LABORATORY_ID, 'specimen-1'))
    return stageCard()
  }

  it('starts the test on a received sample, asking what is being done first', async () => {
    const received = specimen('received')
    const started = execution({ status: 'in_progress', completedAt: null, version: 1 })
    api.labExecutions.mockResolvedValueOnce({ items: [] }).mockResolvedValue({ items: [started] })
    api.startLabExecution.mockResolvedValue(started)
    const card = await openReceived()
    fireEvent.click(within(card).getByRole('button', { name: 'Start test' }))
    const details = screen.getByRole('textbox', { name: 'What is being done' })
    expect(await refusalOf(details)).toBe('Say what is being done, like “Run on the analyser”.')
    expect(document.activeElement).toBe(details)
    expect([screen.getByRole('textbox', { name: /^Method/ }).id, details.id]).toEqual(['lab-method-specimen-1', 'lab-start-specimen-1'])
    expect(api.startLabExecution).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox', { name: /^Method/ }), { target: { value: 'Analyser' } })
    fireEvent.change(details, { target: { value: ' Routine count ' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Start test' }))
    expect(await screen.findByText('Test started.')).toBeTruthy()
    expect(api.startLabExecution).toHaveBeenCalledWith(DEMO_LABORATORY_ID, received, 'Routine count', 'Analyser')
    expect(await screen.findByRole('button', { name: 'Finish test' })).toBeTruthy()
  })

  it('tells a member who may only read that they can’t start tests', async () => {
    await openReceived([...ACCESSION, 'lab.execution.read'])
    expect(await within(stageCard()).findByText('Your role can’t start tests.')).toBeTruthy()
  })

  it('finishes the test running', async () => {
    const running = execution({ status: 'in_progress', completedAt: null, version: 1 })
    api.labExecutions.mockResolvedValueOnce({ items: [running] }).mockResolvedValue({ items: [execution()] })
    api.completeLabExecution.mockResolvedValue(execution())
    const card = await openReceived()
    const notes = screen.getByRole('textbox', { name: /^Notes/ })
    expect(notes.id).toBe('lab-finish-execution-1')
    fireEvent.change(notes, { target: { value: 'Run passed QC' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Finish test' }))
    expect(await screen.findByText('Test finished. Enter the result.')).toBeTruthy()
    expect(api.completeLabExecution).toHaveBeenCalledWith(DEMO_LABORATORY_ID, running, 'Run passed QC')
  })

  it('enters a result: a number with its unit, its flag from the range, confirmed against the patient', async () => {
    const completed = execution()
    api.labExecutions.mockResolvedValue({ items: [completed] })
    api.enterLabResult.mockResolvedValue(draftResult())
    await openReceived()
    expect(document.getElementById('lab-stage-title')?.textContent).toBe('Enter results')
    const form = screen.getByRole('form', { name: 'Enter result: Hemoglobin' })
    const value = within(form).getByRole('spinbutton', { name: 'Result' })
    expect([value, within(form).getByRole('textbox', { name: 'Unit' }), within(form).getByRole('textbox', { name: /^Normal range/ }),
      within(form).getByRole('combobox', { name: 'Flag' })].map(control => control.id))
      .toEqual(['lab-value-execution-1', 'lab-unit-execution-1', 'lab-range-execution-1', 'lab-flag-execution-1'])
    fireEvent.click(within(form).getByRole('button', { name: 'Save result' }))
    expect(await refusalOf(value)).toBe('Enter a number.')
    expect(document.activeElement).toBe(value)
    fireEvent.change(value, { target: { value: '7.1' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save result' }))
    // A number without its unit can't be read safely: nothing is sent.
    expect(await refusalOf(within(form).getByRole('textbox', { name: 'Unit' }))).toBe('Enter the unit, like g/dL or mmol/L.')
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.change(within(form).getByRole('textbox', { name: 'Unit' }), { target: { value: 'g/dL' } })
    fireEvent.change(within(form).getByRole('textbox', { name: /^Normal range/ }), { target: { value: '12.0-15.5' } })
    expect((within(form).getByRole('combobox', { name: 'Flag' }) as HTMLSelectElement).value).toBe('low')
    expect(within(form).getByText('Set from the normal range. You can change it.')).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Save result' }))
    const sheet = await screen.findByRole('dialog', { name: 'Save the result' })
    expect(within(sheet).getByRole('region', { name: `Patient: ${MASKED}` })).toBeTruthy()
    expect(api.enterLabResult).not.toHaveBeenCalled()
    await answerSheet('Save the result', 'Save result')
    expect(await screen.findByText('Result saved. Next: check and release.')).toBeTruthy()
    expect(api.enterLabResult).toHaveBeenCalledWith(DEMO_LABORATORY_ID, completed,
      { resultType: 'numeric', numericValue: 7.1, unit: 'g/dL', referenceRange: '12.0-15.5', abnormalFlag: 'low' })
  })

  it('asks for a text result before saving it', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution()] })
    await openReceived()
    const form = screen.getByRole('form', { name: 'Enter result: Hemoglobin' })
    fireEvent.click(within(within(form).getByRole('radiogroup', { name: 'Kind of result' })).getByRole('radio', { name: 'Text' }))
    const value = within(form).getByRole('textbox', { name: 'Result' })
    expect(value.id).toBe('lab-value-execution-1')
    fireEvent.click(within(form).getByRole('button', { name: 'Save result' }))
    expect(await refusalOf(value)).toBe('Type the result.')
    expect(document.activeElement).toBe(value)
    expect(api.enterLabResult).not.toHaveBeenCalled()
  })

  it('waits for someone who can enter results', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution()] })
    await openReceived(PROCESSING.filter(permission => permission !== 'lab.result.enter'))
    expect(within(stageCard()).getByText('Waiting for someone who can enter results.')).toBeTruthy()
  })

  it('checks a draft result with a note, then releases it, each confirmed', async () => {
    const result = draftResult()
    api.labExecutions.mockResolvedValue({ items: [execution({ result })] })
    api.verifyLabResult.mockResolvedValue(verifiedResult())
    api.releaseLabResult.mockResolvedValue(publishedResult())
    const card = await openReceived()
    expect(within(card).getByText('To check')).toBeTruthy()
    expect(within(card).getByText('7.1')).toBeTruthy()
    expect(within(card).getByText('Normal range 12.0-15.5')).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: 'Check & release' }))
    const sheet = await screen.findByRole('dialog', { name: 'Check & release' })
    expect(within(sheet).getByText(/^Check the Hemoglobin result for/).textContent).toBe(`Check the Hemoglobin result for ${MASKED} and release it to their record?`)
    fireEvent.click(within(sheet).getByRole('button', { name: 'Check & release' }))
    const note = within(sheet).getByRole('textbox', { name: 'What you checked' })
    expect(await refusalOf(note)).toBe('Say what you checked, like “Matches the sample and the range”.')
    expect(api.verifyLabResult).not.toHaveBeenCalled()
    fireEvent.change(note, { target: { value: ' Independent review ' } })
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Check & release' })) })
    expect(await screen.findByText('Hemoglobin released. The patient can see it on their Health ID.')).toBeTruthy()
    expect(api.verifyLabResult).toHaveBeenCalledWith(DEMO_LABORATORY_ID, result, 'Independent review')
    expect(api.releaseLabResult).toHaveBeenCalledWith(DEMO_LABORATORY_ID, verifiedResult(), 'Independent review')
  })

  it('only checks a draft result without lab.result.release, and leaves the release to someone who can', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution({ result: draftResult() })] })
    api.verifyLabResult.mockResolvedValue(verifiedResult())
    const card = await openReceived(PROCESSING.filter(permission => permission !== 'lab.result.release'))
    fireEvent.click(within(card).getByRole('button', { name: 'Check result' }))
    const sheet = await screen.findByRole('dialog', { name: 'Check result' })
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'What you checked' }), { target: { value: 'Review' } })
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Check result' })) })
    expect(await screen.findByText('Hemoglobin checked. Someone who can release it does that next.')).toBeTruthy()
    expect(api.releaseLabResult).not.toHaveBeenCalled()
  })

  it('releases a checked result, and offers no release without lab.result.release', async () => {
    const result = verifiedResult()
    api.labExecutions.mockResolvedValue({ items: [execution({ result })] })
    api.releaseLabResult.mockResolvedValue(publishedResult())
    const card = await openReceived()
    expect(within(card).getByText('Checked, not released')).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: 'Release result' }))
    const sheet = await screen.findByRole('dialog', { name: 'Release result' })
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'What you checked' }), { target: { value: 'Reviewed' } })
    expect(within(sheet).getByRole('textbox', { name: 'What you checked' }).id).toBe('lab-check-note-execution-1')
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Release result' })) })
    expect(await screen.findByText('Hemoglobin released. The patient can see it on their Health ID.')).toBeTruthy()
    expect(api.verifyLabResult).not.toHaveBeenCalled()
    expect(api.releaseLabResult).toHaveBeenCalledWith(DEMO_LABORATORY_ID, result, 'Reviewed')
  })

  it('waits for someone who can release a checked result', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution({ result: verifiedResult() })] })
    const card = await openReceived(PROCESSING.filter(permission => permission !== 'lab.result.release'))
    expect(within(card).getByText('Waiting for someone who can release results.')).toBeTruthy()
    expect(within(card).queryByRole('button', { name: 'Release result' })).toBeNull()
  })

  it('offers to correct a released result only with lab.result.revise-released', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution({ result: publishedResult() })] })
    const card = await openReceived()
    expect(document.getElementById('lab-stage-title')?.textContent).toBe('Done')
    expect(within(card).queryByRole('button', { name: /^Correct/ })).toBeNull()
    expect(within(card).getByRole('link', { name: 'Give result' }).getAttribute('href')).toBe('/provider/laboratory/results/work-item-1')
  })

  it('records a correction of a released result as a new version, with its kind and reason, confirmed', async () => {
    const result = publishedResult()
    const done = execution({ result })
    api.labExecutions.mockResolvedValue({ items: [done] })
    api.correctLabResult.mockResolvedValue(draftResult({ currentVersion: 2 }))
    const card = await openReceived([...PROCESSING, 'lab.result.revise-released'])
    fireEvent.click(within(card).getByRole('button', { name: 'Correct: Hemoglobin' }))
    const form = screen.getByRole('form', { name: 'Correct result: Hemoglobin' })
    expect((within(form).getByRole('spinbutton', { name: 'Result' }) as HTMLInputElement).value).toBe('7.1')
    fireEvent.click(within(form).getByRole('button', { name: 'Save correction' }))
    const reason = within(form).getByRole('textbox', { name: 'Why it is changed' })
    expect(await refusalOf(reason)).toBe('Say why it is changed.')
    expect(document.activeElement).toBe(reason)
    expect(reason.id).toBe('lab-reason-execution-1')
    fireEvent.change(within(form).getByRole('spinbutton', { name: 'Result' }), { target: { value: '7.4' } })
    fireEvent.click(within(within(form).getByRole('radiogroup', { name: 'Type of change' })).getByRole('radio', { name: 'Amendment' }))
    fireEvent.change(reason, { target: { value: ' Transcription error ' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save correction' }))
    await answerSheet('Save the correction', 'Save correction')
    expect(await screen.findByText('Correction saved. Check and release it.')).toBeTruthy()
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
    expect(within(history).getByText('Every version of this result is kept. View the history to read them.')).toBeTruthy()
    expect(api.labResultHistory).not.toHaveBeenCalled()
    const toggle = within(history).getByRole('button', { name: 'View result history' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(toggle.textContent).toBe('Hide result history')
    expect(await within(history).findByText('Version 1 · released')).toBeTruthy()
    expect(within(history).getByText('Version 2 · not released · Transcription error')).toBeTruthy()
    expect(api.labResultHistory).toHaveBeenCalledWith(DEMO_LABORATORY_ID, 'result-1')
    fireEvent.click(within(history).getByRole('button', { name: 'Refresh history' }))
    await waitFor(() => expect(api.labResultHistory).toHaveBeenCalledTimes(2))
  })

  it('reads the record again when the history read is refused', async () => {
    api.labExecutions.mockResolvedValueOnce({ items: [execution({ result: publishedResult() })] })
      .mockRejectedValue(problem(403, 'LAB_EXECUTION_ACCESS_DENIED', 'Lab execution/result access is not authorized'))
    api.labResultHistory.mockRejectedValue(problem(403, 'LAB_RESULT_ACCESS_DENIED', 'Lab result access is not authorized'))
    await openReceived()
    fireEvent.click(within(cardOf(/^Preserved versions & amendments/)).getByRole('button', { name: 'View result history' }))
    expect(await screen.findByText(DENIED)).toBeTruthy()
    expect(api.labExecutions).toHaveBeenCalledTimes(2)
  })

  it('hides every result and says access was denied when the tests’ read is refused', async () => {
    api.labExecutions.mockRejectedValue(problem(403, 'LAB_EXECUTION_ACCESS_DENIED', 'Lab execution/result access is not authorized'))
    await openReceived()
    expect(await screen.findByText(DENIED)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start test' })).toBeNull()
    expect(within(stageCard()).getByRole('button', { name: 'Refresh' })).toBeTruthy()
  })

  it('says it is loading while the tests are read, and offers the step once they are', async () => {
    const pending = deferred<{ items: LabExecution[] }>()
    api.labExecutions.mockReturnValue(pending.promise)
    as(PROCESSING)
    api.labWorkItems.mockResolvedValue({ items: [workItem({ accessionId: 'accession-1', specimenStatuses: ['received'] })] })
    api.labAccession.mockResolvedValue(accession([specimen('received')]))
    renderPage()
    await openRecord()
    await waitFor(() => expect(api.labExecutions).toHaveBeenCalled())
    expect(within(stageCard()).getByRole('status').textContent).toBe('Loading…')
    expect(within(stageCard()).queryByRole('button', { name: 'Start test' })).toBeNull()
    await act(async () => { pending.resolve({ items: [] }) })
    expect(await within(stageCard()).findByRole('button', { name: 'Start test' })).toBeTruthy()
  })

  it('hides the values when a refused check is followed by a refused re-read', async () => {
    api.labExecutions.mockResolvedValueOnce({ items: [execution({ result: draftResult() })] })
      .mockRejectedValue(problem(403, 'LAB_EXECUTION_ACCESS_DENIED', 'Lab execution/result access is not authorized'))
    api.verifyLabResult.mockRejectedValue(problem(403, 'LAB_OPERATION_ACCESS_DENIED', 'Lab operation is not authorized'))
    const card = await openReceived()
    expect(within(card).getByText('7.1')).toBeTruthy()
    fireEvent.click(within(card).getByRole('button', { name: 'Check & release' }))
    const sheet = await screen.findByRole('dialog', { name: 'Check & release' })
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'What you checked' }), { target: { value: 'Review' } })
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Check & release' })) })
    expect(await screen.findByText(DENIED)).toBeTruthy()
    expect(screen.queryByText('7.1')).toBeNull()
    expect(api.labExecutions).toHaveBeenCalledTimes(2)
    expect(api.releaseLabResult).not.toHaveBeenCalled()
  })

  it('does not read again for a refusal answered on its merits (409)', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution({ result: draftResult() })] })
    api.verifyLabResult.mockRejectedValue(problem(409, 'LAB_RESULT_SELF_VERIFICATION', 'The person who entered a result cannot verify it'))
    const card = await openReceived()
    fireEvent.click(within(card).getByRole('button', { name: 'Check & release' }))
    const sheet = await screen.findByRole('dialog', { name: 'Check & release' })
    fireEvent.change(within(sheet).getByRole('textbox', { name: 'What you checked' }), { target: { value: 'Review' } })
    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Check & release' })) })
    expect((await within(card).findByRole('alert')).textContent).toContain('The person who entered a result cannot verify it')
    expect(api.labExecutions).toHaveBeenCalledTimes(1)
    expect(api.releaseLabResult).not.toHaveBeenCalled()
    expect(within(card).getByText('7.1')).toBeTruthy()
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

  it('names the ordering facility and the patient on that card and in the request only', async () => {
    as(ACCESSION)
    api.labWorkItems.mockResolvedValue(answer([routed(), local]))
    renderPage()
    const card = (await findCard('Haemoglobin')).closest('li')!
    expect(within(card).getByText('Patient One')).toBeTruthy()
    expect(within(card).getByText(FROM)).toBeTruthy()
    expect(cardButton('Malaria parasite').closest('li')!.textContent).not.toMatch(/From |Patient One/)
    await openRecord()
    expect(within(routedLines()).getByText(FROM)).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Patient: Patient One' }).textContent).toContain('Health ID ending AAA2')
    expect(requestFacts()['Ordered by']).toBe('Dr Demo Clinician')
  })

  it('asks to check the person before a sample is taken, above Collect sample', async () => {
    as([...ACCESSION, 'lab.specimen.collect'])
    api.labWorkItems.mockResolvedValue(answer([routed()]))
    renderPage()
    await openRecord()
    const check = within(stageCard()).getByText('Check that the person is Patient One before you take a sample.')
    const collect = within(stageCard()).getByRole('button', { name: 'Collect sample' })
    expect(check.compareDocumentPosition(collect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('says to stop work on a cancelled order, and offers no collection on it', async () => {
    as([...ACCESSION, 'lab.specimen.collect'])
    api.labWorkItems.mockResolvedValue(answer([routed({ orderRoute: routeCard({ effectiveState: 'cancelled', access: 'read',
      endedKind: 'order_changed' }) as LabWorkItem['orderRoute'] })]))
    renderPage()
    expect(await screen.findByText('Cancelled by Demo Hospital: stop work.')).toBeTruthy()
    await openRecord()
    expect(within(routedLines()).getByText('Cancelled by Demo Hospital: stop work.')).toBeTruthy()
    expect(screen.getByText('This order from another facility has ended, so nothing more can be recorded on it. You can still read what was recorded.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Collect sample' })).toBeNull()
  })

  it('says a closed order when making the accession is refused as closed', async () => {
    as([...ACCESSION, 'lab.specimen.collect'])
    api.labWorkItems.mockResolvedValue(answer([routed()]))
    api.createLabAccession.mockRejectedValue(problem(409, 'ORDER_ROUTE_CLOSED', 'Closed'))
    renderPage()
    await openRecord()
    fireEvent.change(screen.getByRole('textbox', { name: 'Sample' }), { target: { value: 'Venous blood' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Why the test' }), { target: { value: 'At the counter' } })
    fireEvent.click(within(stageCard()).getByRole('button', { name: 'Collect sample' }))
    await answerSheet('Collect the sample', 'Collect sample')
    await waitFor(() => expect(alertsIn(stageCard())).toContain('Error: This order from another facility is closed: it was '
      + 'cancelled, or its time for work has ended, so nothing more can be recorded on it. Refresh the list.'))
  })

  it('says a step on an order that no longer lets this laboratory record is closed, not missing', async () => {
    as(CUSTODY)
    api.labWorkItems.mockResolvedValue(answer([routed({ accessionId: 'accession-1', accessionNumber: 'ACC-2026-000123', specimenStatuses: ['required'] })]))
    api.labAccession.mockResolvedValue(accession([specimen('required')]))
    api.transitionSpecimen.mockRejectedValue(problem(404, 'LAB_SPECIMEN_NOT_FOUND', 'Lab specimen was not found'))
    renderPage()
    await openRecord()
    fireEvent.click(await within(stageCard()).findByRole('button', { name: 'Collect sample' }))
    await answerSheet('Collect the sample', 'Collect sample')
    await waitFor(() => expect(alertsIn(stageCard())).toContain('Error: This order from another facility no longer lets you '
      + 'record on it: it has ended, or its time for work is over. You can still read what was recorded. Refresh the list.'))
  })

  it('shows an accession on an ended order to be read only', async () => {
    as(CUSTODY)
    api.labWorkItems.mockResolvedValue(answer([routed({ accessionId: 'accession-1', accessionNumber: 'ACC-2026-000123', specimenStatuses: ['required'],
      orderRoute: routeCard({ effectiveState: 'cancelled', access: 'read', endedKind: 'order_changed' }) as LabWorkItem['orderRoute'] })]))
    api.labAccession.mockResolvedValue(accession([specimen('required')]))
    renderPage()
    await openRecord()
    await waitFor(() => expect(api.labAccession).toHaveBeenCalled())
    expect(screen.getByText('This order from another facility has ended, so nothing more can be recorded on it. You can still read what was recorded.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Collect sample' })).toBeNull()
  })

  it('says work on orders from other facilities is paused', async () => {
    api.labWorkItems.mockResolvedValue(answer([routed()], { crossFacilityWork: false }))
    renderPage()
    expect(await screen.findByText('Work on orders from other facilities is paused by Health ID.')).toBeTruthy()
  })

  it('shows Incoming at a laboratory that receives orders, and reads it', async () => {
    as(RECEIVE)
    api.labWorkItems.mockResolvedValue(answer([local]))
    renderPage()
    expect(await screen.findByRole('heading', { name: /^Incoming/ })).toBeTruthy()
    // Incoming asks once it is on the page, in an effect after the heading is drawn.
    await waitFor(() => expect(routes.incoming).toHaveBeenCalledWith(DEMO_LABORATORY_ID, 'lab', undefined))
  })

  it('shows Incoming to nobody without the receive permission', async () => {
    as(ACCESSION)
    api.labWorkItems.mockResolvedValue(answer([local]))
    renderPage()
    await findCard('Malaria parasite')
    expect(screen.queryByRole('heading', { name: /^Incoming/ })).toBeNull()
    expect(routes.incoming).not.toHaveBeenCalled()
  })

  it('offers “Correct an order that has ended” once the work list says it is served', async () => {
    as(RECEIVE)
    api.labWorkItems.mockResolvedValue(answer([local]))
    renderPage()
    expect(await screen.findByText('Correct an order that has ended')).toBeTruthy()
  })
})

describe('ending an order from its request', () => {
  beforeEach(() => { vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1') })

  it('offers “This isn’t the order’s patient” to a member who receives, and nothing to others', async () => {
    as(ACCESSION)
    api.labWorkItems.mockResolvedValue(answer([routed()]))
    const { unmount } = renderPage()
    await openRecord()
    expect(screen.queryByRole('button', { name: new RegExp(`^${WP}`) })).toBeNull()
    unmount()
    as(RECEIVE)
    renderPage()
    await openRecord()
    const button = await screen.findByRole('button', { name: WP })
    expect(button.closest('.hid-ehr-dept-embedded')).toBeTruthy()
    expect(screen.queryByRole('button', { name: new RegExp(`^${CC}`) })).toBeNull()
  })

  it('ends an order it can’t complete, then says so above the list with focus on it', async () => {
    as(RECEIVE)
    api.labWorkItems.mockResolvedValueOnce(answer([routed(), local], { cannotComplete: true }))
      .mockResolvedValue(answer([local], { cannotComplete: true }))
    routes.cannotComplete.mockResolvedValue({ route: { id: ROUTE_ID, version: 4, effectiveState: 'cancelled', endedKind: 'receiving_unable' },
      reason: 'supplies_unavailable', readUntil: new Date(Date.now() - 1000).toISOString(), specimensCollected: 0, resultsRecorded: 0,
      criticalCandidates: 0, replayed: false })
    renderPage()
    await openRecord()
    fireEvent.click(await screen.findByRole('button', { name: `${CC}: Haemoglobin, Ref 9C1B2D3E` }))
    const form = screen.getByRole('form', { name: 'End this order: we can’t complete it' })
    fireEvent.click(within(form).getByRole('radio', { name: 'Reagents or test kits have run out' }))
    fireEvent.click(within(form).getByRole('checkbox', { name: /^The person we accepted this/ }))
    fireEvent.click(within(form).getByRole('button', { name: 'End it: we can’t complete it' }))
    const ended = await screen.findByText(/^Ended: Haemoglobin, reference 9C1B2D3E\./)
    expect(await screen.findByRole('heading', { level: 1, name: 'Work list' })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(ended))
    expect(routes.cannotComplete).toHaveBeenCalledWith(DEMO_LABORATORY_ID, 'lab', { id: ROUTE_ID, version: 3 },
      { reason: 'supplies_unavailable', confirmedPatient: true }, expect.any(String))
    await waitFor(() => expect(screen.queryByRole('button', { name: /, Haemoglobin$/ })).toBeNull())
  })

  it('ends an order accepted for the wrong person, then says so above the list', async () => {
    as(RECEIVE)
    api.labWorkItems.mockResolvedValueOnce(answer([routed(), local])).mockResolvedValue(answer([local]))
    routes.reportWrongPatient.mockResolvedValue({ route: { id: ROUTE_ID, version: 4, effectiveState: 'cancelled', endedKind: 'wrong_patient' },
      resultsVoided: 0, resultReportsMarked: 0, dispensingReversed: false, replayed: false })
    renderPage()
    await openRecord()
    fireEvent.click(await screen.findByRole('button', { name: WP }))
    fireEvent.click(screen.getByRole('radio', { name: 'I picked another patient’s order from the list' }))
    fireEvent.change(screen.getByLabelText('What happened, for Health ID support'), { target: { value: 'Wrong order picked' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'The person I accepted this order for is not Patient One.' }))
    fireEvent.click(screen.getByRole('button', { name: 'End this order' }))
    const ended = await screen.findByText(/^Ended: Haemoglobin, reference 9C1B2D3E\. Patient One is told in the Health ID app\./)
    expect(await screen.findByRole('heading', { level: 1, name: 'Work list' })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(ended))
    expect(routes.reportWrongPatient).toHaveBeenCalledWith(DEMO_LABORATORY_ID, 'lab', { id: ROUTE_ID, version: 3 },
      { reason: 'wrong_order_chosen', note: 'Wrong order picked' }, expect.any(String))
  })

  it('keeps a refusal in the request, with focus, when the list read again no longer offers the form', async () => {
    as(RECEIVE)
    api.labWorkItems.mockResolvedValueOnce(answer([routed()]))
      .mockResolvedValue(answer([routed({ orderRoute: routeCard({ effectiveState: 'cancelled', access: 'read', endedKind: 'order_changed',
        version: 4 }) as LabWorkItem['orderRoute'] })]))
    routes.reportWrongPatient.mockRejectedValueOnce(problem(409, 'ORDER_ROUTE_ALREADY_ENDED', 'Ended'))
    renderPage()
    await openRecord()
    fireEvent.click(await screen.findByRole('button', { name: WP }))
    fireEvent.click(screen.getByRole('radio', { name: 'I picked another patient’s order from the list' }))
    fireEvent.change(screen.getByLabelText('What happened, for Health ID support'), { target: { value: 'Wrong order picked' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'The person I accepted this order for is not Patient One.' }))
    fireEvent.click(screen.getByRole('button', { name: 'End this order' }))
    const said = await waitFor(() => {
      const element = document.getElementById('lab-w-routed-said')
      if (!element) throw new Error('Not said yet')
      return element
    })
    expect(said.getAttribute('role')).toBe('alert')
    expect(said.textContent).toMatch(/This order has already ended, so it can’t be ended here\./)
    await waitFor(() => expect(document.activeElement).toBe(said))
    expect(within(routedLines()).getByText('Cancelled by Demo Hospital: stop work.')).toBeTruthy()
  })
})

/*
 * The patient card on this facility's own work (proposed hid-system 0106; not served today) and the priority Lab already
 * sends: each used when present, and today's screens when absent (the work list's and request's tests above).
 */
describe('the patient and the priority on this facility\'s own work', () => {
  it('names the patient Lab sends on own work, on its card and request, and asks to check them before a sample is taken', async () => {
    as([...ACCESSION, 'lab.specimen.collect'])
    api.labWorkItems.mockResolvedValue({ items: [workItem({ patient: PERSON }), local] })
    renderPage()
    const card = (await findCard('Haemoglobin')).closest('li')!
    expect(within(card).getByText('Patient One')).toBeTruthy()
    expect(card.textContent).not.toContain(MASKED)
    // Work without the card is masked as today.
    expect(cardButton('Malaria parasite').textContent).toMatch(/Patient ••••aa11bb/)
    await openRecord()
    expect(screen.getByRole('region', { name: 'Patient: Patient One' }).textContent).toContain('Health ID ending AAA2')
    expect(within(stageCard()).getByText('Check that the person is Patient One before you take a sample.')).toBeTruthy()
  })

  it('asks no check on own work Lab sends no patient for, as today', async () => {
    as([...ACCESSION, 'lab.specimen.collect'])
    api.labWorkItems.mockResolvedValue({ items: [workItem()] })
    renderPage()
    await openRecord()
    expect(within(stageCard()).queryByText(/^Check that the person is/)).toBeNull()
  })

  it('puts an as-soon-as-possible request first and marks it urgent, as it does stat and urgent ones', async () => {
    api.labWorkItems.mockResolvedValue({ items: [workItem({ id: 'w-old', testName: 'Old', acceptedAt: '2026-10-09T07:00:00.000Z', priority: 'routine' }),
      workItem({ id: 'w-asap', testName: 'Soon one', priority: 'asap', acceptedAt: '2026-10-09T10:00:00.000Z' })] })
    renderPage()
    await findCard('Old')
    const list = screen.getByRole('list', { name: 'Waiting for sample' })
    expect(within(list).getAllByRole('listitem').map(item => within(item).getByRole('button').textContent?.split(', ').at(-1))).toEqual(['Soon one', 'Old'])
    expect(within(cardButton('Soon one').closest('li')!).getByText('Urgent')).toBeTruthy()
    await openRecord('Soon one')
    expect(requestFacts().Priority).toBe('Urgent')
  })
})
