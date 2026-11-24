import { Search } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { Button, Field, Input } from '../../../kasuwa/ui'
import { staffApi } from '../../../staff/api'
import type { PatientSearchAnswer, PatientSearchCard } from '../../../staff/patientSearch'
import { SearchCardFacts } from '../patients/SearchCards'
import { noCardText, searchRefusal, today } from '../patients/searchWords'
import { REASON_MIN } from './access'

export const EMERGENCY_SEARCH_NAMES = 'Enter their first name, last name and date of birth, exactly as registered.'
export const CHOOSE_PATIENT = 'Search, then confirm the patient.'
/**
 * Said before the search runs. True of 0132: each patient an emergency search finds gets an
 * identity.patient.emergency-search.shown row, which their own access history lists as found_in_emergency_search with
 * this facility's name (owner Q104 of 18 November 2026).
 */
export const SEARCH_SEEN_BY_PATIENTS = 'Everyone this search finds will see it in their access history, with this facility’s name.'
/**
 * More than one card (Ola, clinical owner, review of health#307): cards with the same exact name and date of birth
 * differ only by sex, the Health ID's last four or the NIN status, and in an emergency the patient often can't confirm
 * which is theirs, so none of them is offered: choosing would be a guess, and another person's emergency summary could
 * be used for treatment.
 */
export const SEVERAL_MATCH = 'More than one person has this name and date of birth, so their records can’t be opened safely from this search. Use the patient’s Health ID if anyone has it.'
/** The one card is never chosen for the clinician: they tick this, unticked to begin with, before Open is enabled. */
export const CONFIRM_PATIENT = 'This is the patient in front of me'

/**
 * The emergency search (hid-system 0132, ID-3b) inside Emergency access: the reason first (the form's own reason
 * field, above this), then the exact first name, last name and date of birth. `POST identity/patient-search/emergency`
 * with the emergency purpose; at most 5 cards. A card gives no access: confirming one only names the patient for
 * break-glass, which sends the card's matchRef with the reason (ID-5).
 *
 * Only an answer with exactly one card can lead anywhere: that card is shown with the patient's name, sex, date of birth
 * with age and the Health ID's last four, and is `chosen` only while "This is the patient in front of me" is ticked.
 * With more than one card, nothing is offered (SEVERAL_MATCH). The answer is held by the form (`answer`, `onAnswer`),
 * so a refused opening can clear it.
 *
 * `onReasonMissing` is called, and nothing is sent, while the reason is under 8 characters: the search itself needs it.
 */
