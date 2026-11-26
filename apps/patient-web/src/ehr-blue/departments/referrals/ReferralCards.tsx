import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Share2 } from 'lucide-react'
import { EhrCard } from '@hid/ui/ehr'
import { Badge, Card, CardHeader, ListRow, type Tone } from '../../../kasuwa/ui'
import { referralsApi, type ReferralCard } from '../../../staff/api'
import type { Chart } from '../../clinical/parts/chart'
import { DeptNotice } from '../parts/DeptNotice'
import { ReferralRow } from './ReferralParts'
import {
  BASE, REFERRAL_READ, departmentText, learnFrom, notServed, otherFacilityText, outcomeText, refusalWords, stateText, urgencyText,
  useReferralsServed, whenText,
} from './referralRules'
import './referrals.css'

type Read = { readonly key: string; readonly items: readonly ReferralCard[] | null; readonly error: string } | null

/**
 * A patient's referrals at this facility (REF-1 route 8): sent from here, or received here once accepted, newest first.
 * With `encounterId`, one visit's. Read only in direct care by members holding ehr.referral.read; the server also checks
 * the patient's read access (403 CONSENT_REQUIRED). `shown` false where Health ID does not serve referrals (404, or 503
 * while switched off): the cards then show nothing, as the chart's other cards do.
 */
function usePatientReferrals(chart: Chart, encounterId?: string) {
  const served = useReferralsServed()
  const shown = chart.purpose === 'direct-care' && chart.can(REFERRAL_READ) && served !== false
  const [read, setRead] = useState<Read>(null)
  const key = `${chart.facilityId}|${chart.patientId}|${encounterId ?? ''}`

  useEffect(() => {
    if (!shown) return
    let alive = true
    referralsApi.forPatient(chart.facilityId, chart.patientId, encounterId).then(answer => {
      learnFrom()
      if (alive) setRead({ key, items: Array.isArray(answer?.items) ? answer.items : [], error: '' })
    }, (caught: unknown) => {
      learnFrom(caught)
      if (alive && !notServed(caught)) setRead({ key, items: null, error: refusalWords(caught, 'The referrals could not be loaded.') })
    })
    return () => { alive = false }
  }, [shown, chart.facilityId, chart.patientId, encounterId, key])

  return { shown, read: read?.key === key ? read : null }
}

/** The visit page's referrals, with their status and outcome, each opening on the Referrals page. */
export function VisitReferrals({ chart, encounterId }: { readonly chart: Chart; readonly encounterId: string }) {
  const { shown, read } = usePatientReferrals(chart, encounterId)
  if (!shown) return null
  return (
    <EhrCard title="Referrals from this visit">
      {read === null ? <p className="hid-ehr-state-message" role="status">Loading referrals…</p> : null}
      {read?.error ? <DeptNotice role="alert" tone="critical">{read.error}</DeptNotice> : null}
      {read?.items && read.items.length === 0 ? <p className="hid-ehr-clinical-note">No referrals from this visit.</p> : null}
      {read?.items && read.items.length > 0 ? (
        <ul className="hid-ehr-dept-referrals-list" aria-label="Referrals from this visit">
          {read.items.map(card => <ReferralRow key={card.referralId} card={card} />)}
        </ul>
      ) : null}
    </EhrCard>
  )
}

const TONES: Readonly<Record<string, Tone>> = { sent: 'brand', accepted: 'success', arrived: 'success', completed: 'success', declined: 'warn', expired: 'warn' }

/** "Referrals" on the patient page: sent from here or received here, each opening on the Referrals page. */
export function PatientReferralsCard({ chart }: { readonly chart: Chart }) {
  const navigate = useNavigate()
  const { shown, read } = usePatientReferrals(chart)
  if (!shown) return null
  const items = read?.items ?? null
  return (
    <Card aria-labelledby="patient-referrals-title">
      <CardHeader as="h2" titleId="patient-referrals-title" title="Referrals" icon={Share2} iconTone="brand" />
      {read?.error ? <p className="m-0 px-5 py-4 text-[13px] text-ink-3" role="alert">{read.error}</p> : null}
      {read === null ? <p className="m-0 px-5 py-4 text-[13px] text-ink-3" role="status">Loading referrals…</p> : null}
      {items && items.length === 0 ? <p className="m-0 px-5 py-4 text-[13px] text-ink-3">No referrals sent from or received at this facility.</p> : null}
      {items && items.length > 0 ? (
        <ul className="m-0 list-none divide-y divide-line p-0" aria-label="This patient’s referrals">
          {items.map(card => (
            <li key={card.referralId}>
              <ListRow onClick={() => navigate(`${BASE}/${card.referralId}`)}
                title={`${card.side === 'sent' ? 'To' : 'From'} ${otherFacilityText(card)}`}
                subtitle={[departmentText(card.departmentCode), urgencyText(card.urgency), `Sent ${whenText(card.sentAt)}`,
                  card.outcome ? `Outcome: ${outcomeText(card.outcome.code, card.side === 'received')}` : ''].filter(Boolean).join(' · ')}
                trailing={<span className="flex items-center gap-2"><Badge size="sm" tone={TONES[card.effectiveState] ?? 'neutral'}>{stateText(card)}</Badge>
                  <ChevronRight className="size-4 text-ink-3" aria-hidden /></span>} />
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  )
}
