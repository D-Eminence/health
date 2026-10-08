import type { AdminActor } from './api'

/**
 * The single map of the platform admin surface. The sidebar, the mobile
 * navigation and the route guards all read it, so an area cannot be linked
 * without the same permission check that guards its route. Visibility is a
 * display hint: the backend authorizes every request.
 */
export interface NavigationItem {
  readonly path: string
  readonly title: string
  readonly description: string
  readonly visible: (actor: AdminActor) => boolean
}

export interface NavigationSection {
  readonly title: string
  readonly items: readonly NavigationItem[]
}

const can = (permission: string) => (actor: AdminActor) => actor.platformPermissions.includes(permission)

/** Approvals are listed for these permissions (hid-system PlatformSecurityService.listApprovals). */
export const APPROVAL_PERMISSIONS = ['platform.role.manage', 'platform.mfa.reset', 'platform.audit.read'] as const

export const NAVIGATION: readonly NavigationSection[] = [
  { title: 'Platform', items: [
    { path: '/admin/overview', title: 'Overview', visible: can('platform.admin.access'),
      description: 'Platform totals and the work waiting for administrators.' },
  ] },
  { title: 'Organizations', items: [
    { path: '/admin/applications', title: 'Applications', visible: can('platform.identity-review.read'),
      description: 'Organization applications, CAC verification and approval.' },
    { path: '/admin/facilities', title: 'Facilities', visible: can('platform.facility.read'),
      description: 'Facility status, organization and membership counts.' },
  ] },
  { title: 'People and access', items: [
    { path: '/admin/principals', title: 'Users & roles', visible: can('platform.principal.read'),
      description: 'Account lookup, status, platform roles, sessions and support lookups.' },
    { path: '/admin/approvals', title: 'Approvals',
      visible: actor => APPROVAL_PERMISSIONS.some(code => actor.platformPermissions.includes(code)),
      description: 'Two-person Super Admin grants and authenticator resets.' },
    { path: '/admin/reviews', title: 'Identity review', visible: can('platform.identity-review.read'),
      description: 'Registration cases that need identity oversight.' },
  ] },
  { title: 'Security', items: [
    { path: '/admin/audit', title: 'Audit', visible: can('platform.audit.read'),
      description: 'Platform and facility audit events.' },
    { path: '/admin/security', title: 'My security', visible: can('platform.admin.access'),
      description: 'Your authenticator, recovery codes and sessions.' },
  ] },
  { title: 'Operations', items: [
    { path: '/admin/operations', title: 'Service health', visible: can('platform.operations.read'),
      description: 'Backend service checks and event delivery.' },
    { path: '/admin/integrations', title: 'Integrations', visible: can('platform.integration.read'),
      description: 'Provider status, routing, configuration and history.' },
    { path: '/admin/controls', title: 'Platform controls', visible: can('platform.control.read'),
      description: 'Maintenance and portal switches.' },
  ] },
  { title: 'Commercial', items: [
    { path: '/admin/pricing', title: 'Pricing', visible: can('platform.pricing.read'),
      description: 'The catalog the public website may display.' },
    { path: '/admin/demos', title: 'Demo requests', visible: can('platform.demo.read'),
      description: 'Requests submitted through the public website.' },
  ] },
]

export const NAVIGATION_ITEMS: readonly NavigationItem[] = NAVIGATION.flatMap(section => section.items)

/** The navigation item that owns a path, including its sub-pages (for example a facility). */
export function navigationItemFor(pathname: string): NavigationItem | undefined {
  return NAVIGATION_ITEMS.find(item => pathname === item.path || pathname.startsWith(`${item.path}/`))
}

/** The sections and items this administrator may see, without empty sections. */
export function visibleNavigation(actor: AdminActor): NavigationSection[] {
  return NAVIGATION.map(section => ({ ...section, items: section.items.filter(item => item.visible(actor)) }))
    .filter(section => section.items.length > 0)
}
