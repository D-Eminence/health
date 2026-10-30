import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ShellUpdate } from '../shellUpdateAdapter'
import { anyUnsavedForms, trackUnsavedForms } from '../unsavedForms'

/**
 * "Update now" reloads the tab, so it waits while a form holds unsaved edits or a change is sending (§2.12, A7, A9).
 * The hook here answers as the shell's does: canUpdate is false while the unsaved-form source says a form is dirty.
 */
const shell = vi.hoisted(() => ({ value: null as ShellUpdate | null }))
vi.mock('../shellUpdateAdapter', () => ({ useShellUpdate: () => shell.value, setUnsavedFormsSource: vi.fn() }))
const { UpdateBanner } = await import('../UpdateBanner')

const update = vi.fn()
function hook(o: { canUpdate: boolean; sending?: boolean }): ShellUpdate {
  return { ready: true, updatedElsewhere: false, sending: o.sending ?? false, canUpdate: o.canUpdate, update, reload: vi.fn() }
}

let stop: (() => void) | null = null
afterEach(() => { stop?.(); stop = null; update.mockReset() })

function Form() {
  return <form><label>Clinical note<textarea name="content" /></label></form>
}

describe('update banner', () => {
  it('is disabled while a form holds unsaved edits, and enabled once it is clean', () => {
    stop = trackUnsavedForms(document)
    shell.value = hook({ canUpdate: !anyUnsavedForms() })
    const view = render(<><Form /><UpdateBanner /></>)
    expect(screen.getByRole('button', { name: 'Update now' })).toHaveProperty('disabled', false)

    fireEvent.input(screen.getByRole('textbox', { name: 'Clinical note' }), { target: { value: 'Chest clear' } })
    expect(anyUnsavedForms()).toBe(true)
    shell.value = hook({ canUpdate: !anyUnsavedForms() })
    view.rerender(<><Form /><UpdateBanner /></>)
    const button = screen.getByRole('button', { name: 'Update now' })
    expect(button).toHaveProperty('disabled', true)
    expect(screen.getByText('Save or close open forms first.')).toBeTruthy()
    fireEvent.click(button)
    expect(update).not.toHaveBeenCalled()

    // Saved: the form resets, and the update may go ahead.
    fireEvent.reset(screen.getByRole('textbox', { name: 'Clinical note' }).closest('form')!)
    expect(anyUnsavedForms()).toBe(false)
    shell.value = hook({ canUpdate: !anyUnsavedForms() })
    view.rerender(<><Form /><UpdateBanner /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }))
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('waits while a change is sending in any tab', () => {
    shell.value = hook({ canUpdate: false, sending: true })
    render(<UpdateBanner />)
    expect(screen.getByRole('button', { name: 'Update now' })).toHaveProperty('disabled', true)
    expect(screen.getByText('Waiting for changes to finish sending.')).toBeTruthy()
  })

  it('counts a form no longer on the page as gone', () => {
    stop = trackUnsavedForms(document)
    const view = render(<Form />)
    fireEvent.input(screen.getByRole('textbox', { name: 'Clinical note' }), { target: { value: 'Draft' } })
    expect(anyUnsavedForms()).toBe(true)
    view.unmount()
    expect(anyUnsavedForms()).toBe(false)
  })

  it('shows nothing until an update is ready', () => {
    shell.value = { ...hook({ canUpdate: false }), ready: false }
    const { container } = render(<UpdateBanner />)
    expect(container.textContent).toBe('')
  })
})
