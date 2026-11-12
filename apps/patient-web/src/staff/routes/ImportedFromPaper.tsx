import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { isHidApiError } from '@hid/http'
import { Alert, Button, Card, CardHeader } from '../../kasuwa/ui'
import { CONSENT_REQUIRED_TEXT } from '../../ImportedHistoryPage'
import { staffApi, type ImportsPage, type LabImport, type PharmacyImport } from '../api'

/*
 * "Imported from paper (unverified)": a patient's Lab results or medicines read from paper records (Migrate's Check and
 * save, then Publish), as Lab (GET /api/v1/lab/imports) and Pharmacy (GET /api/v1/pharmacy/imports) list them, newest
 * first, a page at a time. The caller mounts it only for a role holding the list's read (lab.import.read,
 * pharmacy.import.read). Each page read is audited, so a page is read once when shown and again only when asked (Show
 * more, Retry). Values are shown as they were stored, with plain labels.
 */

export type ImportedFromPaperKind = 'lab' | 'pharmacy'

export const IMPORTED_FROM_PAPER_TITLE = 'Imported from paper (unverified)'
export const NONE_IMPORTED = 'None imported from paper.'
export const IMPORTS_NOT_FOUND = 'None found.'
export const IMPORTS_FAILED = 'These records could not be loaded. Try again.'
export const MORE_IMPORTS_FAILED = 'More records could not be loaded. Try again.'

/** The permission each list needs: a caller shows the section only with it. */
export const IMPORTS_PERMISSION: Readonly<Record<ImportedFromPaperKind, string>> = {
  lab: 'lab.import.read',
  pharmacy: 'pharmacy.import.read',
}

const KIND_LABEL: Readonly<Record<ImportedFromPaperKind, string>> = { lab: 'Lab results', pharmacy: 'Medicines' }

/** Lab's flags in words; normal and anything unknown call nothing out. */
const FLAG_WORDS: Readonly<Record<string, string>> = {
  low: 'Low', high: 'High', abnormal: 'Abnormal', critical: 'Critical', critical_candidate: 'Possibly critical',
}

/** A day as written ("14 Feb 2024"): a date read from paper is stored as midnight UTC of the day written. */
export function writtenDay(value: string | null | undefined): string {
  if (!value) return ''
  const day = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00(?::00(?:\.0+)?)?(?:Z|[+-]00:?00)?)?$/.exec(value)
  const at = day ? new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]))) : new Date(value)
  if (Number.isNaN(at.getTime())) return ''
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: day ? 'UTC' : 'Africa/Lagos' })
}

type Failure = 'consent' | 'notFound' | 'failed'

function failureOf(caught: unknown): Failure {
  if (isHidApiError(caught)) {
    // Lab says the same with its own code: the patient has not let this facility read their record.
    if (caught.status === 403 && (caught.code === 'CONSENT_REQUIRED' || caught.code === 'LAB_IMPORT_ACCESS_DENIED')) return 'consent'
    if (caught.status === 404) return 'notFound'
  }
  return 'failed'
}

type Item = LabImport | PharmacyImport
type State =
  | { readonly status: 'loading' }
  | { readonly status: Failure }
  | { readonly status: 'ok'; readonly items: readonly Item[]; readonly nextCursor: string | null; readonly more?: 'busy' | 'failed' }

function readPage(kind: ImportedFromPaperKind, facilityId: string, patientId: string, cursor?: string, signal?: AbortSignal): Promise<ImportsPage<Item>> {
  return kind === 'lab' ? staffApi.labImports(facilityId, patientId, cursor, signal) : staffApi.pharmacyImports(facilityId, patientId, cursor, signal)
}

function LabRecord({ item }: { readonly item: LabImport }) {
  const day = writtenDay(item.reportedAt)
  const observations = (Array.isArray(item.observations) ? [...item.observations] : []).sort((a, b) => a.ordinal - b.ordinal)
  return <li className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
    <p className="m-0 text-[15px] font-medium text-ink">{day ? `Report date: ${day}` : 'Report date not written'}</p>
    <p className="m-0 text-[13px] text-ink-3">{`Source: ${item.externalLabName?.trim() || 'paper record'}`}</p>
    {item.status === 'entered_in_error' ? <p className="m-0 text-[13px] text-ink-3">Marked as entered in error</p> : null}
    {item.status === 'amended' ? <p className="m-0 text-[13px] text-ink-3">Amended</p> : null}
    {observations.length > 0 ? <ul className="m-0 flex list-disc flex-col gap-0.5 pl-5 text-[14px] text-ink-2">
      {observations.map(observation => {
        const result = [observation.value && `${observation.value}${observation.unit ? ` ${observation.unit}` : ''}`, observation.valueText]
          .filter(Boolean).join(' · ')
        const flag = observation.abnormalFlag && Object.hasOwn(FLAG_WORDS, observation.abnormalFlag) ? FLAG_WORDS[observation.abnormalFlag] : ''
        const line = [result ? `${observation.testName}: ${result}` : observation.testName, flag,
          observation.referenceRange && `Reference range ${observation.referenceRange}`].filter(Boolean).join(' · ')
        return <li key={observation.id} className="break-words">{line}</li>
      })}
    </ul> : <p className="m-0 text-[14px] text-ink-3">No values recorded.</p>}
  </li>
}

