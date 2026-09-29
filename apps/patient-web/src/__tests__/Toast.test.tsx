import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ToastProvider, toast, useToast } from '@hid/ui'

function ToastHarness() {
  const notifications = useToast()

  return (
    <button type="button" onClick={() => notifications.success('Changes saved')}>
      Save changes
    </button>
  )
}

function renderToasts() {
  return render(
    <ToastProvider>
      <ToastHarness />
    </ToastProvider>,
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  act(() => toast.dismiss())
})

afterEach(() => {
  act(() => toast.dismiss())
  vi.useRealTimers()
})

describe('Waya toast feedback', () => {
  it('provides the shared hook and renders calm, polite success feedback with a labelled close control', () => {
    renderToasts()

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    const notification = screen.getByRole('status')
    expect(notification.getAttribute('data-type')).toBe('success')
    expect(notification.getAttribute('aria-live')).toBe('polite')
    expect(notification.textContent).toContain('Changes saved')
    expect(notification.querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeDefined()
  })

  it('keeps ordinary errors polite and reserves assertive announcements for important errors', () => {
    renderToasts()

    act(() => toast.error('Unable to save changes'))
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite')
    expect(screen.queryByRole('alert')).toBeNull()

    act(() => toast.dismiss())
    act(() => toast.error('Connection lost', { important: true }))
    expect(screen.getByRole('alert').getAttribute('aria-live')).toBe('assertive')
  })

  it('deduplicates repeated simple feedback and caps the visible stack at three', () => {
    renderToasts()

    let first: string
    let second: string
    act(() => {
      first = toast.success('Copied to clipboard')
      second = toast.success('Copied to clipboard')
    })
    expect(second!).toBe(first!)
    expect(screen.getAllByText('Copied to clipboard')).toHaveLength(1)

    act(() => {
      toast.dismiss()
      toast.success('First', { id: 'first', duration: 0 })
      toast.success('Second', { id: 'second', duration: 0 })
      toast.success('Third', { id: 'third', duration: 0 })
      toast.success('Fourth', { id: 'fourth', duration: 0 })
    })

    expect(screen.queryByText('Fourth')).toBeNull()
    expect(screen.getAllByRole('status')).toHaveLength(3)

    act(() => toast.dismiss('first'))
    expect(screen.getByText('Fourth')).toBeDefined()
    expect(screen.getAllByRole('status')).toHaveLength(3)
  })

  it('keeps loading feedback visible, then transforms that same toast into a completed result', () => {
    renderToasts()

    let id: string
    act(() => {
      id = toast.loading('Uploading file…')
    })
    act(() => vi.advanceTimersByTime(60_000))
    expect(screen.getByText('Uploading file…')).toBeDefined()

    act(() => toast.update(id!, { type: 'success', title: 'File uploaded' }))
    const notification = screen.getByRole('status')
    expect(notification.textContent).toContain('File uploaded')
    expect(notification.textContent).not.toContain('Uploading file…')
  })

  it('uses one toast identity throughout a promise lifecycle', async () => {
    renderToasts()

    let resolve!: (value: string) => void
    const source = new Promise<string>(done => {
      resolve = done
    })

    let lifecycle!: Promise<string>
    act(() => {
      lifecycle = toast.promise(source, {
        loading: 'Saving changes…',
        success: value => ({ title: 'Changes saved', description: `${value} is ready.` }),
        error: 'Unable to save changes',
      })
    })
    expect(screen.getByText('Saving changes…')).toBeDefined()

    await act(async () => {
      resolve('Workspace')
      await lifecycle
    })

    expect(screen.getByText('Changes saved')).toBeDefined()
    expect(screen.getByText('Workspace is ready.')).toBeDefined()
    expect(screen.queryByText('Saving changes…')).toBeNull()
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  it('pauses auto-dismiss while a notification is being read and resumes afterward', () => {
    renderToasts()

    act(() => toast.info('Filters were reset', { duration: 1000 }))
    const notification = screen.getByRole('status')
    fireEvent.mouseEnter(notification)
    act(() => vi.advanceTimersByTime(1500))
    expect(screen.getByText('Filters were reset')).toBeDefined()

    fireEvent.mouseLeave(notification)
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByText('Filters were reset')).toBeDefined()
    act(() => vi.advanceTimersByTime(180))
    expect(screen.queryByText('Filters were reset')).toBeNull()
  })

  it('runs a single contextual action and dismisses the toast after its exit motion', () => {
    renderToasts()
    const retry = vi.fn()

    act(() => toast.error('Upload failed', {
      duration: 0,
      action: { label: 'Retry', onAction: retry },
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Upload failed')).toBeDefined()

    act(() => vi.advanceTimersByTime(180))
    expect(screen.queryByText('Upload failed')).toBeNull()
  })
})
