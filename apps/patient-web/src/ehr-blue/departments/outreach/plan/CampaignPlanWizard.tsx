import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { isHidApiError } from '@hid/http'
import { Pencil } from 'lucide-react'
import { FormActions, FormPage, Step } from '../../../../kasuwa/parts'
import { Alert, Button, Input, cx } from '../../../../kasuwa/ui'
import { staffApi, type OutreachCampaign } from '../../../../staff/api'
import { useFocusById } from '../../../../staff/focus'
import { useDeptAccess } from '../../parts/access'
import { campaignFlowErrorText, outreachCampaignApi, whenOffered } from '../campaignApi'
import { stationLabel } from '../campaignTypes'
import {
  CAMPAIGN_CREATE_FAILED, CAMPAIGN_CREATE_UNSURE, CAMPAIGN_SERVICES, campaignErrorText, CHOOSE_SERVICE, COMPLETE_FIELD, END_AFTER_START,
  lagosDayInstant, NAME_LENGTH, RETRY_NOTE,
} from '../outreachParts'
import {
  ChoiceChips, ConsentEditor, dayText, enterMovesOn, fieldProps, FocusEditor, KitList, KitsEditor, PackageEditor, PartnersEditor, PlanField,
  SitesEditor, StationsEditor,
} from './planParts'
import {
  canSave, draftFrom, emptyDraft, emptySite, focusesText, languagesText, listInWords, needsSeparateConsent, placeText, planInput,
  type PlanDraft,
} from './planDraft'

/*
 * "New campaign" (owner decisions of 13 November 2026): nine short steps, most with smart defaults, so a campaign is set
 * up in a few minutes on a phone. It saves as it goes. Step 1 creates the campaign with the served create call (name,
 * services, dates: checked as Outreach checks them, no Idempotency-Key, a lost answer re-reads the list and is never
 * sent again by itself). Each later step saves the whole plan (PUT …/plan, If-Match its version) once it has a focus and
 * a site; until then the plan waits in memory. Where Outreach does not serve the plan yet (404), the wizard ends after
 * the campaign is created, as "New campaign" did. The campaign stays not started until a coordinator opens it.
 */

type Basics = 'name' | 'services' | 'starts' | 'ends' | 'target'
interface BasicsState { readonly name: string; readonly services: string[]; readonly starts: string; readonly ends: string; readonly target: string }

const BASICS_ORDER: readonly Basics[] = ['name', 'services', 'starts', 'ends', 'target']
const BASICS_ID: Record<Basics, string> = {
  name: 'plan-campaign-name', services: `plan-services-${CAMPAIGN_SERVICES[0]!.value}`, starts: 'plan-campaign-starts', ends: 'plan-campaign-ends',
  target: 'plan-campaign-target',
}

const STEPS = [
  { title: 'Name and dates', hint: 'Days in Nigerian time.' },
  { title: 'What it’s for', hint: 'Choose one or more.' },
  { title: 'Screening', hint: 'Switch off anything you won’t do.' },
  { title: 'Sites', hint: 'Where the team works. One is enough to start.' },
  { title: 'How stations work', hint: 'One person for everything, or a line of stations.' },
  { title: 'Referral partners', hint: 'Optional. You can add them later.' },
  { title: 'Consent', hint: 'Read to each person before they are registered.' },
  { title: 'Kits', hint: 'Optional. You can add stock later.' },
  { title: 'Check and save', hint: 'Edit anything, then save.' },
] as const
const LAST = STEPS.length
const OPTIONAL_STEPS: ReadonlySet<number> = new Set([6, 8])

export interface CampaignPlanWizardProps {
  /** Carry on with a campaign already created (its plan is read and edited from step 2). */
  readonly campaignId?: string
  readonly onDone: (campaignId: string) => void
  readonly onCancel: () => void
  /** The working facility; the session's own when left out. */
  readonly facilityId?: string
  /** The served create answered: the campaign exists now (for a list to read it again). */
  readonly onCreated?: (created: OutreachCampaign) => void
  /** The create's answer was lost: the campaign may be saved, so the list is read again. */
  readonly onUnsure?: () => void
}

