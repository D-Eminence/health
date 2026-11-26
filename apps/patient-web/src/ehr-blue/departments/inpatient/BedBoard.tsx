import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { EhrBadge, EhrButton, EhrEmptyState, EhrField, EhrTextarea } from '@hid/ui/ehr'
import { inpatientApi, type BedBoard, type BedBoardBed, type BedStatus, type WardType } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { useDeptAccess } from '../parts/access'
import { DeptNotice, type DeptNoticeTone } from '../parts/DeptNotice'
import { DeptSection } from '../parts/DeptPage'
import { useFacilityRead } from '../parts/useFacilityRead'
import { useIdempotencyKeys, usePolling, useSteadyNotServed } from './hooks'
import {
  BED_STATUS_TONES, INPATIENT_BASE, NOT_AVAILABLE, POLL_MS, RELOAD_AFTER, bedStatusText, canAllocate, canManageWards,
  canSetBedStatus, cardName, daysText, isCancelled, learnFrom, lagosDateTime, lengthProblem, refusalWords, takesText,
  wardTypeText,
} from './inpatientRules'
import { AdmissionIdentity, AdmissionItem } from './parts'
import { isHidApiError } from '@hid/http'

type BedMove = 'turnover' | 'clean' | 'maintenance' | 'release'
const MOVES: Readonly<Record<BedMove, { readonly label: string; readonly to: Exclude<BedStatus, 'occupied'>; readonly done: string }>> = {
  turnover: { label: 'Complete bed turnover', to: 'available', done: 'is available again.' },
  clean: { label: 'Mark for cleaning', to: 'cleaning', done: 'is marked for cleaning.' },
  maintenance: { label: 'Place in maintenance', to: 'maintenance', done: 'is under maintenance.' },
  release: { label: 'Release from maintenance', to: 'available', done: 'is available again.' },
}
/** The hand moves route 9 takes from each status: cleaning → available, available → maintenance or cleaning, maintenance → available. */
export function bedMoves(status: BedStatus): readonly BedMove[] {
  if (status === 'cleaning') return ['turnover']
  if (status === 'available') return ['maintenance', 'clean']
  if (status === 'maintenance') return ['release']
  return []
}

/**
 * One ward's bed board, or every active ward of a type (ICU), as route 7 answers it: each bed with its status in words
 * (never colour alone), how long it has been so, the patient in it (named under Q190 A, with days since admission), and
 * the bed's hand moves for those who give beds or set up wards. Patients waiting for a bed are listed after, unless the
 * page lists them itself (ICU). Read again every 60 seconds while shown. Nothing here opens a chart.
 */
