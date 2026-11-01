import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { PatientApi } from '../api'
import { createTestSessionValue, SessionContext } from '../session'
import { PortalShell } from '../routes/Portal'

// Record chat is a staging feature; these tests run without a configured environment.
vi.mock('../chatFeatures', () => ({ patientChatEnabled: () => false, patientChatHost: () => false }))

/**
 * Below 900px the patient pages' navigation was a horizontal strip, and a focused link partly showing was scrolled into
 * the strip (only the strip, only for keyboard focus). The Kasuwa redesign removed the strip on purpose: phones have a
 * fixed tab bar ("Quick") whose places share the screen's width and never scroll, and the rest is the Menu page (#menu);
 * computers have the sidebar ("Main navigation"), which scrolls only up and down. What the strip's fix protected still
 * holds: focusing a navigation link, by keyboard or pointer, never scrolls the page (that lost clicks near the top of
 * the screen and jumped the page when the tab was focused again) and never moves the navigation under a press.
 */
const pageScroll = vi.fn()
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: pageScroll })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
})
afterEach(() => {
  pageScroll.mockClear()
  vi.restoreAllMocks()
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
})

// The shell's bell (notificationBadge.tsx) listens for answered requests; its count is never served here, and nor is the
// profile the header's avatar reads (hid-1.0 parity B3).
const noBell = { onSessionAccepted: () => () => undefined, profile: () => new Promise(() => undefined) } as Partial<PatientApi> as PatientApi

function openPortal() {
  render(<SessionContext.Provider value={createTestSessionValue({ kind: 'patient', subjectId: 'subject-a', appRole: 'patient', assuranceLevel: 'aal1' }, noBell)}>
    <MemoryRouter initialEntries={['/notifications']}><Routes><Route path="/" element={<PortalShell />}><Route path="notifications" element={<p>Notifications page</p>} /></Route></Routes></MemoryRouter>
  </SessionContext.Provider>)
  const sidebar = screen.getByRole('navigation', { name: 'Main navigation' })
  return { sidebar, quick: screen.getByRole('navigation', { name: 'Quick' }), link: within(sidebar).getByRole('link', { name: 'Profile' }) }
}

/** Lays out the sidebar as a narrow window might: taller than shown, with a link at `linkTop` against its 0 to 500px. */
function layOut(sidebar: HTMLElement, link: HTMLElement, linkTop: number, keyboard: boolean) {
  link.matches = (selector: string) => selector === ':focus-visible' ? keyboard : Element.prototype.matches.call(link, selector)
  let top = 120, left = 0
  Object.defineProperty(sidebar, 'scrollTop', { configurable: true, get: () => top, set: (value: number) => { top = value } })
  Object.defineProperty(sidebar, 'scrollLeft', { configurable: true, get: () => left, set: (value: number) => { left = value } })
  Object.defineProperty(sidebar, 'scrollWidth', { configurable: true, value: 264 })
  Object.defineProperty(sidebar, 'clientWidth', { configurable: true, value: 240 })
  sidebar.getBoundingClientRect = () => ({ left: 0, right: 240, top: 0, bottom: 500, width: 240, height: 500, x: 0, y: 0, toJSON: () => ({}) })
  link.getBoundingClientRect = () => ({ left: -12, right: 228, top: linkTop, bottom: linkTop + 44, width: 240, height: 44, x: -12, y: linkTop, toJSON: () => ({}) })
  return { scroll: () => [top, left] }
}

describe('patient navigation and focus (the narrow-screen strip is gone)', () => {
  it('gives phones a tab bar whose places share the width and never scroll sideways', () => {
    const { quick } = openPortal()
    const grid = quick.firstElementChild as HTMLElement
    expect(grid.style.gridTemplateColumns).toMatch(/^repeat\(\d, minmax\(0, 1fr\)\)$/)
    expect(quick.className).not.toMatch(/overflow-x/)
    expect(grid.className).not.toMatch(/overflow-x/)
    // Every place is reachable there or from the Menu page.
    expect(within(quick).getByRole('link', { name: 'Records' })).toBeTruthy()
    expect(within(quick).getByRole('button', { name: 'Menu' })).toBeTruthy()
  })

  it.each([
    ['keyboard focus, clipped at the edge', { top: -20, keyboard: true }],
    ['keyboard focus, already in view', { top: 120, keyboard: true }],
    ['a pointer press, which would move it out from under the press', { top: 480, keyboard: false }],
  ])('moves neither the navigation nor the page for %s', (_label, { top, keyboard }) => {
    const { sidebar, link } = openPortal()
    const laid = layOut(sidebar, link, top, keyboard)
    act(() => link.focus())
    act(() => { link.blur(); link.focus() })
    expect(document.activeElement).toBe(link)
    expect(laid.scroll()).toEqual([120, 0])
    expect(pageScroll).not.toHaveBeenCalled()
    expect(window.scrollTo).not.toHaveBeenCalled()
    expect(window.scrollBy).not.toHaveBeenCalled()
  })
})
