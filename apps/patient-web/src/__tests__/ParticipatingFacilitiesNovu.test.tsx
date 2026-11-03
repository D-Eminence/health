import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { ParticipatingFacilitiesPage } from '../routes/ParticipatingFacilities'
import { problem, renderPortal } from './portalHarness'

vi.mock('../backendContract', () => ({ usesNovuBackend: () => true }))

const anonymous = { state: { status: 'anonymous', principal: null } } as const

function Where() { return <p data-testid="path">{useLocation().pathname}</p> }

/**
 * Production's Identity (Novu) has no list of participating facilities, so /enroll/facilities could only ever say it
 * couldn't load, with a Try again that never works. An old link to it opens registration instead, which is what the
 * person came for, and nothing is read for the list.
 */
describe('/enroll/facilities on production’s backend', () => {
  it('opens registration, reads nothing and offers no Try again', async () => {
    const { sent } = renderPortal(<Routes>
      <Route path="/enroll/facilities" element={<ParticipatingFacilitiesPage />} />
      <Route path="/enroll" element={<Where />} />
    </Routes>, path => problem(404, 'NOT_FOUND', `Cannot GET ${path}`), anonymous, { at: '/enroll/facilities' })
    expect((await screen.findByTestId('path')).textContent).toBe('/enroll')
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.queryByText(/could not load the list/)).toBeNull()
    expect(sent).toEqual([])
  })
})
