import type { ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { EhrBadge } from '@hid/ui/ehr'
import type { ReferralCard, ReferralPackage } from '../../../staff/api'
import { isDemoFacility } from '../../blueFacilities'
import { SampleWorkspace } from '../../clinical/sample/SampleWorkspace'
import { useSampleCan } from '../../frame/sampleAccess'
import { useDeptAccess } from '../parts/access'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptUnavailable } from '../parts/DeptPage'
import {
  BASE, DESCRIPTION, EYEBROW, NOT_AVAILABLE, NOT_AVAILABLE_MORE, PAGE_REFUSED, TITLE, bornText, declineReasonText, departmentText,
  destinationText, healthIdEnding, otherFacilityText, outcomeText, packageKindText, packageSummaryText, previewPatientText,
  referrerText, sexText, stateText, stateTone, urgencyText, urgencyTone, whenText, withdrawReasonText,
} from './referralRules'
import './referrals.css'

/**
 * Today's sample Referral Network (clinical/sample, the design's "referrals" workspace), kept at the demo facilities until
 * Health ID serves referrals there: fictional records under the sample notice, which call nothing and save nothing. A
 * design role the sample is closed to, and every other facility, get the page's own words instead.
 */
export function ReferralSample() {
  const { pathname } = useLocation()
  const below = (/\/referrals\/(.*)$/.exec(pathname)?.[1] ?? '').replace(/\/+$/, '')
  // An address only the live page has (a tab, a letter) would be a record the sample can't find: its list instead.
  if (LIVE_ONLY.test(below)) return <Navigate replace to={BASE} />
  return <SampleWorkspace id="referrals" />
}

const LIVE_ONLY = /^(sent|incoming|received|expected)$|\/letter$/

/** Whether the sample stands in here: a demo facility, for a design role the sample opens to. */
export function useSampleStandsIn(): boolean {
  const { facilityId } = useDeptAccess()
  const can = useSampleCan()
  return isDemoFacility(facilityId) && can('referrals', 'view')
}

/**
 * The page for a member who holds none of the referral codes here: at a demo facility, today's sample (as before this
 * page was live); elsewhere who can use referrals. It reads nothing.
 */
export function ReferralsRefusal() {
  const sample = useSampleStandsIn()
  return sample ? <ReferralSample /> : <DeptUnavailable title={TITLE} message={PAGE_REFUSED} />
}

/**
 * Referrals are not served here (an ehr-api before 0191, or the service flag off): at a demo facility today's sample;
 * elsewhere the page says so, never a broken screen.
 */
export function ReferralsNotServed() {
  const sample = useSampleStandsIn()
  if (sample) return <ReferralSample />
  return (
    <DeptPage eyebrow={EYEBROW} title={TITLE} description={DESCRIPTION} className="hid-ehr-dept-referrals">
      <DeptNotice tone="info" role="status" title={NOT_AVAILABLE}>{NOT_AVAILABLE_MORE}</DeptNotice>
    </DeptPage>
  )
}

/** The patient as this card may show them: a name at view level `full`, sex and age only before accepting, else nothing. */
export function patientTitle(card: ReferralCard): string {
  if (card.patient?.fullName) return card.patient.fullName
  const preview = previewPatientText(card.patient)
  return preview ? `Patient: ${preview}` : 'Patient details not shown'
}

/** The state and urgency badges of a referral. */
export function ReferralBadges({ card }: { readonly card: ReferralCard }) {
  return (
    <div className="hid-ehr-dept-referrals-badges">
      <EhrBadge tone={stateTone(card.effectiveState)}>{stateText(card)}</EhrBadge>
      <EhrBadge tone={urgencyTone(card.urgency)}>{urgencyText(card.urgency)}</EhrBadge>
    </div>
  )
}

/**
 * One referral in a list: who (as the view level allows) and where, the department and dates, the badges and, once
 * completed, the outcome; the reference links to the referral's page, which carries its UUID only. `link` false: a
 * member who may not open it (the front desk) sees the row only.
 */
