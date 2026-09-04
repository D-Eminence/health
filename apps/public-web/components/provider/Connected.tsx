import { Card, Display, Section, SectionHeader, TextLink, Wrap } from '@hid/ui'
import {
  ACCESS_SECTION,
  API_SECTION,
  IDENTITY_SECTION,
  MIGRATE_SECTION,
} from '@/content/provider'
import { ROUTES } from '@/content/site'

/**
 * The identity band.
 *
 * Inverted, because it is the claim the whole platform rests on and the page
 * should slow down here. Colours come from the inverse tokens rather than
 * hard-coded values, so the band stays consistent with the rest of the system.
 */
export function IdentitySection() {
  return (
    <Section id="identity" tone="inverse" labelledBy="identity-title">
      <Wrap>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16">
          <div className="flex flex-col gap-4">
            <SectionHeader
              eyebrow={IDENTITY_SECTION.eyebrow}
              id="identity-title"
              title={IDENTITY_SECTION.title}
              lede={IDENTITY_SECTION.lede}
              align="left"
              tone="inverse"
              size="md"
            />
            <p className="mt-2 font-display text-[19px] text-white/90">
              {IDENTITY_SECTION.strapline}
            </p>
          </div>

          <ul className="flex flex-col gap-3">
            {IDENTITY_SECTION.touchpoints.map(touchpoint => (
              <li
                key={touchpoint.place}
                className="flex items-center gap-4 rounded-(--radius-card) border border-white/12 bg-white/5 px-5 py-4"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[15px] font-semibold text-white">{touchpoint.place}</span>
                  <span className="text-sm text-inverse-muted">{touchpoint.event}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 rounded-(--radius-control) bg-white/10 px-3 py-1.5 text-[12px] font-medium text-white/85">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-positive" />
                  Connected
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Wrap>
    </Section>
  )
}

/** How access is controlled. The list a compliance reviewer will read first. */
export function AccessSection() {
  return (
    <Section id="access" labelledBy="access-title">
      <Wrap>
        <SectionHeader
          id="access-title"
          title={ACCESS_SECTION.title}
          lede={ACCESS_SECTION.lede}
          size="md"
        />

        <ul className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {ACCESS_SECTION.controls.map(control => (
            <li key={control.title}>
              <Card className="flex h-full flex-col gap-2 p-6">
                <h3 className="text-[15px] font-semibold text-ink">{control.title}</h3>
                <p className="text-sm/relaxed text-muted">{control.body}</p>
              </Card>
            </li>
          ))}
        </ul>
      </Wrap>
    </Section>
  )
}

/**
 * The migration pipeline.
 *
 * Numbered because it genuinely is a sequence — a facility cannot validate
 * before it has captured — not because numbering looks orderly.
 */
export function MigrateSection() {
  return (
    <Section id="migrate" tone="sunk" labelledBy="migrate-title">
      <Wrap>
        <div className="flex flex-col gap-4">
          <SectionHeader
            eyebrow={MIGRATE_SECTION.eyebrow}
            id="migrate-title"
            title={MIGRATE_SECTION.title}
            lede={MIGRATE_SECTION.lede}
            align="left"
            size="md"
          />
          <TextLink href={ROUTES.product('migrate')} className="mt-1">
            Explore Health ID Migrate <span aria-hidden="true">&rarr;</span>
          </TextLink>
        </div>

        <ol className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {MIGRATE_SECTION.stages.map(stage => (
            <li key={stage.step}>
              <Card className="flex h-full flex-col gap-2 p-5">
                <span className="font-mono text-[12px] font-medium text-brand tabular-nums">
                  {stage.step}
                </span>
                <h3 className="text-[15px] font-semibold text-ink">{stage.title}</h3>
                <p className="text-[13px]/relaxed text-muted">{stage.body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </Wrap>
    </Section>
  )
}

/** Integration path for facilities that already run software they like. */
export function ApiSection() {
  return (
    <Section id="api" labelledBy="api-title">
      <Wrap>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:gap-16">
          <div className="flex flex-col gap-4">
            <SectionHeader
              eyebrow={API_SECTION.eyebrow}
              id="api-title"
              title={API_SECTION.title}
              lede={API_SECTION.lede}
              align="left"
              size="md"
            />
            <TextLink href={ROUTES.product('api')} className="mt-1">
              Explore Health ID API <span aria-hidden="true">&rarr;</span>
            </TextLink>
          </div>

          {/* The chain reads top to bottom as an ordered list, so the
              relationship survives without the arrows, which are decorative. */}
          <ol className="flex flex-col items-stretch gap-0">
            {API_SECTION.chain.map((node, index) => (
              <li key={node} className="flex flex-col items-center">
                <div className="w-full rounded-(--radius-card) border border-line bg-surface px-5 py-3.5 text-center text-[15px] font-medium text-ink">
                  {node}
                </div>
                {index < API_SECTION.chain.length - 1 ? (
                  <span aria-hidden="true" className="py-1.5 text-lg leading-none text-line-strong">
                    &darr;
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      </Wrap>
    </Section>
  )
}

/** Closing call to action for the provider page. */
export function ProviderClosing({
  title,
  lede,
  primary,
  secondary,
  secondaryHref,
}: {
  title: string
  lede: string
  primary: string
  secondary: string
  secondaryHref: string
}) {
  return (
    <Section rhythm="tight" tone="sunk">
      <Wrap>
        <div className="flex flex-col items-center gap-5 text-center">
          <Display as="h2" size="md">
            {title}
          </Display>
          <p className="max-w-[52ch] text-base/relaxed text-muted">{lede}</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <a
              href="#demo"
              className="inline-flex items-center justify-center rounded-(--radius-control) border border-brand bg-brand px-7 py-3.5 text-[15px] font-semibold text-white hover:bg-brand-dark"
            >
              {primary}
            </a>
            <a
              href={secondaryHref}
              className="inline-flex items-center justify-center rounded-(--radius-control) border border-line-strong bg-surface px-7 py-3.5 text-[15px] font-semibold text-ink hover:border-brand hover:text-brand"
            >
              {secondary}
            </a>
          </div>
        </div>
      </Wrap>
    </Section>
  )
}
