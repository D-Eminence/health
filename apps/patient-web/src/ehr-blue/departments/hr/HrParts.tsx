import { useState, type FormEvent, type ReactNode } from 'react'
import { EhrBadge, EhrButton, EhrDataTable, EhrDrawer, EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import { useFocusById } from '../../../staff/focus'
import { DeptSearch } from '../parts/DeptSearch'
import { DeptFacts, DeptLinkButton, DeptRecordName, type DeptFact } from '../parts/DeptRecord'
import { dateText } from '../parts/format'
import { SAMPLE_FIELDS, SAMPLE_STAFF, sampleProblems, type SampleFieldKey, type SampleValues } from './sampleCredentials'
import './hr.css'

/** The h1 text of every view: focus moves here when a view opens. */
export const TITLE_ID = 'hr-title'

export function HrTitle({ children }: { readonly children: ReactNode }) {
  return <span id={TITLE_ID} tabIndex={-1}>{children}</span>
}

/**
 * The line under a record's title, as the design draws it: the status badge, the record's person and reference (in
 * ink, when there is one), and when it was saved (muted).
 */
export function HrContextLine({ status, context, saved }: { readonly status: string; readonly context?: string; readonly saved: string }) {
  return (
    <div className="hid-ehr-dept-context">
      <EhrBadge>{status}</EhrBadge>
      {context ? <span className="hid-ehr-dept-context-item">{context}</span> : null}
      <small className="hid-ehr-dept-context-item">{saved}</small>
    </div>
  )
}

/** One row of a list: a live member's licence or a sample record. */
export interface HrRow {
  readonly key: string
  /** The id of the row's record link, which its Quick view and Open name it by, and which focus returns to. */
  readonly linkId: string
  readonly name: string
  readonly reference: string
  readonly context: ReactNode
  readonly status: string
  readonly updatedAt: string | null
  readonly facts: ReadonlyArray<DeptFact>
}

/**
 * The design's list card: "Search …" over the rows already on the page (nothing is sent), and the table under it:
 * Record | Patient / context | Status | Updated | Quick view and Open. Quick view opens the design's "Record quick view"
 * drawer.
 */
export function HrRecordList({ label, search, onSearch, rows, total, onOpen }: {
  readonly label: string
  readonly search: string
  readonly onSearch: (value: string) => void
  /** The rows the search matches. */
  readonly rows: ReadonlyArray<HrRow>
  /** How many rows there are before the search. */
  readonly total: number
  readonly onOpen: (key: string) => void
}) {
  const [quick, setQuick] = useState<HrRow | null>(null)
  return (
    <DeptSearch label={label} value={search} onChange={onSearch}>
      <EhrDataTable
        caption={label.replace(/^Search /, '')}
        captionHidden
        rows={rows}
        rowKey={row => row.key}
        emptyTitle="No matching records"
        emptyMessage={total ? 'Change your search.' : 'Create the first record when you have the appropriate permission.'}
        columns={[
          { id: 'record', header: 'Record', cell: row => <DeptRecordName id={row.linkId} name={row.name} reference={row.reference} onOpen={() => onOpen(row.key)} /> },
          { id: 'context', header: 'Patient / context', cell: row => row.context },
          { id: 'status', header: 'Status', cell: row => <EhrBadge>{row.status}</EhrBadge> },
          { id: 'updated', header: 'Updated', cell: row => dateText(row.updatedAt) },
          { id: 'actions', header: <span className="hid-ehr-sr-only">Actions</span>, cell: row => (
            <div className="hid-ehr-dept-table-actions">
              <EhrButton variant="secondary" size="sm" aria-describedby={row.linkId} onClick={() => setQuick(row)}>Quick view</EhrButton>
              <DeptLinkButton describedBy={row.linkId} onClick={() => onOpen(row.key)}>Open <span aria-hidden="true">→</span></DeptLinkButton>
            </div>
          ) },
        ]}
      />
      <EhrDrawer open={quick !== null} title="Record quick view" onClose={() => setQuick(null)}>
        {quick ? (
          <div className="hid-ehr-dept-hr-quick">
            <h3>{quick.name}</h3>
            <p className="hid-ehr-dept-muted">Last updated {dateText(quick.updatedAt)}</p>
            <DeptFacts facts={quick.facts} />
            <EhrButton onClick={() => { setQuick(null); onOpen(quick.key) }}>Open full record</EhrButton>
          </div>
        ) : null}
      </EhrDrawer>
    </DeptSearch>
  )
}

/**
 * The design's record form for a sample credential: the catalog's fields in a two-column grid, required ones marked *,
 * "Complete this field." under each one left empty, and focus on the first of them.
 */
export function SampleForm({ idPrefix, initial, submitLabel, onSubmit, className }: {
  readonly idPrefix: string
  readonly initial: SampleValues
  readonly submitLabel: string
  readonly onSubmit: (values: SampleValues) => void
  readonly className?: string
}) {
  const [values, setValues] = useState(initial)
  const [problems, setProblems] = useState<Partial<Record<SampleFieldKey, string>>>({})
  const focus = useFocusById()
  const set = (key: SampleFieldKey, value: string) => setValues(current => ({ ...current, [key]: value }))

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const found = sampleProblems(values)
    setProblems(found)
    const first = SAMPLE_FIELDS.find(field => found[field.key])
    if (first) { focus(`${idPrefix}-${first.key}`); return }
    onSubmit(values)
  }

  return (
    <form className={['hid-ehr-dept-form', className].filter(Boolean).join(' ')} noValidate onSubmit={submit}>
      <div className="hid-ehr-dept-form-grid">
        {SAMPLE_FIELDS.map(field => (
          <EhrField key={field.key} label={<>{field.label}{field.required ? <span aria-hidden="true"> *</span> : null}</>} error={problems[field.key]}>
            {field.type === 'select' ? (
              <EhrSelect id={`${idPrefix}-${field.key}`} aria-label={field.label} value={values[field.key]} required onChange={event => set(field.key, event.target.value)}>
                <option value="">Select…</option>
                {SAMPLE_STAFF.map(member => <option key={member.value} value={member.value}>{member.name} · {member.role}</option>)}
              </EhrSelect>
            ) : (
              <EhrInput id={`${idPrefix}-${field.key}`} aria-label={field.label} type={field.type} value={values[field.key]} required={field.required} autoComplete="off"
                maxLength={200} onChange={event => set(field.key, event.target.value)} />
            )}
          </EhrField>
        ))}
      </div>
      <div className="hid-ehr-dept-form-actions">
        <EhrButton type="submit">{submitLabel}</EhrButton>
      </div>
    </form>
  )
}