export function ReferralRow({ card, link = true, children }: { readonly card: ReferralCard; readonly link?: boolean; readonly children?: ReactNode }) {
  const headingId = `referral-${card.referralId}`
  const title = patientTitle(card)
  const direction = card.side === 'sent' ? `To ${otherFacilityText(card)}` : `From ${otherFacilityText(card)}`
  const when = card.side === 'received' && card.effectiveState === 'sent' && card.respondBy ? `Answer by ${whenText(card.respondBy)}`
    : `Sent ${whenText(card.sentAt)}`
  return (
    <li className="hid-ehr-dept-referrals-card" aria-labelledby={headingId}>
      <div className="hid-ehr-dept-referrals-main">
        <h3 id={headingId} className="hid-ehr-dept-referrals-name">
          {link ? <Link className="hid-ehr-dept-link" to={`${BASE}/${card.referralId}`}>{title}</Link> : title}
        </h3>
        <p className="hid-ehr-dept-referrals-line">
          <span>{direction}</span>
          <span>{departmentText(card.departmentCode)}{card.serviceWanted ? ` · ${card.serviceWanted}` : ''}</span>
          <span>Reference {card.reference}</span>
        </p>
        <p className="hid-ehr-dept-referrals-line"><span>{when}</span></p>
        {card.reason ? <p className="hid-ehr-dept-referrals-line"><span>Reason: {card.reason}</span></p> : null}
        {card.outcome ? <p className="hid-ehr-dept-referrals-line"><span>Outcome: {outcomeText(card.outcome.code, card.side === 'received')}</span></p> : null}
        <ReferralBadges card={card} />
      </div>
      {children ? <div className="hid-ehr-dept-referrals-actions">{children}</div> : null}
    </li>
  )
}

