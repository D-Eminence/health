import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ChooseWorkspacePage } from '../../../ehr-blue/frame/ChooseWorkspace'

/*
 * Switch facility's "Start an outreach group" (owner decision 5 of 11 November 2026). Each product site keeps only the
 * facilities that fit it (owner's answer to Q88, 17 Nov 2026), so a group started on ehr. could never be listed there:
 * from every other product site the link goes to Health ID Outreach, where the group can be opened. Fictional data only.
 */
vi.mock('../../../staff/App', async () => {
  const { fakeFacility, staffContext } = await import('../departments/harness')
  return { useStaff: () => ({ ...staffContext(fakeFacility(['ehr.encounter.write'], { name: 'Demo Hospital', roles: ['doctor'] })),
    selectFacility: vi.fn(), signOut: vi.fn(), activePatient: null, lock: null }) }
})

afterEach(() => { vi.unstubAllGlobals() })

function open(hostname: string) {
  vi.stubGlobal('location', { ...window.location, hostname })
  return render(<MemoryRouter initialEntries={['/provider/institutions']}><ChooseWorkspacePage /></MemoryRouter>)
}

describe('Switch facility: Start an outreach group', () => {
  it.each([
    ['ehr.healthidentitydirectory.com', 'https://outreach.healthidentitydirectory.com/provider/start-outreach-group'],
    ['migrate.staging.healthidentitydirectory.com', 'https://outreach.staging.healthidentitydirectory.com/provider/start-outreach-group'],
  ])('on %s goes to Health ID Outreach', async (hostname, href) => {
    open(hostname)
    const link = await screen.findByRole('link', { name: 'Start one on Health ID Outreach' })
    expect(link.getAttribute('href')).toBe(href)
    expect(screen.queryByRole('link', { name: 'Start an outreach group' })).toBeNull()
  })

  it.each(['outreach.healthidentitydirectory.com', 'localhost'])('on %s opens the page on this site', async (hostname) => {
    open(hostname)
    const link = await screen.findByRole('link', { name: 'Start an outreach group' })
    expect(link.getAttribute('href')).toBe('/provider/start-outreach-group')
  })
})
