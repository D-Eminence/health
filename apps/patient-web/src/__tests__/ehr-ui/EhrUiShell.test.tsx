import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EhrAppShell, EhrDrawer, EhrTopBar } from '@hid/ui/ehr'
import { Opener, ShellHarness, workspace } from './ehrHarness'

/**
 * EhrAppShell: the `.hid-ehr` root. Its workspace is the skip link, the
 * sidebar, the top bar and main; overlays portal into a layer beside it, and
 * while one is open the workspace is inert. jsdom ignores inert, so these
 * check the attribute.
 */

describe('EhrAppShell', () => {
  it('is the .hid-ehr root, with the skip link first and main as its target', () => {
    const { container } = render(<ShellHarness><p>Ward overview (fictional)</p></ShellHarness>)
    const root = container.firstElementChild!
    expect(root.classList.contains('hid-ehr')).toBe(true)
    expect(root.classList.contains('hid-ehr-shell')).toBe(true)

    const skip = screen.getByRole('link', { name: 'Skip to main content' })
    const first = root.querySelector('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
    expect(first).toBe(skip)
    expect(skip.getAttribute('href')).toBe('#main-content')

    const main = screen.getByRole('main')
    expect(main.id).toBe('main-content')
    expect(main.getAttribute('tabindex')).toBe('-1')
    expect(within(main).getByText('Ward overview (fictional)')).toBeDefined()
  })

  it('lays out the sidebar, the top bar (the banner) and main inside the workspace, and the overlay layer outside it', () => {
    render(<ShellHarness />)
    const space = workspace()
    expect(space.contains(screen.getByRole('link', { name: 'Skip to main content' }))).toBe(true)
    expect(space.contains(screen.getByRole('navigation', { name: 'Main navigation' }))).toBe(true)
    expect(space.contains(screen.getByRole('banner'))).toBe(true)
    expect(space.contains(screen.getByRole('main'))).toBe(true)

    const layer = document.querySelector('.hid-ehr-overlay-layer')!
    expect(space.contains(layer)).toBe(false)
    expect(layer.closest('.hid-ehr-shell')).not.toBeNull()
  })

  it('portals an open overlay into its layer and makes the workspace inert until it closes', () => {
    render(
      <ShellHarness>
        <Opener label="Show admission notes" render={(open, setOpen) => (
          <EhrDrawer open={open} title="Admission notes" onClose={() => setOpen(false)}>
            <p>Fictional notes.</p>
          </EhrDrawer>
        )} />
      </ShellHarness>,
    )
    expect(workspace().hasAttribute('inert')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Show admission notes' }))
    const drawer = screen.getByRole('dialog', { name: 'Admission notes' })
    expect(document.querySelector('.hid-ehr-overlay-layer')!.contains(drawer)).toBe(true)
    expect(workspace().contains(drawer)).toBe(false)
    expect(workspace().getAttribute('inert')).toBe('')
    expect(drawer.closest('[inert]')).toBeNull()

    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(workspace().hasAttribute('inert')).toBe(false)
  })

  it('offers no phone menu button without a sidebar to open', () => {
    render(<EhrAppShell topBar={<EhrTopBar start="Fictional clinic" />}>Content</EhrAppShell>)
    expect(screen.getByRole('banner')).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Menu' })).toBeNull()
  })
})

describe('EhrTopBar', () => {
  it('is a header with start and end slots and, in a shell with a sidebar, the menu button', () => {
    render(
      <EhrAppShell
        sidebar={<nav aria-label="Main navigation" />}
        topBar={<EhrTopBar start={<strong>Riverside Teaching Hospital (fictional)</strong>} end={<button type="button">Notifications</button>} />}
      >
        Content
      </EhrAppShell>,
    )
    const banner = screen.getByRole('banner')
    expect(banner.tagName).toBe('HEADER')
    expect(banner.classList.contains('hid-ehr-topbar')).toBe(true)
    expect(within(banner).getByText('Riverside Teaching Hospital (fictional)').closest('.hid-ehr-topbar-start')).not.toBeNull()
    expect(within(banner).getByRole('button', { name: 'Notifications' }).closest('.hid-ehr-topbar-end')).not.toBeNull()

    const menu = within(banner).getByRole('button', { name: 'Menu' })
    expect(menu.tagName).toBe('BUTTON')
    expect(menu.getAttribute('type')).toBe('button')
    expect(menu.getAttribute('aria-expanded')).toBe('false')
    expect(menu.getAttribute('aria-controls')).toBeTruthy()
  })

  it('renders on its own without the menu button', () => {
    render(<EhrTopBar start="Fictional clinic" />)
    expect(screen.getByRole('banner')).toBeDefined()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
