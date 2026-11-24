import { BadgeCheck, CircleAlert } from 'lucide-react'
import { Badge } from '../../../kasuwa/ui'
import { ninStatusLabel, type PatientSearchCard } from '../../../staff/patientSearch'
import { formatDate } from '../parts/format'
import { maskedHealthId } from '../parts/PatientHeader'
import { ageInYears, sexWord } from './searchWords'

/**
 * What a search card shows of a patient (hid-system 0132): the full name, sex, date of birth, the last four of the
 * Health ID and whether the NIN is verified. Never a full Health ID: the card has none. `withAge` adds the age after
 * the date of birth (the emergency search's one card, which the clinician confirms against the patient).
 */
export function cardFacts(card: PatientSearchCard, withAge = false, now = new Date()): string {
  const age = withAge ? ageInYears(card.dateOfBirth, now) : null
  const born = card.dateOfBirth ? `Born ${formatDate(card.dateOfBirth)}${age === null ? '' : ` (age ${age})`}` : ''
  return [sexWord(card.sex), born, card.healthIdLast4 ? `Health ID ${maskedHealthId(card.healthIdLast4)}` : ''].filter(Boolean).join(' · ')
}

export function SearchCardFacts({ card, nameId, withAge = false }: { card: PatientSearchCard; nameId?: string; withAge?: boolean }) {
  const verified = card.ninStatus === 'verified'
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <p id={nameId} className="m-0 text-title-3 text-ink">{card.fullName}</p>
        <Badge size="sm" tone={verified ? 'success' : 'neutral'} icon={verified ? BadgeCheck : CircleAlert}>{ninStatusLabel(card.ninStatus)}</Badge>
      </div>
      <p className="m-0 text-[13px] text-ink-3">{cardFacts(card, withAge)}</p>
    </div>
  )
}
