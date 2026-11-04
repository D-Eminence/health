import { useMemo, type ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { ClipboardList, Clock, Eye, FileText, FlaskConical, HeartPulse, Lock, Mail, NotebookPen, Pill, Stethoscope } from 'lucide-react'
import type { PatientRecords } from '../api'
import { Card, CardHeader, EmptyState, buttonClass, type Icon } from '../kasuwa/ui'
import { shareDurationLabel, shareLevelLabel } from '../shareRecords'
import { useSession } from '../session'
import { useDocumentTitle } from '../authSteps'
import { usePatientResource } from './usePatientResource'
import { useProfileSources } from './profileSources'
import { LoadProblem } from './profileParts'
import { foundTarget, useRetryOnce } from './actionFocus'
import { ItemName } from '../ItemName'
import { publicSiteHref } from '../productSites'
import { initialsOf, usePatientPhoto } from './ProfilePhoto'
import { CardFace, allergyItems, cardFacts } from './HealthIdCard'
import { ninVerifiedOf } from './NinVerificationCard'
import { fileTypeLabel, visitClassLabel, visitStatusLabel } from '../plainLabels'
import logoSrc from '../../../public-web/public/brand/logo.png'

/**
 * Sharing by card (the owner's decision of 2026-10-30): when a patient shares, what lands in the provider's inbox is the
 * patient's Health ID card, in full, and the link under it opens the records the share allows, with no sign-in. What
 * keeps that safe is around the link, not in front of it: it works only while the share lasts and stops the moment the
 * patient ends it; every open is recorded in the patient's activity with the address it was sent to; the records are
 * read-only and carry that address.
 *
 * Three views of it here: the email as the provider receives it (shown to the patient before they share), the page the
 * link opens (/card/:token, proposed: BACKEND-NEEDS.md §2), and the patient's own preview of that page (/card/preview).
 *
 * The owner's decisions of 2026-11-01 (decision 25) replace the open link: the link opens the card only after a one-time
 * code, emailed to the address the patient shared with, and the link's secret is never in the address path. Health ID
 * does not send those codes, so the page the link opens is dormant (SharedCardPage): it says plainly the link can't be
 * opened, reads nothing and shows nothing. The patient's preview of the provider's page is off with it (CARD_LINK_OPENS):
 * it would show a page no provider can open (the launch audit, HCS-03).
 */

/**
 * Whether a shared card's link opens the card: off until Health ID sends the one-time code that opens it (decision 25).
 * While it is off, /card/preview opens Access & sharing in place of a preview of a page that does not exist.
 */
export const CARD_LINK_OPENS = false

export interface CardData { name: string; hid: string; verified: boolean | null; bloodGroup: string | null; genotype: string | null; allergies: string | null; photoUrl: string | null }

function Face({ card, still }: { card: CardData; still?: boolean }) {
  const face = card.photoUrl ? <img src={card.photoUrl} alt="" className="size-full object-cover" />
    : <span className="text-[5.4cqw] font-light tracking-[.12em] text-white/85" aria-hidden="true">{initialsOf({ fullName: card.name })}</span>
  return <CardFace name={card.name} hid={card.hid} verified={card.verified} facts={cardFacts(card.bloodGroup, card.genotype)}
    allergies={allergyItems(card.allergies)} face={face} label="Shared with you" still={still} />
}

const until = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))

/** The email a provider receives, drawn as it will look in their inbox. Its design is also handed over as a template. */
export function ShareEmailPreview({ card, to, level, duration, expiresAt }: { card: CardData; to: string; level: string; duration: string; expiresAt?: string | null }) {
  const first = card.name.split(' ')[0] ?? card.name
  return <figure className="m-0 overflow-hidden rounded-2xl bg-surface ring-1 ring-line" aria-label={`Preview of the email ${to} receives`}>
    <div className="flex flex-col gap-0.5 border-b border-line bg-subtle px-4 py-3 text-[12px] text-ink-3">
      <p className="m-0"><span className="text-ink-2">From</span> Health ID · <span className="text-ink-2">To</span> {to}</p>
      <p className="m-0 text-[13px] font-semibold text-ink">{card.name} shared their Health ID card with you</p>
    </div>
    <div className="flex flex-col items-center gap-4 bg-[#f5f7fa] px-4 py-6">
      <img src={logoSrc} alt="Health ID" className="h-6 w-auto" />
      <div className="w-full max-w-[340px]"><Face card={card} still /></div>
      <p className="m-0 max-w-[340px] text-center text-[13px] text-ink-2">{first} shared their records with you: <strong className="font-semibold text-ink">{shareLevelLabel(level) ?? level}</strong>,
        {expiresAt ? ` until ${until(expiresAt)}` : ` ${(shareDurationLabel(duration) ?? duration).toLowerCase()}`}.</p>
      <span className="inline-flex h-10 items-center rounded-[10px] bg-brand-fill px-5 text-sm font-semibold text-white">Open records</span>
      <p className="m-0 max-w-[340px] text-center text-[11px] text-ink-3">This link is for {to} only. Every time it’s opened, {first} is told. It stops working when the share ends.</p>
    </div>
  </figure>
}

