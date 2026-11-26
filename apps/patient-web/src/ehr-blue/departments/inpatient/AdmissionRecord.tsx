import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { lagosDay } from '@hid/ui/display'
import { EhrButton, EhrField, EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import {
  DISCHARGE_CONDITIONS, DISCHARGE_OUTCOMES, REPRINT_REASONS, inpatientApi, staffApi, type AdmissionCard, type AdmissionChange,
  type AdmissionRecord, type AdmissionWritten, type ClinicalRecord, type DischargeCondition, type DischargeInput,
  type DischargeOutcome, type ReprintReason, type Ward,
} from '../../../staff/api'
import { useStaff } from '../../../staff/App'
import { useFocusById } from '../../../staff/focus'
import { useDeptAccess } from '../parts/access'
import { DeptNotice, type DeptNoticeTone } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { useIdempotencyKeys, useStaffNames } from './hooks'
import {
  CONDITION_WORDS, DEATH_RECORD_OFF, DISCHARGE_TIME_WORDS, EYEBROW, OUTCOME_HINTS, OUTCOME_WORDS, RELOAD_AFTER, REPRINT_WORDS,
  SIGN_WORD, canAllocate, canDecide, canPrintBand, canReadAdmission, cardName, daysText, dischargeTimeRange, dischargedText,
  isCancelled, lagosDateTime, lagosInputToUtc, learnFrom, lengthProblem, memberText, movementText, notServed, outcomeText, placeText,
  refusalWords, sourceText, takesText, utcToLagosInput, dayText,
} from './inpatientRules'
import { AdmissionBadges, AdmissionIdentity, ScreenWarning } from './parts'
import { BandPaper, DischargeSummaryPaper, useInpatientPrint } from './prints'

type Action = 'admit' | 'transfer' | 'prepare' | 'discharge' | 'cancel' | 'change' | 'band' | null
interface Notice { readonly tone: DeptNoticeTone; readonly text: string; readonly printBand?: boolean; readonly printSummary?: boolean }

/**
 * One admission (ADT-1 route 12): the card, its movements and the actions the member's role has. Nurses, clinicians and
 * doctors give and move beds and print the band (Q185 A, Q192 A); doctors and clinicians also change the admission,
 * prepare the discharge and discharge the patient, with a signed summary that prints. Every write sends the row version
 * the card showed; a change someone else made first answers 412 and the record is read again.
 */
export function AdmissionRecordPage({ facilityId, admissionId, base }: {
  readonly facilityId: string
  readonly admissionId: string
  readonly base: string
}) {
  const navigate = useNavigate()
  const { permissions, membershipId } = useDeptAccess()
  const { activePatient } = useStaff()
  const keyFor = useIdempotencyKeys()
  const focus = useFocusById()
  const papers = useInpatientPrint()
  const [record, setRecord] = useState<AdmissionRecord | null>(null)
  const [loadError, setLoadError] = useState<{ text: string; unavailable: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<Action>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [handovers, setHandovers] = useState<Readonly<Record<string, string>>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const answer = await inpatientApi.admission(facilityId, admissionId)
      learnFrom()
      setRecord(answer)
      setLoadError(null)
    } catch (caught) {
      if (isCancelled(caught)) return
      learnFrom(caught)
      setLoadError({ text: refusalWords(caught, 'This admission could not be loaded. Try again.'), unavailable: notServed(caught) })
    } finally { setLoading(false) }
  }, [facilityId, admissionId])

  useEffect(() => { void load() }, [load])

  const card = record?.admission ?? null
  const names = useStaffNames(facilityId, [card?.responsibleMembershipId, card?.requestedByMembershipId, card?.admittedByMembershipId,
    card?.discharge?.dischargedByMembershipId, ...(record?.movements ?? []).map(movement => movement.byMembershipId)])

  /** Sends one write with its own key per body; a stale card reloads; every answer shows the new card at once. */
  async function write(name: string, body: unknown, send: (key: string) => Promise<AdmissionWritten>, done: Omit<Notice, 'tone'>,
    invalid?: string): Promise<'done' | unknown> {
    if (busy || !card) return null
    setBusy(true)
    try {
      const answer = await send(keyFor(`${name}:${card.admissionId}:${card.rowVersion}`, body))
      setRecord(previous => previous ? { ...previous, admission: answer.admission } : previous)
      setAction(null)
      setNotice({ tone: 'positive', ...done })
      void load()
      return 'done'
    } catch (caught) {
      if (isCancelled(caught)) return caught
      learnFrom(caught)
      const reload = isHidApiError(caught) && RELOAD_AFTER.has(caught.code) && caught.code !== 'BED_NOT_AVAILABLE'
      if (reload) { setAction(null); void load() }
      setNotice({ tone: 'critical', text: refusalWords(caught, 'The change could not be saved. Try again.', invalid) })
      return caught
    } finally {
      setBusy(false)
      focus('admission-notice')
    }
  }

  async function printBand(reprintReason: ReprintReason | undefined) {
    if (busy || !card) return
    // A newborn's admission (made with the mother's admission) prints the newborn band, matched to the mother's (Q192 A).
    const newborn = Boolean(card.motherAdmissionId)
    const job = papers.start('band')
    setBusy(true)
    try {
      const band = await inpatientApi.wristband(facilityId, card.admissionId, reprintReason,
        keyFor(`band:${card.admissionId}`, { reprintReason: reprintReason ?? null, newborn, printed: printedBands(record) }), newborn)
      papers.print('band', <BandPaper band={band} />, job)
      setAction(null)
      setNotice({ tone: 'positive', text: newborn ? 'The newborn band is printing.' : 'The wristband is printing.' })
      void load()
    } catch (caught) {
      job.cancel()
      if (isCancelled(caught)) return
      learnFrom(caught)
      setNotice({ tone: 'critical', text: refusalWords(caught, 'The band could not be printed. Try again.') })
    } finally {
      setBusy(false)
      focus('admission-notice')
    }
  }

  async function printSummary() {
    if (busy || !card) return
    const job = papers.start('discharge')
    setBusy(true)
    try {
      const summary = await inpatientApi.dischargeSummary(facilityId, card.admissionId)
      papers.print('discharge', <DischargeSummaryPaper print={summary} />, job)
      setNotice({ tone: 'positive', text: 'The discharge summary is printing.' })
    } catch (caught) {
      job.cancel()
      if (isCancelled(caught)) return
      learnFrom(caught)
      setNotice({ tone: 'critical', text: refusalWords(caught, 'The discharge summary could not be printed. Try again.') })
    } finally {
      setBusy(false)
      focus('admission-notice')
    }
  }

  async function readHandover(movementId: string) {
    if (!card) return
    try {
      const answer = await inpatientApi.handover(facilityId, card.admissionId, movementId)
      setHandovers(previous => ({ ...previous, [movementId]: answer.handover }))
      // The button is replaced by the text: focus goes to the text, so it is read out and the place is kept.
      focus(handoverId(movementId))
    } catch (caught) {
      if (isCancelled(caught)) return
      setNotice({ tone: 'critical', text: refusalWords(caught, 'The handover could not be read. Try again.') })
      focus('admission-notice')
    }
  }

  if (!card) {
    return (
      <DeptPage eyebrow={EYEBROW} title="Admission" onBack={() => navigate(base)} backLabel="Back to the list">
        {loadError ? <DeptNotice role="alert" tone={loadError.unavailable ? 'info' : 'critical'}>{loadError.text}</DeptNotice> : null}
        {loading && !loadError ? <p className="hid-ehr-state-message" role="status">Loading the admission…</p> : null}
      </DeptPage>
    )
  }

  const name = cardName(card)
  const allocates = canAllocate(permissions)
  const decides = canDecide(permissions)
  const bands = canPrintBand(permissions)
  const waiting = card.status === 'requested'
  const inBed = card.status === 'admitted' || card.status === 'discharge_ready'
  const open = waiting || inBed
  const printed = printedBands(record)
  const newborn = Boolean(card.motherAdmissionId)
  // The chart is open in this session for this patient under direct care: the nursing handover can be written.
  const chartOpen = activePatient?.purpose === 'direct-care' && activePatient.lookup.patient.patientId === card.patientId
  const toggle = (next: Exclude<Action, null>) => setAction(value => value === next ? null : next)
  const responsible = memberText(card.responsibleMembershipId, membershipId, names)

  return (
    <DeptPage eyebrow={EYEBROW} title={name} onBack={() => navigate(base)} backLabel="Back to the list"
      secondaryActions={<EhrButton variant="secondary" onClick={() => void load()} busy={loading}>Refresh</EhrButton>}>
      <ScreenWarning />
      {notice ? (
        <DeptNotice id="admission-notice" tabIndex={-1} role={notice.tone === 'critical' ? 'alert' : 'status'} tone={notice.tone} variant="box">
          {notice.text}
          {notice.printBand && bands ? <> <EhrButton size="sm" busy={busy} onClick={() => void printBand(undefined)}>{card.motherAdmissionId ? 'Print newborn band' : 'Print wristband'}</EhrButton></> : null}
          {notice.printSummary && canReadAdmission(permissions) ? <> <EhrButton size="sm" busy={busy} onClick={() => void printSummary()}>Print discharge summary</EhrButton></> : null}
        </DeptNotice>
      ) : null}
      {loadError ? <DeptNotice role="alert" tone="critical">{loadError.text}</DeptNotice> : null}

      <DeptSection title="Patient" headingId="admission-patient">
        <AdmissionIdentity card={card} />
        <AdmissionBadges card={card} />
        <dl className="hid-ehr-dept-inpatient-facts">
          <div><dt>Admission</dt><dd>{card.admissionNumber}</dd></div>
          <div><dt>Came from</dt><dd>{sourceText(card.source)}</dd></div>
          {placeText(card) ? <div><dt>Bed</dt><dd>{placeText(card)}</dd></div> : null}
          <div><dt>Requested</dt><dd>{lagosDateTime(card.requestedAt)}</dd></div>
          {card.admittedAt ? <div><dt>Admitted</dt><dd>{lagosDateTime(card.admittedAt)}{daysText(card.daysAdmitted) && open ? ` (${daysText(card.daysAdmitted)})` : ''}</dd></div> : null}
          <div><dt>Reason</dt><dd>{card.reasonHidden ? 'Shown to nurses, clinicians and doctors' : card.reason ?? 'Not recorded'}</dd></div>
          {card.careTeam ? <div><dt>Care team</dt><dd>{card.careTeam}</dd></div> : null}
          {responsible ? <div><dt>Responsible doctor</dt><dd>{responsible}</dd></div> : null}
          {card.expectedDischargeOn ? <div><dt>Expected discharge</dt><dd>{dayText(card.expectedDischargeOn)}</dd></div> : null}
          {card.preparedAt ? <div><dt>Discharge prepared</dt><dd>{lagosDateTime(card.preparedAt)}</dd></div> : null}
          {card.discharge ? <>
            <div><dt>Outcome</dt><dd>{outcomeText(card.discharge.outcome)}</dd></div>
            <div><dt>Discharged</dt><dd>{lagosDateTime(card.discharge.dischargedAt)}</dd></div>
            {card.discharge.referredToFacilityName ? <div><dt>Referred to</dt><dd>{card.discharge.referredToFacilityName}</dd></div> : null}
            {card.discharge.diedAt ? <div><dt>Time of death</dt><dd>{lagosDateTime(card.discharge.diedAt)}</dd></div> : null}
          </> : null}
          {card.cancelledAt ? <div><dt>Cancelled</dt><dd>{lagosDateTime(card.cancelledAt)}</dd></div> : null}
        </dl>
        {card.discharge?.outcome === 'died' ? <p className="hid-ehr-dept-inpatient-hint">{DEATH_RECORD_OFF}</p> : null}
      </DeptSection>

      <DeptSection title="What to do next" headingId="admission-actions">
        <div className="hid-ehr-dept-inpatient-actions">
          {allocates && waiting ? <EhrButton aria-expanded={action === 'admit'} onClick={() => toggle('admit')}>Admit and allocate bed</EhrButton> : null}
          {allocates && inBed ? <EhrButton variant="secondary" aria-expanded={action === 'transfer'} onClick={() => toggle('transfer')}>Transfer bed</EhrButton> : null}
          {decides && inBed ? (
            <EhrButton variant="secondary" aria-expanded={action === 'prepare'} onClick={() => toggle('prepare')}>
              {card.status === 'discharge_ready' ? 'Change the discharge plan' : 'Prepare discharge'}
            </EhrButton>
          ) : null}
          {decides && inBed ? <EhrButton aria-expanded={action === 'discharge'} onClick={() => toggle('discharge')}>Discharge patient</EhrButton> : null}
          {bands && inBed ? (
            printed === 0
              ? <EhrButton variant="secondary" busy={busy} onClick={() => void printBand(undefined)}>{newborn ? 'Print newborn band' : 'Print wristband'}</EhrButton>
              : <EhrButton variant="secondary" aria-expanded={action === 'band'} onClick={() => toggle('band')}>{newborn ? 'Print newborn band again' : 'Print wristband again'}</EhrButton>
          ) : null}
          {decides && open ? <EhrButton variant="quiet" aria-expanded={action === 'change'} onClick={() => toggle('change')}>Change details</EhrButton> : null}
          {decides && waiting ? <EhrButton variant="quiet" aria-expanded={action === 'cancel'} onClick={() => toggle('cancel')}>Cancel request</EhrButton> : null}
          {card.status === 'discharged' && card.discharge?.summaryNoteId && canReadAdmission(permissions) ? (
            <EhrButton variant="secondary" busy={busy} onClick={() => void printSummary()}>Print discharge summary</EhrButton>
          ) : null}
        </div>
        {!open ? <p className="hid-ehr-dept-inpatient-hint">{card.status === 'discharged' ? 'This patient has been discharged. The record can still be read.' : 'This request was cancelled.'}</p> : null}
        {open && !allocates && !decides ? <p className="hid-ehr-dept-inpatient-hint">Nurses, clinicians and doctors give and move beds. Doctors and clinicians admit and discharge.</p> : null}

        {action === 'admit' || action === 'transfer' ? (
          <BedForm facilityId={facilityId} card={card} transfer={action === 'transfer'} chartOpen={chartOpen} busy={busy}
            onCancel={() => setAction(null)}
            onSave={(bedId, handover, confirm, place) => write(action, { bedId, handover, confirm }, key => action === 'admit'
              ? inpatientApi.admit(facilityId, card, bedId, confirm, key)
              : inpatientApi.transfer(facilityId, card, bedId, handover || undefined, confirm, key),
            action === 'admit'
              ? { text: `${name} is admitted to ${place}.`, printBand: printed === 0 }
              : { text: `${name} has moved to ${place}. The old bed is marked for cleaning.`, printBand: false },
            'Choose a free bed, and keep the handover to 2,000 characters.')} />
        ) : null}
        {action === 'prepare' ? (
          <PrepareForm facilityId={facilityId} card={card} busy={busy} onCancel={() => setAction(null)}
            onSave={body => write('prepare', body, key => inpatientApi.prepareDischarge(facilityId, card, body, key),
              { text: `${name}’s discharge is prepared.` }, 'Check the follow-up plan and the expected date.')} />
        ) : null}
        {action === 'discharge' ? (
          <DischargeForm card={card} busy={busy} onCancel={() => setAction(null)}
            onSave={body => write('discharge', body, key => inpatientApi.discharge(facilityId, card, body, key),
              { text: dischargedText(name, body.outcome, body.referredToFacilityName), printSummary: Boolean(body.summary) },
              'Check the discharge details.')} />
        ) : null}
        {action === 'cancel' ? (
          <CancelForm busy={busy} onCancel={() => setAction(null)} onSave={reason => write('cancel', { reason },
            key => inpatientApi.cancel(facilityId, card, reason, key), { text: `${name}’s admission request is cancelled.` },
            'Say why in 8 to 500 characters.')} />
        ) : null}
        {action === 'change' ? (
          <ChangeForm card={card} membershipId={membershipId} busy={busy} onCancel={() => setAction(null)}
            onSave={change => write('change', change, key => inpatientApi.update(facilityId, card, change, key),
              { text: `${name}’s admission is updated.` }, 'Check the details.')} />
        ) : null}
        {action === 'band' ? (
          <ReprintForm busy={busy} newborn={newborn} onCancel={() => setAction(null)} onSave={reason => void printBand(reason)} />
        ) : null}
      </DeptSection>

      <DeptSection title="Movements" headingId="admission-movements">
        {record && record.movements.length > 0 ? (
          <ol className="hid-ehr-dept-inpatient-history">
            {record.movements.map(movement => (
              <li key={movement.movementId}>
                <span className="hid-ehr-dept-inpatient-history-when">{lagosDateTime(movement.at)}</span>
                <span>{movementText(movement)}</span>
                <span>{memberText(movement.byMembershipId, membershipId, names, '')}</span>
                {movement.handoverRecorded && canReadAdmission(permissions) ? (
                  handovers[movement.movementId] !== undefined
                    ? <span id={handoverId(movement.movementId)} tabIndex={-1} className="hid-clinical-paper-note">Handover: {handovers[movement.movementId]}</span>
                    : <EhrButton size="sm" variant="quiet" aria-label={`Read the handover of ${lagosDateTime(movement.at)}`}
                      onClick={() => void readHandover(movement.movementId)}>Read the handover</EhrButton>
                ) : null}
              </li>
            ))}
          </ol>
        ) : <p className="hid-ehr-dept-inpatient-hint">Nothing recorded yet.</p>}
      </DeptSection>
      {papers.area}
    </DeptPage>
  )
}

