import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Drawer, Modal } from '../../kasuwa/interactive'

/**
 * The shared drawer and dialog are modal (aria-modal), so keyboard focus stays inside them until they close: Tab from the
 * last control goes back to the first, Shift+Tab from the first (or from the title, where focus lands as a drawer opens)
 * goes to the last, and the page behind is never reached. Escape closes, and focus goes back to what opened it. jsdom
 * moves no focus for Tab itself, so these press Tab at the edges, where the dialog has to step in. Fictional people only.
 */
function Page({ kind }: { kind: 'drawer' | 'modal' }) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const body = <><label htmlFor="reason">Reason</label><input id="reason" /></>
  const footer = <><button type="button" onClick={close}>Cancel</button><button type="button">Approve</button></>
  return <>
    <button type="button">Behind the dialog</button>
    <button type="button" onClick={() => setOpen(true)}>Review Ikeja Medical Centre</button>
    {kind === 'drawer'
      ? <Drawer open={open} onClose={close} title="Ikeja Medical Centre" footer={footer}>{body}</Drawer>
      : <Modal open={open} onClose={close} title="End access" footer={footer}>{body}</Modal>}
    <a href="/records">Records</a>
  </>
}

const tab = (shift = false) => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey: shift })
const focused = () => document.activeElement

describe.each(['drawer', 'modal'] as const)('the shared %s', kind => {
  function openIt() {
    render(<Page kind={kind} />)
    const opener = screen.getByRole('button', { name: 'Review Ikeja Medical Centre' })
    opener.focus()
    fireEvent.click(opener)
    return { opener, dialog: screen.getByRole('dialog') }
  }

  it('takes Tab from its last control back to its first, never to the page behind', () => {
    const { dialog } = openIt()
    const approve = screen.getByRole('button', { name: 'Approve' })
    approve.focus()
    tab()
    expect(focused()).toBe(screen.getByRole('button', { name: 'Close' }))
    expect(dialog.contains(focused())).toBe(true)
  })

  it('takes Shift+Tab from its first control to its last', () => {
    openIt()
    screen.getByRole('button', { name: 'Close' }).focus()
    tab(true)
    expect(focused()).toBe(screen.getByRole('button', { name: 'Approve' }))
  })

  it('leaves Tab between its own controls to the browser', () => {
    openIt()
    screen.getByRole('button', { name: 'Close' }).focus()
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    focused()!.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('brings focus that got behind it back inside', () => {
    const { dialog } = openIt()
    screen.getByRole('button', { name: 'Behind the dialog' }).focus()
    tab()
    expect(dialog.contains(focused())).toBe(true)
  })

  it('closes on Escape and gives focus back to what opened it', () => {
    const { opener } = openIt()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(focused()).toBe(opener)
  })
})

describe('the shared drawer, as it opens on its title', () => {
  it('takes Shift+Tab from the title to its last control', () => {
    render(<Page kind="drawer" />)
    fireEvent.click(screen.getByRole('button', { name: 'Review Ikeja Medical Centre' }))
    expect(focused()).toBe(screen.getByRole('heading', { name: 'Ikeja Medical Centre' }))
    tab(true)
    expect(focused()).toBe(screen.getByRole('button', { name: 'Approve' }))
  })

  it('counts only the chosen option of a group of radios, the one Tab reaches', () => {
    function Choices() {
      const [open, setOpen] = useState(false)
      return <>
        <button type="button" onClick={() => setOpen(true)}>Open</button>
        <Drawer open={open} onClose={() => setOpen(false)} title="How long">
          <fieldset><legend>How long</legend>
            <label><input type="radio" name="how-long" value="day" defaultChecked /> A day</label>
            <label><input type="radio" name="how-long" value="week" /> A week</label>
          </fieldset>
        </Drawer>
      </>
    }
    render(<Choices />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    tab(true)
    expect(focused()).toBe(screen.getByRole('radio', { name: 'A day' }))
  })
})