const SECTIONS: ReadonlyArray<{ key: keyof Pick<PatientRecords, 'encounters' | 'notes' | 'diagnoses' | 'prescriptions' | 'labRequests' | 'vitals' | 'documents'>; title: string; icon: Icon }> = [
  { key: 'diagnoses', title: 'Diagnoses', icon: ClipboardList },
  { key: 'prescriptions', title: 'Medicines', icon: Pill },
  { key: 'labRequests', title: 'Lab tests', icon: FlaskConical },
  { key: 'vitals', title: 'Vitals', icon: HeartPulse },
  { key: 'encounters', title: 'Visits', icon: Stethoscope },
  { key: 'notes', title: 'Clinical notes', icon: NotebookPen },
  { key: 'documents', title: 'Documents', icon: FileText },
]

const words = (text: string | null | undefined) => text ? text.replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase()) : ''
const day = (iso: string | null | undefined) => iso ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : ''

type SectionKey = (typeof SECTIONS)[number]['key']

/**
 * One section's records, or none. Production's records answer (Novu, patient-records.service.ts) sends only visits and
 * signed notes, with the other sections left out rather than empty, so a missing or malformed section is read as empty.
 */
function listOf<K extends SectionKey>(records: PatientRecords, key: K): PatientRecords[K] {
  const value: unknown = records[key]
  return (Array.isArray(value) ? value : []) as PatientRecords[K]
}

/** One row per record, read-only: what it is, its detail, and when. */
function rowsOf(records: PatientRecords, key: SectionKey): Array<{ id: string; title: string; meta: string; detail?: string | null }> {
  switch (key) {
    case 'diagnoses': return listOf(records, key).map(d => ({ id: d.id, title: d.display, meta: [words(d.clinicalStatus), day(d.onsetAt)].filter(Boolean).join(' · '), detail: d.notes }))
    case 'prescriptions': return listOf(records, key).map(p => ({ id: p.id, title: p.medicationDisplay, meta: [p.doseQuantity != null ? `${p.doseQuantity} ${p.doseUnit ?? ''}`.trim() : '', p.frequency, words(p.status)].filter(Boolean).join(' · '), detail: p.instructions }))
    case 'labRequests': return listOf(records, key).map(l => ({ id: l.id, title: l.testDisplay, meta: [words(l.status), day(l.createdAt)].filter(Boolean).join(' · '), detail: l.clinicalInformation }))
    case 'vitals': return listOf(records, key).map(v => ({ id: v.id, title: [v.systolicMmhg != null ? `BP ${v.systolicMmhg}/${v.diastolicMmhg}` : '', v.temperatureC != null ? `${v.temperatureC}°C` : '', v.pulseBpm != null ? `Pulse ${v.pulseBpm}` : '', v.oxygenSaturationPercent != null ? `SpO₂ ${v.oxygenSaturationPercent}%` : ''].filter(Boolean).join(' · ') || 'Vitals', meta: day(v.recordedAt) }))
    case 'encounters': return listOf(records, key).map(e => ({ id: e.id, title: visitClassLabel(e.encounterType), meta: [visitStatusLabel(e.status), day(e.startedAt)].filter(Boolean).join(' · ') }))
    case 'notes': return listOf(records, key).map(n => ({ id: n.id, title: n.title || words(n.noteType), meta: day(n.signedAt), detail: n.content }))
    case 'documents': return listOf(records, key).map(d => ({ id: d.id, title: d.fileName, meta: [fileTypeLabel(d.mediaType), day(d.createdAt)].filter(Boolean).join(' · ') }))
    default: return []
  }
}

