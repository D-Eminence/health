import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HidApiError } from '@hid/http'
import { Laboratory } from '../Operations'
import { forgetReceiving } from '../../orderRoutes'
import { forgetCannotCompleteServed } from '../../../cannotCompleteServed'
import { forgetLateCorrectionServed } from '../../../lateCorrectionServed'
import { forgetWrongPatientServed } from '../../../wrongPatientServed'
import { SAID_NOT_FOUND } from '../../../__tests__/said'

/**
 * UX-1 (D18 review): the accession of work from an order another facility sent, once that order no longer lets this
 * laboratory record on it (an order it couldn't complete, its reads kept 7 days because it had opened an accession,
 * D18-2; or one cancelled after the order changed). Its row says "Nothing more can be recorded on it", and the services
 * refuse every specimen step, execution and result write there (404, the row to write is not found for writing;
 * INTERFACE_CONTRACT §24): the accession is shown to be read only, and a write refused that way on routed work is said as
 * the closed order it is, never as a missing record. Work of this facility's own orders is unchanged.
 */
const api = vi.hoisted(() => ({ labWorkItems: vi.fn(), pharmacyWorkItems: vi.fn(), createLabAccession: vi.fn(),
  labAccession: vi.fn(), transitionSpecimen: vi.fn(), labExecutions: vi.fn(), verifyLabResult: vi.fn(),
  releaseLabResult: vi.fn(), correctLabResult: vi.fn(), enterLabResult: vi.fn(), startLabExecution: vi.fn(),
  completeLabExecution: vi.fn(), labResultHistory: vi.fn() }))
const routes = vi.hoisted(() => ({ incoming: vi.fn(), accept: vi.fn(), get: vi.fn(), reportWrongPatient: vi.fn(),
  cannotComplete: vi.fn(), findCorrectable: vi.fn(), correctWrongPatient: vi.fn() }))
const working = vi.hoisted(() => ({ permissions: [] as string[] }))
vi.mock('../../api', () => ({ staffApi: api, orderRoutesApi: routes }))
vi.mock('../../App', () => ({
  useStaff: () => ({ state: { status: 'ready', session: { actor: { facility: { id: 'facility-1', membershipId: 'member-1',
    name: 'Yaba Diagnostics', roles: ['lab'], permissions: working.permissions } } } } }),
}))

const LAB = ['lab.work-item.read', 'lab.accession.create', 'lab.accession.read', 'lab.order-route.receive', 'lab.specimen.collect',
  'lab.specimen.receive', 'lab.specimen.reject', 'lab.execution.read', 'lab.execution.start', 'lab.execution.complete',
  'lab.result.enter', 'lab.result.correct', 'lab.result.verify', 'lab.result.release', 'lab.result.released.read']
const ROUTE_ID = '9c1b2d3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e'
const PATIENT = { fullName: 'Tunde Bello', sex: 'male', dateOfBirth: '1985-03-12', healthIdLast4: '7KQ2' }
const card = (overrides: Record<string, unknown> = {}) => ({ id: ROUTE_ID, reference: '9C1B2D3E', effectiveState: 'accepted',
  access: 'work', orderingFacilityName: 'General Hospital', ordererName: 'Dr Ade Okon', version: 3, endedKind: null, ...overrides })
const ENDED = { effectiveState: 'cancelled', access: 'read', endedKind: 'receiving_unable', version: 4 }
const item = (overrides: Record<string, unknown> = {}) => ({ id: 'w-routed', patientId: 'a0000000-0000-4000-8000-0000004f9c2e',
  version: 1, status: 'accepted', testName: 'Haemoglobin', accessionId: 'acc-1', accessionNumber: 'ACC-1',
  acceptedAt: '2026-10-21T10:00:00.000Z', priority: 'routine', specimenStatuses: ['received'], orderRoute: card(), patient: PATIENT,
  ...overrides })
const local = (overrides: Record<string, unknown> = {}) => ({ id: 'w-local', patientId: 'a0000000-0000-4000-8000-000000aa11bb',
  version: 1, status: 'accepted', testName: 'Malaria parasite', accessionId: 'acc-1', accessionNumber: 'ACC-1',
  acceptedAt: '2026-10-21T09:00:00.000Z', ...overrides })
