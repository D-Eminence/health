import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react'

/** The digits in every code a patient types: sign-up, password reset, enrollment and an emergency contact's. */
export const CODE_LENGTH = 6

/** Whether a code from CodeBoxes holds all six digits; a box left empty is a space in it. */
export const codeComplete = (code: string) => /^\d{6}$/.test(code)

interface CodeBoxesProps {
  /** The first box's id; the others are `${id}-2` to `${id}-6`, the name `${id}-label`. */
  id: string
  /** The field's name, shown above the boxes and naming their group. */
  label: string
  value: string
  onChange: (code: string) => void
  /** Ref for the first box: where focus goes as the step opens (authSteps.ts useStepFocus). */
  inputRef?: (element: HTMLInputElement | null) => void
  invalid?: true
  /** The hint, and the error when it is about the code: on the group and on the first box, where focus arrives. */
  describedBy?: string
  /** A request is running: a code completed meanwhile is not sent by itself. */
  busy?: boolean
  autoFocus?: boolean
}

/**
 * Six boxes for a six-digit code, as hid-1.0's OtpInputs: typing moves to the next box, Backspace in an empty box
 * goes back and clears the one before, the arrow keys move, and a pasted or autofilled code fills every box. The
 * form is sent by itself once the sixth digit is in (hid-1.0's code "checks itself"), once: a code corrected after
 * a refusal is sent with the form's button, so a slip does not spend another of the code's tries.
 *
 * A code is entered from its first empty box. An empty box further along sends focus there, when tapped (a phone
 * opens its keyboard only for a box tapped) or reached with the arrows, and is out of the tab order, so Tab leaves
 * the code rather than coming back; digits typed or pasted into one go there too. So a code typed from any box is
 * not split or cut short, and an empty code's focus is in the first box, the one that offers the code from a
 * message. A box with a digit takes focus wherever it is, to correct it.
 *
 * A fieldset names the group; the first box is named by it and "Digit 1 of 6", the others "Digit n of 6".
 */
export function CodeBoxes({ id, label, value, onChange, inputRef, invalid, describedBy, busy = false, autoFocus }: CodeBoxesProps) {
  const boxes = useRef<Array<HTMLInputElement | null>>([])
  const group = useRef<HTMLFieldSetElement>(null)
  const digits = Array.from({ length: CODE_LENGTH }, (_, index) => /\d/.test(value[index] ?? '') ? value[index]! : '')
  // This change completed the code: the form is sent once the page holds it (below).
  const completed = useRef(false)
  const boxId = (index: number) => index === 0 ? id : `${id}-${index + 1}`
  const firstEmpty = digits.findIndex(digit => !digit)
  /** Whether a box may hold focus: one with a digit, or the first empty one. */
  const reachable = (index: number) => Boolean(digits[index]) || firstEmpty === -1 || index <= firstEmpty
  /** Where digits typed or pasted into a box go from. */
  const startOf = (index: number) => reachable(index) ? index : firstEmpty
  /** The nearest box from `index` that way that may hold focus, or `index` when there is none. */
  const nearest = (index: number, way: 1 | -1) => {
    for (let next = index + way; next >= 0 && next < CODE_LENGTH; next += way) if (reachable(next)) return next
    return index
  }
  // Focus moved by this component: to a box the change it just made fills, which this render does not show yet.
  const moving = useRef(false)

  useEffect(() => {
    if (!completed.current) return
    completed.current = false
    if (!codeComplete(value) || busy) return
    // As the form's button would, so its own checks run; a browser without requestSubmit leaves it to the button.
    const form = group.current?.closest('form')
    if (typeof form?.requestSubmit === 'function') form.requestSubmit()
  }, [value, busy])

  const emit = (next: string[]) => {
    const code = next.map(digit => digit || ' ').join('').trimEnd()
    completed.current = codeComplete(code) && !codeComplete(value)
    onChange(code)
  }
  const moveTo = (index: number) => {
    const box = boxes.current[Math.max(0, Math.min(CODE_LENGTH - 1, index))]
    moving.current = true
    try { box?.focus() } finally { moving.current = false }
    box?.select()
  }
  /** Digits from `start` on, as many as fit; focus goes to the box after the last one filled. */
  const fill = (start: number, typed: string) => {
    const next = [...digits]
    const fitted = typed.slice(0, CODE_LENGTH - start)
    for (const [offset, digit] of [...fitted].entries()) next[start + offset] = digit
    emit(next)
    moveTo(start + fitted.length)
  }
  const change = (index: number, raw: string) => {
    const typed = raw.replace(/\D/g, '')
    if (!typed) { const next = [...digits]; next[index] = ''; emit(next); return }
    // A digit typed beside the one already in the box replaces it.
    const kept = digits[index]
    if (typed.length === 2 && kept && typed.includes(kept)) { fill(index, typed[0] === kept ? typed[1]! : typed[0]!); return }
    // A whole code (pasted, or filled in from a message) fills every box, whichever box it went into.
    fill(typed.length >= CODE_LENGTH ? 0 : startOf(index), typed)
  }
  const paste = (index: number, event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault()
    const typed = event.clipboardData.getData('text').replace(/\D/g, '')
    if (typed) fill(typed.length >= CODE_LENGTH ? 0 : startOf(index), typed)
  }
  const key = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      event.preventDefault()
      const next = [...digits]; next[index - 1] = ''; emit(next)
      moveTo(index - 1)
    } else if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); moveTo(nearest(index, -1)) }
    else if (event.key === 'ArrowRight' && index < CODE_LENGTH - 1) { event.preventDefault(); moveTo(nearest(index, 1)) }
    else if (event.key === 'Home') { event.preventDefault(); moveTo(0) }
    else if (event.key === 'End') { event.preventDefault(); moveTo(nearest(CODE_LENGTH, -1)) }
  }
  const focused = (index: number, box: HTMLInputElement) => {
    if (moving.current || reachable(index)) box.select()
    else moveTo(firstEmpty)
  }

  return <fieldset ref={group} className="patient-code-field" data-code-boxes="" aria-describedby={describedBy}>
    <legend id={`${id}-label`}>{label}</legend>
    <div className="patient-code-boxes">{digits.map((digit, index) => <input key={index} id={boxId(index)}
      ref={element => { boxes.current[index] = element; if (index === 0) inputRef?.(element) }}
      type="text" inputMode="numeric" autoComplete={index === 0 ? 'one-time-code' : 'off'} value={digit}
      tabIndex={reachable(index) ? undefined : -1} data-code-box={index + 1} autoFocus={index === 0 ? autoFocus : undefined}
      aria-label={`Digit ${index + 1} of ${CODE_LENGTH}`}
      aria-labelledby={index === 0 ? `${id}-label ${id}` : undefined}
      aria-invalid={invalid} aria-describedby={index === 0 ? describedBy : undefined}
      onChange={event => change(index, event.target.value)} onPaste={event => paste(index, event)}
      onKeyDown={event => key(index, event)} onFocus={event => focused(index, event.target)} />)}</div>
  </fieldset>
}