export function EmergencyNameSearch({ idBase, facilityId, reason, onReasonMissing, answer, onAnswer, chosen, onChoose, problem }: {
  idBase: string
  facilityId: string | undefined
  reason: string
  onReasonMissing: () => void
  answer: PatientSearchAnswer | null
  onAnswer: (answer: PatientSearchAnswer | null) => void
  /** The one card, once confirmed as the patient in front of the clinician; null otherwise. */
  chosen: PatientSearchCard | null
  onChoose: (card: PatientSearchCard | null) => void
  /** Why the form could not be sent for the patient (none confirmed). */
  problem: ReactNode
}) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [namesProblem, setNamesProblem] = useState('')
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const sending = useRef(false)
  const fieldId = (name: string) => `${idBase}-${name}`

  async function search() {
    if (sending.current || !facilityId) return
    setError('')
    if (reason.trim().length < REASON_MIN) {
      onReasonMissing()
      return
    }
    if (!firstName.trim() || !lastName.trim() || !dateOfBirth) {
      setNamesProblem(EMERGENCY_SEARCH_NAMES)
      document.getElementById(fieldId(!firstName.trim() ? 'firstName' : !lastName.trim() ? 'lastName' : 'dateOfBirth'))?.focus()
      return
    }
    setNamesProblem('')
    sending.current = true
    setSearching(true)
    onChoose(null)
    onAnswer(null)
    try {
      // Nothing is chosen for the clinician: one card waits for them to confirm it; more are never offered.
      onAnswer(await staffApi.emergencySearchPatients(facilityId, { firstName, lastName, dateOfBirth, reason }))
    } catch (caught) {
      onAnswer(null)
      setError(searchRefusal(caught, true))
    } finally {
      sending.current = false
      setSearching(false)
    }
  }

  const changed = () => { setNamesProblem(''); setError('') }
  const cards = answer?.patients ?? []
  const single = cards.length === 1 ? cards[0]! : null
  const confirmId = fieldId('patient-confirm')

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 @xl:grid-cols-3">
        <Field label="First name" htmlFor={fieldId('firstName')}>
          <Input id={fieldId('firstName')} autoComplete="off" maxLength={100} value={firstName} aria-describedby={namesProblem ? fieldId('names-error') : undefined}
            onChange={event => { setFirstName(event.target.value); changed() }}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void search() } }} />
        </Field>
        <Field label="Last name" htmlFor={fieldId('lastName')}>
          <Input id={fieldId('lastName')} autoComplete="off" maxLength={100} value={lastName} aria-describedby={namesProblem ? fieldId('names-error') : undefined}
            onChange={event => { setLastName(event.target.value); changed() }}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void search() } }} />
        </Field>
        <Field label="Date of birth" htmlFor={fieldId('dateOfBirth')}>
          <Input id={fieldId('dateOfBirth')} type="date" max={today()} value={dateOfBirth} aria-describedby={namesProblem ? fieldId('names-error') : undefined}
            onChange={event => { setDateOfBirth(event.target.value); changed() }}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void search() } }} />
        </Field>
      </div>
      {namesProblem ? <p id={fieldId('names-error')} role="alert" className="m-0 text-xs font-medium text-danger-ink">{namesProblem}</p> : null}
      <p className="m-0 text-[13px] text-ink-2">{SEARCH_SEEN_BY_PATIENTS}</p>
      <div>
        {/* Busy, it stays focusable (aria-disabled, not disabled); a second press sends nothing. */}
        <Button icon={Search} disabled={!facilityId} aria-busy={searching || undefined} aria-disabled={searching || undefined}
          onClick={() => void search()}>{searching ? 'Searching…' : 'Search'}</Button>
      </div>
      <div role="status" className="empty:hidden">
        {error ? <p className="m-0 text-[13px] font-medium text-danger-ink">{error}</p> : null}
        {answer && cards.length === 0 ? <p className="m-0 text-[13px] text-ink-2">{noCardText(answer)}</p> : null}
        {cards.length > 1 ? <p className="m-0 text-[13px] font-medium text-danger-ink">{SEVERAL_MATCH}</p> : null}
      </div>
      {/* Focused when the form is sent without the patient confirmed, so what is missing is said there. */}
      <fieldset id={fieldId('patient')} tabIndex={-1} className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0 outline-none empty:hidden"
        aria-describedby={problem ? fieldId('patient-error') : undefined}>
        {single ? <legend className="mb-2 p-0 text-[13px] font-medium text-ink-2">Patient found</legend> : null}
        {single ? <div key={single.matchRef} className="flex flex-col gap-3 rounded-xl bg-surface p-4 ring-1 ring-line">
          <SearchCardFacts card={single} withAge />
          <label htmlFor={confirmId} className="flex cursor-pointer items-start gap-3 text-sm font-medium text-ink">
            <input id={confirmId} type="checkbox" checked={chosen?.matchRef === single.matchRef} className="mt-0.5 size-4 shrink-0 accent-brand-fill"
              onChange={event => onChoose(event.target.checked ? single : null)} />
            <span>{CONFIRM_PATIENT}</span>
          </label>
        </div> : null}
      </fieldset>
      {problem ? <p id={fieldId('patient-error')} className="m-0 text-xs font-medium text-danger-ink">{problem}</p> : null}
    </div>
  )
}
