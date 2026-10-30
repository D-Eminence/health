import { useId, useRef, useState } from 'react'
import { EhrModuleTabs } from '@hid/ui/ehr'
import { SampleBanner } from '../SampleBanner'
import { SampleCreate } from './SampleCreate'
import { SampleDetail } from './SampleDetail'
import { SampleList } from './SampleList'
import { useSampleFocus, useSiblingPages } from './navigation'
import {
  downloadFile, EDIT_REASON, givenValues, recordName, sampleCsv, sampleId, type SampleAction, type SampleDefinition, type SampleRecord, type SampleValues,
} from './model'
import './sample.css'

type View = { readonly kind: 'list' } | { readonly kind: 'new' } | { readonly kind: 'record'; readonly id: string }

/**
 * One sample-only workspace from its definition: the design's list, create form and record view, with its module
 * tabs where the design groups workspaces. Its records are fictional and live only in this page's memory: they reset
 * when the page is left or reloaded, nothing is sent, nothing is stored in the browser, and the address names only
 * the page. Every view opens with the sample notice.
 */
export function SampleWorkspace({ definition }: { readonly definition: SampleDefinition }) {
  const uid = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const [records, setRecords] = useState<readonly SampleRecord[]>(definition.records)
  const [view, setView] = useState<View>({ kind: 'list' })
  const [search, setSearch] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const requestFocus = useSampleFocus(rootRef)
  const { href, follow } = useSiblingPages()

  const nameId = (id: string) => `${uid}-record-${id}`
  const createId = `${uid}-create`
  const savedHeadingId = `${uid}-saved`

  const showList = (focusId?: string) => {
    setView({ kind: 'list' })
    setAnnouncement('')
    requestFocus(focusId)
  }
  const open = (id: string) => {
    setView({ kind: 'record', id })
    setAnnouncement('')
    requestFocus()
  }

  const above = (
    <>
      <SampleBanner />
      {definition.tabs ? (
        <EhrModuleTabs label={definition.tabs.label} currentId={definition.id}
          tabs={definition.tabs.tabs.map(tab => ({ id: tab.id, label: tab.label, href: href(tab.id) }))}
          onNavigate={(tab, event) => {
            if (tab.id !== definition.id) {
              follow(tab.id, event)
              return
            }
            // This workspace's own tab: its list, as the design's tab does.
            event.preventDefault()
            showList()
          }} />
      ) : null}
    </>
  )

  const create = (patientId: string | undefined, values: SampleValues) => {
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
  }

  const act = (record: SampleRecord, action: SampleAction, values: SampleValues): string | undefined => {
    const given = givenValues(values)
    const at = new Date().toISOString()
    const applied = definition.apply?.({ record, action, values: given, at }) ?? {}
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

  const edit = (record: SampleRecord, values: SampleValues) => {
    const given = givenValues(values)
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
  }

  const exportRows = (rows: readonly SampleRecord[]) => {
    downloadFile(`health-id-sample-${definition.id}.csv`, 'text/csv;charset=utf-8', sampleCsv(definition, rows))
    setAnnouncement(`Exported ${rows.length} ${rows.length === 1 ? 'record' : 'records'}.`)
  }

  const current = view.kind === 'record' ? records.find(record => record.id === view.id) : undefined

  return (
    <div ref={rootRef} className="hid-ehr-dept-sample">
      {view.kind === 'new' ? (
        <SampleCreate definition={definition} above={above} onBack={() => showList(createId)} onCreate={create} />
      ) : current ? (
        <SampleDetail key={current.id} definition={definition} record={current} above={above} onBack={() => showList(nameId(current.id))}
          onAct={act} onEdit={edit} focus={requestFocus} savedHeadingId={savedHeadingId} />
      ) : (
        <SampleList definition={definition} records={records} search={search} onSearch={setSearch} above={above}
          onCreate={() => { setView({ kind: 'new' }); setAnnouncement(''); requestFocus() }} onExport={exportRows} onOpen={open}
          nameId={nameId} createId={createId} />
      )}
      <p className="hid-ehr-sr-only" role="status">{announcement}</p>
    </div>
  )
}
