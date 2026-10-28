import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { EhrWorkflowBento } from '@/components/product/EhrWorkflowBento'

/**
 * The EHR page's patient lookup illustration starts at HID-, as every Health ID field does (owner decision,
 * 2026-10-27), and types only what follows it: a Health ID of 6 characters, as hid-1.0 issued them.
 */
function stubMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }))
}
const lookup = () => screen.getByLabelText('Health ID') as HTMLInputElement

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('the EHR patient lookup illustration', () => {
  it('starts at HID- and types the 6 characters after it', () => {
    stubMotion(false)
    render(<EhrWorkflowBento />)
    // Shown before the animation's first step: only the prefill.
    expect(lookup().value).toBe('HID-')
    act(() => { vi.advanceTimersByTime(70) })
    expect(lookup().value).toBe('HID-7')
    act(() => { vi.advanceTimersByTime(70 * 5) })
    expect(lookup().value).toBe('HID-7KQ2M9')
    expect(lookup().value).toMatch(/^HID-[A-HJ-NP-Z2-9]{6}$/)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByText('PATIENT FOUND')).toBeTruthy()
    expect(screen.getByText('HID-7KQ2M9 · 32 years · Female')).toBeTruthy()
  })

  it('shows the whole Health ID at once with reduced motion, and on Search', () => {
    stubMotion(true)
    render(<EhrWorkflowBento />)
    expect(lookup().value).toBe('HID-7KQ2M9')
    fireEvent.click(screen.getAllByRole('button', { name: /Search|Go/ })[0]!)
    expect(lookup().value).toBe('HID-7KQ2M9')
  })
})