/** What a share allows, and until when; `expiresAt` null for one that lasts until it is ended. */
export interface ShareTerms { level: string; expiresAt: string | null }

/**
 * The page the email's link opens: the card, who shared it and for how long, then the records, read-only. Without
 * `share` it says neither what they can do nor until when, rather than make either up. `recordsProblem` stands where the
 * records go when they could not be read.
 */
export function SharedCardView({ card, sharedBy, recipient, share, records, recordsProblem, banner }: {
  card: CardData; sharedBy: string; recipient: string; share: ShareTerms | null; records: PatientRecords | null; recordsProblem?: ReactNode
  banner?: ReactNode
}) {
  const sections = records ? SECTIONS.map(s => ({ ...s, rows: rowsOf(records, s.key) })).filter(s => s.rows.length > 0) : []
  const facts: Array<[string, string, Icon]> = [['Shared by', sharedBy, Mail],
    ...(share ? [['Access', shareLevelLabel(share.level) ?? words(share.level), Eye], ['Until', share.expiresAt ? until(share.expiresAt) : 'Until ended', Clock]] as Array<[string, string, Icon]> : []),
    ['Every view', 'Recorded', Lock]]
  return <div className="min-h-svh bg-canvas">
    <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
        <img src={logoSrc} alt="Health ID" className="h-6 w-auto" />
        <span className="inline-flex items-center gap-1.5 truncate text-[12px] text-ink-3"><Mail className="size-3.5 shrink-0" aria-hidden />Opened by {recipient}</span>
      </div>
    </header>
    {banner}
    <main className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6 lg:grid-cols-[380px_minmax(0,1fr)] lg:items-start">
      <div className="mx-auto flex w-full max-w-[480px] min-w-0 flex-col gap-4 lg:sticky lg:top-20 lg:max-w-none">
        <Face card={card} />
        <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line ring-1 ring-line">
          {facts.map(([label, value, Ico]) =>
            <div key={label} className="bg-surface px-4 py-3"><dt className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-ink-3 uppercase"><Ico className="size-3.5" aria-hidden />{label}</dt>
              <dd className="m-0 mt-1 truncate text-sm font-medium text-ink">{value}</dd></div>)}
        </dl>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <h1 id="shared-card-records" className="m-0 text-title-1 text-ink outline-none">{card.name}’s records</h1>
        {!records ? recordsProblem ?? <p role="status" className="m-0 text-sm text-ink-3">Loading records…</p>
          : sections.length === 0 ? <EmptyState icon={FileText} title="No records yet" description="Nothing has been recorded for this patient on Health ID yet." />
          : sections.map(s => <Card key={s.key}>
            <CardHeader as="h2" title={s.title} icon={s.icon} iconTone="brand" description={`${s.rows.length}`} />
            <ul className="m-0 list-none divide-y divide-line p-0">{s.rows.map(r => <li key={r.id} className="px-5 py-3.5">
              <p className="m-0 text-sm font-medium text-ink">{r.title}</p>
              {r.meta && <p className="m-0 mt-0.5 text-[13px] text-ink-3">{r.meta}</p>}
              {r.detail && <p className="m-0 mt-1.5 text-[13px] leading-relaxed whitespace-pre-wrap text-ink-2">{r.detail}</p>}
            </li>)}</ul>
          </Card>)}
        {/* The address the link was sent to, on the page itself: a printout or screenshot says whose it was. */}
        <p className="m-0 flex items-center gap-1.5 text-[12px] text-ink-3"><Lock className="size-3.5" aria-hidden />Read-only. Opened by {recipient}. {card.name.split(' ')[0]} can see each time this page is opened.</p>
      </div>
    </main>
  </div>
}

/**
 * /card and /card/:token: the page a shared card's link opens. Dormant while Health ID does not send the one-time code
 * that opens a card (the owner's decision 25; BACKEND-NEEDS.md §2): it says plainly the link can't be opened, with
 * nothing promised for later, and reads nothing, sends nothing (not even what is in its address) and shows no one's
 * details. Its one link is the public site's page for patients, on this deployment's own public site (HCS-19), in this tab.
 */
