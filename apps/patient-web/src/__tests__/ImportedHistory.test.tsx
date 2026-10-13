import { historyFixture } from './importedHistoryFixture'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ImportedHistory } from '../ImportedHistory'
import { parseImportedRecords } from '../importedRecords'

describe('imported medical history', () => {
  it('shows structured values as readable fields and dates without inventing units', () => {
    render(<ImportedHistory records={[{ ...historyFixture[0]!, files: [], versions: [{ ...historyFixture[0]!.versions[0]!,
      structuredData: { medication_name: 'Example medication', dosage: '2', start_date: '2026-06-17',
        prescribing_provider: 'Recorded provider', unknown_date: '2026-02-30', active: false, remaining: 0, empty: null, nested: { follow_up: 'Original instruction' } },
    }] }]} limit={50} />)
    expect(screen.getByText('Medication')).toBeTruthy()
    expect(screen.getByText('Example medication')).toBeTruthy()
    expect(screen.getByText('Dosage')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
    expect(screen.getByText('Start date')).toBeTruthy()
    expect(screen.getByText('17 Jun 2026')).toBeTruthy()
    expect(screen.getByText('Prescribed by')).toBeTruthy()
    expect(screen.getByText('2026-02-30')).toBeTruthy()
    expect(screen.getByText('No')).toBeTruthy()
    expect(screen.getByText('0')).toBeTruthy()
    expect(screen.getByText('Follow up')).toBeTruthy()
    expect(screen.queryByText('Empty')).toBeNull()
    expect(document.querySelector('pre')).toBeNull()
    expect(screen.queryByText(/drug_prescription|medication_name|prescribing_provider/)).toBeNull()
  })
  it('renders arbitrary saved field names as text without inheriting object properties', () => {
    render(<ImportedHistory records={[{ ...historyFixture[0]!, files: [], versions: [{ ...historyFixture[0]!.versions[0]!,
      structuredData: JSON.parse('{"constructor":"Original value","__proto__":{"description":"Original nested value"}}'),
    }] }]} limit={50} />)
    expect(screen.getByText('Constructor')).toBeTruthy()
    expect(screen.getByText('Original value')).toBeTruthy()
    expect(screen.getByText('Original nested value')).toBeTruthy()
  })
  it('shows repeated legacy notes once under a single label', () => {
    render(<ImportedHistory records={[{ ...historyFixture[0]!, files: [], versions: [{ ...historyFixture[0]!.versions[0]!,
      record: 'Notes\n\nOriginal patient note', notes: 'Original patient note', structuredData: null,
    }] }]} limit={50} />)
    expect(screen.getAllByText('Original patient note')).toHaveLength(1)
    expect(screen.getAllByRole('heading', { name: 'Notes' })).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: 'Record' })).toBeNull()
  })
  it('preserves authorship, dates, current content and previous versions without interpreting HTML', () => {
    render(<ImportedHistory records={[...historyFixture, { ...historyFixture[0]!, id: 'record-provider', title: 'Original provider entry', origin: 'provider-authored', files: [] }]} limit={50} />)
    expect(screen.getByText('Patient reported')).toBeTruthy()
    expect(screen.getByText('Provider authored')).toBeTruthy()
    expect(screen.getAllByText('Preserved multiline medical information.')).toHaveLength(2)
    expect(document.querySelector('script')).toBeNull()
    expect(screen.getAllByText('<script>unsafe()</script>')).toHaveLength(2)
    expect(screen.getAllByText('Earlier entry.')).toHaveLength(2)
  })
  it('offers downloads only for cleared files and callers with document access', () => {
    const download = vi.fn()
    const view = render(<ImportedHistory records={historyFixture} limit={50} download={download} />)
    expect(screen.getByRole('button', { name: 'Download cleared.pdf' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /pending.pdf|rejected.pdf/ })).toBeNull()
    expect(download).not.toHaveBeenCalled()
    view.rerender(<ImportedHistory records={historyFixture} limit={50} />)
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull()
    expect(screen.getByText('Document access permission required.')).toBeTruthy()
  })
  it('requests the exact file on demand and refuses unsafe signed links', async () => {
    const download = vi.fn().mockResolvedValue({ url: 'javascript:unsafe()', expiresInSeconds: 60 })
    render(<ImportedHistory records={historyFixture} limit={50} download={download} />)
    fireEvent.click(screen.getByRole('button', { name: 'Download cleared.pdf' }))
    await screen.findByRole('alert')
    expect(download).toHaveBeenCalledWith('file-clean', expect.any(AbortSignal))
    expect(screen.getByRole('alert').textContent).toMatch(/invalid/)
  })
  it('never opens a late download after the patient scope unmounts', async () => {
    let finish!: (value: { url: string; expiresInSeconds: number }) => void
    const download = vi.fn((_id: string, _signal: AbortSignal) => new Promise<{ url: string; expiresInSeconds: number }>(resolve => { finish = resolve }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const view = render(<ImportedHistory records={historyFixture} limit={50} download={download} />)
    fireEvent.click(screen.getByRole('button', { name: 'Download cleared.pdf' }))
    view.unmount()
    finish({ url: 'https://storage.test/file', expiresInSeconds: 60 })
    await waitFor(() => expect(download.mock.calls[0]![1].aborted).toBe(true))
    expect(click).not.toHaveBeenCalled()
    click.mockRestore()
  })
  it('refuses responses whose current version or download status is invalid', () => {
    expect(() => parseImportedRecords([{ ...historyFixture[0], currentVersionId: 'missing' }])).toThrow()
    expect(() => parseImportedRecords([{ ...historyFixture[0], files: [{ id: 'f', accessStatus: 'unknown' }] }])).toThrow()
    expect(parseImportedRecords(historyFixture)).toEqual(historyFixture)
  })
})