const handoverId = (movementId: string) => `handover-${movementId}`

function printedBands(record: AdmissionRecord | null): number {
  return (record?.movements ?? []).filter(movement => movement.kind === 'wristband_printed').length
}

// ---- Admit and transfer: choose a free bed -------------------------------------------------------------

interface BedChoice { readonly bedId: string; readonly label: string; readonly place: string; readonly ward: Ward }

/** The free beds and overflow spaces of every active ward (ICU included), the wanted ward first. */
export function freeBeds(wards: readonly Ward[], card: Pick<AdmissionCard, 'requestedWardId' | 'bedId'>): BedChoice[] {
  const ordered = [...wards].filter(ward => ward.active)
    .sort((a, b) => Number(b.wardId === card.requestedWardId) - Number(a.wardId === card.requestedWardId))
  return ordered.flatMap(ward => (ward.beds ?? [])
    .filter(bed => bed.status === 'available' && bed.active !== false && bed.bedId !== card.bedId)
    .map(bed => ({
      bedId: bed.bedId, ward,
      label: `${bed.kind === 'overflow' ? `Overflow: ${bed.name}` : bed.name} (${ward.name})`,
      place: `${ward.name}, ${bed.name}`,
    })))
}

/** Whether a ward that takes one sex differs from the patient's recorded sex (the member confirms, Q-ADT-12 A). */
export function sexDiffers(ward: Pick<Ward, 'takes'>, sex: string | null | undefined): boolean {
  if (ward.takes === 'any' || !sex) return false
  const recorded = sex.toLowerCase()
  return (recorded === 'male' || recorded === 'female') && recorded !== ward.takes
}

