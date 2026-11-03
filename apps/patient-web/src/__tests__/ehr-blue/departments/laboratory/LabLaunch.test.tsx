import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LabWorkItem } from '../../../../staff/api'
import { forgetReceiving } from '../../../../staff/orderRoutes'
import { forgetCannotCompleteServed } from '../../../../cannotCompleteServed'
import { forgetLateCorrectionServed } from '../../../../lateCorrectionServed'
import { forgetWrongPatientServed } from '../../../../wrongPatientServed'
import { Laboratory } from '../../../../ehr-blue/departments/laboratory/Laboratory'
import { Results } from '../../../../ehr-blue/departments/laboratory/Results'
import { fakeFacility, renderDept, type FakeFacility } from '../harness'

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
