import { usesNovuBackend } from '../backendContract'
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
  /**
   * Whether the configured backend serves this area at all (default: yes). An
   * area it does not serve is neither linked nor routed, whatever the actor holds.
   */
  readonly served?: () => boolean
}

export interface NavigationSection {
  readonly title: string
  readonly items: readonly NavigationItem[]
}

const can = (permission: string) => (actor: AdminActor) => actor.platformPermissions.includes(permission)
/** Novu has no two-person approvals, no administrator authenticator or session list, and no clinician applications. */
const onMainBackend = () => !usesNovuBackend()
/**
 * Areas only Novu serves: emergency-contact administration (hid-system #109), support's review of facilities
 * that signed themselves up (P4), orders between facilities (P4c) and their wrong-patient reports (item 3).
 */
const onNovuBackend = () => usesNovuBackend()

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
    // P4: listed for the Applications page's permission; marking one reviewed needs platform.facility.manage.
    { path: '/admin/self-service-facilities', title: 'New facility sign-ups', served: onNovuBackend,
      visible: can('platform.identity-review.read'),
      description: 'Facilities that signed themselves up, for support to check within one working day.' },
    { path: '/admin/facilities', title: 'Facilities', visible: can('platform.facility.read'),
      description: 'Facility status, organization and membership counts.' },
    // P4c: finding an order between facilities needs the lookup's permission; closing one platform.facility.manage.
    { path: '/admin/order-routes', title: 'Orders between facilities', served: onNovuBackend,
      visible: can('platform.principal.read'),
      description: 'Find a lab request or prescription sent to another facility by its reference or Health ID, and close it.' },
    // Item 3: reading the reports needs platform.facility.read; marking one reviewed platform.facility.manage. An Identity
    // before the wrong-patient report (0088) answers 404, which the page says.
    { path: '/admin/wrong-patient-reports', title: 'Wrong-patient reports', served: onNovuBackend,
      visible: can('platform.facility.read'),
      description: 'Orders a laboratory or pharmacy accepted for someone who was not the patient: review each one.' },
  ] },
  { title: 'People and access', items: [
    { path: '/admin/principals', title: 'Users & roles', visible: can('platform.principal.read'),
      description: 'Account lookup, status, platform roles, sessions and support lookups.' },
    // hid-system #109: support_admin, and every role with platform.principal.manage, holds the permission.
    { path: '/admin/emergency-contacts', title: 'Emergency contact alerts', served: onNovuBackend,
      visible: can('platform.emergency-contact.manage'),
      description: 'Stop emergency-access alerts to someone who asked Health ID support to stop them.' },
    { path: '/admin/approvals', title: 'Approvals', served: onMainBackend,
      visible: actor => APPROVAL_PERMISSIONS.some(code => actor.platformPermissions.includes(code)),
      description: 'Two-person Super Admin grants and authenticator resets.' },
    { path: '/admin/reviews', title: 'Identity review', visible: can('platform.identity-review.read'),
      description: 'Registration cases that need identity oversight.' },
    // hid-system ADR-066: every route of the queue needs platform.workforce.manage.
    { path: '/admin/clinicians', title: 'Clinician applications', served: onMainBackend, visible: can('platform.workforce.manage'),
      description: 'Doctors and nurses who applied by themselves: one Super Admin verifies, then a second Super Admin approves.' },
  ] },
  { title: 'Security', items: [
    { path: '/admin/audit', title: 'Audit', visible: can('platform.audit.read'),
      description: 'Platform and facility audit events.' },
    { path: '/admin/security', title: 'My security', served: onMainBackend, visible: can('platform.admin.access'),
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

/** Whether the configured backend serves this area. */
export function isServed(item: NavigationItem): boolean { return item.served?.() ?? true }

/** Whether this administrator may open this area on the configured backend. */
export function canOpen(item: NavigationItem, actor: AdminActor): boolean { return isServed(item) && item.visible(actor) }

/** The sections and items this administrator may see, without empty sections. */
export function visibleNavigation(actor: AdminActor): NavigationSection[] {
  return NAVIGATION.map(section => ({ ...section, items: section.items.filter(item => canOpen(item, actor)) }))
    .filter(section => section.items.length > 0)
}

/**
 * Capabilities the reference administration console describes but the backend
 * does not provide yet. They are listed, not imitated: no page, data or action
 * exists for them in this console.
 */
export const UNAVAILABLE_CAPABILITIES: ReadonlyArray<{ title: string; detail: string }> = [
  { title: 'Organization directory', detail: 'No admin endpoint lists or opens organizations. Facilities show their organization, and applications create or link one.' },
  { title: 'Support cases', detail: 'Support is account lookup, status and session revocation in Users & roles. There is no case, ticket or note service.' },
  { title: 'Security event metrics', detail: 'No aggregate endpoint exists. Filter Audit by outcome (for example denied) instead.' },
  { title: 'Legal holds and session-event review', detail: 'Not built in the backend yet (Stage 2A finding S7).' },
  { title: 'Billing, subscriptions and invoices', detail: 'No platform billing contract exists.' },
]
