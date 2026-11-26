import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { EhrBadge, EhrButton, EhrDataTable, EhrField, EhrInput, EhrSelect, type EhrDataTableColumn } from '@hid/ui/ehr'
import { qualityApi, type QualityIncidentList, type QualityIncidentSummary, type QualityStatus } from '../../../staff/api'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { countText } from '../parts/format'
import { useStaffDirectory } from './hooks'
import { DraftListBanner, QualityTabs, type QualityShared } from './parts'
import {
  BASE, DESCRIPTION, EYEBROW, NOT_AVAILABLE, STATUSES, STATUS_WORDS, TITLE, cancelled, categoryText, departmentText, harmText, learnFrom,
  manages, memberText, notServed, refusalWords, statusText, statusTone, whenText,
} from './qualityRules'

/** What the list shows, kept while an incident below it is open. Days are Lagos days ("2026-12-03"). */
export interface ListFilters {
  readonly status: '' | 'open' | QualityStatus
  readonly category: string
  readonly harmLevel: string
  readonly departmentCode: string
  readonly occurredFrom: string
  readonly occurredTo: string
}
export const DEFAULT_FILTERS: ListFilters = { status: '', category: '', harmLevel: '', departmentCode: '', occurredFrom: '', occurredTo: '' }

const DAY_MS = 24 * 60 * 60 * 1000

/** The dates' problem, or '' (each optional; inclusive, at most 366 days apart, the first not after the last). */
export function rangeProblem(from: string, to: string): string {
  if (!from || !to) return ''
  if (from > to) return 'The first day must not be after the last day.'
  if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 366 * DAY_MS) return 'Choose days at most a year apart.'
  return ''
}

/**
 * The incident list (route 3): a manager's whole facility ("All reports"), or the member's own reports, or the incidents
 * assigned to them now, newest report first, with filters and, for managers, the facility's counts by status. An item
 * holds no reporter, patient or text but the title, so the list shows nothing more.
 */
