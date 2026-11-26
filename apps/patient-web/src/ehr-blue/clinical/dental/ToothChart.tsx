import { EhrButton, EhrField, EhrInput, EhrSelect } from '@hid/ui/ehr'
import { useId, useState, type FormEvent } from 'react'
import type { DentalConditionItem, DentalDentition, DentalFinding } from '../../../staff/api'
import {
  FINDING_NOTE_MAX, SURFACES, chartRows, orderedSurfaces, sortedFindings, surfaceWord, surfacesText, textOrNull, textProblem,
  toothPlace, toothText,
} from './dentalRules'

/*
 * The FDI tooth chart (ISO 3950): adult (11-48), child (51-85) or mixed, drawn as the dentist reads it facing the patient,
 * the patient's right on the left of the screen. Each tooth is a button named by its number, its place and its findings,
 * so the chart reads the same to a screen reader as it looks; colour is never the only sign of a finding. A tooth with no
 * finding is present and sound.
 */

export type ConditionText = (code: string) => string

/** "Decayed (MO, mesial, occlusal)" for one finding. */
export function findingText(finding: DentalFinding, conditionText: ConditionText): string {
  const surfaces = finding.surfaces ? ` (${surfacesText(finding.surfaces, finding.tooth)})` : ''
  return `${conditionText(finding.condition)}${surfaces}`
}

function toothLabel(tooth: number, findings: readonly DentalFinding[], conditionText: ConditionText): string {
  const place = toothPlace(tooth)
  const what = findings.length === 0 ? 'no findings' : findings.map(finding => findingText(finding, conditionText)).join('; ')
  return `Tooth ${tooth}${place ? `, ${place}` : ''}: ${what}`
}

export function ToothChart({ dentition, findings, conditionText, selected = null, onSelect, caption }: {
  readonly dentition: DentalDentition
  readonly findings: readonly DentalFinding[]
  readonly conditionText: ConditionText
  /** The tooth being edited, when the chart is being edited. */
  readonly selected?: number | null
  /** Left out, the chart is read only: its teeth are not buttons. */
  readonly onSelect?: (tooth: number) => void
  readonly caption: string
}) {
  const byTooth = new Map<number, DentalFinding[]>()
  for (const finding of findings) byTooth.set(finding.tooth, [...(byTooth.get(finding.tooth) ?? []), finding])
  return (
    <figure className="hid-ehr-dental-chart" aria-label={caption}>
      <figcaption className="hid-ehr-dental-chart-caption">
        <span>Patient’s right</span><span>{caption}</span><span>Patient’s left</span>
      </figcaption>
      {chartRows(dentition).map(row => (
        <div key={row.key} role="group" aria-label={row.label} className={`hid-ehr-dental-row hid-ehr-dental-row-${row.key}`}>
          {row.teeth.map((tooth, index) => {
            const own = byTooth.get(tooth) ?? []
            const label = toothLabel(tooth, own, conditionText)
            const midline = index === row.teeth.length / 2
            const className = ['hid-ehr-dental-tooth', own.length > 0 ? 'hid-ehr-dental-tooth-marked' : '',
              selected === tooth ? 'hid-ehr-dental-tooth-selected' : '', midline ? 'hid-ehr-dental-tooth-midline' : ''].filter(Boolean).join(' ')
            const face = (
              <>
                <span className="hid-ehr-dental-tooth-number">{tooth}</span>
                <span className="hid-ehr-dental-tooth-marks" aria-hidden="true">{own.length > 0 ? own.length : ''}</span>
              </>
            )
            return onSelect ? (
              <button key={tooth} type="button" className={className} aria-label={label} title={label}
                aria-pressed={selected === tooth} onClick={() => onSelect(tooth)}>{face}</button>
            ) : (
              <span key={tooth} role="img" className={className} aria-label={label} title={label}>{face}</span>
            )
          })}
        </div>
      ))}
    </figure>
  )
}

