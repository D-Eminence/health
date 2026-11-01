import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { Link, Route, Routes, useParams } from 'react-router-dom'
import type { EhrBluePage } from '../../../ehr-blue/frame/types'
import { DEMO_HOSPITAL, REQUESTS, SESSION, facility, json, openStaffApp, serve, sessionAt, withFramePages } from './blueHarness'

/**
 * A page's own routes: the frame gives each page a route of its own address with a trailing "*", so a page's <Routes>
 * resolve from its address (index is the page, "new" is <page>/new) and react-router has nothing to warn about. A
 * live stand-in still shows today's page. Every account and record here is fictional.
 */
vi.mock('../../../staff/env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test', turnstileSiteKey: null }) }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules() })

function Record() {
  const { recordId = '' } = useParams()
  return <p>Fictional record {recordId}</p>
}

/** The routes a page declares, relative to its own address. */
function Workspace() {
  return (
    <Routes>
      <Route index element={<><p>Fictional list</p><Link to="new">Create record</Link></>} />
      <Route path="new" element={<p>Fictional new record</p>} />
      <Route path=":recordId" element={<Record />} />
    </Routes>
  )
}

/** The wrapper today's clinical pages carry (their own address, then anything), kept working. */
function Wrapped() {
  return <Routes><Route path="wrapped/*" element={<Workspace />} /><Route path="*" element={<Workspace />} /></Routes>
}

const PAGES: EhrBluePage[] = [
  { path: 'probe/*', group: 'Insight', label: 'Probe', status: 'sample', element: <Workspace /> },
  { path: 'wrapped/*', group: 'Insight', label: 'Wrapped', status: 'sample', element: <Wrapped /> },
]

async function open(path: string) {
  withFramePages(() => PAGES)
  const demo = facility(DEMO_HOSPITAL, 'Demo Hospital', ['identity.consent.write'])
  serve({ [SESSION]: [sessionAt(demo, [demo])], [REQUESTS]: [() => json([]), () => json([])] })
  await openStaffApp(path)
}

const descendantWarnings = (calls: readonly (readonly unknown[])[]) =>
  calls.filter(call => String(call[0]).includes('descendant <Routes>'))

describe('a page\'s own routes', () => {
  // First in the file: react-router warns once per parent address, for the whole run.
  it('resolve from the page\'s address, with no react-router warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await open('/provider/probe')
    expect(await screen.findByText('Fictional list')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Create record' }).getAttribute('href')).toBe('/provider/probe/new')
    expect(descendantWarnings(warn.mock.calls)).toEqual([])
  })

  it.each([
    ['/provider/probe/new', 'Fictional new record'],
    ['/provider/probe/5a020001', 'Fictional record 5a020001'],
    ['/provider/wrapped', 'Fictional list'],
    ['/provider/wrapped/new', 'Fictional new record'],
    ['/provider/wrapped/5a020001', 'Fictional record 5a020001'],
  ])('open %s', async (path, text) => {
    await open(path)
    expect(await screen.findByText(text)).toBeDefined()
  })

  it('leave a live stand-in showing today\'s page for its address', async () => {
    await open('/provider/requests')
    expect(await screen.findByRole('navigation', { name: 'Main navigation' })).toBeDefined()
    expect(await screen.findByRole('heading', { level: 1, name: 'Access requests.' })).toBeDefined()
    expect(document.querySelector('.hid-ehr-blue-live h1')?.textContent).toBe('Access requests.')
  })
})
