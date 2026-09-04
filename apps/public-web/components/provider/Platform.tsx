import Link from 'next/link'
import { Card, Display, Lede, Section, SectionHeader, TextLink, Wrap } from '@hid/ui'
import { ADOPTION_PATHS, EHR_SECTION, FEATURES, PLATFORM, STANDARDS } from '@/content/provider'
import { PARTNERS, ROUTES } from '@/content/site'

/**
 * Partner strip.
 *
 * A static list rather than a scrolling marquee: three names do not need
 * motion, and a moving band is a nuisance for anyone reading slowly.
 */
export function PartnerStrip() {
  return (
    <div className="border-y border-line bg-surface-tint py-8">
      <Wrap>
        <div className="flex flex-col items-center gap-5">
          <p className="font-mono text-[11px] tracking-[0.14em] text-faint uppercase">
            In partnership with
          </p>
          <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
            {PARTNERS.map(partner => (
              <li key={partner} className="text-[15px] font-medium text-muted">
                {partner}
              </li>
            ))}
          </ul>
        </div>
      </Wrap>
    </div>
  )
}

/** The care pathway, stated as the sequence a patient actually moves through. */
export function PlatformSection() {
  return (
    <Section id="platform" labelledBy="platform-title">
      <Wrap>
        <SectionHeader id="platform-title" title={PLATFORM.title} lede={PLATFORM.lede} />

        <ol className="mt-12 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {PLATFORM.steps.map((step, index) => (
            <li
              key={step}
              className="flex items-center gap-3 rounded-(--radius-card) border border-line bg-surface-tint px-4 py-3.5"
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand font-mono text-[11px] font-semibold text-white tabular-nums">
                {index + 1}
              </span>
              <span className="text-[15px] font-medium text-ink">{step}</span>
            </li>
          ))}
        </ol>
      </Wrap>
    </Section>
  )
}

/**
 * The three ways into the platform.
 *
 * Ordered by how much software a facility already has, because that is the
 * question a reader is actually trying to answer about themselves.
 */
export function AdoptionSection() {
  return (
    <Section tone="sunk" labelledBy="adoption-title">
      <Wrap>
        <SectionHeader
          eyebrow="Integrate, don’t replace"
          id="adoption-title"
          title="Start from wherever you are."
          lede="We have never asked a facility to throw away working software. There are three ways in, and the one you take depends on what you already have."
        />

        <ul className="mt-12 grid gap-4 lg:grid-cols-3">
          {ADOPTION_PATHS.map(path => (
            <li key={path.slug} className="flex">
              <Card className="flex flex-1 flex-col gap-3 p-7">
                <p className="font-mono text-[11px] tracking-[0.1em] text-faint uppercase">
                  {path.situation}
                </p>
                <Display as="h3" size="sm">
                  {path.product}
                </Display>
                <p className="text-[15px]/relaxed text-muted">{path.body}</p>
                <TextLink
                  href={ROUTES.product(path.slug)}
                  className="mt-auto pt-3 text-[15px]"
                  aria-label={`Learn more about ${path.product}`}
                >
                  Learn more <span aria-hidden="true">&rarr;</span>
                </TextLink>
              </Card>
            </li>
          ))}
        </ul>
      </Wrap>
    </Section>
  )
}

/**
 * Feature grid.
 *
 * The first item spans two columns on wide screens because patient search is
 * the entry point to every other workflow, not because a bento needs a big tile.
 */
export function FeaturesSection() {
  const [lead, ...rest] = FEATURES.items

  return (
    <Section id="features" labelledBy="features-title">
      <Wrap>
        <SectionHeader
          eyebrow={FEATURES.eyebrow}
          id="features-title"
          title={FEATURES.title}
          lede={FEATURES.lede}
        />

        <ul className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {lead ? (
            <li className="lg:col-span-2">
              <Card className="flex h-full flex-col gap-2.5 p-7">
                <Display as="h3" size="sm">
                  {lead.title}
                </Display>
                <p className="max-w-[52ch] text-[15px]/relaxed text-muted">{lead.body}</p>
              </Card>
            </li>
          ) : null}

          {rest.map(feature => (
            <li key={feature.title}>
              <Card className="flex h-full flex-col gap-2.5 p-7">
                <Display as="h3" size="sm">
                  {feature.title}
                </Display>
                <p className="text-[15px]/relaxed text-muted">{feature.body}</p>
              </Card>
            </li>
          ))}
        </ul>
      </Wrap>
    </Section>
  )
}

/** Standards the product is built around — with the disclaimer the design insists on. */
export function StandardsSection() {
  return (
    <Section id="standards" tone="sunk" labelledBy="standards-title">
      <Wrap>
        <SectionHeader
          eyebrow={STANDARDS.eyebrow}
          id="standards-title"
          title={STANDARDS.title}
        />

        <ul className="mt-12 grid gap-4 sm:grid-cols-2">
          {STANDARDS.items.map(standard => (
            <li key={standard.name}>
              <Card className="flex h-full flex-col gap-2 p-6">
                <p className="font-mono text-[13px] font-medium text-brand">{standard.name}</p>
                <p className="text-[15px] font-semibold text-ink">{standard.summary}</p>
                <p className="text-sm/relaxed text-muted">{standard.body}</p>
              </Card>
            </li>
          ))}
        </ul>

        <Lede align="center" className="mt-8 max-w-[62ch] text-[13px]">
          {STANDARDS.disclaimer}
        </Lede>
      </Wrap>
    </Section>
  )
}

/** What Health ID EHR covers, grouped by where it sits in an encounter. */
export function EhrSection() {
  return (
    <Section id="ehr" labelledBy="ehr-title">
      <Wrap>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
          <div className="flex flex-col gap-4">
            <SectionHeader
              eyebrow={EHR_SECTION.eyebrow}
              id="ehr-title"
              title={EHR_SECTION.title}
              lede={EHR_SECTION.lede}
              align="left"
              size="md"
            />
            <Link
              href={ROUTES.product('ehr')}
              className="mt-2 font-semibold text-brand hover:text-brand-dark"
            >
              Explore Health ID EHR <span aria-hidden="true">&rarr;</span>
            </Link>
          </div>

          <ul className="flex flex-col gap-3">
            {EHR_SECTION.groups.map(group => (
              <li key={group.title}>
                <Card className="p-6">
                  <h3 className="font-mono text-[11px] tracking-[0.1em] text-faint uppercase">
                    {group.title}
                  </h3>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {group.items.map(item => (
                      <li
                        key={item}
                        className="rounded-(--radius-control) bg-surface-sunk px-3 py-1.5 text-[13px] text-ink"
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      </Wrap>
    </Section>
  )
}
