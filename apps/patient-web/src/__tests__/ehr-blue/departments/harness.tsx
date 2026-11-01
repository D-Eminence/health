import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Shared helpers for the blue department pages' tests. All data is fictional:
 * "Patient One", HID-ZDEMAAA2, "Demo Laboratory".
 *
 * Each test file mocks the staff session and API itself (vi.mock is hoisted per
 * file), as the existing provider tests do:
 *
 *   const session = vi.hoisted(() => ({ permissions: [] as string[] }))
 *   vi.mock('../../../staff/App', () => ({ useStaff: () => staffContext(session.permissions) }))
 *   const api = vi.hoisted(() => ({ labWorkItems: vi.fn() }))
 *   vi.mock('../../../staff/api', () => ({ staffApi: api }))
 *
 * `staffContext` is imported inside the factory with `await import('./harness')`
 * when a factory needs it, or written out inline.
 */

export const DEMO_LABORATORY_ID = '98d00002-0000-4000-8000-000000000002'
export const DEMO_PHARMACY_ID = '98d00002-0000-4000-8000-000000000003'
export const DEMO_HOSPITAL_ID = '98d00002-0000-4000-8000-000000000001'

export interface FakeFacility {
  id: string
  membershipId: string
  organizationId: string
  name: string
  roles: string[]
  permissions: string[]
  isPrimary: boolean
  code?: string
  selfService?: { review: string; organizationType: string }
}

/** A fictional facility membership holding `permissions`. */
export function fakeFacility(permissions: string[], overrides: Partial<FakeFacility> = {}): FakeFacility {
  return {
    id: DEMO_LABORATORY_ID,
    membershipId: 'membership-demo-1',
    organizationId: 'organization-demo-1',
    name: 'Demo Laboratory',
    roles: ['lab_scientist'],
    permissions,
    isPrimary: true,
    ...overrides,
  }
}

/** What useStaff() answers for a signed-in member working at `facility`. */
export function staffContext(facility: FakeFacility | undefined) {
  return {
    state: {
      status: 'ready' as const,
      session: {
        actor: {
          kind: 'staff' as const,
          id: 'staff-demo-1',
          email: 'demo.scientist@example.test',
          displayName: 'Demo Scientist',
          roles: facility?.roles ?? [],
          permissions: facility?.permissions ?? [],
          facilities: facility ? [facility] : [],
          facility,
        },
      },
    },
    lock: null,
    activePatient: null,
    setActivePatient: () => true,
    refresh: async () => {},
    checkSession: () => {},
  }
}

/** Renders a page as the frame would: inside the .hid-ehr root, under a router. */
export function renderDept(ui: ReactElement, { route = '/ehr' }: { route?: string } = {}) {
  return render(<MemoryRouter initialEntries={[route]}><div className="hid-ehr">{ui}</div></MemoryRouter>)
}

/**
 * The point-of-care API (ehr-blue/departments/commerce/api) for a test file's vi.mock: every call answers "not switched
 * on yet" (404) unless the test puts its own function in `overrides` (cleared by the test).
 *
 *   const commerceApi = vi.hoisted(() => ({} as Record<string, (...args: never[]) => unknown>))
 *   vi.mock('../../../../ehr-blue/departments/commerce/api', async importOriginal => {
 *     const { commerceMock } = await import('../harness')
 *     return { ...(await importOriginal<object>()), commerce: commerceMock(commerceApi) }
 *   })
 */
export function commerceMock(overrides: Record<string, (...args: never[]) => unknown>) {
  return new Proxy(overrides, {
    get(target, key) {
      if (typeof key !== 'string') return undefined
      return target[key] ?? (async () => ({ ok: false, notAvailable: true }))
    },
  })
}
