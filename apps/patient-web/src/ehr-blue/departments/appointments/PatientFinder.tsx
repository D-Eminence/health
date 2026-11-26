import { useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { EhrBadge, EhrButton, EhrField, EhrInput } from '@hid/ui/ehr'
import { staffApi } from '../../../staff/api'
import { ninStatusLabel, type PatientSearchCard } from '../../../staff/patientSearch'
import { useFocusById } from '../../../staff/focus'
import { noCardText, searchRefusal } from '../../clinical/patients/searchWords'
import { DeptNotice } from '../parts/DeptNotice'
import { birthDateText, countText } from '../parts/format'
import { EMPTY_SEARCH, SEARCH_EMPTY, SEARCH_HINT, searchKeys, sexText, type SearchValues } from '../waiting/waitingRules'
import { healthIdEnding } from './appointmentRules'

/**
 * A staff patient search (hid-system 0132) for Appointments: by name, date of birth, phone or Health ID, every key in the
 * request body, never an address. Each card it finds stands for the patient by its matchRef for 10 minutes; the page
 * sends that, never a Health ID. The keys and the cards stay in this component's state only.
 */
export function PatientFinder({ facilityId, idPrefix, actionLabel, busyRef, notice, onPick }: {
  readonly facilityId: string
  /** Unique per page: the fields' ids. */
  readonly idPrefix: string
  /** The button on each card ("Choose", "Check in"). */
  readonly actionLabel: string
  /** The matchRef being sent, if any: its button shows busy. */
  readonly busyRef?: string | null
  /** Said above the fields (why a search is needed). */
  readonly notice?: string
  readonly onPick: (card: PatientSearchCard) => void
}) {
  const [values, setValues] = useState<SearchValues>(EMPTY_SEARCH)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [said, setSaid] = useState<string | null>(null)
  const [cards, setCards] = useState<readonly PatientSearchCard[]>([])
  const focus = useFocusById()
  const first = `${idPrefix}-first-name`

  function change(next: Partial<SearchValues>) { setValues(previous => ({ ...previous, ...next })) }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const keys = searchKeys(values)
    setError(''); setSaid(null)
    if (!keys) { setError(SEARCH_EMPTY); focus(first); return }
    setBusy(true)
    try {
      const answer = await staffApi.searchPatients(facilityId, keys)
      const found = answer.outcome === 'found' ? answer.patients : []
      setCards(found)
      setSaid(found.length === 0 ? noCardText(answer) : null)
      focus(found.length > 0 ? `${idPrefix}-results-title` : `${idPrefix}-said`)
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      setCards([])
      setError(isHidApiError(caught) && caught.status === 403
        ? 'Your role at this facility can’t search for patients. Ask the front desk.'
        : isHidApiError(caught) && caught.status === 404 ? 'Patient search is not available yet. Try again later.' : searchRefusal(caught))
    } finally { setBusy(false) }
  }

  return (
    <div className="hid-ehr-dept-appointments-finder">
      <form className="hid-ehr-dept-form" noValidate onSubmit={event => void search(event)} aria-label="Find the patient">
        {notice ? <DeptNotice tone="info" role="status">{notice}</DeptNotice> : null}
        <p className="hid-ehr-dept-appointments-hint">{SEARCH_HINT}</p>
        <div className="hid-ehr-dept-form-grid">
          <EhrField label="First name" controlId={first}>
            <EhrInput value={values.firstName} onChange={event => change({ firstName: event.target.value })} maxLength={100}
              autoComplete="off" spellCheck={false} />
          </EhrField>
          <EhrField label="Last name" controlId={`${idPrefix}-last-name`}>
            <EhrInput value={values.lastName} onChange={event => change({ lastName: event.target.value })} maxLength={100}
              autoComplete="off" spellCheck={false} />
          </EhrField>
          <EhrField label="Date of birth" controlId={`${idPrefix}-date-of-birth`}>
            <EhrInput type="date" value={values.dateOfBirth} onChange={event => change({ dateOfBirth: event.target.value })} autoComplete="off" />
          </EhrField>
          <EhrField label="Phone number" controlId={`${idPrefix}-phone`}>
            <EhrInput type="tel" value={values.phone} onChange={event => change({ phone: event.target.value })} maxLength={24} autoComplete="off" />
          </EhrField>
          <EhrField label="Health ID" controlId={`${idPrefix}-health-id`} hint="It starts with HID-.">
            <EhrInput value={values.healthId} onChange={event => change({ healthId: event.target.value })} maxLength={36}
              autoComplete="off" autoCapitalize="characters" spellCheck={false} />
          </EhrField>
        </div>
        {error ? <DeptNotice role="alert" tone="critical">{error}</DeptNotice> : null}
        <div className="hid-ehr-dept-form-actions">
          <EhrButton type="submit" busy={busy}>Find patient</EhrButton>
        </div>
      </form>

      {said ? <p id={`${idPrefix}-said`} tabIndex={-1} role="status" className="hid-ehr-state-message">{said}</p> : null}
      {cards.length > 0 ? (
        <div className="hid-ehr-dept-appointments-results">
          <h3 id={`${idPrefix}-results-title`} tabIndex={-1}>{countText(cards.length, 'patient')} found</h3>
          <ul className="hid-ehr-dept-appointments-list" aria-labelledby={`${idPrefix}-results-title`}>
            {cards.map((card, index) => {
              // By its place in the answer: the matchRef stays out of the page's markup.
              const headingId = `${idPrefix}-found-${index}`
              const about = [sexText(card.sex), card.dateOfBirth ? `Born ${birthDateText(card.dateOfBirth)}` : ''].filter(Boolean).join(' · ')
              return (
                <li key={card.matchRef} className="hid-ehr-dept-appointments-card" aria-labelledby={headingId}>
                  <div className="hid-ehr-dept-appointments-main">
                    <h4 id={headingId} className="hid-ehr-dept-appointments-name">{card.fullName}</h4>
                    <p className="hid-ehr-dept-appointments-identity">
                      {about ? <span>{about}</span> : null}
                      {card.healthIdLast4 ? <span aria-label={`Health ID ending ${card.healthIdLast4}`}>{healthIdEnding(card.healthIdLast4)}</span> : null}
                    </p>
                    <EhrBadge tone={card.ninStatus === 'verified' ? 'positive' : 'neutral'}>{ninStatusLabel(card.ninStatus)}</EhrBadge>
                  </div>
                  <div className="hid-ehr-dept-appointments-actions">
                    <EhrButton size="sm" busy={busyRef === card.matchRef} aria-label={`${actionLabel} ${card.fullName}`}
                      onClick={() => onPick(card)}>{actionLabel}</EhrButton>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