function BedForm({ facilityId, card, transfer, chartOpen, busy, onCancel, onSave }: {
  readonly facilityId: string
  readonly card: AdmissionCard
  readonly transfer: boolean
  readonly chartOpen: boolean
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onSave: (bedId: string, handover: string, confirm: boolean, place: string) => Promise<unknown>
}) {
  const [wards, setWards] = useState<Ward[] | null>(null)
  const [readError, setReadError] = useState('')
  const [bedId, setBedId] = useState('')
  const [handover, setHandover] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [mustConfirm, setMustConfirm] = useState(false)
  const [problem, setProblem] = useState('')

  const read = useCallback(async () => {
    try {
      const answer = await inpatientApi.wards(facilityId, { includeBeds: true })
      setWards(answer.items)
      setReadError('')
    } catch (caught) {
      if (isCancelled(caught)) return
      setReadError(refusalWords(caught, 'The free beds could not be loaded. Try again.'))
    }
  }, [facilityId])
  useEffect(() => { void read() }, [read])

  const choices = wards ? freeBeds(wards, card) : []
  const chosen = choices.find(choice => choice.bedId === bedId)
  const differs = chosen ? sexDiffers(chosen.ward, card.sex) : false

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!chosen) { setProblem('Choose a free bed or overflow space.'); return }
    const text = handover.trim()
    if (text) {
      const tooLong = lengthProblem(text, 1, 2000, 'the handover', true)
      if (tooLong) { setProblem(tooLong); return }
    }
    if ((differs || mustConfirm) && !confirm) { setProblem('Confirm that this patient may go on this ward.'); return }
    setProblem('')
    const answer = await onSave(chosen.bedId, text, confirm, chosen.place)
    if (isHidApiError(answer) && answer.code === 'WARD_SEX_MISMATCH') setMustConfirm(true)
    if (isHidApiError(answer) && answer.code === 'BED_NOT_AVAILABLE') { setBedId(''); void read() }
  }

  return (
    <form className="hid-ehr-dept-inpatient-form" noValidate onSubmit={event => void submit(event)} aria-labelledby="bed-form-title">
      <h3 id="bed-form-title">{transfer ? 'Transfer bed' : 'Admit and allocate bed'}</h3>
      {readError ? <DeptNotice role="alert" tone="critical">{readError}</DeptNotice> : null}
      {wards === null && !readError ? <p className="hid-ehr-state-message" role="status">Loading the free beds…</p> : null}
      {wards !== null && choices.length === 0 ? (
        <DeptNotice tone="caution">No bed or overflow space is free. Turn over a bed on Wards & Beds, or ask an admin to add an overflow space.</DeptNotice>
      ) : null}
      {choices.length > 0 ? (
        <EhrField label={transfer ? 'Move to' : 'Bed'} controlId="bed-choice" hint={transfer ? 'Any free bed, ICU included. The old bed goes to cleaning.' : 'The ward asked for comes first.'}>
          <EhrSelect value={bedId} onChange={event => { setBedId(event.target.value); setConfirm(false); setMustConfirm(false); setProblem('') }}>
            <option value="">Choose a bed</option>
            {choices.map(choice => <option key={choice.bedId} value={choice.bedId}>{choice.label}</option>)}
          </EhrSelect>
        </EhrField>
      ) : null}
      {chosen && (differs || mustConfirm) ? (
        <label className="hid-ehr-dept-inpatient-choices">
          <span>
            <input type="checkbox" checked={confirm} onChange={event => setConfirm(event.target.checked)} />{' '}
            {`${chosen.ward.name} takes ${takesText(chosen.ward.takes).toLowerCase()}. Put this patient here anyway.`}
          </span>
        </label>
      ) : null}
      {transfer ? (
        chartOpen ? (
          <EhrField label="Nursing handover (optional)" controlId="bed-handover" hint="Up to 2,000 characters. Read only by those who can open the chart.">
            <EhrTextarea value={handover} rows={3} maxLength={2000} onChange={event => setHandover(event.target.value)} />
          </EhrField>
        ) : <p className="hid-ehr-dept-inpatient-hint">To write a nursing handover with the move, open this patient’s record first.</p>
      ) : null}
      {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
      <div className="hid-ehr-dept-form-actions">
        <EhrButton type="submit" busy={busy} disabled={choices.length === 0}>{transfer ? 'Move patient' : 'Admit to this bed'}</EhrButton>
        <EhrButton variant="quiet" onClick={onCancel}>Cancel</EhrButton>
      </div>
    </form>
  )
}

