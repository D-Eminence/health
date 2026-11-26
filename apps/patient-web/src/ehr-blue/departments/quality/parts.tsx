import { Link } from 'react-router-dom'
import type { QualityMe } from '../../../staff/api'
import { DeptNotice } from '../parts/DeptNotice'
import { BASE, DRAFT_LIST, isDraft, manages } from './qualityRules'

/** What every view of the page is given: the facility, route 1's answer and the session's own membership here. */
export interface QualityShared {
  readonly facilityId: string
  readonly me: QualityMe
  readonly membershipId: string | undefined
}

/** The page's views, as links: a manager's five, everyone else's two. The one shown now is marked current. */
export function QualityTabs({ me, current }: { readonly me: QualityMe; readonly current: string }) {
  const tabs: readonly (readonly [string, string])[] = manages(me)
    ? [['', 'All reports'], ['reported-by-me', 'Reported by me'], ['assigned-to-me', 'Assigned to me'], ['counts', 'Monthly counts'], ['leads', 'Quality leads']]
    : [['', 'My reports'], ['assigned-to-me', 'Assigned to me']]
  return (
    <nav className="hid-ehr-qs-tabs" aria-label="Quality & Safety views">
      <ul>
        {tabs.map(([path, label]) => (
          <li key={path}>
            <Link to={path ? `${BASE}/${path}` : BASE} aria-current={current === path ? 'page' : undefined}>{label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** "Draft list, awaiting clinical sign-off" while the active list is the clinical lead's draft (Q124 A, Q250 A). */
export function DraftListBanner({ me }: { readonly me: QualityMe }) {
  if (!isDraft(me.lists)) return null
  return (
    <DeptNotice tone="caution" title={DRAFT_LIST}>
      The categories, the harm levels and their words wait for the clinical lead’s sign-off, and may still change.
    </DeptNotice>
  )
}
