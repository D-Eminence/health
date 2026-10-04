import Image from 'next/image'
import { Card, Display, Eyebrow, Section, Wrap } from '@hid/ui'
import { HeroDemoButton } from '@/components/shared/HeroDemoButton'
import { HealthIcon } from '@/components/shared/HealthIcon'
import {
  PATIENT_CONTROL,
  PATIENT_CTA,
  PATIENT_HERO,
  PATIENT_UPLOAD,
} from '@/content/patient'
import { APP_ENTRY } from '@/content/site'
import { CareJourney } from './CareJourney'

export function PatientHero() {
  return (
    <section className="relative isolate overflow-hidden bg-inverse-surface">
      <Wrap className="relative pt-16 pb-0 sm:pt-24">
        <div className="mx-auto flex max-w-[1280px] flex-col items-center text-center">
          <Eyebrow tone="inverse" className="patient-hero-reveal patient-hero-reveal-1">{PATIENT_HERO.eyebrow}</Eyebrow>
          <h1 className="patient-hero-reveal patient-hero-reveal-2 mt-6 max-w-[1000px] font-display text-[clamp(2.4375rem,4vw,3rem)] leading-[1.06] tracking-[-0.03em] text-balance">
            <span className="block text-white">{PATIENT_HERO.headline}</span>
            <span className="mt-1 block text-brand">{PATIENT_HERO.headlineAccent}</span>
          </h1>
          <p className="patient-hero-reveal patient-hero-reveal-3 mt-5 max-w-[680px] text-[15px]/[1.45] text-white/72">{PATIENT_HERO.lede}</p>
          <div className="patient-hero-reveal patient-hero-reveal-4 mt-9 flex flex-col items-center gap-3 sm:flex-row">
            <HeroDemoButton href={APP_ENTRY.patientSignUp}>{PATIENT_HERO.primary}</HeroDemoButton>
            <HeroDemoButton href={APP_ENTRY.patientSignIn} variant="secondary">{PATIENT_HERO.secondary}</HeroDemoButton>
          </div>
          <div className="patient-hero-visual patient-hero-device-stage mt-12 h-[282px] w-full sm:mt-14 sm:h-[388px]">
            <HeroWidget className="patient-hero-widget-prescription" icon="rx" label="Prescription" value="Amoxicillin" status="Active" />
            <HeroWidget className="patient-hero-widget-verified" icon="check" label="Health ID" value="Identity verified" status="Secure" />
            <HeroWidget className="patient-hero-widget-dose" icon="pill" label="Medication" value="Next dose" status="8:00 PM" />
            <div className="mx-auto w-fit">
              <Image src="/brand/patient-health-record.png" alt="Illustrative Health ID patient app concept" width={1024} height={1536} className="h-auto w-[342px] max-w-none mix-blend-screen contrast-125 sm:w-[458px]" priority />
            </div>
          </div>
          <p className="pb-5 text-xs text-white/75">Illustrative app view. Available features depend on the connected care workflow.</p>
        </div>
      </Wrap>
    </section>
  )
}

function HeroWidget({ className, icon, label, value, status }: { className: string; icon: 'rx' | 'check' | 'pill'; label: string; value: string; status: string }) {
  return (
    <div className={`patient-hero-widget ${className}`}>
      <span className="patient-hero-widget-icon" aria-hidden="true">
        <HealthIcon name={icon === 'check' ? 'shield' : 'medicine'} size={17} />
      </span>
      <span><small>{label}</small><b>{value}</b><em>{status}</em></span>
    </div>
  )
}

export { PatientSteps } from './PatientSteps'

/** A client-island so the record story can respond to scroll and direct input. */
export function PatientJourney() {
  return <CareJourney />
}

/** The consent guarantees, presented as clear patient-held controls. */
export function PatientControl() {
  const icons = ['person', 'file', 'shield'] as const

  return (
    <Section id="control" labelledBy="control-title" className="patient-control-section">
      <Wrap>
        <div className="patient-control-layout mx-auto max-w-[1180px]">
          <div className="patient-control-intro">
            <Eyebrow tone="outline">{PATIENT_CONTROL.eyebrow}</Eyebrow>
            <Display as="h2" id="control-title" size="md" className="mt-6">
              {PATIENT_CONTROL.title}
            </Display>
            <p className="mt-6 max-w-[39ch] text-[17px]/relaxed text-muted">
              {PATIENT_CONTROL.lede}
            </p>
          </div>

          <ol className="patient-control-actions">
          {PATIENT_CONTROL.guarantees.map((guarantee, index) => (
            <li
              key={guarantee.title}
              className="patient-control-action"
            >
              <span className="patient-control-index">0{index + 1}</span>
              <span className="patient-control-icon" aria-hidden="true">
                <HealthIcon name={icons[index] ?? 'shield'} size={20} />
              </span>
              <div>
                <h3>{guarantee.title}</h3>
                <p>{guarantee.body}</p>
              </div>
            </li>
          ))}
          </ol>
        </div>
      </Wrap>
    </Section>
  )
}

/** The honest note about facilities that are not connected yet. */
export function PatientUpload() {
  return (
    <Section rhythm="tight">
      <Wrap>
        <Card className="mx-auto flex max-w-[760px] flex-col items-center gap-3 bg-surface-tint p-8 text-center sm:p-10">
          <Display as="h2" size="sm">
            {PATIENT_UPLOAD.title}
          </Display>
          <p className="max-w-[62ch] text-[15px]/relaxed text-muted">{PATIENT_UPLOAD.body}</p>
        </Card>
      </Wrap>
    </Section>
  )
}

export function PatientClosing() {
  return (
    <Section rhythm="tight" tone="sunk">
      <Wrap>
        <div className="flex flex-col items-center gap-5 text-center">
          <Display as="h2" size="md">
            {PATIENT_CTA.title}
          </Display>
          <p className="max-w-[620px] text-[16px]/relaxed text-muted">{PATIENT_CTA.body}</p>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <HeroDemoButton href={APP_ENTRY.patientSignUp}>{PATIENT_CTA.action}</HeroDemoButton>
            <HeroDemoButton href={APP_ENTRY.patientSignIn} variant="secondary">{PATIENT_CTA.secondary}</HeroDemoButton>
          </div>
        </div>
      </Wrap>
    </Section>
  )
}