// ---- Prepare discharge ----------------------------------------------------------------------------------

/**
 * The days an expected discharge may be, as the backend checks them (routes 15 and 18): from the Lagos day of admission
 * (of the request, while waiting for a bed) to a year from today in Lagos. Never the UTC day: 23:30 UTC on 1 Dec is
 * already 2 Dec in Lagos.
 */
export function expectedDayRange(card: Pick<AdmissionCard, 'admittedAt' | 'requestedAt'>, now: number = Date.now()): { readonly min: string; readonly max: string } {
  return { min: lagosDay(card.admittedAt ?? card.requestedAt), max: lagosDay(now + 365 * 86_400_000) }
}

/** The problem with an expected discharge day, or '' (none given is no problem). */
export function expectedDayProblem(value: string, range: { readonly min: string; readonly max: string }): string {
  if (!value) return ''
  if ((range.min && value < range.min) || (range.max && value > range.max)) {
    return `Choose an expected discharge date from ${dayText(range.min) || 'the admission day'} to ${dayText(range.max) || 'a year from today'}.`
  }
  return ''
}

/** The stay's prescriptions that can go home with the patient: none in error, cancelled or still a draft. */
export function dischargeMedicines(records: readonly ClinicalRecord[]): ClinicalRecord[] {
  return records.filter(record => !['entered_in_error', 'cancelled', 'draft'].includes(String(record.status ?? '')))
}