const answer = (...items: unknown[]) => ({ items, crossFacilityOrders: true, crossFacilityWork: true, receives: true,
  routesHere: { waiting: false, held: true }, lateCorrection: true, cannotComplete: true })
const accession = (status: string) => ({ id: 'acc-1', accessionNumber: 'ACC-1', workItemId: 'w-routed', status: 'accessioned',
  specimens: [{ id: 's-1', accessionId: 'acc-1', specimenIdentifier: 'S-1', specimenType: 'blood', status, version: 2 }] })
const execution = (status: string) => ({ id: 'e-1', accessionId: 'acc-1', specimenId: 's-1', requestedTestId: 't-1',
  test: { codeSystem: 'LOINC', code: '718-7', name: 'Haemoglobin' }, patientId: 'p', facilityId: 'facility-1', status: 'completed',
  method: null, startedAt: '2026-10-21T10:00:00.000Z', completedAt: '2026-10-21T11:00:00.000Z', version: 2,
  result: { id: 'r-1', executionId: 'e-1', status, verificationStatus: 'unverified', currentVersion: 1, currentReleasedVersion: null,
    revisions: [{ version: 1, resultType: 'numeric', numericValue: 6.9, textValue: null, unit: '%', referenceRange: null,
      abnormalFlag: 'high', entrySource: 'manual', verificationStatus: 'unverified', releaseStatus: 'not_released',
      enteredAt: '2026-10-21T11:00:00.000Z', releasedAt: null, correctionReason: null }] } })

const READ_ONLY = 'This order from another facility has ended: nothing more can be recorded on it. You can still read what was '
  + 'recorded on it.'
const CLOSED = 'This order from another facility no longer lets you record on it: it has ended, or its time for work is over. '
  + 'You can still read what was recorded. Refresh the list.'
const WRITES = ['Record step', 'Start execution', 'Complete execution', 'Record unverified result', 'Record new revision',
  'Verify result version', 'Release result version']

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_HID_BACKEND_CONTRACT', 'novu-v1')
  working.permissions = LAB
  routes.incoming.mockResolvedValue({ items: [], crossFacilityOrders: true, crossFacilityWork: true, receives: true })
  forgetReceiving(); forgetCannotCompleteServed(); forgetLateCorrectionServed(); forgetWrongPatientServed()
})
afterEach(() => {
  vi.unstubAllEnvs(); forgetReceiving(); forgetCannotCompleteServed(); forgetLateCorrectionServed(); forgetWrongPatientServed()
})

async function openAccession(name = 'Haemoglobin') {
  render(<MemoryRouter><Laboratory /></MemoryRouter>)
  const row = (await screen.findByText(name)).closest('.staff-list-item') as HTMLElement
  fireEvent.click(within(row).getByRole('button', { name: 'Open accession' }))
  const card = (await screen.findByRole('heading', { name: 'Specimen accession' })).closest('.staff-card') as HTMLElement
  await within(card).findByText('Accession ACC-1')
  return { row, card }
}
const buttons = (area: HTMLElement) => within(area).queryAllByRole('button').map(button => button.textContent)

