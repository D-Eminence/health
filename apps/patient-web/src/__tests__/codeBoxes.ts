import { act, fireEvent } from '@testing-library/react'

/**
 * Enters a whole code into a code's first box (CodeBoxes.tsx), as a pasted or autofilled code arrives: every box
 * fills, focus goes to the last, and the sixth digit sends the form by itself, so no button is pressed.
 */
export async function enterCode(box: HTMLElement, code: string) {
  await act(async () => { fireEvent.change(box, { target: { value: code } }) })
}

/** The six boxes of the code whose first box is `box`. */
export function codeBoxesOf(box: HTMLElement): HTMLInputElement[] {
  const group = box.closest('fieldset')
  if (!group) throw new Error('Not a box of a code')
  return [...group.querySelectorAll('input')]
}

/** What the code's boxes hold, a space for each one empty. */
export const codeValue = (box: HTMLElement) => codeBoxesOf(box).map(input => input.value || ' ').join('').trimEnd()
