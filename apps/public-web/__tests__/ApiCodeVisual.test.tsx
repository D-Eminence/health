import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ToastProvider, toast } from '@hid/ui'
import { ApiCodeVisual } from '@/components/product/ApiCodeVisual'

function renderVisual() {
  return render(
    <ToastProvider>
      <ApiCodeVisual />
    </ToastProvider>,
  )
}

beforeEach(() => {
  toast.dismiss()
})

afterEach(() => {
  toast.dismiss()
})

describe('ApiCodeVisual feedback', () => {
  it('reports a successful clipboard action through the shared toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderVisual()

    fireEvent.click(screen.getByRole('button', { name: 'Copy example' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Copied to clipboard')).toBeDefined()
    expect(screen.getByRole('status').getAttribute('data-type')).toBe('success')
  })

  it('provides a Retry action when clipboard access fails', async () => {
    const writeText = vi.fn()
      .mockRejectedValueOnce(new Error('blocked'))
      .mockResolvedValueOnce(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderVisual()

    fireEvent.click(screen.getByRole('button', { name: 'Copy example' }))
    expect(await screen.findByText('Unable to copy example')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Copied to clipboard')).toBeDefined()
  })
})
