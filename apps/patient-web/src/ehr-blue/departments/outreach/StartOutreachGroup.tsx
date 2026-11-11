import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { EhrInput, EhrSelect } from '@hid/ui/ehr'
import { FormActions, FormPage, Step } from '../../../kasuwa/parts'
import { Alert, Button } from '../../../kasuwa/ui'
import { staffApi, type OutreachGroupDetails } from '../../../staff/api'
import { useStaff } from '../../../staff/App'
import { OUTREACH_TERMS_PATH } from '../../../productHostname'
import { ORGANISER_TERMS_SUMMARY, ORGANISER_TERMS_VERSION } from '../../../outreachTerms'
import { isOutreachProblem, outreachProblemText, SIGNUP_CLOSED, signupClosed, TERMS_CHANGED } from '../../../outreachProblems'
import { groupDetailsProblems } from '../../../outreachGroupDetails'
import { controlProps, ErrorBox, OutreachField } from './outreachParts'

type Field = 'groupName' | 'phone' | 'registrationNumber' | 'terms'
const FAILED = 'Your outreach group could not be started. Please try again.'

/**
 * "Start an outreach group" (owner decision 5 of 11 November 2026): someone who already has a Health ID staff login,
 * such as a hospital worker, starts their own outreach group with the same login. They become its organiser, at the
 * group's own new facility, and keep every role they have at their hospital; Switch facility moves between them. As
 * with any new group, Health ID does not check it first (decision Q38): its campaigns can open at once. Identity decides
 * it all; closed while the switch is off.
 */
