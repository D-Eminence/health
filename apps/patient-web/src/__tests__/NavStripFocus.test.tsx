import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { PatientApi } from '../api'
import { createTestSessionValue, SessionContext } from '../session'
import { PortalShell } from '../routes/Portal'

const reveal = vi.fn()
beforeEach(() => { Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: reveal }) })
afterEach(() => { reveal.mockClear(); Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView') })

/**
 * Below 900px the patient pages' navigation is a horizontal strip. Chromium
 * does not scroll a focused link that is partly showing, so tabbing backwards
 * left one as a sliver at the strip's edge (22 of 66px, measured at 390px).
 */
it('shows the whole of a patient navigation link that gets keyboard focus', () => {
  render(<SessionContext.Provider value={createTestSessionValue({ kind: 'patient', subjectId: 'subject-a', appRole: 'patient', assuranceLevel: 'aal1' }, {} as PatientApi)}>
    <MemoryRouter initialEntries={['/settings']}><Routes><Route path="/" element={<PortalShell />}><Route path="settings" element={<p>Settings page</p>} /></Route></Routes></MemoryRouter>
  </SessionContext.Provider>)

  const link = screen.getByRole('link', { name: 'Profile' })
  act(() => link.focus())

  expect(reveal).toHaveBeenCalledTimes(1)
  expect(reveal).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
  expect(reveal.mock.contexts[0]).toBe(link)
})
