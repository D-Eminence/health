import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Field, PasswordInput } from '@hid/ui'

/**
 * A password field with a Show toggle (@hid/ui PasswordInput). The toggle is a
 * real button beside the field, never inside its label (inside, Chromium names
 * the field "Password Show password"). Its name stays "Show password" and
 * aria-pressed says whether the password is shown (the WAI-ARIA toggle button
 * pattern: a toggle's name does not change with its state). Showing the
 * password changes only how it is displayed: the value, autocomplete and the
 * form's submission are untouched, and it is hidden again when the form is sent,
 * the page is left, or the person switches away from it.
 */
afterEach(() => { vi.restoreAllMocks() })

function Login({ onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault()) }: { onSubmit?: (event: React.FormEvent) => void }) {
  return <form onSubmit={onSubmit}>
    <label htmlFor="password">Password</label>
    <PasswordInput id="password" autoComplete="current-password" defaultValue="abcdef" />
    <button type="submit">Sign in</button>
  </form>
}
const field = () => screen.getByLabelText('Password') as HTMLInputElement
const toggle = (pressed?: boolean) => screen.getByRole('button', { name: 'Show password', ...(pressed === undefined ? {} : { pressed }) }) as HTMLButtonElement

describe('PasswordInput', () => {
  it('starts hidden, with a Show toggle that controls it and is not part of its label', () => {
    render(<Login />)
    expect(field().type).toBe('password')
    const button = toggle(false)
    expect(button.type).toBe('button')
    expect(button.getAttribute('aria-controls')).toBe('password')
    expect(button.textContent).toBe('Show')
    // Named by its label alone: the toggle is outside it (its name is checked revealed, below).
    expect(Array.from(field().labels ?? []).some(label => label.contains(button))).toBe(false)
  })

  it('shows the password, keeping its value, autocomplete and focus, and submits nothing', () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
    render(<Login onSubmit={onSubmit} />)
    const input = field()
    input.focus()
    input.setSelectionRange(2, 2)
    // A pointer press does not take focus from the field (the person keeps typing).
    expect(fireEvent.mouseDown(toggle())).toBe(false)
    fireEvent.click(toggle())
    expect(input.type).toBe('text')
    expect(input.value).toBe('abcdef')
    expect(input.getAttribute('autocomplete')).toBe('current-password')
    expect(toggle(true)).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Password' })).toBe(input)
    expect(document.activeElement).toBe(input)
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 2])
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.click(toggle())
    expect(input.type).toBe('password')
    expect(toggle(false)).toBeTruthy()
  })

  it('is hidden again when its form is sent', () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
    render(<Login onSubmit={onSubmit} />)
    fireEvent.click(toggle())
    expect(field().type).toBe('text')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(field().type).toBe('password')
    expect(field().value).toBe('abcdef')
    expect(toggle(false)).toBeTruthy()
  })

  it('is hidden again, at once, when the page is hidden', () => {
    render(<Login />)
    fireEvent.click(toggle())
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    expect(field().type).toBe('password')
    expect(toggle(false)).toBeTruthy()
  })

  it('is hidden again when the person switches away (another tab or app, a locked screen)', () => {
    render(<Login />)
    fireEvent.click(toggle())
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(field().type).toBe('password')
    expect(toggle(false)).toBeTruthy()
    visibility.mockRestore()
  })

  it('is the only reveal control: Edge’s own is hidden', () => {
    render(<Login />)
    expect(field().className).toContain('[&::-ms-reveal]:hidden')
  })

  it('takes a Field’s error as an Input does; the toggle is not described by it', () => {
    render(<Field label="Password" htmlFor="staff-password" error="Wrong password"><PasswordInput id="staff-password" /></Field>)
    const input = screen.getByLabelText('Password')
    expect(input.getAttribute('aria-describedby')).toBe('staff-password-error')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(toggle().hasAttribute('aria-describedby')).toBe(false)
  })

  it('is invalid when the page says so, as a page’s own fields are', () => {
    render(<><label htmlFor="confirm">Confirm new password</label><PasswordInput id="confirm" aria-invalid aria-describedby="mismatch" /><p id="mismatch">Passwords do not match.</p></>)
    const input = screen.getByLabelText('Confirm new password')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe('mismatch')
  })

  it('adds no description of its own, and asks for no spelling or capitalisation help', () => {
    render(<Login />)
    expect(field().hasAttribute('aria-describedby')).toBe(false)
    expect(field().getAttribute('spellcheck')).toBe('false')
    expect(field().getAttribute('autocapitalize')).toBe('none')
  })

  it('gives its ref the field, and is unavailable when the field is disabled', () => {
    const ref = createRef<HTMLInputElement>()
    render(<><label htmlFor="pw">Password</label><PasswordInput id="pw" ref={ref} disabled /></>)
    expect(ref.current).toBe(field())
    expect(toggle().disabled).toBe(true)
  })

  it('names each toggle after its field where a form has two', () => {
    render(<form>
      <label htmlFor="new">New password</label><PasswordInput id="new" toggleLabel="Show new password" />
      <label htmlFor="confirm">Confirm new password</label><PasswordInput id="confirm" toggleLabel="Show confirmed password" />
    </form>)
    fireEvent.click(screen.getByRole('button', { name: 'Show confirmed password' }))
    expect((screen.getByLabelText('New password') as HTMLInputElement).type).toBe('password')
    expect((screen.getByLabelText('Confirm new password') as HTMLInputElement).type).toBe('text')
  })
})
