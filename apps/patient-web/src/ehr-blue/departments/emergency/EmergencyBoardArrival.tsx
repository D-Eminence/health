import { useState } from 'react'
import { Link } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { EhrButton, EhrField, EhrSelect } from '@hid/ui/ehr'
import { edBoardApi, type EdArrivalMode, type EdArrived } from '../../../staff/api'
import { DeptNotice } from '../parts/DeptNotice'
import { ARRIVAL_MODES, ARRIVAL_MODE_WORDS, BASE, canArrive, cardName, learnFrom, refusalWords } from './edRules'
import { emergencyCardFor } from './emergencyArrival'
import { useIdempotencyKeys } from './hooks'

/**
 * "Add to the emergency board" on the emergency summary of a patient opened by break-glass from an emergency search
 * card (ED-1 route 1, basis `emergency`, Q-ED-3 A). Offered only to members who add patients to the board, and only for
 * the card this session opened the patient from. The board gives no chart access: the summary stays under the grant.
 */
export function EmergencyBoardArrival({ facilityId, patientId, permissions }: {
  readonly facilityId: string
  readonly patientId: string
  readonly permissions: readonly string[]
}) {
  const keyFor = useIdempotencyKeys()
  const [mode, setMode] = useState<EdArrivalMode | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<EdArrived | null>(null)
  const matchRef = emergencyCardFor(facilityId, patientId)
  if (!matchRef || !canArrive(permissions)) return null

  async function add() {
    if (busy || !matchRef) return
    if (mode === '') { setError('Choose how the patient came.'); return }
    setBusy(true); setError('')
    const patient = { matchRef, emergency: true }
    const input = { arrivalMode: mode }
    try {
      setDone(await edBoardApi.arrive(facilityId, patient, input, keyFor('arrive', { matchRef, input })))
      learnFrom()
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      learnFrom(caught)
      setError(refusalWords(caught, 'The patient could not be added to the board. Try again.', 'Choose how the patient came.'))
    } finally { setBusy(false) }
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-surface p-4 ring-1 ring-line" aria-labelledby="ed-emergency-arrival">
      <h2 id="ed-emergency-arrival" className="m-0 text-base font-semibold text-ink">Emergency department board</h2>
      {done ? (
        <DeptNotice tone="positive" role="status">
          {done.outcome === 'already_on_board' ? `${cardName(done.attendance)} is already on the board.` : `${cardName(done.attendance)} is on the board.`}{' '}
          <Link className="hid-ehr-dept-link" to={`${BASE}/${done.attendance.attendanceId}`}>Open their record on the board</Link>
        </DeptNotice>
      ) : (
        <>
          <p className="m-0 text-sm text-ink-2">Put this patient on the board. It does not change what you can see of their record.</p>
          <EhrField label="How they came" controlId="ed-emergency-arrival-mode">
            <EhrSelect value={mode} onChange={event => setMode(event.target.value as EdArrivalMode | '')}>
              <option value="">Choose</option>
              {ARRIVAL_MODES.map(value => <option key={value} value={value}>{ARRIVAL_MODE_WORDS[value]}</option>)}
            </EhrSelect>
          </EhrField>
          {error ? <DeptNotice role="alert" tone="critical">{error}</DeptNotice> : null}
          <div><EhrButton variant="secondary" busy={busy} onClick={() => void add()}>Add to the emergency board</EhrButton></div>
        </>
      )}
    </section>
  )
}
