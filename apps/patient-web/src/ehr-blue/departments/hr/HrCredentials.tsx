import { Fragment, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactElement } from 'react'
import { EhrButton, EhrField, EhrInput, EhrSkeleton } from '@hid/ui/ehr'
import { useFocusById } from '../../../staff/focus'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { DeptActions, DeptFacts, DeptHistory, DeptRecordLayout } from '../parts/DeptRecord'
import { dateText, matchesSearch } from '../parts/format'
import { SampleBanner } from '../parts/SampleBanner'
import { HrContextLine, HrRecordList, HrTitle, SampleForm, TITLE_ID, type HrRow } from './HrParts'
import { LIVE_LOADING, liveCredentials, pendingCheckText, useLiveStaff, type LiveCredential, type LiveStaff } from './liveCredentials'
import {
  COMPLETE_THIS_FIELD, createSample, editSample, EMPTY_VALUES, REVIEW_ACTION, reviewSample, sampleFacts, sampleSeed, sampleTexts, staffName,
  valuesOf, type SampleRecord, type SampleValues,
} from './sampleCredentials'

/**
 * HR & Credentials, as the design draws it (screens/workspaces/hr-1-list, hr-2-new, hr-3-detail): a list, a create
 * form and a record view, each in this page's state, never in the address.
 *
 * Partial: the first list is live, each member of the facility and the licence on record for them, from today's Staff
 * read (read only; role and licence changes stay on Staff & access). The second list, "Create record", editing and the
 * credential review are sample: fictional records in this page's memory, which a reload resets.
 */

const TITLE = 'HR & Credentials'
const SAVED_ID = 'hr-saved-record'
const CREATE_ID = 'hr-create'
const RETRY_ID = 'hr-live-retry'
const LIVE_LIST_ID = 'hr-live-list'
const NO_ACTIONS = 'No further actions for your permission and this record state.'

type View =
  | { kind: 'list' }
  | { kind: 'live'; facilityId: string; key: string }
  | { kind: 'sample'; id: string }
  | { kind: 'new' }

export function HrCredentials() {
  const { facility } = useDeptAccess()
  const live = useLiveStaff(facility)
  const staff = live.kind === 'ready' ? live.staff : null
  const credentials = useMemo(() => staff ? liveCredentials(staff) : [], [staff])
  const [records, setRecords] = useState<SampleRecord[]>(sampleSeed)
  const [view, setView] = useState<View>({ kind: 'list' })
  const [liveSearch, setLiveSearch] = useState('')
  const [sampleSearch, setSampleSearch] = useState('')
  /** What the page last did, read out by the status line that stays mounted under every view. */
  const [announcement, setAnnouncement] = useState('')
  const focus = useFocusById()
  const retrying = useRef(false)
  const read = live.kind === 'failed' || live.kind === 'ready' ? live.read : null

  // After "Try again", once the read is answered, focus goes to what replaced the button: the button again on another
  // refusal (whose alert is read out anew), the live list's search once it is read, or the page's title otherwise.
  useLayoutEffect(() => {
    if (!retrying.current || live.kind === 'loading') return
    retrying.current = false
    const search = document.getElementById(LIVE_LIST_ID)?.querySelector('input')
    focus(live.kind === 'failed' ? RETRY_ID : search?.id ? [search.id, TITLE_ID] : TITLE_ID)
  }, [live.kind, read, focus])

  const show = (next: View) => { setView(next); setAnnouncement(''); focus(TITLE_ID) }
  /** Back to the list, with focus on the record just left (or the list's title, when the search hides it). */
  const toList = (target: string) => { setView({ kind: 'list' }); setAnnouncement(''); focus([target, TITLE_ID]) }
  const announced = (content: ReactElement) => <>{content}<p className="hid-ehr-sr-only" role="status">{announcement}</p></>

  if (view.kind === 'new') {
    return announced(<NewRecord onBack={() => toList(CREATE_ID)} onSave={values => {
      const record = createSample(values, crypto.randomUUID(), new Date().toISOString())
      setRecords(current => [record, ...current])
      show({ kind: 'sample', id: record.id })
      setAnnouncement(`Record created: ${record.data.name}.`)
    }} />)
  }
  if (view.kind === 'sample') {
    const record = records.find(entry => entry.id === view.id)
    if (record) {
      return announced(<SampleDetail key={record.id} record={record} onBack={() => toList(`hr-sample-${record.id}`)} onAnnounce={setAnnouncement}
        onChange={next => setRecords(current => current.map(entry => entry.id === next.id ? next : entry))} />)
    }
  }
  if (view.kind === 'live' && view.facilityId === facility?.id) {
    const credential = credentials.find(entry => entry.key === view.key)
    if (credential) return announced(<LiveDetail credential={credential} onBack={() => toList(`hr-live-${credential.key}`)} />)
  }

  const liveRows: HrRow[] = credentials
    .filter(entry => matchesSearch(liveSearch, [entry.name, entry.staff, entry.roles, entry.status, entry.reference,
      ...entry.facts.map(fact => typeof fact.value === 'string' ? fact.value : '')]))
    .map(entry => ({
      key: entry.key, linkId: `hr-live-${entry.key}`, name: entry.name, reference: entry.reference, status: entry.status,
      updatedAt: entry.updatedAt, facts: entry.facts,
      context: <><span>{entry.staff}</span><span className="hid-ehr-dept-reference">{entry.roles}{entry.isSelf ? ' · You' : ''}</span></>,
    }))
  const sampleRows: HrRow[] = records
    .filter(record => matchesSearch(sampleSearch, sampleTexts(record)))
    .map(record => ({
      key: record.id, linkId: `hr-sample-${record.id}`, name: record.data.name, reference: record.id.slice(0, 8), status: record.status,
      updatedAt: record.updatedAt, facts: sampleFacts(record.data), context: staffName(record.data.staff),
    }))

  return announced(
    <DeptPage title={<HrTitle>{TITLE}</HrTitle>}
      primaryAction={<EhrButton id={CREATE_ID} onClick={() => show({ kind: 'new' })}>Create record</EhrButton>}>
      <LiveList live={live} rows={liveRows} total={credentials.length} search={liveSearch} onSearch={setLiveSearch}
        onRetry={() => { if (live.kind !== 'failed') return; retrying.current = true; live.retry() }}
        onOpen={key => { if (facility) show({ kind: 'live', facilityId: facility.id, key }) }} />
      <SampleBanner />
      <HrRecordList label="Search sample records" search={sampleSearch} onSearch={setSampleSearch} rows={sampleRows}
        total={records.length} onOpen={id => show({ kind: 'sample', id })} />
    </DeptPage>,
  )
}

