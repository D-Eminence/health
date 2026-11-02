import { act, fireEvent, render, screen } from '@testing-library/react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { FileText, House, Settings } from 'lucide-react'
import { AppShell, type NavItem } from '../../kasuwa/AppShell'

/**
 * The shell's account menu (⋯ beside the person, at the foot of the sidebar): it closes when the address changes, and
 * only then. A press that opens it as the shell first appears stays open: before, the shell's "close the menus on a new
 * address" effect also ran once on mount, and when that run came after the press (as on a busy machine, where React runs
 * effects a little later), it closed the menu again. The admin console's sign-out tests failed on that now and then.
 * Fictional people only.
 */
const TABS: readonly NavItem[] = [
  { to: '/admin/overview', label: 'Overview', icon: House },
  { to: '/admin/audit', label: 'Audit', icon: FileText },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
]

function Shell() {
  return <AppShell brand={<span>Health ID</span>} switcher={{ name: 'Health ID platform', subtitle: 'Administrator' }}
    nav={[{ items: TABS }]} tabs={TABS} person={{ name: 'Ada Admin', detail: 'ada.admin@example.test' }} onSignOut={() => undefined}>
    <h1>Overview</h1>
  </AppShell>
}

const account = () => screen.getByRole('button', { name: 'Ada Admin: account' })

describe('the account menu', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null
  afterEach(() => {
    if (root) act(() => root!.unmount())
    host?.remove()
    root = null
    host = null
  })

  it('stays open when pressed as the shell first appears, before its effects have run', async () => {
    // The shell is committed outside act, so React runs its effects later, as in a browser; the press comes first.
    const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const before = environment.IS_REACT_ACT_ENVIRONMENT
    environment.IS_REACT_ACT_ENVIRONMENT = false
    try {
      host = document.body.appendChild(document.createElement('div'))
      const created = createRoot(host)
      root = created
      // The press comes the moment the button is in the page: a mutation observer's callback runs as soon as React has
      // committed the shell, before the task in which React runs its effects.
      const pressed = new Promise<void>(resolve => {
        const observer = new MutationObserver(() => {
          const button = host!.querySelector<HTMLButtonElement>('button[aria-label="Ada Admin: account"]')
          if (!button) return
          observer.disconnect()
          button.click()
          resolve()
        })
        observer.observe(host!, { childList: true, subtree: true })
      })
      created.render(<MemoryRouter initialEntries={['/admin/overview']}><Shell /></MemoryRouter>)
      await pressed
      // Then React runs the shell's effects, and anything they set.
      await new Promise(resolve => setTimeout(resolve, 50))
    } finally {
      environment.IS_REACT_ACT_ENVIRONMENT = before
    }
    expect(account().getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  it('closes when the address changes', () => {
    render(<MemoryRouter initialEntries={['/admin/overview']}><Shell /></MemoryRouter>)
    fireEvent.click(account())
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
    fireEvent.click(screen.getAllByRole('link', { name: 'Audit' })[0]!)
    expect(account().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
  })
})
