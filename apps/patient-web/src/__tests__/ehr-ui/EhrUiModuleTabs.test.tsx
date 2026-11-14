import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EhrModuleTabs } from '@hid/ui/ehr'

const TABS = [
  { id: 'lab-orders', label: 'Orders', href: '/ehr/lab/orders' },
  { id: 'lab-samples', label: 'Samples', href: '/ehr/lab/samples' },
  { id: 'lab-results', label: 'Results', href: '/ehr/lab/results' },
]

describe('EhrModuleTabs', () => {
  it('is a labelled navigation of links, not ARIA tabs, with the current page marked', () => {
    render(<EhrModuleTabs label="Laboratory" tabs={TABS} currentId="lab-samples" />)
    const nav = screen.getByRole('navigation', { name: 'Laboratory' })
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
    const links = within(nav).getAllByRole('link')
    expect(links.map(link => link.textContent)).toEqual(['Orders', 'Samples', 'Results'])
    expect(within(nav).getByRole('link', { name: 'Samples' }).getAttribute('aria-current')).toBe('page')
    expect(within(nav).getByRole('link', { name: 'Orders' }).getAttribute('aria-current')).toBeNull()
    for (const link of links) expect(link.classList.contains('hid-ehr-module-tab')).toBe(true)
  })

  it('hands a followed link to onNavigate, which may route in the app instead', () => {
    const onNavigate = vi.fn((_, event: { preventDefault: () => void }) => event.preventDefault())
    render(<EhrModuleTabs label="Laboratory" tabs={TABS} onNavigate={onNavigate} />)
    fireEvent.click(screen.getByRole('link', { name: 'Results' }))
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onNavigate.mock.calls[0]![0]).toMatchObject({ id: 'lab-results' })
  })
})
