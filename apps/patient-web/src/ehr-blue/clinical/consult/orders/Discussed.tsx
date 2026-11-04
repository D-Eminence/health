import { EhrButton, EhrField, EhrTextarea } from '@hid/ui/ehr'
import { useLayoutEffect, useRef, useState } from 'react'
import type { LabResult } from '../../../../staff/api'
import { refusalText } from '../../../../staff/fieldProblem'
import type { Chart } from '../../parts/chart'
import { ConfirmAction } from '../../parts/Detail'
import { formatDate } from '../../parts/format'
import { ErrorBox } from '../../parts/Notices'
import { discussedCalls, DISCUSSED_WORDS as WORDS, mayMarkDiscussed, readHold, WITHDRAW_REASON_MIN, type PatientChatHold } from './discussed'

type Focus = 'mark' | 'withdraw' | 'reason' | null

/**
 * "Discussed with the patient" on one released result the patient chat holds back (owner Q24). Nothing at all while
 * the backend does not say the result is held (today), and the button only for a clinician with care access, once the
 * calls are wired (discussed.ts). Each change is confirmed; a withdrawal needs a reason. A busy button keeps focus.
 */
export function DiscussedWithPatient({ chart, requestId, result, onReadAgain }: {
  chart: Chart | undefined
  requestId: string
  result: LabResult
  onReadAgain: () => void
}) {
  const [hold, setHold] = useState<PatientChatHold | null>(() => readHold(result))
  const [asking, setAsking] = useState<'mark' | 'withdraw' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [withdrawing, setWithdrawing] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState('')
  const [focus, setFocus] = useState<Focus>(null)
  const markRef = useRef<HTMLButtonElement>(null)
  const withdrawRef = useRef<HTMLButtonElement>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    if (!focus) return
    ;({ mark: markRef, withdraw: withdrawRef, reason: reasonRef })[focus].current?.focus()
    setFocus(null)
  }, [focus])

  const calls = discussedCalls()
  if (!hold || result.status !== 'released') return null
  if (!hold.discussedAt && !hold.held) return null
  const may = calls !== null && mayMarkDiscussed(chart)
  if (!hold.discussedAt && !may) return null

  /** One change: re-checked access first, then the call; the answer's hold is shown, or the results read again. */
  async function change(send: () => Promise<unknown>, failed: string, next: Focus) {
    if (!chart) return
    setBusy(true)
    setError('')
    try {
      await chart.verify()
      const answer = readHold(await send())
      if (!answer) { onReadAgain(); return }
      setHold(answer)
      setWithdrawing(false)
      setReason('')
      setFocus(next)
    } catch (caught) {
      setError(refusalText(caught, failed))
    } finally {
      setBusy(false)
    }
  }

  const mark = () => {
    setAsking(null)
    if (!calls || !chart) return
    void change(() => calls.mark(chart.facilityId, requestId, result.id), WORDS.markFailed, 'withdraw')
  }
  const withdraw = () => {
    setAsking(null)
    if (!calls || !chart) return
    const given = reason.trim()
    void change(() => calls.withdraw(chart.facilityId, requestId, result.id, given), WORDS.withdrawFailed, 'mark')
  }
  const askWithdraw = () => {
    if (busy) return
    if (reason.trim().length < WITHDRAW_REASON_MIN) {
      setReasonError(WORDS.reasonShort)
      setFocus('reason')
      return
    }
    setReasonError('')
    setAsking('withdraw')
  }

  return (
    <div className="hid-ehr-clinical-orders-discussed">
      {hold.discussedAt ? (
        <>
          <p>{WORDS.discussedOn(formatDate(hold.discussedAt))}</p>
          {may ? (
            withdrawing ? (
              <div className="hid-ehr-clinical-orders-action-form">
                <EhrField label={WORDS.reason} error={reasonError || undefined}>
                  <EhrTextarea ref={reasonRef} value={reason} rows={2} onChange={event => setReason(event.target.value)} />
                </EhrField>
                <p>
                  <EhrButton ref={withdrawRef} variant="danger" size="sm" busy={busy} onClick={askWithdraw}>{WORDS.withdrawConfirm}</EhrButton>
                  {' '}
                  <EhrButton variant="quiet" size="sm" aria-disabled={busy || undefined}
                    onClick={() => { if (!busy) { setWithdrawing(false); setReasonError(''); setError(''); setFocus('withdraw') } }}>Cancel</EhrButton>
                </p>
              </div>
            ) : (
              <p>
                <EhrButton ref={withdrawRef} variant="quiet" size="sm" aria-expanded={false}
                  onClick={() => { setWithdrawing(true); setError(''); setFocus('reason') }}>{WORDS.withdraw}</EhrButton>
              </p>
            )
          ) : null}
        </>
      ) : (
        <p>
          <EhrButton ref={markRef} variant="secondary" size="sm" busy={busy} onClick={() => { if (!busy) setAsking('mark') }}>{WORDS.mark}</EhrButton>
        </p>
      )}
      {error ? <ErrorBox>{error}</ErrorBox> : null}
      <ConfirmAction open={asking === 'mark'} label={WORDS.mark} description={WORDS.markBody} onConfirm={mark} onCancel={() => setAsking(null)} />
      <ConfirmAction open={asking === 'withdraw'} label={WORDS.withdrawConfirm} description={WORDS.withdrawBody} onConfirm={withdraw} onCancel={() => setAsking(null)} />
    </div>
  )
}
