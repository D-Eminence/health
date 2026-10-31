import { EhrButton, EhrCard, EhrField, EhrInput } from '@hid/ui/ehr'
import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ActionList, ConfirmAction, DetailGrid, DetailMeta, HistoryCard, SavedRecord, SubHeading, VersionsCard } from '../parts/Detail'
import { ErrorBox, NoActions, RecordHeading, RecordNotFound } from '../parts/Notices'
import { COMPLETE_FIELD, RecordForm, type FormValues } from '../parts/RecordForm'
import { SampleBanner } from '../parts/SampleBanner'
import { useWorkspaceHref } from '../parts/Workspace'
import { useStandaloneSample } from './context'
import { isSampleWorkspace, type SampleAction, type SampleDefinition, type SampleField } from './definitions'
import { formFields, toData } from './fields'
import { UNKNOWN_SAMPLE } from './SampleList'
import type { SampleRecord } from './seed'
import {
  applySampleAction, confirmationFor, displayItems, findListed, historyFor, patientLabel, patientOf, recordName,
  sampleDefinition, setSampleHandoff, useSampleState, type SampleState,
} from './store'

export const FILE_TOO_LARGE = 'Choose an image or PDF smaller than 2 MB.'
const MAX_FILE = 2 * 1024 * 1024

/**
 * The design's record page: heading and "Back to list", the status line, "Saved record" beside "Available actions"
 * (each action opens its inline form; cancel asks first; delete, sign and refund ask for the typed word),
 * "Continue care" (into another sample workspace only), "Connected hospital history" and "Preserved versions &
 * amendments".
 */
export function SampleDetail({ id }: { id: string }) {
  const { recordId } = useParams()
  const definition = sampleDefinition(id)
  const href = useWorkspaceHref()
  const standalone = useStandaloneSample()
  const current = useSampleState()
  const banner = standalone ? <SampleBanner /> : null

  if (!definition) return <>{banner}<ErrorBox>{UNKNOWN_SAMPLE}</ErrorBox></>
  const record = findListed(current, definition, recordId)
  if (!record) return <>{banner}<RecordNotFound backHref={href()} /></>
  return <>{banner}<RecordPage key={record.id} definition={definition} record={record} current={current} /></>
}

interface Asking {
  readonly label: string
  readonly word?: string
  readonly answer: (confirmed: boolean) => void
}

