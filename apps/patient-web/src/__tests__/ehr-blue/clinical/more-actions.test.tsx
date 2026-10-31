import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { MoreActions, type MoreActionItem } from '../../../ehr-blue/clinical/parts/MoreActions'

/**
 * "More actions" (owner decision 1): the menu button at the end of an Available actions card that holds the live
 * actions the design's card does not show. A real menu button: aria-haspopup="menu", aria-expanded, the arrow keys,
 * Home and End, Escape, and a press outside. The items are fictional.
 */

const ITEMS: readonly MoreActionItem[] = [
  { id: 'hold', label: 'Put encounter on hold' },
  { id: 'complete', label: 'Complete encounter' },
  { id: 'cancel', label: 'Cancel encounter' },
]

function Harness({ onSelect = () => {}, items = ITEMS }: { onSelect?: (id: string) => void; items?: readonly MoreActionItem[] }) {
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <div>
      <button type="button">Before</button>
      <MoreActions items={items} selected={selected} onSelect={id => { setSelected(id); onSelect(id) }} />
      <button type="button">Outside</button>
      <p data-testid="chosen">{selected ?? ''}</p>
    </div>
  )
}

function button() {
  return screen.getByRole('button', { name: /^More actions/ })
}

function menuItems() {
  return within(screen.getByRole('menu')).getAllByRole('menuitem')
}

describe('More actions menu', () => {
  it('more actions: is a menu button, closed at first, with aria-haspopup="menu" and aria-expanded', () => {
    render(<Harness />)
    expect(button().tagName).toBe('BUTTON')
    expect(button().getAttribute('type')).toBe('button')
    expect(button().getAttribute('aria-haspopup')).toBe('menu')
    expect(button().getAttribute('aria-expanded')).toBe('false')
    expect(button().getAttribute('aria-controls')).toBeNull()
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(button())
    expect(button().getAttribute('aria-expanded')).toBe('true')
    const menu = screen.getByRole('menu')
    expect(button().getAttribute('aria-controls')).toBe(menu.id)
    expect(menu.getAttribute('aria-labelledby')).toBe(button().id)
    expect(menuItems().map(item => item.textContent)).toEqual(ITEMS.map(item => item.label))
    // A click opens it on its first item.
    expect(document.activeElement).toBe(menuItems()[0])
  })

  it('more actions: ArrowDown on the button opens the menu and focuses the first item; ArrowUp the last', () => {
    render(<Harness />)
    fireEvent.keyDown(button(), { key: 'ArrowDown' })
    expect(button().getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(menuItems()[0])
    // Roving focus: only the focused item is in the tab order.
    expect(menuItems().map(item => item.tabIndex)).toEqual([0, -1, -1])
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.keyDown(button(), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(menuItems()[2])
    expect(menuItems().map(item => item.tabIndex)).toEqual([-1, -1, 0])
  })

  it('more actions: the arrow keys move through the items and wrap at either end; Home and End go to the first and last', () => {
    render(<Harness />)
    fireEvent.keyDown(button(), { key: 'ArrowDown' })
    const press = (key: string) => fireEvent.keyDown(document.activeElement!, { key })
    press('ArrowDown')
    expect(document.activeElement).toBe(menuItems()[1])
    press('ArrowDown')
    expect(document.activeElement).toBe(menuItems()[2])
    press('ArrowDown')
    expect(document.activeElement).toBe(menuItems()[0])
    press('ArrowUp')
    expect(document.activeElement).toBe(menuItems()[2])
    press('ArrowUp')
    expect(document.activeElement).toBe(menuItems()[1])
    press('Home')
    expect(document.activeElement).toBe(menuItems()[0])
    press('End')
    expect(document.activeElement).toBe(menuItems()[2])
    expect(menuItems().map(item => item.tabIndex)).toEqual([-1, -1, 0])
  })

  it('more actions: Escape closes the menu and returns focus to the button, choosing nothing', () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    fireEvent.click(button())
    fireEvent.keyDown(menuItems()[1]!, { key: 'ArrowDown' })
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(button().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(button())
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('more actions: choosing an item calls onSelect with its id, closes the menu and returns focus to the button', () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    fireEvent.click(button())
    fireEvent.click(menuItems()[1]!)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('complete')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(button())
    // The button says which item's form is open (to a screen reader).
    expect(button().textContent).toContain('Complete encounter open')
    expect(screen.getByTestId('chosen').textContent).toBe('complete')
  })

  it('more actions: a press outside closes the menu without choosing', () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    fireEvent.click(button())
    // A press inside the menu keeps it open.
    fireEvent.pointerDown(menuItems()[0]!)
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(button().getAttribute('aria-expanded')).toBe('false')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('more actions: a second click on the button closes the menu', () => {
    render(<Harness />)
    fireEvent.click(button())
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.click(button())
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('more actions: Tab closes the menu with focus back on the button, so the tab order moves on from there', () => {
    render(<Harness />)
    fireEvent.click(button())
    fireEvent.keyDown(menuItems()[0]!, { key: 'Tab' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(button())
  })

  it('more actions: focus moving to another control closes the menu; a blur to nowhere does not', () => {
    render(<Harness />)
    fireEvent.click(button())
    // Safari does not focus a clicked button: the item blurs to nowhere, and the menu must stay for the click.
    fireEvent.focusOut(menuItems()[0]!, { relatedTarget: null })
    expect(screen.getByRole('menu')).toBeTruthy()
    // Moving between items stays inside.
    fireEvent.focusOut(menuItems()[0]!, { relatedTarget: menuItems()[1] })
    expect(screen.getByRole('menu')).toBeTruthy()
    act(() => { screen.getByRole('button', { name: 'Outside' }).focus() })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Outside' }))
  })

  it('more actions: draws nothing when there is nothing to offer', () => {
    render(<Harness items={[]} />)
    expect(screen.queryByRole('button', { name: /^More actions/ })).toBeNull()
  })

  it('more actions: takes the page’s id for its button, which also names the menu', () => {
    render(<MoreActions id="encounter-e1-more" items={ITEMS} onSelect={() => {}} />)
    expect(button().id).toBe('encounter-e1-more')
    fireEvent.click(button())
    expect(screen.getByRole('menu').getAttribute('aria-labelledby')).toBe('encounter-e1-more')
  })
})