export function CampaignPlanWizard({ campaignId: resumeId, onDone, onCancel, facilityId: given, onCreated, onUnsure }: CampaignPlanWizardProps) {
  const access = useDeptAccess()
  const facilityId = given ?? access.facilityId ?? ''
  const focus = useFocusById()
  const [step, setStep] = useState(resumeId ? 2 : 1)
  const [created, setCreated] = useState<OutreachCampaign | null>(null)
  const campaignId = created?.id ?? resumeId ?? null
  const [draft, setDraft] = useState<PlanDraft>(() => emptyDraft(access.facility?.name ?? ''))
  const [consentEdited, setConsentEdited] = useState(false)
  const version = useRef<number | null>(resumeId ? null : 0)
  const saved = useRef('')
  const [fromSummary, setFromSummary] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; note?: string } | null>(null)
  const [problems, setProblems] = useState<{ errors: Partial<Record<string, string>>; alert?: string; seq: number }>({ errors: {}, seq: 0 })
  const [basics, setBasics] = useState<BasicsState>({ name: '', services: ['registration'], starts: '', ends: '', target: '200' })
  const doneRef = useRef(onDone)
  useEffect(() => { doneRef.current = onDone })
  const body = useRef<HTMLDivElement>(null)
  const moved = useRef(false)

  // Carrying on: the plan saved so far.
  useEffect(() => {
    if (!resumeId || !facilityId) return
    let live = true
    void (async () => {
      try {
        const read = await whenOffered(() => outreachCampaignApi.plan(facilityId, resumeId))
        if (!live) return
        if (!read.offered) { doneRef.current(resumeId); return }
        version.current = read.value.rowVersion
        saved.current = JSON.stringify(planInput(draftFrom(read.value)))
        setDraft(draftFrom(read.value))
        setConsentEdited(true)
      } catch (caught) {
        if (live && isHidApiError(caught) && caught.code === 'OUTREACH_PLAN_NOT_FOUND') version.current = 0
        else if (live) setError({ text: campaignFlowErrorText(caught, 'The plan could not be read. Try again.') })
      }
    })()
    return () => { live = false }
  }, [resumeId, facilityId])

  // A new step: focus its first field, so typing starts at once (not on the first view: the page focuses its heading).
  useLayoutEffect(() => {
    if (!moved.current) { moved.current = true; return }
    const first = body.current?.querySelector<HTMLElement>('input:not([disabled]):not([type=hidden]),textarea,select,[role=radio][tabindex="0"]')
    first?.focus()
  }, [step])

  const change = (next: PlanDraft) => { setDraft(next); setProblems(previous => (Object.keys(previous.errors).length ? { errors: {}, seq: previous.seq } : previous)) }
  const refuse = (errors: Partial<Record<string, string>>, order: readonly string[], idOf: (key: string) => string) => {
    const first = order.find(key => errors[key])
    if (!first) return false
    const here = document.activeElement?.id === idOf(first)
    setProblems(previous => ({ errors, alert: here ? first : undefined, seq: previous.seq + 1 }))
    if (!here) focus(idOf(first))
    return true
  }

  /** Saves the plan as it is now, once it can be (a focus and a site), and only when it changed. */
  async function savePlan(): Promise<boolean> {
    if (!campaignId || !canSave(draft)) return true
    const input = planInput(draft)
    const json = JSON.stringify(input)
    if (json === saved.current) return true
    try {
      if (version.current === null) {
        // The version was never read: read it now.
        try { version.current = (await outreachCampaignApi.plan(facilityId, campaignId)).rowVersion }
        catch (caught) { if (isHidApiError(caught) && caught.code === 'OUTREACH_PLAN_NOT_FOUND') version.current = 0; else throw caught }
      }
      const answer = await outreachCampaignApi.savePlan(facilityId, campaignId, input, version.current)
      version.current = answer.rowVersion
      saved.current = json
      return true
    } catch (caught) {
      setError({ text: campaignFlowErrorText(caught, 'The plan could not be saved. Try again.'), note: 'What you entered is kept.' })
      if (isHidApiError(caught) && caught.code === 'VERSION_CONFLICT') {
        // Read again: the next save goes against the version now saved.
        try { version.current = (await outreachCampaignApi.plan(facilityId, campaignId)).rowVersion } catch { version.current = null }
      }
      return false
    }
  }

  function go(next: number) {
    setError(null)
    setProblems(previous => ({ errors: {}, seq: previous.seq }))
    if (next === 4 && draft.sites.length === 0) setDraft(previous => ({ ...previous, sites: [emptySite()] }))
    setStep(next)
  }
  const after = (at: number) => (fromSummary ? LAST : at + 1)

  async function createCampaign() {
    const name = basics.name.trim()
    const services = CAMPAIGN_SERVICES.map(service => service.value).filter(value => basics.services.includes(value))
    const target = Number(basics.target)
    const errors: Partial<Record<Basics, string>> = {}
    if (!created && !resumeId) {
      if (!name) errors.name = COMPLETE_FIELD
      else if (name.length < 2) errors.name = NAME_LENGTH
      if (!services.length) errors.services = CHOOSE_SERVICE
      if (!basics.starts) errors.starts = COMPLETE_FIELD
      if (basics.starts && basics.ends && basics.ends < basics.starts) errors.ends = END_AFTER_START
    }
    if (basics.target && (!Number.isInteger(target) || target < 1 || target > 1_000_000)) errors.target = 'Enter a number of people, like 200.'
    if (refuse(errors, BASICS_ORDER, key => BASICS_ID[key as Basics])) return
    setProblems(previous => (Object.keys(previous.errors).length ? { errors: {}, seq: previous.seq } : previous))
    const withBasics = { ...draft, target: basics.target ? target : draft.target }
    setDraft(withBasics)
    if (created || resumeId) { go(after(1)); return }
    setBusy(true)
    setError(null)
    let campaign: OutreachCampaign
    try {
      campaign = await staffApi.createOutreachCampaign(facilityId, {
        name, services, startsAt: lagosDayInstant(basics.starts), ...(basics.ends ? { endsAt: lagosDayInstant(basics.ends, true) } : {}),
      })
    } catch (caught) {
      // Refused by Outreach: nothing was saved. No answer, or the gateway's lost one (502, 504): it may have been.
      const unsure = !isHidApiError(caught) || caught.status === 0 || caught.status === 502 || caught.status === 504
      setError({ text: campaignErrorText(caught, CAMPAIGN_CREATE_FAILED), note: unsure ? CAMPAIGN_CREATE_UNSURE : RETRY_NOTE })
      if (unsure) onUnsure?.()
      setBusy(false)
      return
    }
    setCreated(campaign)
    onCreated?.(campaign)
    // Is the plan served? Where it isn't, the campaign is all there is to save: done, as before.
    try {
      const read = await whenOffered(() => outreachCampaignApi.plan(facilityId, campaign.id))
      if (!read.offered) { setBusy(false); onDone(campaign.id); return }
      version.current = read.value.rowVersion
    } catch (caught) {
      version.current = isHidApiError(caught) && caught.code === 'OUTREACH_PLAN_NOT_FOUND' ? 0 : null
    }
    setBusy(false)
    go(2)
  }

  async function next(event?: FormEvent) {
    event?.preventDefault()
    if (busy) return
    if (step === 1) { await createCampaign(); return }
    const errors: Record<string, string> = {}
    if (step === 2 && draft.focuses.length === 0) errors.focuses = 'Choose at least one.'
    if (step === 4) {
      const sites = draft.sites.length ? draft.sites : [emptySite()]
      if (!sites[0]!.name.trim()) errors['plan-site-0-name'] = 'Enter where the team will work.'
    }
    if (step === 6) draft.partners.forEach((partner, index) => {
      if (!partner.name.trim() && (partner.phone.trim() || partner.address.trim())) errors[`plan-partner-${index}-name`] = 'Enter the clinic or hospital’s name.'
    })
    if (step === LAST && !canSave(draft)) {
      setFromSummary(true)
      go(draft.focuses.length ? 4 : 2)
      return
    }
    // The focuses' first chip, or the field itself.
    if (refuse(errors, Object.keys(errors), key => (key === 'focuses' ? 'plan-focuses-hepatitis_b' : key))) return
    setBusy(true)
    const ok = await savePlan()
    setBusy(false)
    if (!ok) return
    if (step === LAST) { onDone(campaignId!); return }
    go(after(step))
  }

  function edit(at: number) { setFromSummary(true); go(at) }
  function finishLater() {
    if (busy) return
    if (campaignId) onDone(campaignId)
    else onCancel()
  }

  const basicsField = (key: Basics) => ({ error: problems.errors[key], alert: problems.alert === key, seq: problems.seq })
  const editorProps = { draft, onChange: change, consentEdited, errors: problems.errors as Record<string, string> }
  const current = STEPS[step - 1]!

  let content: ReactNode
  switch (step) {
    case 1:
      content = created || resumeId ? (
        <>
          {created ? <p className="m-0 text-sm text-ink-2"><span className="font-medium text-ink">{created.name}</span> is saved. Its name and dates can’t be changed here.</p> : null}
          <OrgAndTarget basics={basics} setBasics={setBasics} draft={draft} change={change} field={basicsField} />
        </>
      ) : (
        <>
          <PlanField id={BASICS_ID.name} label="Campaign name" required hint="The place and what it’s for, like “Ajegunle hepatitis B screening”." {...basicsField('name')}>
            <Input className="h-12 text-base sm:h-11 sm:text-sm" name="name" maxLength={200} autoComplete="off" value={basics.name}
              onChange={event => setBasics({ ...basics, name: event.target.value })} {...fieldProps(BASICS_ID.name, problems.errors.name, true)} />
          </PlanField>
          <OrgAndTarget basics={basics} setBasics={setBasics} draft={draft} change={change} field={basicsField} />
          <div className="grid gap-4 @md:grid-cols-2">
            <PlanField id={BASICS_ID.starts} label="Start date" required {...basicsField('starts')}>
              <Input className="h-12 text-base sm:h-11 sm:text-sm" type="date" name="startsOn" value={basics.starts}
                onChange={event => setBasics({ ...basics, starts: event.target.value })} {...fieldProps(BASICS_ID.starts, problems.errors.starts)} />
            </PlanField>
            <PlanField id={BASICS_ID.ends} label="End date" optional hint="Leave blank if it has no set end." {...basicsField('ends')}>
              <Input className="h-12 text-base sm:h-11 sm:text-sm" type="date" name="endsOn" value={basics.ends}
                onChange={event => setBasics({ ...basics, ends: event.target.value })} {...fieldProps(BASICS_ID.ends, problems.errors.ends, true)} />
            </PlanField>
          </div>
          <ChoiceChips name="services" id="plan-services" legend="What the team will do" hint="Registration lets the team register people into it."
            options={CAMPAIGN_SERVICES} values={basics.services} error={problems.errors.services} alert={problems.alert === 'services'} seq={problems.seq}
            onChange={services => setBasics({ ...basics, services })} />
        </>
      )
      break
    case 2: content = <FocusEditor {...editorProps} />; break
    case 3: content = <PackageEditor {...editorProps} />; break
    case 4: content = <SitesEditor {...editorProps} />; break
    case 5: content = <StationsEditor {...editorProps} />; break
    case 6: content = <PartnersEditor {...editorProps} />; break
    case 7: content = <ConsentEditor {...editorProps} onEdited={() => setConsentEdited(true)} />; break
    case 8: content = <KitsEditor {...editorProps} />; break
    default: content = <PlanSummary draft={draft} campaign={created} basics={basics} onEdit={edit} />
  }

  const primary = step === 1 && !created && !resumeId ? 'Create campaign' : step === LAST ? 'Save campaign' : fromSummary ? 'Back to check' : 'Next'
  return (
    <FormPage title="New campaign" description={step === 1 && !created ? 'Set it up in a few minutes. Everything can be changed later.' : undefined}>
      <form className="flex flex-col gap-4" noValidate aria-label={`New campaign: ${current.title}`} onSubmit={event => void next(event)} onKeyDown={enterMovesOn}>
        <Progress step={step} />
        <Step n={step} title={current.title} hint={current.hint}>
          <div ref={body} className="flex min-w-0 flex-col gap-4">{content}</div>
        </Step>
        {error ? (
          <Alert intent="error" title={error.text}>{error.note ?? null}</Alert>
        ) : null}
        <FormActions>
          <Button variant="ghost" onClick={finishLater} aria-disabled={busy || undefined}>{campaignId ? 'Finish later' : 'Cancel'}</Button>
          {step > 1 && !fromSummary ? (
            // Side by side on a phone too, so the primary stays in thumb reach under them.
            <div className="flex gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
              <Button onClick={() => { if (!busy) go(step - 1) }} aria-disabled={busy || undefined}>Back</Button>
              {OPTIONAL_STEPS.has(step) ? <Button onClick={() => { if (!busy) go(step + 1) }} aria-disabled={busy || undefined}>Skip</Button> : null}
            </div>
          ) : null}
          <Button type="submit" variant="primary" size="lg" loading={busy}>{busy ? 'Saving…' : primary}</Button>
        </FormActions>
      </form>
    </FormPage>
  )
}

