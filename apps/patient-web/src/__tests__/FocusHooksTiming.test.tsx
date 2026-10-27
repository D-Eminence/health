import { useRef, useState, type FormEvent } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { useStepFocus } from '../authSteps'
import { useFocusOnPageChange } from '../pageFocus'
import { useActionFocus, useRetryFocus } from '../routes/actionFocus'
import { focusWhenShown } from './focusWhenShown'

/**
 * The portals' focus hooks move focus in the commit that shows where it goes.
 * From an effect, focus moved a task after a render that followed a request,
 * and a check made as soon as the outcome was shown (findBy on a busy runner,
 * as on health#16's CI) found focus still on the page. Each test answers the
 * request outside act, as a fetch's answer arrives, and reads focus at the
 * moment the outcome is shown.
 */
const environment = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }
afterEach(() => { environment.IS_REACT_ACT_ENVIRONMENT = true })

function deferred() {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

/** Presses a button the way a keyboard user does: focused, then activated. */
async function press(name: string) {
  const button = screen.getByRole('button', { name })
  button.focus()
  await act(async () => { fireEvent.click(button) })
}

/**
 * Settles a request outside act, as a fetch's answer arrives: React renders the
 * outcome in one task and runs its effects in a later one.
 */
function answer(settle: () => void) {
  environment.IS_REACT_ACT_ENVIRONMENT = false
  settle()
}

describe('a change of page (useFocusOnPageChange)', () => {
  /** A step whose request, once answered, opens the next page. */
  function Pages({ send }: { send: () => Promise<void> }) {
    const main = useRef<HTMLElement>(null)
    const navigate = useNavigate()
    const next = useLocation().pathname === '/next'
    useFocusOnPageChange(main)
    return <main ref={main}>{next ? <h1>Next page</h1> : <><h1>First page</h1>
      <button type="button" onClick={() => void send().then(() => navigate('/next'))}>Continue</button></>}</main>
  }

  it('has focus on the new page\'s heading as soon as the page is shown', async () => {
    const request = deferred()
    render(<MemoryRouter><Pages send={() => request.promise} /></MemoryRouter>)
    await press('Continue')
    const shown = focusWhenShown(() => screen.queryByRole('heading', { name: 'Next page' }))
    answer(request.resolve)
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })
})

describe('an action on a portal page (useActionFocus)', () => {
  /** An approval: the request leaves the list once answered, and focus goes to the list's heading. */
  function Requests({ send }: { send: () => Promise<void> }) {
    const heading = useRef<HTMLHeadingElement>(null)
    const focusAfter = useActionFocus()
    const [approved, setApproved] = useState(false)
    const approve = async () => {
      await send()
      setApproved(true)
      focusAfter(() => heading.current)
    }
    return <section><h2 ref={heading} tabIndex={-1}>Access requests</h2>
      {approved ? <p>Request approved.</p> : <button type="button" onClick={() => void approve()}>Approve</button>}</section>
  }

  it('has focus on the heading as soon as the outcome is shown', async () => {
    const request = deferred()
    render(<Requests send={() => request.promise} />)
    await press('Approve')
    const shown = focusWhenShown(() => screen.queryByText('Request approved.'))
    answer(request.resolve)
    const { focused } = await shown
    expect(focused).toBe(screen.getByRole('heading', { name: 'Access requests' }))
  })
})

describe('Try again (useRetryFocus)', () => {
  /** A list whose read failed: 'Try again' reads it again, and the loading state replaces the button meanwhile. */
  function History({ read }: { read: () => Promise<void> }) {
    const heading = useRef<HTMLHeadingElement>(null)
    const { button, retry } = useRetryFocus(heading)
    const [state, setState] = useState<'failed' | 'loading' | 'loaded'>('failed')
    const reload = async () => {
      setState('loading')
      try { await read(); setState('loaded') } catch { setState('failed') }
    }
    if (state === 'loading') return <p role="status">Loading…</p>
    return state === 'loaded' ? <h2 ref={heading} tabIndex={-1}>Access history</h2>
      : <button ref={button} type="button" onClick={() => retry(reload)}>Try again</button>
  }

  it('has focus on the heading as soon as what loaded is shown', async () => {
    const request = deferred()
    render(<History read={() => request.promise} />)
    await press('Try again')
    const shown = focusWhenShown(() => screen.queryByRole('heading', { name: 'Access history' }))
    answer(request.resolve)
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })

  it('has focus on the new Try again as soon as it is shown after the read fails again', async () => {
    const request = deferred()
    render(<History read={() => request.promise} />)
    await press('Try again')
    const shown = focusWhenShown(() => screen.queryByRole('button', { name: 'Try again' }))
    answer(() => request.reject(new Error('Unavailable')))
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })
})

describe('a step of an auth form (useStepFocus)', () => {
  /** Recovery's first steps: once the code is sent, its field replaces the identifier. */
  function Recovery({ send }: { send: () => Promise<void> }) {
    const step = useStepFocus()
    const [code, setCode] = useState(false)
    const start = async (event: FormEvent) => {
      event.preventDefault()
      try { await send(); setCode(true) } finally { step.focus() }
    }
    return code ? <form><label>Recovery code<input ref={step.target} /></label></form>
      : <form onSubmit={event => void start(event)}><label>Email or Health ID<input ref={step.target} /></label>
        <button type="submit">Send recovery code</button></form>
  }

  it('has focus on the next step\'s field as soon as the step is shown', async () => {
    const request = deferred()
    render(<Recovery send={() => request.promise} />)
    await press('Send recovery code')
    const shown = focusWhenShown(() => screen.queryByLabelText('Recovery code'))
    answer(request.resolve)
    const { element, focused } = await shown
    expect(focused).toBe(element)
  })
})
