import { formatDate, formatDateTime } from '@hid/ui/display'
import { useCallback, useRef, useState } from 'react'
import { Share2 } from 'lucide-react'
import { isHidApiError, plainErrorText } from '@hid/http'
import { Button, Card, EmptyState } from '../kasuwa/ui'
import { ConfirmSheet, LoadingRows } from '../kasuwa/parts'
import { LoadProblem, Problem, Saved } from './profileParts'
import { ItemName } from '../ItemName'
import { useSession } from '../session'
import type { MyReferral } from '../api'
import { usePatientResource } from './usePatientResource'
import { useOnNotificationChange } from '../notificationBadge'
import { useActionFocus, useRetryFocus } from './actionFocus'

/**
 * Referrals between facilities in the portal (hid-system REF-1 routes 16 and 17, Q-REF-12 A): where the patient was
 * referred and from where, the department and service, urgency, the reason, the status and dates, the words their
 * clinician confirmed they agreed to, and which kinds of details were shared with how many of each; never the letter,
 * the items or the receiving facility's feedback. "Withdraw" while a referral waits for the receiving facility's answer.
 * A referral whose visit was marked entered in error keeps its facilities, status and dates only. Before 0192 ehr-api
 * answers 404, and while referrals are switched off 503 REFERRALS_NOT_AVAILABLE: the card is then not shown.
 */

const DEPARTMENTS: Readonly<Record<string, string>> = {
  general_outpatient: 'General Outpatient', emergency: 'Emergency', inpatient: 'Inpatient', laboratory: 'Laboratory',
  pharmacy: 'Pharmacy', maternity: 'Maternity', pediatrics: 'Pediatrics', radiology: 'Radiology', dental: 'Dental',
  physiotherapy: 'Physiotherapy', dialysis: 'Dialysis', oncology: 'Oncology', cardiology: 'Cardiology', icu: 'ICU', theatre: 'Theatre',
}
const KINDS: Readonly<Record<string, [string, string]>> = {
  diagnoses: ['diagnosis', 'diagnoses'], medicines: ['medicine', 'medicines'], allergies: ['allergy', 'allergies'],
  vitals: ['vital-signs reading', 'vital-signs readings'], labResults: ['lab result', 'lab results'],
}

function named(value: string | null | undefined, fallback: string): string {
  return value?.trim() ? value.trim() : fallback
}

/** Where a referral stands, as the patient reads it. A state this page does not know yet is never its code. */
export function myReferralState(item: MyReferral): string {
  const to = named(item.destinationName, 'the other facility')
  if (item.destinationKind === 'printed') return item.state === 'withdrawn' ? 'withdrawn: the letter should not be used' : 'a printed letter for you to take'
  switch (item.effectiveState) {
    case 'sent': return `waiting for ${to} to answer`
    case 'accepted': return `accepted by ${to}`
    case 'arrived': return `you arrived at ${to}`
    case 'completed': return `completed at ${to}`
    case 'declined': return `${to} couldn’t take it`
    case 'withdrawn':
      if (item.endedKind === 'visit_entered_in_error') return `withdrawn: ${named(item.referringFacilityName, 'your doctor’s clinic')} marked the visit as a mistake`
      return 'withdrawn'
    case 'expired': return item.endedKind === 'not_arrived' ? `the time to go to ${to} has passed` : `${to} didn’t answer in time`
    default: return 'in progress'
  }
}

/** "2 diagnoses, 1 medicine": which kinds of details were shared, with how many of each. */
export function sharedText(sections: MyReferral['sharedSections']): string {
  const parts = (sections ?? []).filter(entry => entry.count > 0)
    .map(entry => { const words = KINDS[entry.kind] ?? ['other detail', 'other details']; return `${entry.count} ${entry.count === 1 ? words[0] : words[1]}` })
  return parts.length ? parts.join(', ') : 'No details from your record, only the letter'
}

function fields(item: MyReferral): Array<[string, string]> {
  const rows: Array<[string, string | null]> = [
    ['Department', item.departmentCode ? DEPARTMENTS[item.departmentCode] ?? 'Another department' : null],
    ['Service', item.serviceWanted],
    ['Urgency', item.urgency === 'urgent' ? 'Urgent' : item.urgency === 'routine' ? 'Routine' : null],
    ['Reason', item.reason],
    ['Details shared', item.destinationKind === 'printed' ? null : sharedText(item.sharedSections)],
    ['Answer due by', item.effectiveState === 'sent' && item.respondBy ? formatDateTime(item.respondBy) : null],
    ['Accepted', item.acceptedAt ? formatDate(item.acceptedAt) : null],
    ['Arrived', item.arrivedAt ? formatDate(item.arrivedAt) : null],
    ['Completed', item.completedAt ? formatDate(item.completedAt) : null],
  ]
  return rows.filter((row): row is [string, string] => Boolean(row[1]))
}

function withdrawProblem(error: unknown, to: string): { text: string; reload: boolean } {
  if (isHidApiError(error) && (error.code === 'REFERRAL_NOT_PENDING' || error.code === 'REFERRAL_VERSION_CONFLICT' || error.status === 404 || error.status === 412)) {
    return { reload: true, text: `It can’t be withdrawn now. ${to} has answered it, or it has already ended. The list below is up to date.` }
  }
  if (!isHidApiError(error) || error.status === 0 || error.status >= 500) return { reload: true,
    text: 'We didn’t get an answer, so it may not have been withdrawn. Check the list below.' }
  return { reload: false, text: plainErrorText(error, 'Couldn’t withdraw it. Try again.') }
}

