import Image from 'next/image'
import { Card, Display, Eyebrow, Section, Wrap } from '@hid/ui'
import { HeroDemoButton } from '@/components/shared/HeroDemoButton'
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
    <section className="relative isolate overflow-hidden bg-[#05090f]">
      <Image src="/brand/patient-hero-grid.jpg" alt="" fill priority className="-z-20 object-cover object-center opacity-60" />
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-black/80" />
      <Wrap className="relative pt-16 pb-0 sm:pt-24">
        <div className="mx-auto flex max-w-[1280px] flex-col items-center text-center">
          <Eyebrow tone="outline" className="patient-hero-reveal patient-hero-reveal-1 border-white/25 bg-white/10 text-white">{PATIENT_HERO.eyebrow}</Eyebrow>
          <h1 className="patient-hero-reveal patient-hero-reveal-2 mt-8 max-w-[1000px] font-display text-[clamp(2.625rem,7vw,5.5rem)] leading-[0.98] tracking-[-0.035em] text-balance">
            <span className="block text-white">{PATIENT_HERO.headline}</span>
            <span className="mt-1 block text-[#0088FF]">{PATIENT_HERO.headlineAccent}</span>
          </h1>
          <p className="patient-hero-reveal patient-hero-reveal-3 mt-8 max-w-[680px] text-[18px]/relaxed text-white/72 sm:text-[20px]/relaxed">{PATIENT_HERO.lede}</p>
          <div className="patient-hero-reveal patient-hero-reveal-4 mt-9 flex flex-col items-center gap-3 sm:flex-row">
            <HeroDemoButton href={APP_ENTRY.patientSignUp}>{PATIENT_HERO.primary}</HeroDemoButton>
            <HeroDemoButton href={APP_ENTRY.patientSignIn} variant="secondary">{PATIENT_HERO.secondary}</HeroDemoButton>
          </div>
          <div className="patient-hero-visual patient-hero-device-stage mt-12 h-[282px] w-full sm:mt-14 sm:h-[388px]">
            <HeroWidget className="patient-hero-widget-prescription" icon="rx" label="Prescription" value="Amoxicillin" status="Active" />
            <HeroWidget className="patient-hero-widget-verified" icon="check" label="Health ID" value="Identity verified" status="Secure" />
            <HeroWidget className="patient-hero-widget-dose" icon="pill" label="Medication" value="Next dose" status="8:00 PM" />
            <div className="mx-auto w-fit">
              <Image src="/brand/patient-health-record.png" alt="Health ID patient app showing the Add Health Information screen" width={1024} height={1536} className="h-auto w-[342px] max-w-none mix-blend-screen contrast-125 sm:w-[458px]" priority />
            </div>
          </div>
        </div>
      </Wrap>
    </section>
  )
}

function HeroWidget({ className, icon, label, value, status }: { className: string; icon: 'rx' | 'check' | 'pill'; label: string; value: string; status: string }) {
  return (
    <div className={`patient-hero-widget ${className}`}>
      <span className="patient-hero-widget-icon" aria-hidden="true">
        {icon === 'rx' ? <svg viewBox="0 0 24 24"><path d="M5 6h6.5a3.5 3.5 0 0 1 0 7H8l8 5" /><path d="m14 6-8 12" /></svg> : null}
        {icon === 'check' ? <svg viewBox="0 0 24 24"><path d="M12 3 19 6v5.2c0 4.1-2.8 7.8-7 9.3-4.2-1.5-7-5.2-7-9.3V6l7-3Z" /><path d="m8.6 12 2.2 2.2 4.7-5" /></svg> : null}
        {icon === 'pill' ? <svg viewBox="0 0 24 24"><path d="m7.1 16.9-1-1a4 4 0 0 1 0-5.7l4.1-4.1a4 4 0 0 1 5.7 5.7l-4.1 4.1a4 4 0 0 1-4.7 1Z" /><path d="m9.1 8.1 6.8 6.8" /></svg> : null}
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
  const icons = ['/brand/control-access.svg', '/brand/control-history.svg', '/brand/control-security.svg'] as const

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
              <Image src={icons[index] ?? icons[0]} alt="" width={86} height={108} className="patient-control-art" />
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
