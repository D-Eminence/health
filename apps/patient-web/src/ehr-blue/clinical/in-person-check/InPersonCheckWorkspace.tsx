import { EhrEmptyState, EhrPageHeading } from '@hid/ui/ehr'
import { Route, Routes } from 'react-router-dom'
import { RecordNotFound } from '../parts/Notices'
import { Workspace, useClinical, useWorkspaceHref } from '../parts/Workspace'
import type { EhrBluePageStatus } from '../types'
import { UNAVAILABLE, UNAVAILABLE_TITLE, mayCheck } from './check'
import { CheckDesk } from './CheckDesk'

/** Fully on today's Health ID API: the one call is Identity's assisted verification. */
export const inPersonCheckStatus: EhrBluePageStatus = 'live'

export const TITLE = 'In-person check'
export const EYEBROW = 'Identity operations'
export const DESCRIPTION = 'Check a patient registering on their own phone who cannot receive the code sent to the phone on their NIN record. You check one original photo ID; Health ID compares the details with the NIN record and never shows you the record.'

/**
 * In-person check (today's staff/routes/InPersonCheck.tsx), drawn in the design's create form: the staff side of
 * facility-assisted registration. One screen, no list and no read on open: the page sends one request, and only when
 * the user presses Check. Below its address there is no page (the design's "Record not found").
 */
export function InPersonCheckWorkspace() {
  return (
    <Workspace path="in-person-check" title={TITLE}>
      <Routes>
        <Route index element={<InPersonCheckPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Workspace>
  )
}

function NotFound() {
  const href = useWorkspaceHref()
  return <RecordNotFound backHref={href()} />
}

/**
 * The page, or today's refusal when there is no working facility or its role lacks the permission the registry lists
 * for the check. Inside the frame the frame's own refusal comes first (the page's permission is the same one), so this
 * one shows only where the page is reached without the frame's check; it sends nothing either way.
 */
function InPersonCheckPage() {
  const { facility, permissions } = useClinical()
  if (!facility || !mayCheck(permissions)) return <Unavailable />
  return (
    <>
      <EhrPageHeading eyebrow={EYEBROW} title={TITLE} description={DESCRIPTION} />
      {/* Another facility starts afresh: nothing typed, answered or kept for a retry carries over. */}
      <CheckDesk key={facility.id} facilityId={facility.id} />
    </>
  )
}

/** Today's refusal in its words, drawn as the frame's refusal page: the page's heading, then the empty state. */
function Unavailable() {
  return (
    <>
      <EhrPageHeading title={TITLE} />
      <EhrEmptyState title={UNAVAILABLE_TITLE} message={UNAVAILABLE} />
    </>
  )
}

/**
 * Today's refusal as a page of its own, for the frame's `refusal` slot (frame/types.ts): given it, the frame would say
 * today's words instead of "In-person check is not open to you here". It makes no request.
 */
export function InPersonCheckRefusal() {
  return (
    <Workspace path="in-person-check" title={TITLE}>
      <Unavailable />
    </Workspace>
  )
}
