import { Link } from 'react-router-dom'
import { EhrBadge } from '@hid/ui/ehr'
import type { AdmissionCard } from '../../../staff/api'
import { DeptNotice } from '../parts/DeptNotice'
import { birthDateText } from '../parts/format'
import {
  SCREEN_WARNING, STATUS_TONES, ageText, cardName, daysText, lagosDateTime, ninText, placeText, sexText, statusText,
} from './inpatientRules'

/** Q190 A: every ward list says so. */
export function ScreenWarning() {
  return <DeptNotice tone="caution" title="Staff only">{SCREEN_WARNING}</DeptNotice>
}

/**
 * Who the card is for: sex, age (an estimate says so), the date of birth when it may be shown, the Health ID's last 4
 * characters only, and the NIN status in its own words. A hidden name (Q190 A) shows the initials, sex and age alone.
 */
export function AdmissionIdentity({ card }: { readonly card: AdmissionCard }) {
  const born = card.dateOfBirth
    ? card.dateOfBirthEstimated ? `Estimated age, born about ${birthDateText(card.dateOfBirth)}` : `Born ${birthDateText(card.dateOfBirth)}`
    : ''
  const parts = [sexText(card.sex), ageText(card), born].filter(Boolean)
  const nin = ninText(card.ninStatus)
  return (
    <p className="hid-ehr-dept-inpatient-identity">
      {parts.length > 0 ? <span>{parts.join(' · ')}</span> : null}
      {card.healthIdLast4 ? <span aria-label={`Health ID ending ${card.healthIdLast4}`}>{`•••• ${card.healthIdLast4}`}</span> : null}
      {nin ? <span>{nin}</span> : null}
    </p>
  )
}

export function AdmissionBadges({ card }: { readonly card: AdmissionCard }) {
  return (
    <div className="hid-ehr-dept-inpatient-badges">
      <EhrBadge tone={STATUS_TONES[card.status] ?? 'neutral'}>{statusText(card.status)}</EhrBadge>
      {card.recordKind === 'unknown' ? <EhrBadge tone="caution">Unknown patient</EhrBadge> : null}
      {card.nameHidden && card.recordKind !== 'unknown' ? <EhrBadge tone="neutral">Name hidden</EhrBadge> : null}
      {card.chartBlocked ? <EhrBadge tone="critical">Chart cannot be opened</EhrBadge> : null}
    </div>
  )
}

/** One admission in a list: the name (or initials), who they are, where they are and since when, and a link to the record. */
export function AdmissionItem({ card, base }: { readonly card: AdmissionCard; readonly base: string }) {
  const headingId = `admission-${card.admissionId}`
  const place = placeText(card)
  return (
    <li className="hid-ehr-dept-inpatient-card" aria-labelledby={headingId}>
      <div className="hid-ehr-dept-inpatient-main">
        <h3 id={headingId} className="hid-ehr-dept-inpatient-name">
          <Link className="hid-ehr-dept-link" to={`${base}/${card.admissionId}`}>{cardName(card)}</Link>
        </h3>
        <AdmissionIdentity card={card} />
        <AdmissionBadges card={card} />
        <dl className="hid-ehr-dept-inpatient-facts">
          <div><dt>Admission</dt><dd>{card.admissionNumber}</dd></div>
          {place ? <div><dt>Bed</dt><dd>{place}</dd></div> : null}
          {card.status === 'requested' ? <div><dt>Requested</dt><dd>{lagosDateTime(card.requestedAt)}</dd></div> : null}
          {card.admittedAt && card.status !== 'requested' ? (
            <div><dt>Admitted</dt><dd>{lagosDateTime(card.admittedAt)}{daysText(card.daysAdmitted) ? ` (${daysText(card.daysAdmitted)})` : ''}</dd></div>
          ) : null}
          {!card.reasonHidden && card.reason ? <div><dt>Reason</dt><dd>{card.reason}</dd></div> : null}
          {card.careTeam ? <div><dt>Care team</dt><dd>{card.careTeam}</dd></div> : null}
        </dl>
      </div>
    </li>
  )
}