function OrgAndTarget({ basics, setBasics, draft, change, field }: {
  readonly basics: BasicsState
  readonly setBasics: (next: BasicsState) => void
  readonly draft: PlanDraft
  readonly change: (next: PlanDraft) => void
  readonly field: (key: Basics) => { error?: string; alert: boolean; seq: number }
}) {
  const targetError = field('target').error
  return (
    <div className="grid gap-4 @md:grid-cols-2">
      <PlanField id="plan-organisation" label="Organisation" hint="Shown on slips and the report.">
        <Input className="h-12 text-base sm:h-11 sm:text-sm" maxLength={200} autoComplete="organization" value={draft.organisationName}
          onChange={event => change({ ...draft, organisationName: event.target.value })} {...fieldProps('plan-organisation', undefined, true)} />
      </PlanField>
      <PlanField id={BASICS_ID.target} label="People you aim to see" {...field('target')}>
        <Input className="h-12 text-base sm:h-11 sm:text-sm" inputMode="numeric" pattern="[0-9]*" maxLength={7} autoComplete="off" value={basics.target}
          onChange={event => setBasics({ ...basics, target: event.target.value.replace(/\D/g, '') })} {...fieldProps(BASICS_ID.target, targetError)} />
      </PlanField>
    </div>
  )
}

