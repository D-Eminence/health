'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { HEALTH_ID_PREFIX } from '@hid/contracts'
import { cx, Section, Wrap } from '@hid/ui'
import { HealthIcon, type HealthIconName } from '@/components/shared/HealthIcon'

const PATIENT = 'Aisha Bello'
const HEALTH_ID = 'HID-7KQ2M9'
type StatusTone = 'blue' | 'success' | 'muted'

function useSectionReveal() {
  const ref = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false)
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(media.matches)
    if (media.matches || !('IntersectionObserver' in window)) {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return
      setVisible(true)
      observer.disconnect()
    }, { threshold: 0.42 })
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  return { ref, visible, reduced }
}

function Status({ children, tone = 'blue' }: { children: string; tone?: StatusTone }) {
  return <span className={cx('ehr-status', tone === 'success' && 'ehr-status-success', tone === 'muted' && 'ehr-status-muted')}><span aria-hidden="true" />{children}</span>
}

function Icon({ name }: { name: 'search' | 'person' | 'clipboard' | 'pill' | 'flask' | 'bed' | 'shield' | 'check' }) {
  const names: Record<typeof name, HealthIconName> = {
    search: 'search', person: 'person', clipboard: 'file', pill: 'medicine',
    flask: 'laboratory', bed: 'bed', shield: 'shield', check: 'check',
  }
  return <HealthIcon name={names[name]} size={16} />
}

const FEATURE_ICONS: readonly HealthIconName[] = ['people', 'file', 'medicine', 'laboratory', 'file', 'shield']

