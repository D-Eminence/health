import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { FilePlus2, FolderHeart, HeartPulse, House, ShieldCheck, UserRound } from 'lucide-react'
import { AppShell, type NavItem } from '../../kasuwa/AppShell'

/**
 * The shell every signed-in product shares (patient portal, provider EHR, platform admin), for keyboard and screen
 * reader users: a skip link first, menus that open onto their first item and close on Escape or a click elsewhere,
 * a ➕ sheet that keeps focus inside and, once an item is chosen, leaves focus to the page it opens, a Menu page that
 * names itself and takes focus, and a sign-out that shows it is under way. Fictional people only.
 */
const TABS: readonly NavItem[] = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/records', label: 'Records', icon: FolderHeart },
  { to: '/access', label: 'Access', icon: ShieldCheck },
]

function Where() {
  const { pathname, search, hash } = useLocation()
  return <span data-testid="where">{`${pathname}${search}${hash}`}</span>
}

function Page({ title }: { title: string }) {
  return <><h1>{title}</h1><button type="button">On the page</button><Where /></>
}

function Shell({ signingOut, onSignOut = () => undefined, withSkipLink }: { signingOut?: boolean; onSignOut?: () => void; withSkipLink?: string }) {
  return <AppShell brand={<a href="/">Health ID home</a>}
    switcher={{ name: 'Ada Obi', subtitle: 'Patient portal', menu: close => <ul>
      <li><a href="/profile" onClick={close}>Your profile</a></li>
      <li><a href="/profile#health-information" onClick={close}>Health information</a></li>
    </ul> }}
    nav={[{ items: TABS }, { title: 'Account', items: [{ to: '/profile', label: 'Profile', icon: UserRound }] }]}
    tabs={TABS} person={{ name: 'Ada Obi', detail: 'ada.obi@example.test', profileTo: '/profile' }}
    onSignOut={onSignOut} signingOut={signingOut} skipLink={withSkipLink}
    create={{ label: 'Add or share', items: [
      { to: '/records?add=record', label: 'Add a record', hint: 'A visit or result', icon: FilePlus2, main: true },
      { to: '/profile#health-information', label: 'Update health information', hint: 'Blood group, allergies', icon: HeartPulse },
    ] }}>
    <Routes>
      <Route path="/" element={<Page title="Good morning, Ada" />} />
      <Route path="/records" element={<Page title="Records" />} />
      <Route path="/profile" element={<Page title="Profile" />} />
    </Routes>
  </AppShell>
}

const renderShell = (at = '/', props: Parameters<typeof Shell>[0] = {}) =>
  render(<MemoryRouter initialEntries={[at]}><Shell {...props} /></MemoryRouter>)
const where = () => screen.getByTestId('where').textContent
const account = () => screen.getByRole('button', { name: 'Ada Obi: account' })
const switcher = () => screen.getAllByRole('button', { name: /Ada Obi/ }).find(button => button.getAttribute('aria-label') === null)!

afterEach(() => { document.title = '' })

