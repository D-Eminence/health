import { useId, useState, type ReactNode } from 'react'
import { EhrBadge, EhrButton } from '@hid/ui/ehr'
import { DeptPage, DeptSection } from '../DeptPage'
import { DeptActions, DeptFacts, DeptHistory, DeptRecordLayout } from '../DeptRecord'
import { dateText } from '../format'
import { SampleForm, type SampleConfirm } from './SampleForm'
import { useSiblingPages } from './navigation'
import {
  patientLine, recordName, samplePatient, valueFacts, type SampleAction, type SampleDefinition, type SampleRecord, type SampleValues,
} from './model'

export interface SampleDetailProps {
  readonly definition: SampleDefinition
  readonly record: SampleRecord
  readonly above: ReactNode
  readonly onBack: () => void
  /** Records the action; a refusal in plain words keeps its form open with it. */
  readonly onAct: (record: SampleRecord, action: SampleAction, values: SampleValues) => string | undefined
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
 * The design's record view: the record's name with "Back to list"; its status, patient and when it was saved; "Saved
 * record" beside "Available actions" (each action the record's status allows, its form under the actions once
 * chosen); "Connected hospital history" on a record about a patient; and "Preserved versions & amendments".
 */
export function SampleDetail({ definition, record, above, onBack, onAct, savedHeadingId }: SampleDetailProps) {
  const uid = useId()
  const formId = `${uid}-action-form`
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { href, follow } = useSiblingPages()
  const patient = samplePatient(record.patientId)
  const available = definition.actions.filter(action => action.from.includes(record.status))
  const selected = available.find(action => action.id === selectedId)
  const connections = patient && definition.connected ? definition.connected(patient.id) : []

  const act = (action: SampleAction, values: SampleValues) => {
    const refused = onAct(record, action, values)
    if (refused === undefined) setSelectedId(null)
    return refused
  }

  return (
    <DeptPage title={recordName(record)} above={above} onBack={onBack}>
      <div className="hid-ehr-dept-context">
        <EhrBadge>{record.status}</EhrBadge>
        {patient ? <span className="hid-ehr-dept-context-item">{patientLine(patient)}</span> : null}
        <small className="hid-ehr-dept-context-item">Saved {dateText(record.updatedAt)}</small>
      </div>
      <DeptRecordLayout
        main={(
          <DeptSection title="Saved record" headingId={savedHeadingId}>
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
