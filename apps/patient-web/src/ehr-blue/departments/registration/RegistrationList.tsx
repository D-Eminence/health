import { EhrBadge, EhrButton, EhrDataTable, EhrEmptyState, EhrField, EhrInput, type EhrDataTableColumn } from '@hid/ui/ehr'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { DeptLinkButton, DeptRecordName } from '../parts/DeptRecord'
import { FIELD, type Availability, type CaseLoading, type VisitCase } from './registrationModel'
import { ErrorBox, type FormProblems } from './registrationParts'
import { offersWithoutNin } from './withoutNin'
import {
  candidatesText, CAPABILITY_FAILED_TITLE, CAPABILITY_LOADING, CASE_ID_HINT, CASE_ID_LABEL, caseTitle, caseWhen, CHECK_AGAIN, CHECKING,
  COMPLETED, CONTINUE_TITLE, CREATE_RECORD, DESCRIPTION, EYEBROW, LOAD_CASE, LOADING, NIN_NOT_ENABLED, NIN_OFF_TITLE, NIN_OFF_WITHOUT_NIN,
  NO_VISIT_MESSAGE, NO_VISIT_TITLE, statusLabel, TITLE, TRY_AGAIN, VISIT_CAPTION,
} from './registrationText'

/**
 * The design's list view (patients-1-list) on today's page: its heading with "Create record", classic's notice when NIN
 * checks are not working, and classic's "Continue a registration" in place of the design's search card. Today has no case list
 * (Registration.tsx 241: Identity does not provide one), so the card reopens a case by its reference and lists the
 * cases found or made during this visit, from memory, by the person's name and when.
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
        <DeptRecordName id={`registration-visit-${visit.seq}-open`} name={caseTitle(visit.name)}
          reference={caseWhen(visit.started, visit.at)} onOpen={() => onOpen(visit)} />
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
      <DeptSection title={CONTINUE_TITLE} className="hid-ehr-dept-list-card">
        {/* Registration.tsx 219-226: classic's "Continue a registration", its field, hint, button and words. */}
        <form className="hid-ehr-dept-registration-find" noValidate onSubmit={event => { event.preventDefault(); onFind() }}>
          <EhrField label={CASE_ID_LABEL} controlId={FIELD.caseId} hint={CASE_ID_HINT} error={problems.error(FIELD.caseId)}>
            {/* The button beside the field, as the design's search spans its card; the field's error goes under both. */}
            <div className="hid-ehr-dept-registration-find-row">
              <EhrInput value={caseIdInput} onChange={event => onCaseIdInput(event.target.value)} autoComplete="off" spellCheck={false} required />
              <EhrButton type="submit" variant="secondary" busy={caseLoading === 'find'} className="hid-ehr-dept-registration-unavailable"
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

/**
 * Classic's card on whether NIN checks work (Registration.tsx 227-230), as the design's notice: only when they are not
 * working, as a working service needs no card. A read that failed says so with "Try again"; NIN checks that are off say
 * so with "Check again"; while the first read runs, one line says it is checking.
 */
function AvailabilityNotice({ availability }: { readonly availability: Availability }) {
  const { capabilities, error, loading, refresh } = availability
  if (!error && !capabilities) return <p className="hid-ehr-dept-muted" role="status">{CAPABILITY_LOADING}</p>
  if (!error && capabilities?.nin.enabled) return null
  return (
    <DeptNotice tone={error ? 'critical' : 'caution'} title={error ? CAPABILITY_FAILED_TITLE : NIN_OFF_TITLE}
      className="hid-ehr-dept-registration-availability">
      <div className="hid-ehr-dept-registration-availability-row">
        <div>{error ? <p role="alert">{error}</p> : <p>{offersWithoutNin(capabilities) ? NIN_OFF_WITHOUT_NIN : NIN_NOT_ENABLED}</p>}</div>
        {/* Unavailable while it reads, not disabled: a disabled button would lose the focus it has. */}
        <EhrButton variant="secondary" size="sm" busy={loading} onClick={refresh}>{loading ? CHECKING : error ? TRY_AGAIN : CHECK_AGAIN}</EhrButton>
      </div>
    </DeptNotice>
  )
}
