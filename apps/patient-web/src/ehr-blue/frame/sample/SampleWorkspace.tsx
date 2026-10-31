import {
  useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent, type MouseEvent, type ReactNode,
  type RefObject,
} from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  EhrBadge, EhrButton, EhrCard, EhrDataTable, EhrDialog, EhrDrawer, EhrField, EhrInput, EhrPageHeading,
  EhrSampleBanner, EhrSelect, EhrTextarea, type EhrDataTableColumn,
} from '@hid/ui/ehr'
import { useStaff } from '../../../staff/App'
import { useBluePage, useSampleHref } from '../pageContext'
import { pageHrefOf } from '../pageHref'
import type { Action, Field, Module } from './catalog'
import {
  actOnSample, clearSampleHandoff, connectedSamples, createSample, editSampleDraft, FICTIONAL_PATIENTS, findSample,
  handOffSample, invoiceTotals, sampleFacilityChoices, sampleHandoff, sampleModule, samplePatientAllergies, samplePatientLine,
  sampleRecords, sampleRecordsOfKind, sampleTitle, sampleVersion, subscribeSamples,
  type SampleFields, type SampleRecord, type SampleValue,
} from './store'

/**
 * A workspace Health ID does not serve yet, built from the design's definition (catalog.ts) and drawn as the design's
 * screens draw it (screens/workspaces/*-1-list, *-2-new and *-3-detail): its list, its create form and a record's page
 * with the actions the design gives each status. Everything here is a sample: fictional rows in memory, nothing sent,
 * nothing kept, a reload starts again.
 *
 * The address below the page picks the view: '' the list, 'new' the form, anything else a record. A workspace's tabs
 * (Claims and Policies, Stock and Procurement) are pages of their own, joined by tabOf; the frame draws the tabs.
 */
export interface SampleWorkspaceProps {
  readonly moduleId: string
}

interface Choice {
  readonly value: string
  readonly label: string
}

function useSamples(moduleId: string): readonly SampleRecord[] {
  useSyncExternalStore(subscribeSamples, sampleVersion, sampleVersion)
  return sampleRecords(moduleId)
}

const when = (value: string) => new Date(value).toLocaleString('en-US')

/** The values a new record starts with, as the design's create form sets them. */
const STARTING_VALUES: Readonly<Record<string, string>> = { quantity: '1', packSize: '1', duration: '30', priority: 'Routine', urgency: 'Routine' }
/** The workspaces whose create form shows the patient's context first (allergies, earlier triage). */
const PATIENT_CONTEXT = ['consult', 'triage', 'pharmacy']
/** The workspaces whose drafts can be edited before they are signed or completed. */
const EDITABLE_DRAFTS = ['consult', 'triage']
/** The actions the design asks to confirm, and those that must be typed out. */
const CONFIRMED = ['delete', 'cancel', 'void', 'refund', 'revoke', 'sign']
const TYPED = ['delete', 'sign', 'refund']
/** Where a record's care continues, and the record kinds that carry into the next record. */
const CONTINUE_CARE: Readonly<Record<string, readonly string[]>> = {
  journey: ['triage', 'consult'], inpatient: ['nursing', 'nursing-tasks'], icu: ['nursing', 'nursing-tasks'],
}
const CARRIED_KINDS = ['encounter', 'visit', 'admission']

export function SampleWorkspace({ moduleId }: SampleWorkspaceProps) {
  const { page, rest } = useBluePage()
  const view = rest.split('/').filter(Boolean)
  const module = sampleModule(moduleId)
  const base = pageHrefOf(page)
  if (!module) return <EhrPageHeading title={page.label} />
  return view[0] === 'new' ? <SampleForm key={module.id} module={module} base={base} />
    : view[0] ? <SampleDetail key={`${module.id}/${view[0]}`} module={module} base={base} id={view[0]} />
      : <SampleList key={module.id} module={module} base={base} />
}

function BackToList({ base }: { readonly base: string }) {
  const navigate = useNavigate()
  return <EhrButton variant="secondary" onClick={() => navigate(base)}>Back to list</EhrButton>
}

