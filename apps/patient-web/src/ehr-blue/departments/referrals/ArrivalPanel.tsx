import { useState, type FormEvent } from 'react'
import { isHidApiError } from '@hid/http'
import { EhrBadge, EhrButton, EhrField, EhrInput } from '@hid/ui/ehr'
import { referralsApi, staffApi, type ReferralArrival, type ReferralExpected } from '../../../staff/api'
import { ninStatusLabel, type PatientSearchCard } from '../../../staff/patientSearch'
import { useFocusById } from '../../../staff/focus'
import { noCardText, searchRefusal } from '../../clinical/patients/searchWords'
import { DeptNotice } from '../parts/DeptNotice'
import { countText } from '../parts/format'
import { EMPTY_SEARCH, SEARCH_EMPTY, SEARCH_HINT, searchKeys, type SearchValues } from '../waiting/waitingRules'
import { useIdempotencyKeys } from './hooks'
import { RELOAD_AFTER, bornText, healthIdEnding, learnFrom, refusalWords, sexText } from './referralRules'

/**
 * "Patient arrived" for an accepted referral (REF-1 route 14), at the front desk or by a clinician: a fresh staff patient
 * search (0132) that names the referral's patient, whose card stands for them by its matchRef for 10 minutes, or, for a
 * patient already this facility's own (0131), their id; the server then checks them in to the waiting list (0135) on the
 * same basis. The referral is never a basis by itself and never opens the chart (Q-REF-9 A, as Q168 A). The search keys
 * and the cards stay in this component's state only; no Health ID leaves it but in the search's own body.
 */
