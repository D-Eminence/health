import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXPORT_PRIVACY, onScreenOnly, OutreachExport } from '../../../../ehr-blue/departments/outreach/OutreachExport'
import type { OutreachCase } from '../../../../staff/api'

/*
 * "Export" on Outreach: a real button, a dialog that asks for the file type and says how to keep the file, a file only
 * on Export, focus back on the button, and nothing to press when there is nothing to export. The Excel, Word and PDF
 * makers (and their libraries) are stood in for here; outreachExport.test.ts checks what they write. Fictional data.
 */

const saved = vi.hoisted(() => ({ saveFile: vi.fn() }))
vi.mock('../../../../download', () => saved)
const files = vi.hoisted(() => ({
  xlsxBytes: vi.fn(async () => new Uint8Array([1])),
  docxBytes: vi.fn(async () => new Uint8Array([2])),
  pdfBytes: vi.fn(async () => new Uint8Array([3]).buffer),
}))
vi.mock('../../../../ehr-blue/departments/outreach/outreachExportFiles', () => files)
const api = vi.hoisted(() => ({ recordOutreachExport: vi.fn(), outreachCasesPage: vi.fn() }))
vi.mock('../../../../staff/api', () => ({ staffApi: api }))
vi.mock('../../../../ehr-blue/departments/parts/access', () => ({ useDeptAccess: () => ({ facilityId: 'facility-demo-1' }) }))

const CASES: OutreachCase[] = [
  { id: 'case-1', campaignId: 'campaign-1', status: 'identity_resolution_pending', fullName: 'Patient One', ageYears: 34, sex: 'female',
    phone: '+2348000000001', createdAt: '2026-11-14T08:30:00.000Z', rowVersion: 1 },
  { id: 'case-2', campaignId: 'campaign-2', status: 'identity_resolved', fullName: 'Patient Two', ageYears: 51, sex: 'male',
    createdAt: '2026-11-14T08:00:00.000Z', rowVersion: 1 },
]
const NAMES: Record<string, string> = { 'campaign-1': 'Demo Screening Week', 'campaign-2': 'Demo follow-up' }
const campaignOf = (id: string | undefined) => (id && NAMES[id] ? { name: NAMES[id] } : undefined)

beforeEach(() => {
  api.recordOutreachExport.mockResolvedValue(undefined)
  api.outreachCasesPage.mockResolvedValue({ items: CASES, nextCursor: null })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 14, 9, 0))
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

async function press(button: HTMLElement) {
  button.focus()
  await act(async () => { fireEvent.click(button) })
}
const exportButton = () => screen.getByRole('button', { name: 'Export' })
const dialog = () => screen.getByRole('dialog', { name: 'Export registrations' })