function PrepareForm({ facilityId, card, busy, onCancel, onSave }: {
  readonly facilityId: string
  readonly card: AdmissionCard
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onSave: (body: { followUpPlan: string; expectedDischargeOn?: string; dischargeMedicineIds?: string[] }) => Promise<unknown>
}) {
  const [plan, setPlan] = useState('')
  const [expected, setExpected] = useState(card.expectedDischargeOn ?? '')
  const [medicines, setMedicines] = useState<ClinicalRecord[] | null>(null)
  const [medicinesNote, setMedicinesNote] = useState('')
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  const [problem, setProblem] = useState('')
  const range = expectedDayRange(card)
  // Sent again while discharge ready, the plan and the medicines on discharge replace the ones saved before (route 15),
  // and the card does not carry them: the doctor is told to give them again.
  const again = card.status === 'discharge_ready'

  useEffect(() => {
    let live = true
    staffApi.records(facilityId, card.patientId, card.encounterId, 'prescriptions').then(page => {
      if (live) setMedicines(dischargeMedicines(page.items))
    }, () => {
      if (live) { setMedicines([]); setMedicinesNote('Open this patient’s record to choose the medicines on discharge.') }
    })
    return () => { live = false }
  }, [facilityId, card.patientId, card.encounterId])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = lengthProblem(plan, 1, 2000, 'the follow-up plan', true) || expectedDayProblem(expected, range)
    if (text) { setProblem(text); return }
    if (chosen.size > 50) { setProblem('Choose at most 50 medicines.'); return }
    setProblem('')
    await onSave({ followUpPlan: plan.trim(), ...(expected ? { expectedDischargeOn: expected } : {}),
      ...(chosen.size > 0 ? { dischargeMedicineIds: [...chosen] } : {}) })
  }

  return (
    <form className="hid-ehr-dept-inpatient-form" noValidate onSubmit={event => void submit(event)} aria-labelledby="prepare-title">
      <h3 id="prepare-title">{again ? 'Change the discharge plan' : 'Prepare discharge'}</h3>
      {again ? (
        <DeptNotice tone="caution">
          Saving replaces the follow-up plan and the medicines on discharge saved before. Write the plan again, and tick every medicine that goes home.
        </DeptNotice>
      ) : null}
      <EhrField label="Follow-up plan" controlId="prepare-plan" hint="Up to 2,000 characters: clinic review, tests to repeat, who to see.">
        <EhrTextarea value={plan} rows={3} maxLength={2000} onChange={event => setPlan(event.target.value)} />
      </EhrField>
      <EhrField label="Expected discharge date (optional)" controlId="prepare-expected">
        <EhrInput type="date" value={expected} min={range.min || undefined} max={range.max || undefined}
          onChange={event => setExpected(event.target.value)} />
      </EhrField>
      <fieldset className="hid-ehr-dept-inpatient-choices">
        <legend>Medicines on discharge</legend>
        {medicines === null ? <p className="hid-ehr-state-message" role="status">Loading the stay’s prescriptions…</p> : null}
        {medicinesNote ? <p className="hid-ehr-dept-inpatient-hint">{medicinesNote}</p> : null}
        {medicines !== null && medicines.length === 0 && !medicinesNote ? <p className="hid-ehr-dept-inpatient-hint">No prescriptions on this stay.</p> : null}
        {(medicines ?? []).map(record => (
          <label key={record.id}>
            <input type="checkbox" checked={chosen.has(record.id)} onChange={event => setChosen(previous => {
              const next = new Set(previous)
              if (event.target.checked) next.add(record.id)
              else next.delete(record.id)
              return next
            })} />
            <span>{[record.medicationDisplay, record.frequency].filter(value => typeof value === 'string' && value).join(' · ') || 'Medicine not named'}</span>
          </label>
        ))}
      </fieldset>
      {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
      <div className="hid-ehr-dept-form-actions">
        <EhrButton type="submit" busy={busy}>Save discharge plan</EhrButton>
        <EhrButton variant="quiet" onClick={onCancel}>Cancel</EhrButton>
      </div>
    </form>
  )
}

