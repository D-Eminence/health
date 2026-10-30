import { EhrCard, EhrField, EhrSelect } from '@hid/ui/ehr'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ErrorBox, RecordHeading } from '../parts/Notices'
import { RecordForm, type FormValues } from '../parts/RecordForm'
import { SampleBanner } from '../parts/SampleBanner'
import { useWorkspaceHref } from '../parts/Workspace'
import { useStandaloneSample } from './context'
import { createInitial, formFields, toData } from './fields'
import { UNKNOWN_SAMPLE } from './SampleList'
import { clearSampleHandoff, createSampleRecord, patientLabel, patientOf, pendingHandoff, sampleDefinition, useSampleState } from './store'

/**
 * The design's create page: "New {title}", then, for a patient workspace, "Patient *" ("Select registered
 * patient"), whose fields appear once a fictional patient is chosen; "Save record" opens the new record. A "Continue
 * care" hand-off arrives with its patient (and its admission) already chosen.
 */
export function SampleCreate({ id }: { id: string }) {
  const definition = sampleDefinition(id)
  const href = useWorkspaceHref()
  const navigate = useNavigate()
  const standalone = useStandaloneSample()
  const current = useSampleState()
  const [carried] = useState(() => pendingHandoff(id))
  const [patientId, setPatientId] = useState(carried?.patientId ?? '')

  useEffect(() => {
    if (carried) clearSampleHandoff()
  }, [carried])

  if (!definition) return <ErrorBox>{UNKNOWN_SAMPLE}</ErrorBox>

  const patient = definition.patient ? patientOf(current, patientId) : undefined
  const ready = !definition.patient || patient !== undefined
  const forPatient = patient?.id

  const submit = (values: FormValues) => {
    const outcome = createSampleRecord(definition.id, forPatient, toData(values))
    if ('error' in outcome) return { formError: outcome.error }
    navigate(href(outcome.id))
  }

  return (
    <>
      {standalone ? <SampleBanner /> : null}
      <RecordHeading title={`New ${definition.title.toLowerCase()}`} backHref={href()} />
      <EhrCard>
        {definition.patient ? (
          <EhrField label={<>Patient<span aria-hidden="true"> *</span></>}>
            <EhrSelect required value={patientId} onChange={event => setPatientId(event.target.value)}>
              <option value="">Select registered patient</option>
              {current.patients.map(person => <option key={person.id} value={person.id}>{patientLabel(person)}</option>)}
            </EhrSelect>
          </EhrField>
        ) : null}
        {ready ? (
          <RecordForm
            key={forPatient ?? 'no-patient'}
            fields={formFields(current, definition.fields, forPatient)}
            initial={createInitial(definition.fields, carried && carried.patientId === forPatient ? carried.values : undefined)}
            onSubmit={submit}
          />
        ) : null}
      </EhrCard>
    </>
  )
}
