import { EhrButton, EhrField, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LabResult } from '../../../../staff/api'
import type { Chart } from '../../parts/chart'
import { ConfirmAction } from '../../parts/Detail'
import { formatDate } from '../../parts/format'
import { ErrorBox } from '../../parts/Notices'
import {
  afterAnswer, DISCUSSED_WORDS as WORDS, discussedProblem, isHeld, mayMarkDiscussed, WITHDRAW_REASON_MAX, WITHDRAW_REASON_MIN,
  WITHDRAWAL_REASONS, type DiscussionAnswer, type DiscussionItem, type DiscussionList, type WithdrawalReasonCode,
} from './discussed'
import { discussedApi } from './discussedApi'

type Focus = 'mark' | 'withdraw' | 'reasonCode' | 'reason' | null

/**
 * The patient's held results and their marks (hid-system #177), read for a member who may mark only, and again with
 * every read of the results (`revision`). Null while unread, and for good when the routes are not served (404), the
 * member may not read them (403) or the read fails: nothing is then shown.
 */
export function useDiscussions(chart: Chart | undefined, revision: number): DiscussionList | null {
  const may = mayMarkDiscussed(chart)
  const facilityId = chart?.facilityId
  const patientId = chart?.patientId
  const [read, setRead] = useState<{ key: string; list: DiscussionList | null } | null>(null)
  const key = `${facilityId ?? ''}-${patientId ?? ''}-${revision}`
  useEffect(() => {
    if (!may || !facilityId || !patientId) return
    let active = true
    discussedApi.list(facilityId, patientId).then(
      list => { if (active) setRead({ key, list }) },
      () => { if (active) setRead({ key, list: null }) },
    )
    return () => { active = false }
  }, [may, facilityId, patientId, key])
  return may && read?.key === key ? read.list : null
}

/**
 * "Discussed with the patient" on one released result the patient chat holds back (owner Q24): a sensitive or
 * critical result the patient does not see, offered only to a member who may mark (mayMarkDiscussed), and only while
 * the version shown is the one the server holds. A discussed result says when, with Withdraw, which needs a reason
 * code and a reason. Each change is confirmed and re-checks access first; a busy button keeps focus.
 */
