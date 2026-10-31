import { EhrBadge, EhrButton, EhrDataTable, EhrEmptyState, EhrField, EhrInput, type EhrDataTableColumn } from '@hid/ui/ehr'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { DeptLinkButton, DeptRecordName } from '../parts/DeptRecord'
import { FIELD, type Availability, type CaseLoading, type VisitCase } from './registrationModel'
import { ErrorBox, type FormProblems } from './registrationParts'
import {
  AVAILABILITY_TITLE, candidatesText, CAPABILITY_LOADING, CASE_ID_LABEL, caseTitle, CHECK_AGAIN, CHECKING, COMPLETED, CREATE_RECORD,
  DESCRIPTION, EYEBROW, FIND_TEXT, FIND_TITLE, LOAD_CASE, LOADING, NO_VISIT_MESSAGE, NO_VISIT_TITLE, ninEnabledText, ninNotEnabledText,
  statusLabel, TITLE, VISIT_CAPTION,
} from './registrationText'

/** A case's short reference, as the design's lists show a record's: its first eight characters. */
const reference = (caseId: string) => caseId.slice(0, 8)

/**
 * The design's list view (patients-1-list) on today's page: its heading with "Create record", today's "Verification
 * availability" as a notice, and "Find registration case" in place of the design's search card. Today has no case list
 * (Registration.tsx 241: the backend does not provide one), so the card loads a case by its ID and lists the cases
 * found or made during this visit, from memory.
 */
export function RegistrationList({ availability, caseIdInput, onCaseIdInput, caseLoading, busy, problems, error, message, visits, onFind, onNew, onOpen }: {
  readonly availability: Availability
  readonly caseIdInput: string
  readonly onCaseIdInput: (value: string) => void
  /** The case read running, if any: Load case says "Loading…" for its own. */
  readonly caseLoading: CaseLoading
  readonly busy: boolean
  readonly problems: FormProblems
  /** What the last load's refusal said. */
  readonly error: string
  /** What the last step said, shown here too (the page's status region says it once). */
  readonly message: string
  readonly visits: readonly VisitCase[]
  readonly onFind: () => void
  readonly onNew: () => void
  readonly onOpen: (visit: VisitCase) => void
}) {
  const columns: EhrDataTableColumn<VisitCase>[] = [
    {
      id: 'record', header: 'Record', cell: visit => (
        <DeptRecordName id={`registration-visit-${visit.seq}-open`} name={caseTitle(reference(visit.item.caseId))}
          reference={visit.item.caseId} onOpen={() => onOpen(visit)} />
      ),
    },
    {
      id: 'context', header: 'Patient / context', cell: visit => visit.item.patient
        ? <>Health ID: {visit.item.patient.hid}</>
        : candidatesText(visit.item),
    },
    {
      id: 'status', header: 'Status', cell: visit => (
        <EhrBadge tone={COMPLETED.has(visit.item.status) ? 'positive' : 'brand'}>{statusLabel(visit.item.status)}</EhrBadge>
      ),
    },
    { id: 'version', header: 'Version', cell: visit => visit.item.version },
    {
      id: 'actions', header: <span className="hid-ehr-sr-only">Actions</span>, cell: visit => (
        <div className="hid-ehr-dept-table-actions">
          <DeptLinkButton describedBy={`registration-visit-${visit.seq}-open`} onClick={() => onOpen(visit)}>Open <span aria-hidden="true">→</span></DeptLinkButton>
        </div>
      ),
    },
  ]

  return (
    <DeptPage eyebrow={EYEBROW} title={TITLE} description={DESCRIPTION} className="hid-ehr-dept-registration-page"
      primaryAction={<EhrButton onClick={onNew}>{CREATE_RECORD}</EhrButton>}>
      <AvailabilityNotice availability={availability} />
      {message ? <DeptNotice tone="positive">{message}</DeptNotice> : null}
      <DeptSection title={FIND_TITLE} className="hid-ehr-dept-list-card">
        <p className="hid-ehr-dept-muted">{FIND_TEXT}</p>
        <form className="hid-ehr-dept-registration-find" noValidate onSubmit={event => { event.preventDefault(); onFind() }}>
          <EhrField label={CASE_ID_LABEL} controlId={FIELD.caseId} error={problems.error(FIELD.caseId)}>
            {/* The button beside the field, as the design's search spans its card; the field's error goes under both. */}
            <div className="hid-ehr-dept-registration-find-row">
              <EhrInput value={caseIdInput} onChange={event => onCaseIdInput(event.target.value)} autoComplete="off" spellCheck={false} required />
              <EhrButton type="submit" busy={caseLoading === 'find'} className="hid-ehr-dept-registration-unavailable"
                aria-disabled={busy || caseLoading !== null || undefined}>
                {caseLoading === 'find' ? LOADING : LOAD_CASE}
              </EhrButton>
            </div>
          </EhrField>
        </form>
        <ErrorBox message={error} />
        {visits.length === 0
          ? <EhrEmptyState title={NO_VISIT_TITLE} message={NO_VISIT_MESSAGE} />
          : <EhrDataTable caption={VISIT_CAPTION} captionHidden columns={columns} rows={visits} rowKey={visit => String(visit.seq)} />}
      </DeptSection>
    </DeptPage>
  )
}

/** Today's "Verification availability" card (Registration.tsx 220-227), as the design's notice, with "Check again". */
function AvailabilityNotice({ availability }: { readonly availability: Availability }) {
  const { capabilities, error, loading, refresh } = availability
  const tone = error ? 'critical' : capabilities && !capabilities.nin.enabled ? 'caution' : 'info'
  return (
    <DeptNotice tone={tone} title={AVAILABILITY_TITLE} className="hid-ehr-dept-registration-availability">
      <div className="hid-ehr-dept-registration-availability-row">
        <div>
          {error ? <p role="alert">{error}</p> : null}
          {!capabilities && !error ? <p>{CAPABILITY_LOADING}</p> : null}
          {capabilities ? <p>{capabilities.nin.enabled ? ninEnabledText(capabilities.nin.state) : ninNotEnabledText(capabilities.nin.state)}</p> : null}
        </div>
        {/* Unavailable while it reads, not disabled: a disabled button would lose the focus it has. */}
        <EhrButton variant="secondary" size="sm" busy={loading} onClick={refresh}>{loading ? CHECKING : CHECK_AGAIN}</EhrButton>
      </div>
    </DeptNotice>
  )
}