// ---- Discharge patient -----------------------------------------------------------------------------------

/** Routine and referred out only once prepared (409 DISCHARGE_NOT_PREPARED); the summary for routine, DAMA and referred out. */
export function needsPreparing(outcome: DischargeOutcome) { return outcome === 'routine' || outcome === 'referred_out' }
export function needsSummary(outcome: DischargeOutcome) { return outcome === 'routine' || outcome === 'dama' || outcome === 'referred_out' }

interface SummaryValues {
  presentingProblem: string; courseInHospital: string; proceduresDone: string; conditionAtDischarge: DischargeCondition | ''
  followUpPlan: string; patientAdvice: string
}
const EMPTY_SUMMARY: SummaryValues = {
  presentingProblem: '', courseInHospital: '', proceduresDone: '', conditionAtDischarge: '', followUpPlan: '', patientAdvice: '',
}

/** What the form sends, or the first problem with it. No outcome is ever assumed: the doctor chooses one. */
export function dischargeBody(outcome: DischargeOutcome | '', values: SummaryValues, extra: { dischargedAt: string; diedAt: string;
  referredTo: string; signature: string; admittedAt?: string | null }, now: number = Date.now()): DischargeInput | string {
  if (!outcome) return 'Choose the outcome.'
  const filled = values.presentingProblem.trim() !== '' || values.courseInHospital.trim() !== ''
  if (needsSummary(outcome) || filled) {
    const problem = lengthProblem(values.presentingProblem, 1, 4000, 'the presenting problem', true)
      || lengthProblem(values.courseInHospital, 1, 4000, 'the course in hospital', true)
    if (problem) return problem
    for (const [value, what] of [[values.proceduresDone, 'the procedures'], [values.followUpPlan, 'the follow-up plan'],
      [values.patientAdvice, 'the advice']] as const) {
      if (value.trim().length > 4000) return `Keep ${what} to 4,000 characters.`
    }
  }
  const at = extra.dischargedAt ? lagosInputToUtc(extra.dischargedAt) : null
  if (extra.dischargedAt) {
    const { earliest, latest } = dischargeTimeRange(extra.admittedAt, now)
    if (!at || Date.parse(at) > latest || Date.parse(at) < earliest) return DISCHARGE_TIME_WORDS
  }
  let diedAt: string | null = null
  if (outcome === 'died') {
    diedAt = extra.diedAt ? lagosInputToUtc(extra.diedAt) : null
    if (!diedAt) return 'Enter the time of death.'
    if (Date.parse(diedAt) > now) return 'The time of death cannot be in the future.'
  }
  if (outcome === 'referred_out') {
    const problem = lengthProblem(extra.referredTo, 2, 120, 'the facility’s name')
    if (problem) return problem
  }
  if (extra.signature.trim() !== SIGN_WORD) return 'Type SIGN to sign.'
  const summary = needsSummary(outcome) || filled ? {
    presentingProblem: values.presentingProblem.trim(), courseInHospital: values.courseInHospital.trim(),
    ...(values.proceduresDone.trim() ? { proceduresDone: values.proceduresDone.trim() } : {}),
    ...(values.conditionAtDischarge ? { conditionAtDischarge: values.conditionAtDischarge } : {}),
    ...(values.followUpPlan.trim() ? { followUpPlan: values.followUpPlan.trim() } : {}),
    ...(values.patientAdvice.trim() ? { patientAdvice: values.patientAdvice.trim() } : {}),
  } : undefined
  return {
    outcome, signature: SIGN_WORD,
    ...(at ? { dischargedAt: at } : {}),
    ...(summary ? { summary } : {}),
    ...(outcome === 'referred_out' ? { referredToFacilityName: extra.referredTo.trim() } : {}),
    ...(diedAt ? { diedAt } : {}),
  }
}

