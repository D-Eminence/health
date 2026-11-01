import { useRef, useState, type FormEvent } from 'react'
import { isHidApiError, plainErrorText } from '@hid/http'
import { useSession } from '../session'
import { describedBy } from '../authSteps'
import { COVERAGE_TEXT_LIMIT, oneLine, sentText, type ProfileDetails } from '../profileParity'
import { HospitalPicker } from './enrollment/HospitalPicker'
import { useActionFocus, useRetryFocus } from './actionFocus'
import { ItemName } from '../ItemName'
import { ProfileSection } from './ProfileSection'
import { Button, Field, Input } from '../kasuwa/ui'
import { WORDS } from '../copy'
import { LoadProblem, Problem, Saved } from './profileParts'

const CHECK_DETAILS = 'Check the details you entered and try again.'

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
 * "Insurance & hospital" (once "Coverage") on the profile (hid-1.0 parity B3): the hospital the patient uses now, with the sign-up's hospital
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
      setError(plainErrorText(cause, 'Couldn’t save. Try again.', { statuses: { 400: CHECK_DETAILS, 422: CHECK_DETAILS } }))
      focusAfter(() => document.getElementById('coverage-hospital'))
    } finally { setBusy(false) }
  }

  // A read that failed is said in the heading too: the card's alert is not seen while it is closed.
  return <ProfileSection id="coverage" title={WORDS.insurance} state={resource.error ? 'Could not load' : null} busy={resource.loading}
    headingRef={heading} headingId="coverage-heading">
    {resource.error && <LoadProblem what="these details" error={resource.error} buttonRef={retryFocus.button}
      onRetry={() => retryFocus.retry(resource.reload)} name={<ItemName>loading your insurance and hospital</ItemName>} />}
    <Saved>{notice}</Saved>
    {saved && <form className="flex flex-col gap-4" onSubmit={event => void save(event)}>
      <Field label="Hospital you use now" htmlFor="coverage-hospital" hintId="coverage-hospital-hint" hint="Start typing, then pick it from the list.">
        <HospitalPicker id="coverage-hospital" value={hospital} maxLength={COVERAGE_TEXT_LIMIT}
          onChange={value => { setHospital(oneLine(value).slice(0, COVERAGE_TEXT_LIMIT)); setNotice(null) }}
          describedBy={describedBy('coverage-hospital-hint', error && 'coverage-error')} />
      </Field>
      <Field label="HMO (health insurance)" htmlFor="coverage-hmo" optional hintId="coverage-hmo-hint" hint="Leave empty if you have none.">
        <Input id="coverage-hmo" autoComplete="off" maxLength={COVERAGE_TEXT_LIMIT} value={hmo}
          onChange={event => { setHmo(oneLine(event.target.value).slice(0, COVERAGE_TEXT_LIMIT)); setNotice(null) }}
          aria-describedby={describedBy('coverage-hmo-hint', error && 'coverage-error')} />
      </Field>
      {error && <Problem id="coverage-error">{error}</Problem>}
      <Button type="submit" variant="primary" className="self-start" loading={busy} disabled={busy || !changed}>{busy ? 'Saving…' : 'Save'}</Button>
    </form>}
  </ProfileSection>
}
