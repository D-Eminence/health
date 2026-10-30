import { EhrButton, EhrCard } from '@hid/ui/ehr'
import { useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { staffApi, type AccessRequest } from '../../../staff/api'
import { outcome } from '../../../staff/routes/AccessRequests'
import { ACCESS_ENDED } from '../parts/chart'
import { ActionList, ConfirmAction, DetailGrid, DetailMeta, SavedRecord, Step, SubHeading } from '../parts/Detail'
import { Banner, ErrorBox, Loading, NoActions, RecordHeading, RecordNotFound } from '../parts/Notices'
import { useClinical, useWorkspaceHref } from '../parts/Workspace'
import { ACCESS_CLOSED, CLOSE_GRANT, CLOSE_REASON, METHOD_ROUTES, actionUnavailable, administratorOf } from './access'
import { closable, closeError, latest, methodLabel, patientContext, requestDetails, useAccessRequests } from './requests'

/** What each outcome means for the clinician, in today's words where today has them. */
function StateBanner({ request }: { request: AccessRequest }) {
  const href = useWorkspaceHref()
  const key = request.effectiveStatus ?? request.status
  const { label } = outcome(request)
  if (key === 'pending') return <Banner title={label}>The patient must approve before records are available.</Banner>
  if (key === 'active' || key === 'approved') {
    return (
      <Banner title={label} actions={<Link className="hid-ehr-clinical-link" to={href.to('patients')}>Verify access on Patients →</Link>}>
        Already approved? Verify with the server before opening the chart.
      </Banner>
    )
  }
  if (key === 'denied') return <Banner tone="warning" title={label}>{request.deniedReason || undefined}</Banner>
  if (key === 'closed') return <Banner title={label} />
  return <Banner tone="warning" title={label} />
}

/** One access request: the design's record page, with Close access for an active grant. */
export function RequestDetail() {
  const { recordId = '' } = useParams()
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const location = useLocation()
  const { facility, permissions, activePatient, setActivePatient } = useClinical()
  const list = useAccessRequests('')
  const [notice, setNotice] = useState(() => {
    const state: unknown = location.state
    return state && typeof state === 'object' && 'notice' in state && typeof state.notice === 'string' ? state.notice : ''
  })
  const [failure, setFailure] = useState('')
  const [ended, setEnded] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [settled, setSettled] = useState(0)
  const status = useRef<HTMLDivElement>(null)
  const administrator = administratorOf(facility, permissions)
  const closeUnavailable = actionUnavailable(CLOSE_GRANT, permissions, administrator)
  const emergencyUnavailable = actionUnavailable(METHOD_ROUTES.emergency, permissions, administrator)

  // Closing takes its button away: focus goes to what happened, unless it is somewhere already.
  useLayoutEffect(() => {
    if (!settled) return
    const focused = document.activeElement
    if (!focused || focused === document.body || !focused.isConnected) status.current?.focus()
  }, [settled])

  const request = list.requests?.find(item => item.accessRequestId === recordId)

  async function close() {
    if (!facility || !request?.consentGrantId || closeUnavailable) return
    const grantId = request.consentGrantId
    setFailure('')
    setNotice('')
    let refused = ''
    let endedOpen = false
    try {
      await staffApi.closeGrant(facility.id, grantId, CLOSE_REASON)
      // The open record, if this grant opened it, has ended too.
      if (activePatient?.lookup.authorization.consentGrantId === grantId) {
        setActivePatient(null)
        endedOpen = true
      }
    } catch (caught) {
      refused = closeError(caught)
    }
    // Read again either way, then say what happened.
    await list.load()
    setConfirming(false)
    if (refused) setFailure(refused)
    else { setNotice(ACCESS_CLOSED); setEnded(endedOpen) }
    setSettled(value => value + 1)
  }

  const statusRegion = (
    <div ref={status} tabIndex={-1} role="status" className="hid-ehr-clinical-consent-status">
      {notice ? <p className="hid-ehr-clinical-status">{notice}</p> : null}
    </div>
  )

  // A request just sent is confirmed ("Request … is pending.") even while the list is read, cannot be read, or lacks it.
  if (!request) {
    if (list.error) {
      return (
        <>
          <RecordHeading title="External record access" backHref={href()} />
          {statusRegion}
          <ErrorBox>{list.error}</ErrorBox>
        </>
      )
    }
    if (list.requests === null) {
      return <><RecordHeading title="External record access" backHref={href()} />{statusRegion}<Loading label="Loading requests…" /></>
    }
    return <><RecordNotFound backHref={href()} />{statusRegion}</>
  }

  return (
    <>
      <RecordHeading title={request.reason} backHref={href()} />
      <DetailMeta status={outcome(request).label} note={methodLabel(request) || undefined} patient={patientContext(request)} saved={latest(request)} />
      {ended ? (
        <Banner tone="critical" title="Access to this patient ended" actions={<Link className="hid-ehr-clinical-link" to={href.to('patients')}>Go to patient access →</Link>}>
          {ACCESS_ENDED}
        </Banner>
      ) : null}
      <StateBanner request={request} />
      {statusRegion}
      {failure ? <ErrorBox>{failure}</ErrorBox> : null}
      {list.error ? <ErrorBox>{list.error}</ErrorBox> : null}
      <DetailGrid>
        <SavedRecord items={requestDetails(request)} />
        <EhrCard title="Available actions">
          {closable(request) ? (
            <>
              {closeUnavailable ? <p id="close-access-unavailable" className="hid-ehr-clinical-note">{closeUnavailable}</p> : null}
              <ActionList>
                <EhrButton
                  variant="secondary"
                  disabled={closeUnavailable !== null}
                  aria-describedby={closeUnavailable ? 'close-access-unavailable' : undefined}
                  onClick={() => setConfirming(true)}
                >
                  Close access
                </EhrButton>
              </ActionList>
            </>
          ) : <NoActions />}
          {emergencyUnavailable === null ? (
            <>
              <SubHeading>Next steps</SubHeading>
              <Step>
                <EhrButton variant="secondary" onClick={() => navigate(href.to('emergency'))}>Emergency break-glass access</EhrButton>
              </Step>
            </>
          ) : null}
        </EhrCard>
      </DetailGrid>
      <ConfirmAction open={confirming} label="Close access" onConfirm={close} onCancel={() => setConfirming(false)} />
    </>
  )
}
