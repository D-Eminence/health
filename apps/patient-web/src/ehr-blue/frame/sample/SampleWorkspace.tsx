import { useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent, type RefObject } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  EhrBadge, EhrButton, EhrCard, EhrDataTable, EhrDialog, EhrDrawer, EhrField, EhrInput, EhrModuleTabs, EhrPageHeading,
  EhrSampleBanner, EhrSelect, EhrTextarea, type EhrDataTableColumn,
} from '@hid/ui/ehr'
import { useBluePage } from '../pageContext'
import { pageHrefOf } from '../pageHref'
import type { Action, Field, Module } from './catalog'
import {
  createSample, sampleModule, sampleRecords, sampleTitle, sampleVersion, statusWords, subscribeSamples, updateSample,
  type SampleRecord, type SampleValue,
} from './store'

/**
 * A workspace Health ID does not serve yet, built from the design's definition (catalog.ts): its list, its create form
 * and a record's detail with the actions the design gives each status. Everything here is a sample: fictional rows in
 * memory, nothing sent, nothing kept, a reload starts again.
 *
 * The address below the page picks the view: '' the list, 'new' the form, anything else a record. A tabbed workspace
 * (Insurance & Claims, Supply) gives each tab an address segment ('' for the first).
 */
export interface SampleTab {
  readonly segment: string
  readonly label: string
  readonly moduleId: string
}

export interface SampleWorkspaceProps {
  readonly moduleId: string
  readonly tabs?: readonly SampleTab[]
}

function useSamples(moduleId: string): readonly SampleRecord[] {
  useSyncExternalStore(subscribeSamples, sampleVersion, sampleVersion)
  return sampleRecords(moduleId)
}

const when = (value: string) => new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })

export function SampleWorkspace({ moduleId, tabs }: SampleWorkspaceProps) {
  const { page, rest } = useBluePage()
  const followTab = useRouteNavigate()
  const parts = rest.split('/').filter(Boolean)
  const tab = tabs?.find(candidate => candidate.segment !== '' && candidate.segment === parts[0])
  const active = tab ?? tabs?.find(candidate => candidate.segment === '')
  const view = tab ? parts.slice(1) : parts
  const module = sampleModule(active?.moduleId ?? moduleId)
  const base = `${pageHrefOf(page)}${tab ? `/${tab.segment}` : ''}`
  if (!module) return <EhrPageHeading title={page.label} />
  return (
    <>
      <EhrPageHeading title={page.label} />
      <EhrSampleBanner />
      {tabs ? (
        <EhrModuleTabs
          label={page.label}
          currentId={active?.segment ?? ''}
          tabs={tabs.map(candidate => ({ id: candidate.segment, label: candidate.label,
            href: `${pageHrefOf(page)}${candidate.segment ? `/${candidate.segment}` : ''}` }))}
          onNavigate={followTab}
        />
      ) : null}
      {view[0] === 'new' ? <SampleForm module={module} base={base} />
        : view[0] ? <SampleDetail module={module} base={base} id={view[0]} />
          : <SampleList module={module} base={base} />}
    </>
  )
}

/** Follows a plain left click in the app; a modified click (new tab) is left to the browser. */
function useRouteNavigate() {
  const navigate = useNavigate()
  return (target: { href: string }, event: { button: number; metaKey: boolean; altKey: boolean; ctrlKey: boolean; shiftKey: boolean; preventDefault: () => void }) => {
    if (event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    navigate(target.href)
  }
}

function SampleList({ module, base }: { readonly module: Module; readonly base: string }) {
  const records = useSamples(module.id)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [quick, setQuick] = useState<SampleRecord | null>(null)
  const shown = records.filter(record => !query.trim()
    || JSON.stringify(record.fields).toLowerCase().includes(query.trim().toLowerCase()))
  const columns: EhrDataTableColumn<SampleRecord>[] = [
    { id: 'record', header: 'Record', cell: record => (
      <a className="hid-ehr-blue-link" href={`${base}/${record.id}`} onClick={event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        navigate(`${base}/${record.id}`)
      }}>{sampleTitle(module, record)}</a>
    ) },
    ...(module.patient ? [{ id: 'patient', header: 'Patient', cell: (record: SampleRecord) => String(record.fields.patient ?? '') }] : []),
    { id: 'status', header: 'Status', cell: record => <EhrBadge tone="neutral">{statusWords(record.status)}</EhrBadge> },
    { id: 'updated', header: 'Updated', cell: record => when(record.updatedAt) },
    { id: 'quick', header: <span className="hid-ehr-sr-only">Actions</span>, cell: record => (
      <EhrButton variant="secondary" size="sm" onClick={() => setQuick(record)}>Quick view</EhrButton>
    ) },
  ]
  return (
    <EhrCard title={`${module.title} records`} actions={<EhrButton size="sm" onClick={() => navigate(`${base}/new`)}>New record</EhrButton>}>
      <EhrField label={`Search ${module.title.toLowerCase()}`}>
        <EhrInput type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search saved records…" />
      </EhrField>
      <div className="hid-ehr-blue-gap" />
      <EhrDataTable
        caption={`${module.title} (sample)`}
        captionHidden
        columns={columns}
        rows={shown}
        rowKey={record => record.id}
        emptyTitle="No matching records"
        emptyMessage="Try a different word, or create a record."
      />
      <EhrDrawer open={quick !== null} title={quick ? sampleTitle(module, quick) : 'Record'} onClose={() => setQuick(null)}>
        {quick ? <>
          <EhrSampleBanner />
          <RecordFacts module={module} record={quick} />
          <EhrButton onClick={() => { setQuick(null); navigate(`${base}/${quick.id}`) }}>Open record</EhrButton>
        </> : null}
      </EhrDrawer>
    </EhrCard>
  )
}