export function SharedCardPage() {
  useDocumentTitle('Link can’t be opened · Health ID')
  return <main className="flex min-h-svh items-center justify-center bg-canvas p-4"><div className="w-full max-w-md">
    <EmptyState icon={Lock} titleAs="h1" title="This link can’t be opened"
      description="Health ID doesn’t open records from a link like this, so nothing is shown here. If a patient shared their records with you, ask them to show you their Health ID card."
      action={<a href={`${publicSiteHref()}patients`} className={buttonClass()}>About Health ID</a>} /></div></main>
}

/** The patient's own card as the email and the provider's page will show it. */
export function useMyCard(): CardData | null {
  return useCardOf(useProfileSources())
}

/** The card from the profile sources a page already reads, so it asks for nothing twice. */
function useCardOf({ profile, health }: ReturnType<typeof useProfileSources>): CardData | null {
  const shown = profile.data && !profile.error ? profile.data : null
  const photo = usePatientPhoto(shown?.hasPhoto === true)
  const saved = health.error ? null : health.data
  return useMemo(() => shown ? { name: shown.fullName, hid: shown.hid, verified: typeof shown.ninVerified === 'boolean' ? ninVerifiedOf(shown) : null,
    bloodGroup: saved?.bloodGroup ?? null, genotype: saved?.genotype ?? null, allergies: saved?.allergies ?? null, photoUrl: photo.url } : null, [shown, saved, photo.url])
}

/** /card/preview: the patient's preview of the provider's page, off while the link cannot open it (CARD_LINK_OPENS). */
export function SharedCardPreview() {
  return CARD_LINK_OPENS ? <CardPreview /> : <Navigate to="/access" replace />
}

/** The share just made, as the done step's link passes it in the navigation state, or null when it passes none. */
function shareOf(state: unknown): ShareTerms | null {
  if (!state || typeof state !== 'object') return null
  const { level, expiresAt } = state as { level?: unknown; expiresAt?: unknown }
  if (typeof level !== 'string' || !level) return null
  return { level, expiresAt: typeof expiresAt === 'string' && !Number.isNaN(Date.parse(expiresAt)) ? expiresAt : null }
}

const BACK = <Link to="/access" className="font-semibold text-brand-ink no-underline hover:underline">Back to Access & sharing</Link>
const recordsHeading = foundTarget(() => document.getElementById('shared-card-records'))

/**
 * The patient sees what a provider sees when they open the card, with their own records and the share just made (HCS-03).
 * A read that fails says so, with Try again and the way back (HCS-18); once it loads, focus goes to the records' heading.
 */
export function CardPreview() {
  const { api } = useSession()
  useDocumentTitle('Preview of your card · Health ID')
  const sources = useProfileSources()
  const card = useCardOf(sources)
  const records = usePatientResource(api.records)
  const share = shareOf(useLocation().state)
  const profileRetry = useRetryOnce(recordsHeading)
  const recordsRetry = useRetryOnce(recordsHeading)
  const { profile } = sources

  if (profile.error) return <main className="flex min-h-svh items-center justify-center bg-canvas p-4"><div className="flex w-full max-w-md flex-col gap-4">
    <h1 className="m-0 text-title-2 text-ink">Preview of your card</h1>
    <LoadProblem what="your card" error={profile.error} buttonRef={profileRetry.button} onRetry={() => profileRetry.retry(profile.reload)}
      name={<ItemName>loading your card</ItemName>} />
    <p className="m-0 text-[13px]">{BACK}</p></div></main>
  if (!card) return <main className="p-6 text-sm text-ink-3"><p role="status" className="m-0">Loading your card…</p></main>
  return <SharedCardView card={card} sharedBy={card.name} recipient="the provider you share with" share={share}
    records={records.data && !records.error ? records.data : null}
    recordsProblem={records.error && !records.loading ? <LoadProblem what="your records" error={records.error} buttonRef={recordsRetry.button}
      onRetry={() => recordsRetry.retry(records.reload)} name={<ItemName>loading your records</ItemName>} /> : undefined}
    banner={<div className="border-b border-brand-line bg-brand-soft"><div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px] text-brand-ink">
      <span><strong className="font-semibold">Preview.</strong> This is what a provider sees when they open the card you share.</span>
      {BACK}</div></div>} />
}