function DashboardSnippet({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  const active = Number(number) - 1
  return <div className="ehr-dashboard-snippet">
    <div className="console-toolbar"><span>Clinical workspace <span>/</span> <b>{title}</b></span><span className="ehr-snippet-preview-label">Preview</span></div>
    <div className="ehr-snippet-workspace">
      <div className="ehr-snippet-rail" aria-hidden="true">
        <span className="ehr-snippet-brand"><HealthIcon name="hospital" size={20} /></span>
        {FEATURE_ICONS.map((icon, index) => <span key={icon} data-active={index === active}><HealthIcon name={icon} size={17} /></span>)}
        <span className="ehr-snippet-rail-lock"><HealthIcon name="shield" size={17} /></span>
      </div>
      <div className="ehr-snippet-content">{children}</div>
    </div>
  </div>
}

function WorkflowCard({ number, title, copy, delay, className, children }: { number: string; title: string; copy: string; delay: number; className: string; children: (state: { active: boolean; reduced: boolean }) => ReactNode }) {
  const { ref, visible, reduced } = useSectionReveal()
  return <article ref={ref} data-visible={visible} style={{ animationDelay: `${delay}ms` }} className={cx('ehr-card bento-card overflow-hidden rounded-(--radius-panel) border border-line bg-white p-6 sm:p-8', className)}>
    <div className="max-w-[44ch]"><p className="font-mono text-[12px] font-semibold tracking-[0.1em] text-brand">{number}</p><h3 className="mt-3 font-display text-[clamp(1.7rem,2.6vw,2.2rem)] leading-[1.08] tracking-[-0.03em] text-ink">{title}</h3><p className="mt-3 text-[15px]/relaxed text-muted">{copy}</p></div>
    <DashboardSnippet number={number} title={title}>{children({ active: visible, reduced })}</DashboardSnippet>
  </article>
}

function Registration({ reduced, active }: { reduced: boolean; active: boolean }) {
  const [searched, setSearched] = useState(false)
  // The lookup starts at HID-, as every Health ID field does; only what follows it is typed.
  const [typed, setTyped] = useState(HEALTH_ID_PREFIX)
  const started = typed.length > HEALTH_ID_PREFIX.length
  useEffect(() => {
    if (!active) return
    if (reduced) { setTyped(HEALTH_ID); setSearched(true); return }
    let index = HEALTH_ID_PREFIX.length
    const timer = window.setInterval(() => { index += 1; setTyped(HEALTH_ID.slice(0, index)); if (index === HEALTH_ID.length) window.clearInterval(timer) }, 70)
    const result = window.setTimeout(() => setSearched(true), 950)
    return () => { window.clearInterval(timer); window.clearTimeout(result) }
  }, [active, reduced])
  const search = () => { setTyped(HEALTH_ID); setSearched(true) }
  return <div className="ehr-lookup mt-8 rounded-(--radius-card) border border-line bg-surface-tint p-4 sm:p-5">
    <p className="font-mono text-[11px] font-semibold tracking-[0.1em] text-faint">PATIENT LOOKUP</p>
    <div className="mt-3 flex gap-2"><label className="sr-only" htmlFor="ehr-health-id">Health ID</label><div className="flex min-h-11 flex-1 items-center gap-2 rounded-xl border border-line bg-white px-3 text-[13px] text-ink"><Icon name="search" /><input id="ehr-health-id" readOnly value={typed} placeholder="Health ID" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted" /><span aria-hidden="true" className={cx('ehr-caret', started && 'hidden')}>|</span></div><button type="button" onClick={search} className={cx('ehr-primary-button min-h-11 rounded-xl px-4 text-[13px] font-semibold', started ? 'bg-brand text-white' : 'bg-brand-tint text-brand')}><span className="sm:hidden">Go</span><span className="hidden sm:inline">Search</span></button></div>
    <div aria-hidden="true" className={cx('ehr-progress mt-2', searched && 'is-complete')} />
    {searched ? <div className="ehr-lookup-result mt-4 rounded-xl border border-brand/15 bg-white p-4"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-full bg-brand-tint text-brand"><Icon name="person" /></span><div><p className="text-[11px] font-semibold tracking-[0.08em] text-brand">PATIENT FOUND</p><p className="mt-1 text-[14px] font-semibold text-ink">{PATIENT}</p><p className="text-[12px] text-muted">{HEALTH_ID} · 32 years · Female</p></div></div><Status tone="success">Verified</Status></div><dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center"><div><dt>Previous visits</dt><dd>4</dd></div><div><dt>Known allergies</dt><dd>2</dd></div><div><dt>Last visit</dt><dd>12 Mar 2024</dd></div></dl><button type="button" className="mt-4 text-[13px] font-semibold text-brand hover:text-brand-dark">Open patient <span aria-hidden="true">→</span></button></div> : null}
  </div>
}

function Consultation({ reduced, active }: { reduced: boolean; active: boolean }) {
  const [step, setStep] = useState('Patient')
  const [saved, setSaved] = useState(false)
  useEffect(() => { if (!active) return; if (reduced) { setStep('Assessment'); return }; const timer = window.setTimeout(() => setStep('Assessment'), 850); return () => window.clearTimeout(timer) }, [active, reduced])
  const preview = (next: string) => { setStep(next); setSaved(false) }
  return <div className="mt-8 rounded-(--radius-card) border border-line bg-surface-tint p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><p className="font-mono text-[11px] font-semibold tracking-[0.1em] text-faint">NEW CONSULTATION</p><Status tone="success">Verified</Status></div><div className="mt-4 flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Consultation stages">{['Patient', 'Assessment', 'Diagnosis', 'Plan'].map((item, index) => <button key={item} type="button" role="tab" aria-selected={step === item} onClick={() => preview(item)} className={cx('ehr-step min-h-9 shrink-0 rounded-lg px-3 text-[12px] font-semibold', step === item ? 'bg-brand text-white' : 'text-muted hover:bg-white hover:text-ink')}><span className="mr-1 opacity-70">0{index + 1}</span>{item}</button>)}</div><div className="mt-4 rounded-xl border border-line bg-white p-4"><p className="text-[13px] font-semibold text-ink">{PATIENT} <span className="ml-1 font-normal text-muted">{HEALTH_ID}</span></p>{step === 'Assessment' ? <><label className="mt-4 block text-[11px] font-semibold tracking-[0.07em] text-faint" htmlFor="ehr-complaint">PRESENTING COMPLAINT</label><div id="ehr-complaint" className="mt-2 rounded-lg border border-brand/40 bg-brand-tint/35 px-3 py-2.5 text-[13px] text-ink">Headache and dizziness…</div><button type="button" className="mt-3 text-[13px] font-medium text-brand">+ Add examination findings</button></> : <p className="mt-4 text-[13px] text-muted">{step === 'Patient' ? 'Patient identity is confirmed before the encounter begins.' : step === 'Diagnosis' ? 'Diagnoses remain attached to this encounter.' : 'Treatment plans are saved with the same patient record.'}</p>}</div><button type="button" onClick={() => { setSaved(true); setStep('Diagnosis') }} className="ehr-primary-button mt-4 min-h-11 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white">{saved ? '✓ Assessment saved' : 'Save and continue'}</button></div>
}

function Prescriptions() {
  const [state, setState] = useState<'ready' | 'sending' | 'sent'>('ready')
  const send = () => {
    if (state === 'sending') return
    setState('sending')
    window.setTimeout(() => setState('sent'), 650)
  }
  const sent = state === 'sent'
  return <div className="mt-8"><div className="rounded-(--radius-card) border border-line bg-surface-tint p-4"><p className="font-mono text-[11px] font-semibold tracking-[0.1em] text-faint">NEW PRESCRIPTION</p><p className="mt-3 text-[13px] font-semibold text-ink">{PATIENT} <span className="font-normal text-muted">{HEALTH_ID}</span></p><div className="mt-4 rounded-xl border border-line bg-white p-3"><p className="text-[11px] font-medium text-muted">Search medication...</p><div className="mt-3 flex items-center justify-between"><span><b className="block text-[13px] text-ink">Amoxicillin</b><span className="text-[12px] text-muted">500mg</span></span><span className="text-[12px] text-muted">1 capsule · 3× daily · 7 days</span></div></div><p className="mt-3 text-[12px] text-muted">Quantity <b className="ml-1 text-ink">21</b></p><button type="button" onClick={send} className="ehr-primary-button mt-4 min-h-11 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white">{sent ? 'Sent to pharmacy' : 'Send to pharmacy'}</button></div><div className={cx('ehr-connection-line mx-7', sent && 'is-sent')} /><div className={cx('ehr-pharmacy-receipt ml-auto w-[82%] rounded-xl border border-brand/15 bg-white p-4', sent ? 'ehr-receipt-visible' : 'opacity-45')}><p className="text-[11px] font-semibold tracking-[0.08em] text-brand">PRESCRIPTION RECEIVED</p><p className="mt-2 text-[13px] font-semibold text-ink">Cedar Pharmacy</p><p className="text-[12px] text-muted">12 Mar 2024 · 10:24</p><div className="mt-3"><Status tone="muted">Awaiting dispensing</Status></div></div></div>
}

function Laboratory({ reduced, active }: { reduced: boolean; active: boolean }) {
  const [stage, setStage] = useState(0)
  useEffect(() => { if (!active) return; if (reduced) { setStage(3); return }; const timers = [window.setTimeout(() => setStage(1), 550), window.setTimeout(() => setStage(2), 1100), window.setTimeout(() => setStage(3), 1750)]; return () => timers.forEach(window.clearTimeout) }, [active, reduced])
  const steps = ['Requested', 'Collected', 'Processing', 'Verified']
  return <div className="mt-8 rounded-(--radius-card) border border-line bg-surface-tint p-4 sm:p-5"><div className="flex items-start justify-between gap-4"><div><p className="font-mono text-[11px] font-semibold tracking-[0.1em] text-faint">FULL BLOOD COUNT (FBC)</p><p className="mt-2 text-[13px] font-semibold text-ink">LAB-28471 <span className="font-normal text-muted">· {PATIENT}</span></p></div><span className="text-brand"><Icon name="flask" /></span></div><ol className="mt-6 grid grid-cols-4 gap-1" aria-label="Laboratory result progress">{steps.map((item, index) => <li key={item} title={`${['09:14', '10:02', '11:48', '14:32'][index]}`} className="relative text-center"><span className={cx('mx-auto grid h-7 w-7 place-items-center rounded-full border text-[11px] font-semibold', index <= stage ? 'border-brand bg-brand text-white' : 'border-line bg-white text-muted')}>{index < stage ? <Icon name="check" /> : index + 1}</span>{index < 3 ? <span aria-hidden="true" className={cx('absolute top-3.5 left-[58%] h-px w-[84%]', index < stage ? 'bg-brand' : 'bg-line')} /> : null}<span className="mt-2 block text-[10px] font-medium text-muted">{item}</span></li>)}</ol>{stage === 3 ? <div className="ehr-lab-result mt-6 rounded-xl border border-brand/15 bg-white p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-semibold tracking-[0.08em] text-brand">RESULT VERIFIED</p><p className="mt-2 text-[13px] font-semibold text-ink">Full Blood Count</p><p className="text-[12px] text-muted">Released: 12 Mar 2024 · 14:32</p></div><Status tone="success">Released</Status></div><div className="mt-4 flex items-center justify-between border-t border-line pt-3"><button type="button" className="text-[13px] font-semibold text-brand">View result →</button><span className="text-[12px] text-positive">✓ Added to connected record</span></div></div> : null}</div>
}

function VitalsDocuments() {
  const [recorded, setRecorded] = useState(false)
  return <div className="mt-8 rounded-(--radius-card) border border-line bg-surface-tint p-4 sm:p-5"><p className="font-mono text-[11px] font-semibold tracking-[0.1em] text-faint">ENCOUNTER VITALS</p><div className="mt-4 flex items-center gap-3 rounded-xl border border-line bg-white p-3"><span className={cx('grid h-9 w-9 place-items-center rounded-lg', recorded ? 'bg-brand text-white' : 'bg-brand-tint text-brand')}><Icon name={recorded ? 'check' : 'clipboard'} /></span><div><p className="text-[13px] font-semibold text-ink">{PATIENT}</p><p className="text-[12px] text-muted">{HEALTH_ID} · Blood pressure 120/80</p></div><div className="ml-auto"><Status tone={recorded ? 'success' : 'blue'}>{recorded ? 'Recorded' : 'Draft'}</Status></div></div><button type="button" onClick={() => setRecorded(true)} className="ehr-primary-button mt-4 min-h-11 rounded-xl bg-brand px-4 text-[13px] font-semibold text-white">{recorded ? 'Vitals recorded' : 'Record vitals'}</button>{recorded ? <div className="ehr-admission-result mt-4 rounded-xl border border-brand/15 bg-white p-3"><p className="text-[11px] font-semibold tracking-[0.08em] text-brand">ENCOUNTER UPDATED</p><p className="mt-1 text-[13px] font-semibold text-ink">Vitals · {PATIENT}</p><p className="mt-1 text-[12px] text-muted">Clinical documents can be attached to the same encounter.</p></div> : null}</div>
}

const activity = [
  { type: 'Access', action: 'Patient record viewed', by: 'Dr. Ahmed Yusuf', time: 'Today · 10:24', icon: 'person' as const },
  { type: 'Clinical', action: 'Prescription created', by: 'Dr. Ahmed Yusuf', time: 'Today · 09:18', icon: 'pill' as const },
  { type: 'Clinical', action: 'Laboratory result released', by: 'Lab Scientist · S. Johnson', time: 'Yesterday · 16:42', icon: 'flask' as const },
  { type: 'Administrative', action: 'Document attached', by: 'Nurse A. Bello', time: '12 Mar · 14:10', icon: 'clipboard' as const },
]

function RolesAudit() {
  const [filter, setFilter] = useState('All activity')
  const [expanded, setExpanded] = useState<string | null>(null)
  const shown = filter === 'All activity' ? activity : activity.filter(item => item.type === filter)
  return <div className="mt-8 rounded-(--radius-card) border border-line bg-surface-tint p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><p className="font-mono text-[11px] font-semibold tracking-[0.1em] text-faint">RECENT ACTIVITY</p><div className="flex gap-1" role="tablist" aria-label="Audit activity filter">{['All activity', 'Access', 'Clinical', 'Administrative'].map(item => <button type="button" key={item} role="tab" aria-selected={filter === item} onClick={() => { setFilter(item); setExpanded(null) }} className={cx('min-h-9 rounded-lg px-2 text-[11px] font-semibold', filter === item ? 'bg-brand text-white' : 'text-muted hover:bg-white hover:text-ink')}>{item === 'All activity' ? 'All' : item}</button>)}</div></div><ul className="mt-4 divide-y divide-line">{shown.map(item => <li key={item.action}><button type="button" onClick={() => setExpanded(expanded === item.action ? null : item.action)} className="ehr-audit-row flex min-h-12 w-full items-center gap-3 py-3 text-left"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white text-brand"><Icon name={item.icon} /></span><span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold text-ink">{item.action}</span><span className="block truncate text-[12px] text-muted">{item.by} · {item.time}</span></span><span className="text-[12px] font-semibold text-brand">{expanded === item.action ? 'Hide' : 'View details →'}</span></button>{expanded === item.action ? <div className="ehr-audit-detail mb-3 rounded-lg border border-line bg-white p-3 text-[12px] text-muted"><p><b className="text-ink">Action:</b> {item.action}</p><p className="mt-1"><b className="text-ink">Performed by:</b> {item.by}</p><p className="mt-1"><b className="text-ink">Role:</b> {item.type === 'Access' ? 'Doctor' : item.type}</p><p className="mt-1"><b className="text-ink">Reason:</b> Active consultation</p></div> : null}</li>)}</ul></div>
}

/** Six miniature EHR experiences rather than six feature-description cards. */
export function EhrWorkflowBento() {
  return (
    <Section id="workflows" labelledBy="ehr-workflows-title">
      <Wrap>
        <section aria-labelledby="ehr-workflows-title">
          <div className="mx-auto max-w-[680px] text-center">
            <p className="font-mono text-[12px] font-semibold tracking-[0.12em] text-brand">CORE WORKFLOW</p>
            <h2 id="ehr-workflows-title" className="mt-4 font-display text-[clamp(2rem,3.5vw,2.5rem)] leading-[1.08] tracking-[-0.025em] text-ink">From registration to ongoing care.</h2>
            <p className="mt-5 text-[16px]/relaxed text-muted">Illustrative steps with sample patients and dates, showing supported clinical record concepts.</p>
          </div>
          <div className="ehr-bento-grid bento-grid mt-12 grid gap-4 md:grid-cols-2 sm:mt-16 lg:grid-cols-12">
            <WorkflowCard number="01" title="Registration" copy="Find an existing patient by their Health ID before creating a new record, helping prevent duplicate patient identities." delay={0} className="lg:col-span-5">{state => <Registration reduced={state.reduced} active={state.active} />}</WorkflowCard>
            <WorkflowCard number="02" title="Consultation" copy="Record presenting complaints, examination findings, diagnoses, and treatment plans, all linked to the patient encounter." delay={80} className="lg:col-span-7">{state => <Consultation reduced={state.reduced} active={state.active} />}</WorkflowCard>
            <WorkflowCard number="03" title="Prescriptions" copy="Create and route prescriptions to a connected pharmacy for authorised dispensing workflows while keeping the patient's medication history up to date." delay={160} className="lg:col-span-5">{() => <Prescriptions />}</WorkflowCard>
            <WorkflowCard number="04" title="Laboratory tests" copy="Order laboratory tests and receive verified results in the patient's record when released to the authorised care team." delay={240} className="md:col-span-2 lg:col-span-7">{state => <Laboratory reduced={state.reduced} active={state.active} />}</WorkflowCard>
            <WorkflowCard number="05" title="Vitals and documents" copy="Record encounter vitals and attach clinical documents to the patient's record under authorised access." delay={320} className="lg:col-span-5">{() => <VitalsDocuments />}</WorkflowCard>
            <WorkflowCard number="06" title="Roles and audit" copy="Limit doctors, nurses, receptionists, and administrators to organisation-approved roles, permissions and care activities. Keep a clear audit trail of access and actions." delay={400} className="md:col-span-2 lg:col-span-7">{() => <RolesAudit />}</WorkflowCard>
          </div>
        </section>
      </Wrap>
    </Section>
  )
}
