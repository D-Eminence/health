import { useId } from 'react'
import type { ClinicalRecord, Encounter } from '../../../staff/api'
import { TITLE as CONSULT_TITLE, recordStatus } from '../consult/encounters'
import { orderPath } from '../consult/orders'
import { KINDS, orderTitle, type OrderKind } from '../consult/orders/orders'
import { ListPaging } from '../consult/Notes'
import { pagerProps, useRecordList, type RecordList } from '../consult/records'
import { TITLE as NURSING_TITLE, isObservation, noteStatus } from '../nursing/observations'
import type { Chart } from '../parts/chart'
import { HistoryCard, type HistoryItem } from '../parts/Detail'
import { shortId } from '../parts/format'
import { ErrorBox } from '../parts/Notices'
import { useWorkspaceHref } from '../parts/Workspace'
import { recordKey } from './records'
import { TITLE as TRIAGE_TITLE, vitalStatus } from './vitals'

/** The workspace whose record page shows the history: its own kind of record is not listed there. */
export type HistoryOwner = 'triage' | 'nursing'

/** The design's sidebar order for the orders: Laboratory before Pharmacy. */
const ORDER_KINDS: readonly OrderKind[] = ['laboratory', 'pharmacy']

export const HISTORY_LOADING = 'Loading records…'

/**
 * "Connected hospital history" on a Triage & Vitals or a Nursing observations record, by the design's rule: only
 * records from other workspaces, each a link, in sidebar order. The visit (Consultation) comes first, then the
 * encounter's Triage & Vitals, Laboratory, Pharmacy and Nursing observations, never the page's own kind. Each kind is
 * read as the encounter page reads it (today's record read, the page's access re-check having come just before, then
 * today's record pages, 50 to a page) and only by a role that may read it; a read that fails says so here, and the
 * other rows still show. A row links only where the role may open it: the visit and the orders live in Consultation,
 * which needs encounter read.
 */
export function ConnectedHistory({ chart, encounter, owner }: { chart: Chart; encounter: Encounter; owner: HistoryOwner }) {
  const href = useWorkspaceHref()
  const encounterId = encounter.id
  const vitals = useRecordList(chart, encounterId, 'vitals', owner !== 'triage' && chart.can('ehr.vital.read'))
  const labs = useRecordList(chart, encounterId, KINDS.laboratory.record, chart.can(KINDS.laboratory.read))
  const prescriptions = useRecordList(chart, encounterId, KINDS.pharmacy.record, chart.can(KINDS.pharmacy.read))
  const notes = useRecordList(chart, encounterId, 'clinical-notes', owner !== 'nursing' && chart.can('ehr.note.read'))
  const lists = [vitals, labs, prescriptions, notes]
  const opensConsultation = chart.can('ehr.encounter.read')
  const orders: Readonly<Record<OrderKind, RecordList<ClinicalRecord>>> = { laboratory: labs, pharmacy: prescriptions }

  // Only this patient's records of this encounter (the page each list shows), as the record's own read keeps them.
  const mine = (list: RecordList<ClinicalRecord>) => (list.items ?? []).filter(record => record.patientId === chart.patientId && record.encounterId === encounterId)
  const items: HistoryItem[] = [
    {
      key: `encounter-${encounterId}`,
      label: `${CONSULT_TITLE} · ${shortId(encounterId)}`,
      href: opensConsultation ? href.to('consult', encounterId) : undefined,
      status: encounter.status,
    },
    ...mine(vitals).map(record => ({
      key: `vital-${record.id}`,
      label: `${TRIAGE_TITLE} · ${shortId(record.id)}`,
      href: href.to('triage', recordKey(encounterId, record.id)),
      status: vitalStatus(record),
    })),
    ...ORDER_KINDS.flatMap(kind => mine(orders[kind]).map(record => ({
      key: `${kind}-${record.id}`,
      label: `${KINDS[kind].title} · ${orderTitle(kind, record)}`,
      href: opensConsultation ? href.to('consult', orderPath(encounterId, kind, record.id)) : undefined,
      status: recordStatus(record),
    }))),
    ...mine(notes).filter(isObservation).map(record => ({
      key: `observation-${record.id}`,
      label: `${NURSING_TITLE} · ${shortId(record.id)}`,
      href: href.to('nursing', recordKey(encounterId, record.id)),
      status: noteStatus(record),
    })),
  ]
  // Every list's failure (one they share, once), so a refused read is not hidden by another.
  const failures = [...new Set(lists.map(list => list.error).filter(Boolean))]

  return (
    <HistoryCard items={items}>
      {/* The first read of a list; a page move says so on its pager (busy), as the encounter page's history does. */}
      {lists.some(list => list.items === null && list.loading) ? <p role="status">{HISTORY_LOADING}</p> : null}
      {failures.map(failure => <ErrorBox key={failure}>{failure}</ErrorBox>)}
      {/* Each list pages on its own, 50 to a page, as today's records tabs do: a record past the first page is reached here. */}
      <HistoryPages title={TRIAGE_TITLE} list={vitals} />
      <HistoryPages title={KINDS.laboratory.title} list={labs} />
      <HistoryPages title={KINDS.pharmacy.title} list={prescriptions} />
      <HistoryPages title={NURSING_TITLE} list={notes} />
    </HistoryCard>
  )
}

/**
 * One history list's "Record pages" (today's pager), with its notice, named by the list it pages: here and in the
 * encounter page's history. Shown only while the list spans more than one page, or has something to say; a list the
 * role may not read has neither.
 */
export function HistoryPages({ title, list }: { title: string; list: RecordList<unknown> }) {
  const captionId = useId()
  if (!pagerProps(list) && !list.notice) return null
  return (
    <div className="hid-ehr-clinical-orders-pages" role="group" aria-labelledby={captionId}>
      <p id={captionId} className="hid-ehr-clinical-orders-muted hid-ehr-clinical-orders-gap">{title}</p>
      <ListPaging list={list} />
    </div>
  )
}
