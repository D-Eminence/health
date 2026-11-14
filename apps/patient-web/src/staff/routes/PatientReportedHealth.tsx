import { useEffect, useState } from 'react'
import { isHidApiError } from '@hid/http'
import { Badge, Card } from '@hid/ui'
import { staffApi } from '../api'
import { HEALTH_FIELDS, type HealthFields, type ReportedHealthProfile } from '../../profileParity'

/** As the patient's profile names them (hid-1.0's biodata). */
const LABELS: Readonly<Record<keyof HealthFields, string>> = {
  bloodGroup: 'Blood group', genotype: 'Genotype', allergies: 'Allergies', currentMedications: 'Current medications',
  chronicConditions: 'Chronic conditions', medicalNotes: 'Medical notes for the care team',
}

function savedOn(value: string | null) {
  const parsed = value ? new Date(value) : null
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleString() : null
}

/**
 * "Reported by the patient" on the chart (hid-1.0 parity B3, the lead's decision): the health information the patient
 * entered in their portal, read while access to them is granted, as the chart's other reads are, and audited as a
 * view of their record. It is what the patient says, not a clinical finding, and is labelled so. Not shown where EHR
 * does not serve it (404), refuses it (403), or the patient has stated nothing; mounted with a patient, facility and
 * actor key, so nothing of another patient's survives.
 */
export function PatientReportedHealth({ facilityId, patientId }: { facilityId: string; patientId: string }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'hidden' } | { status: 'failed' } | { status: 'shown'; profile: ReportedHealthProfile }>({ status: 'loading' })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setState({ status: 'loading' })
    void (async () => {
      try {
        const profile = await staffApi.reportedHealthProfile(facilityId, patientId, controller.signal)
        if (!controller.signal.aborted) setState(profile ? { status: 'shown', profile } : { status: 'hidden' })
      } catch (caught) {
        if (controller.signal.aborted) return
        // Refused or not served: nothing is shown. Only the service failing to answer says so, with a retry.
        setState(isHidApiError(caught) && caught.status !== 403 && caught.status !== 404 ? { status: 'failed' } : { status: 'hidden' })
      }
    })()
    return () => controller.abort()
  }, [facilityId, patientId, revision])

  if (state.status === 'loading' || state.status === 'hidden') return null
  if (state.status === 'failed') {
    return <Card className="staff-card"><h2>Reported by the patient</h2>
      <p>What the patient entered about their health could not be loaded.</p>
      <button type="button" className="staff-text-link" onClick={() => setRevision(value => value + 1)}>Retry patient-reported health information</button></Card>
  }
  const { profile } = state
  const when = savedOn(profile.updatedAt)
  return <section aria-labelledby="patient-reported-health-title"><Card className="staff-card">
    <h2 id="patient-reported-health-title">Reported by the patient</h2>
    <p><Badge tone="warning">Patient-reported</Badge> Entered by the patient in their Health ID portal, not clinically verified. It does
      not change this record.{when ? ` Last updated ${when}.` : ''}</p>
    <dl className="staff-reported-health">{HEALTH_FIELDS.map(field => <div key={field} className="staff-detail">
      <dt><span>{LABELS[field]}</span></dt><dd><strong className="staff-multiline">{profile[field] ?? 'Not stated'}</strong></dd></div>)}</dl>
  </Card></section>
}
