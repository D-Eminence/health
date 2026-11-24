import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { EhrButton } from '@hid/ui/ehr'
import { useFocusById } from '../../../staff/focus'
import { DeptNotice } from '../parts/DeptNotice'
import { paperRecordsApi, type PaperLabImport, type PaperLabObservation, type PaperListResult, type PaperMedicine, type PaperPage } from './paperRecordsApi'

/*
 * "From paper records" on Patient documents: the lab results and medicines added to the open patient's record from
 * paper (Migrate's Check and save, then Publish), as Lab and Pharmacy list them (paperRecordsApi.ts), newest first, a
 * page at a time. Each list is read only where the role holds its read (lab.import.read, pharmacy.import.read), and
 * only once, when the patient is opened here: each page read is audited.
 *
 * Dormant until served: a list the backend does not serve (404) is not shown, and with neither shown the section is not
 * there at all. Nothing is shown while the first answers are awaited, so a dormant section never flashes.
 */

/** Said when every list shown is empty. */
export const NO_PAPER_RECORDS = 'No paper records have been added for this patient yet.'
export const LAB_REFUSED = 'Your role can’t see lab results added from paper records.'
export const MEDICINES_REFUSED = 'Your role can’t see medicines added from paper records.'
export const LAB_FAILED = 'Lab results from paper records couldn’t be loaded.'
export const MEDICINES_FAILED = 'Medicines from paper records couldn’t be loaded.'
export const MORE_FAILED = 'More couldn’t be loaded.'

/** Lab's flags in words; normal and not set call nothing out. */
const FLAG_WORDS: Readonly<Record<string, string>> = {
  low: 'Low', high: 'High', abnormal: 'Abnormal', critical: 'Critical', critical_candidate: 'Possibly critical',
}

/** A day as written in a record ("14 Feb 2024"): a date Lab made from the paper is midnight UTC of the day written. */
export function reportDayText(value: string | null | undefined): string {
  if (!value) return ''
  const day = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00(?::00(?:\.0+)?)?(?:Z|[+-]00:?00)?)?$/.exec(value)
  if (day) {
    const at = new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3])))
    return Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  }
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' })
}

/** "Haemoglobin: 11.2 g/dL · Low · reference 12.0-16.0". */
export function observationLine(item: PaperLabObservation): string {
  const result = [item.value && `${item.value}${item.unit ? ` ${item.unit}` : ''}`, item.valueText].filter(Boolean).join(' · ')
  const flag = item.abnormalFlag && Object.hasOwn(FLAG_WORDS, item.abnormalFlag) ? FLAG_WORDS[item.abnormalFlag] : ''
  return [result ? `${item.testName}: ${result}` : item.testName, flag, item.referenceRange && `reference ${item.referenceRange}`].filter(Boolean).join(' · ')
}

/** The page of the paper a medicine was read on, from the words Migrate saved with it ("From a paper record, page 2."). */
export function medicinePage(item: PaperMedicine): number | null {
  const found = /From a paper record, page (\d+)\b/i.exec(item.historicalContext ?? '')
  return found ? Number(found[1]) : null
}

type ListState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'notServed' | 'refused' | 'failed' }
  | { readonly status: 'ok'; readonly items: readonly T[]; readonly nextCursor: string | null; readonly more?: 'busy' | 'failed' }

/**
 * One list: read when `wanted`, again on Try again; "Show more" reads the next page and adds it, focusing the first
 * record it adds.
 */
function usePaperList<T extends { readonly id: string }>(wanted: boolean, read: (cursor?: string, signal?: AbortSignal) => Promise<PaperListResult<T>>,
  focusId: (item: T) => string) {
  const [state, setState] = useState<ListState<T> | null>(wanted ? { status: 'loading' } : null)
  const [reads, setReads] = useState(0)
  const focus = useFocusById()
  const readRef = useRef(read)
  readRef.current = read
  useEffect(() => {
    if (!wanted) { setState(null); return }
    const controller = new AbortController()
    setState({ status: 'loading' })
    void readRef.current(undefined, controller.signal).then(result => {
      if (controller.signal.aborted) return
      setState(result.ok ? { status: 'ok', items: result.page.items, nextCursor: result.page.nextCursor }
        : 'notServed' in result ? { status: 'notServed' } : 'refused' in result ? { status: 'refused' } : { status: 'failed' })
    }).catch(() => { if (!controller.signal.aborted) setState({ status: 'failed' }) })
    return () => controller.abort()
  }, [wanted, reads])
  const stateRef = useRef(state)
  stateRef.current = state
  const more = useCallback(async () => {
    const shown = stateRef.current
    if (!shown || shown.status !== 'ok' || !shown.nextCursor || shown.more === 'busy') return
    const cursor = shown.nextCursor
    setState({ ...shown, more: 'busy' })
    let result: PaperListResult<T>
    try { result = await readRef.current(cursor) } catch { result = { ok: false, failed: true } }
    const current = stateRef.current
    // A list read again meanwhile (Try again, another patient) is left as it is.
    if (!current || current.status !== 'ok' || current.nextCursor !== cursor) return
    if (!result.ok) { setState({ ...current, more: 'failed' }); return }
    const page: PaperPage<T> = result.page
    const seen = new Set(current.items.map(item => item.id))
    const added = page.items.filter(item => !seen.has(item.id))
    setState({ status: 'ok', items: [...current.items, ...added], nextCursor: page.nextCursor })
    if (added[0]) focus(focusId(added[0]))
  }, [focus, focusId])
  return { state, retry: () => setReads(value => value + 1), more }
}

