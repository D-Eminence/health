import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HealthIdCode } from '../routes/HealthIdCode'
import { described } from './portalHarness'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

// The status line is always there (empty until a copy), so a test waits for what it says, not for the line itself:
// found at once, it was read before the copy's answer had been drawn, and failed now and then.

describe('the Health ID on the profile and the dashboard', () => {
  it('is plain text with no Copy HID button, and a click copies exactly the code', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(<HealthIdCode code="HID-AB2C3D" />)
    const code = screen.getByText('HID-AB2C3D')
    expect(code.className).toBe('patient-hid-code patient-hid-plain')
    // The code itself is what copies: its name is the code, and there is no separate Copy HID control.
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['HID-AB2C3D'])
    expect(screen.queryByRole('button', { name: /Copy HID/ })).toBeNull()
    expect(writeText).not.toHaveBeenCalled()

    fireEvent.click(code)

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Health ID copied.'))
    expect(writeText).toHaveBeenCalledWith('HID-AB2C3D')
  })

  it.each(['Enter', ' '])('can be reached and copied from the keyboard (%j)', async key => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(<HealthIdCode code="HID-AB2C3D" />)
    const code = screen.getByText('HID-AB2C3D')
    code.focus()
    expect(document.activeElement).toBe(code)

    fireEvent.keyDown(code, { key })

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Health ID copied.'))
    expect(writeText).toHaveBeenCalledWith('HID-AB2C3D')
  })

  it('does not copy on other keys', () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(<HealthIdCode code="HID-AB2C3D" />)
    fireEvent.keyDown(screen.getByText('HID-AB2C3D'), { key: 'Tab' })
    expect(writeText).not.toHaveBeenCalled()
  })

  it('says how to copy by hand when the browser refuses', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => { throw new Error('denied') }) } })
    render(<HealthIdCode code="HID-AB2C3D" />)
    fireEvent.click(screen.getByText('HID-AB2C3D'))
    expect((await screen.findByRole('alert')).textContent).toContain('Press and hold your Health ID to copy it')
  })

  // HCS-23: a screen reader user hears what the control does, not only the code; the visible code stays its name.
  it('tells assistive technology that pressing it copies the Health ID', () => {
    render(<HealthIdCode code="HID-AB2C3D" />)
    const code = screen.getByRole('button', { name: 'HID-AB2C3D' })
    expect(described(code)).toBe('Copies your Health ID')
  })

  // HCS-23: "Health ID copied." is printed on the card; it says so for a few seconds, not for as long as the page is open.
  it('clears "Health ID copied." after a few seconds', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => {}) } })
    render(<HealthIdCode code="HID-AB2C3D" />)
    await act(async () => { fireEvent.click(screen.getByText('HID-AB2C3D')) })
    expect(screen.getByRole('status').textContent).toBe('Health ID copied.')
    await act(async () => { vi.advanceTimersByTime(2_000) })
    expect(screen.getByRole('status').textContent).toBe('Health ID copied.')
    await act(async () => { vi.advanceTimersByTime(1_500) })
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('keeps the advice to copy by hand on screen: it is not timed out', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => { throw new Error('denied') }) } })
    render(<HealthIdCode code="HID-AB2C3D" />)
    await act(async () => { fireEvent.click(screen.getByText('HID-AB2C3D')) })
    await act(async () => { vi.advanceTimersByTime(10_000) })
    expect(screen.getByRole('alert').textContent).toContain('Press and hold your Health ID to copy it')
  })

  it('stops its timer when it is no longer shown', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => {}) } })
    const { unmount } = render(<HealthIdCode code="HID-AB2C3D" />)
    await act(async () => { fireEvent.click(screen.getByText('HID-AB2C3D')) })
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('the Health ID on the sign-up screens (as hid-1.0)', () => {
  it('shows the code and copies exactly the code when asked', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(<HealthIdCode code="HID-AB2C3D" copyButton />)
    // Kasuwa: the code large in its own box, beside a Copy button that names what it copies.
    expect(screen.getByText('HID-AB2C3D').tagName).toBe('STRONG')
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Copy your Health ID'])
    expect(writeText).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Copy your Health ID' }))

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Health ID copied.'))
    expect(writeText).toHaveBeenCalledWith('HID-AB2C3D')
    expect(screen.getByRole('button', { name: 'Copied your Health ID' })).toBeTruthy()
  })

  it('says how to copy by hand when the browser refuses', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => { throw new Error('denied') }) } })
    render(<HealthIdCode code="HID-AB2C3D" copyButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy your Health ID' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Press and hold it to copy, or write it down.')
    expect(screen.getByRole('button', { name: 'Copy your Health ID' })).toBeTruthy()
  })

  it('says how to copy by hand when the browser has no clipboard', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined })
    render(<HealthIdCode code="HID-AB2C3D" copyButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy your Health ID' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  // HCS-23: the button says "Copied" for a few seconds, then offers to copy again.
  it('offers Copy again a few seconds after copying', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => {}) } })
    render(<HealthIdCode code="HID-AB2C3D" copyButton />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy your Health ID' })) })
    expect(screen.getByRole('button', { name: 'Copied your Health ID' })).toBeTruthy()
    await act(async () => { vi.advanceTimersByTime(3_500) })
    expect(screen.getByRole('button', { name: 'Copy your Health ID' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('')
  })

  // SO-14: at 320px the new Health ID broke at its hyphen ("HID-" / "SMP4821"), on the one screen that may not show it
  // again. It stays on one line, a little smaller on a narrow screen, and Copy goes under it when they do not fit side by
  // side. (jsdom lays nothing out: the classes that do it are checked.)
  it('keeps the Health ID on one line on a narrow screen, with Copy under it when both do not fit', () => {
    render(<HealthIdCode code="HID-SMP4821" copyButton />)
    const code = screen.getByText('HID-SMP4821')
    expect(code.className.split(' ')).toEqual(expect.arrayContaining(['whitespace-nowrap', 'text-[clamp(18px,6vw,22px)]']))
    expect(code.className).not.toMatch(/(^| )text-\[22px\]( |$)/)
    expect(code.parentElement!.className.split(' ')).toContain('flex-wrap')
  })

  it('shows nothing, and offers nothing to copy, when there is no code', () => {
    const { container } = render(<HealthIdCode code="" copyButton />)
    expect(container.innerHTML).toBe('')
    expect(screen.queryByRole('button', { name: 'Copy your Health ID' })).toBeNull()
  })
})