describe('Outreach export', () => {
  it('asks for the file type and says how to keep the file before anything is saved', async () => {
    render(<OutreachExport cases={CASES} campaignOf={campaignOf} />)
    const button = exportButton()
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('aria-haspopup')).toBe('dialog')
    await press(button)
    const box = dialog()
    expect(within(box).getByText(/^The file holds every registration from every campaign you can see\. They are read from Health ID first/)).toBeTruthy()
    expect(within(box).getByText(EXPORT_PRIVACY)).toBeTruthy()
    expect(EXPORT_PRIVACY).toBe('This file contains people’s personal and health information. Keep it safe and delete it when you’re done.')
    const group = within(box).getByRole('group', { name: 'File type' })
    expect(within(group).getAllByRole('radio').map(radio => (radio as HTMLInputElement).value)).toEqual(['csv', 'xlsx', 'docx', 'pdf'])
    // Keyboard first: the dialog opens on the chosen file type.
    expect(document.activeElement).toBe(within(group).getByRole('radio', { name: /^CSV/ }))
    expect(saved.saveFile).not.toHaveBeenCalled()
  })

  it('saves nothing on Cancel, and gives focus back to Export', async () => {
    render(<OutreachExport cases={CASES} campaignOf={campaignOf} />)
    await press(exportButton())
    await press(within(dialog()).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(saved.saveFile).not.toHaveBeenCalled()
    expect(api.recordOutreachExport).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(exportButton())
  })

  it('closes on Escape without saving', async () => {
    render(<OutreachExport cases={CASES} campaignOf={campaignOf} />)
    await press(exportButton())
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(saved.saveFile).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(exportButton())
  })

  it('saves a CSV of every registration it was given, named for the day', async () => {
    render(<OutreachExport cases={CASES} campaignOf={campaignOf} />)
    await press(exportButton())
    await press(within(dialog()).getByRole('button', { name: 'Export' }))
    expect(saved.saveFile).toHaveBeenCalledTimes(1)
    const [blob, name] = saved.saveFile.mock.calls[0] as [Blob, string]
    expect(name).toBe('outreach-all-registrations-2026-11-14.csv')
    const csv = await blob.text()
    expect(csv).toContain('Full name,Sex,Age (years),Phone number,Campaign,Registered on,Status')
    expect(csv).toContain('Patient One,Female,34,\'+2348000000001,Demo Screening Week,')
    expect(csv).toContain('Patient Two,Male,51,,Demo follow-up,')
    expect(csv).not.toContain('case-1')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(exportButton())
    expect(files.xlsxBytes).not.toHaveBeenCalled()
    // Outreach is told, after the file is saved, for its audit: no campaign named when every campaign is exported.
    expect(api.recordOutreachExport).toHaveBeenCalledTimes(1)
    expect(api.recordOutreachExport).toHaveBeenCalledWith('facility-demo-1', { format: 'csv', count: 2 })
    expect(saved.saveFile.mock.invocationCallOrder[0]).toBeLessThan(api.recordOutreachExport.mock.invocationCallOrder[0]!)
  })

  it.each([
    ['Excel (.xlsx)', 'xlsx', files.xlsxBytes],
    ['Word (.docx)', 'docx', files.docxBytes],
    ['PDF', 'pdf', files.pdfBytes],
  ] as const)('makes %s with its own maker, for a campaign only its registrations', async (label, extension, maker) => {
    render(<OutreachExport cases={CASES} campaign={{ id: 'campaign-1', name: 'Demo Screening Week' }} campaignOf={campaignOf} />)
    await press(exportButton())
    expect(within(dialog()).getByText(/^The file holds every registration in Demo Screening Week\./)).toBeTruthy()
    await act(async () => { fireEvent.click(within(dialog()).getByRole('radio', { name: new RegExp(`^${label.replace(/[().]/g, '\\$&')}`) })) })
    await press(within(dialog()).getByRole('button', { name: 'Export' }))
    expect(maker).toHaveBeenCalledTimes(1)
    const [table, meta] = maker.mock.calls[0] as unknown as [{ rows: string[][] }, { title: string }]
    expect(table.rows.map(row => row[0])).toEqual(['Patient One'])
    expect(meta.title).toBe('Outreach registrations: Demo Screening Week')
    const [, name] = saved.saveFile.mock.calls[0] as [Blob, string]
    expect(name).toBe(`outreach-demo-screening-week-2026-11-14.${extension}`)
    expect(api.recordOutreachExport).toHaveBeenCalledWith('facility-demo-1', { format: extension, count: 1, campaignId: 'campaign-1' })
    expect(api.outreachCasesPage).toHaveBeenCalledWith('facility-demo-1', { limit: 500, before: undefined, campaignId: 'campaign-1' })
  })

  it.each([
    ['an older Outreach (404)', () => Promise.reject(Object.assign(new Error('Not found'), { status: 404 }))],
    ['an older Outreach (405)', () => Promise.reject(Object.assign(new Error('Method not allowed'), { status: 405 }))],
    ['a lost connection', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['an answer that never comes', () => new Promise(() => {})],
    ['a call that throws at once', () => { throw new Error('boom') }],
  ])('saves the file and says nothing more when recording the export meets %s', async (_, answer) => {
    api.recordOutreachExport.mockImplementation(answer)
    render(<OutreachExport cases={CASES} campaignOf={campaignOf} />)
    await press(exportButton())
    await press(within(dialog()).getByRole('button', { name: 'Export' }))
    await act(async () => { await Promise.resolve() })
    expect(saved.saveFile).toHaveBeenCalledTimes(1)
    expect(api.recordOutreachExport).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.activeElement).toBe(exportButton())
  })

  it('says when the file could not be made, and keeps the dialog open', async () => {
    files.pdfBytes.mockRejectedValueOnce(new Error('no memory'))
    render(<OutreachExport cases={CASES} campaignOf={campaignOf} />)
    await press(exportButton())
    await act(async () => { fireEvent.click(within(dialog()).getByRole('radio', { name: /^PDF/ })) })
    await press(within(dialog()).getByRole('button', { name: 'Export' }))
    expect(within(dialog()).getByRole('alert').textContent).toMatch(/The file could not be made\. Try again/)
    expect(saved.saveFile).not.toHaveBeenCalled()
    expect(api.recordOutreachExport).not.toHaveBeenCalled()
  })

  it('reads every page first, following the cursor, and says how many rows it is preparing', async () => {
    const page = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ ...CASES[1]!, id: `case-p${from + i}`,
      fullName: `Patient ${from + i}`, createdAt: new Date(Date.UTC(2026, 10, 14, 8, 0) - (from + i) * 60_000).toISOString() }))
    api.outreachCasesPage
      .mockResolvedValueOnce({ items: page(1, 500), nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({ items: page(501, 1000), nextCursor: 'cursor-3' })
      .mockResolvedValueOnce({ items: page(1001, 1030), nextCursor: null })
    let release!: () => void
    files.xlsxBytes.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(new Uint8Array([1])) }))
    render(<OutreachExport cases={CASES} campaignOf={campaignOf} />)
    await press(exportButton())
    await act(async () => { fireEvent.click(within(dialog()).getByRole('radio', { name: /^Excel/ })) })
    await press(within(dialog()).getByRole('button', { name: 'Export' }))
    expect(api.outreachCasesPage.mock.calls.map(call => call[1])).toEqual([
      { limit: 500, before: undefined }, { limit: 500, before: 'cursor-2' }, { limit: 500, before: 'cursor-3' },
    ])
    expect(within(dialog()).getByText('Preparing 1030 rows…')).toBeTruthy()
    await act(async () => { release() })
    const [table] = files.xlsxBytes.mock.calls[0] as unknown as [{ rows: string[][] }]
    expect(table.rows).toHaveLength(1030)
    expect(table.rows[0]![0]).toBe('Patient 1')
    expect(api.recordOutreachExport).toHaveBeenCalledWith('facility-demo-1', { format: 'xlsx', count: 1030 })
    expect(screen.getAllByRole('status').map(status => status.textContent)).not.toContain('Only the latest 100 registrations could be exported.')
  })

  it('stops after 20 pages and says the file holds the first 10,000', async () => {
    let n = 0
    api.outreachCasesPage.mockImplementation(async () => {
      n += 1
      return { items: Array.from({ length: 500 }, (_, i) => ({ ...CASES[1]!, id: `case-${n}-${i}` })), nextCursor: `cursor-${n + 1}` }
    })
    render(<OutreachExport cases={CASES} campaignOf={campaignOf} />)
    await press(exportButton())
    await press(within(dialog()).getByRole('button', { name: 'Export' }))
    expect(api.outreachCasesPage).toHaveBeenCalledTimes(20)
    expect(api.recordOutreachExport).toHaveBeenCalledWith('facility-demo-1', { format: 'csv', count: 10000 })
    expect(screen.getByText('Showing the first 10,000 registrations. The file holds only these.')).toBeTruthy()
  })

  it('warns that only the latest 100 could be exported when an older Outreach sends 100 and no cursor', async () => {
    const hundred = Array.from({ length: 100 }, (_, i) => ({ ...CASES[1]!, id: `case-${i}` }))
    api.outreachCasesPage.mockResolvedValue({ items: hundred, nextCursor: null })
    render(<OutreachExport cases={hundred} campaignOf={campaignOf} />)
    await press(exportButton())
    await press(within(dialog()).getByRole('button', { name: 'Export' }))
    expect(api.outreachCasesPage).toHaveBeenCalledTimes(1)
    expect(saved.saveFile).toHaveBeenCalledTimes(1)
    const note = screen.getByText('Only the latest 100 registrations could be exported.')
    expect(note.getAttribute('role')).toBe('status')
    expect(document.activeElement).toBe(exportButton())
  })

  it('does not warn when fewer than 100 came back with no cursor', async () => {
    render(<OutreachExport cases={CASES} campaignOf={campaignOf} />)
    await press(exportButton())
    await press(within(dialog()).getByRole('button', { name: 'Export' }))
    expect(screen.queryByText(/Only the latest 100/)).toBeNull()
  })

  it('exports what is on screen, and says so, when Health ID cannot be reached', async () => {
    api.outreachCasesPage.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<OutreachExport cases={CASES} campaignOf={campaignOf} />)
    await press(exportButton())
    await press(within(dialog()).getByRole('button', { name: 'Export' }))
    expect(saved.saveFile).toHaveBeenCalledTimes(1)
    expect(api.recordOutreachExport).toHaveBeenCalledWith('facility-demo-1', { format: 'csv', count: 2 })
    expect(screen.getByText(onScreenOnly(2))).toBeTruthy()
    expect(onScreenOnly(2)).toBe('Health ID couldn’t be reached, so the file holds only the 2 registrations on this screen.')
  })

  it.each([
    ['no registrations', [] as OutreachCase[], undefined, 'No registrations to export'],
    ['none in this campaign', CASES, { id: 'campaign-9', name: 'Empty' }, 'No registrations to export'],
    ['the list not read yet', null, undefined, 'Registrations not loaded yet'],
  ])('opens nothing with %s, and says why', async (_, cases, campaign, reason) => {
    render(<OutreachExport cases={cases} campaign={campaign} campaignOf={campaignOf} />)
    const button = exportButton()
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent).toBe(reason)
    expect(screen.getByText(reason)).toBeTruthy()
    await press(button)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(saved.saveFile).not.toHaveBeenCalled()
  })
})
