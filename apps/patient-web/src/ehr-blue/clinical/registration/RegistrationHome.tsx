import { EhrButton, EhrCard, EhrField, EhrInput, EhrPageHeading, EhrSelect } from '@hid/ui/ehr'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { staffApi, type RegistrationCapabilities, type ResolveNinInput } from '../../../staff/api'
import { useFieldProblems } from '../../../staff/useFieldProblems'
import { Banner, ErrorBox } from '../parts/Notices'
import { useClinical, useWorkspaceHref } from '../parts/Workspace'
import {
  AVAILABILITY, CAPABILITIES_FAILED, CASE_ID_PROBLEM, CHECKING, INTRO, NAME_PROBLEM, NIN_INTRO, NIN_PROBLEM, NIN_TITLE, RESOLVE_FAILED,
  TITLE, UUID, capabilityLine, createdState, mayOpenPatients, mayWrite, safeError,
} from './registration'
import { RegistrationUnavailable, Required, ResumeCard } from './RegistrationParts'

/**
 * Patient registration's first page, the design's "New patients" create page: whether NIN verification is available,
 * "Start with verified identity" (today's NIN form, only while the backend enables verification) and "Resume a
 * registration case". A case, new or resumed, opens on its own page. Everything resets for another facility, as today.
 */
export function RegistrationHome() {
  const { facility, permissions } = useClinical()
  if (!facility || !mayWrite(permissions)) return <RegistrationUnavailable />
  return <Home key={facility.id} facilityId={facility.id} openPatients={mayOpenPatients(permissions)} />
}

