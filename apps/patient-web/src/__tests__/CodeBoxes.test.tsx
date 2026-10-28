import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect, useState, type FormEvent } from 'react'
import { CodeBoxes, codeComplete } from '../CodeBoxes'

/**
 * hid-1.0's six-box code entry (src/components/OtpInputs.tsx), for every six-digit code a patient types: a pasted
 * code fills every box, typing moves on, Backspace goes back, and the sixth digit sends the form by itself.
 */
function Form({ onSubmit = () => {}, busy = false, initial = '' }: { onSubmit?: (code: string) => void; busy?: boolean; initial?: string }) {
  const [code, setCode] = useState(initial)
  const submit = (event: FormEvent) => { event.preventDefault(); onSubmit(code) }
  return <form onSubmit={submit}>
    <p id="hint">Enter the six digit code we sent.</p>
    <CodeBoxes id="code" label="Verification code" value={code} onChange={setCode} busy={busy} describedBy="hint" invalid={undefined} />
    <output data-testid="value">{code}</output>
    <button type="submit" disabled={busy || !codeComplete(code)}>Verify code</button>
  </form>
}
const group = () => screen.getByRole('group', { name: 'Verification code' })
const boxes = () => within(group()).getAllByRole('textbox') as HTMLInputElement[]
const box = (n: number) => boxes()[n - 1]!
const value = () => screen.getByTestId('value').textContent
const paste = (target: HTMLElement, text: string) => fireEvent.paste(target, { clipboardData: { getData: () => text } })
/**
 * The code's form as a page shows it after a request answers: in a later task, at React's default priority (outside
 * act), so React commits that render and leaves its effects for a task after the next paint. Until then the code is
 * shown as `waiting`, and "Checking…" says a request is running.
 */
function Answered({ onSubmit, waiting }: { onSubmit: (code: string) => void; waiting: 'hidden' | 'busy' }) {
  const [answered, setAnswered] = useState(false)
  useEffect(() => { const timer = setTimeout(() => setAnswered(true)); return () => clearTimeout(timer) }, [])
  if (!answered && waiting === 'hidden') return null
  return <>{!answered && <p>Checking…</p>}<Form onSubmit={onSubmit} busy={!answered} initial={waiting === 'busy' ? '12345' : ''} /></>
}
/** Observers a failed test left watching, so none fires into a later test. */
const watching: MutationObserver[] = []
afterEach(() => { watching.splice(0).forEach(observer => observer.disconnect()) })
/** Runs `then` the moment `ready` holds after a change to the page: after a render commits, before its effects run. */
function onCommit(ready: () => boolean, then: () => void) {
  const observer = new MutationObserver(() => {
    if (!ready()) return
    observer.disconnect()
    then()
  })
  observer.observe(document.body, { childList: true, subtree: true })
  watching.push(observer)
}
/** Typed as a keyboard does: a character at a time into the box with focus, after what it holds. */
const typeKeys = (text: string) => {
  for (const character of text) {
    const target = document.activeElement as HTMLInputElement
    fireEvent.change(target, { target: { value: target.value + character } })
  }
}

