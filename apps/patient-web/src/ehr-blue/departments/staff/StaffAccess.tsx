import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isHidApiError } from '@hid/http'
import { EhrButton, EhrSkeleton } from '@hid/ui/ehr'
import { usesNovuBackend } from '../../../backendContract'
import { facilityStaffApi, type FacilityStaff } from '../../../staff/api'
import { useStaff } from '../../../staff/App'
import { useFocusById } from '../../../staff/focus'
import { isLicenceBody, selfServiceReview } from '../../../staff/staffAccess'
import { isRouteMissing, isUnavailable, STAFF_REFRESHING, staffProblemText } from '../../../staff/staffProblems'
import { DeptPage, DeptUnavailable } from '../parts/DeptPage'
import { DeptNotice } from '../parts/DeptNotice'
import { InvitationLifecycle } from './Invitations'
import { InviteCard, OwnLicenceCard } from './InviteCard'
import { Memberships } from './Memberships'
import type { StaffShared } from './shared'
import { ErrorBox } from './StaffFields'
import { cannotInvite, IDS, type StaffNotice } from './staffText'

/**
 * Staff & access (admin/staff.png): a self-signed-up facility's memberships and invitations (Novu, P4b SPEC 8.1), on
 * today's staff API (facilityStaffApi). Its administrator invites staff and vouches for their licences, resends or
 * revokes invitations, changes a member's role and removes a member. Before Health ID support has checked the
 * facility it shows the administrator alone, and lets them record their own licence. Identity decides everything:
 * the page only says what it answered, and never whether an email has a Health ID account.
 *
 * Today's page is listed only at a self-signed-up facility on the Novu backend (staff/navigation.ts selfServiceOnly,
 * App.tsx `novu &&` route); the blue frame lists this one by permission alone, so the page keeps both gates itself.
 */

const TITLE = 'Staff & access'
const EYEBROW = 'Hospital memberships'

export function StaffAccess() {
  // Today's route exists only on Novu; elsewhere the workspace answers "This provider page is unavailable."
  if (!usesNovuBackend()) return <DeptUnavailable title={TITLE} message="Staff & access isn’t available on this Health ID service." />
  return <StaffAccessPage />
}

/** Today's words where Health ID support manages a facility's staff (staff/routes/Staff.tsx). */
function managedBySupport(facility: string): string {
  return `Health ID support manages who works at ${facility}. Contact Health ID support to add or remove staff.`
}

/**
 * What /provider/staff says where the frame turns the page down (visible(): a governed facility, or a service without
 * staff management; or no workforce.manage): the page's own words, from the session alone. It reads no staff.
 */
export function StaffRefusal() {
  const { state } = useStaff()
  const facility = state.status === 'ready' ? state.session.actor.facility : undefined
  if (!usesNovuBackend()) return <DeptUnavailable title={TITLE} message="Staff & access isn’t available on this Health ID service." />
  if (!facility) return <DeptUnavailable title={TITLE} message="Choose the facility you are working at first." />
  if (!facility.permissions.includes('workforce.manage')) {
    return <DeptUnavailable title={TITLE} message={`Only ${facility.name}’s administrator can manage its staff.`} />
  }
  return <DeptUnavailable title={TITLE} message={managedBySupport(facility.name)} />
}

type Loaded =
  | { facilityId: string; status: 'loading' }
  | { facilityId: string; status: 'ready'; staff: FacilityStaff }
  | { facilityId: string; status: 'failed'; caught: unknown }

function StaffAccessPage() {
  const { state } = useStaff()
  const actor = state.status === 'ready' ? state.session.actor : undefined
  const facility = actor?.facility
  const facilityId = facility?.id ?? ''
  const canManage = facility?.permissions.includes('workforce.manage') ?? false
  const selfService = selfServiceReview(facility) !== null
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [revision, setRevision] = useState(0)
  const [problem, setProblem] = useState('')
  const reload = useCallback(() => setRevision(value => value + 1), [])
  const retrying = useRef(false)
  const focus = useFocusById()

  useEffect(() => {
    if (!facilityId || !canManage || !selfService) return
    let active = true
    // What was read stays shown while it is read again.
    setLoaded(previous => previous?.facilityId === facilityId && previous.status === 'ready' ? previous
      : { facilityId, status: 'loading' })
    facilityStaffApi.read(facilityId).then(
      staff => { if (active) setLoaded({ facilityId, status: 'ready', staff }) },
      caught => { if (active) setLoaded({ facilityId, status: 'failed', caught }) })
    return () => { active = false }
  }, [facilityId, canManage, selfService, revision])

  const current = loaded?.facilityId === facilityId ? loaded : null
  // After "Try again", focus goes to what replaced the button: the list, or the button again.
  useLayoutEffect(() => {
    if (!retrying.current || !current || current.status === 'loading') return
    retrying.current = false
    focus(current.status === 'failed' ? IDS.retry : IDS.members)
  }, [current, focus])

  if (!facility) return <DeptUnavailable title={TITLE} message="Choose the facility you are working at first." />
  if (!canManage) return <DeptUnavailable title={TITLE} message={`Only ${facility.name}’s administrator can manage its staff.`} />
  const notAvailable = <DeptUnavailable title={TITLE} message={managedBySupport(facility.name)} />
  if (!selfService) return notAvailable
  if (!current || current.status === 'loading') {
    return <DeptPage eyebrow={EYEBROW} title={TITLE}><EhrSkeleton label="Loading staff and invitations" /></DeptPage>
  }
  if (current.status === 'failed') {
    const { caught } = current
    if (isRouteMissing(caught)) return <DeptUnavailable title={TITLE} message="Adding staff isn’t available on Health ID yet. Please check again later." />
    if (isHidApiError(caught) && caught.code === 'STAFF_MANAGEMENT_NOT_AVAILABLE') return notAvailable
    const text = staffProblemText(caught, { facility: facility.name })
    return (
      <DeptPage eyebrow={EYEBROW} title={TITLE}>
        {/* An alert, so a refusal is said when it appears, also after "Try again" (focus then returns to the button,
            which the message describes). */}
        <div className="hid-ehr-error-state" role="alert">
          <p id={IDS.failedTitle} className="hid-ehr-state-title">Staff couldn’t be loaded</p>
          <p id={IDS.failedMessage} className="hid-ehr-state-message">{isUnavailable(caught) ? text : `${facility.name}’s staff couldn’t be loaded. ${text}`}</p>
          <div className="hid-ehr-state-action">
            <EhrButton id={IDS.retry} variant="secondary" aria-describedby={`${IDS.failedTitle} ${IDS.failedMessage}`}
              onClick={() => { retrying.current = true; reload() }}>Try again</EhrButton>
          </div>
        </div>
      </DeptPage>
    )
  }
  return <StaffView key={facilityId} staff={current.staff} facilityId={facilityId} actorEmail={actor?.email ?? ''}
    problem={problem} onProblem={setProblem} reload={reload} />
}