function Home({ facilityId, openPatients }: { facilityId: string; openPatients: boolean }) {
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const [capabilities, setCapabilities] = useState<RegistrationCapabilities | null>(null)
  const [capabilityError, setCapabilityError] = useState('')
  const [capabilityLoading, setCapabilityLoading] = useState(true)
  const [caseIdInput, setCaseIdInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // A value refused before sending is reported at its field; each form keeps its own refusals (today's useFieldProblems).
  const ninProblems = useFieldProblems()
  const caseProblems = useFieldProblems()
  // In memory only: replaced on every change to the NIN form and after a case is created, reused for an unchanged retry.
  const resolveKey = useRef(crypto.randomUUID())
  // An answer that comes back after this page has gone (another facility, another page) is dropped, as today's is.
  const live = useRef(true)

  useEffect(() => {
    live.current = true
    let active = true
    void staffApi.registrationCapabilities(facilityId)
      .then(value => { if (active) setCapabilities(value) })
      .catch(caught => { if (active) setCapabilityError(safeError(caught, CAPABILITIES_FAILED)) })
      .finally(() => { if (active) setCapabilityLoading(false) })
    return () => { active = false; live.current = false }
  }, [facilityId])

  /** "Check again": the answer shown stays while it is read again. */
  async function refreshCapabilities() {
    setCapabilityError('')
    setCapabilityLoading(true)
    try {
      const value = await staffApi.registrationCapabilities(facilityId)
      if (live.current) setCapabilities(value)
    } catch (caught) {
      if (live.current) setCapabilityError(safeError(caught, CAPABILITIES_FAILED))
    } finally { if (live.current) setCapabilityLoading(false) }
  }

  /** Today's loadCase, up to the read: the case is read on its own page. */
  function loadCase() {
    if (busy) return
    const normalized = caseIdInput.trim()
    setError(''); caseProblems.clear()
    if (!UUID.test(normalized)) { caseProblems.refuse('registration-case-id', CASE_ID_PROBLEM); return }
    navigate(href(normalized))
  }

  async function resolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!capabilities?.nin.enabled || busy) return
    const form = event.currentTarget
    const data = new FormData(form)
    const nin = String(data.get('nin') ?? '').trim()
    const firstName = String(data.get('firstName') ?? '').trim()
    const lastName = String(data.get('lastName') ?? '').trim()
    const dateOfBirth = String(data.get('dateOfBirth') ?? '')
    const gender = String(data.get('gender') ?? '') as ResolveNinInput['gender'] | ''
    setError(''); ninProblems.clear()
    if (!/^\d{11}$/.test(nin)) { ninProblems.refuse('registration-nin', NIN_PROBLEM); return }
    if (!firstName || !lastName || !dateOfBirth) {
      ninProblems.refuse(!firstName ? 'registration-first' : !lastName ? 'registration-last' : 'registration-dob', NAME_PROBLEM); return
    }
    setBusy(true)
    try {
      const result = await staffApi.resolveNin(facilityId,
        { nin, firstName, lastName, dateOfBirth, ...(gender ? { gender } : {}) }, resolveKey.current)
      if (!live.current) return
      // The NIN and the claims leave the form before the case opens; the case's page reads it.
      form.reset()
      resolveKey.current = crypto.randomUUID()
      navigate(href(result.caseId), { state: createdState(facilityId) })
    } catch (caught) {
      if (live.current) setError(safeError(caught, RESOLVE_FAILED))
    } finally { if (live.current) setBusy(false) }
  }

  return (
    <>
      <EhrPageHeading
        title={TITLE}
        description={INTRO}
        primaryAction={openPatients
          ? <EhrButton variant="secondary" onClick={() => navigate(href.to('patients'))}>Back to list</EhrButton> : undefined}
      />
      <Banner
        tone={capabilities && !capabilities.nin.enabled ? 'warning' : 'info'}
        title={AVAILABILITY}
        actions={(
          // Focusable while it reads; a press then does nothing.
          <EhrButton variant="secondary" size="sm" busy={capabilityLoading} onClick={() => { if (!capabilityLoading) void refreshCapabilities() }}>
            {capabilityLoading ? 'Checking…' : 'Check again'}
          </EhrButton>
        )}
      >
        {!capabilities && !capabilityError ? <p>{CHECKING}</p> : null}
        {capabilities ? <p>{capabilityLine(capabilities)}</p> : null}
      </Banner>
      {capabilityError ? <ErrorBox>{capabilityError}</ErrorBox> : null}

      {capabilities?.nin.enabled ? (
        <EhrCard title={NIN_TITLE}>
          <form
            className="hid-ehr-clinical-form"
            noValidate
            onInput={() => { resolveKey.current = crypto.randomUUID() }}
            onSubmit={event => void resolve(event)}
          >
            {/* Not disabled while the NIN is verified, which would take focus from the button: read-only. */}
            <div className="hid-ehr-clinical-form-grid">
              <EhrField controlId="registration-nin" label={<Required>National Identity Number</Required>} error={ninProblems.error('registration-nin')}>
                <EhrInput name="nin" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{11}" minLength={11} maxLength={11} readOnly={busy} required />
              </EhrField>
              <EhrField className="hid-ehr-clinical-registration-row-start" controlId="registration-first" label={<Required>First name</Required>} error={ninProblems.error('registration-first')}>
                <EhrInput name="firstName" maxLength={100} autoComplete="off" readOnly={busy} required />
              </EhrField>
              <EhrField controlId="registration-last" label={<Required>Last name</Required>} error={ninProblems.error('registration-last')}>
                <EhrInput name="lastName" maxLength={100} autoComplete="off" readOnly={busy} required />
              </EhrField>
              <EhrField controlId="registration-dob" label={<Required>Date of birth</Required>} error={ninProblems.error('registration-dob')}>
                <EhrInput name="dateOfBirth" type="date" readOnly={busy} required />
              </EhrField>
              <EhrField controlId="registration-gender" label="Gender (optional)">
                <EhrSelect name="gender">
                  <option value="">Not supplied</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="intersex">Intersex</option>
                  <option value="other">Other</option>
                  <option value="unknown">Unknown</option>
                </EhrSelect>
              </EhrField>
            </div>
            <p className="hid-ehr-clinical-note">{NIN_INTRO}</p>
            {error ? <ErrorBox>{error}</ErrorBox> : null}
            <div className="hid-ehr-clinical-form-footer">
              <EhrButton type="submit" busy={busy}>{busy ? 'Verifying…' : 'Verify and create case'}</EhrButton>
            </div>
          </form>
        </EhrCard>
      ) : null}

      <ResumeCard
        value={caseIdInput}
        onChange={setCaseIdInput}
        onLoad={loadCase}
        loading={false}
        unavailable={busy}
        error={caseProblems.error('registration-case-id')}
      />
      {/* No NIN card: a NIN verification's failure is said here, where today's page says it, after the cards. */}
      {error && !capabilities?.nin.enabled ? <ErrorBox>{error}</ErrorBox> : null}
    </>
  )
}
