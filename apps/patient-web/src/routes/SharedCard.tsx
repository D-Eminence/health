import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, Clock, Eye, FileText, FlaskConical, HeartPulse, Lock, Mail, NotebookPen, Pill, Stethoscope } from 'lucide-react'
import type { PatientRecords } from '../api'
import { Button, Card, CardHeader, EmptyState, cx, type Icon } from '../kasuwa/ui'
import { shareDurationLabel, shareLevelLabel } from '../shareRecords'
import { useSession } from '../session'
import { useDocumentTitle } from '../authSteps'
import { usePatientResource } from './usePatientResource'
import { useProfileSources } from './profileSources'
import { initialsOf, usePatientPhoto } from './ProfilePhoto'
import { CardFace, allergyItems, cardFacts } from './HealthIdCard'
import { ninVerifiedOf } from './NinVerificationCard'
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
 * code, emailed to the address the patient shared with, and the link's secret is never in the address path. Until Health
 * ID sends those codes, the page the link opens is dormant (SharedCardPage): it says plainly that this isn't available
 * yet, reads nothing and shows nothing.
 */

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
    case 'encounters': return listOf(records, key).map(e => ({ id: e.id, title: words(e.encounterType), meta: [words(e.status), day(e.startedAt)].filter(Boolean).join(' · ') }))
    case 'notes': return listOf(records, key).map(n => ({ id: n.id, title: n.title || words(n.noteType), meta: day(n.signedAt), detail: n.content }))
    case 'documents': return listOf(records, key).map(d => ({ id: d.id, title: d.fileName, meta: [d.mediaType, day(d.createdAt)].filter(Boolean).join(' · ') }))
    default: return []
  }
}

/** The page the email's link opens: the card, who shared it and for how long, then the records, read-only. */
export function SharedCardView({ card, sharedBy, recipient, level, expiresAt, records, banner }: {
  card: CardData; sharedBy: string; recipient: string; level: string; expiresAt: string | null; records: PatientRecords | null; banner?: ReactNode
}) {
  const sections = records ? SECTIONS.map(s => ({ ...s, rows: rowsOf(records, s.key) })).filter(s => s.rows.length > 0) : []
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
          {[['Shared by', sharedBy, Mail], ['Access', shareLevelLabel(level) ?? words(level), Eye], ['Until', expiresAt ? until(expiresAt) : 'Until ended', Clock], ['Every view', 'Recorded', Lock]].map(([label, value, I]) => {
            const Ico = I as Icon
            return <div key={label as string} className="bg-surface px-4 py-3"><dt className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-ink-3 uppercase"><Ico className="size-3.5" aria-hidden />{label as string}</dt>
              <dd className="m-0 mt-1 truncate text-sm font-medium text-ink">{value as string}</dd></div>
          })}
        </dl>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <h1 className="m-0 text-title-1 text-ink">{card.name}’s records</h1>
        {!records ? <p className="m-0 text-sm text-ink-3">Loading records…</p>
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
 * /card and /card/:token: the page a shared card's link will open. Dormant until Health ID sends the one-time code that
 * opens a card (the owner's decision 25; BACKEND-NEEDS.md §2): it says plainly that this isn't available yet, and reads
 * nothing, sends nothing (not even what is in its address) and shows no one's details.
 */
export function SharedCardPage() {
  useDocumentTitle('Not available yet · Health ID')
  return <main className="flex min-h-svh items-center justify-center bg-canvas p-4"><div className="w-full max-w-md">
    <EmptyState icon={Lock} titleAs="h1" title="This isn’t available yet"
      description="Opening a shared Health ID card from a link isn’t available yet. No health information is shown here."
      action={<Button href="https://healthid.ng">About Health ID</Button>} /></div></main>
}

/** The patient's own card as the email and the provider's page will show it. */
export function useMyCard(): CardData | null {
  const { profile, health } = useProfileSources()
  const shown = profile.data && !profile.error ? profile.data : null
  const photo = usePatientPhoto(shown?.hasPhoto === true)
  const saved = health.error ? null : health.data
  return useMemo(() => shown ? { name: shown.fullName, hid: shown.hid, verified: typeof shown.ninVerified === 'boolean' ? ninVerifiedOf(shown) : null,
    bloodGroup: saved?.bloodGroup ?? null, genotype: saved?.genotype ?? null, allergies: saved?.allergies ?? null, photoUrl: photo.url } : null, [shown, saved, photo.url])
}

/** /card/preview: the patient sees exactly what a provider sees when they open the card, with their own records. */
export function SharedCardPreview() {
  const { api } = useSession()
  const card = useMyCard()
  const records = usePatientResource(api.records)
  if (!card) return <div className="p-6 text-sm text-ink-3" role="status">Loading your card…</div>
  return <SharedCardView card={card} sharedBy={card.name} recipient="the provider you share with" level="view_only" expiresAt={null}
    records={records.data && !records.error ? records.data : null}
    banner={<div className="border-b border-brand-line bg-brand-soft"><div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px] text-brand-ink">
      <span><strong className="font-semibold">Preview.</strong> This is what a provider sees when they open the card you share.</span>
      <Link to="/access" className={cx('font-semibold text-brand-ink no-underline hover:underline')}>Back to Access & sharing</Link></div></div>} />
}
