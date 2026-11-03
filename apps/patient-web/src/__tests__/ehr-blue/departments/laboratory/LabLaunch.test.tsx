import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LabAccession, LabSpecimen, LabWorkItem } from '../../../../staff/api'
import { forgetReceiving } from '../../../../staff/orderRoutes'
import { forgetCannotCompleteServed } from '../../../../cannotCompleteServed'
import { forgetLateCorrectionServed } from '../../../../lateCorrectionServed'
import { forgetWrongPatientServed } from '../../../../wrongPatientServed'
import { Laboratory } from '../../../../ehr-blue/departments/laboratory/Laboratory'
import { Results } from '../../../../ehr-blue/departments/laboratory/Results'
import { DEMO_LABORATORY_ID, fakeFacility, renderDept, type FakeFacility } from '../harness'

/*
 * Lab launch readiness: the Laboratory's work list, requests and Results as a real facility meets them, over today's
 * Lab API (hid-system 34d69557). The harness is Laboratory.test.tsx's own (its mocks and fixture builders); the tests
 * live here so the open pull requests changing that file don't meet these. Every person and facility is fictional.
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
const WORK = ['lab.work-item.read']
const ACCESSION = [...WORK, 'lab.accession.create', 'lab.accession.read']
const CUSTODY = [...ACCESSION, 'lab.specimen.collect', 'lab.specimen.receive', 'lab.specimen.reject']

const workItem = (overrides: Partial<LabWorkItem> = {}): LabWorkItem => ({
  id: 'work-item-1', patientId: PATIENT, version: 1, status: 'accepted', testName: 'Haemoglobin',
  accessionId: null, accessionNumber: null, acceptedAt: '2026-10-09T08:00:00.000Z', ...overrides,
})
/** What today's work list sends of a received sample: its accession and its samples' statuses, nothing of its tests. */
const received = (overrides: Partial<LabWorkItem> = {}) => workItem({ accessionId: 'accession-1', accessionNumber: 'ACC-2026-000123',
  specimenStatuses: ['received'], ...overrides })
/** A work item with the stage facts the work list may send beyond today's (proposed, POINT_OF_CARE_SPEC §4). */
type Listed = Partial<LabWorkItem> & { readonly openWork?: boolean; readonly executionStatuses?: readonly string[] }
const listed = (overrides: Listed) => received(overrides as Partial<LabWorkItem>)
const specimen = (status: string, overrides: Partial<LabSpecimen> = {}): LabSpecimen => ({
  id: 'specimen-1', accessionId: 'accession-1', specimenIdentifier: 'SPC-000123', specimenType: 'Venous blood', status, version: 2,
  ...overrides,
})
const accession = (specimens: LabSpecimen[]): LabAccession => ({
  id: 'accession-1', accessionNumber: 'ACC-2026-000123', workItemId: 'work-item-1', status: 'open', specimens,
})

/* Work from an order another facility sent (Demo Hospital), as Laboratory.test.tsx's own. */
const ROUTE_ID = '9c1b2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e'
const routeCard = (overrides: Record<string, unknown> = {}) => ({ id: ROUTE_ID, reference: '9C1B2D3E', effectiveState: 'accepted',
  access: 'work', orderingFacilityName: 'Demo Hospital', ordererName: 'Dr Demo Clinician', version: 3, endedKind: null, ...overrides })
const PERSON = { fullName: 'Patient One', sex: 'female', dateOfBirth: '1990-01-01', healthIdLast4: 'AAA2' }
const routed = (overrides: Partial<LabWorkItem> & Record<string, unknown> = {}) => workItem({ id: 'w-routed', priority: 'routine',
  specimenStatuses: [], orderRoute: routeCard() as LabWorkItem['orderRoute'], patient: PERSON, ...overrides })
const answer = (items: LabWorkItem[], fields: Record<string, unknown> = {}) => ({ items, crossFacilityOrders: true, crossFacilityWork: true,
  receives: true, routesHere: { waiting: false, held: true }, lateCorrection: true, ...fields })