export function StartOutreachGroup() {
  const { state, selectFacility, refresh } = useStaff()
  const navigate = useNavigate()
  const [open, setOpen] = useState<boolean | null>(null)
  // Identity accepts newer terms than the ones this page shows: nothing is sent until the page is reloaded.
  const [termsChanged, setTermsChanged] = useState(false)
  const [details, setDetails] = useState<OutreachGroupDetails>({ groupName: '', kind: 'group', registrationNumber: '', phone: '' })
  const [accepted, setAccepted] = useState(false)
  const [problems, setProblems] = useState<Partial<Record<Field, string>>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [started, setStarted] = useState<string | null>(null)

  // Fails safe: the form shows only once Identity says it is open.
  useEffect(() => {
    let active = true
    staffApi.outreachGroupAvailability().then(answer => {
      if (!active) return
      if (answer?.open === true && typeof answer.termsVersion === 'string' && answer.termsVersion
        && answer.termsVersion !== ORGANISER_TERMS_VERSION) setTermsChanged(true)
      setOpen(answer?.open === true)
    }, () => { if (active) setOpen(false) })
    return () => { active = false }
  }, [])

  if (state.status !== 'ready') return null

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError('')
    const found: Partial<Record<Field, string>> = { ...groupDetailsProblems(details) }
    if (!accepted) found.terms = 'Tick the box to accept the organiser terms.'
    setProblems(found)
    if (Object.keys(found).length > 0) return
    setBusy(true)
    try {
      const registration = details.registrationNumber?.replace(/\s+/g, '').toUpperCase()
      const answer = await staffApi.startOutreachGroup({ groupName: details.groupName.trim(), kind: details.kind, phone: details.phone.trim(),
        ...(registration ? { registrationNumber: registration } : {}), termsVersion: ORGANISER_TERMS_VERSION, acceptTerms: true })
      // Open the new group: its membership is new, so the session is read again first.
      let switched = false
      try {
        await refresh()
        switched = await selectFacility(answer.facilityId)
      } catch { /* said below: the group exists, and Switch facility opens it */ }
      if (switched) navigate('/provider/outreach')
      else setStarted(details.groupName.trim())
    } catch (caught) {
      if (signupClosed(caught)) setOpen(false)
      else if (isOutreachProblem(caught, 'OUTREACH_ORGANISER_TERMS_REQUIRED')) { setAccepted(false); setTermsChanged(true) }
      else setError(outreachProblemText(caught, FAILED))
    } finally {
      setBusy(false)
    }
  }

  const description = 'Run outreach events with your own volunteer group, using the login you already have. Your hospital '
    + 'work stays exactly as it is: use Switch facility to move between them.'
  if (open === null) return <FormPage title="Start an outreach group" description={description}><p role="status">Checking that this is open…</p></FormPage>
  if (!open) {
    return <FormPage title="Start an outreach group" description={description}>
      <Alert intent="info" title="Not open yet">{SIGNUP_CLOSED}</Alert>
    </FormPage>
  }
  if (termsChanged) {
    return <FormPage title="Start an outreach group" description={description}>
      <Alert intent="info" title="The terms have changed">{TERMS_CHANGED}</Alert>
      <FormActions sticky={false} align="start"><Button variant="primary" onClick={() => window.location.reload()}>Reload the page</Button></FormActions>
    </FormPage>
  }
  if (started) {
    return <FormPage title="Your outreach group is ready" description={`You are the organiser of ${started}.`}>
      <Alert intent="success" title="Group started">Use Switch facility to open {started}, then create its first campaign and
        invite your team.</Alert>
      <FormActions sticky={false} align="start"><Button variant="primary" onClick={() => navigate('/provider/institutions')}>Switch facility</Button></FormActions>
    </FormPage>
  }

  return (
    <FormPage title="Start an outreach group" description={description}>
      <form className="flex flex-col gap-4" noValidate onSubmit={event => void submit(event)}>
        <p className="m-0 text-caption text-ink-3">Fields marked * are required.</p>
        <Step n={1} title="Your group">
          <OutreachField id="start-group-name" label="Group name" required error={problems.groupName}
            hint="As people will know you, for example “Ajegunle Health Volunteers”. Not your hospital’s name.">
            <EhrInput maxLength={120} autoComplete="organization" value={details.groupName}
              onChange={event => setDetails(previous => ({ ...previous, groupName: event.target.value }))}
              {...controlProps('start-group-name', problems.groupName, true)} />
          </OutreachField>
          <OutreachField id="start-group-kind" label="Who is running it" required>
            <EhrSelect value={details.kind} onChange={event => setDetails(previous => ({ ...previous, kind: event.target.value as 'individual' | 'group' }))}
              {...controlProps('start-group-kind', undefined)}>
              <option value="group">A group, NGO or community organisation</option>
              <option value="individual">Just me, as a volunteer</option>
            </EhrSelect>
          </OutreachField>
          <OutreachField id="start-group-phone" label="Phone number" required error={problems.phone}
            hint="Health ID may call this number if there is a problem with your group.">
            <EhrInput type="tel" inputMode="tel" maxLength={32} autoComplete="tel" value={details.phone}
              onChange={event => setDetails(previous => ({ ...previous, phone: event.target.value }))}
              {...controlProps('start-group-phone', problems.phone, true)} />
          </OutreachField>
          <OutreachField id="start-group-registration" label="CAC or IT number (optional)" error={problems.registrationNumber}
            hint="If your group is registered. You can leave this empty.">
            <EhrInput maxLength={22} autoComplete="off" spellCheck={false} value={details.registrationNumber ?? ''}
              onChange={event => setDetails(previous => ({ ...previous, registrationNumber: event.target.value }))}
              {...controlProps('start-group-registration', problems.registrationNumber, true)} />
          </OutreachField>
        </Step>
        <Step n={2} title="Organiser terms">
          <ul className="m-0 pl-5 text-body text-ink-2">{ORGANISER_TERMS_SUMMARY.map(point => <li key={point}>{point}</li>)}</ul>
          <p className="m-0 text-body"><Link to={OUTREACH_TERMS_PATH} target="_blank" rel="noopener">Read the full organiser terms</Link> (opens in a new tab).</p>
          <label className="flex items-start gap-2" htmlFor="start-group-terms">
            <input id="start-group-terms" type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)}
              aria-invalid={problems.terms ? true : undefined} aria-describedby={problems.terms ? 'start-group-terms-error' : undefined} />
            <span>I have read and accept the organiser terms for my group.</span>
          </label>
          {problems.terms ? <p id="start-group-terms-error" className="hid-ehr-error">{problems.terms}</p> : null}
        </Step>
        <ErrorBox message={error} />
        <FormActions>
          <Button type="submit" variant="primary" size="lg" className="hid-ehr-dept-outreach-unavailable" aria-busy={busy || undefined}
            aria-disabled={busy || undefined}>{busy ? 'Starting…' : 'Start my outreach group'}</Button>
        </FormActions>
      </form>
    </FormPage>
  )
}
