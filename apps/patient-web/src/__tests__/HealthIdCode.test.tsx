import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { HealthIdCode } from '../routes/HealthIdCode'

afterEach(() => { vi.unstubAllGlobals() })

describe('the Health ID display (as hid-1.0)', () => {
  it('shows the code and copies exactly the code when asked', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    render(<HealthIdCode code="HID-AB2C3D" />)
    expect(screen.getByText('HID-AB2C3D').className).toBe('patient-hid-code')
    expect(writeText).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Copy HID' }))

    expect((await screen.findByRole('status')).textContent).toBe('Health ID copied.')
    expect(writeText).toHaveBeenCalledWith('HID-AB2C3D')
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
  })

  it('says how to copy by hand when the browser refuses', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => { throw new Error('denied') }) } })
    render(<HealthIdCode code="HID-AB2C3D" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy HID' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Press and hold your Health ID to copy it')
    expect(screen.getByRole('button', { name: 'Copy HID' })).toBeTruthy()
  })

  it('says how to copy by hand when the browser has no clipboard', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined })
    render(<HealthIdCode code="HID-AB2C3D" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy HID' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('shows nothing, and offers nothing to copy, when there is no code', () => {
    const { container } = render(<HealthIdCode code="" />)
    expect(container.innerHTML).toBe('')
    expect(screen.queryByRole('button', { name: 'Copy HID' })).toBeNull()
  })
})