const RECEIVE = [...ACCESSION, 'lab.order-route.receive']
const CC = 'We can’t complete this order'

function as(permissions: string[], overrides: Partial<FakeFacility> = {}) {
  session.facility = fakeFacility(permissions, overrides)
}

/** The work list's address in the frame; a request opens below it. */
const WORK_LIST = '/provider/laboratory/work'
const RESULTS = '/provider/laboratory/results'

function renderPage(route = WORK_LIST) {
  return renderDept(<Laboratory />, { route })
}

/** A request's card button, named by its next action, then who and which tests. */
async function findCard(test: string) {
  return screen.findByRole('button', { name: new RegExp(`, ${test}$`) })
}

/** The stage card's body: what to do now. */
function stageCard() {
  return document.getElementById('lab-stage-title')!.closest('section') as HTMLElement
}

async function openRecord(test = 'Haemoglobin') {
  fireEvent.click(await findCard(test))
  await screen.findByRole('heading', { level: 1, name: test })
}

/** Renders the page as `permissions` on a list of `item`, opens it and waits for its accession to be read. */
async function openAccession(permissions: string[], value: LabAccession, item: LabWorkItem | ReturnType<typeof answer>) {
  as(permissions)
  api.labWorkItems.mockResolvedValue('items' in item ? item : { items: [item] })
  api.labAccession.mockResolvedValue(value)
  renderPage()
  await openRecord()
  await waitFor(() => expect(api.labAccession).toHaveBeenCalledWith(DEMO_LABORATORY_ID, 'accession-1'))
  await waitFor(() => expect(within(stageCard()).queryByText('Loading…')).toBeNull())
}

