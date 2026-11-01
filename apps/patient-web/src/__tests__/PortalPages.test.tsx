import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type * as SessionModule from '../session'
import { App } from '../App'
import { json, patientApi, press, profile } from './portalHarness'

// Record chat is a staging feature; these tests run without a configured environment.
vi.mock('../chatFeatures', () => ({ patientChatEnabled: () => false, patientChatHost: () => false }))
vi.mock('../PatientSupport', () => ({ PatientSupport: () => null }))

/**
 * The portal's pages, as App routes them for a signed-in patient. Each page
 * names the browser tab (PR-06), and a link inside a page that opens another
 * (the overview's cards, 'View profile', 'Go to overview') takes focus to the new
 * page's heading instead of leaving it on the document
 * (NEW-PATIENT-LINK-PAGE-FOCUS). A navigation link stays on screen and keeps it.
 */
const session = vi.hoisted(() => ({ value: null as ReturnType<typeof SessionModule.createTestSessionValue> | null }))
vi.mock('../session', async () => {
  const actual = await vi.importActual<typeof SessionModule>('../session')
  return { ...actual, SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>, useSession: () => session.value }
})

const TAB_TITLE = 'Health ID: Patient'
beforeEach(async () => {
  document.title = TAB_TITLE
  const { createTestSessionValue } = await vi.importActual<typeof SessionModule>('../session')
  const { api } = patientApi((path, method) => {
    if (method !== 'GET') return json({}, 404)
    switch (path) {
      case '/identity/me': return json(profile)
      case '/ehr/me/records': return json({ encounters: [], notes: [], vitals: [], diagnoses: [], prescriptions: [], labRequests: [], documents: [], limit: 100 })
      case '/identity/me/access-history': return json({ items: [] })
      case '/identity/me/account-deletion': return json({ waitingPeriodSeconds: 1_209_600, confirmationTtlSeconds: 600, request: null })
      default: return json([])
    }
  })
  session.value = createTestSessionValue({ kind: 'patient', subjectId: 'patient:subject', appRole: 'patient', assuranceLevel: 'aal1' }, api)
})
afterEach(() => { session.value = null })

const open = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
const nav = () => within(screen.getByRole('navigation', { name: 'Main navigation' }))
const pageHeading = () => screen.getByRole('heading', { level: 1 })

describe('patient portal pages', () => {
  it('names the tab after each page, and gives the title back on leaving', async () => {
    const { unmount } = open('/records')
    await screen.findByRole('heading', { level: 1, name: 'Records' })
    expect(document.title).toBe('Health records · Health ID')
    for (const [link, title] of [['Access & sharing', 'Access and consent · Health ID'],
      ['Profile', 'Your profile · Health ID'], ['Overview', 'Overview · Health ID']] as const) {
      fireEvent.click(nav().getByRole('link', { name: link }))
      await waitFor(() => expect(document.title).toBe(title))
    }
    // Notifications has no place in the navigation (the bell shows while something is unread): Home's Activity opens it.
    fireEvent.click(within(await screen.findByRole('region', { name: 'Activity' })).getByRole('link', { name: 'All' }))
    await waitFor(() => expect(document.title).toBe('Notifications · Health ID'))
    unmount()
    expect(document.title).toBe(TAB_TITLE)
  })

  it('names the tab of a page that does not exist', async () => {
    open('/no-such-page')
    await screen.findByRole('heading', { level: 1, name: 'Page not found' })
    expect(document.title).toBe('Page not found · Health ID')
  })

  it('moves focus to the new page\'s heading when a link inside the page opens it', async () => {
    open('/')
    await screen.findByText('HID-ABC234')
    await press(within(screen.getByRole('group', { name: 'Your record at a glance' })).getByRole('link', { name: /Records$/ }))
    await screen.findByRole('heading', { level: 1, name: 'Records' })
    expect(document.activeElement).toBe(pageHeading())

    await act(async () => { fireEvent.click(nav().getByRole('link', { name: 'Overview' })) })
    await press(await screen.findByRole('link', { name: 'View profile' }))
    await screen.findByRole('heading', { level: 1, name: 'Profile' })
    expect(document.activeElement).toBe(pageHeading())
  })

  it('moves focus to the overview\'s heading from a page that does not exist', async () => {
    open('/no-such-page')
    await press(await screen.findByRole('link', { name: 'Go to overview' }))
    // Home greets the patient by name.
    await screen.findByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening), Ada$/ })
    expect(document.activeElement).toBe(pageHeading())
  })

  it('leaves focus on a navigation link that opened a page', async () => {
    open('/')
    await screen.findByText('HID-ABC234')
    const records = nav().getByRole('link', { name: 'Records' })
    await press(records)
    await screen.findByRole('heading', { level: 1, name: 'Records' })
    expect(document.activeElement).toBe(records)
  })
})
