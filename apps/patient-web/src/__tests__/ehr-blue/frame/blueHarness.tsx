import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { vi } from 'vitest'
import type * as BlueRoutes from '../../../ehr-blue/routes'
import type { EhrBluePage } from '../../../ehr-blue/frame/types'

/**
 * Renders the staff app as the portal does, against a fetch that answers only the routes a test names (anything else
 * is a 418 the test would see). Every account, facility and patient here is fictional.
 */
export type Answer = () => Response | Promise<Response>
export interface Sent { route: string; body: unknown; headers: Headers }

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
export const problem = (status: number, code: string, detail: string) =>
  new Response(JSON.stringify({ type: 'about:blank', title: code, status, code, detail }), { status, headers: { 'Content-Type': 'application/problem+json' } })

export const DEMO_HOSPITAL = '98d00002-0000-4000-8000-000000000001'
export const DEMO_LABORATORY = '98d00002-0000-4000-8000-000000000002'
export const REAL_FACILITY = 'f0000000-0000-4000-8000-000000000001'

export const SESSION = 'GET /api/v1/auth/session'
/** The frame's check for a changed facility agreement (proposed; FacilityAgreementCheck.tsx), for an administrator. */
export const AGREEMENT_CHECK = 'GET /api/v1/identity/facility-agreements/current'
export const REQUESTS = 'GET /api/v1/identity/access-requests'
export const LAB_WORK = 'GET /api/v1/lab/work-items'
export const PHARMACY_WORK = 'GET /api/v1/pharmacy/work-items'
export const FACILITY = 'POST /api/v1/auth/facility'

export function facility(id: string, name: string, permissions: readonly string[], roles: readonly string[] = ['clinician']) {
  return { id, membershipId: `member-${id}`, organizationId: 'org-demo', name, roles: [...roles], permissions: [...permissions], isPrimary: true }
}

export function sessionAt(current: ReturnType<typeof facility> | undefined, facilities: ReturnType<typeof facility>[], selection?: string) {
  return () => json({
    actor: { id: 'staff-demo-1', email: 'demo.clinician@example.test', displayName: 'Demo Clinician', roles: ['clinician'], permissions: [],
      facilities, ...(current ? { facility: current } : {}) },
    expiresAt: '2026-11-30T12:00:00.000Z',
    ...(selection ? { facilitySelection: selection } : {}),
  })
}

/** The routes the page itself asked for: every one but the frame's agreement check, which runs beside every page. */
export const pageRoutes = (sent: readonly Sent[]) => sent.map(request => request.route).filter(route => route !== AGREEMENT_CHECK)

export function serve(routes: Record<string, Answer[]>) {
  const sent: Sent[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
    sent.push({ route, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined, headers: new Headers(init?.headers) })
    const next = routes[route]?.shift()
    return next ? next() : json({ code: 'UNEXPECTED_REQUEST', detail: route }, 418)
  }))
  return sent
}

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>
}

export const where = () => screen.getByTestId('where').textContent

/** Opens the staff app at `path`, or at an address with the history entry's state (as a page's navigate leaves it). */
export async function openStaffApp(path: string | { pathname: string; state: unknown }) {
  const { App } = await import('../../../staff/App')
  return render(<MemoryRouter initialEntries={[path]}><Where /><Routes><Route path="/provider/*" element={<App />} /></Routes></MemoryRouter>)
}

/**
 * Runs the blue EHR on the frame's own registry (frame/pages.ts and home/pages.ts), with `extra` pages added, for the
 * next app a test opens. A frame test of a stand-in (a sample workspace, its tabs) then keeps testing it after another
 * folder's page takes its place. Registered per test: a vi.mock factory's module outlives vi.resetModules.
 */
export function withFramePages(extra: () => readonly EhrBluePage[] = () => []) {
  vi.doMock('../../../ehr-blue/routes', async importOriginal => {
    const actual = await importOriginal<typeof BlueRoutes>()
    const frame = await import('../../../ehr-blue/frame/pages')
    const home = await import('../../../ehr-blue/home/pages')
    return { ...actual, BLUE_PAGES: actual.collectPages({ './frame/pages.ts': frame, './home/pages.ts': home, './extra/pages.ts': { pages: extra() } }) }
  })
}


/** Home's heading: the time of day's greeting and the person's name (kasuwa greeting()). */
export const homeHeading = (name = 'Demo Clinician') => new RegExp(`^Good (morning|afternoon|evening), ${name}$`)

/** The account menu is the sidebar's: the person's ⋯ button, which holds Sign out. */
export const accountButton = (name = 'Demo Clinician') => screen.getByRole('button', { name: `${name}: account` })

/** Switching facility is the sidebar's switcher: it lists the person's facilities, and one leads to Switch facility. */
export function switchFacilityTo(current: string, next: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${current.replace(/[()]/g, '\\$&')}`) }))
  fireEvent.click(screen.getByRole('button', { name: next }))
}