function Progress({ step }: { readonly step: number }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-caption text-ink-3" aria-live="polite">Step {step} of {LAST}</p>
      <div className="flex gap-1" aria-hidden="true">
        {STEPS.map((_, index) => <span key={index} className={cx('h-1 flex-1 rounded-full', index < step ? 'bg-brand-fill' : 'bg-line')} />)}
      </div>
    </div>
  )
}

/** Step 9: everything at a glance, each part with its Edit. */
function PlanSummary({ draft, campaign, basics, onEdit }: {
  readonly draft: PlanDraft; readonly campaign: OutreachCampaign | null
  readonly basics: BasicsState; readonly onEdit: (step: number) => void
}) {
  const pkg = draft.package
  const sensitive = pkg.tests.filter(test => test.sensitive).length
  const sites = draft.sites.filter(site => site.name.trim())
  const partners = draft.partners.filter(partner => partner.name.trim())
  const rows: Array<{ step: number; label: string; value: ReactNode }> = [
    { step: 1, label: 'Name and dates', value: [campaign?.name ?? basics.name, draft.organisationName,
      basics.starts ? (basics.ends ? `${dayText(basics.starts)} to ${dayText(basics.ends)}` : `From ${dayText(basics.starts)}`) : null,
      `aim ${draft.target} people`].filter(Boolean).join(' · ') },
    { step: 2, label: 'What it’s for', value: focusesText(draft.focuses) },
    { step: 3, label: 'Screening', value: listInWords([
      `${pkg.vitals.length} vital sign${pkg.vitals.length === 1 ? '' : 's'}`,
      `${pkg.tests.length} test${pkg.tests.length === 1 ? '' : 's'}${sensitive ? ` (${sensitive} sensitive)` : ''}`,
      `${pkg.questions.length} question${pkg.questions.length === 1 ? '' : 's'}`]) },
    { step: 4, label: 'Sites', value: sites.length ? sites.map(site => [site.name, placeText(site)].filter(Boolean).join(', ')).join('; ') : 'None yet' },
    { step: 5, label: 'Stations', value: draft.stationMode === 'one_person' ? 'One person does everything' : draft.stations.map(stationLabel).join(', ') },
    { step: 6, label: 'Referral partners', value: partners.length ? partners.map(partner => partner.name).join('; ') : 'None yet' },
    { step: 7, label: 'Consent', value: `${needsSeparateConsent(pkg) ? 'Campaign consent and HIV test consent' : 'Campaign consent'}, read in ${languagesText(draft.consent.languages)}` },
    { step: 8, label: 'Kits', value: draft.kits.length ? <KitList draft={draft} /> : 'None yet' },
  ]
  return (
    <>
      <ul className="m-0 list-none divide-y divide-line p-0">
        {rows.map(row => (
          <li key={row.step} className="flex items-start gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="m-0 text-[13px] font-medium text-ink-3">{row.label}</p>
              <div className="m-0 mt-0.5 text-sm break-words text-ink">{row.value}</div>
            </div>
            <Button variant="ghost" icon={Pencil} aria-label={`Edit ${row.label.toLowerCase()}`} onClick={() => onEdit(row.step)}>Edit</Button>
          </li>
        ))}
      </ul>
      {!canSave(draft) ? <Alert intent="warning" title="Not ready to save yet">Choose what it’s for and add a site.</Alert>
        : <p className="m-0 text-sm text-ink-2">It stays not started until you open it for registration from the campaign.</p>}
    </>
  )
}