export function ArrivalPanel({ facilityId, item, canSearch, onArrived, onStale }: {
  readonly facilityId: string
  readonly item: ReferralExpected
  readonly canSearch: boolean
  readonly onArrived: (result: ReferralArrival) => void
  /** The referral changed or closed meanwhile: the list is read again. */
  readonly onStale: () => void
}) {
  const idPrefix = `arrive-${item.referralId}`
  const [values, setValues] = useState<SearchValues>(EMPTY_SEARCH)
  const [searching, setSearching] = useState(false)
  const [cards, setCards] = useState<readonly PatientSearchCard[]>([])
  const [said, setSaid] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [sending, setSending] = useState<string | null>(null)
  const keyFor = useIdempotencyKeys()
  const focus = useFocusById()
  const patient = item.patient
  const about = [patient.fullName, sexText(patient.sex), bornText(patient.dateOfBirth, patient.dateOfBirthEstimated),
    patient.healthIdLast4 ? `Health ID ending ${healthIdEnding(patient.healthIdLast4)}` : ''].filter(Boolean).join(', ')

  function change(next: Partial<SearchValues>) { setValues(previous => ({ ...previous, ...next })) }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (searching) return
    const keys = searchKeys(values)
    setError(''); setSaid(null)
    if (!keys) { setError(SEARCH_EMPTY); focus(`${idPrefix}-first-name`); return }
    setSearching(true)
    try {
      const answer = await staffApi.searchPatients(facilityId, keys)
      const found = answer.outcome === 'found' ? answer.patients : []
      setCards(found)
      setSaid(found.length === 0 ? noCardText(answer) : null)
      focus(found.length > 0 ? `${idPrefix}-results` : `${idPrefix}-said`)
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      setCards([])
      setError(isHidApiError(caught) && caught.status === 403 ? 'Your role at this facility can’t search for patients. Ask the front desk.'
        : searchRefusal(caught))
    } finally { setSearching(false) }
  }

  async function arrive(by: { matchRef: string } | { patientId: string }, busyKey: string) {
    if (sending) return
    setSending(busyKey); setError('')
    const body = { expectedRowVersion: item.rowVersion, ...by }
    try {
      const result = await referralsApi.arrive(facilityId, { referralId: item.referralId, rowVersion: item.rowVersion }, by,
        keyFor('arrive', body))
      learnFrom()
      setCards([]); setValues(EMPTY_SEARCH)
      onArrived(result)
    } catch (caught) {
      learnFrom(caught)
      const text = refusalWords(caught, 'The patient could not be marked as arrived. Try again.', true)
      if (!text) return
      setError(text)
      if (isHidApiError(caught) && caught.code === 'REFERRAL_ARRIVAL_NEEDS_SEARCH') { setCards([]); focus(`${idPrefix}-first-name`) }
      if (isHidApiError(caught) && RELOAD_AFTER.has(caught.code)) onStale()
    } finally { setSending(null) }
  }

  return (
    <div className="hid-ehr-dept-referrals-arrival" role="group" aria-label={`Mark ${patient.fullName} arrived`}>
      <p className="hid-ehr-dept-referrals-line">Check that the person in front of you is the patient named on the referral: {about}.</p>
      {canSearch ? (
        <form className="hid-ehr-dept-form" noValidate onSubmit={event => void search(event)} aria-label="Find the referred patient">
          <p className="hid-ehr-dept-referrals-line">Search for the patient first, then mark them arrived. A search result can be used for 10 minutes. {SEARCH_HINT}</p>
          <div className="hid-ehr-dept-form-grid">
            <EhrField label="First name" controlId={`${idPrefix}-first-name`}>
              <EhrInput value={values.firstName} onChange={event => change({ firstName: event.target.value })} maxLength={100} autoComplete="off" spellCheck={false} />
            </EhrField>
            <EhrField label="Last name" controlId={`${idPrefix}-last-name`}>
              <EhrInput value={values.lastName} onChange={event => change({ lastName: event.target.value })} maxLength={100} autoComplete="off" spellCheck={false} />
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
          <div className="hid-ehr-dept-form-actions">
            <EhrButton type="submit" busy={searching}>Find patient</EhrButton>
          </div>
        </form>
      ) : (
        <p className="hid-ehr-dept-referrals-line">Your role at this facility can’t search for patients. Ask the front desk to find the patient first.</p>
      )}
      {error ? <DeptNotice role="alert" tone="critical">{error}</DeptNotice> : null}
      {said ? <p id={`${idPrefix}-said`} tabIndex={-1} role="status" className="hid-ehr-state-message">{said}</p> : null}
      {cards.length > 0 ? (
        <div>
          <h4 id={`${idPrefix}-results`} tabIndex={-1}>{countText(cards.length, 'patient')} found</h4>
          <ul className="hid-ehr-dept-referrals-list" aria-labelledby={`${idPrefix}-results`}>
            {cards.map((card, index) => {
              // By its place in the answer: the matchRef stays out of the page's markup.
              const headingId = `${idPrefix}-found-${index}`
              const facts = [sexText(card.sex), card.dateOfBirth ? bornText(card.dateOfBirth, false) : '',
                card.healthIdLast4 ? healthIdEnding(card.healthIdLast4) : ''].filter(Boolean).join(' · ')
              return (
                <li key={card.matchRef} className="hid-ehr-dept-referrals-card" aria-labelledby={headingId}>
                  <div className="hid-ehr-dept-referrals-main">
                    <h5 id={headingId} className="hid-ehr-dept-referrals-name">{card.fullName}</h5>
                    {facts ? <p className="hid-ehr-dept-referrals-line">{facts}</p> : null}
                    <div className="hid-ehr-dept-referrals-badges">
                      <EhrBadge tone={card.ninStatus === 'verified' ? 'positive' : 'neutral'}>{ninStatusLabel(card.ninStatus)}</EhrBadge>
                    </div>
                  </div>
                  <div className="hid-ehr-dept-referrals-actions">
                    <EhrButton size="sm" busy={sending === `card-${index}`} aria-label={`Mark ${card.fullName} arrived`}
                      onClick={() => void arrive({ matchRef: card.matchRef }, `card-${index}`)}>Mark arrived</EhrButton>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
      <div className="hid-ehr-dept-referrals-actions">
        <EhrButton variant="secondary" size="sm" busy={sending === 'own'} onClick={() => void arrive({ patientId: patient.patientId }, 'own')}>
          Already a patient here: mark arrived
        </EhrButton>
      </div>
    </div>
  )
}
