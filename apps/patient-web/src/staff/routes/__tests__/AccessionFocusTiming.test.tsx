import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Laboratory } from '../Operations'
import { focusWhenShown } from '../../../__tests__/focusWhenShown'

const api = vi.hoisted(() => ({
  labWorkItems: vi.fn(), createLabAccession: vi.fn(), labAccession: vi.fn(), transitionSpecimen: vi.fn(), labExecutions: vi.fn(),
  startLabExecution: vi.fn(), completeLabExecution: vi.fn(), enterLabResult: vi.fn(), correctLabResult: vi.fn(), verifyLabResult: vi.fn(),
  releaseLabResult: vi.fn(), labResultHistory: vi.fn(), pharmacyWorkItems: vi.fn(), dispense: vi.fn(), dispensing: vi.fn(), reverseDispensing: vi.fn(),
}))
const staff = vi.hoisted(() => ({ permissions: [] as string[] }))
vi.mock('../../api', () => ({ staffApi: api }))
vi.mock('../../App', () => ({
  useStaff: () => ({ state: { status: 'ready', session: { actor: { facility: { id: 'facility-1', membershipId: 'member-1', permissions: staff.permissions } } } },
    lock: null }),
}))
const PATIENT = 'a0000000-0000-4000-8000-0000004f9c2e'
const workItem = { id: 'work-item-1', patientId: PATIENT, version: 1, status: 'accepted', testName: 'Haemoglobin', accessionId: 'accession-1',
  accessionNumber: 'ACC-1', specimenStatuses: ['required'], acceptedAt: '2026-10-09T08:00:00.000Z' }
const specimen = (status: string, version = 2) => ({ id: 'specimen-1', accessionId: 'accession-1', specimenIdentifier: 'SPC-1',
  specimenType: 'Venous blood', status, version })
const accession = (status: string) => ({ id: 'accession-1', accessionNumber: 'ACC-1', workItemId: 'work-item-1', status: 'open',
  specimens: [specimen(status)] })
function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const environment = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
let saved: boolean | undefined
beforeEach(() => { vi.clearAllMocks(); api.labExecutions.mockResolvedValue({ items: [] }); saved = environment.IS_REACT_ACT_ENVIRONMENT })
afterEach(() => { environment.IS_REACT_ACT_ENVIRONMENT = saved })

async function openAccession(status: string) {
  staff.permissions = ['lab.work-item.read', 'lab.accession.read', 'lab.specimen.collect', 'lab.specimen.receive', 'lab.specimen.reject',
    'lab.execution.read', 'lab.execution.complete']
  api.labWorkItems.mockResolvedValue({ items: [workItem] })
  api.labAccession.mockResolvedValue(accession(status))
  render(<Laboratory />)
  fireEvent.click(await screen.findByRole('button', { name: 'Open accession' }))
  await screen.findByText('Venous blood · SPC-1')
}

// A specimen step reads the accession again, which removes its rows until the read lands. Focus goes to the specimen's
// next step, or to Refresh when the read fails, in the commit that shows it: taken at that moment, focus a task later
// is still on the page.
describe('focus after a specimen step', () => {
  async function recordStep() {
    await openAccession('required')
    const recording = deferred<unknown>()
    api.transitionSpecimen.mockReturnValueOnce(recording.promise)
    const button = screen.getByRole('button', { name: 'Record step' })
    button.focus()
    await act(async () => { fireEvent.click(button) })
    const reading = deferred<unknown>()
    api.labAccession.mockReturnValueOnce(reading.promise)
    await act(async () => { recording.resolve(specimen('collected', 3)) })
    return reading
  }

  it('is on the specimen as soon as the accession read again shows it', async () => {
    const reading = await recordStep()
    const shown = focusWhenShown<HTMLElement>('#lab-action-specimen-1')
    environment.IS_REACT_ACT_ENVIRONMENT = false
    reading.resolve(accession('collected'))
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })

  it('is on Refresh as soon as the failed read is shown', async () => {
    const reading = await recordStep()
    const shown = focusWhenShown<HTMLElement>(() => screen.queryByRole('alert'))
    environment.IS_REACT_ACT_ENVIRONMENT = false
    reading.reject(new Error('The accession could not be read.'))
    const { focused } = await shown
    expect(focused).toBe(document.getElementById('lab-accession-refresh'))
  })
})
