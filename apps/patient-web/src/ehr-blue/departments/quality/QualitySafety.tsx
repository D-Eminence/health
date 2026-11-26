import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { EhrButton } from '@hid/ui/ehr'
import { qualityApi, type QualityMe } from '../../../staff/api'
import { isDemoFacility } from '../../blueFacilities'
import { useBluePage } from '../../frame/pageContext'
import { useSampleCan } from '../../frame/sampleAccess'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptUnavailable } from '../parts/DeptPage'
import { qualitySamplePage } from '../sample/pages'
import { IncidentList, DEFAULT_FILTERS, type ListFilters } from './IncidentList'
import { IncidentPage } from './IncidentPage'
import { MonthlyCounts } from './MonthlyCounts'
import { QualityLeads } from './QualityLeads'
import {
  BASE, DESCRIPTION, EYEBROW, NOT_AVAILABLE, NOT_ALLOWED, TITLE, UUID, canReport, cancelled, learnFrom, manages, notServed, refusalWords,
} from './qualityRules'
import { ReportIncident } from './ReportIncident'
import './quality.css'

/**
 * Quality & Safety in the blue EHR (hid-system QUAL-1): confidential incident and near-miss reporting for one facility,
 * in place of Akos's sample (departments/sample/admin.ts qualitySample). Any staff member holding quality.incident.report
 * files a report and follows it; the reviewer a manager assigns investigates it and records corrective actions; a
 * manager (the administrator roles, or a named quality lead) sees every report, assigns, resolves, reopens and corrects,
 * reads the monthly counts, and the administrators name the leads. Every day and time is Lagos's. No Health ID, name or
 * patient in any address: incidents by UUID only.
 *
 * Built but switched off: until QUALITY_INCIDENTS_ENABLED is on (and 0197 applied), route 1 answers 503
 * QUALITY_NOT_AVAILABLE or 404, and the page shows what it shows today: the sample at the demo facilities, and "not
 * switched on yet" anywhere else, with nothing sent but that one read. The sidebar then stops listing it.
 */
export function QualitySafety() {
  const { facility, permissions } = useDeptAccess()
  if (!facility || !canReport(permissions)) return <QualityRefusal />
  return <QualityDesk key={facility.id} facilityId={facility.id} />
}

/**
 * The page's own refusal, for a member without quality.incident.report (every member before 0198 applies): at a demo
 * facility, today's sample for the design roles that open it, sending nothing; elsewhere, in plain words.
 */
export function QualityRefusal() {
  const { facility } = useDeptAccess()
  const sampleCan = useSampleCan()
  if (isDemoFacility(facility?.id) && sampleCan('quality')) return qualitySamplePage.element
  return <DeptUnavailable title={TITLE} message="Quality and safety reporting is not open to you here." />
}

/** What the page shows while the backend does not serve it (404, or 503 QUALITY_NOT_AVAILABLE): today's state. */
function QualityNotServed() {
  const { facility } = useDeptAccess()
  const sampleCan = useSampleCan()
  if (isDemoFacility(facility?.id) && sampleCan('quality')) return qualitySamplePage.element
  return <DeptUnavailable title={TITLE} message={NOT_AVAILABLE} />
}

function QualityDesk({ facilityId }: { readonly facilityId: string }) {
  const { rest } = useBluePage()
  const { membershipId } = useDeptAccess()
  const [me, setMe] = useState<QualityMe | null>(null)
  const [problem, setProblem] = useState<{ text: string; unavailable: boolean; refused: boolean } | null>(null)
  const [loading, setLoading] = useState(true)
  // What the list shows, kept while an incident below it is open (the page keeps its state).
  const [filters, setFilters] = useState<ListFilters>(DEFAULT_FILTERS)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const answer = await qualityApi.me(facilityId)
      learnFrom()
      setMe(answer)
      setProblem(null)
    } catch (caught) {
      if (cancelled(caught)) return
      learnFrom(caught)
      setProblem({ text: refusalWords(caught, 'Quality & Safety could not be loaded. Try again.'), unavailable: notServed(caught),
        refused: isHidApiError(caught) && caught.status === 403 })
    } finally { setLoading(false) }
  }, [facilityId])

  useEffect(() => { void load() }, [load])

  if (problem?.unavailable) return <QualityNotServed />
  if (problem?.refused && !me) return <DeptUnavailable title={TITLE} message={NOT_ALLOWED} />
  if (!me) {
    return (
      <DeptPage eyebrow={EYEBROW} title={TITLE} description={DESCRIPTION} className="hid-ehr-dept-qs">
        {problem ? <>
          <DeptNotice role="alert" tone="critical">{problem.text}</DeptNotice>
          <EhrButton variant="secondary" busy={loading} onClick={() => void load()}>Try again</EhrButton>
        </> : <p className="hid-ehr-state-message" role="status">Loading Quality & Safety…</p>}
      </DeptPage>
    )
  }

  const below = rest.replace(/\/+$/, '')
  const manager = manages(me)
  const shared = { facilityId, me, membershipId }
  if (below === '') return <IncidentList {...shared} mine={manager ? undefined : 'reported'} filters={filters} onFilters={setFilters} />
  if (below === 'reported-by-me') {
    return manager ? <IncidentList {...shared} mine="reported" filters={filters} onFilters={setFilters} /> : <Navigate replace to={BASE} />
  }
  if (below === 'assigned-to-me') return <IncidentList {...shared} mine="assigned" filters={filters} onFilters={setFilters} />
  if (below === 'new') return me.canReport ? <ReportIncident {...shared} /> : <Navigate replace to={BASE} />
  if (below === 'counts') return manager ? <MonthlyCounts {...shared} /> : <Navigate replace to={BASE} />
  if (below === 'leads') return manager ? <QualityLeads {...shared} /> : <Navigate replace to={BASE} />
  if (UUID.test(below)) return <IncidentPage key={below} {...shared} incidentId={below.toLowerCase()} />
  // Anything else (a sample record's id from the frame's own store, a mistyped address): the list.
  return <Navigate replace to={BASE} />
}
