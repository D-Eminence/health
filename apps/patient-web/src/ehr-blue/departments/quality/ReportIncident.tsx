import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { isHidApiError } from '@hid/http'
import { EhrButton, EhrField, EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import { qualityApi, type QualityReportInput, type QualityTold } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { useIdempotencyKeys } from './hooks'
import { DraftListBanner, type QualityShared } from './parts'
import {
  BASE, EYEBROW, GUIDANCE, LIMITS, LINK_OFF, LINK_REFUSED, REFUSALS, TOLD_VALUES, TOLD_WORDS, cancelled, departmentText, lagosNow,
  learnFrom, lengthProblem, occurredMoment, occurredProblem, patientFromState, refusalWords, titleProblem, toldRequired, whenText,
} from './qualityRules'

type Field = 'title' | 'description' | 'when' | 'place' | 'locationText' | 'category' | 'harmLevel' | 'immediateAction' | 'told'
const FIELD_IDS: Readonly<Record<Field, string>> = {
  title: 'qs-report-title', description: 'qs-report-description', when: 'qs-report-day', place: 'qs-report-department',
  locationText: 'qs-report-location', category: 'qs-report-category', harmLevel: 'qs-report-harm-near_miss',
  immediateAction: 'qs-report-action', told: 'qs-report-told-yes',
}
const ORDER: readonly Field[] = ['title', 'description', 'when', 'place', 'locationText', 'category', 'harmLevel', 'immediateAction', 'told']

/** The refusals that belong to one field of the form, said beside it. */
const FIELD_OF: Readonly<Record<string, Field>> = {
  QUALITY_TIME_INVALID: 'when', QUALITY_LOCATION_REQUIRED: 'place', QUALITY_DEPARTMENT_INVALID: 'place', QUALITY_CATEGORY_INVALID: 'category',
  QUALITY_HARM_LEVEL_INVALID: 'harmLevel', QUALITY_TOLD_REQUIRED: 'told',
}

/**
 * "Report an incident" (route 2): what happened, when (Lagos day and time), where (a department of this facility, a
 * place in words, or both), the category and harm level from the DRAFT lists with their hints, the immediate action
 * taken, and whether the patient or family was told, which moderate harm, severe harm and death require (Q252 A). The
 * form says to write facts, not blame, and no names. A patient is linked only when the form was opened from a patient's
 * page (the page's state, never the address) and the link is switched on (Q-QUAL-2 A, Q-QUAL-3 A).
 */
export function ReportIncident({ facilityId, me }: QualityShared) {
  const navigate = useNavigate()
  const location = useLocation()
  const keyFor = useIdempotencyKeys()
  const focus = useFocusById()
  const [now] = useState(() => lagosNow())
  const fromPatient = patientFromState(location.state)
  const [linkPatient, setLinkPatient] = useState(true)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [day, setDay] = useState(now.day)
  const [time, setTime] = useState(now.time)
  const [departmentCode, setDepartmentCode] = useState('')
  const [locationText, setLocationText] = useState('')
  const [category, setCategory] = useState('')
  const [harmLevel, setHarmLevel] = useState('')
  const [immediateAction, setImmediateAction] = useState('')
  const [told, setTold] = useState<QualityTold | ''>('')
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [refusal, setRefusal] = useState<{ text: string; patient: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  const patient = fromPatient && me.patientLinkAvailable && linkPatient ? fromPatient : null
  const occurredAt = occurredMoment(day, time)
  const needsTold = harmLevel !== '' && toldRequired(harmLevel, me.lists)
  const categoryHint = me.lists.categories.find(entry => entry.code === category)?.hint

  function check(): Partial<Record<Field, string>> {
    const found: Partial<Record<Field, string>> = {}
    const put = (field: Field, problem: string) => { if (problem) found[field] = problem }
    put('title', titleProblem(title))
    put('description', lengthProblem(description, LIMITS.description[0], LIMITS.description[1], 'what happened'))
    put('when', occurredProblem(occurredAt))
    if (!departmentCode && !locationText.trim()) put('place', REFUSALS.QUALITY_LOCATION_REQUIRED!)
    put('locationText', lengthProblem(locationText, LIMITS.locationText[0], LIMITS.locationText[1], 'the place', true))
    if (!category) put('category', REFUSALS.QUALITY_CATEGORY_INVALID!)
    if (!harmLevel) put('harmLevel', REFUSALS.QUALITY_HARM_LEVEL_INVALID!)
    put('immediateAction', lengthProblem(immediateAction, LIMITS.immediateAction[0], LIMITS.immediateAction[1], 'the action taken', true))
    if (needsTold && !told) put('told', REFUSALS.QUALITY_TOLD_REQUIRED!)
    return found
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    const found = check()
    setErrors(found)
    setRefusal(null)
    const first = ORDER.find(field => found[field])
    if (first) { focus(FIELD_IDS[first]); return }
    const body: QualityReportInput = {
      title: title.trim(), description: description.trim(), occurredAt: occurredAt!, category, harmLevel,
      ...(departmentCode ? { departmentCode } : {}),
      ...(locationText.trim() ? { locationText: locationText.trim() } : {}),
      ...(immediateAction.trim() ? { immediateAction: immediateAction.trim() } : {}),
      ...(told ? { patientOrFamilyTold: told } : {}),
      ...(patient ? { patientId: patient.patientId } : {}),
    }
    setBusy(true)
    try {
      const answer = await qualityApi.report(facilityId, body, keyFor('report', body))
      learnFrom()
      navigate(`${BASE}/${answer.incident.incidentId}`, { state: { qualityNotice: `Report sent: incident ${answer.incident.incidentNumber}.` } })
    } catch (caught) {
      if (cancelled(caught)) return
      learnFrom(caught)
      const code = isHidApiError(caught) ? caught.code : ''
      if (Object.hasOwn(FIELD_OF, code)) {
        const field = FIELD_OF[code]!
        setErrors({ [field]: REFUSALS[code] })
        focus(FIELD_IDS[field])
        return
      }
      const aboutPatient = code === 'QUALITY_PATIENT_LINK_REFUSED' || code === 'QUALITY_PATIENT_LINK_NOT_AVAILABLE'
      setRefusal({ text: refusalWords(caught, 'The report could not be sent. Try again.', 'Check each answer, then send the report again.'), patient: aboutPatient })
      focus('qs-report-refusal')
    } finally { setBusy(false) }
  }

  const error = (field: Field) => errors[field] || undefined

  return (
    <DeptPage eyebrow={EYEBROW} title="Report an incident" onBack={() => navigate(BASE)} backLabel="Back to Quality & Safety"
      backUnavailable={busy} className="hid-ehr-dept-qs">
      <DeptNotice tone="info" title="Facts, not blame">{GUIDANCE}</DeptNotice>
      <DraftListBanner me={me} />
      {refusal ? (
        <DeptNotice id="qs-report-refusal" tabIndex={-1} role="alert" tone="critical" variant="box">
          <p className="hid-ehr-qs-plain">{refusal.text}</p>
          {refusal.patient && patient ? (
            <EhrButton size="sm" variant="secondary" onClick={() => { setLinkPatient(false); setRefusal(null) }}>Report without the patient</EhrButton>
          ) : null}
        </DeptNotice>
      ) : null}

      <form className="hid-ehr-qs-form" noValidate onSubmit={event => void submit(event)} aria-label="Report an incident">
        <DeptSection title="What happened" headingId="qs-report-what">
          <EhrField label="Short title" controlId={FIELD_IDS.title} error={error('title')} hint="A few words, such as “Wrong strength dispensed”.">
            <EhrInput value={title} maxLength={LIMITS.title[1]} onChange={event => setTitle(event.target.value)} />
          </EhrField>
          <EhrField label="What happened" controlId={FIELD_IDS.description} error={error('description')}
            hint="Say what happened, in order, as facts.">
            <EhrTextarea rows={6} value={description} maxLength={LIMITS.description[1]} onChange={event => setDescription(event.target.value)} />
          </EhrField>
          <div className="hid-ehr-dept-form-grid">
            <EhrField label="Day it happened" controlId={FIELD_IDS.when} error={error('when')}
              hint={occurredAt ? `Lagos time: ${whenText(occurredAt)}` : 'Up to a year ago.'}>
              <EhrInput type="date" value={day} max={now.day} onChange={event => setDay(event.target.value)} />
            </EhrField>
            <EhrField label="Time it happened" controlId="qs-report-time" hint="Lagos time, 24-hour clock.">
              <EhrInput type="time" value={time} onChange={event => setTime(event.target.value)} />
            </EhrField>
          </div>
        </DeptSection>

        <DeptSection title="Where it happened" headingId="qs-report-where">
          <p className="hid-ehr-qs-plain">Choose a department, describe the place, or both.</p>
          <div className="hid-ehr-dept-form-grid">
            <EhrField label="Department" controlId={FIELD_IDS.place} error={error('place')}>
              <EhrSelect value={departmentCode} onChange={event => setDepartmentCode(event.target.value)}>
                <option value="">No department</option>
                {me.departmentCodes.map(code => <option key={code} value={code}>{departmentText(code)}</option>)}
              </EhrSelect>
            </EhrField>
            <EhrField label="Where exactly (optional)" controlId={FIELD_IDS.locationText} error={error('locationText')}
              hint="For example: dispensary counter 2.">
              <EhrInput value={locationText} maxLength={LIMITS.locationText[1]} onChange={event => setLocationText(event.target.value)} />
            </EhrField>
          </div>
        </DeptSection>

        <DeptSection title="What kind and how much harm" headingId="qs-report-kind">
          <EhrField label="Category" controlId={FIELD_IDS.category} error={error('category')} hint={categoryHint}>
            <EhrSelect value={category} onChange={event => setCategory(event.target.value)}>
              <option value="">Choose a category</option>
              {me.lists.categories.map(entry => <option key={entry.code} value={entry.code}>{entry.label}</option>)}
            </EhrSelect>
          </EhrField>
          <fieldset className="hid-ehr-qs-choices" aria-describedby={errors.harmLevel ? 'qs-report-harm-error' : undefined}>
            <legend>Harm</legend>
            {me.lists.harmLevels.map(entry => (
              <label key={entry.code} className="hid-ehr-qs-choice">
                <input id={`qs-report-harm-${entry.code}`} type="radio" name="qs-report-harm" value={entry.code} checked={harmLevel === entry.code}
                  aria-describedby={`qs-report-harm-${entry.code}-hint`} onChange={() => setHarmLevel(entry.code)} />
                <span className="hid-ehr-qs-choice-text">
                  <span className="hid-ehr-qs-choice-label">{entry.label}</span>
                  <span id={`qs-report-harm-${entry.code}-hint`} className="hid-ehr-qs-choice-hint">{entry.hint}</span>
                </span>
              </label>
            ))}
            {errors.harmLevel ? <p id="qs-report-harm-error" className="hid-ehr-error">{errors.harmLevel}</p> : null}
          </fieldset>
        </DeptSection>

        <DeptSection title="What was done" headingId="qs-report-done">
          <EhrField label="Immediate action taken (optional)" controlId={FIELD_IDS.immediateAction} error={error('immediateAction')}>
            <EhrTextarea rows={3} value={immediateAction} maxLength={LIMITS.immediateAction[1]} onChange={event => setImmediateAction(event.target.value)} />
          </EhrField>
          <fieldset className="hid-ehr-qs-choices hid-ehr-qs-inline" aria-describedby={errors.told ? 'qs-report-told-error' : 'qs-report-told-hint'}>
            <legend>Patient or family told{needsTold ? '' : ' (optional)'}</legend>
            <p id="qs-report-told-hint" className="hid-ehr-hint">Required for moderate harm, severe harm and death.</p>
            {TOLD_VALUES.filter(value => me.lists.toldValues.includes(value)).map(value => (
              <label key={value} className="hid-ehr-qs-choice">
                <input id={`qs-report-told-${value}`} type="radio" name="qs-report-told" value={value} checked={told === value}
                  onChange={() => setTold(value)} />
                <span className="hid-ehr-qs-choice-label">{TOLD_WORDS[value]}</span>
              </label>
            ))}
            {errors.told ? <p id="qs-report-told-error" className="hid-ehr-error">{errors.told}</p> : null}
          </fieldset>
        </DeptSection>

        {fromPatient ? (
          <DeptSection title="Patient" headingId="qs-report-patient">
            {!me.patientLinkAvailable ? <DeptNotice tone="info">{LINK_OFF}</DeptNotice>
              : patient ? <>
                <p className="hid-ehr-qs-plain">This report will be linked to <strong>{patient.name}</strong>. Only quality leads and administrators see who.</p>
                <EhrButton size="sm" variant="quiet" onClick={() => setLinkPatient(false)}>Don’t link the patient</EhrButton>
              </> : <>
                <p className="hid-ehr-qs-plain">This report will not name the patient. Do not write their name.</p>
                <EhrButton size="sm" variant="quiet" onClick={() => setLinkPatient(true)}>Link {fromPatient.name}</EhrButton>
              </>}
            {refusal?.patient && !patient ? <p className="hid-ehr-hint">{LINK_REFUSED}</p> : null}
          </DeptSection>
        ) : null}

        <div className="hid-ehr-dept-form-actions">
          <EhrButton type="submit" busy={busy}>Send report</EhrButton>
          <EhrButton variant="secondary" onClick={() => navigate(BASE)} disabled={busy}>Cancel</EhrButton>
        </div>
      </form>
    </DeptPage>
  )
}
