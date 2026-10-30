import { useState, type ReactNode } from 'react'
import { EhrField, EhrSelect } from '@hid/ui/ehr'
import { DeptPage, DeptSection } from '../DeptPage'
import { SampleForm } from './SampleForm'
import { patientLine, SAMPLE_PATIENTS, type SampleDefinition, type SampleValues } from './model'

export interface SampleCreateProps {
  readonly definition: SampleDefinition
  readonly above: ReactNode
  readonly onBack: () => void
  /** Creates the record; a refusal in plain words keeps the form open with it. */
  readonly onCreate: (patientId: string | undefined, values: SampleValues) => string | undefined
}

/**
 * The design's create form, "New <title>": on a workspace about patients, the registered patient first, and the
 * record's fields once one is chosen; then "Save record", which opens the new record.
 */
export function SampleCreate({ definition, above, onBack, onCreate }: SampleCreateProps) {
  const [patientId, setPatientId] = useState('')
  const ready = !definition.patient || patientId !== ''
  return (
    <DeptPage title={`New ${definition.title.toLowerCase()}`} above={above} onBack={onBack}>
      <DeptSection>
        {definition.patient ? (
          <EhrField label={<>Patient<span aria-hidden="true"> *</span></>} className="hid-ehr-dept-sample-patient">
            <EhrSelect required value={patientId} onChange={event => setPatientId(event.target.value)}>
              <option value="">Select registered patient</option>
              {SAMPLE_PATIENTS.map(patient => <option key={patient.id} value={patient.id}>{patientLine(patient)}</option>)}
            </EhrSelect>
          </EhrField>
        ) : null}
        {ready ? (
          <SampleForm key={patientId} fields={definition.fields} initial={definition.defaults} context={{ patientId: patientId || undefined }}
            submitLabel="Save record" onSubmit={values => onCreate(patientId || undefined, values)} />
        ) : null}
      </DeptSection>
    </DeptPage>
  )
}
