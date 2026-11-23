import { HEALTH_ID_PREFIX, isBlankHealthIdInput, normalizeHealthIdInput } from '@hid/contracts'
import { ArrowRight, Search, UserPlus, UserSearch } from 'lucide-react'
import { useId, useRef, useState, type FormEvent } from 'react'
import { Button, Card, CardHeader, Field, Input } from '../../../kasuwa/ui'
import { staffApi } from '../../../staff/api'
import type { PatientSearchAnswer, PatientSearchCard } from '../../../staff/patientSearch'
import { HID_FORMAT, healthIdProblem } from '../consent/access'
import { SearchCardFacts } from './SearchCards'
import { noCardText, searchRefusal, today } from './searchWords'

export const NAME_SEARCH_TITLE = 'Search by name'
export const NAME_SEARCH_DESCRIPTION = 'No Health ID card? Search with their first name, last name and date of birth. Add their phone or Health ID if you have it.'
export const NAME_SEARCH_EMPTY = 'Enter their first name, last name and date of birth.'

/** What opening a card asks for when the search had no Health ID: the card never carries the full one. */
export function askHealthIdHint(card: PatientSearchCard): string {
  return card.healthIdLast4 ? `Ask to see their Health ID card. It ends in ${card.healthIdLast4}.` : 'Ask to see their Health ID card.'
}

export function healthIdDoesNotMatch(card: PatientSearchCard): string {
  return `This Health ID doesn’t end in ${card.healthIdLast4 ?? ''}. Check it with the patient.`
}

/**
 * Find a patient's search by name (hid-system 0132, ID-3a): first name, last name and date of birth, with the phone or
 * the Health ID if the desk has it. `POST identity/patient-search` in direct care, the keys in the body. Each card shows
 * the full name, sex, date of birth, the Health ID's last four and the NIN status; the card's matchRef is kept, never a
 * Health ID.
 *
 * Opening a card goes through today's lookup (`onOpen` with a Health ID), so every way in stays the same: an allowed
 * patient opens, a refused one is offered the Access PIN, asking the patient, emergency access and, for doctors, nurses
 * and clinicians, "Open as this facility’s patient". Identity has no route that opens a patient by a direct-care
 * matchRef, so a card opens with the Health ID typed in the search, or else with the Health ID read from the patient's
 * card, checked against the card's last four first.
 */
export function NameSearchCard({ facilityId, registers, busy, onOpen }: {
  facilityId: string | undefined; registers: boolean; busy: boolean; onOpen: (hid: string) => void
}) {
  const id = useId()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [phone, setPhone] = useState('')
  const [healthId, setHealthId] = useState(HEALTH_ID_PREFIX)
  const [problem, setProblem] = useState<{ field: 'form' | 'healthId'; message: string } | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [answer, setAnswer] = useState<PatientSearchAnswer | null>(null)
  // The complete Health ID the shown answer was searched with: every key must match, so it is each card's.
  const [searchedHid, setSearchedHid] = useState<string | null>(null)
  const sending = useRef(false)

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending.current || !facilityId) return
    setError('')
    const normalizedHid = normalizeHealthIdInput(healthId)
    const hidGiven = !isBlankHealthIdInput(normalizedHid)
    if (!firstName.trim() && !lastName.trim() && !dateOfBirth && !phone.trim() && !hidGiven) {
      setProblem({ field: 'form', message: NAME_SEARCH_EMPTY })
      return
    }
    const hidProblem = hidGiven ? healthIdProblem(normalizedHid) : null
    if (hidProblem) {
      setProblem({ field: 'healthId', message: hidProblem })
      document.getElementById(`${id}-healthId`)?.focus()
      return
    }
    setProblem(null)
    sending.current = true
    setSearching(true)
    try {
      const found = await staffApi.searchPatients(facilityId, { firstName, lastName, dateOfBirth, phone, healthId: hidGiven ? normalizedHid : undefined })
      setAnswer(found)
      setSearchedHid(hidGiven ? normalizedHid : null)
    } catch (caught) {
      setAnswer(null)
      setError(searchRefusal(caught))
    } finally {
      sending.current = false
      setSearching(false)
    }
  }

  const changed = () => { setProblem(null); setError('') }
  const empty = answer !== null && answer.patients.length === 0
  const offerRegister = registers && empty && (answer.outcome === 'no_match' || answer.outcome === 'no_such_patient')
  const formProblemId = `${id}-problem`

  return (
    <Card aria-labelledby={`${id}-title`}>
      <CardHeader titleId={`${id}-title`} title={NAME_SEARCH_TITLE} description={NAME_SEARCH_DESCRIPTION} icon={UserSearch} iconTone="brand" as="h2" />
      <form noValidate className="flex flex-col gap-4 px-5 pb-5" onSubmit={event => void search(event)} aria-describedby={problem?.field === 'form' ? formProblemId : undefined}>
        <div className="grid gap-4 @xl:grid-cols-2">
          <Field label="First name" htmlFor={`${id}-firstName`}>
            <Input id={`${id}-firstName`} autoComplete="off" value={firstName} maxLength={100} onChange={event => { setFirstName(event.target.value); changed() }} />
          </Field>
          <Field label="Last name" htmlFor={`${id}-lastName`}>
            <Input id={`${id}-lastName`} autoComplete="off" value={lastName} maxLength={100} onChange={event => { setLastName(event.target.value); changed() }} />
          </Field>
          <Field label="Date of birth" htmlFor={`${id}-dateOfBirth`}>
            <Input id={`${id}-dateOfBirth`} type="date" max={today()} value={dateOfBirth} onChange={event => { setDateOfBirth(event.target.value); changed() }} />
          </Field>
          <Field label="Phone" optional htmlFor={`${id}-phone`} hint="With its country code, or a Nigerian number starting with 0." hintId={`${id}-phone-hint`}>
            <Input id={`${id}-phone`} type="tel" autoComplete="off" value={phone} maxLength={24} aria-describedby={`${id}-phone-hint`}
              onChange={event => { setPhone(event.target.value); changed() }} />
          </Field>
          <Field label="Health ID" optional htmlFor={`${id}-healthId`} hint={HID_FORMAT} hintId={`${id}-healthId-hint`}
            error={problem?.field === 'healthId' ? problem.message : undefined} errorId={`${id}-healthId-error`}>
            <Input id={`${id}-healthId`} autoComplete="off" spellCheck={false} value={healthId} placeholder="HID-ADA2345"
              className="font-medium tracking-[.06em] uppercase" aria-invalid={problem?.field === 'healthId' ? true : undefined}
              aria-describedby={problem?.field === 'healthId' ? `${id}-healthId-error` : `${id}-healthId-hint`}
              onChange={event => { setHealthId(normalizeHealthIdInput(event.target.value)); changed() }} />
          </Field>
        </div>
        {problem?.field === 'form' ? <p id={formProblemId} role="alert" className="m-0 text-[13px] font-medium text-danger-ink">{problem.message}</p> : null}
        <div>
          {/* Busy, it stays focusable (aria-disabled, not disabled); a second press sends nothing. */}
          <Button type="submit" variant="primary" icon={Search} disabled={!facilityId} aria-busy={searching || undefined}
            aria-disabled={searching || undefined}>{searching ? 'Searching…' : 'Search'}</Button>
        </div>
      </form>

      <div role="status" className="empty:hidden">
        {error ? <p className="m-0 border-t border-line px-5 py-3 text-[13px] font-medium text-danger-ink">{error}</p> : null}
        {empty ? <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
          <p className="m-0 min-w-0 flex-[1_1_16rem] text-[13px] text-ink-2">{noCardText(answer)}</p>
          {offerRegister ? <Button variant="primary" icon={UserPlus} to="/provider/registration">Register a new patient</Button> : null}
        </div> : null}
        {answer && answer.patients.length > 0 ? <p className="m-0 border-t border-line px-5 pt-3 text-[13px] text-ink-3">
          {answer.patients.length === 1 ? '1 patient matches.' : `${answer.patients.length} patients match.`}</p> : null}
      </div>
      {answer && answer.patients.length > 0 ? <ul aria-label="Patients found" className="m-0 flex list-none flex-col gap-2 p-5 pt-3">
        {answer.patients.map(card => <FoundPatient key={card.matchRef} card={card} searchedHid={searchedHid} busy={busy} onOpen={onOpen} />)}
      </ul> : null}
    </Card>
  )
}

