import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { vi } from 'vitest'

/**
 * Renders the staff app as the portal does, against a fetch that answers only the routes a test names (anything else
 * is a 418 the test would see). Every account, facility and patient here is fictional.
 */
export type Answer = () => Response | Promise<Response>
export interface Sent { route: string; body: unknown }

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
export const problem = (status: number, code: string, detail: string) =>
  new Response(JSON.stringify({ type: 'about:blank', title: code, status, code, detail }), { status, headers: { 'Content-Type': 'application/problem+json' } })

export const DEMO_HOSPITAL = '98d00002-0000-4000-8000-000000000001'
export const DEMO_LABORATORY = '98d00002-0000-4000-8000-000000000002'
export const REAL_FACILITY = 'f0000000-0000-4000-8000-000000000001'

export const SESSION = 'GET /api/v1/auth/session'
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

export function serve(routes: Record<string, Answer[]>) {
  const sent: Sent[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const route = `${String(init?.method ?? 'GET')} ${new URL(String(url)).pathname}`
    sent.push({ route, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
    const next = routes[route]?.shift()
    return next ? next() : json({ code: 'UNEXPECTED_REQUEST', detail: route }, 418)
  }))
  return sent
}

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>
}

export const where = () => screen.getByTestId('where').textContent

export async function openStaffApp(path: string) {
  const { App } = await import('../../../staff/App')
  return render(<MemoryRouter initialEntries={[path]}><Where /><Routes><Route path="/provider/*" element={<App />} /></Routes></MemoryRouter>)
}
