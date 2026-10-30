import { useRef, useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { useSession } from '../session'
import { describedBy } from '../authSteps'
import { COVERAGE_TEXT_LIMIT, oneLine, sentText, type ProfileDetails } from '../profileParity'
import { HospitalPicker } from './enrollment/HospitalPicker'
import { useActionFocus, useRetryFocus } from './actionFocus'
import { ItemName } from '../ItemName'
import { ProfileSection } from './ProfileSection'

/** A profile resource as usePatientResource gives it: null data is "not served" (404) once it has loaded. */
export interface ProfileResource<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
  replace: (value: T) => void
}

const CONFLICT = 'These details were changed somewhere else, so yours weren’t saved. '
  + 'The latest is shown now. Make your change again.'

/**
 * "Coverage" on the profile (hid-1.0 parity B3): the hospital the patient uses now, with the sign-up's hospital
 * suggestions, and their HMO's name as free text, as hid-1.0 had them. Saved against the version read. Not shown where
 * Identity does not serve them (404).
 */
export function CoverageCard({ resource }: { resource: ProfileResource<ProfileDetails | null> }) {
  return useShownOnceServed(resource) ? <CoverageForm resource={resource} /> : null
}

/**
 * Whether a profile section is shown: once its read answered or failed, and while it reads again after that ('Try
 * again' among them, so the section and its focus stay); not while it is first read, nor where it is not served.
 */
export function useShownOnceServed(resource: Pick<ProfileResource<unknown>, 'data' | 'error' | 'loading'>): boolean {
  const answered = resource.data !== null || resource.error !== null
  const [seen, setSeen] = useState(answered)
  if (answered && !seen) setSeen(true)
  return answered || (seen && resource.loading)
}

function CoverageForm({ resource }: { resource: ProfileResource<ProfileDetails | null> }) {
  const { api } = useSession()
  const saved = resource.data
  const [hospital, setHospital] = useState(saved?.hospitalCurrentlyUsing ?? '')
  const [hmo, setHmo] = useState(saved?.hmoName ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusAfter = useActionFocus()
  const retryFocus = useRetryFocus(heading)
  const differs = (row: ProfileDetails | null) => row !== null && (sentText(hospital) !== row.hospitalCurrentlyUsing || sentText(hmo) !== row.hmoName)
  const changed = differs(saved)
  // A new reading starts the fields again from what is saved: after a save, after a refused one (another version), or
  // as the page reads again; changes typed meanwhile are kept unless the details were saved somewhere else.
  const [basis, setBasis] = useState(saved)
  if (saved !== basis) {
    setBasis(saved)
    if (!differs(basis) || saved?.rowVersion !== basis?.rowVersion) {
      setHospital(saved?.hospitalCurrentlyUsing ?? ''); setHmo(saved?.hmoName ?? '')
    }
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!saved || busy || !changed) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const answer = await api.saveProfileDetails({
        hospitalCurrentlyUsing: sentText(hospital), hmoName: sentText(hmo), expectedVersion: saved.rowVersion,
      })
      resource.replace(answer)
      setNotice('Saved.')
      focusAfter(() => document.getElementById('coverage-heading'))
    } catch (cause) {
      if (isHidApiError(cause) && cause.code === 'VERSION_CONFLICT') {
        setError(CONFLICT)
        await resource.reload()
        focusAfter(() => document.getElementById('coverage-heading'))
        return
      }
      setError(isHidApiError(cause) ? cause.message : 'Couldn’t save. Try again.')
      focusAfter(() => document.getElementById('coverage-hospital'))
    } finally { setBusy(false) }
  }

  // A read that failed is said in the heading too: the card's alert is not seen while it is closed.
  return <ProfileSection id="coverage" title="Coverage" state={resource.error ? 'Could not load' : null} busy={resource.loading}
    headingRef={heading} headingId="coverage-heading">
    <p className="patient-field-hint">Your hospital and your health insurance (HMO).</p>
    {resource.error && <div role="alert"><p>{resource.error}</p>
      <button ref={retryFocus.button} type="button" onClick={() => retryFocus.retry(resource.reload)}>Try again <ItemName>loading your coverage details</ItemName></button></div>}
    {error && <p id="coverage-error" role="alert" className="patient-inline-error">{error}</p>}
    <div role="status">{notice && <p className="patient-inline-success">{notice}</p>}</div>
    {saved && <form className="patient-form" onSubmit={event => void save(event)}>
      <div className="patient-field"><label htmlFor="coverage-hospital">Hospital you use now</label>
        <HospitalPicker id="coverage-hospital" value={hospital} maxLength={COVERAGE_TEXT_LIMIT}
          onChange={value => { setHospital(oneLine(value).slice(0, COVERAGE_TEXT_LIMIT)); setNotice(null) }}
          describedBy={describedBy('coverage-hospital-hint', error && 'coverage-error')} /></div>
      <p id="coverage-hospital-hint" className="patient-field-hint">Start typing, then pick it from the list or type the full name.</p>
      <label>HMO name<input id="coverage-hmo" autoComplete="off" maxLength={COVERAGE_TEXT_LIMIT} value={hmo}
        onChange={event => { setHmo(oneLine(event.target.value).slice(0, COVERAGE_TEXT_LIMIT)); setNotice(null) }}
        aria-describedby={describedBy('coverage-hmo-hint', error && 'coverage-error')} /></label>
      <p id="coverage-hmo-hint" className="patient-field-hint">Leave empty if you have none.</p>
      <button type="submit" className="patient-primary-button" disabled={busy || !changed}>{busy ? 'Saving…' : 'Save coverage'}</button>
    </form>}
  </ProfileSection>
}