function DischargeForm({ card, busy, onCancel, onSave }: {
  readonly card: AdmissionCard
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onSave: (body: DischargeInput) => Promise<unknown>
}) {
  const prepared = card.status === 'discharge_ready'
  // A prepared discharge is most often routine. Otherwise nothing is chosen: a signed outcome (against medical advice,
  // say) is never one the doctor did not pick.
  const [outcome, setOutcome] = useState<DischargeOutcome | ''>(prepared ? 'routine' : '')
  const [values, setValues] = useState<SummaryValues>(EMPTY_SUMMARY)
  const [dischargedAt, setDischargedAt] = useState('')
  const [diedAt, setDiedAt] = useState('')
  const [referredTo, setReferredTo] = useState('')
  const [signature, setSignature] = useState('')
  const [problem, setProblem] = useState('')
  const change = (next: Partial<SummaryValues>) => setValues(previous => ({ ...previous, ...next }))
  const now = utcToLagosInput()
  const range = dischargeTimeRange(card.admittedAt)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const body = dischargeBody(outcome, values, { dischargedAt, diedAt, referredTo, signature, admittedAt: card.admittedAt })
    if (typeof body === 'string') { setProblem(body); return }
    setProblem('')
    await onSave(body)
  }

  return (
    <form className="hid-ehr-dept-inpatient-form" noValidate onSubmit={event => void submit(event)} aria-labelledby="discharge-title">
      <h3 id="discharge-title">Discharge patient</h3>
      <p className="hid-ehr-dept-inpatient-hint">A discharge never waits for the bill. Any balance stays on the bill after the patient leaves.</p>
      <fieldset className="hid-ehr-dept-inpatient-choices">
        <legend>Outcome</legend>
        {DISCHARGE_OUTCOMES.map(value => {
          const blocked = needsPreparing(value) && !prepared
          return (
            <label key={value}>
              <input type="radio" name="discharge-outcome" value={value} checked={outcome === value} disabled={blocked}
                onChange={() => { setOutcome(value); setProblem('') }} />
              <span>{OUTCOME_WORDS[value]}{blocked ? ' (prepare the discharge first)' : ''}</span>
            </label>
          )
        })}
      </fieldset>
      {!prepared ? <p className="hid-ehr-dept-inpatient-hint">A routine discharge or a referral to another facility needs Prepare discharge first.</p> : null}
      {outcome ? <p className="hid-ehr-dept-inpatient-hint">{OUTCOME_HINTS[outcome]}</p> : null}
      {outcome === 'referred_out' ? (
        <EhrField label="Facility the patient goes to" controlId="discharge-referred">
          <EhrInput value={referredTo} maxLength={120} onChange={event => setReferredTo(event.target.value)} />
        </EhrField>
      ) : null}
      {outcome === 'died' ? (
        <EhrField label="Time of death" controlId="discharge-died" hint="Lagos time, 24-hour clock.">
          <EhrInput type="datetime-local" value={diedAt} max={now} onChange={event => setDiedAt(event.target.value)} />
        </EhrField>
      ) : null}
      <EhrField label="Discharge time (optional)" controlId="discharge-at"
        hint="Lagos time, after admission and within the last 24 hours. Left empty, now.">
        <EhrInput type="datetime-local" value={dischargedAt} min={range.min} max={range.max} onChange={event => setDischargedAt(event.target.value)} />
      </EhrField>
      <fieldset className="hid-ehr-dept-inpatient-choices">
        <legend>{!outcome || needsSummary(outcome) ? 'Discharge summary' : 'Discharge summary (optional)'}</legend>
        <EhrField label="Presenting problem" controlId="discharge-problem">
          <EhrTextarea value={values.presentingProblem} rows={2} maxLength={4000} onChange={event => change({ presentingProblem: event.target.value })} />
        </EhrField>
        <EhrField label="Course in hospital" controlId="discharge-course">
          <EhrTextarea value={values.courseInHospital} rows={3} maxLength={4000} onChange={event => change({ courseInHospital: event.target.value })} />
        </EhrField>
        <EhrField label="Procedures done (optional)" controlId="discharge-procedures">
          <EhrTextarea value={values.proceduresDone} rows={2} maxLength={4000} onChange={event => change({ proceduresDone: event.target.value })} />
        </EhrField>
        <EhrField label="Condition at discharge (optional)" controlId="discharge-condition">
          <EhrSelect value={values.conditionAtDischarge} onChange={event => change({ conditionAtDischarge: event.target.value as DischargeCondition | '' })}>
            <option value="">Not given</option>
            {DISCHARGE_CONDITIONS.map(value => <option key={value} value={value}>{CONDITION_WORDS[value]}</option>)}
          </EhrSelect>
        </EhrField>
        <EhrField label="Follow-up plan (optional)" controlId="discharge-follow-up" hint="Left empty, the plan saved with Prepare discharge.">
          <EhrTextarea value={values.followUpPlan} rows={2} maxLength={4000} onChange={event => change({ followUpPlan: event.target.value })} />
        </EhrField>
        <EhrField label="Advice for the patient (optional)" controlId="discharge-advice">
          <EhrTextarea value={values.patientAdvice} rows={2} maxLength={4000} onChange={event => change({ patientAdvice: event.target.value })} />
        </EhrField>
      </fieldset>
      <EhrField label="Type SIGN to sign the discharge" controlId="discharge-sign" hint="The summary is signed in your name, and the patient sees it in their records.">
        <EhrInput value={signature} autoComplete="off" spellCheck={false} onChange={event => setSignature(event.target.value)} />
      </EhrField>
      {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
      <div className="hid-ehr-dept-form-actions">
        <EhrButton type="submit" busy={busy}>Sign and discharge</EhrButton>
        <EhrButton variant="quiet" onClick={onCancel}>Cancel</EhrButton>
      </div>
    </form>
  )
}

// ---- Cancel, change, reprint ------------------------------------------------------------------------------

