import { EhrField, EhrTextarea } from '@hid/ui/ehr'
import { useLayoutEffect, useRef } from 'react'
import { ACK_REASON_LIMIT } from '../../../staff/allergies'
import {
  ACK_REASON_HINT, ACK_REASON_LABEL, ALLERGY_WARNING_CHANGED, allergyWarningTitle, askThePatient, isSevereLine, tickLabel,
  type AcknowledgementErrors, type AcknowledgementFocus, type ShownAllergyWarning,
} from './allergyWarning'
import { ClinicalIcon } from './icons'

/**
 * The allergy warning (hid-system 0117) wherever a prescription may go ahead over one: a new prescription, Activate,
 * Resume, and sending a prescription (a draft or an active one) to another facility's pharmacy. Each line is the EHR's
 * own sentence, whole (it already names the allergy, its severity and reaction, and where and when it was recorded); a
 * grouped line is one line. The prescriber ticks the box and says why it is safe to go ahead; each has its own error.
 *
 * Controlled: the page holds the warning, the tick and the reason (useAllergyAcknowledgement), and checks them before
 * it sends. Not a live region, and it has none (Ola, W8): the page's error box is the one announcement. Focus moves to
 * the title when the panel appears or its warning changes, and to the tick or the reason when the page refused it
 * (`focus`), so its own error is read out.
 */
export function AllergyWarningPanel({ idPrefix, warning, ticked, reason, errors, focus = null, onTickedChange, onReasonChange, headingLevel = 3 }: {
  /** Makes the panel's ids unique on the page (two panels never share one). */
  idPrefix: string
  warning: ShownAllergyWarning
  ticked: boolean
  reason: string
  errors: AcknowledgementErrors
  /** The answer refused last (useAllergyAcknowledgement's `focus`): it takes focus each time it is asked. */
  focus?: AcknowledgementFocus | null
  onTickedChange: (ticked: boolean) => void
  onReasonChange: (reason: string) => void
  /** The title's level under the page's headings. */
  headingLevel?: 2 | 3 | 4
}) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const tickRef = useRef<HTMLInputElement>(null)
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const lines = warning.lines.length
  const medicine = warning.medicine.display.trim()
  const severe = warning.lines.some(isSevereLine)
  const ids = {
    title: `${idPrefix}-allergy-warning-title`, changed: `${idPrefix}-allergy-warning-changed`, tick: `${idPrefix}-allergy-tick`,
    tickError: `${idPrefix}-allergy-tick-error`, reason: `${idPrefix}-allergy-reason`,
  }

  // A new warning (another token) is a new thing to read: the title takes focus. The same warning shown again (a check
  // that answers the same token) leaves focus where the prescriber is typing, so only the token and "changed" are
  // watched, not the sentence.
  useLayoutEffect(() => {
    titleRef.current?.focus()
  }, [warning.warningToken, warning.changedSinceShown])

  // An answer refused takes focus, so its own error (aria-describedby) is read, not only the page's general one.
  useLayoutEffect(() => {
    if (focus) (focus.target === 'tick' ? tickRef : reasonRef).current?.focus()
  }, [focus])

  const Title = headingLevel === 2 ? 'h2' : headingLevel === 4 ? 'h4' : 'h3'
  return (
    <section aria-labelledby={ids.title}
      className={severe ? 'hid-ehr-clinical-allergy-warning hid-ehr-clinical-allergy-warning-severe' : 'hid-ehr-clinical-allergy-warning'}>
      <Title id={ids.title} ref={titleRef} tabIndex={-1} className="hid-ehr-clinical-allergy-warning-title">
        <ClinicalIcon name="alert" size={18} />
        <span>{allergyWarningTitle(warning)}</span>
      </Title>
      {warning.changedSinceShown ? <p id={ids.changed} className="hid-ehr-clinical-allergy-warning-changed">{ALLERGY_WARNING_CHANGED}</p> : null}
      <ul className="hid-ehr-clinical-allergy-warning-lines">
        {warning.lines.map(line => <li key={line.key} className={isSevereLine(line) ? 'hid-ehr-clinical-allergy-warning-severe-line' : undefined}>{line.message}</li>)}
      </ul>
      <p>{askThePatient(lines)}</p>
      <label className="hid-ehr-clinical-orders-attest">
        <input ref={tickRef} id={ids.tick} type="checkbox" checked={ticked}
          aria-invalid={errors.tick ? true : undefined} aria-describedby={errors.tick ? ids.tickError : undefined}
          onChange={event => onTickedChange(event.target.checked)} />
        <span>{tickLabel(medicine, lines)}</span>
      </label>
      {errors.tick ? <p id={ids.tickError} className="hid-ehr-clinical-field-error">{errors.tick}</p> : null}
      <EhrField label={ACK_REASON_LABEL} hint={ACK_REASON_HINT} error={errors.reason} controlId={ids.reason}>
        <EhrTextarea ref={reasonRef} rows={2} value={reason} maxLength={ACK_REASON_LIMIT} onChange={event => onReasonChange(event.target.value)} />
      </EhrField>
    </section>
  )
}