function SampleList({ module, base }: { readonly module: Module; readonly base: string }) {
  const records = useSamples(module.id)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [quick, setQuick] = useState<SampleRecord | null>(null)
  const shown = records.filter(record => !query.trim()
    || JSON.stringify(record.fields).toLowerCase().includes(query.trim().toLowerCase()))
  const open = (record: SampleRecord) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(`${base}/${record.id}`)
  }
  const columns: EhrDataTableColumn<SampleRecord>[] = [
    { id: 'record', header: 'Record', cell: record => <>
      <a className="hid-ehr-blue-link" href={`${base}/${record.id}`} onClick={open(record)}>{sampleTitle(record)}</a>
      <span className="hid-ehr-blue-record-id">{record.id.toLowerCase()}</span>
    </> },
    { id: 'patient', header: 'Patient / context', cell: record => String(record.fields.patient ?? sampleTitle(record)) },
    { id: 'status', header: 'Status', cell: record => <EhrBadge tone="neutral">{record.status}</EhrBadge> },
    { id: 'updated', header: 'Updated', cell: record => when(record.updatedAt) },
    { id: 'quick', header: <span className="hid-ehr-sr-only">Actions</span>, cell: record => (
      <span className="hid-ehr-blue-row-actions">
        <EhrButton variant="secondary" onClick={() => setQuick(record)}>Quick view</EhrButton>
        <a className="hid-ehr-blue-link" href={`${base}/${record.id}`} onClick={open(record)} aria-label={`Open ${sampleTitle(record)}`}>Open →</a>
      </span>
    ) },
  ]
  return (
    <>
      <EhrPageHeading title={module.title} primaryAction={<EhrButton onClick={() => navigate(`${base}/new`)}>Create record</EhrButton>} />
      <EhrSampleBanner />
      <EhrCard>
        <EhrField label={`Search ${module.title}`}>
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
          emptyMessage={records.length ? 'Change your search.' : 'Create the first record when you have the appropriate permission.'}
        />
        <EhrDrawer open={quick !== null} title="Record quick view" onClose={() => setQuick(null)}>
          {quick ? <>
            <EhrSampleBanner />
            <h3 className="hid-ehr-blue-subtitle">{sampleTitle(quick)}</h3>
            <p>Last updated {when(quick.updatedAt)}</p>
            <SavedFields fields={quick.fields} />
            <EhrButton onClick={() => { setQuick(null); navigate(`${base}/${quick.id}`) }}>Open full record</EhrButton>
          </> : null}
        </EhrDrawer>
      </EhrCard>
    </>
  )
}

