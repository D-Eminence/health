import { useState } from 'react'
import { EhrBadge, EhrButton, EhrDataTable, EhrEmptyState, EhrField, EhrInput, EhrSelect, type EhrDataTableColumn } from '@hid/ui/ehr'
import type { RegistrationCaseListItem } from '../../../staff/api'
import { FilterTabs } from '../../../kasuwa/ui'
import { useFocusById } from '../../../staff/focus'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { DeptLinkButton, DeptRecordName } from '../parts/DeptRecord'
import { dateText } from '../parts/format'
import { FIELD, visitWhen, type Availability, type CaseLoading, type VisitCase } from './registrationModel'
import type { CaseFilter, RegistrationCases } from './registrationCases'
import { ErrorBox, type FormProblems } from './registrationParts'
import { offersWithoutNin } from './withoutNin'
import {
  ALL_EMPTY, ALL_LOADED, ALL_STATUSES, ALL_TITLE, bornText, candidatesText, CAPABILITY_FAILED_TITLE, CAPABILITY_LOADING, CASE_ID_HINT,
  CASE_ID_LABEL, caseTitle, caseWhen, CHECK_AGAIN, CHECKING, COMPLETED, CREATE_RECORD, DESCRIPTION, EVIDENCE_CHOICES, EVIDENCE_FILTER,
  EYEBROW, FILTERED_EMPTY, FILTERED_EMPTY_TITLE, FIND_TITLE, LIST_CHOICE, LIST_EMPTY_TITLE, LIST_LOADING, LIST_TITLE, LOAD_CASE,
  LOAD_MORE, LOADING, LOADING_MORE, MINE_EMPTY, MINE_TITLE, MORE_ADDED, NIN_FACT, NIN_NOT_ENABLED, NIN_OFF_TITLE, NIN_OFF_WITHOUT_NIN,
  NO_HID_YET, ninStatusText, OPENING, STARTED_BY_YOU, STATUS_CHOICES, STATUS_FILTER, statusLabel, TITLE, TRY_AGAIN, UPDATED,
  VISIT_CAPTION,
} from './registrationText'

/** The id of a list row's name button, by its place in the list (never its case ID): focus returns here from the record. */
export const listRowId = (index: number) => `registration-case-${index}-open`
const LIST_END_ID = 'registration-list-end'
const LIST_NOTICE_ID = 'registration-list-notice'
/** The id of a this-visit row's name button. */
export const visitRowId = (seq: number) => `registration-visit-${seq}-open`

/**
 * The design's list view (patients-1-list) on today's page: its heading with "Create record", classic's notice when NIN
 * checks are not working, the registration list (SX-10: "My registrations", and "All registrations" for approvers) in
 * the design's table, and "Find registration case" under it, which opens a registration by its Registration ID and
 * lists the ones opened on this visit that the list does not show.
 */
