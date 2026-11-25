import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, CalendarPlus, ChevronRight } from 'lucide-react'
import { isHidApiError } from '@hid/http'
import { Badge, Button, Card, CardHeader, ListRow, type Tone } from '../../../kasuwa/ui'
import { appointmentsApi, type AppointmentCard } from '../../../staff/api'
import { useDeptAccess } from '../parts/access'
import {
  BASE, canRead, canWrite, dayText, handPatient, learnFrom, notServed, refusalWords, statusText, timeRangeText, visitTypeText,
} from './appointmentRules'

const TONES: Readonly<Record<string, Tone>> = { booked: 'brand', checked_in: 'success', no_show: 'warn', cancelled: 'neutral' }

/**
 * "Appointments" on a patient's page (hid-system APPT-1 route 4): this facility's appointments for the patient, upcoming
 * and the last 90 days, each opening its appointment, with "Book an appointment" for those who book. Shown to members who
 * see appointments here, wherever Health ID serves them: a 404 or 503 (not served or switched off) shows nothing, as the
 * chart's other cards do. It reads only this facility's bookings and opens no chart.
 */
export function PatientAppointmentsCard({ patientId, fullName }: { readonly patientId: string; readonly fullName: string }) {
  const { facility, permissions } = useDeptAccess()
  const navigate = useNavigate()
  const reads = canRead(permissions)
  const facilityId = facility?.id ?? ''
  const [state, setState] = useState<{ key: string; items: readonly AppointmentCard[] | null; error: string; hidden: boolean }>(
    { key: '', items: null, error: '', hidden: false })
  const key = `${facilityId}|${patientId}`

  useEffect(() => {
    if (!reads || !facilityId || !patientId) return
    let alive = true
    appointmentsApi.forPatient(facilityId, patientId).then(answer => {
      learnFrom()
      if (alive) setState({ key, items: answer.items, error: '', hidden: false })
    }, caught => {
      if (isHidApiError(caught) && caught.code === 'REQUEST_CANCELLED') return
      learnFrom(caught)
      if (alive) setState({ key, items: null, error: refusalWords(caught, 'The appointments could not be loaded.'), hidden: notServed(caught) })
    })
    return () => { alive = false }
  }, [reads, facilityId, patientId, key])

  if (!reads || !facilityId || state.hidden) return null
  const current = state.key === key ? state : null
  const items = current?.items ?? null

  function book() {
    handPatient({ patientId, fullName, facilityId })
    navigate(`${BASE}/new`)
  }

  return (
    <Card aria-labelledby="patient-appointments-title">
      <CardHeader as="h2" titleId="patient-appointments-title" title="Appointments" icon={CalendarDays} iconTone="brand"
        actions={canWrite(permissions) ? <Button size="sm" variant="secondary" icon={CalendarPlus} onClick={book}>Book an appointment</Button> : undefined} />
      {current?.error ? <p className="m-0 px-5 py-4 text-[13px] text-ink-3" role="alert">{current.error}</p> : null}
      {!current ? <p className="m-0 px-5 py-4 text-[13px] text-ink-3" role="status">Loading appointments…</p> : null}
      {items && items.length === 0 ? <p className="m-0 px-5 py-4 text-[13px] text-ink-3">No appointments here in the last 90 days or to come.</p> : null}
      {items && items.length > 0 ? (
        <ul className="m-0 list-none divide-y divide-line p-0" aria-label={`${fullName}’s appointments here`}>
          {items.map(card => (
            <li key={card.appointmentId}>
              <ListRow onClick={() => navigate(`${BASE}/${card.appointmentId}`)}
                title={`${dayText(card.appointmentDay)}, ${timeRangeText(card)}`}
                subtitle={[card.clinicName, visitTypeText(card.visitType)].filter(Boolean).join(' · ')}
                trailing={<span className="flex items-center gap-2"><Badge size="sm" tone={TONES[card.status] ?? 'neutral'}>{statusText(card.status)}</Badge>
                  <ChevronRight className="size-4 text-ink-3" aria-hidden /></span>} />
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  )
}