describe('the accession of an order that no longer lets this laboratory record on it (UX-1)', () => {
  it('offers no specimen step on an order it couldn’t complete, and says it is there to be read', async () => {
    api.labWorkItems.mockResolvedValue(answer(item({ specimenStatuses: ['collected'], orderRoute: card(ENDED) })))
    api.labAccession.mockResolvedValue(accession('collected'))
    const { row, card: shown } = await openAccession()
    expect(within(row).getByText(/Nothing more can be recorded on it\./)).toBeTruthy()
    expect(within(shown).getByText(READ_ONLY)).toBeTruthy()
    expect(buttons(shown)).toEqual(['Refresh accession'])
    expect(within(shown).queryByRole('combobox', { name: 'Next step' })).toBeNull()
    expect(api.transitionSpecimen).not.toHaveBeenCalled()
  })

  it('offers no execution or result write on a received specimen there, and keeps what can be read', async () => {
    api.labWorkItems.mockResolvedValue(answer(item({ orderRoute: card(ENDED) })))
    api.labAccession.mockResolvedValue(accession('received'))
    api.labExecutions.mockResolvedValue({ items: [execution('entered_unverified')] })
    const { card: shown } = await openAccession()
    await within(shown).findByText('Manual result · version 1')
    for (const write of WRITES) expect(within(shown).queryByRole('button', { name: write }), write).toBeNull()
    expect(within(shown).queryByText('Correct or amend result')).toBeNull()
    expect(buttons(shown)).toEqual(['Refresh executions', 'View result history', 'Refresh accession'])
    expect(within(shown).getByText(READ_ONLY)).toBeTruthy()
  })

  it('is the same on an order cancelled because it changed, whose reads are kept too', async () => {
    api.labWorkItems.mockResolvedValue(answer(item({ orderRoute: card({ ...ENDED, endedKind: 'order_changed' }) })))
    api.labAccession.mockResolvedValue(accession('received'))
    api.labExecutions.mockResolvedValue({ items: [execution('verified_not_released')] })
    const { card: shown } = await openAccession()
    await within(shown).findByText('Manual result · version 1')
    expect(within(shown).queryByRole('button', { name: 'Release result version' })).toBeNull()
    expect(within(shown).getByText(READ_ONLY)).toBeTruthy()
  })

  it('leaves an open order’s accession as it was', async () => {
    api.labWorkItems.mockResolvedValue(answer(item()))
    api.labAccession.mockResolvedValue(accession('received'))
    api.labExecutions.mockResolvedValue({ items: [execution('entered_unverified')] })
    const { card: shown } = await openAccession()
    expect(await within(shown).findByRole('button', { name: 'Verify result version' })).toBeTruthy()
    expect(within(shown).getByText('Correct or amend result')).toBeTruthy()
    expect(within(shown).queryByText(READ_ONLY)).toBeNull()
  })

  it('says a write refused as not found for writing on routed work is the order closing, not a missing record', async () => {
    // The order ended elsewhere while its accession was open: the services answer 404 for writing.
    api.labWorkItems.mockResolvedValue(answer(item({ specimenStatuses: ['collected'] })))
    api.labAccession.mockResolvedValue(accession('collected'))
    api.transitionSpecimen.mockRejectedValue(new HidApiError(404, 'Lab specimen was not found', { code: 'LAB_SPECIMEN_NOT_FOUND' }))
    const { card: shown } = await openAccession()
    fireEvent.click(within(shown).getByRole('button', { name: 'Record step' }))
    expect(await within(shown).findByText(CLOSED)).toBeTruthy()
    expect(within(shown).queryByText('Lab specimen was not found')).toBeNull()
  })

  it('says the same for a verification refused that way', async () => {
    api.labWorkItems.mockResolvedValue(answer(item()))
    api.labAccession.mockResolvedValue(accession('received'))
    api.labExecutions.mockResolvedValue({ items: [execution('entered_unverified')] })
    api.verifyLabResult.mockRejectedValue(new HidApiError(404, 'Lab result was not found', { code: 'LAB_RESULT_NOT_FOUND' }))
    const { card: shown } = await openAccession()
    const verify = await within(shown).findByRole('button', { name: 'Verify result version' })
    fireEvent.change(within(shown).getByLabelText(/Verification reason/), { target: { value: 'Checked against the control' } })
    fireEvent.click(verify)
    await waitFor(() => expect(api.verifyLabResult).toHaveBeenCalledTimes(1))
    expect(await within(shown).findByText(CLOSED)).toBeTruthy()
  })

  it('keeps the service’s own words for this facility’s own work', async () => {
    api.labWorkItems.mockResolvedValue(answer(local()))
    api.labAccession.mockResolvedValue(accession('collected'))
    api.transitionSpecimen.mockRejectedValue(new HidApiError(404, 'Lab specimen was not found', { code: 'LAB_SPECIMEN_NOT_FOUND' }))
    const { card: shown } = await openAccession('Malaria parasite')
    fireEvent.click(within(shown).getByRole('button', { name: 'Record step' }))
    expect(await within(shown).findByText(SAID_NOT_FOUND)).toBeTruthy()
    expect(document.body.textContent).not.toContain('Lab specimen was not found')
    expect(within(shown).queryByText(CLOSED)).toBeNull()
  })
})