/** Every finding in words, tooth by tooth, for reading and checking (and for anyone who cannot use the drawing). */
export function FindingsList({ findings, conditionText, onRemove }: {
  readonly findings: readonly DentalFinding[]
  readonly conditionText: ConditionText
  readonly onRemove?: (finding: DentalFinding) => void
}) {
  const sorted = sortedFindings(findings)
  if (sorted.length === 0) return <p className="hid-ehr-clinical-note">No findings: every tooth is charted as present and sound.</p>
  return (
    <ul className="hid-ehr-clinical-history-list hid-ehr-dental-findings">
      {sorted.map(finding => (
        <li key={`${finding.tooth}-${finding.condition}`} className="hid-ehr-clinical-history-row">
          <span>
            <strong>{toothText(finding.tooth)}</strong>
            <span className="hid-ehr-clinical-cell-sub">{findingText(finding, conditionText)}{finding.note ? `. ${finding.note}` : ''}</span>
          </span>
          {onRemove ? (
            <EhrButton variant="quiet" size="sm" onClick={() => onRemove(finding)}
              aria-label={`Remove ${conditionText(finding.condition).toLowerCase()} from tooth ${finding.tooth}`}>Remove</EhrButton>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/**
 * One tooth's findings while the chart is edited: those it has, each removable, and "Add finding" with the condition
 * (from the dental list), its surfaces when the condition takes them (named as they read on this tooth), and a short
 * note. One finding per tooth and condition, as the server keeps them.
 */
export function ToothPanel({ tooth, findings, conditions, conditionText, onAdd, onRemove }: {
  readonly tooth: number
  readonly findings: readonly DentalFinding[]
  readonly conditions: readonly DentalConditionItem[]
  readonly conditionText: ConditionText
  readonly onAdd: (finding: DentalFinding) => void
  readonly onRemove: (finding: DentalFinding) => void
}) {
  const id = useId()
  const [condition, setCondition] = useState('')
  const [surfaces, setSurfaces] = useState<ReadonlySet<string>>(new Set())
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState<{ field: 'condition' | 'surfaces' | 'note'; text: string } | null>(null)
  const chosen = conditions.find(item => item.code === condition)
  const own = findings.filter(finding => finding.tooth === tooth)
  const taken = new Set(own.map(finding => finding.condition))

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!chosen) return setProblem({ field: 'condition', text: 'Choose a condition from the dental list.' })
    if (taken.has(chosen.code)) return setProblem({ field: 'condition', text: 'This tooth already has this finding. Remove it first to change it.' })
    const ordered = orderedSurfaces(surfaces)
    if (chosen.takesSurfaces && !ordered) return setProblem({ field: 'surfaces', text: 'Choose at least one surface.' })
    const noteProblem = textProblem(note, FINDING_NOTE_MAX, true)
    if (noteProblem) return setProblem({ field: 'note', text: noteProblem })
    onAdd({ tooth, condition: chosen.code, surfaces: chosen.takesSurfaces ? ordered : null, note: textOrNull(note) })
    setCondition('')
    setSurfaces(new Set())
    setNote('')
    setProblem(null)
  }

  return (
    <section className="hid-ehr-dental-tooth-panel" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="hid-ehr-clinical-subheading">{toothText(tooth)}</h3>
      <FindingsList findings={own} conditionText={conditionText} onRemove={onRemove} />
      <form className="hid-ehr-clinical-form" noValidate onSubmit={add}>
        <EhrField label="Condition" error={problem?.field === 'condition' ? problem.text : undefined}>
          <EhrSelect value={condition} onChange={event => { setCondition(event.target.value); setProblem(null) }}>
            <option value="">Choose a condition</option>
            {conditions.map(item => <option key={item.code} value={item.code} disabled={taken.has(item.code)}>{item.label}</option>)}
          </EhrSelect>
        </EhrField>
        {chosen?.takesSurfaces ? (
          <fieldset className="hid-ehr-dental-surfaces" aria-describedby={problem?.field === 'surfaces' ? `${id}-surfaces-error` : undefined}>
            <legend>Surfaces</legend>
            {SURFACES.map(surface => (
              <label key={surface} className="hid-ehr-clinical-checkbox">
                <input type="checkbox" checked={surfaces.has(surface)} onChange={event => {
                  const next = new Set(surfaces)
                  if (event.target.checked) next.add(surface); else next.delete(surface)
                  setSurfaces(next)
                  setProblem(null)
                }} />
                {surface} ({surfaceWord(surface, tooth).toLowerCase()})
              </label>
            ))}
            {problem?.field === 'surfaces' ? <p id={`${id}-surfaces-error`} className="hid-ehr-clinical-field-error" role="alert">{problem.text}</p> : null}
          </fieldset>
        ) : null}
        <EhrField label="Note (optional)" hint={`Up to ${FINDING_NOTE_MAX} characters.`} error={problem?.field === 'note' ? problem.text : undefined}>
          <EhrInput value={note} maxLength={FINDING_NOTE_MAX + 20} onChange={event => { setNote(event.target.value); setProblem(null) }} />
        </EhrField>
        <div className="hid-ehr-clinical-form-footer">
          <EhrButton type="submit" variant="secondary">Add finding</EhrButton>
        </div>
      </form>
    </section>
  )
}
