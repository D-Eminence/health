import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PageGuideButton } from '../../../ehr-blue/frame/PageGuide'
import { PAGE_GUIDES } from '../../../ehr-blue/frame/pageGuides'
import { Drawer } from '../../../kasuwa/interactive'

/**
 * The Guide's shortcut, Alt, Shift and / together: a "?" typed alone never opens it (WCAG 2.1.4, character key
 * shortcuts). Not in a field, a list or editable text, not with Ctrl or Cmd as well, and not while another dialog or
 * drawer is open over the page.
 */
function Page({ other = false }: { other?: boolean }) {
  const [drawer, setDrawer] = useState(other)
  return <>
    <label htmlFor="note">Note</label><input id="note" />
    <label htmlFor="story">Story</label><textarea id="story" />
    <label htmlFor="unit">Unit</label><select id="unit"><option>mg</option></select>
    <div data-testid="editable" contentEditable suppressContentEditableWarning tabIndex={0}>Text</div>
    <button type="button">Somewhere on the page</button>
    <PageGuideButton guide={PAGE_GUIDES.patients ?? null} label="Patients" onAllGuides={() => {}} />
    <Drawer open={drawer} onClose={() => setDrawer(false)} title="Ask for access"><p>The form</p></Drawer>
  </>
}

const guide = () => screen.queryByRole('dialog', { name: 'Guide: Patients' })
/** Alt, Shift and / together, as a Windows or Linux keyboard gives them ("?"); a test can change any part. */
const press = (target: Element, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(target, { key: '?', code: 'Slash', altKey: true, shiftKey: true, ...init })

describe('the Guide’s shortcut, Alt, Shift and /', () => {
  it('opens the guide from the page', () => {
    render(<Page />)
    const button = screen.getByRole('button', { name: 'Somewhere on the page' })
    button.focus()
    press(button)
    expect(guide()).toBeTruthy()
    expect(guide()!.textContent).toContain('Press Alt, Shift and / together on any page to open its guide (not while you’re typing in a box).')
  })

  it('opens the guide on a Mac, where Option and Shift with / give another character', () => {
    render(<Page />)
    press(document.body, { key: '¿' })
    expect(guide()).toBeTruthy()
  })

  it('a ? typed alone does nothing, with or without the Shift it is typed with', () => {
    render(<Page />)
    const button = screen.getByRole('button', { name: 'Somewhere on the page' })
    button.focus()
    press(button, { altKey: false })
    press(button, { altKey: false, shiftKey: false })
    press(document.body, { altKey: false })
    expect(guide()).toBeNull()
  })

  it('does nothing with Alt and / but no Shift', () => {
    render(<Page />)
    press(document.body, { key: '/', shiftKey: false })
    expect(guide()).toBeNull()
  })

  it.each(['Note', 'Story', 'Unit'])('is typed, not a shortcut, in %s', label => {
    render(<Page />)
    const field = screen.getByLabelText(label)
    field.focus()
    press(field)
    expect(guide()).toBeNull()
  })

  it('is typed, not a shortcut, in editable text', () => {
    render(<Page />)
    const editable = screen.getByTestId('editable')
    editable.focus()
    press(editable)
    expect(guide()).toBeNull()
  })

  it.each([['Ctrl', { ctrlKey: true }], ['Cmd', { metaKey: true }]] as const)('does nothing with %s held as well', (_, held) => {
    render(<Page />)
    press(document.body, held)
    expect(guide()).toBeNull()
  })

  it('does nothing while another drawer is open over the page', () => {
    render(<Page other />)
    expect(screen.getByRole('dialog', { name: 'Ask for access' })).toBeTruthy()
    press(document.body)
    expect(guide()).toBeNull()
    // Closed, the shortcut opens the guide again.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Ask for access' })).toBeNull()
    press(document.body)
    expect(guide()).toBeTruthy()
  })

  it('does nothing while a dialog from elsewhere in the app is open', () => {
    render(<><Page /><div role="dialog" aria-modal="true" aria-label="Sign out?"><button type="button">Stay</button></div></>)
    press(screen.getByRole('button', { name: 'Stay' }))
    expect(guide()).toBeNull()
  })
})