describe('the skip link', () => {
  it('is the first thing a keyboard reaches, even when the product names none, and jumps to the page', () => {
    const { container } = renderShell()
    const first = container.querySelector<HTMLElement>('a[href], button')!
    expect(first.textContent).toBe('Skip to main content')
    expect(first.getAttribute('href')).toBe('#main')
    fireEvent.click(first)
    expect(document.activeElement).toBe(document.getElementById('main'))
  })

  it('keeps the words a product gives it', () => {
    renderShell('/', { withSkipLink: 'Skip to content' })
    expect(screen.getByRole('link', { name: 'Skip to content' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Skip to main content' })).toBeNull()
  })
})

describe('the account menu (⋯) and the switcher', () => {
  it('opens the account menu onto its first item, says what it controls, and closes on Escape back to ⋯', () => {
    renderShell()
    account().focus()
    fireEvent.click(account())
    const menu = document.getElementById(account().getAttribute('aria-controls')!)
    expect(menu).not.toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Your profile' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
    expect(account().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(account())
  })

  it('closes the account menu on a click elsewhere on the page', () => {
    renderShell()
    fireEvent.click(account())
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
    fireEvent.pointerDown(screen.getByRole('heading', { name: 'Good morning, Ada' }))
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
  })

  it('opens the switcher onto its first item and closes it on Escape back to the switcher', () => {
    renderShell()
    switcher().focus()
    fireEvent.click(switcher())
    expect(switcher().getAttribute('aria-controls')).toBeTruthy()
    const first = screen.getAllByRole('link', { name: 'Your profile' })[0]!
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'Escape' })
    expect(switcher().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(switcher())
  })

  it('closes the switcher on a click elsewhere on the page', () => {
    renderShell()
    fireEvent.click(switcher())
    expect(switcher().getAttribute('aria-expanded')).toBe('true')
    fireEvent.pointerDown(screen.getByRole('heading', { name: 'Good morning, Ada' }))
    expect(switcher().getAttribute('aria-expanded')).toBe('false')
  })
})

describe('signing out from the account menu', () => {
  function SlowSignOut({ onSignOut = () => undefined }: { onSignOut?: () => void }) {
    const [signingOut, setSigningOut] = useState(false)
    return <MemoryRouter><Shell signingOut={signingOut} onSignOut={() => { onSignOut(); setSigningOut(true) }} /></MemoryRouter>
  }

  it('closes the menu onto ⋯, which shows the sign-out is under way, and says so once', () => {
    render(<SlowSignOut />)
    fireEvent.click(account())
    const signOut = screen.getByRole('button', { name: 'Sign out' })
    signOut.focus()
    fireEvent.click(signOut)
    // Focus stays where the person was, on ⋯, which is busy; the row beside it says what is happening.
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
    expect(document.activeElement).toBe(account())
    expect(account().getAttribute('aria-busy')).toBe('true')
    expect(account().parentElement?.textContent).toContain('Signing out…')
    expect(screen.getByRole('status').textContent).toBe('Signing out…')
  })

  it('sends one sign-out however often Sign out is pressed meanwhile', () => {
    let calls = 0
    render(<SlowSignOut onSignOut={() => { calls += 1 }} />)
    fireEvent.click(account())
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    fireEvent.click(account())
    const again = screen.getByRole('button', { name: 'Signing out…' }) as HTMLButtonElement
    expect(again.disabled).toBe(true)
    fireEvent.click(again)
    expect(calls).toBe(1)
  })

  it('keeps focus on ⋯ and stops showing progress when signing out ends without leaving (it failed)', async () => {
    function Failing() {
      const [signingOut, setSigningOut] = useState(false)
      return <MemoryRouter><Shell signingOut={signingOut} onSignOut={() => { setSigningOut(true); setTimeout(() => setSigningOut(false), 0) }} /></MemoryRouter>
    }
    render(<Failing />)
    fireEvent.click(account())
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
    expect(document.activeElement).toBe(account())
    expect(account().getAttribute('aria-busy')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('')
  })
})

describe('the ➕ sheet on a phone', () => {
  function openSheet() {
    renderShell()
    const plus = screen.getByRole('button', { name: 'Add or share' })
    plus.focus()
    fireEvent.click(plus)
    return { plus, sheet: screen.getByRole('dialog', { name: 'Add or share' }) }
  }

  it('keeps Tab and Shift+Tab inside the sheet', () => {
    const { sheet } = openSheet()
    expect(document.activeElement).toBe(screen.getByRole('link', { name: /Add a record/ }))
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('link', { name: /Add a record/ }))
    expect(sheet.contains(document.activeElement)).toBe(true)
  })

  it('gives focus back to ➕ when closed with Escape or Cancel', () => {
    const { plus } = openSheet()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(plus)
    fireEvent.click(plus)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(document.activeElement).toBe(plus)
  })

  it('leaves focus to the page an item opens, not on ➕', () => {
    const { plus } = openSheet()
    fireEvent.click(screen.getByRole('link', { name: /Update health information/ }))
    expect(where()).toBe('/profile#health-information')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).not.toBe(plus)
  })
})

describe('the Menu page on a phone', () => {
  const menuButton = () => screen.getByRole('button', { name: 'Menu' })

  it('names the tab and takes focus to its heading when opened', () => {
    renderShell()
    document.title = 'Overview · Health ID'
    menuButton().focus()
    fireEvent.click(menuButton())
    // The Menu page stands in for the page.
    expect(screen.queryByTestId('where')).toBeNull()
    const heading = screen.getByRole('heading', { level: 1, name: 'Menu' })
    expect(document.activeElement).toBe(heading)
    expect(document.title).toBe('Menu · Health ID')
  })

  it('takes the product name of the page it opens over for the title', () => {
    renderShell()
    document.title = 'Audit · Health ID Platform'
    fireEvent.click(menuButton())
    expect(document.title).toBe('Menu · Health ID Platform')
  })

  it('on an address opened at #menu, Close shows the page under it instead of leaving the app', () => {
    renderShell('/records#menu')
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }))
    expect(where()).toBe('/records')
    expect(screen.getByRole('heading', { level: 1, name: 'Records' })).toBeTruthy()
  })

  it('moves focus to the page heading when Close takes the Menu page away', () => {
    renderShell('/records#menu')
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }))
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Records' }))
  })
})
