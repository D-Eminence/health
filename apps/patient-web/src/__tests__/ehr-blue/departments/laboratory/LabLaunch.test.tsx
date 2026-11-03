import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import type { LabAccession, LabExecution, LabResult, LabResultRevision, LabSpecimen, LabWorkItem } from '../../../../staff/api'
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
/** A facility that is not one of the demo tenant's (blueFacilities.ts), where point of care is not served. */
const REAL_LAB = 'f7000000-0000-4000-8000-0000000000aa'
const problem = (status: number, code: string, message: string) => new HidApiError(status, message, { code })
const WORK = ['lab.work-item.read']
const ACCESSION = [...WORK, 'lab.accession.create', 'lab.accession.read']
const CUSTODY = [...ACCESSION, 'lab.specimen.collect', 'lab.specimen.receive', 'lab.specimen.reject']
const PROCESSING = [...ACCESSION, 'lab.execution.read', 'lab.execution.start', 'lab.execution.complete', 'lab.result.enter',
  'lab.result.correct', 'lab.result.verify', 'lab.result.release', 'lab.result.released.read']

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
const revision = (overrides: Partial<LabResultRevision> = {}): LabResultRevision => ({
  version: 1, resultType: 'numeric', numericValue: 7.1, textValue: null, unit: 'g/dL', referenceRange: '12.0-15.5',
  abnormalFlag: 'low', entrySource: 'manual', verificationStatus: 'unverified', releaseStatus: 'not_released',
  enteredAt: '2026-10-09T10:00:00.000Z', correctionReason: null, ...overrides,
})
const draftResult = (overrides: Partial<LabResult> = {}): LabResult => ({
  id: 'result-1', executionId: 'execution-1', status: 'entered_unverified', verificationStatus: 'unverified',
  currentVersion: 1, currentReleasedVersion: null, revisions: [revision()], ...overrides,
})
const publishedResult = () => draftResult({ status: 'released', verificationStatus: 'verified', currentReleasedVersion: 1,
  revisions: [revision({ verificationStatus: 'verified', releaseStatus: 'released', releasedAt: '2026-10-09T12:00:00.000Z' })] })
/** A correction (version 2) of a released result (version 1), saved and waiting to be checked. */
const correctionOfReleased = () => draftResult({ currentVersion: 2, currentReleasedVersion: 1, revisions: [
  revision({ verificationStatus: 'verified', releaseStatus: 'released', releasedAt: '2026-10-09T12:00:00.000Z' }),
  revision({ version: 2, numericValue: 11.7, correctionReason: 'Typed 7.1 for 11.7' })] })
