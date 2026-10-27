import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommandPalette, type CommandPaletteItem } from '@hid/ui'
import { GlobalSearch, GlobalSearchProvider } from '@/components/layout/GlobalSearch'
import { focusWhenShown } from './focusWhenShown'

const push = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

const items: readonly CommandPaletteItem[] = [
  {
    id: 'ehr',
    label: 'Health ID EHR',
    category: 'products',
    description: 'Clinical records for connected care.',
    keywords: ['consultations', 'clinical'],
  },
  {
    id: 'security',
    label: 'Security and access',
    category: 'resources',
    description: 'Authorised access and accountability.',
    keywords: ['consent', 'permissions'],
  },
]

describe('CommandPalette', () => {
  it('opens from its trigger, supports filtering and selects with the keyboard', () => {
    const select = vi.fn()
    render(
      <CommandPalette
        title="Search Health ID"
        trigger={<button type="button">Open search</button>}
        groups={[
          { id: 'products', label: 'Products' },
          { id: 'resources', label: 'Resources' },
        ]}
        filters={[
          { id: 'products', label: 'Products' },
          { id: 'resources', label: 'Resources' },
        ]}
        items={items}
        onSelect={select}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Open search' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Search Health ID' })
    const input = screen.getByRole('combobox', { name: 'Search Health ID' })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(input.getAttribute('aria-controls')).toBeTruthy()
    const describedBy = input.getAttribute('aria-describedby')?.split(' ') ?? []
    expect(describedBy.some(id => document.getElementById(id)?.textContent?.includes('Use the arrow keys'))).toBe(true)
    expect(dialog.querySelector('.waya-command__footer')).toBeNull()
    expect(dialog.contains(screen.getByRole('listbox', { name: 'Search results' }))).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Filter results' }))
    fireEvent.click(screen.getByRole('button', { name: 'Products' }))
    expect(screen.getByRole('button', { name: 'Products' }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: 'ehr' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens with Ctrl/Cmd+K and returns focus to the initiating control on Escape', async () => {
    render(
      <CommandPalette
        title="Search Health ID"
        trigger={<button type="button">Open search</button>}
        items={items}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Open search' })
    trigger.focus()
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const input = screen.getByRole('combobox', { name: 'Search Health ID' })
    fireEvent.keyDown(input, { key: 'Escape' })

    await waitFor(() => expect(document.activeElement).toBe(trigger))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // The search field takes focus in the commit that shows the palette. From an
  // animation frame, a check made as soon as it was shown found focus still on
  // the trigger.
  it('has focus on the search field as soon as the palette is shown', async () => {
    render(<CommandPalette title="Search Health ID" trigger={<button type="button">Open search</button>} items={items} />)
    const trigger = screen.getByRole('button', { name: 'Open search' })
    trigger.focus()
    const shown = focusWhenShown(() => screen.queryByRole('combobox', { name: 'Search Health ID' }))
    fireEvent.click(trigger)
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })

  // A host that opens the palette itself leaves it to note where focus was, which
  // it does before it moves focus to the search field.
  it('returns focus to where it was when a host opened the palette', async () => {
    function Host() {
      const [open, setOpen] = useState(false)
      return <>
        <button type="button" onClick={() => setOpen(true)}>Find a page</button>
        <CommandPalette title="Search Health ID" open={open} onOpenChange={setOpen} items={items} keyboardShortcut={false} />
      </>
    }
    render(<Host />)
    const opener = screen.getByRole('button', { name: 'Find a page' })
    opener.focus()
    fireEvent.click(opener)
    const input = screen.getByRole('combobox', { name: 'Search Health ID' })
    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(input, { key: 'Escape' })

    await waitFor(() => expect(document.activeElement).toBe(opener))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('has explicit loading and retryable error states', () => {
    const retry = vi.fn()
    const view = render(<CommandPalette title="Search Health ID" defaultOpen items={items} loading />)
    expect(screen.getByRole('status').textContent).toContain('Searching Health ID')

    view.rerender(<CommandPalette title="Search Health ID" defaultOpen items={items} error="Search is temporarily unavailable." onRetry={retry} />)
    expect(screen.getByRole('alert').textContent).toContain('Search is temporarily unavailable.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })
})

describe('Health ID global search adapter', () => {
  it('uses only the public route table and keeps product navigation in the host', () => {
    push.mockReset()
    render(
      <GlobalSearchProvider>
        <GlobalSearch />
      </GlobalSearchProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Search Health ID' }))
    const input = screen.getByRole('combobox', { name: 'Search Health ID' })
    fireEvent.change(input, { target: { value: 'Health ID EHR' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(push).toHaveBeenCalledWith('/products/ehr')

    fireEvent.click(screen.getByRole('button', { name: 'Search Health ID' }))
    expect(screen.getByText('Recent')).toBeDefined()
  })
})
