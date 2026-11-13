import { useCallback, useState, type ReactNode } from 'react'
import { isHidApiError } from '@hid/http'
import { ClipboardList, Pencil, Plus, ShieldAlert } from 'lucide-react'
import { PageState } from '../../../../kasuwa/parts'
import { Drawer } from '../../../../kasuwa/interactive'
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Input } from '../../../../kasuwa/ui'
import { useToast } from '../../../../kasuwa/toast'
import { useDeptAccess } from '../../parts/access'
import { useFacilityRead } from '../../parts/useFacilityRead'
import { campaignFlowErrorText, NOT_OFFERED, outreachCampaignApi, whenOffered } from '../campaignApi'
import { SCREENING_FOCUSES, stationLabel, type OutreachPlan } from '../campaignTypes'
import { CampaignPlanWizard } from './CampaignPlanWizard'
import {
  ConsentEditor, enterMovesOn, fieldProps, FocusEditor, KitForm, KitList, PackageEditor, PartnersEditor, PlanField, SitesEditor, StationsEditor,
} from './planParts'
import { draftFrom, focusesText, languagesText, listInWords, needsSeparateConsent, normalise, placeText, planInput, type PlanDraft } from './planDraft'

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
      setEditing(null)
      setWork(null)
      await plan.refresh()
    } catch (caught) {
      setError(campaignFlowErrorText(caught, 'The change could not be saved. Try again.'))
      if (isHidApiError(caught) && caught.code === 'VERSION_CONFLICT') await plan.refresh()
    } finally {
      setBusy(false)
    }
  }

  const edit = (section: Section) => canEdit
    ? <Button size="sm" icon={Pencil} aria-label={`Edit ${SECTION_TITLE[section].toLowerCase()}`} onClick={() => open(section)}>Edit</Button> : null
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
  return frame(
    <div className="flex flex-col gap-4">
      {plan.error ? <Alert intent="error" title="Couldn’t load the latest setup" action={<Button size="sm" onClick={() => void plan.refresh()}>Try again</Button>}>{plan.error}</Alert> : null}
      <div className="grid gap-4 @3xl:grid-cols-2">
        <SetupCard title="Campaign" action={edit('campaign')}>
          <Facts items={[['Organisation', saved.organisationName || 'Not given'], ['Aim', `${saved.target} people`], ['For', focusesText(saved.focuses)]]} />
        </SetupCard>
        <SetupCard title="Sites" action={edit('sites')}>
          <ul className="m-0 list-none divide-y divide-line p-0">
            {sites.map(site => (
              <li key={site.id} className="py-2.5 first:pt-0 last:pb-0">
                <p className="m-0 text-sm font-medium text-ink">{site.name}</p>
                <p className="m-0 text-[13px] text-ink-3">{[placeText(site), site.address].filter(Boolean).join(' · ') || 'No address yet'}</p>
              </li>
            ))}
          </ul>
        </SetupCard>
        <SetupCard title="Screening" action={edit('screening')}>
          {pkg.vitals.length ? <Facts items={[['Vital signs', pkg.vitals.map(vital => `${vital.name} (${vital.unit})`).join('; ')]]} /> : null}
          {pkg.tests.length ? (
            <div>
              <p className="m-0 text-[13px] font-medium text-ink-3">Tests</p>
              <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
                {pkg.tests.map(test => (
                  <li key={test.id} className="flex flex-wrap items-center gap-2 text-sm text-ink">{test.name}
                    {test.sensitive ? <Badge size="sm" tone="warn" icon={ShieldAlert}>Sensitive</Badge> : null}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <Facts items={[['Questions', `${pkg.questions.length} question${pkg.questions.length === 1 ? '' : 's'}`]]} />
        </SetupCard>
        <SetupCard title="Stations" action={edit('stations')}>
          <p className="m-0 text-sm text-ink">{saved.stationMode === 'one_person' ? 'One person does everything' : saved.stations.map(stationLabel).join(', ')}</p>
        </SetupCard>
        <SetupCard title="Referral partners" action={edit('partners')}>
          {saved.partners.length ? (
            <ul className="m-0 list-none divide-y divide-line p-0">
              {saved.partners.map(partner => (
                <li key={partner.id} className="py-2.5 first:pt-0 last:pb-0">
                  <p className="m-0 text-sm font-medium text-ink">{partner.name}</p>
                  <p className="m-0 text-[13px] text-ink-3">{[partner.phone, partner.address].filter(Boolean).join(' · ')}</p>
                  {partner.treats.length ? <p className="m-0 text-[13px] text-ink-3">Treats {listInWords(SCREENING_FOCUSES.filter(item => partner.treats.includes(item.value)).map(item => item.label))}</p> : null}
                </li>
              ))}
            </ul>
          ) : <p className="m-0 text-sm text-ink-2">None yet.</p>}
        </SetupCard>
        <SetupCard title="Consent" action={edit('consent')}>
          <p className="m-0 text-sm whitespace-pre-wrap text-ink">{saved.consent.text}</p>
          {needsSeparateConsent(pkg) && saved.consent.hivText ? (
            <div><p className="m-0 text-[13px] font-medium text-ink-3">HIV test consent</p><p className="m-0 mt-0.5 text-sm whitespace-pre-wrap text-ink">{saved.consent.hivText}</p></div>
          ) : null}
          <Facts items={[['Read in', languagesText(saved.consent.languages)]]} />
        </SetupCard>
      </div>
      <SetupCard title="Kits" action={canEdit ? <Button size="sm" icon={Plus} onClick={() => open('kits')}>Add stock</Button> : null}>
        <KitList draft={{ ...draftFrom(saved), kits: saved.kits.map(kit => (kit.used === undefined && usage.value?.has(kit.id) ? { ...kit, used: usage.value.get(kit.id) } : kit)) }} />
      </SetupCard>
      <Drawer open={editing !== null} onClose={close} title={editing ? (editing === 'kits' ? 'Add kit stock' : `Edit ${SECTION_TITLE[editing].toLowerCase()}`) : ''}
        footer={<>
          <Button onClick={close} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button>
        </>}>
        <form className="flex flex-col gap-4" noValidate aria-label={editing ? SECTION_TITLE[editing] : undefined}
          onSubmit={event => { event.preventDefault(); void save() }} onKeyDown={enterMovesOn}>
          {drawerBody}
          {error ? <Alert intent="error" title={error} /> : null}
        </form>
      </Drawer>
    </div>
  )
}

function SetupCard({ title, action, children }: { readonly title: string; readonly action?: ReactNode; readonly children: ReactNode }) {
  return (
    <Card>
      <CardHeader as="h3" title={title} actions={action ?? undefined} />
      <div className="flex flex-col gap-3 px-5 py-4">{children}</div>
    </Card>
  )
}

function Facts({ items }: { readonly items: ReadonlyArray<readonly [string, ReactNode]> }) {
  return (
    <dl className="m-0 flex flex-col gap-2">
      {items.map(([label, value]) => (
        <div key={label}><dt className="text-[13px] font-medium text-ink-3">{label}</dt><dd className="m-0 mt-0.5 text-sm break-words text-ink">{value}</dd></div>
      ))}
    </dl>
  )
}
