import { isHidApiError } from '@hid/http'
import { EhrButton, EhrCard } from '@hid/ui/ehr'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../../../kasuwa/ui'
import { staffApi, type ClinicalRecord } from '../../../staff/api'
import { refusalText } from '../../../staff/fieldProblem'
import type { SubmitOutcome } from '../parts/RecordForm'
import type { Chart } from '../parts/chart'
import { formatWhen } from '../parts/format'
import { ErrorBox, Loading } from '../parts/Notices'
import { StatusBadge } from '../parts/StatusBadge'
import { useWorkspaceHref } from '../parts/Workspace'
import { RELOAD_FAILED, recordKey, refusedFieldErrors } from '../triage/records'
import { Readings } from '../triage/TriageList'
import {
  CHANGED_SINCE, CLOSE_CORRECTION, CORRECTION_FAILED, CORRECTION_HINT, CORRECTION_SAVED, CORRECTION_UNREAD, CORRECT_LABEL, LOADING_CORRECTION,
  RELOAD_FIRST, RETRACTED_SINCE, RETRACTED_TEXT, SAVE_CORRECTION, VITAL_FIELDS, correctionNumber, currentValues, isRetracted, reloadSentence,
  useCorrections, vitalName, vitalStatus, type Corrections,
} from '../triage/vitals'
import { VitalsForm, type VitalsInput } from '../triage/VitalsForm'
import { rowVersion } from './encounters'
import { ListPaging } from './Notes'
import { fromHere } from '../parts/cameFrom'
import type { RecordList } from './records'

/** Classic's Vitals tab: its heading and its empty list (staff/routes/Clinical.tsx:27, :1853), word for word. */
export const VITALS_TITLE = 'Vitals'
export const NO_VITALS = 'No vitals for this encounter.'
/** The words the Patients page and the sidebar already use for the vitals form. */
export const RECORD_VITALS = 'Record vitals'

/**
 * The encounter's vitals (today's Vitals tab, Clinical.tsx:1849-1858), newest first, on today's record pages, 50 to a
 * page: each with its values and units, its status, and the time it was recorded. A corrected vital shows its current
 * correction (read as today's VitalPanel reads it, Clinical.tsx:770-780), its reason and time, and what was first
 * recorded; one whose correction can't be read says so and shows what was first recorded. Each opens its own page in
 * Triage & Vitals. Each row also has classic's inline "Correct these vitals" / "Close correction" (VitalPanel,
 * Clinical.tsx:760-796), for a role that may write vitals under a grant that allows changes, on a vital whose current
 * values are known and that was not entered in error. Nothing is read here but a vital's corrections: the list is the
 * encounter page's own, read again after a correction.
 */