const execution = (overrides: Partial<LabExecution> = {}): LabExecution => ({
  id: 'execution-1', accessionId: 'accession-1', specimenId: 'specimen-1', requestedTestId: 'requested-test-1',
  test: { codeSystem: 'LOINC', code: '718-7', name: 'Hemoglobin' }, patientId: PATIENT, facilityId: DEMO_LABORATORY_ID,
  status: 'completed', method: 'Automated haematology analyser', startedAt: '2026-10-09T09:00:00.000Z',
  completedAt: '2026-10-09T09:30:00.000Z', version: 2, result: null, ...overrides,
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

describe('lab launch: results (warn before saving, reasons Lab keeps, correct before release, never give out a value being corrected)', () => {
  /** Opens a request whose one sample is received, as Laboratory.test.tsx's openReceived, and returns its stage card. */
  async function openReceived(permissions: string[] = PROCESSING) {
    await openAccession(permissions, accession([specimen('received')]), received())
    if (permissions.includes('lab.execution.read')) await waitFor(() => expect(api.labExecutions).toHaveBeenCalledWith(DEMO_LABORATORY_ID, 'specimen-1'))
    return stageCard()
  }

  it('tells the person saving a result that someone else must check it before it is released', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution()] })
    const card = await openReceived()
    const form = within(card).getByRole('form', { name: 'Enter result: Hemoglobin' })
    fireEvent.change(within(form).getByRole('spinbutton', { name: 'Result' }), { target: { value: '12.4' } })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Unit' }), { target: { value: 'g/dL' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save result' }))
    const sheet = await screen.findByRole('dialog', { name: 'Save the result' })
    expect(within(sheet).getByText('Someone other than you must check it before it is released. Until then only the lab sees it.')).toBeTruthy()
    expect(sheet.textContent).not.toMatch(/patient (can )?sees?/i)
  })

  it('refuses a correction reason shorter than Lab keeps (3 characters), at its field, and sends nothing', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution({ result: publishedResult() })] })
    const card = await openReceived([...PROCESSING, 'lab.result.revise-released'])
    fireEvent.click(within(card).getByRole('button', { name: 'Correct: Hemoglobin' }))
    const form = screen.getByRole('form', { name: 'Correct result: Hemoglobin' })
    const reason = within(form).getByRole('textbox', { name: 'Why it is changed' })
    fireEvent.change(reason, { target: { value: 'no' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save correction' }))
    expect(await refusalOf(reason)).toBe('Write at least 3 characters.')
    expect(document.activeElement).toBe(reason)
    expect(screen.queryByRole('dialog', { name: 'Save the correction' })).toBeNull()
    expect(api.correctLabResult).not.toHaveBeenCalled()
  })

  it('corrects a result still waiting to be checked, as a new version, instead of checking a wrong one', async () => {
    const result = draftResult()
    const done = execution({ result })
    api.labExecutions.mockResolvedValue({ items: [done] })
    api.correctLabResult.mockResolvedValue(draftResult({ currentVersion: 2 }))
    const card = await openReceived()
    expect(document.getElementById('lab-stage-title')?.textContent).toBe('Check & release')
    fireEvent.click(within(card).getByRole('button', { name: 'Correct: Hemoglobin' }))
    const form = screen.getByRole('form', { name: 'Correct result: Hemoglobin' })
    fireEvent.change(within(form).getByRole('spinbutton', { name: 'Result' }), { target: { value: '11.7' } })
    fireEvent.change(within(form).getByRole('textbox', { name: 'Why it is changed' }), { target: { value: 'Typed 7.1 for 11.7' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save correction' }))
    await answerSheet('Save the correction', 'Save correction')
    expect(await screen.findByText('Correction saved. Check and release it.')).toBeTruthy()
    expect(api.correctLabResult).toHaveBeenCalledWith(DEMO_LABORATORY_ID, done, result,
      { resultType: 'numeric', numericValue: 11.7, unit: 'g/dL', referenceRange: '12.0-15.5', abnormalFlag: 'low' }, 'Typed 7.1 for 11.7', 'correction')
    expect(api.verifyLabResult).not.toHaveBeenCalled()
    expect(api.releaseLabResult).not.toHaveBeenCalled()
  })

  it('says a correction waiting to be checked replaces a released result, which the clinician still sees until then', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution({ result: correctionOfReleased() })] })
    const card = await openReceived()
    expect(within(card).getByText('11.7')).toBeTruthy()
    const warning = within(card).getByText(/^This corrects a result that was already released\./)
    expect(warning.textContent?.replace(/\s+/g, ' '))
      .toBe('This corrects a result that was already released. Until this one is released, the clinician still sees the earlier result.')
    // Said above the check it is about, inside the stage card.
    const check = within(card).getByRole('button', { name: 'Check & release' })
    expect(warning.compareDocumentPosition(check) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('says nothing of a correction on a first result waiting to be checked', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution({ result: draftResult() })] })
    const card = await openReceived()
    expect(within(card).getByRole('button', { name: 'Check & release' })).toBeTruthy()
    expect(card.textContent).not.toMatch(/already released/)
  })

  describe('giving a result out (laboratory/results)', () => {
    async function openResult(result: LabResult) {
      as([...PROCESSING, 'lab.result.share'])
      api.labWorkItems.mockResolvedValue({ items: [received()] })
      api.labAccession.mockResolvedValue(accession([specimen('received')]))
      api.labExecutions.mockResolvedValue({ items: [execution({ result })] })
      renderDept(<Results />, { route: `${RESULTS}/work-item-1` })
      await screen.findByRole('heading', { level: 1, name: 'Haemoglobin' })
      await waitFor(() => expect(api.labExecutions).toHaveBeenCalledWith(DEMO_LABORATORY_ID, 'specimen-1'))
    }

    it('prints a released result with nothing waiting', async () => {
      await openResult(publishedResult())
      expect(await screen.findByRole('button', { name: 'Print' })).toBeTruthy()
      expect(screen.getByRole('heading', { name: 'Give the result' })).toBeTruthy()
      expect(screen.queryByText('A correction is waiting to be checked')).toBeNull()
    })

    it('warns and offers no Print while a correction of the released result waits to be checked', async () => {
      await openResult(correctionOfReleased())
      expect(await screen.findByText('A correction is waiting to be checked')).toBeTruthy()
      expect(screen.getByText(/^Hemoglobin: the result below is being corrected\./).textContent?.replace(/\s+/g, ' '))
        .toBe('Hemoglobin: the result below is being corrected. Don’t print or give it out until the correction is checked and released.')
      // The released value is still the one shown, but it is not given out.
      expect(screen.getByText('7.1')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Print' })).toBeNull()
      expect(screen.queryByRole('heading', { name: 'Give the result' })).toBeNull()
    })
  })
})

