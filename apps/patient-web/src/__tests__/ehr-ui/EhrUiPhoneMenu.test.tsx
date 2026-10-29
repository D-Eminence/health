import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ShellHarness, spyOnFocus, workspace } from './ehrHarness'

/**
 * The phone menu: on phones CSS hides the sidebar rail and shows the top
 * bar's menu button, which opens the same navigation as a modal panel. No
 * script reads the viewport, so the button works the same at any width here.
 */

function openMenu() {
  render(<ShellHarness />)
  const button = screen.getByRole('button', { name: 'Menu' })
  button.focus()
  fireEvent.click(button)
  return { button, panel: screen.getByRole('dialog', { name: 'Menu' }) }
}

describe('EHR phone menu', () => {
  it('is a native button whose aria-expanded follows the panel it controls', () => {
    render(<ShellHarness />)
    const button = screen.getByRole('button', { name: 'Menu' })
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    // The dialog role, aria-modal and the trap exist only while the panel is open.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelector('[aria-modal]')).toBeNull()

    fireEvent.click(button)
    const panel = screen.getByRole('dialog', { name: 'Menu' })
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.getAttribute('aria-controls')).toBe(panel.id)
    expect(panel.getAttribute('aria-modal')).toBe('true')
  })

  it('opens as a modal panel: the same navigation, focus inside, the workspace inert', () => {
    const { panel } = openMenu()
    const nav = within(panel).getByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).getByRole('link', { name: 'Patients' }).getAttribute('aria-current')).toBe('page')
    expect(within(nav).getByRole('button', { name: 'Care' }).getAttribute('aria-expanded')).toBe('true')
    expect(panel.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(within(panel).getByRole('button', { name: 'Close menu' }))
    expect(workspace().getAttribute('inert')).toBe('')
    expect(panel.closest('[inert]')).toBeNull()
  })

  it('keeps Tab and Shift+Tab inside the panel', () => {
    const { panel } = openMenu()
    const close = within(panel).getByRole('button', { name: 'Close menu' })
    const last = within(panel).getByRole('link', { name: 'Facility settings' })

    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(close)

    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('closes on Escape and returns focus to the menu button, inert cleared before focus moves', () => {
    const { button, panel } = openMenu()
    const { spy, inertAtCall } = spyOnFocus(button)

    fireEvent.keyDown(within(panel).getByRole('link', { name: 'Staff' }), { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(inertAtCall).toEqual([null])
    expect(document.activeElement).toBe(button)
    expect(workspace().hasAttribute('inert')).toBe(false)
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('closes from its Close button and when a link is followed', () => {
    const { button, panel } = openMenu()
    fireEvent.click(within(panel).getByRole('button', { name: 'Close menu' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(button)

    fireEvent.click(button)
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Menu' })).getByRole('link', { name: 'Appointments' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(workspace().hasAttribute('inert')).toBe(false)
  })
})