function CancelForm({ busy, onCancel, onSave }: {
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onSave: (reason: string) => Promise<unknown>
}) {
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = lengthProblem(reason, 8, 500, 'why', true)
    if (text) { setProblem('Say why in at least 8 characters, and at most 500.'); return }
    setProblem('')
    await onSave(reason.trim())
  }
  return (
    <form className="hid-ehr-dept-inpatient-form" noValidate onSubmit={event => void submit(event)} aria-labelledby="cancel-title">
      <h3 id="cancel-title">Cancel the admission request</h3>
      <EhrField label="Why is the request cancelled?" controlId="cancel-reason" error={problem || undefined}>
        <EhrTextarea value={reason} rows={2} maxLength={500} onChange={event => setReason(event.target.value)} />
      </EhrField>
      <div className="hid-ehr-dept-form-actions">
        <EhrButton type="submit" variant="danger" busy={busy}>Cancel request</EhrButton>
        <EhrButton variant="quiet" onClick={onCancel}>Keep the request</EhrButton>
      </div>
    </form>
  )
}

function ChangeForm({ card, membershipId, busy, onCancel, onSave }: {
  readonly card: AdmissionCard
  readonly membershipId: string | undefined
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onSave: (change: AdmissionChange) => Promise<unknown>
}) {
  const [careTeam, setCareTeam] = useState(card.careTeam ?? '')
  const [reason, setReason] = useState(card.reasonHidden ? '' : card.reason ?? '')
  const [expected, setExpected] = useState(card.expectedDischargeOn ?? '')
  const mine = membershipId !== undefined && card.responsibleMembershipId?.toLowerCase() === membershipId.toLowerCase()
  const [takeOver, setTakeOver] = useState(false)
  const [problem, setProblem] = useState('')
  const range = expectedDayRange(card)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const change: AdmissionChange = {}
    if (careTeam.trim() !== (card.careTeam ?? '')) {
      const text = lengthProblem(careTeam, 1, 80, 'the care team')
      if (text) { setProblem(text); return }
      change.careTeam = careTeam.trim()
    }
    if (!card.reasonHidden && reason.trim() !== (card.reason ?? '')) {
      const text = lengthProblem(reason, 1, 300, 'the reason')
      if (text) { setProblem(text); return }
      change.reason = reason.trim()
    }
    if (expected && expected !== card.expectedDischargeOn) {
      const text = expectedDayProblem(expected, range)
      if (text) { setProblem(text); return }
      change.expectedDischargeOn = expected
    }
    if (takeOver && membershipId) change.responsibleMembershipId = membershipId
    if (Object.keys(change).length === 0) { setProblem('Change at least one detail.'); return }
    setProblem('')
    await onSave(change)
  }

  return (
    <form className="hid-ehr-dept-inpatient-form" noValidate onSubmit={event => void submit(event)} aria-labelledby="change-title">
      <h3 id="change-title">Change details</h3>
      {!card.reasonHidden ? (
        <EhrField label="Admission reason" controlId="change-reason">
          <EhrInput value={reason} maxLength={300} onChange={event => setReason(event.target.value)} />
        </EhrField>
      ) : null}
      <EhrField label="Care team" controlId="change-team">
        <EhrInput value={careTeam} maxLength={80} onChange={event => setCareTeam(event.target.value)} />
      </EhrField>
      <EhrField label="Expected discharge date" controlId="change-expected">
        <EhrInput type="date" value={expected} min={range.min || undefined} max={range.max || undefined} onChange={event => setExpected(event.target.value)} />
      </EhrField>
      {!mine && membershipId ? (
        <label className="hid-ehr-dept-inpatient-choices">
          <span><input type="checkbox" checked={takeOver} onChange={event => setTakeOver(event.target.checked)} /> Make me the responsible doctor</span>
        </label>
      ) : null}
      {problem ? <DeptNotice role="alert" tone="critical">{problem}</DeptNotice> : null}
      <div className="hid-ehr-dept-form-actions">
        <EhrButton type="submit" busy={busy}>Save changes</EhrButton>
        <EhrButton variant="quiet" onClick={onCancel}>Cancel</EhrButton>
      </div>
    </form>
  )
}

function ReprintForm({ busy, newborn, onCancel, onSave }: {
  readonly busy: boolean
  readonly newborn: boolean
  readonly onCancel: () => void
  readonly onSave: (reason: ReprintReason) => void
}) {
  const [reason, setReason] = useState<ReprintReason | ''>('')
  const [problem, setProblem] = useState('')
  return (
    <form className="hid-ehr-dept-inpatient-form" noValidate aria-labelledby="reprint-title" onSubmit={event => {
      event.preventDefault()
      if (!reason) { setProblem('Say why the band is being printed again.'); return }
      setProblem('')
      onSave(reason)
    }}>
      <h3 id="reprint-title">{newborn ? 'Print the newborn band again' : 'Print the wristband again'}</h3>
      <EhrField label="Why is it printed again?" controlId="reprint-reason" error={problem || undefined}>
        <EhrSelect value={reason} onChange={event => setReason(event.target.value as ReprintReason | '')}>
          <option value="">Choose a reason</option>
          {REPRINT_REASONS.map(value => <option key={value} value={value}>{REPRINT_WORDS[value]}</option>)}
        </EhrSelect>
      </EhrField>
      <div className="hid-ehr-dept-form-actions">
        <EhrButton type="submit" busy={busy}>{newborn ? 'Print newborn band' : 'Print wristband'}</EhrButton>
        <EhrButton variant="quiet" onClick={onCancel}>Cancel</EhrButton>
      </div>
    </form>
  )
}