function StaffView({ staff, facilityId, actorEmail, problem, onProblem, reload }: {
  readonly staff: FacilityStaff
  readonly facilityId: string
  readonly actorEmail: string
  readonly problem: string
  readonly onProblem: (text: string) => void
  readonly reload: () => void
}) {
  const facilityName = staff.facility.name
  const reviewed = staff.facility.reviewState === 'reviewed'
  const canInvite = reviewed && staff.canInvite
  const [inviting, setInviting] = useState(false)
  // A fact an action leaves for the administrator (an email not delivered, consents ended): a banner, never a toast.
  const [notice, setNotice] = useState<StaffNotice | null>(null)
  const focus = useFocusById()
  // Where focus goes once the list has been read again after an action, if the control used is gone.
  const afterRead = useRef<readonly string[] | null>(null)
  useLayoutEffect(() => {
    const ids = afterRead.current
    if (!ids) return
    afterRead.current = null
    focus(ids, true)
  }, [staff, focus])

  const shared: StaffShared = {
    staff, facilityId, facilityName, actorEmail, reload,
    done: (focusAfter, next = null) => {
      onProblem('')
      setNotice(next)
      if (focusAfter) afterRead.current = focusAfter
      reload()
    },
    notify: setNotice,
    refused: caught => {
      const text = staffProblemText(caught, { facility: facilityName, limits: staff.limits })
      if (isHidApiError(caught) && STAFF_REFRESHING.includes(caught.code)) {
        onProblem(text)
        setNotice(null)
        afterRead.current = [IDS.problem]
        reload()
      }
      return text
    },
  }

  return (
    <DeptPage eyebrow={EYEBROW} title={TITLE} primaryAction={
      <EhrButton id={IDS.inviteToggle} disabled={!canInvite} aria-expanded={canInvite ? inviting : undefined}
        aria-controls={canInvite && inviting ? 'ehr-staff-invite-card' : undefined}
        aria-describedby={canInvite ? undefined : IDS.inviteWhy} onClick={() => setInviting(open => !open)}>Invite staff</EhrButton>
    }>
      {problem ? <ErrorBox id={IDS.problem} tabIndex={-1}>{problem}</ErrorBox> : null}
      <div role="status" id={IDS.notice}>{notice ? <DeptNotice tone={notice.tone}>{notice.text}</DeptNotice> : null}</div>
      {!reviewed ? <DeptNotice id={IDS.inviteWhy}>You can add staff once Health ID support has checked {facilityName}.</DeptNotice> : null}
      {reviewed && staff.facility.firstThirtyDaysEndAt ? <DeptNotice>In its first 30 days on Health ID, {facilityName} can send
        {' '}{staff.limits.invitationsPerDay} invitations a day. Ask Health ID support if you need more.</DeptNotice> : null}
      {reviewed && !staff.canInvite ? <DeptNotice tone="caution" id={IDS.inviteWhy}>{cannotInvite(staff)}</DeptNotice> : null}
      {!reviewed && staff.administratorLicenceBodies.some(isLicenceBody) ? <OwnLicenceCard shared={shared} /> : null}
      {canInvite && inviting ? <InviteCard shared={shared} onSent={sentNotice => {
        setInviting(false)
        focus(IDS.inviteToggle)
        shared.done(undefined, sentNotice)
      }} /> : null}
      <Memberships shared={shared} reviewed={reviewed} />
      <InvitationLifecycle shared={shared} reviewed={reviewed} />
    </DeptPage>
  )
}