const labItemId = (item: PaperLabImport) => `migrate-paper-lab-${item.id}`
const medicineItemId = (item: PaperMedicine) => `migrate-paper-medicine-${item.id}`

function LabRecord({ item }: { readonly item: PaperLabImport }) {
  const day = reportDayText(item.reportedAt)
  return <li id={labItemId(item)} tabIndex={-1} className="hid-ehr-dept-migrate-paper-record">
    <p className="hid-ehr-dept-strong">{day ? `Report date: ${day}` : 'Report date not recorded'}</p>
    {item.externalLabName && <p className="hid-ehr-dept-muted">{`Reported by ${item.externalLabName}`}</p>}
    {item.status === 'entered_in_error' && <p className="hid-ehr-dept-muted">Marked as entered in error</p>}
    {item.status === 'amended' && <p className="hid-ehr-dept-muted">Amended</p>}
    <ul className="hid-ehr-dept-migrate-list">{item.observations.map(observation => <li key={observation.id}>{observationLine(observation)}</li>)}</ul>
  </li>
}

function MedicineRecord({ item }: { readonly item: PaperMedicine }) {
  const page = medicinePage(item)
  const details = [item.strengthText, item.doseText, item.frequencyText].filter(Boolean).join(' · ')
  return <li id={medicineItemId(item)} tabIndex={-1} className="hid-ehr-dept-migrate-paper-record">
    <p className="hid-ehr-dept-strong">{item.medicationText}</p>
    {details && <p>{details}</p>}
    <p className="hid-ehr-dept-muted">{page ? `From a paper record, page ${page}` : 'From a paper record'}</p>
  </li>
}

function ListPart<T extends { readonly id: string }>({ title, headingId, list, refused, failed, render }: {
  readonly title: string; readonly headingId: string; readonly list: ReturnType<typeof usePaperList<T>>; readonly refused: string; readonly failed: string
  readonly render: (item: T) => ReactNode
}) {
  const { state } = list
  if (!state || state.status === 'notServed' || state.status === 'loading') return null
  if (state.status === 'ok' && state.items.length === 0) return null
  return <div className="hid-ehr-dept-migrate-paper-part" aria-labelledby={headingId} role="group">
    <h4 id={headingId}>{title}</h4>
    {state.status === 'refused' && <p className="hid-ehr-dept-muted">{refused}</p>}
    {state.status === 'failed' && <DeptNotice tone="critical" role="alert">{failed}{' '}
      <EhrButton size="sm" variant="secondary" onClick={list.retry}>Try again</EhrButton></DeptNotice>}
    {state.status === 'ok' && <>
      <ul className="hid-ehr-dept-migrate-paper-list">{state.items.map(item => <Fragment key={item.id}>{render(item)}</Fragment>)}</ul>
      {state.more === 'failed' && <DeptNotice tone="critical" role="alert">{MORE_FAILED}</DeptNotice>}
      {state.nextCursor && <div>
        <EhrButton size="sm" variant="secondary" busy={state.more === 'busy'} onClick={() => void list.more()}>
          {state.more === 'failed' ? 'Try again' : 'Show more'}</EhrButton>
      </div>}
    </>}
  </div>
}

/** "From paper records" for the patient open on Patient documents. */
export function PaperRecords({ facilityId, patientId, permissions }: {
  readonly facilityId: string; readonly patientId: string; readonly permissions: readonly string[]
}) {
  const canLab = permissions.includes('lab.import.read')
  const canMedicines = permissions.includes('pharmacy.import.read')
  const readLab = useCallback((cursor?: string, signal?: AbortSignal) => paperRecordsApi.labImports(facilityId, patientId, cursor, signal), [facilityId, patientId])
  const readMedicines = useCallback((cursor?: string, signal?: AbortSignal) => paperRecordsApi.medicines(facilityId, patientId, cursor, signal), [facilityId, patientId])
  const lab = usePaperList(canLab, readLab, labItemId)
  const medicines = usePaperList(canMedicines, readMedicines, medicineItemId)
  const states = [lab.state, medicines.state].filter((state): state is NonNullable<typeof state> => state !== null && state.status !== 'notServed')
  // Not served (or not this role's to read) anywhere: no section. Still waiting for an answer: nothing yet.
  if (states.length === 0 || states.some(state => state.status === 'loading')) return null
  const empty = states.every(state => state.status === 'ok' && state.items.length === 0)
  return <section className="hid-ehr-dept-migrate-paper" aria-labelledby="migrate-paper-title">
    <h3 id="migrate-paper-title">From paper records</h3>
    {empty ? <p className="hid-ehr-dept-muted">{NO_PAPER_RECORDS}</p> : <>
      <ListPart title="Lab results" headingId="migrate-paper-lab-title" list={lab} refused={LAB_REFUSED} failed={LAB_FAILED}
        render={(item: PaperLabImport) => <LabRecord item={item} />} />
      <ListPart title="Medicines" headingId="migrate-paper-medicines-title" list={medicines} refused={MEDICINES_REFUSED} failed={MEDICINES_FAILED}
        render={(item: PaperMedicine) => <MedicineRecord item={item} />} />
    </>}
  </section>
}
