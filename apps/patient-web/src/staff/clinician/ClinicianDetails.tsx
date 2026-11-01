import { useState, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import { Field, Input } from '@hid/ui'
import { describedBy } from '../../authSteps'
import { CLINICIAN_REGULATOR_OF, clinicianApplicationApi, type ClinicianApplicationDetails, type ClinicianFacility,
  type ClinicianProfession } from '../clinicianApplicationApi'
import { PROFESSION_CHOICE, REGULATOR_NAME, SIGNUP_CLOSED_KEPT, codeOf, lagosToday, refusalCopy } from './copy'
import { fieldError, type Problem } from './ui'
import { buttonClass } from '../../kasuwa/ui'

/**
 * The licence and facility of an application (sign-up's "Your details", and
 * applying to another facility from the status page), and the two
 * declarations. Only doctor with MDCN and nurse with NMCN can apply (hid-system
 * ADR-066): the regulator follows the profession and is never typed. The
 * values live in the page's state only, and every change is made to the
 * current value (an updater), so a facility search that answers late never
 * puts back what was changed while it ran.
 */

export interface DetailsValue {
  profession: ClinicianProfession | ''
  licenceNumber: string
  licenceValidUntil: string
  facility: ClinicianFacility | null
  /** The facility search, kept while the page moves between steps. */
  query: string
  results: ClinicianFacility[] | null
}

export const EMPTY_DETAILS: DetailsValue = { profession: '', licenceNumber: '', licenceValidUntil: '', facility: null, query: '', results: null }

export const FIELD = {
  fullName: 'clinician-full-name',
  profession: 'clinician-profession-doctor',
  licenceNumber: 'clinician-licence-number',
  licenceValidUntil: 'clinician-licence-valid-until',
  facility: 'clinician-facility-query',
  accurate: 'clinician-declaration-accurate',
  consent: 'clinician-declaration-consent',
} as const

/** Identity's licence number rule, once upper-cased and single-spaced. */
const LICENCE = /^[A-Z0-9][A-Z0-9/. -]{1,98}[A-Z0-9]$/

/** A licence number as it is typed: capitals, one space between parts. */
export function typedLicence(value: string): string {
  return value.toUpperCase().replace(/\s+/g, ' ').replace(/^ /, '')
}

/** The query Identity searches: one space between words. */
function searchQuery(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

/**
 * A calendar date moved by whole years, then days, in UTC so no time zone
 * shifts it. As Postgres adds an interval of years, a day the target month
 * lacks (29 February) becomes that month's last day.
 */
function shiftDate(value: string, years: number, days = 0): string {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  const lastDay = new Date(Date.UTC(year + years, month, 0)).getUTCDate()
  return new Date(Date.UTC(year + years, month - 1, Math.min(day, lastDay) + days)).toISOString().slice(0, 10)
}

/**
 * The licence dates Identity accepts (P4, P14): after today and no later than
 * today plus five years, both in Lagos, as Identity checks them.
 */
export function licenceDateBounds(now = new Date()) {
  const today = lagosToday(now)
  return { min: shiftDate(today, 0, 1), max: shiftDate(today, 5) }
}

function realDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number) as [number, number, number]
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

/** What the details step refuses before sending, each by its control. */
export function detailsProblems(value: DetailsValue, fullName?: string): Problem[] {
  const problems: Problem[] = []
  if (fullName !== undefined) {
    const name = fullName.trim().replace(/\s+/g, ' ')
    if (name.length < 2 || name.length > 200) problems.push({ field: FIELD.fullName, message: 'Enter your full name as it is on your licence.' })
  }
  if (!value.profession) problems.push({ field: FIELD.profession, message: 'Choose your profession.' })
  const licence = value.licenceNumber.trim()
  if (!licence) problems.push({ field: FIELD.licenceNumber, message: 'Enter your licence or registration number.' })
  else if (!LICENCE.test(licence)) problems.push({ field: FIELD.licenceNumber,
    message: 'Enter the licence number as it is on your licence: letters, numbers, spaces, slashes, dots or hyphens.' })
  const { min, max } = licenceDateBounds()
  if (!realDate(value.licenceValidUntil)) problems.push({ field: FIELD.licenceValidUntil, message: 'Enter the date your licence is valid until.' })
  else if (value.licenceValidUntil < min) problems.push({ field: FIELD.licenceValidUntil, message: 'Your licence must still be valid after today.' })
  else if (value.licenceValidUntil > max) problems.push({ field: FIELD.licenceValidUntil, message: 'Enter a date within the next five years.' })
  if (!value.facility) problems.push({ field: FIELD.facility, message: 'Search for your facility and choose it.' })
  return problems
}

/** The application's licence and facility, as Identity takes them. */
export function applicationDetails(value: DetailsValue): ClinicianApplicationDetails {
  const profession = value.profession as ClinicianProfession
  return {
    profession,
    regulator: CLINICIAN_REGULATOR_OF[profession],
    licenceNumber: value.licenceNumber.trim(),
    licenceValidUntil: value.licenceValidUntil,
    facilityId: value.facility!.facilityId,
    declarations: { accurate: true, verificationConsent: true },
  }
}

export function DetailsFields({ value, onChange, problems, fullName, onFullName, onSearchRefused, searchesUsed, onSearching }: {
  value: DetailsValue
  onChange: Dispatch<SetStateAction<DetailsValue>>
  problems: readonly Problem[]
  /** Sign-up asks for the name too; applying again does not. */
  fullName?: string
  onFullName?(name: string): void
  /** A search refusal the page takes over (the page ended, or intake closed while applying again); true when it did. */
  onSearchRefused(caught: unknown): boolean
  /** What the page says, and offers, once its capability's searches are spent; the rest of the details stay usable. */
  searchesUsed: SearchesUsed
  /** Whether a facility search is running, until its answer, even once the fields are gone. */
  onSearching?(searching: boolean): void
}) {
  const set = (patch: Partial<DetailsValue>) => onChange(current => ({ ...current, ...patch }))
  const regulator = value.profession ? CLINICIAN_REGULATOR_OF[value.profession] : null
  const professionError = fieldError(problems, FIELD.profession)

  return <>
    {fullName !== undefined && onFullName && <Field label="Full name as on your licence" htmlFor={FIELD.fullName}
      error={fieldError(problems, FIELD.fullName)} required>
      <Input id={FIELD.fullName} autoComplete="name" maxLength={200} value={fullName} onChange={event => onFullName(event.target.value)} />
    </Field>}

    <fieldset className="clinician-fieldset" aria-describedby={describedBy(professionError && 'clinician-profession-error', 'clinician-regulator')}>
      <legend>Profession</legend>
      {(['doctor', 'nurse'] as const).map(profession => <label key={profession} className="clinician-choice">
        <input id={`clinician-profession-${profession}`} type="radio" name="clinician-profession" value={profession}
          checked={value.profession === profession} aria-invalid={professionError ? true : undefined}
          onChange={() => set({ profession })} />
        {PROFESSION_CHOICE[profession]}</label>)}
      {professionError && <p id="clinician-profession-error" className="clinician-field-error">{professionError}</p>}
      <p id="clinician-regulator" className="patient-field-hint">
        {regulator ? <>Regulator: <strong>{REGULATOR_NAME[regulator]}</strong>. </> : 'Your regulator follows from your profession. '}
        Other professions can't apply here yet. Ask your facility to contact Health ID.</p>
    </fieldset>

    <Field label="Licence or registration number" htmlFor={FIELD.licenceNumber} error={fieldError(problems, FIELD.licenceNumber)}
      hint="As shown on your current practising licence." required>
      <Input id={FIELD.licenceNumber} autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={100}
        value={value.licenceNumber} onChange={event => set({ licenceNumber: typedLicence(event.target.value) })} />
    </Field>

    <Field label="Licence valid until" htmlFor={FIELD.licenceValidUntil} error={fieldError(problems, FIELD.licenceValidUntil)}
      hint="As shown on your current practising licence." required>
      <Input id={FIELD.licenceValidUntil} type="date" {...licenceDateBounds()} value={value.licenceValidUntil}
        onChange={event => set({ licenceValidUntil: event.target.value })} />
    </Field>

    <FacilitySearch value={value} onChange={onChange} error={fieldError(problems, FIELD.facility)} onRefused={onSearchRefused}
      searchesUsed={searchesUsed} onSearching={onSearching} />
  </>
}

/**
 * A capability's facility searches are spent (hid-system 7cd8038: 429 CLINICIAN_APPLICATION_SEARCH_LIMITED, no
 * Retry-After). They never come back, so the page says how to get new ones, and may offer the control that does.
 */
export interface SearchesUsed { message: string; action?: { label: string; onClick(): void } }

function FacilitySearch({ value, onChange, error, onRefused, searchesUsed, onSearching }: {
  value: DetailsValue; onChange: Dispatch<SetStateAction<DetailsValue>>; error?: string; onRefused(caught: unknown): boolean
  searchesUsed: SearchesUsed; onSearching?(searching: boolean): void
}) {
  const [searching, setSearching] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  // The capability's searches are spent: another search would meet the same refusal, so none is offered.
  const [spent, setSpent] = useState(false)
  // Each answer is announced once, even when the count is the same.
  const [answered, setAnswered] = useState(0)
  const query = searchQuery(value.query)
  const canSearch = query.length >= 3 && query.length <= 80

  async function search() {
    if (searching || spent || !canSearch) return
    setSearching(true)
    onSearching?.(true)
    setRefused(null)
    try {
      const results = await clinicianApplicationApi.searchFacilities(query)
      // Into the details as they are now: the person may have changed them while the search ran.
      onChange(current => ({ ...current, results }))
      setAnswered(count => count + 1)
    } catch (caught) {
      if (onRefused(caught)) return
      if (codeOf(caught) === 'CLINICIAN_APPLICATION_SEARCH_LIMITED') { setSpent(true); return }
      setRefused(codeOf(caught) === 'CLINICIAN_SIGNUP_CLOSED' ? SIGNUP_CLOSED_KEPT
        : refusalCopy(caught, "We couldn't search for facilities right now. Try again.", 'Too many searches. Try again later.'))
    } finally {
      setSearching(false)
      onSearching?.(false)
    }
  }

  function enter(event: KeyboardEvent<HTMLInputElement>) {
    // Enter searches here; it does not send the step.
    if (event.key !== 'Enter') return
    event.preventDefault()
    void search()
  }

  const results = value.results
  const count = results?.length ?? 0
  return <div className="clinician-search">
    <Field label="Your facility" htmlFor={FIELD.facility} error={error}
      hint="Find the facility you work at. Type at least 3 letters of its name." required>
      <Input id={FIELD.facility} type="search" autoComplete="off" maxLength={80} value={value.query}
        onChange={event => { const query = event.target.value; onChange(current => ({ ...current, query })) }} onKeyDown={enter} />
    </Field>
    <button type="button" className={buttonClass({ variant: 'secondary' })} onClick={() => void search()} disabled={searching || spent || !canSearch}>
      {searching ? 'Searching…' : 'Search facilities'}</button>
    <p role="status" className="patient-field-hint">{searching ? 'Searching…' : results === null ? null
      : <span key={answered}>{count === 0 ? 'No facility on Health ID matches that name.' : count === 1 ? '1 facility found.' : `${count} facilities found.`}</span>}</p>
    {refused && <p role="alert" className="patient-inline-error">{refused}</p>}
    {spent && <div className="clinician-search-spent">
      <p role="alert" className="patient-inline-error">{searchesUsed.message}</p>
      {searchesUsed.action && <button type="button" className={buttonClass({ variant: 'secondary' })} onClick={searchesUsed.action.onClick}>
        {searchesUsed.action.label}</button>}
    </div>}
    {value.facility && !results?.some(facility => facility.facilityId === value.facility?.facilityId) &&
      <p className="patient-field-hint">Chosen: <strong>{value.facility.name}</strong> ({value.facility.organizationName})</p>}
    {results && count > 0 && <fieldset className="clinician-fieldset">
      <legend>Choose your facility</legend>
      {results.map(facility => <label key={facility.facilityId} className="clinician-choice">
        <input type="radio" name="clinician-facility" value={facility.facilityId}
          checked={value.facility?.facilityId === facility.facilityId} onChange={() => onChange(current => ({ ...current, facility }))} />
        <span>{facility.name}<small>{facility.organizationName}</small></span></label>)}
    </fieldset>}
    <details className="clinician-help">
      <summary>My facility isn't listed</summary>
      <p>Only facilities already on Health ID are listed. Ask your facility's administrator to set the facility up on Health ID
        first (<Link to="/provider/enroll">facility sign-up</Link>), then search again.</p>
    </details>
  </div>
}

/** The two declarations every application makes; both are required. */
export function Declarations({ accurate, consent, onAccurate, onConsent, regulator, facility, problems }: {
  accurate: boolean; consent: boolean; onAccurate(value: boolean): void; onConsent(value: boolean): void
  regulator: string; facility: string; problems: readonly Problem[]
}) {
  const accurateError = fieldError(problems, FIELD.accurate)
  const consentError = fieldError(problems, FIELD.consent)
  return <fieldset className="clinician-fieldset">
    <legend>Declarations</legend>
    <label className="clinician-choice">
      <input id={FIELD.accurate} type="checkbox" checked={accurate} onChange={event => onAccurate(event.target.checked)}
        aria-invalid={accurateError ? true : undefined} aria-describedby={accurateError ? `${FIELD.accurate}-error` : undefined} />
      The information I've given is accurate, and this licence is mine.</label>
    {accurateError && <p id={`${FIELD.accurate}-error`} className="clinician-field-error">{accurateError}</p>}
    <label className="clinician-choice">
      <input id={FIELD.consent} type="checkbox" checked={consent} onChange={event => onConsent(event.target.checked)}
        aria-invalid={consentError ? true : undefined} aria-describedby={consentError ? `${FIELD.consent}-error` : undefined} />
      Health ID may check my licence with {regulator}, contact me by video call to confirm my identity, and contact {facility} to confirm
      that I work there.</label>
    {consentError && <p id={`${FIELD.consent}-error`} className="clinician-field-error">{consentError}</p>}
  </fieldset>
}

export function declarationProblems(accurate: boolean, consent: boolean): Problem[] {
  return [
    ...accurate ? [] : [{ field: FIELD.accurate, message: 'Confirm that the information is accurate and the licence is yours.' }],
    ...consent ? [] : [{ field: FIELD.consent, message: 'Agree to the licence, identity and employment checks.' }],
  ]
}
