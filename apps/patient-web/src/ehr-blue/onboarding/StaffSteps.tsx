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
      <p className="hid-ehr-onboarding-text">Reporting hierarchies are optional. Shifts can be configured now or after launch.</p>
      <p className="hid-ehr-onboarding-text"><Link className="hid-ehr-onboarding-link" to={shiftAssignment}>Create a shift assignment</Link></p>
    </> : null}
  </>
}

/** The design's first sentence on the Roles step (screen 19). */
const OWNERSHIP = 'Administrative ownership never grants clinical signing, prescribing or dispensing rights.'

/**
 * Step 6, Roles (screen 19): the design's role templates and their permission scopes, read-only and a sample (they are
 * the design's, not Health ID's roles), above today's Staff & access page, live. The templates show at the demo
 * facilities only (`templates`): at a real facility they would read as its own roles, and their scopes as Health ID's
 * permissions. There the step keeps the design's true first sentence, with where each person's role is set, so that it
 * says what it is for and is not the Staff step again.
 *
 * The design's second sentence, "Branch access and restrictions are editable in Staff & Roles.", is replaced: Health ID
 * has no branches, and its Staff & access (Memberships.tsx) edits a member's role and account access only. The words
 * say instead where Health ID's own roles are (inviteOptions.roles, offered by Identity).
 */
export function RolesStep({ templates }: { readonly templates: boolean }) {
  return <>
    {templates ? <EhrCard title="Role templates and permission scopes">
      <div className="hid-ehr-onboarding-stack">
        <EhrSampleBanner />
        <p className="hid-ehr-onboarding-text">{OWNERSHIP} Health ID’s own roles are the ones Staff & access offers below.</p>
        <div className="hid-ehr-onboarding-roles">
          {ROLE_TEMPLATES.map(role => (
            <details key={role}>
              <summary>{role}</summary>
              <p>{templateScopes(role).join(', ')}</p>
            </details>
          ))}
        </div>
      </div>
    </EhrCard> : <p className="hid-ehr-onboarding-text">Each person’s role is set in Staff & access below. {OWNERSHIP}</p>}
    <div className="hid-ehr-onboarding-embedded"><StaffAccess /></div>
  </>
}
