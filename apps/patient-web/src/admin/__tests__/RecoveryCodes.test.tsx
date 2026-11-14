import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { RecoveryCodes } from '../RecoveryCodes'

// The console's own download module and the one shared with the provider portal, whichever saves the file.
const download = vi.hoisted(() => ({ saveFile: vi.fn() }))
vi.mock('../download', () => download)
vi.mock('../../download', () => download)

const CODES = ['ABCDE-FGHJK', 'MNPQR-STVWX']

afterEach(() => { vi.unstubAllGlobals() })

/** The console's recovery codes as administrators see them, whichever module draws them. */
describe('platform recovery codes', () => {
  it('keep the console\'s wording, markup and classes', () => {
    render(<RecoveryCodes codes={CODES} onDone={vi.fn()} doneLabel="Done" />)
    const section = screen.getByRole('region', { name: 'Save your recovery codes' })
    expect(section.className).toBe('admin-recovery')
    expect(screen.getByRole('heading', { level: 2, name: 'Save your recovery codes' }).id).toBe('admin-recovery-title')
    expect(section.querySelector('p')?.textContent).toBe('These 2 codes are shown only now. Each one signs you in once if you lose your '
      + 'authenticator. They cannot confirm high-risk actions. Store them offline, somewhere only you can reach.')
    expect(screen.getByRole('list').className).toBe('admin-recovery-codes')
    expect(screen.getAllByRole('listitem').map(item => item.innerHTML)).toEqual(CODES.map(code => `<code>${code}</code>`))
    expect(screen.getByRole('button', { name: 'Copy codes' }).className).toBe('admin-secondary')
    expect(screen.getByRole('button', { name: 'Download codes' }).className).toBe('admin-secondary')
    expect(screen.getByRole('button', { name: 'Copy codes' }).parentElement?.className).toBe('admin-action-row')
    expect(screen.getByLabelText('I have stored these recovery codes somewhere safe').closest('label')?.className).toBe('admin-checkbox')
    const done = screen.getByRole('button', { name: 'Done' })
    expect(done.className).toBe('admin-primary')
    expect(done).toHaveProperty('disabled', true)
    expect(section.querySelectorAll('button').length).toBe(3)
    for (const button of section.querySelectorAll('button')) expect(button.getAttribute('type')).toBe('button')
  })

  it('save as the console\'s file and say a copy with the console\'s classes', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => undefined) } })
    render(<RecoveryCodes codes={CODES} onDone={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Download codes' }))
    expect(download.saveFile).toHaveBeenCalledWith(expect.any(Blob), 'hid-admin-recovery-codes.txt')
    fireEvent.click(screen.getByRole('button', { name: 'Copy codes' }))
    expect((await screen.findByRole('status')).className).toBe('admin-success')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
  })
})
