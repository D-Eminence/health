import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MemoryRouter } from 'react-router-dom'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FileText, House, Settings } from 'lucide-react'
import { SupportChat } from '@hid/ui'
import { AppShell, type NavItem } from '../kasuwa/AppShell'
import { FormActions } from '../kasuwa/parts'

/**
 * The Support chat launcher on a phone. It floated over the bottom-right corner at full width ("Support chat", 156px),
 * so on the patient pages it covered the bottom menu's ➕, Access and Menu, and on sign-in and sign-up it sat on top of
 * form fields. Now, on a phone, it is a round icon that keeps its name for assistive technology, it sits above the
 * bottom menu wherever there is one, it steps aside while a form field is being typed in, and pages leave room to scroll
 * past it. Fictional people only.
 */
const send = vi.fn(async () => ({ sessionId: 'session-1', messages: ['Hi'] }))
const contact = 'mailto:support@healthidentitydirectory.com'
const launcher = () => screen.getByRole('button', { name: 'Support chat' })
const tokens = readFileSync(resolve(__dirname, '../../../../packages/ui/src/tokens.css'), 'utf8')
const authLayout = readFileSync(resolve(__dirname, '../authLayout.css'), 'utf8')
const shellSource = readFileSync(resolve(__dirname, '../kasuwa/AppShell.tsx'), 'utf8')
const shareSource = readFileSync(resolve(__dirname, '../routes/ShareRecords.tsx'), 'utf8')
/** The body of the first `@media (<query>) { … }` block that contains `selector`, braces balanced. */
function mediaBlocks(css: string, query: string): string[] {
  const blocks: string[] = []
  let at = css.indexOf(`@media (${query})`)
  while (at >= 0) {
    const open = css.indexOf('{', at)
    let depth = 0, end = open
    for (; end < css.length; end++) { if (css[end] === '{') depth++; else if (css[end] === '}' && --depth === 0) break }
    blocks.push(css.slice(open + 1, end))
    at = css.indexOf(`@media (${query})`, end)
  }
  return blocks
}

// jsdom has no modal dialogs (as in StagingChat.test.tsx).
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
const typing = () => launcher().getAttribute('data-typing')
/** The launcher comes back only after the task in which focus left the field (and the press that moved it) ends. */
const settled = () => act(() => new Promise<void>(resolve => { setTimeout(resolve, 0) }))