export function RegistrationList({ availability, cases, caseIdInput, onCaseIdInput, caseLoading, busy, problems, error, listError, message, visits,
  onFind, onNew, onOpen, onOpenListed }: {
  readonly availability: Availability
  readonly cases: RegistrationCases
  readonly caseIdInput: string
  readonly onCaseIdInput: (value: string) => void
  /** The case read running, if any: Load case says "Loading…" for its own, a list row for its own. */
  readonly caseLoading: CaseLoading
  readonly busy: boolean
  readonly problems: FormProblems
  /** What the last load's refusal said. */
  readonly error: string
  /** What the last opening of a list row's refusal said. */
  readonly listError: string
  /** What the last step said, shown here too (the page's status region says it once). */
  readonly message: string
  readonly visits: readonly VisitCase[]
  readonly onFind: () => void
  readonly onNew: () => void
  readonly onOpen: (visit: VisitCase) => void
  readonly onOpenListed: (item: RegistrationCaseListItem) => void
}) {
  const listed = cases.list.kind === 'ready' ? new Set(cases.list.items.map(item => item.caseId)) : new Set<string>()
  // A registration opened here that the list shows is listed there only.
  const others = visits.filter(visit => !listed.has(visit.item.caseId))
  const columns: EhrDataTableColumn<VisitCase>[] = [
    {
      id: 'record', header: 'Record', cell: visit => {
        const when = visitWhen(visit)
        return <DeptRecordName id={visitRowId(visit.seq)} name={caseTitle(visit.name)} reference={caseWhen(when.started, when.at)} onOpen={() => onOpen(visit)} />
      },
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
          <DeptLinkButton describedBy={visitRowId(visit.seq)} onClick={() => onOpen(visit)}>Open <span aria-hidden="true">→</span></DeptLinkButton>
        </div>
      ),
    },
  ]

  return (
    <DeptPage eyebrow={EYEBROW} title={TITLE} description={DESCRIPTION} className="hid-ehr-dept-registration-page"
      primaryAction={<EhrButton onClick={onNew}>{CREATE_RECORD}</EhrButton>}>
      <AvailabilityNotice availability={availability} />
      {message ? <DeptNotice tone="positive">{message}</DeptNotice> : null}
      <CaseList cases={cases} caseLoading={caseLoading} busy={busy} error={listError} onOpen={onOpenListed} />
      <DeptSection title={FIND_TITLE} className="hid-ehr-dept-list-card">
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
        {others.length > 0
          ? <EhrDataTable caption={VISIT_CAPTION} columns={columns} rows={others} rowKey={visit => String(visit.seq)} />
          : null}
      </DeptSection>
    </DeptPage>
  )
}

/**
 * The registration list (SX-10): which list (approvers only), its filters, the rows in the design's table, and "Load
 * more" while Identity sends a next page. A row's name and its Open both open the registration (GET :caseId).
 */
