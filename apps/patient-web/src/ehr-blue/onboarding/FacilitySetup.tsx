import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { EhrButton, EhrPageHeading, EhrSampleBanner } from '@hid/ui/ehr'
import '@hid/ui/ehr.css'
import { focusLost, focusPageHeading } from '../../pageFocus'
import { useStaff } from '../../staff/App'
import { isDemoFacility } from '../blueFacilities'
import { useBluePage, useSampleHref } from '../frame/pageContext'
import { FacilityStep } from './FacilityStep'
import { LaunchStep, ReviewStep } from './ReviewSteps'
import { BillingStep, BranchesStep, DepartmentsStep, TypeStep } from './SampleSteps'
import { RolesStep, StaffStep } from './StaffSteps'
import { SetupRefusal } from './SetupRefusal'
import { SETUP_TITLE, STEPS, stepEyebrow, type StepName } from './setupText'
import { newSetup, type SampleSetup } from './setupState'
import './onboarding.css'

/** The steps that are samples throughout: the sample notice sits right under the heading. */
const SAMPLE_STEPS: ReadonlySet<StepName> = new Set(['Type', 'Departments', 'Branches', 'Billing', 'Launch'])

/** The design's "Continue to …" below the card, where the step's card has no button of its own to go on. */
const CONTINUE_BELOW: Partial<Record<StepName, string>> = {
  Branches: 'Next (sample)',
  Staff: 'Continue to roles',
  Roles: 'Continue to billing',
}

/** The step an address below the page names (/provider/onboarding/review), or the first. */
export function openingStep(rest: string): number {
  const named = rest.split('/')[0]?.toLowerCase() ?? ''
  return Math.max(0, STEPS.findIndex(step => step.toLowerCase() === named))
}

/**
 * Facility setup (design screens 14-22, src/admin.tsx Onboarding): the design's nine-step wizard inside the blue frame,
 * for the administrator of a facility that signed itself up. Its stepper goes to any step at any time, as the design's
 * does. What it holds lives in this component's state for this visit only: nothing is stored, and a reload starts
 * again.
 *
 * Live where today has an API: the facility's name and Health ID support's check (the session), and Staff & access on
 * the Staff and Roles steps (today's staff API, through that page alone). The rest is a sample under the sample
 * notice, and sends nothing: Health ID does not collect the design's facility details, type, departments, branches or
 * billing policy, and has no launch step.
 */
export function FacilitySetup() {
  const { state } = useStaff()
  const facility = state.status === 'ready' ? state.session.actor.facility : undefined
  const { rest } = useBluePage()
  const navigate = useNavigate()
  const hrefOf = useSampleHref()
  const [step, setStep] = useState(() => openingStep(rest))
  const [setup, setSetup] = useState<SampleSetup>(newSetup)
  const root = useRef<HTMLDivElement>(null)
  const shown = useRef(step)

  // A step that replaces the control just used ("Save and continue", "Back") gives focus to the page's heading, which
  // names the step; the stepper's buttons stay, and keep it. As a page change does (pageFocus.ts), in the commit.
  useLayoutEffect(() => {
    if (shown.current === step) return
    shown.current = step
    if (focusLost()) focusPageHeading(root.current)
  }, [step])

  if (!facility) return <SetupRefusal />
  const name = STEPS[step] ?? STEPS[0]
  const next = () => setStep(current => Math.min(STEPS.length - 1, current + 1))
  const update = (change: Partial<SampleSetup>) => setSetup(current => ({ ...current, ...change }))
  // The design's links into other samples, only where those open at a demo facility: never from here into a sample at a
  // real one.
  const demoSample = (moduleId: string) => (isDemoFacility(facility.id) ? hrefOf(moduleId) : null)
  const shifts = demoSample('shifts')

  const body: Record<StepName, ReactNode> = {
    Facility: <FacilityStep facility={facility} onNext={next} />,
    Type: <TypeStep type={setup.type} departments={setup.departments}
      onSave={(type, departments) => { update({ type, departments }); next() }} />,
    Departments: <DepartmentsStep departments={setup.departments} onSave={departments => { update({ departments }); next() }} />,
    Branches: <BranchesStep departments={setup.departments} branches={setup.branches} onSaveBranch={branch => setSetup(current => ({
      ...current,
      branches: current.branches.some(existing => existing.id === branch.id)
        ? current.branches.map(existing => (existing.id === branch.id ? branch : existing))
        : [...current.branches, branch],
    }))} />,
    Staff: <StaffStep shiftAssignment={shifts ? `${shifts}/new` : null} />,
    Roles: <RolesStep />,
    Billing: <BillingStep billing={setup.billing} serviceCatalogue={demoSample('services')}
      onSave={billing => { update({ billing }); next() }} />,
    Review: <ReviewStep facility={facility} setup={setup} onNext={next} />,
    Launch: <LaunchStep facility={facility} />,
  }
  const continueBelow = CONTINUE_BELOW[name]

  return (
    <div ref={root} className="hid-ehr-onboarding">
      <EhrPageHeading
        // The heading names the step for a screen reader, where the eyebrow shows it.
        // with the thin bar every multi-step flow shows under its "Step N of M".
        eyebrow={<span aria-hidden="true" className="hid-ehr-onboarding-progress">{stepEyebrow(step)}
          <span className="hid-ehr-onboarding-bar"><span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></span></span>}
        title={<><span className="hid-ehr-sr-only">{stepEyebrow(step)}: </span>{SETUP_TITLE}</>}
        primaryAction={<EhrButton variant="secondary" onClick={() => navigate('/provider/institutions')}>Exit setup</EhrButton>}
      />
      {SAMPLE_STEPS.has(name) ? <EhrSampleBanner /> : null}
      <nav className="hid-ehr-onboarding-stepper" aria-label="Setup steps">
        {STEPS.map((candidate, index) => (
          <EhrButton key={candidate} variant="secondary" aria-current={index === step ? 'step' : undefined}
            onClick={() => setStep(index)}>{index + 1}. {candidate}</EhrButton>
        ))}
      </nav>
      {/* Each step's own controls are new, so a step change that took the one used moves focus to the heading. */}
      <div key={name} className="hid-ehr-onboarding-step">
        {body[name]}
        {continueBelow !== undefined || step > 0 ? (
          <div className="hid-ehr-actions">
            {/* Back, then the one primary: rightmost on a wide screen. */}
            {step > 0 ? <EhrButton variant="secondary" onClick={() => setStep(step - 1)}>Back</EhrButton> : null}
            {continueBelow !== undefined ? <EhrButton onClick={next}>{continueBelow}</EhrButton> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
