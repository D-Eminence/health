import { BadgeCheck, CircleAlert } from 'lucide-react'
import { Badge } from '../../../kasuwa/ui'
import { ninStatusLabel, type PatientSearchCard } from '../../../staff/patientSearch'
import { formatDate } from '../parts/format'
import { maskedHealthId } from '../parts/PatientHeader'
import { sexWord } from './searchWords'

/**
 * What a search card shows of a patient (hid-system 0132): the full name, sex, date of birth, the last four of the
 * Health ID and whether the NIN is verified. Never a full Health ID: the card has none.
 */
export function cardFacts(card: PatientSearchCard): string {
  return [sexWord(card.sex), card.dateOfBirth ? `Born ${formatDate(card.dateOfBirth)}` : '',
    card.healthIdLast4 ? `Health ID ${maskedHealthId(card.healthIdLast4)}` : ''].filter(Boolean).join(' · ')
}

export function SearchCardFacts({ card, nameId }: { card: PatientSearchCard; nameId?: string }) {
  const verified = card.ninStatus === 'verified'
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <p id={nameId} className="m-0 text-title-3 text-ink">{card.fullName}</p>
        <Badge size="sm" tone={verified ? 'success' : 'neutral'} icon={verified ? BadgeCheck : CircleAlert}>{ninStatusLabel(card.ninStatus)}</Badge>
      </div>
      <p className="m-0 text-[13px] text-ink-3">{cardFacts(card)}</p>
    </div>
  )
}
