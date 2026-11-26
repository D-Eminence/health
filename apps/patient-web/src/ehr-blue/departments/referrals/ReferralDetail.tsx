import { useCallback, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { EhrButton, EhrField, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import {
  REFERRAL_DECLINE_REASONS, REFERRAL_WITHDRAW_REASONS, referralsApi, type ReferralCard, type ReferralDeclineReason,
  type ReferralExpected, type ReferralOutcome, type ReferralRead, type ReferralWithdrawReason,
} from '../../../staff/api'
import { useDeptAccess } from '../parts/access'
import { DeptNotice, type DeptNoticeTone } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { useFacilityRead } from '../parts/useFacilityRead'
import { ArrivalPanel } from './ArrivalPanel'
import { useIdempotencyKeys, useStaffNames } from './hooks'
import { PackageView, ReferralBadges, ReferralFacts, packageHiddenText } from './ReferralParts'
import {
  BASE, CONTROL_OFF, DECLINE_REASON_WORDS, LIMITS, REFERRAL_ARRIVE, REFERRAL_RECEIVE, REFERRAL_SEND, RELOAD_AFTER, SEEN_OUTCOMES,
  WITHDRAW_NEEDS_NOTE, WITHDRAW_REASON_WORDS, canArrive, canSearch, historyText, historyWho, learnFrom, lengthProblem, notServed,
  outcomeText, refusalWords, whenText,
} from './referralRules'

/** A read that learns whether referrals are served from its answer. */
function served<T>(read: Promise<T>): Promise<T> {
  return read.then(answer => { learnFrom(); return answer }, (caught: unknown) => { learnFrom(caught); throw caught })
}

/** The list a referral is kept under, for Back. */
function listOf(card: ReferralCard | undefined): string {
  if (!card) return BASE
  if (card.side === 'sent') return `${BASE}/sent`
  return card.state === 'sent' ? `${BASE}/incoming` : `${BASE}/received`
}

type Said = { readonly tone: DeptNoticeTone; readonly text: string }

/**
 * One referral (REF-1 route 7), from either side: its facts as the view level allows, the frozen package when this
 * member may read it, its history, and the steps this facility may take now: withdraw and print at the referring
 * facility; accept, decline, mark arrived and record the outcome at the receiving one. Every step sends the version read
 * and one Idempotency-Key per body; a referral someone else changed meanwhile is read again and said so.
 */
export function ReferralDetail({ facilityId, referralId }: { readonly facilityId: string; readonly referralId: string }) {
  const navigate = useNavigate()
  const { membershipId } = useDeptAccess()
  const loader = useCallback((id: string) => served(referralsApi.read(id, referralId)), [referralId])
  const read = useFacilityRead<ReferralRead>(facilityId, true, loader, 'The referral could not be loaded.')
  const [said, setSaid] = useState<Said | null>(null)
  const value = read.value
  const card = value?.referral
  const names = useStaffNames(facilityId, (value?.history ?? []).map(entry => entry.byMembershipId))
  const { refresh } = read

  const changed = useCallback((next: Said, reload: boolean) => {
    setSaid(next)
    if (reload) void refresh()
  }, [refresh])

  if (read.caught && notServed(read.caught)) return null
  return (
    <DeptPage title={card ? `Referral ${card.reference}` : 'Referral'} className="hid-ehr-dept-referrals"
      onBack={() => navigate(listOf(card))} backLabel="Back to referrals">
      {said ? <DeptNotice role={said.tone === 'critical' ? 'alert' : 'status'} tone={said.tone}>{said.text}</DeptNotice> : null}
      {read.error ? <DeptNotice role="alert" tone="critical">{refusalWords(read.caught, read.error)}</DeptNotice> : null}
      {value === null && read.loading ? <p className="hid-ehr-state-message" role="status">Loading the referral…</p> : null}
      {value && card ? (
        <>
          <DeptSection title="About this referral" headingId="referral-about-title">
            <ReferralBadges card={card} />
            <ReferralFacts card={card} />
          </DeptSection>
          <Steps facilityId={facilityId} card={card} onChanged={changed} />
          <DeptSection title="What was sent" headingId="referral-package-title">
            {value.package ? <PackageView pkg={value.package} />
              : <p className="hid-ehr-state-message">{packageHiddenText(value.packageHidden, card.side)}</p>}
          </DeptSection>
          <DeptSection title="History" headingId="referral-history-title">
            {value.history.length === 0 ? <p className="hid-ehr-state-message">Nothing recorded yet.</p> : (
              <ol className="hid-ehr-dept-referrals-list" aria-labelledby="referral-history-title">
                {value.history.map((entry, index) => (
                  <li key={`${entry.kind}-${entry.at}-${index}`} className="hid-ehr-dept-referrals-line">
                    <span>{historyText(entry)}</span>
                    <span>{historyWho(entry, names, membershipId, card)}</span>
                    <span>{whenText(entry.at)}</span>
                  </li>
                ))}
              </ol>
            )}
          </DeptSection>
        </>
      ) : null}
    </DeptPage>
  )
}

/** The steps this member may take on the referral now; none says nothing. */
function Steps({ facilityId, card, onChanged }: {
  readonly facilityId: string
  readonly card: ReferralCard
  readonly onChanged: (said: Said, reload: boolean) => void
}) {
  const navigate = useNavigate()
  const { permissions } = useDeptAccess()
  const [open, setOpen] = useState<'withdraw' | 'accept' | 'decline' | 'complete' | 'arrive' | null>(null)
  const sending = permissions.includes(REFERRAL_SEND)
  const receiving = permissions.includes(REFERRAL_RECEIVE)
  const sentHere = card.side === 'sent'
  const effective = card.effectiveState

  const withdraw = sentHere && sending && (effective === 'sent' || effective === 'printed')
  const print = sentHere && sending && card.state !== 'withdrawn'
  const accept = !sentHere && receiving && effective === 'sent' && card.viewLevel !== 'metadata'
  const acceptOff = !sentHere && receiving && effective === 'sent' && card.viewLevel === 'metadata'
  const decline = !sentHere && receiving && card.state === 'sent'
  const complete = !sentHere && receiving && (card.state === 'arrived' || card.state === 'accepted')
  const arrival = !sentHere && permissions.includes(REFERRAL_ARRIVE) && canArrive(permissions) && effective === 'accepted'
    && card.patient?.patientId && card.patient.fullName ? expectedOf(card) : null
  if (!withdraw && !print && !accept && !acceptOff && !decline && !complete && !arrival) return null

  function done(text: string) {
    setOpen(null)
    onChanged({ tone: 'positive', text }, true)
  }
  function toggle(which: NonNullable<typeof open>) { setOpen(open === which ? null : which) }

  return (
    <DeptSection title="What you can do" headingId="referral-steps-title">
      {acceptOff ? <DeptNotice tone="caution">{CONTROL_OFF.replace(' You can print a referral letter instead.', '')} You can still decline it.</DeptNotice> : null}
      <div className="hid-ehr-dept-referrals-actions">
        {accept ? <EhrButton aria-expanded={open === 'accept'} onClick={() => toggle('accept')}>Accept</EhrButton> : null}
        {decline ? <EhrButton variant="secondary" aria-expanded={open === 'decline'} onClick={() => toggle('decline')}>Decline</EhrButton> : null}
        {arrival ? <EhrButton aria-expanded={open === 'arrive'} onClick={() => toggle('arrive')}>Patient arrived</EhrButton> : null}
        {complete ? <EhrButton variant={card.state === 'arrived' ? 'primary' : 'secondary'} aria-expanded={open === 'complete'}
          onClick={() => toggle('complete')}>{card.state === 'arrived' ? 'Complete referral' : 'Did not attend'}</EhrButton> : null}
        {print ? <EhrButton variant="secondary" onClick={() => navigate(`${BASE}/${card.referralId}/letter`)}>
          {card.destinationKind === 'printed' ? 'Print letter' : 'Print patient copy'}</EhrButton> : null}
        {withdraw ? <EhrButton variant="secondary" aria-expanded={open === 'withdraw'} onClick={() => toggle('withdraw')}>Withdraw referral</EhrButton> : null}
      </div>
      {open === 'accept' ? <AcceptForm facilityId={facilityId} card={card} onDone={done} onRefused={onChanged} /> : null}
      {open === 'decline' ? <DeclineForm facilityId={facilityId} card={card} onDone={done} onRefused={onChanged} /> : null}
      {open === 'complete' ? <CompleteForm facilityId={facilityId} card={card} onDone={done} onRefused={onChanged} /> : null}
      {open === 'withdraw' ? <WithdrawForm facilityId={facilityId} card={card} onDone={done} onRefused={onChanged} /> : null}
      {open === 'arrive' && arrival ? (
        <ArrivalPanel facilityId={facilityId} item={arrival} canSearch={canSearch(permissions)}
          onArrived={result => done(result.outcome === 'already_on_list'
            ? `${arrival.patient.fullName} is marked arrived. They were already on the waiting list.`
            : `${arrival.patient.fullName} is marked arrived and checked in to the waiting list.`)}
          onStale={() => onChanged({ tone: 'caution', text: 'This referral changed. It has been loaded again.' }, true)} />
      ) : null}
    </DeptSection>
  )
}

/** The arrival's view of an accepted referral read in full. */
function expectedOf(card: ReferralCard): ReferralExpected {
  const patient = card.patient!
  return {
    referralId: card.referralId, reference: card.reference, referringFacilityName: card.referringFacility.name,
    departmentCode: card.departmentCode, serviceWanted: card.serviceWanted, urgency: card.urgency,
    acceptedAt: card.acceptedAt ?? '', arriveBy: card.arriveBy ?? '', rowVersion: card.rowVersion,
    patient: { patientId: patient.patientId!, fullName: patient.fullName!, sex: patient.sex, dateOfBirth: patient.dateOfBirth,
      dateOfBirthEstimated: patient.dateOfBirthEstimated, healthIdLast4: patient.healthIdLast4 },
  }
}

interface StepProps {
  readonly facilityId: string
  readonly card: ReferralCard
  readonly onDone: (text: string) => void
  readonly onRefused: (said: Said, reload: boolean) => void
}

/** Sends one step, saying what the server answered; a stale referral is read again. */
function useStep(onRefused: StepProps['onRefused']) {
  const keyFor = useIdempotencyKeys()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function send<T>(action: string, body: unknown, run: (key: string) => Promise<T>, fallback: string): Promise<T | null> {
    if (busy) return null
    setBusy(true); setError('')
    try {
      const answer = await run(keyFor(action, body))
      learnFrom()
      return answer
    } catch (caught) {
      learnFrom(caught)
      const text = refusalWords(caught, fallback)
      if (isHidApiError(caught) && RELOAD_AFTER.has(caught.code)) onRefused({ tone: 'critical', text }, true)
      else if (text) setError(text)
      return null
    } finally { setBusy(false) }
  }
  return { busy, error, setError, send }
}

function AcceptForm({ facilityId, card, onDone, onRefused }: StepProps) {
  const [note, setNote] = useState('')
  const step = useStep(onRefused)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const problem = note.trim() ? lengthProblem(note, LIMITS.acceptNote, 'the note') : ''
    if (problem) { step.setError(problem); return }
    const body = { expectedRowVersion: card.rowVersion, note: note.trim() }
    const answer = await step.send('accept', body, key => referralsApi.accept(facilityId, card, note.trim(), key),
      'The referral could not be accepted. Try again.')
    if (answer) onDone('Accepted. The referring facility and the patient are told, and the patient shows under Expected arrivals.')
  }
  return (
    <form className="hid-ehr-dept-form" noValidate onSubmit={event => void submit(event)} aria-label="Accept the referral">
      <p className="hid-ehr-dept-referrals-line">Accepting lets your facility read what was sent until 14 days after the referral is completed. It does not open the patient’s chart.</p>
      <EhrField label="Note to the referring facility (optional)" hint="For example, which clinic day to come. At most 500 characters.">
        <EhrTextarea value={note} onChange={event => setNote(event.target.value)} maxLength={LIMITS.acceptNote[1]} rows={3} />
      </EhrField>
      {step.error ? <DeptNotice role="alert" tone="critical">{step.error}</DeptNotice> : null}
      <div className="hid-ehr-dept-form-actions"><EhrButton type="submit" busy={step.busy}>Accept referral</EhrButton></div>
    </form>
  )
}

function DeclineForm({ facilityId, card, onDone, onRefused }: StepProps) {
  const [reason, setReason] = useState<ReferralDeclineReason | ''>('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<{ reason?: string; note?: string }>({})
  const step = useStep(onRefused)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const problems = { reason: reason ? undefined : 'Choose why you are declining.', note: lengthProblem(note, LIMITS.note, 'the note') || undefined }
    setErrors(problems)
    if (!reason || problems.note) return
    const body = { expectedRowVersion: card.rowVersion, reasonCode: reason, note: note.trim() }
    const answer = await step.send('decline', body, key => referralsApi.decline(facilityId, card, { reasonCode: reason, note: note.trim() }, key),
      'The referral could not be declined. Try again.')
    if (answer) onDone('Declined. The referring facility and the patient are told.')
  }
  return (
    <form className="hid-ehr-dept-form" noValidate onSubmit={event => void submit(event)} aria-label="Decline the referral">
      <EhrField label="Why are you declining?" error={errors.reason}>
        <EhrSelect value={reason} onChange={event => setReason(event.target.value as ReferralDeclineReason | '')}>
          <option value="">Choose a reason</option>
          {REFERRAL_DECLINE_REASONS.map(code => <option key={code} value={code}>{DECLINE_REASON_WORDS[code]}</option>)}
        </EhrSelect>
      </EhrField>
      <EhrField label="Note to the referring facility" hint="8 to 500 characters. The referring facility reads it." error={errors.note}>
        <EhrTextarea value={note} onChange={event => setNote(event.target.value)} maxLength={LIMITS.note[1]} rows={3} />
      </EhrField>
      {step.error ? <DeptNotice role="alert" tone="critical">{step.error}</DeptNotice> : null}
      <div className="hid-ehr-dept-form-actions"><EhrButton type="submit" busy={step.busy}>Decline referral</EhrButton></div>
    </form>
  )
}

function CompleteForm({ facilityId, card, onDone, onRefused }: StepProps) {
  // "Did not attend" only before arrival; the other outcomes only after (the server's rule, REFERRAL_OUTCOME_INVALID).
  const choices: readonly ReferralOutcome[] = card.state === 'arrived' ? SEEN_OUTCOMES : ['did_not_attend']
  const [outcome, setOutcome] = useState<ReferralOutcome | ''>(choices.length === 1 ? choices[0]! : '')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<{ outcome?: string; note?: string }>({})
  const step = useStep(onRefused)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const problems = { outcome: outcome ? undefined : 'Choose the outcome.', note: lengthProblem(note, LIMITS.feedback, 'the feedback note', true) || undefined }
    setErrors(problems)
    if (!outcome || problems.note) return
    const body = { expectedRowVersion: card.rowVersion, outcome, feedbackNote: note.trim() }
    const answer = await step.send('complete', body, key => referralsApi.complete(facilityId, card, { outcome, feedbackNote: note.trim() }, key),
      'The outcome could not be saved. Try again.')
    if (answer) onDone('Completed. The referring facility can read the outcome and your feedback.')
  }
  return (
    <form className="hid-ehr-dept-form" noValidate onSubmit={event => void submit(event)} aria-label="Record the outcome">
      <EhrField label="Outcome" error={errors.outcome}>
        <EhrSelect value={outcome} onChange={event => setOutcome(event.target.value as ReferralOutcome | '')}>
          {choices.length > 1 ? <option value="">Choose the outcome</option> : null}
          {choices.map(code => <option key={code} value={code}>{outcomeText(code, true)}</option>)}
        </EhrSelect>
      </EhrField>
      <EhrField label="Feedback to the referring facility" hint="8 to 2,000 characters: what you found and what happens next." error={errors.note}>
        <EhrTextarea value={note} onChange={event => setNote(event.target.value)} maxLength={LIMITS.feedback[1]} rows={5} />
      </EhrField>
      {step.error ? <DeptNotice role="alert" tone="critical">{step.error}</DeptNotice> : null}
      <div className="hid-ehr-dept-form-actions"><EhrButton type="submit" busy={step.busy}>Save outcome</EhrButton></div>
    </form>
  )
}

