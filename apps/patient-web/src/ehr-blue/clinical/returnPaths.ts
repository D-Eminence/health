import type { AccessRequestStatus } from '../../staff/api'

/**
 * Where a sign-in may bring a person back to in the clinical workspaces (single sign-on on auth., contract v2): a
 * page on this product host, named by record ids only. The open patient, its purpose and emergency access live in
 * memory and are never carried (parts/chart.tsx); a record page reached again asks for the patient first, and reads
 * nothing until the patient is opened again by a fresh lookup.
 *
 * Pure: it reads, stores and logs nothing, and nothing calls it yet. The product's signed-out hand-off will, behind its
 * own setting.
 */

/**
 * The workspaces of ./pages.ts by their address segment under /provider (parts/segments.ts: Consultation is
 * `clinical`, External record access `requests`). Live workspaces come back to their list and their record pages;
 * sample workspaces to their list only, as a sample record does not outlive the page (sample/store.ts).
 */
const LIVE = ['patients', 'triage', 'clinical', 'nursing', 'emergency', 'requests'] as const
const SAMPLE = [
  'appointments', 'journey', 'inpatient', 'wards', 'maternity', 'surgery', 'icu', 'dental', 'nursing-tasks', 'radiology',
  'referrals', 'telemedicine', 'bloodbank', 'ward-config',
] as const

/** A record id as EHR and Identity issue them: opaque letters, digits, hyphens and underscores. */
const ID = '([A-Za-z0-9_-]{1,64})'

/**
 * The route words of the workspaces (forms, the open patient, the emergency summary, the orders part): never a record
 * id. Their pages hold nothing to come back to, or name the open patient or emergency access, so none is kept.
 */
const ROUTE_WORDS: ReadonlySet<string> = new Set(['new', 'pin', 'open', 'summary', 'orders'])

/** The access request list's Status filters: today's statuses, then its outcomes (consent/requests.ts statusFilter). */
const STATUS_FILTERS: readonly AccessRequestStatus[] = ['pending', 'approved', 'denied', 'revoked', 'expired', 'active', 'closed']

type Shape = { readonly pattern: RegExp; readonly status?: true }

/**
 * Every page that may be come back to, matched whole and case-sensitively, with no trailing slash. Ids are letters,
 * digits, hyphens and underscores only, so an encoded character, a backslash, a dot, a space or an empty segment never
 * matches; nor does a fragment, as `#` is in no shape or query.
 */
const SHAPES: readonly Shape[] = [
  // A workspace's list.
  { pattern: new RegExp(`^/provider/(?:${[...LIVE, ...SAMPLE].join('|')})$`) },
  // An encounter (consult/ConsultWorkspace.tsx `:recordId`).
  { pattern: new RegExp(`^/provider/clinical/${ID}$`) },
  // A prescription or lab request raised from it (consult/orders/index.tsx orderPath).
  { pattern: new RegExp(`^/provider/clinical/${ID}/orders/(?:pharmacy|laboratory)/${ID}$`) },
  // A vitals or nursing record, by its encounter and its own id (triage/records.ts recordKey).
  { pattern: new RegExp(`^/provider/(?:triage|nursing)/${ID}~${ID}$`) },
  // An access request, with the list's Status filter when it was found through it (consent/RequestDetail.tsx).
  { pattern: new RegExp(`^/provider/requests/${ID}$`), status: true },
]

/**
 * A Health ID anywhere, in any case, with or without its hyphen ("HID-ZDEMAAA2", "hid-zdemaaa2", "HIDZDEMAAA2"; older
 * ones have 4 or more characters, departments/pharmacy/Sell.tsx). Record ids are opaque, so one could be typed where
 * an id goes: such an address is never kept. EHR's ids are UUIDs, whose hex digits never spell "hid".
 */
const HEALTH_ID_SHAPE = /hid[-_]?[a-z0-9]{4,}/i

function isStatusQuery(query: string): boolean {
  const value = /^status=([a-z]+)$/.exec(query)?.[1]
  return value !== undefined && (STATUS_FILTERS as readonly string[]).includes(value)
}

/**
 * The address itself when it is a clinical page a person may come back to after signing in, else null. The only query
 * kept is `status` on an access request page, with one of the list's filters. A form (`new`, `pin`), the open patient
 * (`patients/open`), the emergency summary, a sample record and anything not exactly one of these pages is refused.
 */
export function clinicalReturnPath(path: string): string | null {
  if (typeof path !== 'string' || HEALTH_ID_SHAPE.test(path)) return null
  const [pathname = '', query, ...more] = path.split('?')
  if (more.length > 0) return null
  for (const { pattern, status } of SHAPES) {
    const ids = pattern.exec(pathname)?.slice(1)
    if (!ids) continue
    if (ids.some(id => ROUTE_WORDS.has(id))) return null
    if (query === undefined) return path
    return status && isStatusQuery(query) ? path : null
  }
  return null
}
