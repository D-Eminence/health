import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { PatientApi } from '../api'
import { createTestSessionValue, SessionContext } from '../session'
import { PortalShell } from '../routes/Portal'

// Record chat is a staging feature; these tests run without a configured environment.
vi.mock('../chatFeatures', () => ({ patientChatEnabled: () => false, patientChatHost: () => false }))

/**
 * Below 900px the patient pages' navigation is a horizontal strip. Chromium
 * does not scroll a focused link that is partly showing, so tabbing backwards
 * left one as a sliver at the strip's edge (22 of 66px, measured at 390px).
 * Only the strip moves, and only for keyboard focus: scrolling the page from a
 * focus event lost clicks near the top of the screen and jumped the page when
 * the tab was focused again, and moving the strip under a pressed link lost
 * the click.
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
  const strip = screen.getByRole('navigation', { name: 'Patient pages' })
  return { strip, link: screen.getByRole('link', { name: 'Profile' }) }
}

/** Lays out the strip as Chromium did at 390px: 390px shown of 541px, scrolled to the end. */
function layOut(strip: HTMLElement, link: HTMLElement, linkLeft: number, { overflowing = true, keyboard = true } = {}) {
  // jsdom never matches :focus-visible; Chromium does for keyboard focus and not for a pointer press.
  link.matches = (selector: string) => selector === ':focus-visible' ? keyboard : Element.prototype.matches.call(link, selector)
  let left = 151
  Object.defineProperty(strip, 'scrollLeft', { configurable: true, get: () => left, set: (value: number) => { left = value } })
  Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: overflowing ? 541 : 390 })
  Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 390 })
  strip.getBoundingClientRect = () => ({ left: 0, right: 390, top: 67, bottom: 124, width: 390, height: 57, x: 0, y: 67, toJSON: () => ({}) })
  link.getBoundingClientRect = () => ({ left: linkLeft, right: linkLeft + 66, top: 75, bottom: 115, width: 66, height: 40, x: linkLeft, y: 75, toJSON: () => ({}) })
  return { scrollLeft: () => left }
}

describe('a patient navigation link that gets keyboard focus in the narrow-screen strip', () => {
  it('scrolls the strip, and only the strip, until the link clipped at its left edge shows', () => {
    const { strip, link } = openPortal()
    const laid = layOut(strip, link, -44)
    act(() => link.focus())
    expect(laid.scrollLeft()).toBe(151 - 44)
    expect(pageScroll).not.toHaveBeenCalled()
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it('scrolls the strip the other way for a link clipped at its right edge', () => {
    const { strip, link } = openPortal()
    const laid = layOut(strip, link, 350)
    act(() => link.focus())
    expect(laid.scrollLeft()).toBe(151 + 26)
  })

  it.each([
    ['already in view', { left: 120, overflowing: true, keyboard: true }],
    ['in a sidebar that does not scroll (wide screens)', { left: -44, overflowing: false, keyboard: true }],
    ['pressed with a pointer, which would move it out from under the press', { left: 350, overflowing: true, keyboard: false }],
  ])('leaves the strip and the page alone when the link is %s', (_label, { left, overflowing, keyboard }) => {
    const { strip, link } = openPortal()
    const laid = layOut(strip, link, left, { overflowing, keyboard })
    act(() => link.focus())
    act(() => { link.blur(); link.focus() })
    expect(laid.scrollLeft()).toBe(151)
    expect(pageScroll).not.toHaveBeenCalled()
    expect(window.scrollTo).not.toHaveBeenCalled()
  })
})
