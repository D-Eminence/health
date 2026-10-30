import { useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { EhrButton, EhrCard, EhrDialog, EhrField, EhrInput, EhrPageHeading, EhrSampleBanner, EhrSelect } from '@hid/ui/ehr'
import { useBluePage } from '../pageContext'
import { JOURNEYS, type Journey, type TourStep } from './journeys'

/**
 * The Design tour: the design's journeys (screens/1-register-and-launch, 2-sign-in, 3-forgot-password,
 * 4-staff-invitation, 6-subscription) inside the blue EHR, one screen at a time, with Back and Next. A sample: its forms
 * keep what is typed in memory until the tour moves on, ask for no password and send nothing.
 */
export function DesignTourIndex() {
  return <>
    <EhrPageHeading title="Design tour" description="The design's journeys, screen by screen. Nothing here signs anyone in or saves anything." />
    <EhrSampleBanner />
    <ul className="hid-ehr-blue-chooser-list">
      {JOURNEYS.map(journey => (
        <li key={journey.id} className="hid-ehr-card hid-ehr-blue-facility-card">
          <h2 className="hid-ehr-card-title">{journey.title}</h2>
          <p className="hid-ehr-blue-muted">{journey.summary} {journey.steps.length} screens.</p>
          <Link className="hid-ehr-button" to={`/provider/tour/${journey.id}`}>Start: {journey.title}</Link>
        </li>
      ))}
    </ul>
  </>
}

export function JourneyTour({ journeyId }: { readonly journeyId: string }) {
  const journey = JOURNEYS.find(candidate => candidate.id === journeyId)
  const { rest } = useBluePage()
  if (!journey) return <DesignTourIndex />
  const index = Math.min(Math.max(Number.parseInt(rest || '1', 10) || 1, 1), journey.steps.length) - 1
  return <JourneyStep key={index} journey={journey} index={index} />
}

function JourneyStep({ journey, index }: { readonly journey: Journey; readonly index: number }) {
  const navigate = useNavigate()
  const step = journey.steps[index]!
  const heading = useRef<HTMLHeadingElement>(null)
  const [asking, setAsking] = useState(false)
  const last = index === journey.steps.length - 1
  const go = (to: number) => navigate(`/provider/tour/${journey.id}/${to + 1}`)
  // Each screen takes focus as it opens, as a page does.
  useLayoutEffect(() => {
    if (index > 0) heading.current?.focus()
  }, [index])
  const next = () => (last ? navigate('/provider/tour') : go(index + 1))

  return <>
    <EhrPageHeading title={journey.title} description={`Screen ${index + 1} of ${journey.steps.length}`} />
    <EhrSampleBanner />
    <div className="hid-ehr-blue-tour">
      <nav aria-label="Screens" className="hid-ehr-blue-tour-steps">
        <ol className="hid-ehr-blue-list">
          {journey.steps.map((candidate, position) => (
            <li key={position}>
              <Link className="hid-ehr-blue-link" to={`/provider/tour/${journey.id}/${position + 1}`}
                aria-current={position === index ? 'step' : undefined}>{position + 1}. {candidate.title}</Link>
            </li>
          ))}
        </ol>
      </nav>
      <EhrCard>
        <p className="hid-ehr-blue-eyebrow">Design route {step.route}</p>
        <h2 ref={heading} tabIndex={-1} className="hid-ehr-overlay-title">{step.title}</h2>
        {step.text ? <p>{step.text}</p> : null}
        {step.kind === 'form' ? <StepForm step={step} onDone={next} /> : null}
        {step.kind === 'choice' ? (
          <div className="hid-ehr-card hid-ehr-blue-facility-card">
            <h3 className="hid-ehr-card-title">Fictional Cedar Hospital</h3>
            <p className="hid-ehr-blue-muted">Hospital Owner · active</p>
            <EhrButton onClick={next}>{step.action ?? 'Continue'}</EhrButton>
          </div>
        ) : null}
        {step.kind === 'dialog' ? <>
          <EhrButton onClick={() => setAsking(true)}>{step.action ?? 'Continue'}</EhrButton>
          <EhrDialog open={asking} title={step.title} description={step.text ?? ''} confirmLabel={step.action ?? 'Continue'}
            onConfirm={() => { setAsking(false); next() }} onCancel={() => setAsking(false)} />
        </> : null}
        {step.rule ? <p className="hid-ehr-blue-muted">{step.rule}</p> : null}
        <div className="hid-ehr-actions hid-ehr-blue-form-actions">
          {index > 0 ? <EhrButton variant="secondary" onClick={() => go(index - 1)}>Back</EhrButton> : null}
          {step.kind === 'notice' ? <EhrButton onClick={next}>{last ? 'Finish the tour' : step.action ?? 'Next screen'}</EhrButton>
            : <EhrButton variant="quiet" onClick={next}>{last ? 'Finish the tour' : 'Skip to the next screen'}</EhrButton>}
        </div>
      </EhrCard>
    </div>
  </>
}

function StepForm({ step, onDone }: { readonly step: TourStep; readonly onDone: () => void }) {
  const [values, setValues] = useState<Record<string, string | boolean>>({})
  const [missing, setMissing] = useState<readonly string[]>([])
  const fields = step.fields ?? []
  return (
    <form noValidate className="hid-ehr-blue-form-grid" onSubmit={event => {
      event.preventDefault()
      const empty = fields.filter(field => field.type !== 'checkbox' && field.type !== 'file' && !String(values[field.label] ?? '').trim())
        .map(field => field.label)
      setMissing(empty)
      if (empty.length === 0) onDone()
    }}>
      {fields.map(field => field.type === 'checkbox' ? (
        <label key={field.label} className="hid-ehr-blue-check">
          <input type="checkbox" className="hid-ehr-blue-check-input" checked={values[field.label] === true}
            onChange={event => setValues({ ...values, [field.label]: event.target.checked })} /> {field.label}
        </label>
      ) : (
        <EhrField key={field.label} label={field.label} error={missing.includes(field.label) ? `Enter ${field.label.toLowerCase()}.` : undefined}
          hint={field.type === 'file' ? 'Files are not uploaded in the tour.' : undefined}>
          {field.type === 'select' ? (
            <EhrSelect value={String(values[field.label] ?? '')} onChange={event => setValues({ ...values, [field.label]: event.target.value })}>
              <option value="">Choose…</option>
              {field.options?.map(option => <option key={option}>{option}</option>)}
            </EhrSelect>
          ) : field.type === 'file' ? <EhrInput type="text" readOnly value="No file chosen (tour)" />
            : (
              <EhrInput type={field.type === 'code' ? 'text' : field.type ?? 'text'} inputMode={field.type === 'code' ? 'numeric' : undefined}
                maxLength={field.type === 'code' ? 6 : undefined} autoComplete="off"
                value={String(values[field.label] ?? '')} onChange={event => setValues({ ...values, [field.label]: event.target.value })} />
            )}
        </EhrField>
      ))}
      <div className="hid-ehr-blue-full"><EhrButton type="submit">{step.action ?? 'Continue'}</EhrButton></div>
    </form>
  )
}
