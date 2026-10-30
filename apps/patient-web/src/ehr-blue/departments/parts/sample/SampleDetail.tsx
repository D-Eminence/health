import { useId, useState } from 'react'
import { EhrBadge, EhrButton } from '@hid/ui/ehr'
import { DeptPage, DeptSection } from '../DeptPage'
import { DeptActions, DeptFacts, DeptHistory, DeptRecordLayout } from '../DeptRecord'
import { dateText } from '../format'
import { SampleBanner } from '../SampleBanner'
import { SampleForm, type SampleConfirm } from './SampleForm'
import { useSiblingPages } from './navigation'
import {
  patientLine, recordName, samplePatient, valueFacts, type SampleAction, type SampleDefinition, type SampleRecord, type SampleValues,
} from './model'

export interface SampleDetailProps {
  /** The page's own path without '/*' ('insurance'), where its connected records' pages are found beside it. */
  readonly base: string
  readonly definition: SampleDefinition
  readonly record: SampleRecord
  readonly onBack: () => void
  /** Records the action; a refusal in plain words keeps its form open with it. */
  readonly onAct: (record: SampleRecord, action: SampleAction, values: SampleValues) => string | undefined
  /** Saves the edited fields, keeping the version before; a refusal in plain words keeps the form open with it. */
  readonly onEdit: (record: SampleRecord, values: SampleValues) => string | undefined
  /** Moves focus to an element by id, in the commit that shows it. */
  readonly focus: (id: string) => void
  /** The id of the "Saved record" heading, where focus goes after an action. */
  readonly savedHeadingId: string
}

/** The design's actions that ask before they change the record, and those that also ask for a typed word. */
const CONFIRMED = ['delete', 'cancel', 'void', 'refund', 'revoke', 'sign']
const TYPED = ['delete', 'sign', 'refund']

function confirmFor(action: SampleAction): SampleConfirm | undefined {
  if (!CONFIRMED.includes(action.id)) return undefined
  return {
    title: `${action.label}?`,
    body: 'Review the entered details before continuing. This action changes the saved record and is recorded in its history.',
    action: action.label,
    word: TYPED.includes(action.id) ? action.id.toUpperCase() : undefined,
  }
}

/**
 * The design's record view: the record's name with "Back to list", and the sample notice under it; its status, patient
 * and when it was saved; "Saved record" beside "Available actions" (each action the record's status allows, its form
 * under the actions once chosen); "Connected hospital history" on a record about a patient; and "Preserved versions &
 * amendments".
 *
 * "Edit record" is the design's "Edit unsigned draft" pattern (as on HR & Credentials): a button in "Saved record"
 * while the record is still in the status it was created in, opening the fields there with "Save changes"; each edit
 * keeps the version before.
 */
export function SampleDetail({ base, definition, record, onBack, onAct, onEdit, focus, savedHeadingId }: SampleDetailProps) {
  const uid = useId()
  const formId = `${uid}-action-form`
  const editToggleId = `${uid}-edit-toggle`
  const editFormId = `${uid}-edit-form`
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const editable = record.status === definition.initial
  const { href, follow } = useSiblingPages(base)
  const patient = samplePatient(record.patientId)
  const available = definition.actions.filter(action => action.from.includes(record.status))
  const selected = available.find(action => action.id === selectedId)
  const connections = patient && definition.connected ? definition.connected(patient.id) : []

  const act = (action: SampleAction, values: SampleValues) => {
    const refused = onAct(record, action, values)
    if (refused === undefined) {
      setSelectedId(null)
      setEditing(false)
    }
    return refused
  }

  return (
    <DeptPage title={recordName(record)} onBack={onBack}>
      <SampleBanner />
      <div className="hid-ehr-dept-context">
        <EhrBadge>{record.status}</EhrBadge>
        {patient ? <span className="hid-ehr-dept-context-item">{patientLine(patient)}</span> : null}
        <small className="hid-ehr-dept-context-item">Saved {dateText(record.updatedAt)}</small>
      </div>
      <DeptRecordLayout
        main={(
          <DeptSection title="Saved record" headingId={savedHeadingId}>
            {editable ? (
              <div className="hid-ehr-dept-toolbar">
                <EhrButton id={editToggleId} variant="secondary" aria-expanded={editing} aria-controls={editing ? editFormId : undefined}
                  onClick={() => {
                    // Opening moves focus to the first field (the form does it); cancelling brings it back here.
                    if (editing) focus(editToggleId)
                    setEditing(!editing)
                  }}>
                  {editing ? 'Cancel editing' : 'Edit record'}
                </EhrButton>
              </div>
            ) : null}
            {editable && editing ? (
              <SampleForm key={`${record.id}-edit-${record.updatedAt}`} id={editFormId} className="hid-ehr-dept-action-form" focusFirst
                fields={definition.fields} initial={record.values} context={{ patientId: record.patientId, record }} submitLabel="Save changes"
                onSubmit={values => {
                  const refused = onEdit(record, values)
                  if (refused === undefined) setEditing(false)
                  return refused
                }} />
            ) : null}
            <DeptFacts facts={valueFacts(record.values)} />
            {definition.savedExtra?.(record)}
          </DeptSection>
        )}
        aside={(
          <DeptActions empty="No further actions for your permission and this record state.">
            {available.length === 0 ? [] : [
              ...available.map(action => (
                <EhrButton key={action.id} variant="secondary" aria-expanded={action.id === selectedId}
                  aria-controls={action.id === selectedId ? formId : undefined}
                  onClick={() => setSelectedId(current => current === action.id ? null : action.id)}>
                  {action.label}
                </EhrButton>
              )),
              selected ? (
                <SampleForm key={`${record.id}-${selected.id}-${record.updatedAt}`} id={formId} className="hid-ehr-dept-action-form"
                  fields={selected.fields ?? []} context={{ patientId: record.patientId, record }} submitLabel={selected.label}
                  confirm={confirmFor(selected)} onSubmit={values => act(selected, values)} />
              ) : null,
            ]}
          </DeptActions>
        )}
      />
      {patient ? (
        <DeptSection title="Connected hospital history">
          <p>Only records available to your current permissions are listed.</p>
          {connections.length > 0 ? (
            <ul className="hid-ehr-dept-rows hid-ehr-dept-sample-connected">
              {connections.map(connection => (
                <li key={connection.key}>
                  <a className="hid-ehr-dept-link" href={href(connection.page)} onClick={event => follow(connection.page, event)}>
                    {connection.title} · {connection.name}
                  </a>
                  <EhrBadge>{connection.status}</EhrBadge>
                </li>
              ))}
            </ul>
          ) : null}
        </DeptSection>
      ) : null}
      <DeptHistory entries={record.versions.map((version, index) => ({
        key: `${index}-${version.at}`,
        summary: `${version.at} · ${version.status} · ${version.reason}`,
        detail: <>
          <p>Author: Sample user</p>
          <DeptFacts facts={valueFacts(version.values)} />
        </>,
      }))} />
    </DeptPage>
  )
}