describe('six-box code entry', () => {
  it('is a group named by its label, with each box named "Digit n of 6" and the first also by the label', () => {
    render(<Form />)
    expect(boxes()).toHaveLength(6)
    expect(group().getAttribute('aria-describedby')).toBe('hint')
    for (const [index, input] of boxes().entries()) {
      expect(input.getAttribute('aria-label')).toBe(`Digit ${index + 1} of 6`)
      expect(input.getAttribute('inputmode')).toBe('numeric')
    }
    // The first box is the field: named by the label as well, described by the hint, and the one a code is filled into.
    expect(screen.getByLabelText('Verification code')).toBe(box(1))
    expect(screen.getByRole('textbox', { name: 'Verification code Digit 1 of 6' })).toBe(box(1))
    expect(screen.getByRole('textbox', { name: 'Digit 4 of 6' })).toBe(box(4))
    expect(box(1).getAttribute('aria-describedby')).toBe('hint')
    expect(box(1).getAttribute('autocomplete')).toBe('one-time-code')
    expect(box(2).getAttribute('autocomplete')).toBe('off')
  })

  it('moves to the next box as each digit is typed, and ignores anything but digits', () => {
    render(<Form />)
    box(1).focus()
    fireEvent.change(box(1), { target: { value: '4' } })
    expect(document.activeElement).toBe(box(2))
    fireEvent.change(box(2), { target: { value: 'x' } })
    expect(box(2).value).toBe('')
    expect(document.activeElement).toBe(box(2))
    fireEvent.change(box(2), { target: { value: '7' } })
    expect(value()).toBe('47')
    expect(document.activeElement).toBe(box(3))
  })

  it('replaces a box\'s digit with the one typed beside it', () => {
    render(<Form initial="12" />)
    fireEvent.change(box(1), { target: { value: '19' } })
    expect(value()).toBe('92')
    expect(document.activeElement).toBe(box(2))
  })

  it('fills every box from a pasted code, whichever box it is pasted into', () => {
    render(<Form onSubmit={() => {}} />)
    paste(box(4), 'Your code is 123 456.')
    expect(boxes().map(input => input.value)).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(document.activeElement).toBe(box(6))
  })

  it('fills from the box pasted into when fewer than six digits are pasted, or from the first empty box', () => {
    render(<Form initial="123456" />)
    paste(box(3), '98')
    expect(value()).toBe('129856')
    expect(document.activeElement).toBe(box(5))
    paste(box(2), 'no digits')
    expect(value()).toBe('129856')
  })

  it('takes digits pasted or typed into an empty box from the first empty box, so the code has no gap', () => {
    render(<Form initial="1" />)
    paste(box(4), '98')
    expect(value()).toBe('198')
    expect(document.activeElement).toBe(box(4))
    fireEvent.change(box(6), { target: { value: '7' } })
    expect(value()).toBe('1987')
    expect(document.activeElement).toBe(box(5))
  })

  it('sends focus from an empty box further along to the first empty box, which offers the code from a message', async () => {
    render(<Form />)
    // A phone opens its keyboard only for a box that is tapped: say the third of an empty row.
    act(() => { box(3).focus() })
    expect(document.activeElement).toBe(box(1))
    expect(box(1).getAttribute('autocomplete')).toBe('one-time-code')
    // Typed a key at a time into the box with focus, each after what the box holds: the code as typed.
    await act(async () => { typeKeys('123456') })
    expect(boxes().map(input => input.value).join('')).toBe('123456')
    expect(value()).toBe('123456')
  })

  it('lets a box with a digit take focus wherever it is, to correct it', () => {
    render(<Form initial="12 456" />)
    act(() => { box(5).focus() })
    expect(document.activeElement).toBe(box(5))
    act(() => { box(6).focus() })
    expect(document.activeElement).toBe(box(6))
  })

  it('leaves the empty boxes after the first empty one out of the tab order, so Tab leaves the code', () => {
    render(<Form />)
    expect(boxes().map(input => input.tabIndex)).toEqual([0, -1, -1, -1, -1, -1])
    fireEvent.change(box(1), { target: { value: '4' } })
    expect(boxes().map(input => input.tabIndex)).toEqual([0, 0, -1, -1, -1, -1])
  })

  it('takes a whole code filled into the first box from a message (autofill)', () => {
    render(<Form />)
    fireEvent.change(box(1), { target: { value: '654321' } })
    expect(boxes().map(input => input.value).join('')).toBe('654321')
  })

  it('goes back with Backspace from an empty box, clearing the digit before', () => {
    render(<Form initial="123" />)
    box(4).focus()
    fireEvent.keyDown(box(4), { key: 'Backspace' })
    expect(value()).toBe('12')
    expect(document.activeElement).toBe(box(3))
    // In a box with a digit, Backspace clears it there and stays.
    fireEvent.change(box(2), { target: { value: '' } })
    expect(value()).toBe('1')
  })

  it('keeps an emptied box empty, so the code is not complete until it is filled again', () => {
    render(<Form initial="123456" />)
    fireEvent.change(box(3), { target: { value: '' } })
    expect(value()).toBe('12 456')
    expect(codeComplete(value()!)).toBe(false)
    expect((screen.getByRole('button', { name: 'Verify code' }) as HTMLButtonElement).disabled).toBe(true)
    expect(box(3).value).toBe('')
    expect(box(4).value).toBe('4')
  })

  it('moves between the boxes with the arrow keys, Home and End, up to the first empty box', () => {
    render(<Form initial="1234" />)
    act(() => { box(3).focus() })
    fireEvent.keyDown(box(3), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(box(4))
    fireEvent.keyDown(box(4), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(box(3))
    fireEvent.keyDown(box(3), { key: 'End' })
    expect(document.activeElement).toBe(box(5))
    fireEvent.keyDown(box(5), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(box(5))
    fireEvent.keyDown(box(5), { key: 'Home' })
    expect(document.activeElement).toBe(box(1))
  })

  it('moves with the arrows and End past the empty boxes after the first empty one, to a box that may hold focus', () => {
    render(<Form initial="1  4" />)
    act(() => { box(1).focus() })
    fireEvent.keyDown(box(1), { key: 'End' })
    expect(document.activeElement).toBe(box(4))
    fireEvent.keyDown(box(4), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(box(2))
    fireEvent.keyDown(box(2), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(box(4))
    fireEvent.change(box(2), { target: { value: '2' } })
    fireEvent.change(box(3), { target: { value: '3' } })
    fireEvent.change(box(5), { target: { value: '5' } })
    fireEvent.change(box(6), { target: { value: '6' } })
    act(() => { box(1).focus() })
    fireEvent.keyDown(box(1), { key: 'End' })
    expect(document.activeElement).toBe(box(6))
  })

  it('sends the form by itself once the sixth digit is in, once', async () => {
    const onSubmit = vi.fn()
    render(<Form onSubmit={onSubmit} />)
    for (const [index, digit] of [...'12345'].entries()) fireEvent.change(box(index + 1), { target: { value: digit } })
    expect(onSubmit).not.toHaveBeenCalled()
    await act(async () => { fireEvent.change(box(6), { target: { value: '6' } }) })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('123456')
  })

  it('does not send a code corrected while it stays complete: the button sends it', async () => {
    const onSubmit = vi.fn()
    render(<Form onSubmit={onSubmit} initial="123456" />)
    await act(async () => { fireEvent.change(box(6), { target: { value: '67' } }) })
    expect(value()).toBe('123457')
    expect(onSubmit).not.toHaveBeenCalled()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Verify code' })) })
    expect(onSubmit).toHaveBeenCalledWith('123457')
  })

  it('sends a code completed again after a digit was cleared', async () => {
    const onSubmit = vi.fn()
    render(<Form onSubmit={onSubmit} initial="123456" />)
    fireEvent.change(box(2), { target: { value: '' } })
    await act(async () => { fireEvent.change(box(2), { target: { value: '9' } }) })
    expect(onSubmit).toHaveBeenCalledWith('193456')
  })

  // A code pasted or filled in from a message the moment the boxes appear, or the sixth digit typed just as a request
  // ends: React runs the earlier render's effect first, and that one must not take the code (the CI failure of
  // EnrollmentProfileFields' "carries the fields named by the contact proof", whose code was never sent).
  it('sends a code completed the moment the boxes appear, before React has run their first effect', async () => {
    const onSubmit = vi.fn()
    onCommit(() => screen.queryByLabelText('Verification code') !== null,
      () => { fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '123456' } }) })
    render(<Answered onSubmit={onSubmit} waiting="hidden" />)
    await waitFor(() => expect(value()).toBe('123456'))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('123456')
  })

  it('sends a code completed the moment a request ends, before React has run that render\'s effect', async () => {
    const onSubmit = vi.fn()
    onCommit(() => screen.queryByText('Checking…') === null, () => { fireEvent.change(box(6), { target: { value: '6' } }) })
    render(<Answered onSubmit={onSubmit} waiting="busy" />)
    await waitFor(() => expect(value()).toBe('123456'))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('123456')
  })

  it('does not send a code completed while a request is running', async () => {
    const onSubmit = vi.fn()
    render(<Form onSubmit={onSubmit} busy />)
    await act(async () => { paste(box(1), '123456') })
    expect(value()).toBe('123456')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not send a code completed while a request was running once that request ends', async () => {
    const onSubmit = vi.fn()
    const { rerender } = render(<Form onSubmit={onSubmit} busy />)
    await act(async () => { paste(box(1), '123456') })
    await act(async () => { rerender(<Form onSubmit={onSubmit} busy={false} />) })
    expect(value()).toBe('123456')
    expect(onSubmit).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Verify code' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('marks every box invalid when the code was refused', () => {
    render(<CodeBoxes id="refused" label="Recovery code" value="000000" onChange={() => {}} invalid describedBy="hint error" />)
    for (const input of screen.getAllByRole('textbox')) expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByLabelText('Recovery code').getAttribute('aria-describedby')).toBe('hint error')
  })
})
