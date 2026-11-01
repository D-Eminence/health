import { isHidApiError, plainErrorText } from '@hid/http'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ACCESS_OUTCOME_FILTERS, ACCESS_REQUEST_STATUSES, staffApi, type AccessRequest, type AccessRequestStatus } from '../../../staff/api'
import { accessRequestsError, outcome } from '../../../staff/routes/AccessRequests'
import { formatWhen } from '../parts/format'
import type { KeyValue } from '../parts/KeyValueList'
import type { RecordRow } from '../parts/RecordTable'
import { useClinical } from '../parts/Workspace'

/** Today's filter wording (AccessRequests.tsx FILTER_LABELS, not exported there): the backend matches either. */
export const FILTER_LABELS: Readonly<Record<AccessRequestStatus, string>> = {
  pending: 'Waiting for the patient', approved: 'Approved (any outcome)', denied: 'Denied',
  active: 'Access active', expired: 'Expired', closed: 'Closed by you', revoked: 'Ended by the patient',
}

/** A Status filter from a request page's address, used only if it is one of today's. */
export function statusFilter(value: string | null): AccessRequestStatus | '' {
  const filters: readonly string[] = [...ACCESS_REQUEST_STATUSES, ...ACCESS_OUTCOME_FILTERS]
  return value !== null && filters.includes(value) ? value as AccessRequestStatus : ''
}

export const SCOPE_LABELS: Readonly<Record<AccessRequest['scope'], string>> = {
  read_records: 'See their records',
  write_records: 'See and add to their records',
}

/** Today's close refusals (AccessRequests.tsx closeError, not exported there). */
export function closeError(caught: unknown): string {
  if (isHidApiError(caught) && (caught.code === 'CONSENT_RESOURCE_NOT_FOUND' || caught.code === 'CONSENT_COMMAND_CONFLICT')) {
    return 'This access had already ended. The list has been refreshed.'
  }
  return plainErrorText(caught, 'We couldn’t end this access. Please try again.', { audience: 'facility' })
}

export function methodLabel(request: AccessRequest): string {
  if (!request.authorizationMethod) return ''
  return request.authorizationMethod === 'patient_access_pin' ? 'Patient PIN' : 'Patient approval'
}

/** Today's patient context: never a name or Health ID, only the last four characters of the patient's id. */
export function patientContext(request: AccessRequest): string {
  return `Patient ••••${request.patientId.slice(-4)}`
}

/** Whether the request's grant is active and can be closed by this clinician. */
export function closable(request: AccessRequest): boolean {
  return request.effectiveStatus === 'active' && !!request.consentGrantId
}

/** Today's extras after the status: how it was given, until when, the patient's reason for denying. */
export function statusNote(request: AccessRequest): string {
  return [
    methodLabel(request),
    request.effectiveStatus === 'active' && request.grantExpiresAt ? `until ${formatWhen(request.grantExpiresAt)}` : '',
    request.status === 'denied' && request.deniedReason ? request.deniedReason : '',
  ].filter(Boolean).join(' · ')
}

/** The request as the design's key and value list prints it. */
export function requestDetails(request: AccessRequest): KeyValue[] {
  const items: KeyValue[] = [
    { label: 'Why', value: request.reason },
    { label: 'What you asked for', value: SCOPE_LABELS[request.scope] ?? request.scope },
    { label: 'How long', value: `${request.requestedDurationMinutes} minute${request.requestedDurationMinutes === 1 ? '' : 's'}` },
    { label: 'Patient', value: patientContext(request) },
    { label: 'Requested', value: formatWhen(request.requestedAt) },
  ]
  if (request.approvedAt) items.push({ label: 'Approved', value: formatWhen(request.approvedAt) })
  if (request.deniedAt) items.push({ label: 'Denied', value: formatWhen(request.deniedAt) })
  if (request.deniedReason) items.push({ label: 'The patient said', value: request.deniedReason })
  if (request.authorizationMethod) items.push({ label: 'Approved with', value: methodLabel(request) })
  if (request.grantExpiresAt) items.push({ label: 'Access until', value: formatWhen(request.grantExpiresAt) })
  return items
}

/** The request's latest change (asked, approved or denied): the list's Updated and the page's Saved. */
export function latest(request: AccessRequest): string {
  return [request.deniedAt, request.approvedAt, request.requestedAt]
    .filter((value): value is string => !!value)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? request.requestedAt
}

export function requestRow(request: AccessRequest): RecordRow {
  return {
    id: request.accessRequestId,
    name: request.reason,
    context: patientContext(request),
    contextSub: SCOPE_LABELS[request.scope] ?? request.scope,
    status: outcome(request).label,
    statusNote: statusNote(request) || undefined,
    updated: latest(request),
    details: [{ label: 'Status', value: outcome(request).label }, ...requestDetails(request)],
  }
}

export interface RequestList {
  readonly requests: AccessRequest[] | null
  readonly loading: boolean
  readonly error: string
  /** An Identity build with hid-system 0074 reports outcomes; only then are the outcome filters offered. */
  readonly outcomesReported: boolean
  readonly load: () => Promise<void>
}

/**
 * This facility's access requests sent by this clinician (today's AccessRequests load): read again when the facility
 * or filter changes; only the latest read may change what is shown.
 */
export function useAccessRequests(status: AccessRequestStatus | ''): RequestList {
  const { facility } = useClinical()
  const facilityId = facility?.id
  const [requests, setRequests] = useState<AccessRequest[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [outcomesReported, setOutcomesReported] = useState(false)
  const sequence = useRef(0)

  const load = useCallback(async () => {
    if (!facilityId) return
    const current = ++sequence.current
    setLoading(true)
    try {
      const items = await staffApi.listAccessRequests(facilityId, status || undefined)
      if (current !== sequence.current) return
      setRequests(items)
      setError('')
      if (items.some(item => item.effectiveStatus !== undefined)) setOutcomesReported(true)
    } catch (caught) {
      if (current === sequence.current) { setRequests(null); setError(accessRequestsError(caught)) }
    } finally {
      if (current === sequence.current) setLoading(false)
    }
  }, [facilityId, status])

  useEffect(() => {
    setRequests(null)
    void load()
    return () => { sequence.current += 1 }
  }, [load])

  return { requests, loading, error, outcomesReported, load }
}