describe('lab launch: lists and pages in plain words (loading, empty, access, closed, cap)', () => {
  it('shows no stage counts while the work list could not be read', async () => {
    api.labWorkItems.mockRejectedValueOnce(problem(503, 'SERVICE_UNAVAILABLE', 'Unavailable'))
    renderPage()
    const alert = await screen.findByRole('alert')
    // A failed read says nothing of how much is waiting: no stage reads 0.
    expect(stageTabs()).toEqual([['Waiting for sample', 'true'], ['Testing', 'false'], ['Enter results', 'false'],
      ['Check & release', 'false'], ['Done', 'false']])
    expect(screen.queryByText('No one is waiting for a sample')).toBeNull()
    // Read again, the counts are said.
    api.labWorkItems.mockResolvedValue({ items: [workItem()] })
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    await findCard('Haemoglobin')
    expect(stageTabs().map(([text]) => text)).toEqual(['Waiting for sample1', 'Testing0', 'Enter results0', 'Check & release0', 'Done0'])
  })

  it('offers New request only where point of care is open', async () => {
    as([...WORK, 'lab.walk-in.create'], { id: REAL_LAB })
    api.labWorkItems.mockResolvedValue({ items: [workItem()] })
    const { unmount } = renderPage()
    await findCard('Haemoglobin')
    expect(screen.queryByRole('link', { name: 'New request' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'New request' })).toBeNull()
    unmount()
    // At the demo laboratory, where it may answer, it stays.
    as([...WORK, 'lab.walk-in.create'])
    renderPage()
    await findCard('Haemoglobin')
    expect(screen.getByRole('link', { name: 'New request' }).getAttribute('href')).toBe('/provider/laboratory/new')
  })

  it.each([
    ['collect', 'No one is waiting for a sample'], ['testing', 'No samples being tested'], ['enter', 'No results to enter'],
    ['check', 'No results to check'], ['done', 'Nothing finished yet'],
  ])('says an empty %s stage in plain words, never "today"', async (stage, title) => {
    renderPage(`${WORK_LIST}?stage=${stage}`)
    expect(await screen.findByText(title)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/today|Nothing in /)
  })

  it('on a hospital, says a request shows once you have access to the patient, with Find the patient', async () => {
    as([...WORK, 'identity.patient.read'], { name: 'Riverside Teaching Hospital (fictional)', roles: ['lab_scientist'] })
    const { unmount } = renderPage()
    const note = (await screen.findByText(/^A doctor’s request shows here once you have access to that patient\./)).closest('div') as HTMLElement
    expect(note.textContent?.replace(/\s+/g, ' ')).toBe('A doctor’s request shows here once you have access to that patient. Find the patient, '
      + 'then use their Access PIN or ask them in the Health ID app.')
    expect(within(note).getByRole('link', { name: 'Find the patient' }).getAttribute('href')).toBe('/provider/patients')
    unmount()
    // A laboratory of its own (signed itself up) gets no doctor's requests from its own facility: nothing is said.
    as([...WORK, 'identity.patient.read'], { selfService: { review: 'reviewed', organizationType: 'laboratory' } })
    renderPage()
    expect(await screen.findByText('No one is waiting for a sample')).toBeTruthy()
    expect(screen.queryByText(/A doctor’s request shows here/)).toBeNull()
  })

  it('says nothing more can be done on a closed order from another facility', async () => {
    as(CUSTODY)
    api.labWorkItems.mockResolvedValue(answer([routed({ accessionId: 'accession-1', accessionNumber: 'ACC-2026-000123', specimenStatuses: ['required'],
      orderRoute: routeCard({ effectiveState: 'cancelled', access: 'read', endedKind: 'order_changed' }) as LabWorkItem['orderRoute'] })]))
    api.labAccession.mockResolvedValue(accession([specimen('required')]))
    renderPage()
    await openRecord()
    await waitFor(() => expect(api.labAccession).toHaveBeenCalled())
    expect(await within(stageCard()).findByText('Nothing more can be done on this order.')).toBeTruthy()
    expect(within(stageCard()).queryByRole('button', { name: /^(Collect|Reject) sample$/ })).toBeNull()
  })

  it('shows no stage track while the results can’t be read', async () => {
    as(PROCESSING)
    api.labExecutions.mockRejectedValue(problem(403, 'LAB_EXECUTION_ACCESS_DENIED', 'Lab execution/result access is not authorized'))
    await openAccession(PROCESSING, accession([specimen('received')]), received())
    expect(await screen.findByText('You can’t see lab results for this patient right now. They stay hidden until your access is back.')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Progress' })).toBeNull()
  })

  it('a finished request says nothing of waiting', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution({ result: publishedResult() })] })
    await openAccession(PROCESSING, accession([specimen('received')]), received())
    await waitFor(() => expect(document.getElementById('lab-stage-title')?.textContent).toBe('Done'))
    const record = screen.getByRole('heading', { level: 1, name: 'Haemoglobin' }).closest('[data-layout="column"]') as HTMLElement
    const request = screen.getByRole('heading', { level: 2, name: 'Request' }).closest('section') as HTMLElement
    expect(record.textContent).not.toMatch(/waiting \d|waiting just now/i)
    expect(within(request).queryByText('Waiting')).toBeNull()
    // The track still names every stage, each done.
    expect(within(screen.getByRole('list', { name: 'Progress' })).getAllByRole('listitem')).toHaveLength(5)
  })

  it('a request still in the lab says how long it has waited', async () => {
    api.labExecutions.mockResolvedValue({ items: [execution({ result: draftResult() })] })
    await openAccession(PROCESSING, accession([specimen('received')]), received())
    await waitFor(() => expect(document.getElementById('lab-stage-title')?.textContent).toBe('Check & release'))
    const request = screen.getByRole('heading', { level: 2, name: 'Request' }).closest('section') as HTMLElement
    expect(within(request).getByText('Waiting')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Haemoglobin' }).closest('[data-layout="column"]')?.textContent).toMatch(/waiting \d/)
  })

  it('the lab’s result page says “Normal range:” and claims nothing about the patient’s Health ID', async () => {
    as([...PROCESSING, 'lab.result.share'])
    api.labWorkItems.mockResolvedValue({ items: [received()] })
    api.labAccession.mockResolvedValue(accession([specimen('received')]))
    api.labExecutions.mockResolvedValue({ items: [execution({ result: publishedResult() })] })
    renderDept(<Results />, { route: `${RESULTS}/work-item-1` })
    await screen.findByRole('heading', { level: 1, name: 'Haemoglobin' })
    expect(await screen.findByText(/^Normal range: 12\.0-15\.5/)).toBeTruthy()
    expect(screen.getByText('A link to this result only.')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/on their Health ID/)
  })
})
