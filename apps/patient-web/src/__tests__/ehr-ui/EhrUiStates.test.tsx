import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EhrButton, EhrEmptyState, EhrErrorState, EhrSkeleton } from '@hid/ui/ehr'

describe('EhrEmptyState', () => {
  it('says what is missing, what to do next, and offers at most one action', () => {
    const { container } = render(
      <EhrEmptyState title="No appointments today" message="Book an appointment to see it here." action={<EhrButton>Book appointment</EhrButton>} />,
    )
    expect(container.firstElementChild!.classList.contains('hid-ehr-empty-state')).toBe(true)
    expect(screen.getByText('No appointments today')).toBeDefined()
    expect(screen.getByText('Book an appointment to see it here.')).toBeDefined()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('is no live region', () => {
    render(<EhrEmptyState title="No results" message="Try a different name." />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('EhrErrorState', () => {
  it('reads in place by default, with the message the caller wrote', () => {
    render(<EhrErrorState title="Results could not load" message="Check your connection, then try again." />)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Results could not load').closest('.hid-ehr-error-state')).not.toBeNull()
    expect(screen.getByText('Check your connection, then try again.')).toBeDefined()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('is an alert when it replaces content after an action, and offers Retry', () => {
    const onRetry = vi.fn()
    render(<EhrErrorState title="Results could not load" message="Check your connection, then try again." announce onRetry={onRetry} />)
    expect(screen.getByRole('alert').textContent).toContain('Results could not load')
    const retry = screen.getByRole('button', { name: 'Try again' })
    expect(retry.getAttribute('type')).toBe('button')
    fireEvent.click(retry)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe('EhrSkeleton', () => {
  it('hides its bars from assistive technology and says Loading in a visually hidden status', () => {
    const { container } = render(<EhrSkeleton />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('Loading')
    expect(status.classList.contains('hid-ehr-sr-only')).toBe(true)
    const bars = container.querySelectorAll('.hid-ehr-skeleton-bar')
    expect(bars).toHaveLength(3)
    for (const bar of bars) expect(bar.closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('names what is loading', () => {
    render(<EhrSkeleton label="Loading lab results" bars={2} />)
    expect(screen.getByRole('status').textContent).toBe('Loading lab results')
  })
})