export function IncidentList({ facilityId, me, membershipId, mine, filters, onFilters }: QualityShared & {
  readonly mine: 'reported' | 'assigned' | undefined
  readonly filters: ListFilters
  readonly onFilters: (next: ListFilters) => void
}) {
  const navigate = useNavigate()
  const manager = manages(me)
  const [list, setList] = useState<{ key: string; items: readonly QualityIncidentSummary[]; nextCursor: string | null;
    counts: QualityIncidentList['counts'] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [more, setMore] = useState(false)
  const [error, setError] = useState<{ text: string; unavailable: boolean } | null>(null)
  const problem = rangeProblem(filters.occurredFrom, filters.occurredTo)
  const key = JSON.stringify({ filters, mine })

  const load = useCallback(async (cursor?: string) => {
    if (problem) return
    if (cursor) setMore(true); else setLoading(true)
    setError(null)
    try {
      const answer = await qualityApi.list(facilityId, {
        status: filters.status || undefined, category: filters.category || undefined, harmLevel: filters.harmLevel || undefined,
        departmentCode: filters.departmentCode || undefined, occurredFrom: filters.occurredFrom || undefined,
        occurredTo: filters.occurredTo || undefined, mine, cursor,
      })
      learnFrom()
      setList(previous => ({ key, items: cursor && previous?.key === key ? [...previous.items, ...answer.items] : answer.items,
        nextCursor: answer.nextCursor, counts: answer.counts ?? null }))
    } catch (caught) {
      if (cancelled(caught)) return
      learnFrom(caught)
      // A cursor the route no longer takes: the list starts again from its first page.
      if (isHidApiError(caught) && caught.code === 'QUALITY_LIST_CURSOR_INVALID') setList(null)
      setError({ text: refusalWords(caught, 'The incident reports could not be loaded. Try again.',
        'Check the filters: the dates can be at most a year apart.'), unavailable: notServed(caught) })
    } finally { setLoading(false); setMore(false) }
  }, [facilityId, filters, mine, key, problem])

  useEffect(() => { void load() }, [load])

  const items = list?.key === key ? list.items : []
  const directory = useStaffDirectory(facilityId, items.map(item => item.reviewerMembershipId), manager)
  const set = (next: Partial<ListFilters>) => onFilters({ ...filters, ...next })
  const current = mine === 'assigned' ? 'assigned-to-me' : mine === 'reported' && manager ? 'reported-by-me' : ''
  const heading = mine === 'assigned' ? 'Assigned to me' : mine === 'reported' ? manager ? 'Reported by me' : 'My reports' : 'All reports'
  const filtered = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS)

  const columns: EhrDataTableColumn<QualityIncidentSummary>[] = [
    { id: 'incident', header: 'Incident', cell: item => (
      <div className="hid-ehr-qs-incident-cell">
        <span className="hid-ehr-qs-number">Incident {item.incidentNumber}</span>
        <Link className="hid-ehr-dept-link" to={`${BASE}/${item.incidentId}`}>{item.title}</Link>
      </div>
    ) },
    { id: 'category', header: 'Category', cell: item => categoryText(item.category, me.lists) },
    { id: 'harm', header: 'Harm', cell: item => harmText(item.harmLevel, me.lists) },
    { id: 'department', header: 'Department', cell: item => departmentText(item.departmentCode) || 'Not given' },
    { id: 'occurred', header: 'When it happened', cell: item => whenText(item.occurredAt) },
    { id: 'status', header: 'Status', cell: item => (
      <div className="hid-ehr-qs-badges">
        <EhrBadge tone={statusTone(item.status)}>{statusText(item.status)}</EhrBadge>
        {item.assignedToMe ? <EhrBadge tone="neutral">Assigned to you</EhrBadge> : null}
        {item.reportedByMe && !manager ? <EhrBadge tone="neutral">Reported by you</EhrBadge> : null}
        {manager && item.patientLinked ? <EhrBadge tone="neutral">Patient linked</EhrBadge> : null}
      </div>
    ) },
    ...(manager || mine === 'assigned' ? [{ id: 'actions', header: 'Corrective actions', cell: (item: QualityIncidentSummary) => actionsText(item) }] : []),
    ...(manager ? [{ id: 'reviewer', header: 'Reviewer', cell: (item: QualityIncidentSummary) =>
      memberText(item.reviewerMembershipId, membershipId, directory.names, 'Not assigned') }] : []),
  ]

  return (
    <DeptPage eyebrow={EYEBROW} title={TITLE} description={DESCRIPTION} className="hid-ehr-dept-qs"
      primaryAction={me.canReport ? <EhrButton onClick={() => navigate(`${BASE}/new`)}>Report an incident</EhrButton> : undefined}
      secondaryActions={<EhrButton variant="secondary" onClick={() => void load()} busy={loading && list !== null}>Refresh</EhrButton>}>
      <QualityTabs me={me} current={current} />
      <DraftListBanner me={me} />

      {manager && list?.key === key && list.counts ? (
        <DeptSection title="This facility’s reports" headingId="qs-counts-title">
          <ul className="hid-ehr-qs-status-counts" aria-labelledby="qs-counts-title">
            {STATUSES.map(status => (
              <li key={status}>
                <button type="button" aria-pressed={filters.status === status} onClick={() => set({ status: filters.status === status ? '' : status })}>
                  <span className="hid-ehr-qs-count-label">{STATUS_WORDS[status]}</span>
                  <span className="hid-ehr-qs-count-value">{list.counts![status]}</span>
                </button>
              </li>
            ))}
          </ul>
        </DeptSection>
      ) : null}

      <DeptSection title="Which reports" headingId="qs-filters-title">
        <div className="hid-ehr-dept-form-grid hid-ehr-qs-filters" role="group" aria-labelledby="qs-filters-title">
          <EhrField label="Status" controlId="qs-filter-status">
            <EhrSelect value={filters.status} onChange={event => set({ status: event.target.value as ListFilters['status'] })}>
              <option value="">Any status</option>
              <option value="open">Not resolved</option>
              {STATUSES.map(status => <option key={status} value={status}>{STATUS_WORDS[status]}</option>)}
            </EhrSelect>
          </EhrField>
          <EhrField label="Category" controlId="qs-filter-category">
            <EhrSelect value={filters.category} onChange={event => set({ category: event.target.value })}>
              <option value="">Any category</option>
              {me.lists.categories.map(entry => <option key={entry.code} value={entry.code}>{entry.label}</option>)}
            </EhrSelect>
          </EhrField>
          <EhrField label="Harm" controlId="qs-filter-harm">
            <EhrSelect value={filters.harmLevel} onChange={event => set({ harmLevel: event.target.value })}>
              <option value="">Any harm</option>
              {me.lists.harmLevels.map(entry => <option key={entry.code} value={entry.code}>{entry.label}</option>)}
            </EhrSelect>
          </EhrField>
          <EhrField label="Department" controlId="qs-filter-department">
            <EhrSelect value={filters.departmentCode} onChange={event => set({ departmentCode: event.target.value })}>
              <option value="">Any department</option>
              {me.departmentCodes.map(code => <option key={code} value={code}>{departmentText(code)}</option>)}
            </EhrSelect>
          </EhrField>
          <EhrField label="Happened from" controlId="qs-filter-from" error={problem || undefined}>
            <EhrInput type="date" value={filters.occurredFrom} onChange={event => set({ occurredFrom: event.target.value })} />
          </EhrField>
          <EhrField label="Happened to" controlId="qs-filter-to">
            <EhrInput type="date" value={filters.occurredTo} onChange={event => set({ occurredTo: event.target.value })} />
          </EhrField>
        </div>
        {filtered ? <EhrButton size="sm" variant="quiet" onClick={() => onFilters(DEFAULT_FILTERS)}>Clear filters</EhrButton> : null}
      </DeptSection>

      <DeptSection title={heading} headingId="qs-list-title">
        {error ? <DeptNotice role="alert" tone={error.unavailable ? 'info' : 'critical'}>{error.unavailable ? NOT_AVAILABLE : error.text}</DeptNotice> : null}
        {problem ? <p className="hid-ehr-state-message">Correct the dates above to see the list.</p> : error && list?.key !== key ? null : (
          <EhrDataTable caption={heading} captionHidden columns={columns} rows={items} rowKey={item => item.incidentId} stack="lg"
            loading={loading && list?.key !== key}
            emptyTitle={filtered ? 'No reports match' : mine === 'assigned' ? 'Nothing assigned to you' : 'No reports yet'}
            emptyMessage={filtered ? 'No incident report matches these filters.' : mine === 'assigned'
              ? 'No incident is assigned to you now.' : mine === 'reported' ? 'Reports you file here are listed here.' : 'Reports filed here are listed here.'} />
        )}
        {list?.key === key && list.nextCursor ? (
          <EhrButton variant="secondary" busy={more} onClick={() => void load(list.nextCursor ?? undefined)}>Show more</EhrButton>
        ) : null}
      </DeptSection>
    </DeptPage>
  )
}

/** "2 open, 1 overdue", or "None open". */
function actionsText(item: Pick<QualityIncidentSummary, 'openActions' | 'overdueActions'>): string {
  if (!item.openActions) return 'None open'
  return `${countText(item.openActions, 'open', 'open')}${item.overdueActions ? `, ${item.overdueActions} overdue` : ''}`
}