export function DiscussedWithPatient({ chart, result, item: given, onReadAgain, describedBy }: {
  chart: Chart
  result: LabResult
  item: DiscussionItem | null
  onReadAgain: () => void
  /** The id of this result's "Result N" heading, so each button says which result it acts on. */
  describedBy?: string
}) {
  // The list's item as read; its parent mounts this again (a new key) for every read of the results.
  const [item, setItem] = useState<DiscussionItem | null>(given)
  const [asking, setAsking] = useState<'mark' | 'withdraw' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [withdrawing, setWithdrawing] = useState(false)
  const [reasonCode, setReasonCode] = useState<WithdrawalReasonCode | ''>('')
  const [reason, setReason] = useState('')
  const [codeError, setCodeError] = useState('')
  const [reasonError, setReasonError] = useState('')
  const [focus, setFocus] = useState<Focus>(null)
  const markRef = useRef<HTMLButtonElement>(null)
  const withdrawRef = useRef<HTMLButtonElement>(null)
  const reasonCodeRef = useRef<HTMLSelectElement>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    if (!focus) return
    ;({ mark: markRef, withdraw: withdrawRef, reasonCode: reasonCodeRef, reason: reasonRef })[focus].current?.focus()
    setFocus(null)
  }, [focus])

  if (!item || result.status !== 'released' || !mayMarkDiscussed(chart)) return null
  // The mark is for the version the clinician sees: a page older or newer than the server's version offers nothing.
  if (result.currentReleasedVersion === null || item.resultVersion !== result.currentReleasedVersion) return null
  const discussed = item.discussion?.state === 'discussed'
  if (!discussed && !isHeld(item)) return null
  const current = item
  const version = item.resultVersion

  /** One change: re-checked access first, then the call; the answer's mark is shown, or the results read again. */
  async function change(send: () => Promise<DiscussionAnswer | null>, failed: string, next: Focus, code: string | null) {
    setBusy(true)
    setError('')
    try {
      await chart.verify()
      const answer = await send()
      if (!answer || answer.resultId !== current.resultId || answer.resultVersion !== version) { onReadAgain(); return }
      setItem(afterAnswer(current, answer, code))
      setWithdrawing(false)
      setReasonCode('')
      setReason('')
      setFocus(next)
    } catch (caught) {
      setError(discussedProblem(caught, failed))
    } finally {
      setBusy(false)
    }
  }

  const mark = () => {
    setAsking(null)
    const key = crypto.randomUUID()
    void change(() => discussedApi.mark(chart.facilityId, chart.patientId, current.resultId, version, key), WORDS.markFailed, 'withdraw', null)
  }
  const withdraw = () => {
    setAsking(null)
    if (!reasonCode) return
    const code = reasonCode
    const given = reason.trim()
    const key = crypto.randomUUID()
    void change(() => discussedApi.withdraw(chart.facilityId, chart.patientId, current.resultId, version, code, given, key),
      WORDS.withdrawFailed, 'mark', code)
  }
  const askWithdraw = () => {
    if (busy) return
    const length = reason.trim().length
    const codeProblem = reasonCode ? '' : WORDS.reasonCodeMissing
    const reasonProblem = length < WITHDRAW_REASON_MIN ? WORDS.reasonShort : length > WITHDRAW_REASON_MAX ? WORDS.reasonLong : ''
    setCodeError(codeProblem)
    setReasonError(reasonProblem)
    if (codeProblem || reasonProblem) {
      setFocus(codeProblem ? 'reasonCode' : 'reason')
      return
    }
    setAsking('withdraw')
  }
  const closeForm = () => {
    if (busy) return
    setWithdrawing(false)
    setCodeError('')
    setReasonError('')
    setError('')
    setFocus('withdraw')
  }

  const at = formatDate(item.discussion?.at)
  return (
    <div className="hid-ehr-clinical-orders-discussed">
      {discussed ? (
        <>
          <p>{WORDS.discussedOn(at)}</p>
          {!item.visibleToPatient && !item.finishedVisit ? <p className="hid-ehr-clinical-orders-muted">{WORDS.visitOpen}</p> : null}
          {withdrawing ? (
            <div className="hid-ehr-clinical-orders-action-form">
              <EhrField label={WORDS.reasonCode} error={codeError || undefined}>
                <EhrSelect ref={reasonCodeRef} value={reasonCode} onChange={event => setReasonCode(event.target.value as WithdrawalReasonCode | '')}>
                  <option value="">{WORDS.choose}</option>
                  {WITHDRAWAL_REASONS.map(option => <option key={option.code} value={option.code}>{option.words}</option>)}
                </EhrSelect>
              </EhrField>
              <EhrField label={WORDS.reason} error={reasonError || undefined}>
                <EhrTextarea ref={reasonRef} value={reason} rows={2} maxLength={WITHDRAW_REASON_MAX} onChange={event => setReason(event.target.value)} />
              </EhrField>
              <p>
                <EhrButton ref={withdrawRef} variant="danger" size="sm" busy={busy} aria-describedby={describedBy} onClick={askWithdraw}>{WORDS.withdrawConfirm}</EhrButton>
                {' '}
                <EhrButton variant="quiet" size="sm" aria-disabled={busy || undefined} onClick={closeForm}>Cancel</EhrButton>
              </p>
            </div>
          ) : (
            <p>
              <EhrButton ref={withdrawRef} variant="quiet" size="sm" aria-describedby={describedBy}
                onClick={() => { setWithdrawing(true); setError(''); setFocus('reasonCode') }}>{WORDS.withdraw}</EhrButton>
            </p>
          )}
        </>
      ) : (
        <>
          {item.discussion?.state === 'withdrawn' ? <p className="hid-ehr-clinical-orders-muted">{WORDS.withdrawnOn(at, item.discussion.reasonCode)}</p> : null}
          <p>
            <EhrButton ref={markRef} variant="secondary" size="sm" busy={busy} aria-describedby={describedBy} onClick={() => { if (!busy) setAsking('mark') }}>{WORDS.mark}</EhrButton>
          </p>
        </>
      )}
      {error ? <ErrorBox>{error}</ErrorBox> : null}
      <ConfirmAction open={asking === 'mark'} label={WORDS.mark} description={WORDS.markBody} onConfirm={mark} onCancel={() => setAsking(null)} />
      <ConfirmAction open={asking === 'withdraw'} label={WORDS.withdrawConfirm} description={WORDS.withdrawBody} onConfirm={withdraw} onCancel={() => setAsking(null)} />
    </div>
  )
}
