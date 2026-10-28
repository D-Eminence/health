import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { HealthIdCode } from '../routes/HealthIdCode'

afterEach(() => { vi.unstubAllGlobals() })

describe('the Health ID on the profile and the dashboard', () => {
  it('is plain text with no Copy HID button, and a click copies exactly the code', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(<HealthIdCode code="HID-AB2C3D" />)
    const code = screen.getByText('HID-AB2C3D')
    expect(code.className).toBe('patient-hid-code patient-hid-plain')
    expect(screen.queryByRole('button')).toBeNull()
    expect(writeText).not.toHaveBeenCalled()

    fireEvent.click(code)

    expect((await screen.findByRole('status')).textContent).toBe('Health ID copied.')
    expect(writeText).toHaveBeenCalledWith('HID-AB2C3D')
  })

  it('says how to copy by hand when the browser refuses', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => { throw new Error('denied') }) } })
    render(<HealthIdCode code="HID-AB2C3D" />)
    fireEvent.click(screen.getByText('HID-AB2C3D'))
    expect((await screen.findByRole('alert')).textContent).toContain('Press and hold your Health ID to copy it')
  })
})

describe('the Health ID on the sign-up screens (as hid-1.0)', () => {
  it('shows the code and copies exactly the code when asked', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(<HealthIdCode code="HID-AB2C3D" copyButton />)
    expect(screen.getByText('HID-AB2C3D').className).toBe('patient-hid-code')
    expect(writeText).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Copy HID' }))

    expect((await screen.findByRole('status')).textContent).toBe('Health ID copied.')
    expect(writeText).toHaveBeenCalledWith('HID-AB2C3D')
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
  })

  it('says how to copy by hand when the browser refuses', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => { throw new Error('denied') }) } })
    render(<HealthIdCode code="HID-AB2C3D" copyButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy HID' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Press and hold your Health ID to copy it')
    expect(screen.getByRole('button', { name: 'Copy HID' })).toBeTruthy()
  })

  it('says how to copy by hand when the browser has no clipboard', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined })
    render(<HealthIdCode code="HID-AB2C3D" copyButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy HID' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('shows nothing, and offers nothing to copy, when there is no code', () => {
    const { container } = render(<HealthIdCode code="" copyButton />)
    expect(container.innerHTML).toBe('')
    expect(screen.queryByRole('button', { name: 'Copy HID' })).toBeNull()
  })
})
