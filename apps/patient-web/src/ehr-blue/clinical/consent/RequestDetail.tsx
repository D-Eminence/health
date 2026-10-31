import { Siren } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ConfirmSheet, FormPage, LoadingRows } from '../../../kasuwa/parts'
import { Alert, Badge, Button, Card, CardHeader, DescriptionList, type Tone } from '../../../kasuwa/ui'
import { staffApi, type AccessRequest } from '../../../staff/api'
import { outcome } from '../../../staff/routes/AccessRequests'
import { ACCESS_ENDED } from '../parts/chart'
import { RecordNotFound } from '../parts/Notices'
import { useClinical, useWorkspaceHref } from '../parts/Workspace'
import { ACCESS_CLOSED, CLOSE_GRANT, CLOSE_REASON, METHOD_ROUTES, actionUnavailable, administratorOf } from './access'
import { closable, closeError, latest, patientContext, requestDetails, useAccessRequests } from './requests'
import { formatWhen } from '../parts/format'

const TONES: Readonly<Record<string, Tone>> = { success: 'success', warning: 'warn', danger: 'danger', neutral: 'neutral' }

/** The request's status as a badge, in today's words. */
export function OutcomeBadge({ request }: { request: AccessRequest }) {
  const { label, tone } = outcome(request)
  return <Badge size="sm" tone={TONES[tone] ?? 'neutral'}>{label}</Badge>
}

/** What the outcome means for the clinician, said once, with its one next step. */
function StateNote({ request }: { request: AccessRequest }) {
  const href = useWorkspaceHref()
  const key = request.effectiveStatus ?? request.status
  if (key === 'pending') return <Alert intent="info" live={false} title="Waiting for the patient">You can see their records once they approve.</Alert>
  if (key === 'active' || key === 'approved') {
    return <Alert intent="success" live={false} title="The patient approved" action={<Button size="sm" variant="primary" to={href.to('patients')}>Find a patient</Button>}>
      Open their record from Find a patient.</Alert>
  }
  if (key === 'denied') return <Alert intent="warning" live={false} title="The patient said no">{request.deniedReason || undefined}</Alert>
  return null
}

/** One access request: what was asked, its outcome, and its one next step (Close access, or emergency access). */
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
  const [closing, setClosing] = useState(false)
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
    if (!facility || !request?.consentGrantId || closeUnavailable || closing) return
    const grantId = request.consentGrantId
    setClosing(true)
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
    setClosing(false)
    setConfirming(false)
    if (refused) setFailure(refused)
    else { setNotice(ACCESS_CLOSED); setEnded(endedOpen) }
    setSettled(value => value + 1)
  }

  const statusRegion = (
    <div ref={status} tabIndex={-1} role="status" className="outline-none empty:hidden">
      {notice ? <Alert intent="success" live={false}>{notice}</Alert> : null}
    </div>
  )

  // A request just sent is confirmed ("Request sent.") even while the list is read, cannot be read, or lacks it. The
  // page and its heading stay the same element while the request loads, so the focus the frame gave the heading stays.
  if (!request) {
    if (!list.error && list.requests !== null) return <><RecordNotFound backHref={href()} />{statusRegion}</>
    return <FormPage title="Access request" back={{ to: href(), label: 'Back to access requests' }}>
      {statusRegion}
      {list.error ? <Alert intent="error" title="Couldn’t load this request" action={<Button size="sm" onClick={() => void list.load()}>Try again</Button>}>{list.error}</Alert>
        : <Card><LoadingRows rows={3} label="Loading this request" /></Card>}
    </FormPage>
  }

  const key = request.effectiveStatus ?? request.status
  const who = patientContext(request)
  // Emergency access is offered only while the patient has not given access: waiting, or refused.
  const offerEmergency = emergencyUnavailable === null && (key === 'pending' || key === 'denied')
  return (
    <FormPage title={`Access request · ${who}`} back={{ to: href(), label: 'Back to access requests' }}
      description={<span className="inline-flex flex-wrap items-center gap-2"><OutcomeBadge request={request} /><span>Updated {formatWhen(latest(request))}</span></span>}>
      {ended ? <Alert intent="error" title="Access to this patient ended"
        action={<Button size="sm" to={href.to('patients')}>Find a patient</Button>}>{ACCESS_ENDED}</Alert> : null}
      {statusRegion}
      {failure ? <Alert intent="error" title="Couldn’t close access">{failure}</Alert> : null}
      {list.error ? <Alert intent="error" title="Couldn’t refresh this request">{list.error}</Alert> : null}
      <StateNote request={request} />
      <Card>
        <CardHeader as="h2" title="The request" />
        <DescriptionList items={requestDetails(request).filter(item => item.label !== 'Patient').map((item): [ReactNode, ReactNode] => [item.label, item.value])} />
      </Card>
      {closable(request) ? <Card>
        <CardHeader as="h2" title="Close access" description="End your access when you have finished." />
        <div className="flex flex-col gap-2 p-5">
          {closeUnavailable ? <p id="close-access-unavailable" className="m-0 text-[13px] text-ink-3">{closeUnavailable}</p> : null}
          <Button variant="danger" className="self-start" disabled={closeUnavailable !== null}
            aria-describedby={closeUnavailable ? 'close-access-unavailable' : undefined} onClick={() => setConfirming(true)}>Close access</Button>
        </div>
      </Card> : null}
      {offerEmergency ? <Card>
        <CardHeader as="h2" title="Can’t wait for the patient?" icon={Siren} iconTone="danger"
          description="Only if they can’t consent and care can’t wait." />
        <div className="p-5"><Button icon={Siren} onClick={() => navigate(href.to('emergency'))}>Emergency access</Button></div>
      </Card> : null}
      <ConfirmSheet open={confirming} onClose={() => setConfirming(false)} destructive busy={closing} confirmLabel="Close access"
        title={`Close your access to ${who}?`}
        effect="You won’t see their records any more. To see them again, ask the patient."
        onConfirm={() => void close()} />
    </FormPage>
  )
}
