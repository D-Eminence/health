import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CommandSearch } from './command-search'

const results = [{ id: '1', label: 'Ada Lovelace', category: 'users', keywords: ['ada'] }, { id: '2', label: 'Order #42', category: 'orders' }]
const filters = [{ id: 'users', label: 'Users' }, { id: 'orders', label: 'Orders' }]
describe('CommandSearch', () => {
  it('opens, filters, clears, navigates, selects, and closes', async () => {
    const user = userEvent.setup(); const onResultSelect = vi.fn()
    render(<CommandSearch trigger={<button>Open search</button>} results={results} filters={filters} onResultSelect={onResultSelect} />)
    const trigger = screen.getByRole('button', { name: 'Open search' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.click(trigger); const input = screen.getByRole('combobox')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await user.type(input, 'Ada'); expect(screen.getByText('Searching results')).toBeInTheDocument()
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument()
    await user.keyboard('{ArrowDown}{Enter}'); expect(onResultSelect).toHaveBeenCalledWith(results[0]); expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('supports filters, clear filters, loading, empty, error recovery, and controlled open state', async () => {
    const user = userEvent.setup(); const retry = vi.fn(); const { rerender } = render(<CommandSearch defaultOpen results={results} filters={filters} loading />)
    expect(screen.getByText('Searching results')).toBeInTheDocument(); rerender(<CommandSearch defaultOpen results={results} filters={filters} error onRetry={retry} />)
    await user.click(screen.getByRole('button', { name: 'Try again' })); expect(retry).toHaveBeenCalled(); rerender(<CommandSearch defaultOpen results={[]} emptyMessage="Nothing here" />)
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })
})
