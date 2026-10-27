import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { SupportChat } from '@hid/ui'
import { SiteNav, type NavEntry } from '@/components/layout/SiteNav'
import { focusWhenShown } from './focusWhenShown'

// Page chrome that is not under test: the search adapter needs Next's router.
vi.mock('@/components/layout/GlobalSearch', () => ({ GlobalSearch: () => null }))

/**
 * The support chat and the site navigation move focus in the commit that shows
 * where it goes. From an effect or an animation frame, focus moved a task or a
 * frame after that commit, and a check made as soon as the change was shown
 * (findBy on a busy runner, as on health#16's CI) found it still where it was.
 * Each test reads focus at the moment the change is shown.
 */
const environment = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
afterEach(() => { environment.IS_REACT_ACT_ENVIRONMENT = true })

/** Acts as the browser does, outside act: React renders a click in a microtask and runs its effects after that. */
function outsideAct(action: () => void) {
  environment.IS_REACT_ACT_ENVIRONMENT = false
  action()
}

beforeAll(() => {
  // jsdom has no modal dialog; opening one only needs to mark it open.
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true }
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false }
})

describe('SupportChat', () => {
  const CONTACT = 'mailto:support@healthidentitydirectory.com'
  const question = () => screen.getByLabelText<HTMLInputElement>('Your question')

  it('has focus on the question as soon as the chat opens, and on the launcher as soon as it closes', async () => {
    render(<SupportChat contact={CONTACT} send={vi.fn()} />)
    const launcher = screen.getByRole('button', { name: 'Support chat' })
    launcher.focus()
    const opened = focusWhenShown(() => document.querySelector('dialog[open]')?.querySelector('input'))
    outsideAct(() => launcher.click())
    const open = await opened
    expect(open.focused).toBe(open.element)

    const closed = focusWhenShown(() => document.querySelector('dialog:not([open])'))
    outsideAct(() => screen.getByRole('button', { name: 'Close' }).click())
    expect((await closed).focused).toBe(launcher)
  })

  // While a reply is on its way the question is disabled, so focusing it from the
  // click did nothing and focus stayed on "Start new chat".
  it('has focus on the question as soon as a new chat can be typed, even while a reply was pending', async () => {
    const send = vi.fn(() => new Promise<never>(() => undefined))
    render(<SupportChat contact={CONTACT} send={send} />)
    fireEvent.click(screen.getByRole('button', { name: 'Support chat' }))
    fireEvent.change(question(), { target: { value: 'How do I sign in?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(question().disabled).toBe(true)

    const restart = screen.getByRole('button', { name: 'Start new chat' })
    restart.focus()
    const shown = focusWhenShown(() => (question().disabled ? null : question()))
    fireEvent.click(restart)
    const { element, focused } = await shown
    expect(focused).toBe(element)
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('SiteNav', () => {
  const entries: readonly NavEntry[] = [
    { type: 'menu', label: 'Resources', items: [{ label: 'Blog', href: '/blog' }, { label: 'Security', href: '/security' }] },
    { type: 'link', label: 'Pricing', href: '/pricing' },
  ]
  const nav = () => render(<SiteNav entries={entries} signInHref="/sign-in" signInLabel="Sign in"
    action={{ label: 'Book a demo', href: '#demo' }} audience="provider" />)
  const collapsed = (trigger: HTMLElement) => () => (trigger.getAttribute('aria-expanded') === 'false' ? trigger : null)

  it('has focus on a menu’s button as soon as Escape closes the menu', async () => {
    nav()
    const trigger = screen.getByRole('button', { name: 'Resources' })
    trigger.focus()
    fireEvent.click(trigger)
    screen.getByRole('link', { name: 'Blog' }).focus()

    const shown = focusWhenShown(collapsed(trigger))
    fireEvent.keyDown(document, { key: 'Escape' })
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })

  it('has focus on the menu button as soon as Escape closes the small-screen menu', async () => {
    nav()
    const trigger = screen.getByRole('button', { name: 'Open menu' })
    trigger.focus()
    fireEvent.click(trigger)
    within(document.getElementById(trigger.getAttribute('aria-controls')!)!).getByRole('link', { name: 'Pricing' }).focus()

    const shown = focusWhenShown(collapsed(trigger))
    fireEvent.keyDown(document, { key: 'Escape' })
    const { element, focused } = await shown
    expect(focused).toBe(element)
    expect(element.getAttribute('aria-label')).toBe('Open menu')
  })
})