/** Each stage tab as it reads, with whether it is the one shown. */
function stageTabs() {
  return within(screen.getByRole('navigation', { name: 'Stage' })).getAllByRole('button')
    .map(stage => [stage.textContent, stage.getAttribute('aria-pressed')])
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

describe('lab launch: finished work reaches Done, and Results only says what it knows', () => {
  it('moves a request Lab says has no work left to Done, and Results lists it', async () => {
    api.labWorkItems.mockResolvedValue({ items: [listed({ id: 'w-done', testName: 'Finished test', openWork: false }),
      listed({ id: 'w-open', testName: 'Open test', accessionId: 'accession-2', openWork: true })] })
    const { unmount } = renderPage()
    await findCard('Open test')
    expect(stageTabs()).toEqual([['Waiting for sample0', 'false'], ['Testing1', 'true'], ['Enter results0', 'false'],
      ['Check & release0', 'false'], ['Done1', 'false']])
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Stage' })).getByRole('button', { name: /^Done/ }))
    expect((await findCard('Finished test')).textContent).toMatch(/^Give result:/)
    unmount()

    renderDept(<Results />, { route: RESULTS })
    const results = await screen.findByRole('list', { name: 'Released results' })
    expect(within(results).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([`${RESULTS}/w-done`])
  })

  it('on a work list without stage facts, a received sample says Continue, not Start test', async () => {
    // hid-system 34d69557 GET /lab/work-items sends no executionStatuses, resultStatuses or openWork.
    api.labWorkItems.mockResolvedValue({ items: [received()] })
    renderPage()
    const card = await findCard('Haemoglobin')
    expect(card.textContent).toMatch(/^Continue:/)
    expect(card.textContent).not.toMatch(/^Start test/)
  })

  it('a received sample with executionStatuses: [] still says Start test', async () => {
    api.labWorkItems.mockResolvedValue({ items: [listed({ executionStatuses: [] })] })
    renderPage()
    expect((await findCard('Haemoglobin')).textContent).toMatch(/^Start test:/)
  })

  it('Results does not say "No results released yet" when the list cannot tell', async () => {
    api.labWorkItems.mockResolvedValue({ items: [received()] })
    const { unmount } = renderDept(<Results />, { route: RESULTS })
    expect(await screen.findByText('Results aren’t listed here yet')).toBeTruthy()
    expect(screen.getByText('Open a request from the Work list to see its result and give it to the patient.')).toBeTruthy()
    expect(screen.queryByText('No results released yet')).toBeNull()
    unmount()
    // Where the list does say it, and nothing is done yet: none is released.
    api.labWorkItems.mockResolvedValue({ items: [listed({ openWork: true })] })
    renderDept(<Results />, { route: RESULTS })
    expect(await screen.findByText('No results released yet')).toBeTruthy()
    await waitFor(() => expect(api.labWorkItems).toHaveBeenCalledTimes(2))
  })
})

describe('lab launch: sample custody', () => {
  /** A request whose one sample is `status`, registered: the list's item and Lab's accession. */
  const sampled = (status: string, overrides: Partial<LabWorkItem> = {}) => workItem({ accessionId: 'accession-1',
    accessionNumber: 'ACC-2026-000123', specimenStatuses: [status], ...overrides })

  it('a rejected sample says to ask the doctor for a new request, and its card says See rejected sample', async () => {
    as(CUSTODY)
    api.labWorkItems.mockResolvedValue({ items: [sampled('rejected')] })
    api.labAccession.mockResolvedValue(accession([specimen('rejected')]))
    renderPage()
    expect((await findCard('Haemoglobin')).textContent).toMatch(/^See rejected sample:/)
    await openRecord()
    expect(await within(stageCard()).findByText('The sample was rejected. Ask the doctor who asked for the test to send a new request, so a new sample can be taken.')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Make a new request/)
  })

  it('on an order from another facility, a rejected sample says to use “We can’t complete this order” below', async () => {
    vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
    await openAccession([...CUSTODY, ...RECEIVE], accession([specimen('rejected')]), answer([routed({ accessionId: 'accession-1',
      accessionNumber: 'ACC-2026-000123', specimenStatuses: ['rejected'] })], { cannotComplete: true }))
    expect(within(stageCard()).getByText('The sample was rejected. Use “We can’t complete this order” below, or call the ordering facility.')).toBeTruthy()
    const ending = await screen.findByRole('button', { name: `${CC}: Haemoglobin, Ref 9C1B2D3E` })
    expect(stageCard().compareDocumentPosition(ending) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/Make a new request/)
  })

  it('asks to check who the person is when Lab sends no name', async () => {
    await openAccession(CUSTODY, accession([specimen('required')]), sampled('required'))
    fireEvent.click(within(stageCard()).getByRole('button', { name: 'Collect sample' }))
    const sheet = await screen.findByRole('dialog', { name: 'Collect the sample' })
    expect(within(sheet).getByText('Health ID didn’t send this person’s name. Check who they are against the request before you take the sample.')).toBeTruthy()
    expect(sheet.textContent).not.toMatch(/Check the name with the person/)
  })

  it('still asks to check the name when Lab sends it', async () => {
    await openAccession(CUSTODY, accession([specimen('required')]), sampled('required', { patient: PERSON }))
    fireEvent.click(within(stageCard()).getByRole('button', { name: 'Collect sample' }))
    const sheet = await screen.findByRole('dialog', { name: 'Collect the sample' })
    expect(within(sheet).getByText('Check the name with the person before you take it.')).toBeTruthy()
    expect(sheet.textContent).not.toMatch(/didn’t send this person’s name/)
  })

  it('names the tube', async () => {
    await openAccession(CUSTODY, accession([specimen('required')]), sampled('required'))
    // The number is one span within the label line, so the line is matched as a whole.
    expect(within(stageCard()).getByText((_, element) => element?.tagName === 'SPAN' && element.textContent === 'Tube SPC-000123')).toBeTruthy()
    // Its step keeps its name: the sample's type, then its number.
    expect(within(stageCard()).getByRole('group', { name: 'Venous blood, SPC-000123' })).toBeTruthy()
  })
})