/** The referral's facts, as its view level allows: nothing the server left out is guessed. */
export function ReferralFacts({ card }: { readonly card: ReferralCard }) {
  const here = card.side === 'received'
  const rows: Array<[string, string]> = []
  const patient = card.patient
  if (patient?.fullName) {
    rows.push(['Patient', [patient.fullName, sexText(patient.sex), bornText(patient.dateOfBirth, patient.dateOfBirthEstimated),
      patient.healthIdLast4 ? `Health ID ending ${healthIdEnding(patient.healthIdLast4)}` : ''].filter(Boolean).join(' · ')])
  } else if (patient && previewPatientText(patient)) {
    rows.push(['Patient', `${previewPatientText(patient)} (the name shows once you accept)`])
  } else {
    rows.push(['Patient', 'Not shown'])
  }
  rows.push(['From', card.referringFacility.name])
  rows.push(['To', card.destinationKind === 'printed' ? `${destinationText(card)} (printed letter, outside Health ID)` : destinationText(card)])
  rows.push(['Department wanted', departmentText(card.departmentCode)])
  if (card.serviceWanted) rows.push(['Service wanted', card.serviceWanted])
  rows.push(['Urgency', urgencyText(card.urgency)])
  if (card.reason) rows.push(['Reason', card.reason])
  rows.push(['Referred by', referrerText(card.referrer)])
  rows.push(['Sent', whenText(card.sentAt, 'Not available')])
  if (card.respondBy && (card.effectiveState === 'sent' || card.state === 'sent')) rows.push(['Answer by', whenText(card.respondBy)])
  if (card.acceptedAt) rows.push(['Accepted', whenText(card.acceptedAt)])
  if (card.acceptNote) rows.push(['Note from the receiving facility', card.acceptNote])
  if (card.arriveBy && card.state === 'accepted') rows.push(['Arrive by', whenText(card.arriveBy)])
  if (card.arrivedAt) rows.push(['Arrived', whenText(card.arrivedAt)])
  if (card.decline) {
    rows.push(['Declined', `${whenText(card.decline.declinedAt)}: ${declineReasonText(card.decline.reasonCode)}`])
    if (card.decline.note) rows.push(['Why it was declined', card.decline.note])
  }
  if (card.withdrawal) {
    const reason = withdrawReasonText(card.withdrawal.reasonCode)
    rows.push(['Withdrawn', `${whenText(card.withdrawal.withdrawnAt)}${card.withdrawal.by === 'patient' ? ', by the patient' : ''}${reason ? `: ${reason}` : ''}`])
    if (card.withdrawal.note) rows.push(['Why it was withdrawn', card.withdrawal.note])
  }
  if (card.outcome) {
    rows.push(['Outcome', `${outcomeText(card.outcome.code, here)} (${whenText(card.outcome.completedAt)})`])
    if (card.outcome.feedbackNote) rows.push([here ? 'Feedback sent to the referring facility' : 'Feedback from the receiving facility', card.outcome.feedbackNote])
  }
  const sent = packageSummaryText(card.packageSummary)
  if (sent) rows.push(['Details sent', sent])
  if (here && card.accessEndsAt) rows.push(['What was sent can be read until', whenText(card.accessEndsAt)])
  return (
    <dl className="hid-ehr-dept-referrals-facts">
      {rows.map(([label, value]) => <div key={label} style={{ display: 'contents' }}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
  )
}

/** Why the package is not shown, in plain words. */
export function packageHiddenText(hidden: string | null, side: ReferralCard['side']): string {
  switch (hidden) {
    case 'chart_access_needed': return 'What was sent shows to the clinician who sent it, or with the patient’s approval or Access PIN here.'
    case 'not_accepted': return 'What was sent shows once you accept the referral.'
    case 'access_ended': return 'The time to read what was sent has ended.'
    default: return side === 'received' ? 'What was sent is not shown.' : 'What was sent could not be shown.'
  }
}

const ENTERED_IN_ERROR = 'Marked entered in error since it was sent: not shown.'

/**
 * The frozen package: the letter, then each kind of detail the clinician ticked, as the server copied it when the
 * referral was sent. An item whose source was marked entered in error since then says so, with no content.
 */
export function PackageView({ pkg }: { readonly pkg: ReferralPackage }) {
  const { diagnoses = [], medicines = [], allergies = [], vitals = [], labResults = [] } = pkg.sections
  return (
    <div className="hid-ehr-dept-referrals-package">
      <div>
        <h3>Letter</h3>
        <p className="hid-ehr-dept-referrals-letter-text">{pkg.letterText}</p>
      </div>
      {diagnoses.length > 0 ? (
        <div>
          <h3>{packageKindText('diagnoses')}</h3>
          <ul>{diagnoses.map(item => <li key={item.itemId}>{item.enteredInErrorSinceSent || !item.content ? ENTERED_IN_ERROR
            : [item.content.display, item.content.code ? `${item.content.codeSystem ?? ''} ${item.content.code}`.trim() : '',
              item.content.verificationStatus ? sexText(item.content.verificationStatus) : ''].filter(Boolean).join(' · ')}</li>)}</ul>
        </div>
      ) : null}
      {medicines.length > 0 ? (
        <div>
          <h3>{packageKindText('medicines')}</h3>
          <ul>{medicines.map(item => <li key={item.itemId}>{item.enteredInErrorSinceSent || !item.content ? ENTERED_IN_ERROR
            : [item.content.medicationDisplay, [item.content.doseQuantity, item.content.doseUnit].filter(Boolean).join(' '), item.content.routeCode,
              item.content.frequency, item.content.instructions].filter(Boolean).join(' · ')}</li>)}</ul>
        </div>
      ) : null}
      {allergies.length > 0 ? (
        <div>
          <h3>{packageKindText('allergies')}</h3>
          <ul>{allergies.map(item => <li key={item.itemId}>{item.enteredInErrorSinceSent || !item.content ? ENTERED_IN_ERROR
            : [item.content.substance, item.content.reaction, item.content.severity ? `${sexText(item.content.severity)} severity` : '',
              item.content.recordedAtReferringFacility === false ? 'recorded at another facility' : ''].filter(Boolean).join(' · ')}</li>)}</ul>
        </div>
      ) : null}
      {vitals.length > 0 ? (
        <div>
          <h3>{packageKindText('vitals')}</h3>
          <ul>{vitals.map(item => <li key={item.itemId}>{item.enteredInErrorSinceSent || !item.content ? ENTERED_IN_ERROR
            : `${whenText(item.content.recordedAt, 'Time not recorded')}: ${vitalsText(item.content.measures)}`}</li>)}</ul>
        </div>
      ) : null}
      {labResults.length > 0 ? (
        <div>
          <h3>{packageKindText('labResults')}</h3>
          <ul>{labResults.map(item => <li key={item.itemId}>{item.enteredInErrorSinceSent || !item.content ? ENTERED_IN_ERROR
            : [item.content.testName, [item.content.value, item.content.unit].filter(Boolean).join(' '),
              item.content.referenceRange ? `range ${item.content.referenceRange}` : '', item.content.abnormalFlag && item.content.abnormalFlag !== 'normal'
                ? sexText(item.content.abnormalFlag) : '', item.content.releasedAt ? `released ${whenText(item.content.releasedAt)}` : '']
              .filter(Boolean).join(' · ')}</li>)}</ul>
        </div>
      ) : null}
    </div>
  )
}

const MEASURE_WORDS: ReadonlyArray<readonly [string, string, string]> = [
  ['pulseBpm', 'Pulse', 'bpm'], ['temperatureC', 'Temperature', '°C'], ['respiratoryRate', 'Breathing rate', '/min'],
  ['oxygenSaturationPercent', 'Oxygen saturation', '%'], ['weightKg', 'Weight', 'kg'], ['heightCm', 'Height', 'cm'],
]

/** "Blood pressure 150/95 mmHg · Pulse 96 bpm": the measures as recorded; one not known here is left out. */
export function vitalsText(measures: Record<string, number | null> | null | undefined): string {
  if (!measures) return 'No measures'
  const parts: string[] = []
  if (typeof measures.systolicMmhg === 'number' && typeof measures.diastolicMmhg === 'number') {
    parts.push(`Blood pressure ${measures.systolicMmhg}/${measures.diastolicMmhg} mmHg`)
  }
  for (const [key, label, unit] of MEASURE_WORDS) {
    const value = measures[key]
    if (typeof value === 'number') parts.push(`${label} ${value} ${unit}`.replace(' %', '%').replace(' /min', '/min'))
  }
  return parts.join(' · ') || 'No measures'
}
