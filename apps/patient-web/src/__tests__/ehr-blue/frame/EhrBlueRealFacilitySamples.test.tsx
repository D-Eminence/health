import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { DEMO_HOSPITAL, REAL_FACILITY, REQUESTS, SESSION, facility, json, openStaffApp, serve, sessionAt, where, withFramePages } from './blueHarness'

/**
 * Facility settings and Reports & Analytics are samples: a fictional hospital's forms with "Save and continue", and
 * made-up figures, that send nothing. They are the demo facilities' alone (parity report 3.2): at a real facility their
 * address gives the frame's demo-only refusal, even to the administrator the design's roles would let in, and shows
 * nothing fictional. Every account and facility here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
beforeEach(() => {
  withFramePages()
  // The blue EHR at every facility: the clinic switch on, and both page sets present (as pageSets.ts lists them).
  vi.doMock('../../../ehr-blue/pageSets', () => ({
    PAGE_FILES: ['./clinical/pages.ts', './departments/pages.ts', './frame/pages.ts', './home/pages.ts'],
  }))
  vi.doMock('../../../ehr-blue/clinicSwitch', () => ({ BLUE_FOR_ALL: true }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.resetModules() })

const RIVERSIDE = 'Riverside Teaching Hospital (fictional)'
const many = <T,>(answer: T, count = 8): T[] => Array.from({ length: count }, () => answer)

/** The sample pages and something each draws only when it opens. */
const SAMPLES = [
  ['/provider/setup', 'Facility settings'],
  ['/provider/reports', 'Reports & Analytics'],
] as const

async function openAs(id: string, name: string, path: string) {
  // The facility's administrator: the design's Hospital Admin, whom its roles let into both samples.
  const current = facility(id, name, ['workforce.manage'], ['org_admin'])
  const sent = serve({ [SESSION]: [sessionAt(current, [current])], [REQUESTS]: many(() => json([])) })
  await openStaffApp(path)
  await screen.findByRole('navigation', { name: 'Main navigation' })
  return sent
}

describe('at a real facility', () => {
  it.each(SAMPLES)('refuses %s with the demo-only words, and shows nothing fictional', async (path, label) => {
    const sent = await openAs(REAL_FACILITY, RIVERSIDE, path)
    expect(await screen.findByText(`${label} is part of the Health ID demo only`)).toBeDefined()
    expect(screen.getByText(`It is not available at ${RIVERSIDE}.`)).toBeDefined()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(label)
    // The address stays: the refusal stands in for the page, not a move Home.
    expect(where()).toBe(path)
    for (const sample of [/Fictional/, /Sample only/, /Save and continue/, /Created from/, /Scope: current hospital/]) {
      expect(screen.queryByText(sample)).toBeNull()
    }
    expect(screen.queryByRole('button', { name: 'Save and continue' })).toBeNull()
    expect(within(screen.getByRole('navigation', { name: 'Main navigation' })).queryByRole('link', { name: label })).toBeNull()
    expect(sent.every(request => request.route.startsWith('GET '))).toBe(true)
  })
})

describe('at a demo facility', () => {
  it('keeps Facility settings, the fictional hospital\'s forms under the sample notice', async () => {
    await openAs(DEMO_HOSPITAL, 'Demo Hospital', '/provider/setup')
    expect(await screen.findByRole('heading', { level: 1, name: 'Facility settings' })).toBeDefined()
    expect(screen.getByText('Sample only: not connected to Health ID yet. Nothing you do here is saved.')).toBeDefined()
    expect(screen.queryByText(/is part of the Health ID demo only/)).toBeNull()
  })

  it('keeps Reports & Analytics, its figures under the sample notice', async () => {
    await openAs(DEMO_HOSPITAL, 'Demo Hospital', '/provider/reports')
    expect(await screen.findByRole('heading', { level: 1, name: 'Reports & Analytics' })).toBeDefined()
    expect(screen.getByLabelText('Created from')).toBeDefined()
    expect(screen.queryByText(/is part of the Health ID demo only/)).toBeNull()
  })
})
