import { useCallback, useMemo, useRef } from 'react'
import { EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import { problemText, type FieldProblem } from '../../../staff/fieldProblem'
import {
  CHANGE_REASONS, MISSED_KINDS, REJECTION_REASONS, REMOVAL_REASONS, isCode, type MissedKind, type RejectionReason,
} from '../../../readingLearningContract'
import { isUnreadable, type PaperItem, type PaperReading } from './paperReading'
import {
  MEDICINE_FIELDS, REJECTION_REASON_FIELD, itemChangeReasonId, itemMedicineId, itemRemovalReasonId, medicineAsRead, missedId, pageCheckedId,
  readingPages, type ItemDecision, type MedicineFields,
} from './reviewPayload'

/*
 * Migrate learning, phase 1 (readingLearningContract.ts): the parts of Check and save and Reject reading that tell the
 * reading service how it did. Shown only while the backend serves it (readingLearningServed.ts); with it off, the
 * form is today's. Every word here is plain: no code, value or ID is ever shown.
 */

/**
 * The items the reviewer had on screen, held in the page's memory only (never in the browser's storage) and sent with
 * the save. A card is seen once at least half of it has been in view, or once it is touched or focused. Without an
 * IntersectionObserver (an old browser) only touch and focus count.
 */
export function useSeenItems() {
  const seen = useRef(new Set<string>())
  const watch = useCallback((itemId: string, element: HTMLElement | null): (() => void) | undefined => {
    if (!element) { seen.current.add(itemId); return undefined }
    if (seen.current.has(itemId) || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { seen.current.add(itemId); observer.disconnect() }
    }, { threshold: 0.5 })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return useMemo(() => ({
    watch,
    ids: () => [...seen.current],
    forget: () => { seen.current = new Set() },
  }), [watch])
}

const REMOVAL_WORDS_HINT = 'This helps the reading get better. It isn’t saved in the patient’s record.'

/** Why an item is removed or changed: one choice from a short list, asked under its card. */
export function ItemReason({ index, decision, problem, onChange }: {
  readonly index: number; readonly decision: ItemDecision; readonly problem: FieldProblem | null; readonly onChange: (decision: ItemDecision) => void
}) {
  if (decision.choice === 'remove') {
    const id = itemRemovalReasonId(index)
    return <EhrField label={<>Why remove it?<span aria-hidden="true"> *</span></>} controlId={id} hint={REMOVAL_WORDS_HINT} error={problemText(problem, id)}>
      <EhrSelect value={decision.removalReason ?? ''} onChange={event => onChange({ ...decision,
        removalReason: isCode(REMOVAL_REASONS, event.target.value) ? event.target.value : '' })}>
        <option value="">Choose a reason</option>
        {REMOVAL_REASONS.map(reason => <option key={reason.code} value={reason.code}>{reason.words}</option>)}
      </EhrSelect>
    </EhrField>
  }
  const id = itemChangeReasonId(index)
  return <EhrField label={<>Why change it?<span aria-hidden="true"> *</span></>} controlId={id} hint={REMOVAL_WORDS_HINT} error={problemText(problem, id)}>
    <EhrSelect value={decision.changeReason ?? ''} onChange={event => onChange({ ...decision,
      changeReason: isCode(CHANGE_REASONS, event.target.value) ? event.target.value : '' })}>
      <option value="">Choose a reason</option>
      {CHANGE_REASONS.map(reason => <option key={reason.code} value={reason.code}>{reason.words}</option>)}
    </EhrSelect>
  </EhrField>
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

/** "I've checked this page", one tick for each page of the paper. Saving doesn't need every page ticked. */
export function PagesChecked({ reading, items, checked, onChange }: {
  readonly reading: PaperReading; readonly items: readonly PaperItem[]; readonly checked: ReadonlySet<number>
  readonly onChange: (checked: ReadonlySet<number>) => void
}) {
  const pages = readingPages(reading)
  if (pages.length === 0) return null
  return <fieldset className="hid-ehr-dept-migrate-group" id="ocr-pages-checked" aria-describedby="ocr-pages-checked-hint">
    <legend><strong>Pages you’ve checked</strong></legend>
    <p id="ocr-pages-checked-hint" className="hid-ehr-hint">Tick a page once you’ve checked the whole page against the paper. You can save without ticking every page.</p>
    <ul className="hid-ehr-dept-migrate-pages">
      {pages.map(page => {
        const count = items.filter(item => item.page === page && !isUnreadable(item)).length
        return <li key={page}>
          <label className="hid-ehr-dept-check" htmlFor={pageCheckedId(page)}>
            <input id={pageCheckedId(page)} type="checkbox" checked={checked.has(page)} onChange={event => {
              const next = new Set(checked)
              if (event.target.checked) next.add(page); else next.delete(page)
              onChange(next)
            }} />
            <span>{`I’ve checked page ${page}`}<span className="hid-ehr-dept-muted">{` · ${count === 1 ? '1 item' : `${count} items`} read from it`}</span></span>
          </label>
        </li>
      })}
    </ul>
  </fieldset>
}

/** "The reading missed a ___": how many of each kind, as numbers only. Nothing about what they were is asked or sent. */
export function MissedItems({ missed, problem, onChange }: {
  readonly missed: Readonly<Partial<Record<MissedKind, string>>>; readonly problem: FieldProblem | null
  readonly onChange: (missed: Partial<Record<MissedKind, string>>) => void
}) {
  return <fieldset className="hid-ehr-dept-migrate-group" id="ocr-missed" aria-describedby="ocr-missed-hint">
    <legend><strong>The reading missed a…</strong></legend>
    <p id="ocr-missed-hint" className="hid-ehr-hint">If the paper has things the reading didn’t pick out, say how many of each. Numbers only: don’t write
      what they are. Leave a box blank for none.</p>
    <div className="hid-ehr-dept-migrate-missed">
      {MISSED_KINDS.map(kind => <EhrField key={kind.code} label={kind.words} controlId={missedId(kind.code)} error={problemText(problem, missedId(kind.code))}>
        <EhrInput value={missed[kind.code] ?? ''} inputMode="numeric" maxLength={2} autoComplete="off"
          onChange={event => onChange({ ...missed, [kind.code]: event.target.value })} />
      </EhrField>)}
    </div>
  </fieldset>
}

/** Reject reading: what is wrong with it, from a short list, above the reason in words. */
export function RejectionReasonField({ value, problem, onChange }: {
  readonly value: RejectionReason | ''; readonly problem: FieldProblem | null; readonly onChange: (value: RejectionReason | '') => void
}) {
  return <EhrField label={<>What’s wrong with it<span aria-hidden="true"> *</span></>} controlId={REJECTION_REASON_FIELD}
    error={problemText(problem, REJECTION_REASON_FIELD)}>
    <EhrSelect value={value} onChange={event => onChange(isCode(REJECTION_REASONS, event.target.value) ? event.target.value : '')}>
      <option value="">Choose a reason</option>
      {REJECTION_REASONS.map(reason => <option key={reason.code} value={reason.code}>{reason.words}</option>)}
    </EhrSelect>
  </EhrField>
}
