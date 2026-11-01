import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { ImportedPatientHistory } from '../ImportedPatientHistory'
import { historyFixture } from '../../../__tests__/importedHistoryFixture'

const api = vi.hoisted(() => ({ importedRecords: vi.fn(), importedAttachment: vi.fn() }))
vi.mock('../../api', () => ({ staffApi: api }))
vi.mock('../../env', () => ({ getEnvironment: () => ({ name: 'local' }) }))

describe('hospital imported medical history', () => {
  it('loads history independently of encounters with the selected facility, patient and purpose', async () => {
    api.importedRecords.mockResolvedValue({ importedRecords: historyFixture, limit: 50 })
    render(<ImportedPatientHistory facilityId="facility-a" patientId="patient-a" purpose="direct-care" canDownload={false} verify={vi.fn()} />)
    expect(await screen.findByText('Preserved report')).toBeTruthy()
    expect(api.importedRecords).toHaveBeenCalledWith('facility-a', 'patient-a', 'direct-care', expect.any(AbortSignal))
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull()
  })
  it('shows a refusal rather than retaining records when consent is denied', async () => {
    api.importedRecords.mockRejectedValue(new Error('Patient access has ended.'))
    render(<ImportedPatientHistory facilityId="facility-a" patientId="patient-a" purpose="direct-care" canDownload={true} verify={vi.fn()} />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('Preserved report')).toBeNull()
  })
  it('discards the previous patient’s late response after switching scope', async () => {
    let finish!: (value: unknown) => void
    api.importedRecords.mockImplementation((_f: string, patient: string) => patient === 'patient-a'
      ? new Promise(resolve => { finish = resolve }) : Promise.resolve({ importedRecords: [], limit: 50 }))
    const view = render(<ImportedPatientHistory key="a" facilityId="facility-a" patientId="patient-a" purpose="direct-care" canDownload={false} verify={vi.fn()} />)
    await waitFor(() => expect(finish).toBeTypeOf('function'))
    view.rerender(<ImportedPatientHistory key="b" facilityId="facility-b" patientId="patient-b" purpose="direct-care" canDownload={false} verify={vi.fn()} />)
    await screen.findByText('No older records.')
    await act(async () => finish({ importedRecords: historyFixture, limit: 50 }))
    expect(screen.queryByText('Preserved report')).toBeNull()
  })
})
