import { Link } from 'react-router-dom'
import { EhrCard, EhrSampleBanner } from '@hid/ui/ehr'
import { StaffAccess } from '../departments/staff/StaffAccess'
import { ROLE_TEMPLATES, templateScopes } from './roleTemplates'

/**
 * Step 5, Staff (screen 18): today's Staff & access page, live, as it is: it reads the facility's staff and invitations
 * through today's staff API and keeps its own rules (who may invite, and when). The design's line on shifts, and its
 * link into the Shifts & Roster sample, show only where that sample opens at a demo facility: a live step leads into
 * no sample at a real facility.
 */
export function StaffStep({ shiftAssignment }: { readonly shiftAssignment: string | null }) {
  return <>
    <div className="hid-ehr-onboarding-embedded"><StaffAccess /></div>
    {shiftAssignment ? <>
      <p className="hid-ehr-onboarding-text">Who reports to whom is optional. You can set shifts now or after launch.</p>
      <p className="hid-ehr-onboarding-text"><Link className="hid-ehr-onboarding-link" to={shiftAssignment}>Add a shift</Link></p>
    </> : null}
  </>
}

/**
 * Step 6, Roles (screen 19): the design's role templates and their permission scopes, read-only and a sample (they are
 * the design's, not Health ID's roles), above today's Staff & access page, live.
 *
 * The design's second sentence, "Branch access and restrictions are editable in Staff & Roles.", is replaced: Health ID
 * has no branches, and its Staff & access (Memberships.tsx) edits a member's role and account access only. The words
 * say instead where Health ID's own roles are (inviteOptions.roles, offered by Identity).
 */
export function RolesStep() {
  return <>
    <EhrCard title="Roles and what each can do">
      <div className="hid-ehr-onboarding-stack">
        <EhrSampleBanner />
        <p className="hid-ehr-onboarding-text">Being an owner or admin never lets someone sign clinical notes, prescribe or dispense.
          Health ID’s own roles are the ones Staff & access offers below.</p>
        <div className="hid-ehr-onboarding-roles">
          {ROLE_TEMPLATES.map(role => (
            <details key={role}>
              <summary>{role}</summary>
              <p>{templateScopes(role).join(', ')}</p>
            </details>
          ))}
        </div>
      </div>
    </EhrCard>
    <div className="hid-ehr-onboarding-embedded"><StaffAccess /></div>
  </>
}
