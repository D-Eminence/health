import { useCallback, useMemo, useRef } from 'react'
import { EhrButton, EhrField, EhrInput } from '@hid/ui/ehr'
import { problemText, type FieldProblem } from '../../../staff/fieldProblem'
import {
  CHANGE_REASONS, REJECTION_REASONS, REMOVAL_REASONS, type ReasonChoice, type RejectionReason,
} from '../../../readingLearningContract'
import type { PaperItem } from './paperReading'
import {
  MEDICINE_FIELDS, MISSED_FIELD, REJECTION_REASON_FIELD, itemChangeReasonId, itemMedicineId, itemRemovalReasonId, medicineAsRead,
  type ItemDecision, type MedicineFields,
} from './reviewPayload'

/*
 * Migrate learning, phase 1 (readingLearningContract.ts): the parts of Check and save and Reject reading that tell the
 * reading service how it did. Shown only while the backend serves it (readingLearningServed.ts); with it off, the
 * form is today's. Owner decision Q43: learn without additional stress or work for users, so nothing here is ever
 * required: no page tick, every reason an optional one-tap choice, one optional missed box. Every word here is plain: no
 * code, value or ID is ever shown.
 */

/**
 * The items the reviewer had on screen, held in the page's memory only (never in the browser's storage); they alone make
 * up whether every item was looked at (reviewPayload.ts reviewSignals). Nothing is asked of the reviewer for it. A card is seen once at
 * least half of it has been in view, or once it filled at least half the screen (a card taller than twice the screen
 * can never be half in view), or once it is touched or focused. Without an IntersectionObserver (an old browser) only
 * touch and focus count.
 */
export function useSeenItems() {
  const seen = useRef(new Set<string>())
  const watch = useCallback((itemId: string, element: HTMLElement | null): (() => void) | undefined => {
    if (!element) { seen.current.add(itemId); return undefined }
    if (seen.current.has(itemId) || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting && (entry.intersectionRatio >= 0.5
        || (entry.rootBounds !== null && entry.intersectionRect.height >= entry.rootBounds.height * 0.5)))) {
        seen.current.add(itemId); observer.disconnect()
      }
    }, { threshold: [0, 0.25, 0.5] })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return useMemo(() => ({
    watch,
    ids: () => [...seen.current],
    forget: () => { seen.current = new Set() },
  }), [watch])
}

const REASON_HINT = 'Optional. Tap one if you like: it helps the reading get better. It isn’t saved in the patient’s record.'

/**
 * One optional choice from a short list, as one-tap buttons: the chosen one is pressed, and tapping it again clears it.
 * Nothing is required, and leaving it blank never stops a save.
 */
function ReasonChoices<Code extends string>({ id, label, hint, choices, value, onChange }: {
  readonly id: string; readonly label: string; readonly hint: string; readonly choices: readonly ReasonChoice<Code>[]
  readonly value: Code | ''; readonly onChange: (value: Code | '') => void
}) {
  return <div className="hid-ehr-dept-migrate-reason" role="group" id={id} aria-labelledby={`${id}-label`} aria-describedby={`${id}-hint`}>
    <span id={`${id}-label`} className="hid-ehr-dept-migrate-reason-label">{label}</span>
    <span id={`${id}-hint`} className="hid-ehr-hint">{hint}</span>
    <div className="hid-ehr-dept-migrate-reason-choices">
      {choices.map(choice => <EhrButton key={choice.code} variant={value === choice.code ? 'primary' : 'secondary'} aria-pressed={value === choice.code}
        onClick={() => onChange(value === choice.code ? '' : choice.code)}>{choice.words}</EhrButton>)}
    </div>
  </div>
}

/** Why an item is removed or changed: optional, one tap from a short list, under its card. */
export function ItemReason({ index, decision, onChange }: {
  readonly index: number; readonly decision: ItemDecision; readonly onChange: (decision: ItemDecision) => void
}) {
  if (decision.choice === 'remove') {
    return <ReasonChoices id={itemRemovalReasonId(index)} label="Why remove it?" hint={REASON_HINT} choices={REMOVAL_REASONS}
      value={decision.removalReason ?? ''} onChange={removalReason => onChange({ ...decision, removalReason })} />
  }
  return <ReasonChoices id={itemChangeReasonId(index)} label="Why change it?" hint={REASON_HINT} choices={CHANGE_REASONS}
    value={decision.changeReason ?? ''} onChange={changeReason => onChange({ ...decision, changeReason })} />
}

const MEDICINE_LABELS: Readonly<Record<keyof MedicineFields, string>> = {
  name: 'Medicine name', strength: 'Strength', dose: 'Dose', frequency: 'How often',
}
const MEDICINE_HINTS: Readonly<Record<keyof MedicineFields, string | undefined>> = {
  name: undefined, strength: 'For example 5 mg.', dose: 'For example 1 tablet. Leave it blank if the paper doesn’t say.', frequency: 'For example once a day.',
}

/** A medicine's Change, field by field, each starting as read; what is saved to past medicines is exactly these. */
export function MedicineChange({ item, index, decision, problem, onChange }: {
  readonly item: PaperItem; readonly index: number; readonly decision: ItemDecision; readonly problem: FieldProblem | null
  readonly onChange: (decision: ItemDecision) => void
}) {
  const read = medicineAsRead(item)
  return <div className="hid-ehr-dept-migrate-medicine">
    {MEDICINE_FIELDS.map(field => {
      const id = itemMedicineId(index, field)
      return <EhrField key={field} label={field === 'name' ? <>{MEDICINE_LABELS[field]}<span aria-hidden="true"> *</span></> : MEDICINE_LABELS[field]}
        controlId={id} hint={MEDICINE_HINTS[field]} error={problemText(problem, id)}>
        <EhrInput value={decision.medicine?.[field] ?? read[field]} maxLength={field === 'name' ? 500 : 240} autoComplete="off"
          onChange={event => onChange({ ...decision, medicine: { ...decision.medicine, [field]: event.target.value } })} />
      </EhrField>
    })}
  </div>
}

/** "The reading missed…": one optional number. Nothing about what was missed is asked or sent. */
export function MissedItems({ missed, problem, onChange }: {
  readonly missed: string; readonly problem: FieldProblem | null; readonly onChange: (missed: string) => void
}) {
  return <EhrField label="The reading missed…" controlId={MISSED_FIELD} error={problemText(problem, MISSED_FIELD)}
    hint="Optional. If the paper has things the reading didn’t pick out, you can say how many. A number only: don’t write what they are.">
    <EhrInput value={missed} inputMode="numeric" maxLength={3} autoComplete="off"
      onChange={event => onChange(event.target.value.replace(/[^0-9]/g, ''))} />
  </EhrField>
}

/** Reject reading: what is wrong with it, optional, one tap from a short list, above the reason in words. */
export function RejectionReasonField({ value, onChange }: {
  readonly value: RejectionReason | ''; readonly onChange: (value: RejectionReason | '') => void
}) {
  return <ReasonChoices id={REJECTION_REASON_FIELD} label="What’s wrong with it?" choices={REJECTION_REASONS} value={value} onChange={onChange}
    hint="Optional. Tap one if you like: it helps the reading get better." />
}