function MedicineRecord({ item }: { readonly item: PharmacyImport }) {
  const details = [item.strengthText && `Strength: ${item.strengthText}`, item.doseText && `Dose: ${item.doseText}`,
    item.frequencyText && `How often: ${item.frequencyText}`].filter(Boolean).join(' · ')
  const added = writtenDay(item.createdAt)
  return <li className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
    <p className="m-0 text-[15px] font-medium break-words text-ink">{item.medicationText}</p>
    {details ? <p className="m-0 text-[14px] break-words text-ink-2">{details}</p> : null}
    <p className="m-0 text-[13px] break-words text-ink-3">{`Source: ${item.historicalContext?.trim() || 'paper record'}`}</p>
    {added ? <p className="m-0 text-[13px] text-ink-3">{`Added on ${added}`}</p> : null}
  </li>
}

/**
 * One list of a patient's records imported from paper. Mounted per patient and facility; a late answer for another
 * patient or facility is never shown.
 */
export function ImportedFromPaper({ kind, facilityId, patientId }: {
  readonly kind: ImportedFromPaperKind; readonly facilityId: string; readonly patientId: string
}) {
  const id = useId()
  const titleId = `${id}-title`
  const kindId = `${id}-kind`
  const [state, setState] = useState<State>({ status: 'loading' })
  const [reads, setReads] = useState(0)
  // Bumped on every first read, so a "Show more" answer for an earlier read is dropped.
  const generation = useRef(0)
  const moreFlight = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const at = ++generation.current
    moreFlight.current?.abort(); moreFlight.current = null
    setState({ status: 'loading' })
    readPage(kind, facilityId, patientId, undefined, controller.signal).then(page => {
      if (!controller.signal.aborted && generation.current === at) setState({ status: 'ok', items: page.items, nextCursor: page.nextCursor })
    }, caught => {
      if (!controller.signal.aborted && generation.current === at) setState({ status: failureOf(caught) })
    })
    return () => { controller.abort(); moreFlight.current?.abort(); moreFlight.current = null }
  }, [kind, facilityId, patientId, reads])

  const stateRef = useRef(state)
  stateRef.current = state
  const more = useCallback(() => {
    const shown = stateRef.current
    if (shown.status !== 'ok' || !shown.nextCursor || moreFlight.current) return
    const cursor = shown.nextCursor
    const at = generation.current
    const controller = new AbortController()
    moreFlight.current = controller
    setState({ ...shown, more: 'busy' })
    readPage(kind, facilityId, patientId, cursor, controller.signal).then(page => {
      if (controller.signal.aborted || generation.current !== at) return
      setState(current => {
        if (current.status !== 'ok' || current.nextCursor !== cursor) return current
        const seen = new Set(current.items.map(item => item.id))
        return { status: 'ok', items: [...current.items, ...page.items.filter(item => !seen.has(item.id))], nextCursor: page.nextCursor }
      })
    }, caught => {
      if (controller.signal.aborted || generation.current !== at) return
      // Consent withdrawn since the first page: what was shown is taken away too.
      const failure = failureOf(caught)
      setState(current => current.status !== 'ok' || current.nextCursor !== cursor ? current
        : failure === 'consent' ? { status: 'consent' } : { ...current, more: 'failed' })
    }).finally(() => { if (moreFlight.current === controller) moreFlight.current = null })
  }, [kind, facilityId, patientId])

  return <Card aria-labelledby={`${titleId} ${kindId}`}>
    <CardHeader as="h2" titleId={titleId} title={IMPORTED_FROM_PAPER_TITLE} description={<span id={kindId}>{KIND_LABEL[kind]}</span>} />
    <div className="flex flex-col gap-3 p-5">
      {state.status === 'loading' ? <p role="status" className="m-0 text-[14px] text-ink-3">Loading…</p> : null}
      {state.status === 'consent' ? <p className="m-0 text-[14px] text-ink-2">{CONSENT_REQUIRED_TEXT}</p> : null}
      {state.status === 'notFound' ? <p className="m-0 text-[14px] text-ink-3">{IMPORTS_NOT_FOUND}</p> : null}
      {state.status === 'failed' ? <Alert intent="error" size="sm"
        action={<Button size="sm" icon={RotateCcw} onClick={() => setReads(value => value + 1)}>Retry</Button>}>{IMPORTS_FAILED}</Alert> : null}
      {state.status === 'ok' && state.items.length === 0 ? <p className="m-0 text-[14px] text-ink-3">{NONE_IMPORTED}</p> : null}
      {state.status === 'ok' && state.items.length > 0 ? <>
        <p className="m-0 text-[13px] text-ink-3">Read from paper records. Check against the paper before relying on them.</p>
        <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
          {state.items.map(item => kind === 'lab'
            ? <LabRecord key={item.id} item={item as LabImport} />
            : <MedicineRecord key={item.id} item={item as PharmacyImport} />)}
        </ul>
        {state.more === 'failed' ? <Alert intent="error" size="sm">{MORE_IMPORTS_FAILED}</Alert> : null}
        {state.nextCursor ? <div>
          <Button size="sm" loading={state.more === 'busy'} onClick={more}>{state.more === 'failed' ? 'Try again' : 'Show more'}</Button>
        </div> : null}
      </> : null}
    </div>
  </Card>
}
