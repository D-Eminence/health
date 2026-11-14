import { useCallback, useState, type ReactNode } from 'react'
import { isHidApiError } from '@hid/http'
import { ChevronRight, ClipboardList } from 'lucide-react'
import { PageState } from '../../../../kasuwa/parts'
import { Drawer } from '../../../../kasuwa/interactive'
import { Button, EmptyState, Input, cx } from '../../../../kasuwa/ui'
import { useToast } from '../../../../kasuwa/toast'
import { useDeptAccess } from '../../parts/access'
import { useFacilityRead } from '../../parts/useFacilityRead'
import { campaignFlowErrorText, NOT_OFFERED, outreachCampaignApi, whenOffered } from '../campaignApi'
import { stationLabel, type OutreachPlan } from '../campaignTypes'
import { useErrorToast } from '../notify'
import { CampaignPlanWizard } from './CampaignPlanWizard'
import {
  ConsentEditor, enterMovesOn, fieldProps, FocusEditor, KitForm, KitList, PackageEditor, PartnersEditor, PlanField, SitesEditor, StationsEditor,
} from './planParts'
import { draftFrom, focusesText, kitLeft, languagesText, listInWords, needsSeparateConsent, normalise, planInput, type PlanDraft } from './planDraft'

/*
 * A campaign's Setup (owner decisions of 13 November 2026): the plan after the campaign is made, as sections, each with
 * its Edit in a drawer. A save sends the whole plan against the version it was read at (If-Match); if someone changed it
 * since, the plan is read again and the section's changes are put on top of what is saved now, to check and save again.
 * Only coordinators see Edit (Outreach refuses anyone else). A campaign with no plan yet starts the plan's steps here.
 */

type Section = 'campaign' | 'screening' | 'sites' | 'stations' | 'partners' | 'consent' | 'kits'

/** The fields each section's drawer changes: only these are put on top of the plan as saved. */
const SECTION_FIELDS: Readonly<Record<Section, ReadonlyArray<keyof PlanDraft>>> = {
  campaign: ['organisationName', 'target'],
  screening: ['focuses', 'package', 'stations', 'consent'],
  sites: ['sites'],
  stations: ['stationMode', 'stations'],
  partners: ['partners'],
  consent: ['consent'],
  kits: ['kits'],
}
const SECTION_TITLE: Readonly<Record<Section, string>> = {
  campaign: 'Campaign', screening: 'Screening', sites: 'Sites', stations: 'Stations', partners: 'Referral partners', consent: 'Consent', kits: 'Kits',
}

type PlanRead = { readonly offered: false } | { readonly offered: true; readonly plan: OutreachPlan | null }

