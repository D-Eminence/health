import { EhrCard } from '@hid/ui/ehr'
import { Link } from 'react-router-dom'
import { Badge } from '../../../kasuwa/ui'
import type { ClinicalRecord } from '../../../staff/api'
import type { Chart } from '../parts/chart'
import { formatWhen } from '../parts/format'
import { ErrorBox, Loading } from '../parts/Notices'
import { StatusBadge } from '../parts/StatusBadge'
import { useWorkspaceHref } from '../parts/Workspace'
import { recordKey } from '../triage/records'
import { Readings } from '../triage/TriageList'
import {
  CORRECTION_UNREAD, LOADING_CORRECTION, RETRACTED_TEXT, correctionNumber, isRetracted, useCorrections, vitalName, vitalStatus,
} from '../triage/vitals'
import { ListPaging } from './Notes'
import type { RecordList } from './records'

/** Today's Vitals tab: its heading and its empty list (staff/routes/Clinical.tsx:27, :1850, :1853), saying consultation. */
export const VITALS_TITLE = 'Vitals'
export const NO_VITALS = 'No vitals for this consultation.'
/** The words the Patients page and the sidebar already use for the vitals form. */
export const RECORD_VITALS = 'Record vitals'

/**
 * The encounter's vitals (today's Vitals tab, Clinical.tsx:1849-1858), newest first, on today's record pages, 50 to a
 * page: each with its values and units, its status, and the time it was recorded. A corrected vital shows its current
 * correction (read as today's VitalPanel reads it, Clinical.tsx:770-780), its reason and time, and what was first
 * recorded; one whose correction can't be read says so and shows what was first recorded. Each opens its own page in
 * Triage & Vitals, where it is corrected. Nothing is read here: the list is the encounter page's own.
 */
export function VitalsCard({ chart, encounterId, list, canRecord }: {
  chart: Chart
  encounterId: string
  list: RecordList<ClinicalRecord>
  /** The role may add vitals (with write access to the patient): the card links to the vitals form, where the visit is chosen. */
  canRecord: boolean
}) {
  const href = useWorkspaceHref()
  const corrections = useCorrections(chart, list.items?.map(vital => ({ encounterId, vital })) ?? null)
  const vitals = list.items ?? []

  return (
    <EhrCard
      title={VITALS_TITLE}
      actions={canRecord ? <Link className="hid-ehr-clinical-link" to={href.to('triage', 'new')}>{RECORD_VITALS}</Link> : undefined}
    >
      {list.error ? <ErrorBox>{list.error}</ErrorBox> : null}
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
              </li>
            )
          })}
        </ul>
      )}
    </EhrCard>
  )
}
