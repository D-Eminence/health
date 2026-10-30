import { useState, type ReactNode } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EhrDialog, EhrDrawer } from '@hid/ui/ehr'
import { ShellHarness, Opener } from './ehrHarness'

/**
 * Focus stays in an open overlay even where the browser's tab order is not the DOM's: only a radio group's checked
 * radio is a tab stop, a closed <details> shows only its summary, and a control hidden by CSS takes no focus. Guards
 * at the scrim's edges send a Tab that slips past round to the other end, and should focus still fall out to the
 * body, the top overlay keeps answering Escape and Tab.
 *
 * jsdom has no tab order of its own. When the trap lets a Tab through (does not prevent it), the test moves focus
 * where a browser would: to the next tab stop, which past the last real one is the closing guard.
 */
function pressTab(from: HTMLElement, browserWouldFocus: () => HTMLElement, shiftKey = false) {
  const passedThrough = fireEvent.keyDown(from, { key: 'Tab', shiftKey })
  if (passedThrough) act(() => browserWouldFocus().focus())
  return passedThrough
}

const guards = () => [...document.querySelectorAll<HTMLElement>('[data-ehr-focus-guard]')]
const closingGuard = () => guards().at(-1)!
const openingGuard = () => guards()[0]!

function Drawer({ children, onClose = () => {} }: { readonly children: ReactNode; readonly onClose?: () => void }) {
  return <ShellHarness><EhrDrawer open title="Bed allocation" onClose={onClose}>{children}</EhrDrawer></ShellHarness>
}

describe('focus guards', () => {
  it('sit at both edges of the scrim, out of sight and out of the trap\'s own list', () => {
    render(<Drawer><button type="button">Allocate bed</button></Drawer>)
    const [opening, closing] = guards()
    const dialog = screen.getByRole('dialog', { name: 'Bed allocation' })
    expect(guards()).toHaveLength(2)
    expect(opening!.tabIndex).toBe(0)
    expect(opening!.classList.contains('hid-ehr-focus-guard')).toBe(true)
    expect(opening!.compareDocumentPosition(dialog) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(closing!.compareDocumentPosition(dialog) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    // Opening focuses the first real stop, never a guard.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    // Reaching a guard sends focus round: the opening one to the last stop, the closing one to the first.
    act(() => openingGuard().focus())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Allocate bed' }))
    act(() => closingGuard().focus())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
  })

  it('keep Tab inside when a radio group is the last stop', () => {
    render(
      <Drawer>
        <fieldset>
          <legend>Ward</legend>
          <label><input type="radio" name="ward" value="a" /> Ward A</label>
          <label><input type="radio" name="ward" value="b" defaultChecked /> Ward B</label>
          <label><input type="radio" name="ward" value="c" /> Ward C</label>
        </fieldset>
      </Drawer>,
    )
    const checked = screen.getByRole('radio', { name: 'Ward B' })
    act(() => checked.focus())
    // The checked radio is the group's only stop, so the trap knows it is the last and wraps itself.
    expect(pressTab(checked, closingGuard)).toBe(false)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    // Backwards from the first stop lands on the checked radio, not on Ward C.
    expect(pressTab(screen.getByRole('button', { name: 'Close' }), openingGuard, true)).toBe(false)
    expect(document.activeElement).toBe(checked)
  })

  it('keep Tab inside when a <details> block is the last element', () => {
    render(
      <Drawer>
        <button type="button">Allocate bed</button>
        <details>
          <summary>Bed history</summary>
          <button type="button">Show older moves</button>
        </details>
      </Drawer>,
    )
    const summary = screen.getByText('Bed history')
    act(() => summary.focus())
    pressTab(summary, closingGuard)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    // The button inside the closed block is no tab stop: backwards from the start lands on the summary.
    pressTab(screen.getByRole('button', { name: 'Close' }), openingGuard, true)
    expect(document.activeElement).toBe(summary)
  })

  it('keep Tab inside when the last button is hidden by CSS', () => {
    render(
      <Drawer>
        <style>{'.hidden-by-css { display: none; }'}</style>
        <button type="button">Allocate bed</button>
        <button type="button" className="hidden-by-css">Undo allocation</button>
      </Drawer>,
    )
    const visible = screen.getByRole('button', { name: 'Allocate bed' })
    act(() => visible.focus())
    // The DOM still lists the hidden button last, so the trap lets this Tab through; the browser skips the hidden
    // button and lands on the closing guard, which sends focus round.
    expect(pressTab(visible, closingGuard)).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    expect(document.activeElement?.closest('.hid-ehr-scrim')).not.toBeNull()
  })
})

describe('keys after focus falls out of the overlay', () => {
  function DrawerWithDialog({ onDrawerClose, onDialogCancel }: { readonly onDrawerClose: () => void; readonly onDialogCancel: () => void }) {
    const [asking, setAsking] = useState(false)
    return (
      <ShellHarness>
        <Opener label="Open bed allocation" render={(open, setOpen) => (
          <EhrDrawer open={open} title="Bed allocation" onClose={() => { onDrawerClose(); setOpen(false) }}>
            <button type="button" onClick={() => setAsking(true)}>Release bed</button>
            <EhrDialog open={asking} title="Release this bed?" description="The patient leaves the ward list."
              confirmLabel="Release bed" onConfirm={() => setAsking(false)} onCancel={() => { onDialogCancel(); setAsking(false) }} />
          </EhrDrawer>
        )} />
      </ShellHarness>
    )
  }

  it('still closes on Escape, and Tab brings focus back in', () => {
    const onDrawerClose = vi.fn()
    render(<DrawerWithDialog onDrawerClose={onDrawerClose} onDialogCancel={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open bed allocation' }))
    act(() => (document.activeElement as HTMLElement).blur())
    expect(document.activeElement).toBe(document.body)
    expect(fireEvent.keyDown(document.body, { key: 'Tab' })).toBe(false)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    act(() => (document.activeElement as HTMLElement).blur())
    expect(fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true })).toBe(false)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Release bed' }))
    act(() => (document.activeElement as HTMLElement).blur())
    expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(false)
    expect(onDrawerClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog', { name: 'Bed allocation' })).toBeNull()
    // Closed, it listens no more.
    expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(true)
    expect(onDrawerClose).toHaveBeenCalledTimes(1)
  })

  it('leaves the keys to the top overlay only', () => {
    const onDrawerClose = vi.fn()
    const onDialogCancel = vi.fn()
    render(<DrawerWithDialog onDrawerClose={onDrawerClose} onDialogCancel={onDialogCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open bed allocation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Release bed' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Release this bed?' })
    act(() => (document.activeElement as HTMLElement).blur())
    fireEvent.keyDown(document.body, { key: 'Tab' })
    expect(dialog.contains(document.activeElement)).toBe(true)
    act(() => (document.activeElement as HTMLElement).blur())
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onDialogCancel).toHaveBeenCalledTimes(1)
    expect(onDrawerClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Bed allocation' })).toBeDefined()
    expect(within(screen.getByRole('dialog', { name: 'Bed allocation' })).getByRole('button', { name: 'Release bed' })).toBeDefined()
  })
})