function RecordFacts({ module, record }: { readonly module: Module; readonly record: SampleRecord }) {
  return (
    <dl className="hid-ehr-blue-facts">
      {module.patient ? <><dt>Patient</dt><dd>{String(record.fields.patient ?? '')}</dd></> : null}
      <dt>Status</dt><dd>{statusWords(record.status)}</dd>
      {module.fields.map(field => (
        <div key={field.key} className="hid-ehr-blue-fact">
          <dt>{field.label}</dt>
          <dd>{display(record.fields[field.key])}</dd>
        </div>
      ))}
    </dl>
  )
}

function display(value: SampleValue | undefined): string {
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  return value === undefined || value === '' ? 'Not recorded' : value
}

/** The fields of a form, as the design defines them, with each problem said beside its field. */
function FieldInputs({ fields, values, problems, onChange }: {
  readonly fields: readonly Field[]; readonly values: Record<string, SampleValue>; readonly problems: Record<string, string>
  readonly onChange: (key: string, value: SampleValue) => void
}) {
  return (
    <div className="hid-ehr-blue-form-grid">
      {fields.filter(field => field.type !== 'file').map(field => {
        const value = values[field.key]
        const label = `${field.label}${field.required ? '' : ' (optional)'}`
        if (field.type === 'checkbox') {
          return <label key={field.key} className="hid-ehr-blue-check">
            <input type="checkbox" className="hid-ehr-blue-check-input" checked={value === true} onChange={event => onChange(field.key, event.target.checked)} /> {field.label}
          </label>
        }
        const options = field.options ?? field.choices?.map(choice => choice.value)
        return (
          <EhrField key={field.key} label={label} error={problems[field.key]} className={field.type === 'textarea' ? 'hid-ehr-blue-full' : undefined}>
            {options ? (
              <EhrSelect value={typeof value === 'string' ? value : ''} onChange={event => onChange(field.key, event.target.value)} data-field={field.key}>
                <option value="">Choose…</option>
                {(field.choices ?? options.map(option => ({ value: option, label: option }))).map(choice => (
                  <option key={choice.value} value={choice.value}>{choice.label}</option>
                ))}
              </EhrSelect>
            ) : field.type === 'textarea' ? (
              <EhrTextarea value={typeof value === 'string' ? value : ''} onChange={event => onChange(field.key, event.target.value)} data-field={field.key} />
            ) : (
              <EhrInput
                type={field.type ?? 'text'}
                value={typeof value === 'string' ? value : ''}
                onChange={event => onChange(field.key, event.target.value)}
                data-field={field.key}
              />
            )}
          </EhrField>
        )
      })}
    </div>
  )
}

function problemsOf(fields: readonly Field[], values: Record<string, SampleValue>): Record<string, string> {
  return Object.fromEntries(fields
    .filter(field => field.required && field.type !== 'checkbox' && field.type !== 'file'
      && (typeof values[field.key] !== 'string' || String(values[field.key]).trim() === ''))
    .map(field => [field.key, `Enter ${field.label.toLowerCase()}.`]))
}

/** Moves focus to the first field with a problem, once the problems show. */
function useFirstProblemFocus(problems: Record<string, string>, form: RefObject<HTMLFormElement | null>) {
  const asked = useRef(0)
  const [attempt, setAttempt] = useState(0)
  useLayoutEffect(() => {
    if (attempt === asked.current) return
    asked.current = attempt
    const first = Object.keys(problems)[0]
    if (first) form.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus()
  }, [attempt, problems, form])
  return () => setAttempt(count => count + 1)
}

