import { Search } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { Button, Field, Input, cx } from '../../../kasuwa/ui'
import { staffApi } from '../../../staff/api'
import type { PatientSearchAnswer, PatientSearchCard } from '../../../staff/patientSearch'
import { SearchCardFacts } from '../patients/SearchCards'
import { noCardText, searchRefusal, today } from '../patients/searchWords'
import { REASON_MIN } from './access'

export const EMERGENCY_SEARCH_NAMES = 'Enter their first name, last name and date of birth, exactly as registered.'
export const CHOOSE_PATIENT = 'Search, then choose the patient.'

/**
 * The emergency search (hid-system 0132, ID-3b) inside Emergency access: the reason first (the form's own reason
 * field, above this), then the exact first name, last name and date of birth. `POST identity/patient-search/emergency`
 * with the emergency purpose; at most 5 cards. A card gives no access: choosing one only names the patient for
 * break-glass, which sends the card's matchRef with the reason (ID-5).
 *
 * `onReasonMissing` is called, and nothing is sent, while the reason is under 8 characters: the search itself needs it.
 */
export function EmergencyNameSearch({ idBase, facilityId, reason, onReasonMissing, chosen, onChoose, problem }: {
  idBase: string
  facilityId: string | undefined
  reason: string
  onReasonMissing: () => void
  chosen: PatientSearchCard | null
  onChoose: (card: PatientSearchCard | null) => void
  /** Why the form could not be sent for the patient (none chosen, or the card expired). */
  problem: ReactNode
}) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [namesProblem, setNamesProblem] = useState('')
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [answer, setAnswer] = useState<PatientSearchAnswer | null>(null)
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
    try {
      const found = await staffApi.emergencySearchPatients(facilityId, { firstName, lastName, dateOfBirth, reason })
      setAnswer(found)
      // One match is chosen for the clinician; more are for them to tell apart.
      if (found.patients.length === 1) onChoose(found.patients[0]!)
    } catch (caught) {
      setAnswer(null)
      setError(searchRefusal(caught, true))
    } finally {
      sending.current = false
      setSearching(false)
    }
  }

  const changed = () => { setNamesProblem(''); setError('') }
  const cards = answer?.patients ?? []

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
      <div>
        {/* Busy, it stays focusable (aria-disabled, not disabled); a second press sends nothing. */}
        <Button icon={Search} disabled={!facilityId} aria-busy={searching || undefined} aria-disabled={searching || undefined}
          onClick={() => void search()}>{searching ? 'Searching…' : 'Search'}</Button>
      </div>
      <div role="status" className="empty:hidden">
        {error ? <p className="m-0 text-[13px] font-medium text-danger-ink">{error}</p> : null}
        {answer && cards.length === 0 ? <p className="m-0 text-[13px] text-ink-2">{noCardText(answer)}</p> : null}
        {cards.length > 1 ? <p className="m-0 text-[13px] text-ink-3">{`${cards.length} people match. Choose the patient in front of you.`}</p> : null}
      </div>
      {/* Focused when the form is sent without a patient chosen, so what is missing is said there. */}
      <fieldset id={fieldId('patient')} tabIndex={-1} className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0 outline-none empty:hidden"
        aria-describedby={problem ? fieldId('patient-error') : undefined}>
        {cards.length > 0 ? <legend className="mb-2 p-0 text-[13px] font-medium text-ink-2">Patient</legend> : null}
        {cards.map(card => {
          const selected = chosen?.matchRef === card.matchRef
          return (
            <label key={card.matchRef} className={cx('flex cursor-pointer items-center gap-3 rounded-xl p-4 ring-1',
              selected ? 'bg-brand-soft ring-brand-line' : 'bg-surface ring-line')}>
              <input type="radio" name={fieldId('patient-choice')} checked={selected} className="size-4 shrink-0 accent-brand-fill"
                onChange={() => onChoose(card)} />
              <SearchCardFacts card={card} />
            </label>
          )
        })}
      </fieldset>
      {problem ? <p id={fieldId('patient-error')} className="m-0 text-xs font-medium text-danger-ink">{problem}</p> : null}
    </div>
  )
}
