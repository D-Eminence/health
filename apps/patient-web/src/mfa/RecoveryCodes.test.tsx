import { createRef, type ButtonHTMLAttributes } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { RecoveryCodes } from './RecoveryCodes'

const download = vi.hoisted(() => ({ saveFile: vi.fn() }))
vi.mock('../download', () => download)

const CODES = ['ABCDE-FGHJK', 'MNPQR-STVWX', '01234-56789']
const CLASSES = { root: 'p-recovery', list: 'p-codes', actions: 'p-actions', success: 'p-success', error: 'p-error', checkbox: 'p-checkbox' }

/** A portal's own button: the shared steps render each action with it. */
function PortalButton({ primary, ...rest }: { primary?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" data-primary={primary ? 'yes' : 'no'} {...rest} />
}

function show(props: Partial<Parameters<typeof RecoveryCodes>[0]> = {}) {
  const onDone = vi.fn()
  render(<RecoveryCodes codes={CODES} onDone={onDone} fileName="hid-portal-recovery-codes.txt" headingId="portal-recovery-title"
    classNames={CLASSES} Button={PortalButton} {...props} />)
  return onDone
}

afterEach(() => { vi.unstubAllGlobals() })

describe('recovery codes, shown once', () => {
  it('lists every code and says how many there are, what each does, and what the portal says they cannot do', () => {
    show({ limits: 'They can’t be used for important actions.' })
    const section = screen.getByRole('region', { name: 'Save your backup codes' })
    expect(section.className).toBe('p-recovery')
    expect(screen.getByRole('heading', { level: 2, name: 'Save your backup codes' }).id).toBe('portal-recovery-title')
    expect(screen.getByText(/^These 3 codes are shown only now\./).textContent).toBe('These 3 codes are shown only now. Each one signs you in once '
      + 'if you lose your phone. They can’t be used for important actions. Write them down or print them, and keep them where only you can reach.')
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(CODES)
    expect(screen.getByRole('list').className).toBe('p-codes')
  })

  it('says nothing of limits a portal does not name', () => {
    show()
    expect(screen.getByText(/^These 3 codes/).textContent).toBe('These 3 codes are shown only now. Each one signs you in once '
      + 'if you lose your phone. Write them down or print them, and keep them where only you can reach.')
  })

  it('continues only once the person says the codes are stored', () => {
    const onDone = show({ doneLabel: 'Continue to the workspace' })
    const proceed = screen.getByRole('button', { name: 'Continue to the workspace' })
    expect(proceed).toHaveProperty('disabled', true)
    expect(proceed.dataset.primary).toBe('yes')
    fireEvent.click(proceed)
    expect(onDone).not.toHaveBeenCalled()
    const stored = screen.getByLabelText('I have saved these backup codes somewhere safe')
    expect(stored.closest('label')?.className).toBe('p-checkbox')
    fireEvent.click(stored)
    fireEvent.click(proceed)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('copies the codes, one per line, and says so', async () => {
    const writeText = vi.fn(async (_text: string) => undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    show()
    const copy = screen.getByRole('button', { name: 'Copy codes' })
    expect(copy.dataset.primary).toBe('no')
    expect(copy.parentElement?.className).toBe('p-actions')
    fireEvent.click(copy)
    const copied = await screen.findByRole('status')
    expect(copied.textContent).toBe('Codes copied.')
    expect(copied.className).toBe('p-success')
    expect(writeText).toHaveBeenCalledWith('ABCDE-FGHJK\nMNPQR-STVWX\n01234-56789\n')
  })

  it('offers download or writing them down when the browser refuses to copy', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => { throw new Error('denied') }) } })
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Copy codes' }))
    const refused = await screen.findByRole('alert')
    expect(refused.textContent).toBe('Copying doesn’t work here. Download the codes or write them down.')
    expect(refused.className).toBe('p-error')
  })

  it('downloads the codes as a text file named by the portal', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Download codes' }))
    expect(download.saveFile).toHaveBeenCalledTimes(1)
    const [file, name] = download.saveFile.mock.calls[0] as [Blob, string]
    expect(name).toBe('hid-portal-recovery-codes.txt')
    expect(file.type).toBe('text/plain')
    expect(await file.text()).toBe('ABCDE-FGHJK\nMNPQR-STVWX\n01234-56789\n')
  })

  it('can be the page\'s own step: its heading level, and a heading that takes focus', () => {
    const heading = createRef<HTMLHeadingElement>()
    show({ headingAs: 'h1', headingRef: heading })
    expect(screen.getByRole('heading', { level: 1, name: 'Save your backup codes' })).toBe(heading.current)
    expect(heading.current?.tabIndex).toBe(-1)
  })
})