function WithdrawForm({ facilityId, card, onDone, onRefused }: StepProps) {
  const [reason, setReason] = useState<ReferralWithdrawReason | ''>('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<{ reason?: string; note?: string }>({})
  const step = useStep(onRefused)
  const needsNote = reason !== '' && WITHDRAW_NEEDS_NOTE.has(reason)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const typed = note.trim()
    const noteProblem = needsNote || typed ? lengthProblem(note, LIMITS.note, 'the note') : ''
    const problems = { reason: reason ? undefined : 'Choose why you are withdrawing it.', note: noteProblem || undefined }
    setErrors(problems)
    if (!reason || noteProblem) return
    const body = { expectedRowVersion: card.rowVersion, reasonCode: reason, ...(typed ? { note: typed } : {}) }
    const answer = await step.send('withdraw', body, key => referralsApi.withdraw(facilityId, card, { reasonCode: reason, ...(typed ? { note: typed } : {}) }, key),
      'The referral could not be withdrawn. Try again.')
    if (answer) onDone(card.destinationKind === 'printed'
      ? 'Withdrawn. The record says the printed letter should not be used.'
      : 'Withdrawn. The receiving facility can no longer accept it, and the patient is told.')
  }
  return (
    <form className="hid-ehr-dept-form" noValidate onSubmit={event => void submit(event)} aria-label="Withdraw the referral">
      <EhrField label="Why are you withdrawing it?" error={errors.reason}>
        <EhrSelect value={reason} onChange={event => setReason(event.target.value as ReferralWithdrawReason | '')}>
          <option value="">Choose a reason</option>
          {REFERRAL_WITHDRAW_REASONS.map(code => <option key={code} value={code}>{WITHDRAW_REASON_WORDS[code]}</option>)}
        </EhrSelect>
      </EhrField>
      <EhrField label={needsNote ? 'Note' : 'Note (optional)'} hint={needsNote ? 'Say why in 8 to 500 characters.' : 'At most 500 characters.'} error={errors.note}>
        <EhrTextarea value={note} onChange={event => setNote(event.target.value)} maxLength={LIMITS.note[1]} rows={3} />
      </EhrField>
      {step.error ? <DeptNotice role="alert" tone="critical">{step.error}</DeptNotice> : null}
      <div className="hid-ehr-dept-form-actions"><EhrButton type="submit" busy={step.busy}>Withdraw referral</EhrButton></div>
    </form>
  )
}