/** The live list, or what stands in its place: a line on why it is not shown, its loading, or a refused read. */
function LiveList({ live, rows, total, search, onSearch, onRetry, onOpen }: {
  readonly live: LiveStaff
  readonly onRetry: () => void
  readonly rows: HrRow[]
  readonly total: number
  readonly search: string
  readonly onSearch: (value: string) => void
  readonly onOpen: (key: string) => void
}) {
  if (live.kind === 'notice') return <DeptNotice tone={live.tone}>{live.message}</DeptNotice>
  if (live.kind === 'loading') {
    return <section className="hid-ehr-card hid-ehr-dept-section hid-ehr-dept-list-card" aria-label={TITLE}><EhrSkeleton label={LIVE_LOADING} /></section>
  }
  if (live.kind === 'failed') {
    return (
      <DeptNotice tone="critical" role="alert">
        <p>{live.message}</p>
        <EhrButton id={RETRY_ID} variant="secondary" size="sm" onClick={onRetry}>Try again</EhrButton>
      </DeptNotice>
    )
  }
  const pending = pendingCheckText(live.staff)
  return (
    <div id={LIVE_LIST_ID}>
      {pending ? <DeptNotice title="Waiting for Health ID support">{pending}</DeptNotice> : null}
      <HrRecordList label={`Search ${TITLE}`} search={search} onSearch={onSearch} rows={rows} total={total} onOpen={onOpen} />
    </div>
  )
}

/** A member's licence as a record: what Health ID holds, and no action here. */
function LiveDetail({ credential, onBack }: { readonly credential: LiveCredential; readonly onBack: () => void }) {
  return (
    <DeptPage title={<HrTitle>{credential.name}</HrTitle>} onBack={onBack}>
      <HrContextLine status={credential.status} context={`${credential.staff} · ${credential.reference}`} saved={`Saved ${dateText(credential.updatedAt)}`} />
      <DeptRecordLayout
        main={<DeptSection title="Saved record"><DeptFacts facts={credential.facts} /></DeptSection>}
        aside={<DeptActions empty={NO_ACTIONS} />}
      />
    </DeptPage>
  )
}

