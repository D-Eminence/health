import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EhrButton, EhrDialog, EhrDrawer, EhrField, EhrInput } from '@hid/ui/ehr'
import { ShellHarness, spyOnFocus, workspace } from './ehrHarness'

/**
 * EhrDrawer: a modal side panel (a bottom sheet on phones). Focus enters,
 * stays and returns; a dirty drawer asks before discarding, and its form stays
 * mounted with its values.
 */

interface EditorProps {
  readonly onClose?: () => void
  /** Adds a button inside the drawer that opens a decision dialog over it. */
  readonly withDialog?: boolean
}

function StaffEditor({ onClose = () => {}, withDialog = false }: EditorProps) {
  const [open, setOpen] = useState(false)
  const [phone, setPhone] = useState('')
  const [asking, setAsking] = useState(false)
  const close = () => { onClose(); setOpen(false); setPhone('') }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Edit staff details</button>
      <EhrDrawer open={open} title="Staff details" dirty={phone !== ''} onClose={close}>
        <EhrField label="Work phone"><EhrInput value={phone} onChange={event => setPhone(event.target.value)} /></EhrField>
        {withDialog ? <EhrButton variant="danger" onClick={() => setAsking(true)}>Deactivate</EhrButton> : null}
        <EhrDialog
          open={asking}
          title="Deactivate this staff member?"
          description="They will lose access today."
          confirmLabel="Deactivate staff member"
          onConfirm={() => setAsking(false)}
          onCancel={() => setAsking(false)}
        />
      </EhrDrawer>
    </>
  )
}

function openDrawer(props: EditorProps = {}) {
  render(<ShellHarness><StaffEditor {...props} /></ShellHarness>)
  const opener = screen.getByRole('button', { name: 'Edit staff details' })
  opener.focus()
  fireEvent.click(opener)
  return { opener, drawer: screen.getByRole('dialog', { name: 'Staff details' }) }
}

describe('EhrDrawer', () => {
  it('is a modal dialog named by its title, with a Close button in its sticky header', () => {
    const { drawer } = openDrawer()
    expect(drawer.getAttribute('aria-modal')).toBe('true')
    expect(drawer.classList.contains('hid-ehr-drawer')).toBe(true)
    expect(drawer.closest('.hid-ehr-scrim')!.classList.contains('hid-ehr-scrim-drawer')).toBe(true)
    const close = within(drawer).getByRole('button', { name: 'Close' })
    expect(close.tagName).toBe('BUTTON')
    expect(close.getAttribute('type')).toBe('button')
    expect(close.closest('header')!.classList.contains('hid-ehr-drawer-header')).toBe(true)
  })

  it('moves focus in on open and makes the workspace inert', () => {
    const { drawer } = openDrawer()
    expect(document.activeElement).toBe(within(drawer).getByRole('button', { name: 'Close' }))
    expect(workspace().getAttribute('inert')).toBe('')
  })

  it('keeps Tab and Shift+Tab inside', () => {
    const { drawer } = openDrawer()
    const close = within(drawer).getByRole('button', { name: 'Close' })
    const phone = within(drawer).getByRole('textbox', { name: 'Work phone' })

    phone.focus()
    fireEvent.keyDown(phone, { key: 'Tab' })
    expect(document.activeElement).toBe(close)

    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(phone)
  })

  it('closes clean on Escape and returns focus to the opener, inert cleared before focus moves', () => {
    const onClose = vi.fn()
    const { opener, drawer } = openDrawer({ onClose })
    const { spy, inertAtCall } = spyOnFocus(opener)

    fireEvent.keyDown(within(drawer).getByRole('button', { name: 'Close' }), { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(inertAtCall).toEqual([null])
    expect(document.activeElement).toBe(opener)
    expect(workspace().hasAttribute('inert')).toBe(false)
  })

  it('closes clean from its Close button', () => {
    const onClose = vi.fn()
    const { opener, drawer } = openDrawer({ onClose })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('asks before discarding unsaved changes, focusing Keep editing, with the form still mounted', () => {
    const onClose = vi.fn()
    const { drawer } = openDrawer({ onClose })
    const phone = within(drawer).getByRole('textbox', { name: 'Work phone' }) as HTMLInputElement
    phone.focus()
    fireEvent.change(phone, { target: { value: '0800 000 0000' } })

    fireEvent.keyDown(phone, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    const choice = within(drawer).getByRole('group', { name: 'Discard unsaved changes?' })
    const keep = within(choice).getByRole('button', { name: 'Keep editing' })
    expect(within(choice).getByRole('button', { name: 'Discard changes' })).toBeDefined()
    expect(document.activeElement).toBe(keep)
    // Hidden while the question is open, never unmounted: the value survives.
    expect(phone.isConnected).toBe(true)
    expect(phone.closest('[hidden]')).not.toBeNull()
    expect(phone.value).toBe('0800 000 0000')

    fireEvent.click(keep)
    expect(within(drawer).queryByRole('group')).toBeNull()
    expect(phone.closest('[hidden]')).toBeNull()
    expect(phone.value).toBe('0800 000 0000')
    expect(document.activeElement).toBe(phone)
    expect(screen.getByRole('dialog', { name: 'Staff details' })).toBe(drawer)
  })

  it('asks from the Close button too, and Escape on the question keeps editing', () => {
    const onClose = vi.fn()
    const { drawer } = openDrawer({ onClose })
    fireEvent.change(within(drawer).getByRole('textbox', { name: 'Work phone' }), { target: { value: '0800 000 0001' } })
    const close = within(drawer).getByRole('button', { name: 'Close' })
    close.focus()
    fireEvent.click(close)
    const keep = within(drawer).getByRole('button', { name: 'Keep editing' })
    expect(document.activeElement).toBe(keep)

    fireEvent.keyDown(keep, { key: 'Escape' })
    expect(within(drawer).queryByRole('group')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(close)
  })

  it('discards and closes on Discard changes', () => {
    const onClose = vi.fn()
    const { opener, drawer } = openDrawer({ onClose })
    fireEvent.change(within(drawer).getByRole('textbox', { name: 'Work phone' }), { target: { value: '0800 000 0002' } })
    fireEvent.keyDown(within(drawer).getByRole('button', { name: 'Close' }), { key: 'Escape' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Discard changes' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(workspace().hasAttribute('inert')).toBe(false)
  })
})

describe('A dialog over a drawer', () => {
  it('makes the drawer inert beneath it, and clears that before focus returns into the drawer', () => {
    const { drawer } = openDrawer({ withDialog: true })
    const scrim = drawer.closest('.hid-ehr-scrim') as HTMLElement
    const deactivate = within(drawer).getByRole('button', { name: 'Deactivate' })
    deactivate.focus()
    fireEvent.click(deactivate)

    const dialog = screen.getByRole('alertdialog', { name: 'Deactivate this staff member?' })
    expect(workspace().getAttribute('inert')).toBe('')
    expect(scrim.getAttribute('inert')).toBe('')
    expect(dialog.closest('[inert]')).toBeNull()
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }))

    // Escape in the dialog closes the dialog only.
    const { spy, inertAtCall } = spyOnFocus(deactivate)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Staff details' })).toBe(drawer)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(inertAtCall).toEqual([null])
    expect(document.activeElement).toBe(deactivate)
    expect(scrim.hasAttribute('inert')).toBe(false)
    expect(workspace().getAttribute('inert')).toBe('')
  })

  it('keeps the drawer open when the dialog cancels from its button', () => {
    const { drawer } = openDrawer({ withDialog: true })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Deactivate' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Staff details' })).toBe(drawer)
  })
})