describe('the Support chat launcher on a phone', () => {
  it('keeps "Support chat" as its name in a label that a phone can hide behind the icon', () => {
    render(<SupportChat contact={contact} send={send} />)
    const label = launcher().querySelector('.hid-chat-launcher-label')
    expect(label?.textContent).toBe('Support chat')
  })

  it('steps aside while a form field outside the chat is being typed in, and comes back when it is left', async () => {
    render(<><label>First name <input /></label><label>Email <input type="email" /></label><label>Notes <textarea /></label>
      <label><input type="checkbox" /> I agree</label><button type="button">Continue</button><SupportChat contact={contact} send={send} /></>)
    expect(typing()).toBeNull()
    fireEvent.focusIn(screen.getByRole('textbox', { name: 'First name' }))
    expect(typing()).toBe('true')
    fireEvent.focusIn(screen.getByRole('textbox', { name: 'Email' }))
    expect(typing()).toBe('true')
    fireEvent.focusIn(screen.getByRole('textbox', { name: 'Notes' }))
    expect(typing()).toBe('true')
    // A checkbox or a button opens no keyboard: the launcher comes back, once the move of focus is over.
    fireEvent.focusIn(screen.getByRole('checkbox', { name: 'I agree' }))
    await settled()
    expect(typing()).toBeNull()
    fireEvent.focusIn(screen.getByRole('textbox', { name: 'First name' }))
    expect(typing()).toBe('true')
    fireEvent.focusOut(screen.getByRole('textbox', { name: 'First name' }), { relatedTarget: null })
    await settled()
    expect(typing()).toBeNull()
    fireEvent.focusIn(screen.getByRole('textbox', { name: 'First name' }))
    fireEvent.focusIn(screen.getByRole('button', { name: 'Continue' }))
    await settled()
    expect(typing()).toBeNull()
  })

  it('stays out of the way until a tap that moves focus off a field is over, so the tap reaches what is under it', async () => {
    // A tap's mousedown moves focus to the button. Taking pointer events back at once sent the tap's mouseup, and so its
    // click, to the launcher instead of the button: "Send invitation" did nothing (Chrome on Android, measured).
    render(<><label>Email <input type="email" /></label><button type="button">Send invitation</button>
      <SupportChat contact={contact} send={send} /></>)
    const email = screen.getByRole('textbox', { name: 'Email' })
    const button = screen.getByRole('button', { name: 'Send invitation' })
    fireEvent.focusIn(email)
    fireEvent.pointerDown(button)
    fireEvent.focusOut(email, { relatedTarget: button })
    fireEvent.focusIn(button)
    expect(typing()).toBe('true')
    await settled()
    expect(typing()).toBe('true')
    fireEvent.pointerUp(button)
    expect(typing()).toBe('true')
    await settled()
    expect(typing()).toBeNull()
  })

  it('comes back when the field that had focus leaves the page without a focusout, as after signing in on an iPhone', async () => {
    // Safari and Firefox fire no focusout for a focused field that is removed: the page moves on (sign-in to Home), and
    // the launcher stayed hidden there until something else took focus. jsdom does the same.
    function Page() {
      const [signedIn, setSignedIn] = useState(false)
      return signedIn ? <h1>Home</h1>
        : <form onSubmit={event => { event.preventDefault(); setSignedIn(true) }}><label>Password <input type="password" /></label></form>
    }
    render(<><Page /><SupportChat contact={contact} send={send} /></>)
    const password = screen.getByLabelText('Password')
    act(() => { password.focus() })
    expect(typing()).toBe('true')
    let focusOuts = 0
    password.addEventListener('focusout', () => { focusOuts++ })
    fireEvent.submit(password.closest('form')!)
    expect(screen.getByRole('heading', { name: 'Home' })).toBeTruthy()
    expect(focusOuts).toBe(0)
    await waitFor(() => expect(typing()).toBeNull())
  })

  it('stays reachable while it steps aside: hidden by opacity on a phone, not removed from the page or the tab order', () => {
    render(<><label>First name <input /></label><SupportChat contact={contact} send={send} /></>)
    fireEvent.focusIn(screen.getByRole('textbox', { name: 'First name' }))
    expect(launcher().hidden).toBe(false)
    expect(launcher().getAttribute('tabindex')).toBeNull()
    const phone = mediaBlocks(tokens, 'max-width: 640px').join('\n')
    expect(phone).toMatch(/\.hid-chat-launcher\[data-typing\]\s*\{[^}]*opacity:\s*0[^}]*pointer-events:\s*none/)
    expect(phone).not.toMatch(/\.hid-chat-launcher\[data-typing\]\s*\{[^}]*(display:\s*none|visibility:\s*hidden)/)
  })

  it('is a 48px round icon on a phone (below 640px), with its label hidden visually only', () => {
    // Below 640px, not only to 480: from 481px the 156px "Support chat" pill sat on the sticky buttons above the menu.
    const small = mediaBlocks(tokens, 'max-width: 639.98px').join('\n')
    expect(small).toMatch(/\.hid-chat-launcher\s*\{[^}]*width:\s*48px[^}]*height:\s*48px/)
    expect(small).toMatch(/\.hid-chat-launcher-label\s*\{[^}]*position:\s*absolute[^}]*clip-path:\s*inset\(50%\)/)
  })

  it('sits above the bottom menu wherever the shell shows one (below 1024px)', () => {
    const shell = render(<MemoryRouter><AppShell brand={<span>Health ID</span>} switcher={{ name: 'Health ID', subtitle: 'Patient' }}
      nav={[{ items: TABS }]} tabs={TABS} person={{ name: 'Ada Okafor', detail: 'HID-ADA2345' }} onSignOut={() => undefined}>
      <h1>Home</h1></AppShell></MemoryRouter>)
    expect(shell.container.querySelector('nav[aria-label="Quick"]')?.hasAttribute('data-hid-bottom-nav')).toBe(true)
    const belowLarge = mediaBlocks(tokens, 'max-width: 1023.98px').join('\n')
    expect(belowLarge).toMatch(/:root:has\(\[data-hid-bottom-nav\]\)\s+\.hid-chat-launcher\s*\{[^}]*bottom:\s*calc\(env\(safe-area-inset-bottom\)\s*\+\s*76px\)/)
  })

  it('keeps the buttons held at the foot of a phone\'s screen clear of it, where it is on the page', () => {
    // A form's sticky buttons sit above the bottom menu, where the launcher is: it covered the right end of Share's
    // Continue and "Share my records", and a tap there opened the chat. Their bar ends its buttons before the launcher.
    const { container, rerender } = render(<FormActions><button type="submit">Save</button></FormActions>)
    const bar = () => container.querySelector('[data-form-actions]')!.getAttribute('class')!.split(/\s+/)
    expect(bar()).toContain('max-sm:[:root:has(.hid-chat-launcher)_&]:pr-[76px]')
    rerender(<FormActions sticky={false}><button type="submit">Save</button></FormActions>)
    expect(bar().some(name => name.includes('hid-chat-launcher'))).toBe(false)
    // Share's steps end in their own bar, inside the card (16px in from the screen's edge).
    expect(shareSource).toMatch(/data-form-actions=""[^>]*max-sm:sticky[^>]*max-sm:\[:root:has\(\.hid-chat-launcher\)_&\]:pr-\[60px\]/)
  })

  it('leaves room at the foot of a page to scroll its last line clear of the launcher', () => {
    // The shell's main area: 144px under the content below 1024px (the bottom menu, 64px, plus the launcher above it).
    expect(shellSource).toMatch(/max-lg:pb-36/)
    expect(shellSource).not.toMatch(/max-lg:pb-28/)
    // Sign-in, sign-up and recovery on a phone: room for the launcher in the corner.
    const phone = mediaBlocks(authLayout, 'max-width: 640px').join('\n')
    expect(phone).toMatch(/:root:has\(\.hid-chat-launcher\)\s+\.auth-main\s*\{[^}]*padding-bottom:\s*calc\(88px \+ env\(safe-area-inset-bottom\)\)/)
  })
})

const TABS: readonly NavItem[] = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/records', label: 'Records', icon: FileText },
  { to: '/access', label: 'Access', icon: Settings },
]
