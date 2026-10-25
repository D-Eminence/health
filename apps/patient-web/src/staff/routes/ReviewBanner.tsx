import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card } from '@hid/ui'
import { usesNovuBackend } from '../../backendContract'
import { staffSiteForOrganizationType, staffSiteHostname } from '../../productHostname'
import { facilityStaffApi, type Facility } from '../api'
import { useStaff } from '../App'
import { onFacilityStaffChanged, selfServiceReview, selfServiceType, type OrganizationType } from '../staffAccess'

/**
 * What stays locked until Health ID support has checked a facility that signed itself up (P4b SPEC 8.4), by its type:
 * never a workspace the type will not get. The restricted administrator role holds no permission that reaches patient
 * records, and the backend refuses every locked command; this is the copy.
 */
const LOCKED: Readonly<Record<OrganizationType, string>> = {
  hospital: 'patient records, emergency access, the Laboratory and Pharmacy work lists and adding staff are locked',
  clinic: 'patient records, emergency access, the Laboratory and Pharmacy work lists and adding staff are locked',
  laboratory: 'patient records, the Laboratory workspace and adding staff are locked',
  pharmacy: 'patient records, the Pharmacy workspace and adding staff are locked',
  other: 'patient records and adding staff are locked',
}

/** "…: sign in again at ehr.healthidentitydirectory.com to use them", by the facility's type; this portal elsewhere. */
function signInAgain(type: OrganizationType): string {
  const host = staffSiteHostname(staffSiteForOrganizationType(type), window.location.hostname)
  return host ? `sign in again at ${host} to use them` : 'sign in again to use them'
}

/** The banner's sentence, without the hint and the button. */
export function reviewPendingText(facilityName: string, type: OrganizationType): string {
  return `Health ID support is checking ${facilityName}. This usually takes up to one working day. Until then, `
    + `${LOCKED[type]}. When the check is done you’ll be signed out once: ${signInAgain(type)}.`
}

/**
 * Whether the facility's administrator has yet to record their own licence, which support needs to give them clinical
 * access (P4b SPEC 3.4): read from the Staff page's answer, by someone who can read it. Null while unknown, or when
 * the answer could not be read: the hint is then not shown.
 */
function useLicenceMissing(facility: Facility | undefined, pending: boolean): boolean | null {
  const canManage = facility?.permissions.includes('workforce.manage') ?? false
  const facilityId = facility?.id ?? ''
  const [answer, setAnswer] = useState<{ facilityId: string; missing: boolean } | null>(null)
  const [changed, setChanged] = useState(0)
  useEffect(() => onFacilityStaffChanged(() => setChanged(value => value + 1)), [])
  useEffect(() => {
    if (!pending || !canManage || !facilityId) return
    let active = true
    facilityStaffApi.read(facilityId).then(
      staff => { if (active) setAnswer({ facilityId, missing: !staff.administratorLicence && staff.administratorLicenceBodies.length > 0 }) },
      () => { if (active) setAnswer(null) })
    return () => { active = false }
  }, [pending, canManage, facilityId, changed])
  return answer && answer.facilityId === facilityId ? answer.missing : null
}

/**
 * Shown above every workspace page to every member of a self-signed-up facility while Health ID support has not
 * checked it (Novu, P4b). "Check again" reads the session afresh: once support has checked the facility, the session
 * has been ended, and the workspace says so.
 */
export function ReviewBanner() {
  const { state, refresh } = useStaff()
  const facility = state.status === 'ready' ? state.session.actor.facility : undefined
  const pending = usesNovuBackend() && selfServiceReview(facility) === 'pending'
  const licenceMissing = useLicenceMissing(facility, pending)
  const type = selfServiceType(facility)
  if (!pending || !facility || !type) return null
  return <div role="status" className="billing-banner billing-banner-information review-banner">
    <span>{reviewPendingText(facility.name, type)}{licenceMissing
      ? <> To get clinical access yourself, add your licence on the <Link to="/provider/staff">Staff page</Link>.</> : null}</span>
    <Button size="sm" tone="quiet" onClick={() => void refresh()}>Check again</Button>
  </div>
}

/**
 * The facilities whose "Done" card this page has shown. Held in memory: the portal keeps nothing in browser storage
 * (eslint NO_BROWSER_STORAGE). Support's check signs the administrator out, so the first Overview after it is in a
 * fresh page; the card shows once there.
 */
const checkDoneShown = new Set<string>()

/**
 * The Overview's "Facility check" card at a self-signed-up facility (Novu, P4b): pending until Health ID support has
 * checked it, then "Done" the first time the Overview opens after the check.
 */
export function FacilityCheckCard({ facility }: { facility: Facility }) {
  const review = usesNovuBackend() ? selfServiceReview(facility) : null
  const [doneFirstSeen] = useState(() => review === 'reviewed' && !checkDoneShown.has(facility.id))
  useEffect(() => { if (review === 'reviewed') checkDoneShown.add(facility.id) }, [review, facility.id])
  if (review === 'pending') {
    return <Card className="staff-card"><h2>Facility check</h2><p>Health ID support is checking {facility.name}. This usually takes up
      to one working day.</p><Badge tone="warning">Pending</Badge></Card>
  }
  if (review === 'reviewed' && doneFirstSeen) {
    return <Card className="staff-card"><h2>Facility check</h2><p>Health ID support has checked {facility.name}, and it now has
      full access.</p><Badge tone="success">Done</Badge></Card>
  }
  return null
}