function CaseList({ cases, caseLoading, busy, error, onOpen }: {
  readonly cases: RegistrationCases
  readonly caseLoading: CaseLoading
  readonly busy: boolean
  readonly error: string
  readonly onOpen: (item: RegistrationCaseListItem) => void
}) {
  const { filter, list, notice, canSeeAll, choose, reload } = cases
  // What "Load more" added, announced. After the last page, focus goes to the line that says every one is shown; after
  // a page link Identity did not issue, to the notice that says the list was read again (the button is gone either way).
  const [said, setSaid] = useState('')
  const focus = useFocusById()
  const all = filter.view === 'facility'
  const filtered = filter.status !== '' || filter.evidence !== ''
  const items = list.kind === 'ready' ? list.items : []
  const opening = caseLoading !== null && typeof caseLoading === 'object' ? caseLoading.caseId : null
  const open = (item: RegistrationCaseListItem) => { if (caseLoading === null && !busy) onOpen(item) }

  async function loadMore() {
    setSaid('')
    const answer = await cases.loadMore()
    if (answer === 'more') setSaid(MORE_ADDED)
    else if (answer === 'end') focus(LIST_END_ID)
    else if (answer === 'restarted') focus(LIST_NOTICE_ID)
  }

  const columns: EhrDataTableColumn<{ readonly item: RegistrationCaseListItem; readonly row: number }>[] = [
    {
      id: 'patient', header: 'Patient', cell: ({ item, row }) => (
        <DeptRecordName id={listRowId(row)} name={item.fullName} onOpen={() => open(item)}
          // "Started by you" wherever the member started it: nobody else who started one is named.
          reference={[bornText(item.dateOfBirth), item.createdByMe ? STARTED_BY_YOU : null].filter(Boolean).join(' · ')} />
      ),
    },
    { id: 'hid', header: 'Health ID', cell: ({ item }) => item.patient?.hid ?? <span className="hid-ehr-dept-muted">{NO_HID_YET}</span> },
    { id: 'nin', header: NIN_FACT, cell: ({ item }) => (item.ninStatus ? ninStatusText(item.ninStatus) : null) },
    {
      id: 'status', header: 'Status', cell: ({ item }) => (
        <EhrBadge tone={COMPLETED.has(item.status) ? 'positive' : 'brand'}>{statusLabel(item.status)}</EhrBadge>
      ),
    },
    { id: 'updated', header: UPDATED, cell: ({ item }) => dateText(item.updatedAt) },
    {
      id: 'actions', header: <span className="hid-ehr-sr-only">Actions</span>, cell: ({ item, row }) => (
        <div className="hid-ehr-dept-table-actions">
          <DeptLinkButton describedBy={listRowId(row)} onClick={() => open(item)}>
            {opening === item.caseId ? OPENING : <>Open <span aria-hidden="true">→</span></>}
          </DeptLinkButton>
        </div>
      ),
    },
  ]

  return (
    <DeptSection title={canSeeAll ? LIST_TITLE : MINE_TITLE}
      className="hid-ehr-dept-list-card hid-ehr-dept-registration-list">
      {canSeeAll ? (
        <FilterTabs label={LIST_CHOICE} value={filter.view} onChange={view => choose({ view })}
          options={[{ value: 'mine', label: MINE_TITLE }, { value: 'facility', label: ALL_TITLE }]} />
      ) : null}
      {notice ? <DeptNotice id={LIST_NOTICE_ID} tabIndex={-1} tone="caution">{notice}</DeptNotice> : null}
      <div className="hid-ehr-dept-registration-filters">
        <EhrField label={STATUS_FILTER} controlId="registration-list-status">
          <EhrSelect value={filter.status} onChange={event => choose({ status: event.target.value as CaseFilter['status'] })}>
            <option value="">{ALL_STATUSES}</option>
            {STATUS_CHOICES.map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}
          </EhrSelect>
        </EhrField>
        {canSeeAll ? (
          <EhrField label={EVIDENCE_FILTER} controlId="registration-list-evidence">
            <EhrSelect value={filter.evidence} onChange={event => choose({ evidence: event.target.value as CaseFilter['evidence'] })}>
              {EVIDENCE_CHOICES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </EhrSelect>
          </EhrField>
        ) : null}
      </div>
      <ErrorBox message={error} />
      {list.kind === 'loading' ? <p className="hid-ehr-dept-muted" role="status">{LIST_LOADING}</p> : null}
      {list.kind === 'error' ? (
        <DeptNotice role="alert" tone="critical">
          <div className="hid-ehr-dept-registration-availability-row">
            <p>{list.text}</p>
            <EhrButton variant="secondary" size="sm" onClick={reload}>{TRY_AGAIN}</EhrButton>
          </div>
        </DeptNotice>
      ) : null}
      {list.kind === 'ready' && items.length === 0 ? (
        <EhrEmptyState title={filtered ? FILTERED_EMPTY_TITLE : LIST_EMPTY_TITLE} message={filtered ? FILTERED_EMPTY : all ? ALL_EMPTY : MINE_EMPTY} />
      ) : null}
      {items.length > 0 ? (
        <EhrDataTable caption={all ? ALL_TITLE : MINE_TITLE} captionHidden columns={columns}
          rows={items.map((item, row) => ({ item, row }))} rowKey={({ item }) => item.caseId} />
      ) : null}
      {list.kind === 'ready' && (list.nextCursor || list.moreError) ? (
        <div className="hid-ehr-dept-registration-more-rows">
          {list.moreError ? <p role="alert" className="hid-ehr-dept-registration-error">{list.moreError}</p> : null}
          {list.nextCursor ? (
            // Unavailable while it reads, not disabled, so it keeps its focus as each page is added.
            <EhrButton variant="secondary" busy={list.moreLoading} className="hid-ehr-dept-registration-unavailable"
              aria-disabled={list.moreLoading || undefined} onClick={() => { if (!list.moreLoading) void loadMore() }}>
              {list.moreLoading ? LOADING_MORE : LOAD_MORE}
            </EhrButton>
          ) : null}
        </div>
      ) : null}
      {list.kind === 'ready' && list.ended && items.length > 0
        ? <p id={LIST_END_ID} tabIndex={-1} className="hid-ehr-dept-muted hid-ehr-dept-registration-end">{ALL_LOADED}</p>
        : null}
      {/* Mounted throughout, so what "Load more" added is announced. */}
      <p role="status" className="hid-ehr-sr-only">{said}</p>
    </DeptSection>
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
