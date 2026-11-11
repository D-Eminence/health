import { EhrField, EhrTextarea } from '@hid/ui/ehr'
import { useLayoutEffect, useRef, useState } from 'react'
import { ACK_REASON_LIMIT } from '../../../staff/allergies'
import {
  ACK_REASON_HINT, ACK_REASON_LABEL, ALLERGY_WARNING_CHANGED, allergyWarningTitle, askThePatient, isSevereLine, tickLabel,
  type AcknowledgementErrors, type ShownAllergyWarning,
} from './allergyWarning'
import { ClinicalIcon } from './icons'

/**
 * The allergy warning (hid-system 0124) wherever a prescription may go ahead over one: a new prescription, Activate,
 * Resume, and sending a draft to another pharmacy. Each line is the EHR's own sentence, whole (it already names the
 * allergy, its severity and reaction, and where and when it was recorded); a grouped line is one line. The prescriber
 * ticks the box and says why it is safe to go ahead; each has its own error.
 *
 * Controlled: the page holds the warning, the tick and the reason (useAllergyAcknowledgement), and checks them before
 * it sends. Not a live region (the page's error box is the one alert): focus moves to the title when the panel appears
 * or its warning changes, and a short status line says what to do.
 */
export function AllergyWarningPanel({ idPrefix, warning, ticked, reason, errors, onTickedChange, onReasonChange, headingLevel = 3 }: {
  /** Makes the panel's ids unique on the page (two panels never share one). */
  idPrefix: string
  warning: ShownAllergyWarning
  ticked: boolean
  reason: string
  errors: AcknowledgementErrors
  onTickedChange: (ticked: boolean) => void
  onReasonChange: (reason: string) => void
  /** The title's level under the page's headings. */
  headingLevel?: 2 | 3 | 4
}) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [announcement, setAnnouncement] = useState('')
  const lines = warning.lines.length
  const medicine = warning.medicine.display.trim()
  const severe = warning.lines.some(isSevereLine)
  const ids = {
    title: `${idPrefix}-allergy-warning-title`, changed: `${idPrefix}-allergy-warning-changed`, tick: `${idPrefix}-allergy-tick`,
    tickError: `${idPrefix}-allergy-tick-error`, reason: `${idPrefix}-allergy-reason`,
  }
  // What the status line says (the panel itself is not a live region): how many lines, and what to do.
  const said = `${warning.changedSinceShown ? 'The allergy warning changed. ' : ''}${lines === 1 ? 'One allergy' : `${lines} allergies`} `
    + `may match ${medicine}. Tick the box${warning.changedSinceShown ? ' again' : ''} and give your reason to go ahead.`

  // A new warning (another token) is a new thing to read: the title takes focus and the status line says what to do.
  // The same warning shown again (a check that answers the same token) leaves focus where the prescriber is typing, so
  // only the token and "changed" are watched, not the sentence.
  useLayoutEffect(() => {
    titleRef.current?.focus()
    setAnnouncement(said)
  }, [warning.warningToken, warning.changedSinceShown])

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
        <input id={ids.tick} type="checkbox" checked={ticked}
          aria-invalid={errors.tick ? true : undefined} aria-describedby={errors.tick ? ids.tickError : undefined}
          onChange={event => onTickedChange(event.target.checked)} />
        <span>{tickLabel(medicine, lines)}</span>
      </label>
      {errors.tick ? <p id={ids.tickError} className="hid-ehr-clinical-field-error">{errors.tick}</p> : null}
      <EhrField label={ACK_REASON_LABEL} hint={ACK_REASON_HINT} error={errors.reason} controlId={ids.reason}>
        <EhrTextarea rows={2} value={reason} maxLength={ACK_REASON_LIMIT} onChange={event => onReasonChange(event.target.value)} />
      </EhrField>
      <p role="status" className="hid-ehr-sr-only">{announcement}</p>
    </section>
  )
}
