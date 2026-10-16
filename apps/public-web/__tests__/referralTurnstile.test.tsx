import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The referral form shows its security check on step 2 only, so Back and
 * Change remove the widget. Its token used to stay in the form: on Continue a
 * fresh widget rendered, yet Send was enabled at once and sent the removed
 * widget's token, which hid-system refuses once it is over 300 seconds old
 * (403 TURNSTILE_EXPIRED_OR_REPLAYED) and nothing is recorded. As in the demo
 * dialog (DemoDialogTurnstile.test.tsx), each showing of the check needs its
 * own answer.
 */
const submitDemoRequest = vi.hoisted(() => vi.fn())
vi.mock('@/lib/commercial-api', () => ({ submitDemoRequest }))
vi.mock('@/lib/env', () => ({
  getEnvironment: () => ({ name: 'production', appOrigin: 'https://www.healthidentitydirectory.com',
    apiBaseUrl: 'https://www.healthidentitydirectory.com', turnstileSiteKey: 'site-key' }),
}))

import { ReferralForm } from '@/components/referral/ReferralForm'

interface Widget { element: HTMLElement; options: Record<string, unknown> }
const widgets = new Map<string, Widget>()
let issued = 0
const turnstile = {
  render: vi.fn((container: HTMLElement, options: Record<string, unknown>) => {
    const id = `widget-${++issued}`
    const element = document.createElement('div')
    element.dataset.fakeTurnstile = String(options.action)
    container.appendChild(element)
    widgets.set(id, { element, options })
    return id
  }),
  remove: vi.fn((id: string) => { widgets.get(id)?.element.remove(); widgets.delete(id) }),
  reset: vi.fn(),
}
const shown = () => document.querySelectorAll('[data-fake-turnstile]').length
function current(): Widget {
  const widget = [...widgets.values()].find(item => item.element.isConnected)
  if (!widget) throw new Error('No security check on the page')
  return widget
}
const solve = (token: string) => act(() => (current().options.callback as (value: string) => void)(token))
const fail = () => act(() => (current().options['error-callback'] as () => void)())

beforeEach(() => {
  widgets.clear(); issued = 0; window.turnstile = turnstile
  submitDemoRequest.mockResolvedValue(undefined)
})
afterEach(() => { vi.clearAllMocks(); Reflect.deleteProperty(window, 'turnstile') })

const send = () => screen.getByRole('button', { name: 'Send referral' }) as HTMLButtonElement
function fill(name: string, value: string) {
  fireEvent.change(document.querySelector(`[name="${name}"]`)!, { target: { value } })
}
async function reachStepTwo() {
  fill('facilityName', 'Lagos General Hospital')
  fill('facilityType', 'hospital')
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await waitFor(() => expect(shown()).toBe(1))
}

describe('the referral form’s security check', () => {
  it.each([
    ['Back', () => fireEvent.click(screen.getByRole('button', { name: 'Back' }))],
    ['Change', () => fireEvent.click(screen.getByRole('button', { name: 'Change' }))],
  ])('needs a fresh answer after %s and Continue', async (_name, leave) => {
    render(<ReferralForm />)
    await reachStepTwo()
    fill('referrerName', 'Ada Okafor')
    fill('referrerEmail', 'ada@example.test')
    fireEvent.click(screen.getByRole('checkbox', { name: 'The facility knows I am introducing them to Health ID.' }))
    solve('OLD-TOKEN')
    expect(send().disabled).toBe(false)

    leave()
    await waitFor(() => expect(shown()).toBe(0))
    expect(turnstile.remove).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(shown()).toBe(1))
    expect(turnstile.render).toHaveBeenCalledTimes(2)
    // The first widget's token went with it: this one needs its own answer.
    expect(send().disabled).toBe(true)

    solve('NEW-TOKEN')
    expect(send().disabled).toBe(false)
    fireEvent.click(send())
    await waitFor(() => expect(submitDemoRequest).toHaveBeenCalledTimes(1))
    expect(submitDemoRequest.mock.calls[0]![0]).toMatchObject({ turnstileToken: 'NEW-TOKEN' })
  })

  it('drops the removed widget’s failure message along with it', async () => {
    render(<ReferralForm />)
    await reachStepTwo()
    fail()
    expect(screen.getByRole('alert').textContent).toBe('Verification failed. Please try again.')

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(shown()).toBe(1))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
