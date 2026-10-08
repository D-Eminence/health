import { describe, expect, it } from 'vitest'
import type { AdminActor } from '../api'
import { NAVIGATION_ITEMS, UNAVAILABLE_CAPABILITIES, navigationItemFor, visibleNavigation } from '../navigation'

const actor = (permissions: string[]): AdminActor => ({ accountId: 'admin-1', subject: 'staff:1', displayName: 'Ada',
  email: 'ada@example.test', platformRoles: [], platformPermissions: permissions })

/** hid-system role_permissions for the two narrow platform roles. */
const SUPPORT_ADMIN = ['platform.admin.access', 'platform.principal.read', 'platform.session.revoke']
const SECURITY_AUDITOR = ['platform.admin.access', 'platform.audit.read', 'platform.integration.read', 'platform.operations.read']

const titles = (permissions: string[]) => visibleNavigation(actor(permissions)).flatMap(section => section.items.map(item => item.title))

describe('admin navigation', () => {
  it('has one entry per area and no duplicate paths', () => {
    const paths = NAVIGATION_ITEMS.map(item => item.path)
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths.every(path => path.startsWith('/admin/'))).toBe(true)
  })

  it('shows a support administrator only account lookup and their own security', () => {
    expect(titles(SUPPORT_ADMIN)).toEqual(['Overview', 'Users & roles', 'My security'])
  })

  it('shows a security auditor audit, approvals and read-only operations', () => {
    expect(titles(SECURITY_AUDITOR)).toEqual(['Overview', 'Approvals', 'Audit', 'My security', 'Service health', 'Integrations'])
  })

  it('drops sections with nothing visible', () => {
    const sections = visibleNavigation(actor(SUPPORT_ADMIN)).map(section => section.title)
    expect(sections).toEqual(['Platform', 'People and access', 'Security'])
  })

  it('guards sub-pages with their area, not with a looser rule', () => {
    expect(navigationItemFor('/admin/facilities/0f8c6d2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f')?.title).toBe('Facilities')
    expect(navigationItemFor('/admin/facilities-export')).toBeUndefined()
    expect(navigationItemFor('/admin/unknown')).toBeUndefined()
  })

  it('lists capabilities without backend support without linking to them', () => {
    expect(UNAVAILABLE_CAPABILITIES.map(item => item.title)).toContain('Support cases')
    expect(UNAVAILABLE_CAPABILITIES.every(item => !('path' in item))).toBe(true)
  })
})
