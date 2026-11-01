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
import { SETUP_TITLE, STEPS, stepEyebrow, stepsAt, type StepName } from './setupText'
import { newSetup, type SampleSetup } from './setupState'
import './onboarding.css'

/** The steps that are samples throughout: the sample notice sits right under the heading. */
const SAMPLE_STEPS: ReadonlySet<StepName> = new Set(['Type', 'Departments', 'Branches', 'Billing', 'Launch'])

/**
 * The design's "Continue to …" below the card, where the step's card has no button of its own to go on, naming the step
 * that follows among those shown: Roles goes on to Billing at a demo facility, and to Review at a real one.
 */
function continueBelow(name: StepName, following: StepName | undefined): string | undefined {
  if (name === 'Branches') return 'Next (sample)'
  if ((name === 'Staff' || name === 'Roles') && following) return `Continue to ${following.toLowerCase()}`
  return undefined
}

/**
 * The step an address below the page names (/provider/onboarding/review), among the steps shown, or the first: a sample
 * step's address at a real facility opens the first step.
 */
export function openingStep(rest: string, steps: readonly StepName[] = STEPS): number {
  const named = rest.split('/')[0]?.toLowerCase() ?? ''
  return Math.max(0, steps.findIndex(step => step.toLowerCase() === named))
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
 *
 * The steps that are samples and nothing else (Type, Departments, Branches, Billing) show at the demo facilities only:
 * a real facility would type its settings there and believe them kept (parity report 3.2). It has the five other steps,
 * in the design's order, and the stepper and the eyebrow count those five.
 */
export function FacilitySetup() {
  const { state } = useStaff()
  const facility = state.status === 'ready' ? state.session.actor.facility : undefined
  const demo = isDemoFacility(facility?.id)
  const steps = stepsAt(demo)
  const { rest } = useBluePage()
  const navigate = useNavigate()
  const hrefOf = useSampleHref()
  // The step is held by its name, and found among the steps shown on each render: which steps those are depends on the
  // working facility, and should that change while the page stays open, a step it no longer has opens the first one
  // rather than another step's number.
  const [chosen, setChosen] = useState<StepName>(() => steps[openingStep(rest, steps)] ?? STEPS[0])
  const step = Math.max(0, steps.indexOf(chosen))
  const name = steps[step] ?? STEPS[0]
  const [setup, setSetup] = useState<SampleSetup>(newSetup)
  const root = useRef<HTMLDivElement>(null)
  const shown = useRef(name)

  // A step that replaces the control just used ("Save and continue", "Back") gives focus to the page's heading, which
  // names the step; the stepper's buttons stay, and keep it. As a page change does (pageFocus.ts), in the commit.
  useLayoutEffect(() => {
    if (shown.current === name) return
    shown.current = name
    if (focusLost()) focusPageHeading(root.current)
  }, [name])

  if (!facility) return <SetupRefusal />
  const goTo = (index: number) => setChosen(steps[Math.min(steps.length - 1, Math.max(0, index))] ?? STEPS[0])
  const next = () => goTo(step + 1)
  const update = (change: Partial<SampleSetup>) => setSetup(current => ({ ...current, ...change }))
  // The design's links into other samples, only where those open at a demo facility: never from here into a sample at a
  // real one.
  const demoSample = (moduleId: string) => (demo ? hrefOf(moduleId) : null)
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
    Roles: <RolesStep templates={demo} />,
    Billing: <BillingStep billing={setup.billing} serviceCatalogue={demoSample('services')}
      onSave={billing => { update({ billing }); next() }} />,
    Review: <ReviewStep facility={facility} setup={demo ? setup : null} onNext={next} />,
    Launch: <LaunchStep facility={facility} />,
  }
  const below = continueBelow(name, steps[step + 1])

  return (
    <div ref={root} className="hid-ehr-onboarding">
      <EhrPageHeading
        // The heading names the step for a screen reader, where the eyebrow shows it.
        eyebrow={<span aria-hidden="true">{stepEyebrow(step, steps)}</span>}
        title={<><span className="hid-ehr-sr-only">{stepEyebrow(step, steps)}: </span>{SETUP_TITLE}</>}
        primaryAction={<EhrButton variant="secondary" onClick={() => navigate('/provider/institutions')}>Exit setup</EhrButton>}
      />
      {SAMPLE_STEPS.has(name) ? <EhrSampleBanner /> : null}
      <nav className="hid-ehr-onboarding-stepper" aria-label="Onboarding steps">
        {steps.map((candidate, index) => (
          <EhrButton key={candidate} variant="secondary" aria-current={index === step ? 'step' : undefined}
            onClick={() => setChosen(candidate)}>{index + 1}. {candidate}</EhrButton>
        ))}
      </nav>
      {/* Each step's own controls are new, so a step change that took the one used moves focus to the heading. */}
      <div key={name} className="hid-ehr-onboarding-step">
        {body[name]}
        {below !== undefined || step > 0 ? (
          <div className="hid-ehr-actions">
            {below !== undefined ? <EhrButton onClick={next}>{below}</EhrButton> : null}
            {step > 0 ? <EhrButton variant="secondary" onClick={() => goTo(step - 1)}>Back</EhrButton> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