function RecordPage({ definition, record, current }: { definition: SampleDefinition; record: SampleRecord; current: SampleState }) {
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const [selected, setSelected] = useState<string | null>(null)
  const [asking, setAsking] = useState<Asking | null>(null)
  const [settled, setSettled] = useState(0)
  const actionsRef = useRef<HTMLDivElement>(null)

  // After an action the form closes; focus stays in "Available actions" (a layout effect, never a deferred focus).
  useLayoutEffect(() => {
    if (settled > 0) actionsRef.current?.focus()
  }, [settled])

  const patient = patientOf(current, record.patientId)
  const available = definition.actions.filter(action => action.from.includes(record.status))
  const action = available.find(item => item.id === selected)
  const history = historyFor(current, definition, record)
  // Only ever another sample workspace's create page, never a live one (whose form would open on the chart's patient).
  const handoffs = (definition.continueCare ?? []).filter(handoff => isSampleWorkspace(handoff.workspace))

  const ask = (label: string, word: string | undefined) => new Promise<boolean>(resolve => {
    setAsking({ label, word, answer: resolve })
  })
  const answer = (confirmed: boolean) => {
    asking?.answer(confirmed)
    setAsking(null)
  }

  return (
    <>
      <RecordHeading title={recordName(record)} backHref={href()} />
      <DetailMeta status={record.status} patient={patient ? patientLabel(patient) : undefined} saved={record.updatedAt} />
      <DetailGrid>
        <SavedRecord items={displayItems(current, record.data)} />
        <EhrCard title="Available actions">
          <div ref={actionsRef} tabIndex={-1} className="hid-ehr-clinical-sample-actions">
            {available.length > 0 ? (
              <ActionList>
                {available.map(item => (
                  <EhrButton key={item.id} variant="secondary" aria-expanded={item.id === selected} onClick={() => setSelected(item.id)}>{item.label}</EhrButton>
                ))}
              </ActionList>
            ) : <NoActions />}
            {action ? (
              <ActionForm
                key={action.id}
                definition={definition}
                record={record}
                action={action}
                current={current}
                ask={ask}
                onDone={() => { setSelected(null); setSettled(count => count + 1) }}
              />
            ) : null}
            {/* The design draws the heading on every visit and admission, with or without a hand-off to offer. */}
            {definition.continueCare ? (
              <>
                <SubHeading>Continue care</SubHeading>
                {handoffs.length > 0 ? (
                  <div className="hid-ehr-clinical-step-row">
                    {handoffs.map(handoff => (
                      <EhrButton
                        key={handoff.workspace}
                        variant="secondary"
                        onClick={() => {
                          setSampleHandoff(handoff, record)
                          navigate(href.to(handoff.workspace, 'new'))
                        }}
                      >
                        {`Create ${handoff.title.toLowerCase()}`}
                      </EhrButton>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </EhrCard>
      </DetailGrid>
      {record.patientId ? (
        <div className="hid-ehr-clinical-sample-history">
          <HistoryCard
            empty=""
            items={history.map(entry => ({
              key: entry.key,
              label: `${entry.title} · ${entry.name}`,
              // A fictional connected row exists nowhere live: it opens its workspace's list, carrying nothing.
              href: entry.recordId ? href.to(entry.workspace, entry.recordId) : href.to(entry.workspace),
              status: entry.status,
            }))}
          />
        </div>
      ) : null}
      <VersionsCard
        versions={record.versions.map((version, index) => ({
          key: `${index}-${version.at}`,
          summary: `${version.at} · ${version.status} · ${version.reason}`,
          author: version.author,
          items: displayItems(current, version.data),
        }))}
      />
      <ConfirmAction
        open={asking !== null}
        label={asking?.label ?? ''}
        word={asking?.word}
        onConfirm={() => answer(true)}
        onCancel={() => answer(false)}
      />
    </>
  )
}

/** An action's inline form: its fields (none for a one-step action) and a submit button named as the action. */
function ActionForm({ definition, record, action, current, ask, onDone }: {
  definition: SampleDefinition
  record: SampleRecord
  action: SampleAction
  current: SampleState
  ask: (label: string, word: string | undefined) => Promise<boolean>
  onDone: () => void
}) {
  const fields = action.fields ?? []
  const fileFields = fields.filter(field => field.type === 'file')
  const [file, setFile] = useState('')
  const [fileError, setFileError] = useState<string | undefined>(undefined)
  const fileInput = useRef<HTMLInputElement>(null)

  const submit = async (values: FormValues) => {
    const data = toData(values)
    for (const field of fileFields) {
      if (!file) {
        setFileError(COMPLETE_FIELD)
        fileInput.current?.focus()
        return false
      }
      data[field.key] = file
    }
    const confirmation = confirmationFor(action.id)
    if (confirmation && !(await ask(action.label, confirmation.word))) return false
    const outcome = applySampleAction(definition.id, record.id, action.id, data)
    if ('error' in outcome) return { formError: outcome.error }
    onDone()
  }

  return (
    <RecordForm fields={formFields(current, fields, record.patientId)} submitLabel={action.label} onSubmit={submit}>
      {fileFields.length > 0 ? (
        <div className="hid-ehr-clinical-form-grid hid-ehr-clinical-sample-file">
          {fileFields.map(field => (
            <FileField key={field.key} field={field} inputRef={fileInput} error={fileError} onChoose={(chosen, problem) => { setFile(chosen); setFileError(problem) }} />
          ))}
        </div>
      ) : null}
    </RecordForm>
  )
}

/**
 * "Image or PDF (max 2 MB)". The sample keeps only a note that a study was chosen: the file is never read, kept
 * or sent anywhere.
 */
function FileField({ field, inputRef, error, onChoose }: {
  field: SampleField
  inputRef: RefObject<HTMLInputElement | null>
  error: string | undefined
  onChoose: (chosen: string, problem: string | undefined) => void
}) {
  return (
    <EhrField label={<>{field.label}{field.required !== false ? <span aria-hidden="true"> *</span> : null}</>} error={error}>
      <EhrInput
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        onChange={event => {
          const chosen = event.target.files?.[0]
          if (!chosen) return onChoose('', undefined)
          if (chosen.size > MAX_FILE) return onChoose('', FILE_TOO_LARGE)
          const kind = chosen.type === 'application/pdf' ? 'PDF' : 'image'
          onChoose(`Local ${kind} study chosen (sample: not uploaded)`, undefined)
        }}
      />
    </EhrField>
  )
}
