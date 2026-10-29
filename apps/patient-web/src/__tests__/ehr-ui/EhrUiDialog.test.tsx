import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EhrDialog } from '@hid/ui/ehr'
import { Opener, ShellHarness, spyOnFocus, workspace } from './ehrHarness'

/**
 * EhrDialog: the decision dialog. jsdom moves no focus on Tab and ignores
 * inert, so the trap is driven by fireEvent.keyDown and inert is read as an
 * attribute, including at the moment focus returns to the opener.
 */

interface DeactivateProps {
  readonly confirmWord?: string
  readonly onConfirm?: () => void | Promise<unknown>
  readonly busy?: boolean
}

function Deactivate({ confirmWord, onConfirm = () => {}, busy }: DeactivateProps) {
  return (
    <Opener label="Deactivate staff member" render={(open, setOpen) => (
      <EhrDialog
        open={open}
        title="Deactivate this staff member?"
        description="They will lose access to Health ID EHR at this facility today."
        confirmLabel="Deactivate staff member"
        confirmVariant="danger"
        confirmWord={confirmWord}
        busy={busy}
        onConfirm={async () => { await onConfirm(); setOpen(false) }}
        onCancel={() => setOpen(false)}
      />
    )} />
  )
}

function openDialog(content = <Deactivate />) {
  render(<ShellHarness>{content}</ShellHarness>)
  const opener = screen.getByRole('button', { name: 'Deactivate staff member' })
  opener.focus()
  fireEvent.click(opener)
  return { opener, dialog: screen.getByRole('alertdialog', { name: 'Deactivate this staff member?' }) }
}

describe('EhrDialog', () => {
  it('is a modal alertdialog, named by its question and described by its body', () => {
    const { dialog } = openDialog()
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const description = document.getElementById(dialog.getAttribute('aria-describedby')!)!
    expect(description.textContent).toBe('They will lose access to Health ID EHR at this facility today.')
    expect(workspace().getAttribute('inert')).toBe('')
    expect(dialog.closest('[inert]')).toBeNull()
  })

  it('puts Cancel first and focuses it; the confirm button names the outcome', () => {
    const { dialog } = openDialog()
    const buttons = within(dialog).getAllByRole('button')
    expect(buttons.map(button => button.textContent)).toEqual(['Cancel', 'Deactivate staff member'])
    for (const button of buttons) {
      expect(button.tagName).toBe('BUTTON')
      expect(button.getAttribute('type')).toBe('button')
    }
    expect(document.activeElement).toBe(buttons[0])
  })

  it('keeps Tab and Shift+Tab inside', () => {
    const { dialog } = openDialog()
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    const confirm = within(dialog).getByRole('button', { name: 'Deactivate staff member' })

    confirm.focus()
    fireEvent.keyDown(confirm, { key: 'Tab' })
    expect(document.activeElement).toBe(cancel)

    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(confirm)
  })

  it('cancels on Escape and returns focus to the opener, inert cleared before focus moves', () => {
    const { opener, dialog } = openDialog()
    const { spy, inertAtCall } = spyOnFocus(opener)

    fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Cancel' }), { key: 'Escape' })

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(inertAtCall).toEqual([null])
    expect(document.activeElement).toBe(opener)
    expect(workspace().hasAttribute('inert')).toBe(false)
  })

  it('keeps confirm disabled until the confirmation word matches exactly', () => {
    const onConfirm = vi.fn()
    const { dialog } = openDialog(<Deactivate confirmWord="DEACTIVATE" onConfirm={onConfirm} />)
    const word = within(dialog).getByRole('textbox', { name: 'Type DEACTIVATE to confirm' })
    const confirm = within(dialog).getByRole('button', { name: 'Deactivate staff member' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)

    for (const attempt of ['deactivate', 'DEACTIVATE ', 'DEACTIVAT']) {
      fireEvent.change(word, { target: { value: attempt } })
      expect(confirm.disabled).toBe(true)
    }
    fireEvent.click(confirm)
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.change(word, { target: { value: 'DEACTIVATE' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('does not confirm twice while the action runs', () => {
    const onConfirm = vi.fn(() => new Promise<void>(() => {}))
    const { dialog } = openDialog(<Deactivate onConfirm={onConfirm} />)
    const confirm = within(dialog).getByRole('button', { name: 'Deactivate staff member' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(confirm.getAttribute('aria-busy')).toBe('true')
  })

  it('shows one dialog at a time: a second waits until the first closes', () => {
    function Two() {
      const [first, setFirst] = useState(true)
      const [second, setSecond] = useState(true)
      return (
        <>
          <EhrDialog open={first} title="Cancel this appointment?" description="The patient is not told automatically." confirmLabel="Cancel appointment" onConfirm={() => setFirst(false)} onCancel={() => setFirst(false)} />
          <EhrDialog open={second} title="Remove this ward?" description="Beds move to Unassigned." confirmLabel="Remove ward" onConfirm={() => setSecond(false)} onCancel={() => setSecond(false)} />
        </>
      )
    }
    render(<ShellHarness><Two /></ShellHarness>)
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1)
    const first = screen.getByRole('alertdialog', { name: 'Cancel this appointment?' })

    fireEvent.click(within(first).getByRole('button', { name: 'Cancel' }))
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1)
    const second = screen.getByRole('alertdialog', { name: 'Remove this ward?' })
    expect(document.activeElement).toBe(within(second).getByRole('button', { name: 'Cancel' }))
    expect(workspace().getAttribute('inert')).toBe('')

    fireEvent.click(within(second).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(workspace().hasAttribute('inert')).toBe(false)
  })

  it('without a shell, renders in place inside its own .hid-ehr wrapper, trapped and with no inert', () => {
    const { container } = render(<main><Deactivate /></main>)
    const opener = screen.getByRole('button', { name: 'Deactivate staff member' })
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('alertdialog')
    const wrapper = dialog.closest('.hid-ehr')!
    expect(container.contains(wrapper)).toBe(true)
    expect(document.querySelector('[inert]')).toBeNull()

    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    expect(document.activeElement).toBe(cancel)
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Deactivate staff member' }))

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})
