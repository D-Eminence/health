import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LabOrderReleasedResults, LabResultRevision } from '../../../staff/api'
import { ReleasedResults } from '../../../ehr-blue/clinical/emergency/ReleasedResults'

/**
 * The released results of a lab request, as the emergency summary shows them to the clinician: a version the scientist
 * who entered it also checked (One-person lab, owner decision 33.3) says so. The released view never carries the reason.
 */
const api = vi.hoisted(() => ({ labReleasedResultsForOrder: vi.fn() }))
vi.mock('../../../staff/api', () => ({ staffApi: api }))

const SAME = 'Checked by the same scientist who entered it'
const revision = (overrides: Partial<LabResultRevision> = {}): LabResultRevision => ({
  version: 1, resultType: 'numeric', numericValue: 7.1, textValue: null, unit: 'g/dL', referenceRange: '12.0-15.5',
  abnormalFlag: 'low', entrySource: 'manual', verificationStatus: 'verified', releaseStatus: 'released',
  enteredAt: '2026-10-09T10:00:00.000Z', releasedAt: '2026-10-09T12:00:00.000Z', correctionReason: null, ...overrides,
})
const released = (revisions: LabResultRevision[]): LabOrderReleasedResults => ({
  workItemId: 'work-item-1', sourceEhrOrderId: 'lab-2', sourceEhrOrderVersion: 1, patientId: 'patient-1', acceptedAt: '2026-10-09T08:00:00.000Z',
  test: { codeSystem: 'LOINC', code: '718-7', name: 'Hemoglobin' },
  results: [{ id: 'result-1', executionId: 'execution-1', status: 'released', verificationStatus: 'verified', currentVersion: revisions.length,
    currentReleasedVersion: revisions.length, revisions }],
})

async function show() {
  render(<ReleasedResults facilityId="facility-1" requestId="lab-2" />)
  fireEvent.click(screen.getByRole('button', { name: 'Show results' }))
  await screen.findByText('Version 1')
}

beforeEach(() => { vi.clearAllMocks() })

describe('released results and the one-person lab mark', () => {
  it('says a version was checked by the same scientist who entered it', async () => {
    api.labReleasedResultsForOrder.mockResolvedValue(released([revision({ checkedBySamePerson: true }), revision({ version: 2, checkedBySamePerson: false })]))
    await show()
    expect(screen.getAllByText(SAME)).toHaveLength(1)
    expect(screen.queryByText(/Their reason/)).toBeNull()
  })

  it('shows the reason too if a reader is ever sent it', async () => {
    api.labReleasedResultsForOrder.mockResolvedValue(released([revision({ checkedBySamePerson: true, selfCheckReason: 'Only scientist on duty' })]))
    await show()
    expect(screen.getByText(SAME)).toBeTruthy()
    expect(screen.getByText('Their reason: Only scientist on duty')).toBeTruthy()
  })

  it.each([['absent (an older image)', {}], ['false', { checkedBySamePerson: false }], ['null', { checkedBySamePerson: null }]])(
    'says nothing of it when the mark is %s', async (_, mark) => {
      api.labReleasedResultsForOrder.mockResolvedValue(released([revision(mark)]))
      await show()
      expect(screen.queryByText(SAME)).toBeNull()
    })
})