export function MyReferralsCard() {
  const { api } = useSession()
  // A backend without the list (404), or with referrals switched off (503): the card is not shown.
  const load = useCallback((signal?: AbortSignal) => api.myReferrals(signal).catch((caught: unknown) => {
    if (isHidApiError(caught) && (caught.status === 404 || (caught.status === 503 && caught.code === 'REFERRALS_NOT_AVAILABLE'))) return null
    throw caught
  }), [api])
  const referrals = usePatientResource(load, 'my-referrals')
  // A referral's notice came (the bell's count changed): the list is read again by itself.
  useOnNotificationChange(() => { void referrals.reload() })
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<MyReferral | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusAfter = useActionFocus()
  const retryFocus = useRetryFocus(heading)

  if (referrals.data === null && !referrals.loading && !referrals.error) return null
  const items = referrals.data?.items ?? []

  const withdraw = async (item: MyReferral) => {
    if (working) return
    const to = named(item.destinationName, 'The other facility')
    setWorking(item.referralId); setError(null); setNotice(null)
    try {
      await api.withdrawMyReferral(item)
      setNotice(`Withdrawn. ${to} can no longer accept it, and ${named(item.referringFacilityName, 'your doctor’s clinic')} has been told.`)
      await referrals.reload()
      focusAfter(() => heading.current)
    } catch (cause) {
      const problem = withdrawProblem(cause, to)
      setError(problem.text)
      if (problem.reload) await referrals.reload()
      focusAfter(() => document.getElementById(`withdraw-referral-${item.referralId}`) ?? heading.current)
    } finally { setWorking(null) }
  }

  return <Card aria-busy={(referrals.loading && referrals.data !== null) || undefined} aria-labelledby="my-referrals-heading">
    <div className="border-b border-line px-5 py-4">
      <h2 ref={heading} id="my-referrals-heading" tabIndex={-1} className="m-0 text-title-3 text-ink outline-none">Referrals</h2>
      <p className="m-0 text-[13px] text-ink-3">Where your doctor referred you, and which details from your record went with it.</p>
    </div>
    {referrals.loading && referrals.data === null && <LoadingRows rows={2} label="Loading your referrals" />}
    {(referrals.error || error) && <div className="flex flex-col gap-3 px-5 pt-4">
      {referrals.error && <LoadProblem what="your referrals" error={referrals.error} buttonRef={retryFocus.button} onRetry={() => retryFocus.retry(referrals.reload)} />}
      {error && <Problem>{error}</Problem>}</div>}
    <div className="px-5 pt-4 empty:hidden"><Saved>{notice}</Saved></div>
    {referrals.data && !referrals.error && (items.length === 0 ? <EmptyState compact icon={Share2} title="No referrals"
      description="When your doctor refers you to another hospital or clinic, it shows here with what was shared." />
      : <ul className="m-0 list-none divide-y divide-line p-0">{items.map(item => {
        const to = named(item.destinationName, 'another facility')
        const from = named(item.referringFacilityName, 'your doctor’s clinic')
        const canWithdraw = item.canWithdraw && !item.enteredInError && item.effectiveState === 'sent'
        return <li key={item.referralId} className="flex flex-col gap-3 px-5 py-4"><div className="flex flex-col gap-2 text-[13px] text-ink-2 [&_p]:m-0">
          <p className="text-sm font-semibold text-ink">Referral from {from} to {to}: {myReferralState(item)}</p>
          <p className="text-ink-3">Sent on {formatDate(item.sentAt, 'an unknown date')} · Reference {item.reference}</p>
          {item.enteredInError ? <p>{from} marked the visit this referral came from as a mistake, so its details are no longer shown. If you have questions about it, contact {from}.</p> : <>
            {fields(item).length > 0 && <dl className="m-0 divide-y divide-line rounded-xl ring-1 ring-line">{fields(item).map(([label, value]) => <div key={label} className="flex items-start justify-between gap-4 px-4 py-2.5">
              <dt className="text-ink-3">{label}</dt><dd className="m-0 text-right font-medium [overflow-wrap:anywhere] text-ink">{value}</dd></div>)}</dl>}
            {item.attestation && <>
              <p>Your doctor at {from} confirmed that you agreed:</p>
              <blockquote className="m-0 rounded-xl bg-subtle px-4 py-3 text-sm text-ink ring-1 ring-line">{item.attestation.text}</blockquote>
            </>}
            {canWithdraw && <p>If you didn’t agree to this, withdraw it now, before {to} accepts it.</p>}
            {item.effectiveState === 'accepted' && <p>{to} has accepted it. To change it, contact {from}.</p>}
          </>}
        </div>
          {canWithdraw && <Button id={`withdraw-referral-${item.referralId}`} variant="destructive" className="self-start"
            disabled={!!working || referrals.loading} loading={working === item.referralId} onClick={() => setConfirming(item)}>{working === item.referralId ? 'Withdrawing…' : 'Withdraw'}<ItemName>: referral to {to}</ItemName></Button>}
        </li>
      })}</ul>)}
    {/* Withdraw ends the referral at once and can't be undone: it is confirmed first. */}
    <ConfirmSheet open={confirming !== null} destructive busy={confirming !== null && working === confirming.referralId}
      onClose={() => { const id = confirming?.referralId; setConfirming(null); if (id) focusAfter(() => document.getElementById(`withdraw-referral-${id}`)) }}
      title="Withdraw this referral?"
      effect={confirming ? `${named(confirming.destinationName, 'The other facility')} won’t be able to accept it, and ${named(confirming.referringFacilityName, 'your doctor’s clinic')} will be told.` : ''}
      undo="You can’t undo this. If you need it after all, ask your doctor to refer you again."
      confirmLabel="Withdraw" onConfirm={() => { const item = confirming; if (item) void withdraw(item).finally(() => setConfirming(null)) }} />
  </Card>
}
