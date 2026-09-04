import Image from 'next/image'
import { ButtonLink, Card, Display, Eyebrow, Section, SectionHeader, Wrap } from '@hid/ui'
import {
  PATIENT_CONTROL,
  PATIENT_CTA,
  PATIENT_HERO,
  PATIENT_JOURNEY,
  PATIENT_STEPS,
  PATIENT_UPLOAD,
} from '@/content/patient'
import { APP_ENTRY } from '@/content/site'

export function PatientHero() {
  return (
    <section className="relative overflow-hidden bg-linear-to-b from-brand-tint/50 to-surface">
      <Wrap className="pt-14 pb-16 sm:pt-18">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-14">
          <div className="flex flex-col items-start gap-5">
            <Eyebrow tone="outline">{PATIENT_HERO.eyebrow}</Eyebrow>

            <h1 className="font-display text-[clamp(2.25rem,5vw,3.75rem)] leading-[1.05] font-normal tracking-[-0.02em] text-balance">
              {PATIENT_HERO.headline}
              <br />
              <span className="text-brand">{PATIENT_HERO.headlineAccent}</span>
            </h1>

            <p className="max-w-[52ch] text-base/relaxed text-muted">{PATIENT_HERO.lede}</p>

            <div className="mt-1 flex flex-wrap items-center gap-3">
              <ButtonLink href={APP_ENTRY.patientSignUp}>{PATIENT_HERO.primary}</ButtonLink>
              <ButtonLink href="#steps" tone="secondary">
                {PATIENT_HERO.secondary}
              </ButtonLink>
            </div>

            <p className="text-[13px] font-medium text-faint">{PATIENT_HERO.footnote}</p>
          </div>

          <div className="justify-self-center">
            <Image
              src="/brand/patient-app.png"
              alt="The Health ID patient app showing a connected health record"
              width={520}
              height={420}
              className="h-auto w-full max-w-[460px]"
              priority
            />
          </div>
        </div>
      </Wrap>
    </section>
  )
}

/** The three steps. A real sequence, so it is an ordered list. */
export function PatientSteps() {
  return (
    <Section id="steps" tone="sunk" labelledBy="steps-title">
      <Wrap>
        <SectionHeader id="steps-title" title={PATIENT_STEPS.title} size="md" />

        <ol className="mt-12 grid gap-4 lg:grid-cols-3">
          {PATIENT_STEPS.steps.map(step => (
            <li key={step.step}>
              <Card className="flex h-full flex-col gap-2.5 p-7">
                <span className="font-mono text-[12px] font-medium text-brand tabular-nums">
                  {step.step}
                </span>
                <Display as="h3" size="sm">
                  {step.title}
                </Display>
                <p className="text-[15px]/relaxed text-muted">{step.body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </Wrap>
    </Section>
  )
}

/**
 * A year in one patient's record.
 *
 * Rendered as a timeline because the moments are dated and their order is the
 * argument: each visit builds on the last without the patient repeating themselves.
 */
export function PatientJourney() {
  return (
    <Section labelledBy="journey-title">
      <Wrap>
        <SectionHeader
          eyebrow={PATIENT_JOURNEY.eyebrow}
          id="journey-title"
          title={PATIENT_JOURNEY.title}
          lede={PATIENT_JOURNEY.lede}
          size="md"
        />

        <ol className="mx-auto mt-12 flex max-w-[720px] flex-col">
          {PATIENT_JOURNEY.moments.map((moment, index) => (
            <li key={moment.when} className="grid grid-cols-[auto_1fr] gap-x-5">
              <div className="flex flex-col items-center">
                <span
                  aria-hidden="true"
                  className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand"
                />
                {index < PATIENT_JOURNEY.moments.length - 1 ? (
                  <span aria-hidden="true" className="w-px flex-1 bg-line" />
                ) : null}
              </div>

              <div className="pb-8">
                <p className="flex flex-wrap items-baseline gap-x-2.5">
                  <span className="font-mono text-[12px] font-medium tracking-[0.06em] text-brand uppercase">
                    {moment.when}
                  </span>
                  <span className="text-[15px] font-semibold text-ink">{moment.where}</span>
                </p>
                <p className="mt-1.5 text-[15px]/relaxed text-muted">{moment.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Wrap>
    </Section>
  )
}

/** The consent guarantees, on an inverted band. */
export function PatientControl() {
  return (
    <Section id="control" tone="inverse" labelledBy="control-title">
      <Wrap>
        <SectionHeader
          eyebrow={PATIENT_CONTROL.eyebrow}
          id="control-title"
          title={PATIENT_CONTROL.title}
          lede={PATIENT_CONTROL.lede}
          tone="inverse"
          size="md"
        />

        <ul className="mt-12 grid gap-4 md:grid-cols-2">
          {PATIENT_CONTROL.guarantees.map(guarantee => (
            <li
              key={guarantee.title}
              className="flex flex-col gap-2 rounded-(--radius-panel) border border-white/12 bg-white/5 p-6"
            >
              <h3 className="text-[16px] font-semibold text-white">{guarantee.title}</h3>
              <p className="text-[15px]/relaxed text-inverse-muted">{guarantee.body}</p>
            </li>
          ))}
        </ul>
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
          <ButtonLink href={APP_ENTRY.patientSignUp}>{PATIENT_CTA.action}</ButtonLink>
        </div>
      </Wrap>
    </Section>
  )
}