/** "publishedAt" → "Published At": the design labels a saved value by its key. */
function keyWords(key: string): string {
  const words = key.replace(/([A-Z])/g, ' $1')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function shownValue(value: SampleValue): string {
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  const linked = findSample(value)
  return linked ? sampleTitle(linked) : value
}

/** A record's saved values, as the design's record page lists them: every value it holds, the patient aside. */
function SavedFields({ fields }: { readonly fields: SampleFields }) {
  const entries = Object.entries(fields).filter(([key, value]) => key !== 'patient' && value !== '')
  return (
    <dl className="hid-ehr-blue-details">
      {entries.map(([key, value]) => (
        <div key={key} className="hid-ehr-blue-fact">
          <dt>{keyWords(key)}</dt>
          <dd>{shownValue(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

/** The choices a field gives: the facility's staff and departments, the patients, or the records it refers to. */
function fieldChoices(field: Field, patient: string, record?: SampleRecord): readonly Choice[] | undefined {
  if (field.options) return field.options.map(option => ({ value: option, label: option }))
  if (field.choices) return field.choices
  const facility = sampleFacilityChoices(field)
  if (facility) return facility
  if (!field.ref) return undefined
  if (field.ref === 'patient') return FICTIONAL_PATIENTS.map(name => ({ value: name, label: samplePatientLine(name) }))
  if (field.ref === 'batch') {
    return (record?.steps ?? []).filter(step => step.action === 'receive')
      .map(step => String(step.fields.lot)).map(lot => ({ value: lot, label: lot }))
  }
  return sampleRecordsOfKind(field.ref)
    .filter(candidate => !patient || candidate.fields.patient === undefined || candidate.fields.patient === patient)
    .map(candidate => ({ value: candidate.id, label: `${sampleTitle(candidate)} · ${candidate.status} · ${candidate.id.toLowerCase()}` }))
}

/** A label with the design's required mark: a star, hidden from screen readers (the control says it is required). */
function fieldLabel(field: Field): ReactNode {
  return field.required ? <>{field.label}<span aria-hidden="true"> *</span></> : field.label
}

function CheckboxField({ field, checked, problem, onChange }: {
  readonly field: Field; readonly checked: boolean; readonly problem: string | undefined; readonly onChange: (checked: boolean) => void
}) {
  const errorId = useId()
  return (
    <div className="hid-ehr-blue-check-field">
      <label className="hid-ehr-blue-check">
        {fieldLabel(field)}
        <input type="checkbox" className="hid-ehr-blue-check-input" checked={checked} required={field.required}
          aria-invalid={problem ? true : undefined} aria-describedby={problem ? errorId : undefined} data-field={field.key}
          onChange={event => onChange(event.target.checked)} />
      </label>
      {problem ? <p id={errorId} className="hid-ehr-error">{problem}</p> : null}
    </div>
  )
}

/** The fields of a form, as the design defines and lays them out, with each problem said below its field. */
function FieldInputs({ fields, values, problems, choices, onChange }: {
  readonly fields: readonly Field[]; readonly values: Record<string, SampleValue>; readonly problems: Record<string, string>
  readonly choices: (field: Field) => readonly Choice[] | undefined
  readonly onChange: (key: string, value: SampleValue) => void
}) {
  const listId = useId()
  return (
    <div className="hid-ehr-blue-form-grid">
      {fields.filter(field => field.type !== 'file').map(field => {
        const value = values[field.key]
        const text = typeof value === 'string' ? value : ''
        if (field.type === 'checkbox') {
          return <CheckboxField key={field.key} field={field} checked={value === true} problem={problems[field.key]}
            onChange={checked => onChange(field.key, checked)} />
        }
        const options = choices(field)
        return (
          <EhrField key={field.key} label={fieldLabel(field)} error={problems[field.key]} className={field.type === 'textarea' ? 'hid-ehr-blue-full' : undefined}>
            {options ? (
              <EhrSelect value={text} required={field.required} onChange={event => onChange(field.key, event.target.value)} data-field={field.key}>
                <option value="">Select…</option>
                {options.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
              </EhrSelect>
            ) : field.type === 'textarea' ? (
              <EhrTextarea value={text} required={field.required} rows={3} onChange={event => onChange(field.key, event.target.value)} data-field={field.key} />
            ) : (
              <EhrInput
                type={field.type ?? 'text'}
                value={text}
                required={field.required}
                list={field.suggestions ? `${listId}-${field.key}` : undefined}
                onChange={event => onChange(field.key, event.target.value)}
                data-field={field.key}
              />
            )}
            {field.suggestions ? (
              <datalist id={`${listId}-${field.key}`}>
                {field.suggestions.map(suggestion => <option key={suggestion} value={suggestion} />)}
              </datalist>
            ) : null}
          </EhrField>
        )
      })}
    </div>
  )
}

/** The design's checks: a required field must be filled (a required box ticked), and an email must look like one. */
function problemsOf(fields: readonly Field[], values: Record<string, SampleValue>): Record<string, string> {
  const problems: Record<string, string> = {}
  for (const field of fields) {
    if (field.type === 'file') continue
    const value = values[field.key]
    const missing = field.type === 'checkbox' ? value !== true : typeof value !== 'string' || value.trim() === ''
    if (field.required && missing) problems[field.key] = 'Complete this field.'
    else if (field.type === 'email' && typeof value === 'string' && value && !/^\S+@\S+\.\S+$/.test(value)) {
      problems[field.key] = 'Enter a valid email address.'
    }
  }
  return problems
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

/** A form's values and problems; a change clears that field's problem. */
function useFormValues(initial: () => Record<string, SampleValue>) {
  const [values, setValues] = useState(initial)
  const [problems, setProblems] = useState<Record<string, string>>({})
  const change = (key: string, value: SampleValue) => {
    setValues(current => ({ ...current, [key]: value }))
    setProblems(current => {
      if (!current[key]) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }
  return { values, setValues, problems, setProblems, change }
}

/** The values entered, in the design's field order. */
function enteredFields(fields: readonly Field[], values: Record<string, SampleValue>): Record<string, SampleValue> {
  return Object.fromEntries(fields
    .filter(field => values[field.key] !== undefined && values[field.key] !== '')
    .map(field => [field.key, values[field.key]!]))
}

function startingValues(module: Module, carried?: Record<string, SampleValue>): Record<string, SampleValue> {
  return Object.fromEntries(module.fields.flatMap(field => {
    const value = carried?.[field.key] ?? STARTING_VALUES[field.key]
    return value === undefined ? [] : [[field.key, value]]
  }))
}

function SampleForm({ module, base }: { readonly module: Module; readonly base: string }) {
  const navigate = useNavigate()
  // What the record before handed over (Continue care): read once, then let go.
  const [carried] = useState(() => sampleHandoff(module.id))
  useEffect(() => { clearSampleHandoff(module.id) }, [module.id])
  const [patient, setPatient] = useState(typeof carried?.patient === 'string' ? carried.patient : '')
  const { values, setValues, problems, setProblems, change } = useFormValues(() => startingValues(module, carried))
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
    const fields = enteredFields(module.fields, values)
    const record = createSample(module.id, module.patient ? { patient, ...fields } : fields)
    navigate(`${base}/${record.id}`)
  }

  return (
    <>
      <EhrPageHeading title={`New ${module.title.toLowerCase()}`} primaryAction={<BackToList base={base} />} />
      <EhrSampleBanner />
      <EhrCard>
        {module.patient ? (
          <EhrField label={<>Patient<span aria-hidden="true"> *</span></>}>
            <EhrSelect value={patient} required onChange={event => {
              // As in the design, each patient starts a fresh form.
              setPatient(event.target.value)
              setValues(startingValues(module))
              setProblems({})
            }}>
              <option value="">Select registered patient</option>
              {FICTIONAL_PATIENTS.map(name => <option key={name} value={name}>{samplePatientLine(name)}</option>)}
            </EhrSelect>
          </EhrField>
        ) : null}
        {patient && PATIENT_CONTEXT.includes(module.id) ? <PatientContext patient={patient} /> : null}
        {!module.patient || patient ? (
          <form ref={form} noValidate className="hid-ehr-blue-record-form" aria-label={`New ${module.title.toLowerCase()}`} onSubmit={save}>
            <FieldInputs fields={module.fields} values={values} problems={problems} onChange={change}
              choices={field => fieldChoices(field, patient)} />
            <div className="hid-ehr-blue-form-footer">
              <EhrButton type="submit">Save record</EhrButton>
            </div>
          </form>
        ) : null}
      </EhrCard>
    </>
  )
}

/** The patient's context before a triage or consultation: their recorded allergies and earlier triage. */
function PatientContext({ patient }: { readonly patient: string }) {
  const headingId = useId()
  const triage = sampleRecordsOfKind('triage').filter(record => record.fields.patient === patient)
  return (
    <section className="hid-ehr-blue-record-block" aria-labelledby={headingId}>
      <h2 id={headingId} className="hid-ehr-blue-block-title">Patient context</h2>
      <p>{patient}</p>
      <p>Recorded allergies: {samplePatientAllergies(patient) ?? 'None recorded. Confirm with the patient.'}</p>
      {triage.map(record => (
        <details key={record.id} className="hid-ehr-blue-version">
          <summary>Triage · {record.status} · {when(record.updatedAt)}</summary>
          <SavedFields fields={record.fields} />
        </details>
      ))}
    </section>
  )
}

function SampleDetail({ module, base, id }: { readonly module: Module; readonly base: string; readonly id: string }) {
  const records = useSamples(module.id)
  const navigate = useNavigate()
  const { state } = useStaff()
  const hrefOf = useSampleHref()
  const record = records.find(candidate => candidate.id.toLowerCase() === id.toLowerCase())
  const [selected, setSelected] = useState<Action | null>(null)
  const [confirming, setConfirming] = useState<{ readonly action: Action; readonly fields: Record<string, SampleValue> } | null>(null)
  const [editing, setEditing] = useState(false)
  // After an action, its form is gone: focus moves to the record's new status. A confirming dialog has unmounted by
  // then, and the shell cleared inert as it closed.
  const statusLine = useRef<HTMLDivElement>(null)
  const [acted, setActed] = useState(0)
  useLayoutEffect(() => { if (acted > 0) statusLine.current?.focus() }, [acted])

  if (!record) {
    return (
      <>
        <EhrPageHeading title="Record not found" />
        <EhrSampleBanner />
        <p className="hid-ehr-blue-flush">The record is missing or outside your authorized hospital / branch. Sample records reset when the page reloads.</p>
        <div><EhrButton onClick={() => navigate(base)}>Back to list</EhrButton></div>
      </>
    )
  }

  const author = state.status === 'ready' ? state.session.actor.displayName ?? 'You' : 'You'
  const available = module.actions.filter(action => action.from.includes(record.status))
  const patient = typeof record.fields.patient === 'string' ? record.fields.patient : undefined
  const apply = (action: Action, fields: Record<string, SampleValue>) => {
    actOnSample(module.id, record.id, { action: action.id, label: action.label, to: action.to, fields, author })
    setSelected(null)
    setConfirming(null)
    setActed(count => count + 1)
  }
  const continueTo = (CONTINUE_CARE[module.id] ?? []).filter(target => hrefOf(target) !== null)

  return (
    <>
      <EhrPageHeading title={sampleTitle(record)} primaryAction={<BackToList base={base} />} />
      <EhrSampleBanner />
      <div className="hid-ehr-blue-record">
        <div ref={statusLine} tabIndex={-1} className="hid-ehr-blue-context-line">
          <EhrBadge tone="neutral">{record.status}</EhrBadge>
          {patient ? <span>{samplePatientLine(patient)}</span> : null}
          <small>Saved {when(record.updatedAt)}</small>
        </div>
        <div className="hid-ehr-blue-two-col">
          <EhrCard title="Saved record">
            {EDITABLE_DRAFTS.includes(module.id) && record.status === 'draft' ? (
              <div className="hid-ehr-blue-card-lead">
                <EhrButton variant="secondary" onClick={() => setEditing(!editing)}>{editing ? 'Cancel editing' : 'Edit unsigned draft'}</EhrButton>
              </div>
            ) : null}
            {editing ? (
              <SampleFieldsForm fields={module.fields} initial={record.fields} label="Save draft changes"
                choices={field => fieldChoices(field, patient ?? '', record)}
                onSubmit={fields => { editSampleDraft(module.id, record.id, fields); setEditing(false) }} />
            ) : null}
            <SavedFields fields={record.fields} />
            {module.id === 'billing' ? <InvoiceTotals record={record} /> : null}
            {module.id === 'inventory' ? <StockBatches record={record} /> : null}
          </EhrCard>
          <EhrCard title="Available actions">
            {available.length ? (
              <div className="hid-ehr-blue-actions-vertical">
                {available.map(action => (
                  <EhrButton key={action.id} variant="secondary" onClick={() => setSelected(action)}>
                    {action.label}
                  </EhrButton>
                ))}
              </div>
            ) : <p className="hid-ehr-blue-flush">No further actions for your permission and this record state.</p>}
            {selected ? (
              <SampleFieldsForm key={`${record.id}-${selected.id}-${record.updatedAt}`} fields={selected.fields ?? []} label={selected.label}
                choices={field => fieldChoices(field, patient ?? '', record)}
                onSubmit={fields => CONFIRMED.includes(selected.id) ? setConfirming({ action: selected, fields }) : apply(selected, fields)} />
            ) : null}
            {CONTINUE_CARE[module.id] ? (
              <>
                <h3 className="hid-ehr-blue-block-title">Continue care</h3>
                <div className="hid-ehr-actions">
                  {continueTo.map(target => (
                    <EhrButton key={target} variant="secondary" onClick={() => {
                      handOffSample(target, { ...(patient ? { patient } : {}), ...(CARRIED_KINDS.includes(module.kind) ? { [module.kind]: record.id } : {}) })
                      navigate(`${hrefOf(target)}/new`)
                    }}>
                      Create {sampleModule(target)?.title.toLowerCase()}
                    </EhrButton>
                  ))}
                </div>
              </>
            ) : null}
          </EhrCard>
        </div>
        {patient ? <ConnectedHistory module={module} record={record} patient={patient} hrefOf={hrefOf} /> : null}
        {record.versions.length > 0 ? (
          <EhrCard title="Preserved versions & amendments">
            {record.versions.map((version, index) => (
              <details key={index} className="hid-ehr-blue-version">
                <summary>{version.at} · {version.status} · {version.reason}</summary>
                <p>Author: {version.author}</p>
                <SavedFields fields={version.fields} />
              </details>
            ))}
          </EhrCard>
        ) : null}
      </div>
      <EhrDialog
        open={confirming !== null}
        title={`${confirming?.action.label ?? 'Continue'}?`}
        description="Review the entered details before continuing. This action changes the saved record and is recorded in its history."
        confirmLabel={confirming?.action.label ?? 'Continue'}
        confirmWord={confirming && TYPED.includes(confirming.action.id) ? confirming.action.id.toUpperCase() : undefined}
        onConfirm={() => { if (confirming) apply(confirming.action, confirming.fields) }}
        onCancel={() => setConfirming(null)}
      />
    </>
  )
}

/** A form of fields and one button, as the design gives an action (and a draft's edit) under its buttons. */
function SampleFieldsForm({ fields, initial, label, choices, onSubmit }: {
  readonly fields: readonly Field[]; readonly initial?: SampleFields; readonly label: string
  readonly choices: (field: Field) => readonly Choice[] | undefined
  readonly onSubmit: (fields: Record<string, SampleValue>) => void
}) {
  const { values, problems, setProblems, change } = useFormValues(() => ({ ...initial }))
  const form = useRef<HTMLFormElement>(null)
  const focusFirst = useFirstProblemFocus(problems, form)
  return (
    <form ref={form} noValidate className="hid-ehr-blue-record-form" aria-label={label} onSubmit={event => {
      event.preventDefault()
      const found = problemsOf(fields, values)
      setProblems(found)
      if (Object.keys(found).length > 0) focusFirst()
      else onSubmit(enteredFields(fields, values))
    }}>
      <FieldInputs fields={fields} values={values} problems={problems} choices={choices} onChange={change} />
      <div className="hid-ehr-blue-form-footer">
        <EhrButton type="submit">{label}</EhrButton>
      </div>
    </form>
  )
}

function ConnectedHistory({ module, record, patient, hrefOf }: {
  readonly module: Module; readonly record: SampleRecord; readonly patient: string; readonly hrefOf: (moduleId: string) => string | null
}) {
  // A visit lists only what happened in it; any other record lists the patient's records in the other workspaces.
  const connected = connectedSamples(patient, module.id)
    .filter(other => module.id !== 'journey' || other.fields.visit === record.id)
    .flatMap(other => {
      const href = hrefOf(other.moduleId)
      return href ? [{ record: other, href: `${href}/${other.id}`, title: sampleModule(other.moduleId)?.title ?? '' }] : []
    })
  return (
    <EhrCard title="Connected hospital history">
      <p className="hid-ehr-blue-flush">Only records available to your current permissions are listed.</p>
      {connected.map(({ record: other, href, title }) => (
        <div key={`${other.moduleId}/${other.id}`} className="hid-ehr-blue-list-row">
          <Link className="hid-ehr-blue-link" to={href}>{title} · {sampleTitle(other)}</Link>
          <EhrBadge tone="neutral">{other.status}</EhrBadge>
        </div>
      ))}
    </EhrCard>
  )
}

/** An invoice's totals in minor units (kobo): its quantity at a fictional price, less the simulated payments. */
function InvoiceTotals({ record }: { readonly record: SampleRecord }) {
  const { total, paid } = invoiceTotals(record)
  return (
    <>
      <SavedFields fields={{ total: String(total), paid: String(paid), due: String(total - paid) }} />
      <p>Totals above are integer minor currency units (cents / kobo). All payments are fictional.</p>
      <div className="hid-ehr-actions">
        <EhrButton variant="secondary" onClick={() => window.print()}>Print</EhrButton>
      </div>
    </>
  )
}

/** A stock item's batches: each one received, less what was consumed or transferred from it. */
function StockBatches({ record }: { readonly record: SampleRecord }) {
  const batches = record.steps.filter(step => step.action === 'receive').map(step => {
    const lot = String(step.fields.lot)
    const units = record.steps.reduce((sum, other) => other.fields.batch !== lot ? sum
      : other.action === 'adjust' ? sum + Number(other.fields.delta || 0)
        : other.action === 'transfer' ? sum - Number(other.fields.quantity || 0) : sum, Number(step.fields.quantity || 0))
    return { lot, units, expiry: String(step.fields.expiry ?? '') }
  })
  return (
    <>
      <h3 className="hid-ehr-blue-block-title">Stock batches</h3>
      {batches.length ? batches.map(batch => <p key={batch.lot}>{batch.lot} · {batch.units} units · expires {batch.expiry}</p>)
        : <p>No batches received yet.</p>}
    </>
  )
}