/**
 * One card. Open goes straight to today's lookup with the Health ID the search was made with; otherwise it first asks
 * for the Health ID from the patient's card, which must end in the card's last four.
 */
function FoundPatient({ card, searchedHid, busy, onOpen }: {
  card: PatientSearchCard; searchedHid: string | null; busy: boolean; onOpen: (hid: string) => void
}) {
  const id = useId()
  const [asking, setAsking] = useState(false)
  const [hid, setHid] = useState(HEALTH_ID_PREFIX)
  const [problem, setProblem] = useState('')

  function open() {
    if (busy) return
    if (searchedHid) onOpen(searchedHid)
    else setAsking(true)
  }

  function openWithHealthId(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const normalized = normalizeHealthIdInput(hid)
    const refusal = healthIdProblem(normalized)
      ?? (card.healthIdLast4 && !normalized.endsWith(card.healthIdLast4) ? healthIdDoesNotMatch(card) : null)
    if (refusal) {
      setProblem(refusal)
      return
    }
    setProblem('')
    onOpen(normalized)
  }

  return (
    <li className="flex flex-col gap-3 rounded-xl bg-surface p-4 ring-1 ring-line">
      <div className="flex flex-wrap items-center gap-3">
        <SearchCardFacts card={card} nameId={`${id}-name`} />
        {asking ? null : <Button iconRight={ArrowRight} aria-describedby={`${id}-name`} aria-disabled={busy || undefined} onClick={open}>Open</Button>}
      </div>
      {asking ? <form noValidate className="flex flex-col gap-2" onSubmit={openWithHealthId}>
        <Field label={`${card.fullName}’s Health ID`} htmlFor={`${id}-hid`} hint={askHealthIdHint(card)} hintId={`${id}-hid-hint`}
          error={problem ? <span role="alert">{problem}</span> : undefined} errorId={`${id}-hid-error`}>
          <div className="flex gap-2">
            <div className="min-w-0 flex-1"><Input id={`${id}-hid`} autoFocus autoComplete="off" spellCheck={false} value={hid} placeholder="HID-ADA2345"
              className="font-medium tracking-[.06em] uppercase" aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `${id}-hid-error` : `${id}-hid-hint`}
              onChange={event => { setHid(normalizeHealthIdInput(event.target.value)); setProblem('') }} /></div>
            <Button type="submit" variant="primary" iconRight={ArrowRight} aria-busy={busy || undefined} aria-disabled={busy || undefined}>Open</Button>
          </div>
        </Field>
      </form> : null}
    </li>
  )
}
