import { useId, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useListAtBase } from '../baseAddress'
import { SampleCreate } from './SampleCreate'
import { SampleDetail } from './SampleDetail'
import { SampleList } from './SampleList'
import { useSampleFocus } from './navigation'
import {
  EDIT_REASON, givenValues, recordName, sampleId, type SampleAction, type SampleDefinition, type SampleRecord, type SampleValues,
} from './model'

type View = { readonly kind: 'list' } | { readonly kind: 'new' } | { readonly kind: 'record'; readonly id: string }

/**
 * One sample-only workspace from its definition: the design's list, create form and record view. Its records are
 * fictional and live only in this page's memory: they reset when the page is left or reloaded, nothing is sent,
 * nothing is stored in the browser, and the address names only the page. Every view has the sample notice under its
 * heading. Where the design groups workspaces as tabs (Claims | Policies, Stock | Procurement), the frame draws them.
 *
 * `base` is the page's own path without '/*' ('insurance'). An address below it (a record link from Home or the
 * Notifications drawer, /provider/insurance/<id>) opens the list and goes back to the base: the id is never looked up.
 * The page's own tab or sidebar entry, followed while it is open, opens its list again, as the design's tab does.
 */
export function SampleWorkspace({ base, definition }: { readonly base: string; readonly definition: SampleDefinition }) {
  useListAtBase(base)
  const { key: locationKey } = useLocation()
  const uid = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [records, setRecords] = useState<readonly SampleRecord[]>(definition.records)
  const [view, setView] = useState<View>({ kind: 'list' })
  const [search, setSearch] = useState('')
  // Each result is a new node in the live region, so the same words said twice are announced twice.
  const [announcement, setAnnouncementState] = useState({ text: '', count: 0 })
  const setAnnouncement = (text: string) => setAnnouncementState(old => ({ text, count: old.count + 1 }))
  const requestFocus = useSampleFocus(rootRef)

  // The page's own tab or sidebar entry goes to the address the page is already at, where the frame keeps the page as
  // it is: each new visit shows the list, focus on its heading.
  const [shownAt, setShownAt] = useState(locationKey)
  if (locationKey !== shownAt) {
    setShownAt(locationKey)
    if (view.kind !== 'list') {
      setView({ kind: 'list' })
      setAnnouncement('')
      requestFocus()
    }
  }

  const nameId = (id: string) => `${uid}-record-${id}`
  const createId = `${uid}-create`
  const savedHeadingId = `${uid}-saved`

  const showList = (focusId: string) => {
    setView({ kind: 'list' })
    setAnnouncement('')
    requestFocus(focusId)
  }
  const open = (id: string) => {
    setView({ kind: 'record', id })
    setAnnouncement('')
    requestFocus()
  }

  const create = (patientId: string | undefined, values: SampleValues): string | undefined => {
    const refused = definition.validate?.(givenValues(values), records)
    if (refused) return refused
    // Records are only ever added, so the count names each new one once.
    const sequence = records.length + 1
    const extra = definition.created?.(values, sequence)
    const record: SampleRecord = {
      id: sampleId(definition.id, sequence),
      status: definition.initial,
      patientId,
      values: { ...givenValues(values), ...extra?.values },
      state: extra?.state,
      updatedAt: new Date().toISOString(),
      versions: [],
    }
    setRecords(old => [record, ...old])
    setView({ kind: 'record', id: record.id })
    setAnnouncement(`Record created: ${recordName(record)}.`)
    requestFocus()
    return undefined
  }

  const act = (record: SampleRecord, action: SampleAction, values: SampleValues): string | undefined => {
    const given = givenValues(values)
    const at = new Date().toISOString()
    const others = records.filter(row => row.id !== record.id)
    const applied = definition.apply?.({ record, records: others, action, values: given, at }) ?? {}
    if ('error' in applied) return applied.error
    const status = applied.status ?? action.to
    const next: SampleRecord = {
      ...record,
      status,
      values: { ...record.values, ...given, ...applied.values },
      state: applied.state ?? record.state,
      updatedAt: at,
      versions: [...record.versions, { at, status: record.status, reason: given.reason || action.label, values: record.values }],
    }
    setRecords(old => old.map(row => row.id === record.id ? next : row))
    setAnnouncement(`${action.label}: done. Status: ${status}.`)
    requestFocus(savedHeadingId)
    return undefined
  }

  const edit = (record: SampleRecord, values: SampleValues): string | undefined => {
    const given = givenValues(values)
    const refused = definition.validate?.({ ...record.values, ...given }, records.filter(row => row.id !== record.id))
    if (refused) return refused
    const at = new Date().toISOString()
    const extra = definition.edited?.(record, given)
    const next: SampleRecord = {
      ...record,
      values: { ...record.values, ...given, ...extra?.values },
      updatedAt: at,
      versions: [...record.versions, { at, status: record.status, reason: EDIT_REASON, values: record.values }],
    }
    setRecords(old => old.map(row => row.id === record.id ? next : row))
    setAnnouncement('Record changes saved.')
    requestFocus(savedHeadingId)
    return undefined
  }

  const current = view.kind === 'record' ? records.find(record => record.id === view.id) : undefined

  return (
    <div ref={rootRef} className="hid-ehr-dept-sample">
      {view.kind === 'new' ? (
        <SampleCreate definition={definition} onBack={() => showList(createId)} onCreate={create} />
      ) : current ? (
        <SampleDetail key={current.id} base={base} definition={definition} record={current} onBack={() => showList(nameId(current.id))}
          onAct={act} onEdit={edit} focus={requestFocus} savedHeadingId={savedHeadingId} />
      ) : (
        <SampleList definition={definition} records={records} search={search} onSearch={setSearch}
          // "Clear search" goes as it is pressed: focus goes to the search field it cleared.
          onClearSearch={() => { setSearch(''); requestFocus({ selector: 'input[type="search"]' }) }}
          onCreate={() => { setView({ kind: 'new' }); setAnnouncement(''); requestFocus() }} onOpen={open}
          nameId={nameId} createId={createId} />
      )}
      <p className="hid-ehr-sr-only" role="status">{announcement.text ? <span key={announcement.count}>{announcement.text}</span> : null}</p>
    </div>
  )
}