export function BedBoardView({ facilityId, which, headingId, recordBase = INPATIENT_BASE, waiting = true }: {
  readonly facilityId: string
  /** Where a patient's admission opens: Inpatient / Wards, or ICU on the ICU page. */
  readonly recordBase?: string
  readonly which: { readonly wardId: string } | { readonly wardType: WardType }
  readonly headingId: string
  /**
   * Whether to list the board's own "Waiting for a bed". ICU's page leaves it out: its admissions list has its own, of
   * requests for an ICU ward, and the board's (which also takes requests for any ward) would say another count.
   */
  readonly waiting?: boolean
}) {
  const { permissions } = useDeptAccess()
  const keyFor = useIdempotencyKeys()
  const focus = useFocusById()
  const noticeId = `${headingId}-notice`
  const wardId = 'wardId' in which ? which.wardId : ''
  const wardType = 'wardType' in which ? which.wardType : ''
  const loader = useCallback((id: string) => inpatientApi.bedBoard(id, wardId ? { wardId } : { wardType: wardType as WardType })
    .then(answer => { learnFrom(); return answer }, caught => { learnFrom(caught); throw caught }), [wardId, wardType])
  const board = useFacilityRead<BedBoard>(facilityId, true, loader, 'The bed board could not be loaded.')
  const { refresh } = board
  usePolling(refresh, POLL_MS)
  const [open, setOpen] = useState<{ bedId: string; move: BedMove } | null>(null)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: DeptNoticeTone; text: string } | null>(null)

  const unavailable = useSteadyNotServed(board)
  const error = unavailable ? NOT_AVAILABLE : board.error ? refusalWords(board.caught, board.error) : ''
  const setsStatus = canSetBedStatus(permissions)
  // A ward admin without the ward roles sets a bed's status under healthcare operations; ward staff under direct care.
  const purpose = canAllocate(permissions) ? 'direct-care' as const : 'healthcare-operations' as const

  async function move(bed: BedBoardBed, kind: BedMove) {
    if (busy) return
    const target = MOVES[kind]
    const text = note.trim()
    if (kind === 'maintenance') {
      const problem = lengthProblem(text, 8, 300, 'why the bed is out of use')
      if (problem) { setNoteError(problem); return }
    }
    setBusy(true); setNotice(null)
    const body = { bed: bed.bedId, version: bed.rowVersion, status: target.to, note: kind === 'maintenance' ? text : '' }
    try {
      await inpatientApi.setBedStatus(facilityId, bed, target.to, kind === 'maintenance' ? text : undefined, keyFor('bed-status', body), purpose)
      setNotice({ tone: 'positive', text: `${bed.name} ${target.done}` })
      setOpen(null); setNote(''); setNoteError('')
      void refresh()
    } catch (caught) {
      if (isCancelled(caught)) return
      learnFrom(caught)
      if (isHidApiError(caught) && RELOAD_AFTER.has(caught.code)) { setOpen(null); void refresh() }
      setNotice({ tone: 'critical', text: refusalWords(caught, 'The bed could not be changed. Try again.', 'Say why the bed is out of use in 8 to 300 characters.') })
    } finally {
      setBusy(false)
      // The button pressed goes once the bed's status changes (and the maintenance form closes): focus goes to what
      // happened, never to the page's top.
      focus(noticeId)
    }
  }

  if (unavailable || (error && board.value === null)) {
    return <DeptNotice role="alert" tone={unavailable ? 'info' : 'critical'}>{error}</DeptNotice>
  }
  if (board.value === null) return <p className="hid-ehr-state-message" role="status">Loading the bed board…</p>

  const { wards, waitingForBed } = board.value
  return (
    <>
      {error ? <DeptNotice role="alert" tone="critical">{error}</DeptNotice> : null}
      {notice ? <DeptNotice id={noticeId} tabIndex={-1} role={notice.tone === 'critical' ? 'alert' : 'status'} tone={notice.tone} variant="box">{notice.text}</DeptNotice> : null}
      {wards.length === 0 ? (
        <DeptSection title="Beds" headingId={headingId}>
          <EhrEmptyState title={wardType === 'icu' ? 'This facility has no ICU ward yet.' : 'This ward has no beds yet.'}
            message={canManageWards(permissions) ? 'Add one in Ward configuration.' : 'An admin can add one in Ward configuration.'} />
        </DeptSection>
      ) : wards.map(ward => {
        const id = `${headingId}-${ward.wardId}`
        const occupied = ward.beds.filter(bed => bed.status === 'occupied').length
        return (
          <DeptSection key={ward.wardId} title={`${ward.name}: ${occupied} of ${ward.beds.length} beds occupied`} headingId={id}>
            <p className="hid-ehr-dept-inpatient-hint">{wardTypeText(ward.wardType)} ward · {takesText(ward.takes)}{ward.active ? '' : ' · Closed'}</p>
            {ward.beds.length === 0 ? <EhrEmptyState title="This ward has no beds yet." message="An admin adds beds in Ward configuration." /> : (
              <ul className="hid-ehr-dept-inpatient-beds" aria-labelledby={id}>
                {ward.beds.map(bed => {
                  const bedHeading = `bed-${bed.bedId}`
                  const moves = setsStatus ? bedMoves(bed.status) : []
                  return (
                    <li key={bed.bedId} className="hid-ehr-dept-inpatient-bed" data-status={bed.status} aria-labelledby={bedHeading}>
                      <h3 id={bedHeading} className="hid-ehr-dept-inpatient-bed-name">{bed.name}</h3>
                      <div className="hid-ehr-dept-inpatient-badges">
                        <EhrBadge tone={BED_STATUS_TONES[bed.status] ?? 'neutral'}>{bedStatusText(bed.status)}</EhrBadge>
                        {bed.kind === 'overflow' ? <EhrBadge tone="caution">Overflow space</EhrBadge> : null}
                        {bed.patient?.dischargeReady || bed.patient?.status === 'discharge_ready' ? <EhrBadge tone="positive">Discharge ready</EhrBadge> : null}
                      </div>
                      {bed.statusSince ? <p className="hid-ehr-dept-inpatient-hint">Since {lagosDateTime(bed.statusSince)}</p> : null}
                      {bed.patient ? (
                        <div>
                          <p className="hid-ehr-dept-inpatient-name">
                            <Link className="hid-ehr-dept-link" to={`${recordBase}/${bed.patient.admissionId}`}>{cardName(bed.patient)}</Link>
                          </p>
                          <AdmissionIdentity card={bed.patient} />
                          {daysText(bed.patient.daysAdmitted) ? <p className="hid-ehr-dept-inpatient-hint">{daysText(bed.patient.daysAdmitted)} of the stay</p> : null}
                        </div>
                      ) : null}
                      {moves.length > 0 ? (
                        <div className="hid-ehr-dept-inpatient-actions">
                          {moves.map(kind => kind === 'maintenance' ? (
                            <EhrButton key={kind} size="sm" variant="secondary" aria-expanded={open?.bedId === bed.bedId && open.move === kind}
                              aria-label={`${MOVES[kind].label}: ${bed.name}`}
                              onClick={() => { setOpen(value => value?.bedId === bed.bedId && value.move === kind ? null : { bedId: bed.bedId, move: kind }); setNote(''); setNoteError('') }}>
                              {MOVES[kind].label}
                            </EhrButton>
                          ) : (
                            <EhrButton key={kind} size="sm" variant={kind === 'clean' ? 'secondary' : 'primary'} busy={busy}
                              aria-label={`${MOVES[kind].label}: ${bed.name}`} onClick={() => void move(bed, kind)}>{MOVES[kind].label}</EhrButton>
                          ))}
                        </div>
                      ) : null}
                      {open?.bedId === bed.bedId && open.move === 'maintenance' ? (
                        <form className="hid-ehr-dept-inpatient-form" noValidate onSubmit={event => { event.preventDefault(); void move(bed, 'maintenance') }}>
                          <EhrField label="Why is the bed out of use?" controlId={`bed-note-${bed.bedId}`} error={noteError || undefined}
                            hint="8 to 300 characters, such as “Broken bed rail, waiting for repair”.">
                            <EhrTextarea value={note} maxLength={300} rows={2} onChange={event => { setNote(event.target.value); setNoteError('') }} />
                          </EhrField>
                          <div className="hid-ehr-dept-form-actions">
                            <EhrButton type="submit" busy={busy}>Place in maintenance</EhrButton>
                            <EhrButton variant="quiet" onClick={() => setOpen(null)}>Cancel</EhrButton>
                          </div>
                        </form>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </DeptSection>
        )
      })}
      {waiting ? (
        <DeptSection title={`Waiting for a bed (${waitingForBed.length})`} headingId={`${headingId}-waiting`}>
          {waitingForBed.length === 0 ? <EhrEmptyState title="No one is waiting for a bed." message="Admission requests show here until a bed is given." /> : (
            <ul className="hid-ehr-dept-inpatient-list" aria-labelledby={`${headingId}-waiting`}>
              {waitingForBed.map(card => <AdmissionItem key={card.admissionId} card={card} base={recordBase} />)}
            </ul>
          )}
        </DeptSection>
      ) : null}
    </>
  )
}