/** The design's create form ("New hr & credentials"), for a sample record. */
function NewRecord({ onBack, onSave }: { readonly onBack: () => void; readonly onSave: (values: SampleValues) => void }) {
  const title = `New ${TITLE.toLowerCase()}`
  return (
    <DeptPage title={<HrTitle>{title}</HrTitle>} onBack={onBack}>
      <SampleBanner />
      <DeptSection>
        <SampleForm idPrefix="hr-new" initial={EMPTY_VALUES} submitLabel="Save record" onSubmit={onSave} />
      </DeptSection>
    </DeptPage>
  )
}

/**
 * A sample record: its fields ("Saved record"), editing while it is only recorded, the catalog's review as its one
 * action, and each version kept before a change ("Preserved versions & amendments").
 */
function SampleDetail({ record, onBack, onChange, onAnnounce }: {
  readonly record: SampleRecord
  readonly onBack: () => void
  readonly onChange: (record: SampleRecord) => void
  /** Says what changed through the page's status line. */
  readonly onAnnounce: (text: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [review, setReview] = useState('')
  const [problem, setProblem] = useState<string | undefined>()
  const focus = useFocusById()
  const recorded = record.status === 'recorded'

  function saveEdit(values: SampleValues) {
    onChange(editSample(record, values, new Date().toISOString()))
    setEditing(false)
    onAnnounce('Record changes saved.')
    focus(SAVED_ID)
  }

  function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!review.trim()) { setProblem(COMPLETE_THIS_FIELD); focus('hr-review'); return }
    onChange(reviewSample(record, review, new Date().toISOString()))
    setReviewing(false)
    setReview('')
    setProblem(undefined)
    onAnnounce('Credential review recorded.')
    focus(SAVED_ID)
  }

  const actions = recorded ? [
    <Fragment key="review">
      <EhrButton id="hr-review-toggle" variant="secondary" aria-expanded={reviewing} aria-controls={reviewing ? 'hr-review-form' : undefined}
        onClick={() => { setReviewing(!reviewing); focus(reviewing ? 'hr-review-toggle' : 'hr-review') }}>{REVIEW_ACTION.label}</EhrButton>
      {reviewing ? (
        <form id="hr-review-form" className="hid-ehr-dept-action-form" noValidate onSubmit={submitReview}>
          <EhrField label={<>{REVIEW_ACTION.field}<span aria-hidden="true"> *</span></>} error={problem}>
            <EhrInput id="hr-review" aria-label={REVIEW_ACTION.field} value={review} required autoComplete="off" maxLength={500} onChange={event => setReview(event.target.value)} />
          </EhrField>
          <div className="hid-ehr-dept-form-actions"><EhrButton type="submit">{REVIEW_ACTION.label}</EhrButton></div>
        </form>
      ) : null}
    </Fragment>,
  ] : null

  return (
    <DeptPage title={<HrTitle>{record.data.name}</HrTitle>} onBack={onBack}>
      <SampleBanner />
      <HrContextLine status={record.status} saved={`Saved ${dateText(record.updatedAt)}`} />
      <DeptRecordLayout
        main={(
          <DeptSection title="Saved record" headingId={SAVED_ID}>
            {recorded ? (
              <div className="hid-ehr-dept-toolbar">
                <EhrButton id="hr-edit-toggle" variant="secondary" aria-expanded={editing}
                  onClick={() => { onAnnounce(''); setEditing(!editing); focus(editing ? 'hr-edit-toggle' : 'hr-edit-staff') }}>
                  {editing ? 'Cancel editing' : 'Edit record'}</EhrButton>
              </div>
            ) : null}
            {recorded && editing ? (
              <SampleForm idPrefix="hr-edit" initial={valuesOf(record.data)} submitLabel="Save changes" onSubmit={saveEdit} className="hid-ehr-dept-action-form" />
            ) : null}
            <DeptFacts facts={sampleFacts(record.data)} />
          </DeptSection>
        )}
        aside={<DeptActions empty={NO_ACTIONS}>{actions}</DeptActions>}
      />
      <DeptHistory entries={record.versions.map((version, index) => ({
        key: `${version.at}-${index}`,
        summary: `${version.at} · ${version.status} · ${version.reason}`,
        detail: <><p>Author: You</p><DeptFacts facts={sampleFacts(version.data)} /></>,
      }))} />
    </DeptPage>
  )
}
