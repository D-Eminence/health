import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Laboratory, Pharmacy } from '../Operations'

/**
 * NEW-PEHR-ACTION-FOCUS in Laboratory and Pharmacy (the provider counterpart of
 * OCR-A11Y-01). A specimen step reloads the accession, which removed every
 * specimen row until it was read again; completing an execution, recording a
 * result and dispensing remove the form that did it; and each confirmation was
 * a status node inserted with its text. Focus now moves to where the work
 * continues once the new state is shown, only if it was lost, and a status
 * region mounted throughout says what was recorded. A control whose request is
 * running stays focusable (aria-disabled) and ignores a second press.
 */
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
const running = { id: 'execution-1', accessionId: 'accession-1', specimenId: 'specimen-1', requestedTestId: 'test-1',
  test: { codeSystem: 'LOINC', code: '718-7', name: 'Hemoglobin' }, patientId: PATIENT, facilityId: 'facility-1', status: 'in_progress',
  method: null, startedAt: '2026-10-09T09:00:00.000Z', completedAt: null, version: 1, result: null }
const prescription = { id: 'work-item-9', patientId: PATIENT, version: 3, acceptedAt: '2026-10-08T09:30:00.000Z',
  medication: { display: 'Amoxicillin 500 mg capsule' }, doseQuantity: 1, doseUnit: 'capsule', frequency: 'Three times daily', dispensing: null }

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}
const focused = () => document.activeElement
function region(id: string) {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Expected the status region ${id} to be mounted before the step.`)
  expect(element.getAttribute('role')).toBe('status')
  return element
}

beforeEach(() => {
  vi.clearAllMocks()
  api.labExecutions.mockResolvedValue({ items: [] })
})

describe('Laboratory', () => {
  async function openAccession(status: string) {
    staff.permissions = ['lab.work-item.read', 'lab.accession.read', 'lab.specimen.collect', 'lab.specimen.receive', 'lab.specimen.reject',
      'lab.execution.read', 'lab.execution.complete']
    api.labWorkItems.mockResolvedValue({ items: [workItem] })
    api.labAccession.mockResolvedValue(accession(status))
    render(<Laboratory />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open accession' }))
    await screen.findByText('Venous blood · SPC-1')
  }

  it('a specimen step: focus moves to the specimen’s next step once the accession is read again, and the accession says it', async () => {
    await openAccession('required')
    const status = region('lab-accession-status')
    const recording = deferred<unknown>()
    api.transitionSpecimen.mockReturnValueOnce(recording.promise)
    const button = screen.getByRole('button', { name: 'Record step' })
    await press(button)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(focused()).toBe(button)
    await act(async () => { fireEvent.click(button) })
    expect(api.transitionSpecimen).toHaveBeenCalledTimes(1)

    const reading = deferred<unknown>()
    api.labAccession.mockReturnValueOnce(reading.promise)
    await act(async () => { recording.resolve(specimen('collected', 3)) })
    await act(async () => { reading.resolve(accession('collected')) })
    await waitFor(() => expect(focused()).toBe(document.getElementById('lab-action-specimen-1')))
    expect(status.isConnected).toBe(true)
    expect(status.textContent).toBe('Specimen marked collected.')
  })

  it('completing an execution: focus moves to the execution, and its panel says it', async () => {
    api.labExecutions.mockResolvedValue({ items: [running] })
    await openAccession('received')
    await screen.findByText(/Hemoglobin · LOINC/)
    const status = region('lab-executions-status-specimen-1')
    api.completeLabExecution.mockResolvedValue({ ...running, status: 'completed', completedAt: '2026-10-09T09:30:00.000Z', version: 2 })
    api.labExecutions.mockResolvedValue({ items: [{ ...running, status: 'completed', completedAt: '2026-10-09T09:30:00.000Z', version: 2 }] })
    await press(screen.getByRole('button', { name: 'Complete execution' }))
    await waitFor(() => expect(focused()).toBe(document.getElementById('lab-execution-execution-1-title')))
    expect(screen.queryByRole('button', { name: 'Complete execution' })).toBeNull()
    expect(status.isConnected).toBe(true)
    await waitFor(() => expect(status.textContent).toBe('Analytical execution was completed.'))
  })

  it('creating an accession: focus moves to the accession', async () => {
    staff.permissions = ['lab.work-item.read', 'lab.accession.create', 'lab.accession.read']
    api.labWorkItems.mockResolvedValue({ items: [{ ...workItem, accessionId: null, accessionNumber: null, specimenStatuses: [] }] })
    api.createLabAccession.mockResolvedValue(accession('required'))
    api.labAccession.mockResolvedValue(accession('required'))
    render(<Laboratory />)
    fireEvent.click(await screen.findByRole('button', { name: 'Prepare accession' }))
    fireEvent.change(screen.getByLabelText(/^Specimen type/), { target: { value: 'Blood' } })
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'Anaemia work-up' } })
    await press(screen.getByRole('button', { name: 'Create accession' }))
    await waitFor(() => expect(focused()).toBe(screen.getByRole('heading', { name: 'Specimen accession' })))
    await waitFor(() => expect(region('lab-accession-status').textContent).toBe('Accession ACC-1 created.'))
  })
})

describe('Pharmacy', () => {
  it('dispensing: focus moves to the prescription once its form goes, and the entry’s status region says it', async () => {
    staff.permissions = ['pharmacy.work-item.read', 'pharmacy.dispensing.create']
    api.pharmacyWorkItems.mockResolvedValueOnce({ items: [prescription] })
      .mockResolvedValueOnce({ items: [{ ...prescription, version: 4, dispensing: { id: 'dispensing-1', reversed: false } }] })
    render(<Pharmacy />)
    const title = await screen.findByText('Amoxicillin 500 mg capsule')
    const status = region('pharmacy-status-work-item-9')
    expect(status.textContent).toBe('')
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Quantity dispensed' }), { target: { value: '21' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: 'Full course dispensed at the counter' } })
    const recording = deferred<unknown>()
    api.dispense.mockReturnValueOnce(recording.promise)
    const button = screen.getByRole('button', { name: 'Record full dispensing' })
    await press(button)
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(focused()).toBe(button)
    await act(async () => { fireEvent.click(button) })
    expect(api.dispense).toHaveBeenCalledTimes(1)

    await act(async () => { recording.resolve({ id: 'dispensing-1' }) })
    await waitFor(() => expect(focused()).toBe(title))
    expect(screen.queryByRole('button', { name: 'Record full dispensing' })).toBeNull()
    expect(status.isConnected).toBe(true)
    expect(status.textContent).toBe('Dispensing recorded.')
  })
})