function SampleForm({ module, base }: { readonly module: Module; readonly base: string }) {
  const navigate = useNavigate()
  const [values, setValues] = useState<Record<string, SampleValue>>({})
  const [problems, setProblems] = useState<Record<string, string>>({})
  const form = useRef<HTMLFormElement>(null)
  const focusFirst = useFirstProblemFocus(problems, form)

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const found = problemsOf(module.fields, values)
    setProblems(found)
    if (Object.keys(found).length > 0) {
      focusFirst()
      return
    }
    const record = createSample(module.id, { ...(module.patient ? { patient: String(values.patient ?? 'Alex Example') } : {}), ...values })
    navigate(`${base}/${record.id}`)
  }

  return (
    <EhrCard title={`New ${module.title.toLowerCase()} record`}>
      <form ref={form} noValidate onSubmit={save}>
        <FieldInputs fields={module.fields} values={values} problems={problems}
          onChange={(key, value) => { setValues(current => ({ ...current, [key]: value })); setProblems(current => {
            if (!current[key]) return current
            const next = { ...current }
            delete next[key]
            return next
          }) }} />
        <div className="hid-ehr-actions hid-ehr-blue-form-actions">
          <EhrButton type="submit">Save sample record</EhrButton>
          <EhrButton variant="secondary" onClick={() => navigate(base)}>Cancel</EhrButton>
        </div>
      </form>
    </EhrCard>
  )
}

function SampleDetail({ module, base, id }: { readonly module: Module; readonly base: string; readonly id: string }) {
  const records = useSamples(module.id)
  const navigate = useNavigate()
  const record = records.find(candidate => candidate.id.toLowerCase() === id.toLowerCase())
  const [acting, setActing] = useState<Action | null>(null)
  if (!record) {
    return (
      <EhrCard title="Record not found">
        <p>This sample record is not here. Sample records reset when the page reloads.</p>
        <EhrButton variant="secondary" onClick={() => navigate(base)}>Back to the list</EhrButton>
      </EhrCard>
    )
  }
  const actions = module.actions.filter(action => action.from.includes(record.status))
  return (
    <>
      <EhrCard title={sampleTitle(module, record)} actions={<EhrBadge tone="neutral">{statusWords(record.status)}</EhrBadge>}>
        <RecordFacts module={module} record={record} />
        <div className="hid-ehr-actions">
          {actions.map(action => (
            <EhrButton key={action.id} variant="secondary" onClick={() => setActing(action)}>{action.label}</EhrButton>
          ))}
          <EhrButton variant="quiet" onClick={() => navigate(base)}>Back to the list</EhrButton>
        </div>
        {acting && (acting.fields?.length ?? 0) > 0 ? (
          <ActionForm action={acting} onCancel={() => setActing(null)} onDone={fields => {
            updateSample(module.id, record.id, { status: acting.to, fields, what: `${acting.label} (sample)` })
            setActing(null)
          }} />
        ) : null}
      </EhrCard>
      <EhrDialog
        open={acting !== null && (acting.fields?.length ?? 0) === 0}
        title={`${acting?.label ?? 'Continue'}?`}
        description={`This changes the sample record's status to ${statusWords(acting?.to ?? '')}. Nothing is saved to Health ID.`}
        confirmLabel={acting?.label ?? 'Continue'}
        confirmWord={acting?.id === 'sign' ? 'SIGN' : undefined}
        onConfirm={() => {
          if (acting) updateSample(module.id, record.id, { status: acting.to, what: `${acting.label} (sample)` })
          setActing(null)
        }}
        onCancel={() => setActing(null)}
      />
      <EhrCard title="History" titleLevel={2}>
        <ul className="hid-ehr-blue-list">
          {record.history.map((entry, index) => (
            <li key={index} className="hid-ehr-blue-list-item"><strong>{entry.what}</strong><span>{when(entry.at)}</span></li>
          ))}
        </ul>
      </EhrCard>
    </>
  )
}

function ActionForm({ action, onCancel, onDone }: {
  readonly action: Action; readonly onCancel: () => void; readonly onDone: (fields: Record<string, SampleValue>) => void
}) {
  const [values, setValues] = useState<Record<string, SampleValue>>({})
  const [problems, setProblems] = useState<Record<string, string>>({})
  const form = useRef<HTMLFormElement>(null)
  const focusFirst = useFirstProblemFocus(problems, form)
  return (
    <form ref={form} noValidate className="hid-ehr-blue-action-form" aria-label={action.label} onSubmit={event => {
      event.preventDefault()
      const found = problemsOf(action.fields ?? [], values)
      setProblems(found)
      if (Object.keys(found).length > 0) focusFirst()
      else onDone(values)
    }}>
      <h3 className="hid-ehr-blue-subtitle">{action.label}</h3>
      <FieldInputs fields={action.fields ?? []} values={values} problems={problems}
        onChange={(key, value) => setValues(current => ({ ...current, [key]: value }))} />
      <div className="hid-ehr-actions">
        <EhrButton type="submit">{action.label}</EhrButton>
        <EhrButton variant="secondary" onClick={onCancel}>Cancel</EhrButton>
      </div>
    </form>
  )
}
