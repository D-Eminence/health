import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { PasswordInput } from '@hid/ui'
import { PasswordRules, passwordRules } from '../PasswordRules'

/**
 * The quiet checklist under a new-password field: the server's own rules only (12 characters, and the two fields
 * matching where there are two), each ticked as it is met while typing, read with the field, and announced politely
 * once, after a pause, when a rule becomes met.
 */
function Form({ confirmField = false }: { confirmField?: boolean }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  return <form>
    <label htmlFor="new-password">Password</label>
    <PasswordInput id="new-password" autoComplete="new-password" value={password} aria-describedby="new-password-rules"
      onChange={event => setPassword(event.target.value)} />
    {confirmField && <>
      <label htmlFor="new-confirm">Confirm password</label>
      <PasswordInput id="new-confirm" toggleLabel="Show confirmed password" autoComplete="new-password" value={confirm}
        onChange={event => setConfirm(event.target.value)} />
    </>}
    <PasswordRules id="new-password-rules" password={password} confirm={confirmField ? confirm : undefined} />
  </form>
}

const rule = (name: RegExp) => within(document.getElementById('new-password-rules')!).getByText(name).closest('li')!
const status = () => screen.getByTestId('new-password-rules-status')

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('PasswordRules', () => {
  it('lists only the server’s rules: 12 characters, and a match where there is a second field', () => {
    expect(passwordRules('').map(item => item.label)).toEqual(['At least 12 characters'])
    expect(passwordRules('', '').map(item => item.label)).toEqual(['At least 12 characters', 'Passwords match'])
    expect(passwordRules('a'.repeat(11))[0]?.met).toBe(false)
    expect(passwordRules('a'.repeat(12))[0]?.met).toBe(true)
    // An empty confirmation never "matches" an empty password.
    expect(passwordRules('', '')[1]?.met).toBe(false)
  })

  it('is read with the field it is under (aria-describedby), with a tip, and is not a pop-up', () => {
    render(<Form />)
    const field = screen.getByLabelText('Password')
    expect(field.getAttribute('aria-describedby')).toContain('new-password-rules')
    const described = document.getElementById('new-password-rules')!
    expect(described.textContent).toContain('At least 12 characters (not yet)')
    expect(described.textContent).toContain('Tip: a few words together is easy to remember.')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('ticks the length rule as it is met while typing, in words as well as by its icon', () => {
    render(<Form />)
    const field = screen.getByLabelText('Password')
    expect(rule(/At least 12 characters/).hasAttribute('data-met')).toBe(false)
    expect(rule(/At least 12 characters/).querySelector('svg')).toBeNull()
    fireEvent.change(field, { target: { value: 'correct horse' } })
    expect(rule(/At least 12 characters/).hasAttribute('data-met')).toBe(true)
    expect(rule(/At least 12 characters/).textContent?.trim()).toBe('At least 12 characters (done)')
    expect(rule(/At least 12 characters/).querySelector('svg')).not.toBeNull()
    fireEvent.change(field, { target: { value: 'short' } })
    expect(rule(/At least 12 characters/).textContent?.trim()).toBe('At least 12 characters (not yet)')
  })

  it('says “Passwords match” only when the two fields agree', () => {
    render(<Form confirmField />)
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'twelve chars!' } })
    expect(rule(/Passwords match/).hasAttribute('data-met')).toBe(false)
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'twelve chars' } })
    expect(rule(/Passwords match/).hasAttribute('data-met')).toBe(false)
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'twelve chars!' } })
    expect(rule(/Passwords match/).textContent?.trim()).toBe('Passwords match (done)')
    // The list describes the new password field; the confirmation keeps its own mismatch message, where a form has one.
    expect(screen.getByLabelText('Password').getAttribute('aria-describedby')).toContain('new-password-rules')
  })

  it('announces a rule politely once it becomes met and typing pauses, not on every key', () => {
    render(<Form />)
    const field = screen.getByLabelText('Password')
    expect(status().getAttribute('aria-live')).toBe('polite')
    // The live region is not part of the field's description, so the description is not read twice.
    expect(document.getElementById('new-password-rules')!.contains(status())).toBe(false)
    for (const value of ['a', 'ab', 'abc', 'abcd']) fireEvent.change(field, { target: { value } })
    act(() => { vi.advanceTimersByTime(2000) })
    expect(status().textContent).toBe('')
    fireEvent.change(field, { target: { value: 'abcdefghijkl' } })
    // Still typing: nothing said yet.
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.change(field, { target: { value: 'abcdefghijklm' } })
    act(() => { vi.advanceTimersByTime(300) })
    expect(status().textContent).toBe('')
    act(() => { vi.advanceTimersByTime(700) })
    expect(status().textContent).toBe('At least 12 characters: done.')
    // More typing while the rule stays met says nothing new.
    fireEvent.change(field, { target: { value: 'abcdefghijklmn' } })
    act(() => { vi.advanceTimersByTime(2000) })
    expect(status().textContent).toBe('At least 12 characters: done.')
  })

  it('does not announce a rule met and lost again before the pause', () => {
    render(<Form />)
    const field = screen.getByLabelText('Password')
    fireEvent.change(field, { target: { value: 'abcdefghijkl' } })
    fireEvent.change(field, { target: { value: 'abcdefghijk' } })
    act(() => { vi.advanceTimersByTime(2000) })
    expect(status().textContent).toBe('')
  })
})