export function VitalsCard({ chart, encounterId, list, canRecord }: {
  chart: Chart
  encounterId: string
  list: RecordList<ClinicalRecord>
  /** The role may add vitals (with write access to the patient): the card links to the vitals form, with this visit chosen. */
  canRecord: boolean
}) {
  const href = useWorkspaceHref()
  const corrections = useCorrections(chart, list.items?.map(vital => ({ encounterId, vital })) ?? null)
  const vitals = list.items ?? []
  const canCorrect = chart.canWrite && chart.can('ehr.vital.write')
  const [said, setSaid] = useState<{ readonly text: string; readonly error: boolean } | null>(null)

  return (
    <EhrCard
      title={VITALS_TITLE}
      // Today's Add vitals saves to the encounter shown (Clinical.tsx:1898): the form opens with this visit chosen. Only
      // its record id goes, in router state, as Home's order link and the OCR hand-off do; never in the address.
      actions={canRecord ? <Link className="hid-ehr-clinical-link" to={href.to('triage', 'new')} state={fromHere(href(encounterId), 'Back to consultation', { visitId: encounterId })}>{RECORD_VITALS}</Link> : undefined}
    >
      {list.error ? <ErrorBox>{list.error}</ErrorBox> : null}
      {said?.error ? <ErrorBox>{said.text}</ErrorBox> : null}
      <div className="hid-ehr-clinical-status" role="status">{said && !said.error ? said.text : ''}</div>
      <ListPaging list={list} />
      {list.items === null ? (list.loading ? <Loading label="Loading records…" /> : null) : vitals.length === 0 ? <p>{NO_VITALS}</p> : (
        <ul className="hid-ehr-clinical-history-list">
          {vitals.map(vital => {
            const read = corrections(vital)
            const latest = read.state === 'shown' ? read.latest : null
            const retracted = isRetracted(vital)
            const recorded = formatWhen(vital.createdAt)
            return (
              <li key={vital.id} className="hid-ehr-clinical-consult-record">
                <div className="hid-ehr-clinical-history-row">
                  <span>
                    <strong><Link className="hid-ehr-clinical-link" to={href.to('triage', recordKey(encounterId, vital.id))}>{vitalName(vital)}</Link></strong>
                    {retracted ? <span className="hid-ehr-clinical-cell-sub">{RETRACTED_TEXT}</span> : null}
                    {correctionNumber(vital) === 0 ? <span className="hid-ehr-clinical-cell-sub"><Readings values={vital} /></span> : null}
                    {read.state === 'loading' ? <span className="hid-ehr-clinical-cell-sub" role="status">{LOADING_CORRECTION}</span> : null}
                    {latest ? (
                      <>
                        <span className="hid-ehr-clinical-cell-sub">Corrected (correction {latest.correctionNo}): <Readings values={latest.replacementValues} /></span>
                        <span className="hid-ehr-clinical-cell-sub">Reason: {latest.reason}</span>
                        {formatWhen(latest.createdAt) ? <span className="hid-ehr-clinical-cell-sub">Corrected at: {formatWhen(latest.createdAt)}</span> : null}
                      </>
                    ) : null}
                    {read.state === 'failed' ? <span className="hid-ehr-clinical-cell-sub" role="alert">{`${CORRECTION_UNREAD} ${read.message}`}</span> : null}
                    {correctionNumber(vital) > 0 ? <span className="hid-ehr-clinical-cell-sub">Originally recorded: <Readings values={vital} /></span> : null}
                    {recorded ? <span className="hid-ehr-clinical-cell-sub">Recorded: {recorded}</span> : null}
                  </span>
                  {/* Today's warning badge for vitals entered in error; the shared status map has no tone for it. */}
                  {retracted ? <Badge size="sm" tone="warn">Entered in error</Badge> : <StatusBadge status={vitalStatus(vital)} />}
                </div>
                {canCorrect && !retracted ? (
                  <VitalCorrection
                    key={`${vital.id}-${String(vital.rowVersion)}`}
                    chart={chart} encounterId={encounterId} vital={vital} corrections={read} list={list}
                    onSaid={(text, error) => setSaid(text ? { text, error } : null)}
                  />
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </EhrCard>
  )
}


/**
 * Classic's inline correction under one vital (VitalPanel and correctVital, staff/routes/Clinical.tsx:760-796,
 * :1738-1760): "Correct these vitals" opens the triage vitals form with the current values, "Close correction" closes
 * it. A save re-checks access, appends the correction with one key per attempt, and reads the visit's vitals again;
 * one refused because the vital changed (412) or was entered in error (409 VITAL_NOT_AMENDABLE) reads them again and
 * says so in classic's words. Offered only once the current values are known: nothing is corrected from values not seen.
 */
function VitalCorrection({ chart, encounterId, vital, corrections, list, onSaid }: {
  chart: Chart
  encounterId: string
  vital: ClinicalRecord
  corrections: Corrections
  list: RecordList<ClinicalRecord>
  onSaid: (text: string, error: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const attempt = useRef<{ signature: string; key: string } | null>(null)
  const current = currentValues(vital, corrections)
  if (!current) return null
  // While the visit's vitals are read again a closed correction does not open (classic's disabled={recordsLoading}).
  const locked = list.loading && !open

  const amend = async ({ values, reason }: VitalsInput): Promise<SubmitOutcome> => {
    const expectedRowVersion = rowVersion(vital.rowVersion)
    if (expectedRowVersion === null) return { formError: RELOAD_FIRST }
    const signature = JSON.stringify([values, reason])
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    onSaid('', false)
    try {
      await chart.verify()
      await staffApi.correctVital(chart.facilityId, chart.patientId, encounterId, vital.id, { expectedRowVersion, changeReason: reason, replacementValues: values }, attempt.current.key)
    } catch (caught) {
      if (isHidApiError(caught) && (caught.status === 412 || caught.code === 'VITAL_NOT_AMENDABLE')) {
        attempt.current = null
        const failed = await list.reload()
        const reloaded = failed === null ? { items: [] } : { failed }
        onSaid(`${caught.code === 'VITAL_NOT_AMENDABLE' ? RETRACTED_SINCE : CHANGED_SINCE}${reloadSentence(reloaded, 'vitals', true)}`, true)
        setOpen(false)
        return
      }
      return {
        formError: refusalText(caught, CORRECTION_FAILED),
        fieldErrors: refusedFieldErrors(caught, name => {
          const measurement = name.replace(/^replacementValues\./, '')
          return VITAL_FIELDS.some(field => field.name === measurement) ? measurement : name === 'changeReason' ? 'reason' : undefined
        }),
      }
    }
    attempt.current = null
    setOpen(false)
    onSaid(CORRECTION_SAVED, false)
    const failed = await list.reload()
    if (failed !== null) onSaid(`${RELOAD_FAILED} ${failed}`.trim(), true)
  }

  return (
    <div className="hid-ehr-clinical-consult-edit">
      <EhrButton variant="secondary" size="sm" aria-expanded={open} aria-disabled={locked || undefined}
        onClick={() => { if (!locked) setOpen(value => !value) }}>{open ? CLOSE_CORRECTION : CORRECT_LABEL}</EhrButton>
      {open ? (
        <VitalsForm
          mode="correct"
          current={current}
          hint={CORRECTION_HINT}
          groupLabel="Corrected vital measurements"
          submitLabel={SAVE_CORRECTION}
          onSubmit={amend}
        />
      ) : null}
    </div>
  )
}
