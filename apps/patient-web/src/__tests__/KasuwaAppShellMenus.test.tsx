import { afterEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { LayoutDashboard, ShieldCheck } from 'lucide-react'
import { MemoryRouter } from 'react-router-dom'
import { AppShell, type NavGroup } from '../kasuwa/AppShell'

/**
 * The shell's menus close when the person moves to another page, and only then. They used to be closed by an effect on
 * the address, which also ran on mount: a click that landed between the shell appearing and its effects running (a
 * session that arrives by promise, with a test or a quick hand clicking at once) opened the account menu, and the
 * mount effect shut it again. The admin sign-out tests failed on CI that way. Every name here is fictional.
 */
type ActFlag = { IS_REACT_ACT_ENVIRONMENT?: boolean }
const actFlag = globalThis as ActFlag
const usualActFlag = actFlag.IS_REACT_ACT_ENVIRONMENT
afterEach(() => { actFlag.IS_REACT_ACT_ENVIRONMENT = usualActFlag })

const NAV: readonly NavGroup[] = [{ items: [
  { to: '/admin/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/admin/security', label: 'Security', icon: ShieldCheck },
] }]

function Shell() {
  return <AppShell brand={<span>Fictional platform</span>} switcher={{ name: 'Fictional platform' }} nav={NAV}
    person={{ name: 'Ada Example', detail: 'ada@example.test' }} onSignOut={() => undefined} tabs={[]}><p>Page</p></AppShell>
}

const signOut = () => screen.queryByRole('button', { name: 'Sign out' })

describe('the shell’s account menu', () => {
  it('stays open when it is opened the moment the shell appears', async () => {
    let show: () => void = () => undefined
    function Host() {
      const [on, setOn] = useState(false)
      show = () => setOn(true)
      return on ? <Shell /> : null
    }
    render(<MemoryRouter initialEntries={['/admin/overview']}><Host /></MemoryRouter>)
    // As a session that arrives by promise: an update React renders in its own time, its effects after the commit.
    actFlag.IS_REACT_ACT_ENVIRONMENT = false
    const openedAtOnce = new Promise<boolean>(resolve => {
      const observer = new MutationObserver(() => {
        const account = screen.queryByRole('button', { name: 'Ada Example: account' })
        if (!account) return
        observer.disconnect()
        // As findByRole does: the shell is on the page, so the click comes at once.
        fireEvent.click(account)
        resolve(signOut() !== null)
      })
      observer.observe(document.body, { childList: true, subtree: true })
    })
    show()
    expect(await openedAtOnce).toBe(true)
    // Its effects have run since.
    await new Promise(resolve => setTimeout(resolve, 50))
    actFlag.IS_REACT_ACT_ENVIRONMENT = usualActFlag
    await act(async () => undefined)
    expect(signOut()).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Ada Example: account' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('closes when the person moves to another page', () => {
    render(<MemoryRouter initialEntries={['/admin/overview']}><Shell /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Ada Example: account' }))
    expect(signOut()).not.toBeNull()
    fireEvent.click(screen.getAllByRole('link', { name: 'Security' })[0]!)
    expect(signOut()).toBeNull()
    expect(screen.getByRole('button', { name: 'Ada Example: account' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('stays open while the person stays on the page', () => {
    render(<MemoryRouter initialEntries={['/admin/overview']}><Shell /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Ada Example: account' }))
    // The current page's own link: the address does not change, so the menu has no reason to close.
    fireEvent.click(screen.getAllByRole('link', { name: 'Overview' })[0]!)
    expect(signOut()).not.toBeNull()
  })
})