export function CampaignSetup({ campaignId, facilityId: given, embedded = false }: {
  readonly campaignId: string
  readonly facilityId?: string
  /** Inside another page: says nothing at all where Outreach doesn't serve the plan yet. */
  readonly embedded?: boolean
}) {
  const access = useDeptAccess()
  const facilityId = given ?? access.facilityId
  const toast = useToast()
  const plan = useFacilityRead<PlanRead>(facilityId, true, useCallback(async (id: string) => {
    try {
      const read = await whenOffered(() => outreachCampaignApi.plan(id, campaignId))
      return read.offered ? { offered: true, plan: read.value } : { offered: false }
    } catch (caught) {
      if (isHidApiError(caught) && caught.code === 'OUTREACH_PLAN_NOT_FOUND') return { offered: true, plan: null }
      throw caught
    }
  }, [campaignId]), 'The campaign’s setup could not be loaded. Try again.')
  const team = useFacilityRead(facilityId, true, useCallback((id: string) => whenOffered(() => outreachCampaignApi.team(id, campaignId)), [campaignId]), '')
  // How many of each kit lot were used, from the dashboard's counts (where it is served).
  const usage = useFacilityRead(facilityId, true, useCallback(async (id: string) => {
    try {
      const read = await whenOffered(() => outreachCampaignApi.dashboard(id, campaignId))
      return read.offered ? new Map(read.value.kits.map(kit => [kit.kitId, kit.used])) : null
    } catch { return null }
  }, [campaignId]), '')
  useErrorToast(plan.value ? plan.error : null, 'Couldn’t load the latest setup', () => void plan.refresh())
  // Coordinators edit; where the team isn't served or couldn't be read, Outreach decides.
  const canEdit = !(team.value?.offered && !team.value.value.you?.roles.includes('coordinator'))

  const [editing, setEditing] = useState<Section | null>(null)
  const [work, setWork] = useState<PlanDraft | null>(null)
  const [consentEdited, setConsentEdited] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)

  const saved = plan.value?.offered ? plan.value.plan : null
  // Inside another page, the setup is its own section with its heading.
  const frame = (children: ReactNode) => (embedded ? (
    <section aria-labelledby={`setup-${campaignId}-heading`} className="flex flex-col gap-4">
      <h2 id={`setup-${campaignId}-heading`} className="m-0 text-title-2 text-ink">Setup</h2>
      {children}
    </section>
  ) : children)

  if (plan.value && !plan.value.offered) {
    return embedded ? null : <EmptyState compact icon={ClipboardList} description={NOT_OFFERED} />
  }
  if (!plan.value || !saved) {
    if (starting && facilityId) {
      return <CampaignPlanWizard campaignId={campaignId} facilityId={facilityId}
        onDone={() => { setStarting(false); void plan.refresh() }} onCancel={() => setStarting(false)} />
    }
    return frame(
      <PageState loading={plan.loading} error={plan.error || null} hasData={plan.value !== null} what="the campaign’s setup" onRetry={() => void plan.refresh()}
        empty={{ icon: ClipboardList, title: 'No plan yet', description: 'Say what it screens for, where, and how the team works.',
          action: canEdit ? <Button variant="primary" onClick={() => setStarting(true)}>Set up the plan</Button> : undefined }}>
        {null}
      </PageState>
    )
  }

  const open = (section: Section) => {
    setEditing(section)
    setWork(draftFrom(saved))
    setConsentEdited(true)
    setError('')
  }
  const close = () => { if (!busy) { setEditing(null); setWork(null); setError('') } }

  async function save() {
    if (!editing || !work || !facilityId || busy) return
    if (editing === 'screening' && work.focuses.length === 0) { setError('Choose at least one thing it screens for.'); return }
    if (editing === 'sites' && !work.sites.some(site => site.name.trim())) { setError('A campaign needs at least one site with a name.'); return }
    setBusy(true)
    setError('')
    // The section's changes, on top of the plan as last read.
    const base = draftFrom(saved!)
    const merged: PlanDraft = { ...base }
    for (const field of SECTION_FIELDS[editing]) Object.assign(merged, { [field]: work[field] })
    try {
      await outreachCampaignApi.savePlan(facilityId, campaignId, planInput(normalise(merged, { consentEdited })), saved!.rowVersion)
      toast.success(`${SECTION_TITLE[editing]} saved.`)
      const from = editing
      setEditing(null)
      setWork(null)
      document.getElementById(`setup-${from}-edit`)?.focus()
      await plan.refresh()
    } catch (caught) {
      const conflict = isHidApiError(caught) && caught.code === 'VERSION_CONFLICT'
      // Said at the top, with Try again; what was typed stays in the drawer.
      toast.error({ title: 'Not saved', message: campaignFlowErrorText(caught, 'The change could not be saved. Try again.'),
        ...(conflict ? {} : { action: { label: 'Try again', onClick: () => void save() } }) })
      if (conflict) await plan.refresh()
    } finally {
      setBusy(false)
    }
  }

  const pkg = saved.package
  const editorProps = work ? { draft: work, onChange: setWork, consentEdited } : null

  let drawerBody: ReactNode = null
  if (editorProps && editing) {
    switch (editing) {
      case 'campaign': drawerBody = (
        <div className="flex flex-col gap-4">
          <PlanField id="setup-organisation" label="Organisation">
            <Input className="h-12 text-base sm:h-11 sm:text-sm" id="setup-organisation" data-autofocus value={editorProps.draft.organisationName} maxLength={200}
              onChange={event => setWork({ ...editorProps.draft, organisationName: event.target.value })} />
          </PlanField>
          <PlanField id="setup-target" label="People you aim to see">
            <Input className="h-12 text-base sm:h-11 sm:text-sm" inputMode="numeric" pattern="[0-9]*" maxLength={7} value={String(editorProps.draft.target || '')}
              onChange={event => setWork({ ...editorProps.draft, target: Number(event.target.value.replace(/\D/g, '')) || 0 })} {...fieldProps('setup-target', undefined)} />
          </PlanField>
        </div>
      ); break
      case 'screening': drawerBody = <div className="flex flex-col gap-6"><FocusEditor {...editorProps} /><PackageEditor {...editorProps} /></div>; break
      case 'sites': drawerBody = <SitesEditor {...editorProps} />; break
      case 'stations': drawerBody = <StationsEditor {...editorProps} />; break
      case 'partners': drawerBody = <PartnersEditor {...editorProps} />; break
      case 'consent': drawerBody = <ConsentEditor {...editorProps} onEdited={() => setConsentEdited(true)} />; break
      case 'kits': drawerBody = (
        <div className="flex flex-col gap-5">
          <KitForm draft={editorProps.draft} idPrefix="setup-kit" onAdd={kit => setWork({ ...editorProps.draft, kits: [...editorProps.draft.kits, kit] })} />
          <KitList draft={editorProps.draft} onRemove={kit => setWork({ ...editorProps.draft, kits: editorProps.draft.kits.filter(item => item.id !== kit.id) })} />
        </div>
      ); break
    }
  }

  const sites = saved.sites
  const kits = saved.kits.map(kit => (kit.used === undefined && usage.value?.has(kit.id) ? { ...kit, used: usage.value.get(kit.id) } : kit))
  const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
  const rows: ReadonlyArray<{ section: Section; summary: string }> = [
    { section: 'campaign', summary: [saved.organisationName || 'No organisation given', `aim ${saved.target} people`, focusesText(saved.focuses)].join(' · ') },
    { section: 'screening', summary: listInWords([count(pkg.vitals.length, 'vital sign'), `${count(pkg.tests.length, 'test')}${pkg.tests.some(test => test.sensitive) ? ` (${pkg.tests.filter(test => test.sensitive).length} private)` : ''}`,
      count(pkg.questions.length, 'question')]) },
    { section: 'sites', summary: sites.length ? `${count(sites.length, 'site')}: ${sites.map(site => site.name).join(', ')}` : 'None yet' },
    { section: 'stations', summary: saved.stationMode === 'one_person' ? 'One person does everything' : saved.stations.map(stationLabel).join(', ') },
    { section: 'partners', summary: saved.partners.length ? saved.partners.map(partner => partner.name).join(', ') : 'None yet' },
    { section: 'consent', summary: `${needsSeparateConsent(pkg) && saved.consent.hivText ? 'Campaign and HIV test consent' : 'Campaign consent'}, read in ${languagesText(saved.consent.languages)}` },
    { section: 'kits', summary: kits.length ? `${count(kits.length, 'lot')}, ${kits.reduce((sum, kit) => sum + kitLeft(kit), 0)} tests left` : 'None yet' },
  ]
  return frame(
    <div className="flex flex-col gap-4">
      {/* Each part of the plan in a line: Edit opens it in a drawer (one job a screen). */}
      <ul aria-label="Setup" className="m-0 list-none divide-y divide-line overflow-hidden rounded-2xl bg-surface p-0 shadow-[var(--shadow-card)] ring-1 ring-line">
        {rows.map(row => (
          <li key={row.section}>
            {canEdit ? (
              <button type="button" id={`setup-${row.section}-edit`} aria-label={`Edit ${SECTION_TITLE[row.section].toLowerCase()}`} onClick={() => open(row.section)}
                className={cx('flex min-h-14 w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-4 py-3 text-left text-ink hover:bg-subtle sm:px-5',
                  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--focus-ring-color)]')}>
                <SetupRow title={SECTION_TITLE[row.section]} summary={row.summary} />
                <span className="text-[14px] font-medium text-brand-ink">Edit</span><ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
              </button>
            ) : <div className="flex min-h-14 items-center gap-3 px-4 py-3 sm:px-5"><SetupRow title={SECTION_TITLE[row.section]} summary={row.summary} /></div>}
          </li>
        ))}
      </ul>
      <Drawer open={editing !== null} onClose={close} title={editing ? (editing === 'kits' ? 'Add kit stock' : `Edit ${SECTION_TITLE[editing].toLowerCase()}`) : ''}
        footer={<>
          <Button onClick={close} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button>
        </>}>
        <form className="flex flex-col gap-4" noValidate aria-label={editing ? SECTION_TITLE[editing] : undefined}
          onSubmit={event => { event.preventDefault(); void save() }} onKeyDown={enterMovesOn}>
          {drawerBody}
          {error ? <p id="setup-error" role="alert" className="m-0 text-sm font-medium text-danger-ink">{error}</p> : null}
        </form>
      </Drawer>
    </div>
  )
}

function SetupRow({ title, summary }: { readonly title: string; readonly summary: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="text-[15px] font-semibold text-ink">{title}</span>
      <span className="text-[13px] break-words text-ink-2">{summary}</span>
    </span>
  )
}
