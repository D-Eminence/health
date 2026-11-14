import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { DEMO_HOSPITAL, REQUESTS, SESSION, facility, json, openStaffApp, serve, sessionAt, where } from './blueHarness'

/**
 * Notifications' Recent activity with every folder's pages joined, as production builds them: the clinical and
 * department samples replace the frame's stand-ins for some workspaces and keep records of their own, so a row may
 * link to a record only where the frame's own sample page serves it, and opens the workspace's list elsewhere. A role
 * that may open none of the workspaces gets no Recent activity at all. Every account here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

const PERMISSIONS = ['identity.consent.write', 'identity.patient.read', 'ehr.encounter.read', 'ehr.note.read', 'ehr.vital.read']

async function openDemo(roles: readonly string[]) {
  const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', PERMISSIONS, roles)
  serve({ [SESSION]: [sessionAt(demo, [demo])], [REQUESTS]: Array.from({ length: 8 }, () => () => json([])) })
  await openStaffApp('/provider/whats-left')
  await screen.findByRole('navigation', { name: 'Main navigation' })
}

function openNotifications() {
  fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))
  return within(screen.getByRole('dialog', { name: 'Notifications' }))
}

describe('Recent activity, with every folder\'s pages', () => {
  for (const role of ['doctor', 'nurse', 'receptionist']) {
    it(`finds what each row opens, as a ${role}`, async () => {
      await openDemo([role])
      const labels = openNotifications().getAllByRole('button', { name: /^Open / })
        .map(button => button.getAttribute('aria-label')!).filter(label => label !== 'Open Review requests')
      expect(labels.length).toBeGreaterThan(0)
      for (const label of labels) {
        fireEvent.click(openNotifications().getByRole('button', { name: label }))
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull())
        await screen.findByRole('heading', { level: 1 })
        expect({ label, notFound: screen.queryByRole('heading', { name: 'Record not found' }) !== null, at: where() })
          .toEqual({ label, notFound: false, at: where() })
      }
    })
  }

  it('shows no Recent activity to a role that may open none of its workspaces', async () => {
    await openDemo(['lab'])
    const drawer = openNotifications()
    expect(drawer.queryByRole('heading', { name: /^Recent activity/ })).toBeNull()
    expect(drawer.queryByText(/record created$/)).toBeNull()
  })
})
