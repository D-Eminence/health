import { act, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useFocusById } from './focus'

vi.mock('./App', () => ({ useStaff: () => ({ lock: null }) }))

const environment = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
afterEach(() => { environment.IS_REACT_ACT_ENVIRONMENT = true })

/** A lookup that keeps focus on Find if it was lost, then a retry form whose short reason takes focus. */
let finishLookup = () => {}
function Steps() {
  const focus = useFocusById()
  const [found, setFound] = useState(false)
  finishLookup = () => { setFound(true); focus('find', true) }
  return <>
    <button id="find" type="button">Find</button>
    {found && <form onSubmit={event => { event.preventDefault(); focus('reason') }}>
      <textarea id="reason" aria-label="Reason" />
      <button id="retry" type="submit">Retry</button>
    </form>}
  </>
}

describe('useFocusById', () => {
  it('a request made before an earlier one was handled still moves focus', async () => {
    render(<Steps />)
    // The lookup's answer arrives outside act, as a fetch's does: React commits it in one task and runs its
    // effects in a later one. A press in between (a busy runner in CI, run 39889977663) used to see the earlier
    // request's effect clear the newer request, so focus never reached the field.
    const pressed = new Promise<void>(resolve => {
      const observer = new MutationObserver(() => {
        const retry = document.getElementById('retry')
        if (!retry) return
        observer.disconnect()
        environment.IS_REACT_ACT_ENVIRONMENT = true
        retry.focus()
        act(() => { retry.click() })
        resolve()
      })
      observer.observe(document.body, { childList: true, subtree: true })
    })
    environment.IS_REACT_ACT_ENVIRONMENT = false
    finishLookup()
    await pressed
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Reason')))
  })

  it('a request handled with nothing newer still clears, so a later render does not repeat it', async () => {
    render(<Steps />)
    act(() => { finishLookup() })
    // The lookup's request kept focus on Find (it was lost); moving it elsewhere is the user's choice.
    expect(document.activeElement).toBe(document.getElementById('find'))
    act(() => { screen.getByLabelText('Reason').focus() })
    act(() => { document.getElementById('retry')!.click() })
    expect(document.activeElement).toBe(screen.getByLabelText('Reason'))
    act(() => { document.getElementById('find')!.focus() })
    act(() => { screen.getByLabelText('Reason').dispatchEvent(new Event('input', { bubbles: true })) })
    expect(document.activeElement).toBe(document.getElementById('find'))
  })
})
