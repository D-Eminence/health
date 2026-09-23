import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import Image from 'next/image'
import { Card, Display, Eyebrow, Section, Wrap } from '@hid/ui'
import { ProviderNav } from '@/components/layout/SiteNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { DemoDialog } from '@/components/shared/DemoDialog'
import { BackToTop } from '@/components/shared/BackToTop'
import { HeroDemoButton } from '@/components/shared/HeroDemoButton'
import { HeroBackground } from '@/components/shared/HeroBackground'
import { CtaBand } from '@/components/shared/CtaBand'
import { HealthIcon } from '@/components/shared/HealthIcon'
import { HealthIDModuleShowcase } from '@/components/product/HealthIDModuleShowcase'
import { AboutNavigation } from '@/components/about/AboutNavigation'
import { ABOUT_MODULES, ABOUT_PRODUCTS, APPROACH, AUDIENCES, CARE_STEPS, CONNECTED_SYSTEMS, DEPARTMENTS, FOLDER_SECTIONS, FRAGMENTATION, MIGRATION_STEPS, TEAM, TRUST_PRINCIPLES, WORKFLOW_CONTEXT } from '@/content/about'
import './about.css'

export const metadata: Metadata = {
  title: 'About Health ID',
  description: 'Building the infrastructure for connected healthcare. Discover how Health ID brings identity, records, and healthcare operations into one ecosystem.',
}

function Heading({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children?: ReactNode }) {
  return <div className="about-heading"><Eyebrow>{eyebrow}</Eyebrow><Display id={id} as="h2" size="md">{title}</Display>{children && <div className="about-prose">{children}</div>}</div>
}

function Flow({ steps, label }: { steps: readonly string[]; label: string }) {
  return <ol aria-label={label} className="about-flow">{steps.map((step, index) => <li key={step}>
    <span className="about-flow-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><span>{step}</span>
    {index < steps.length - 1 && <span className="about-flow-arrow" aria-hidden="true">→</span>}
  </li>)}</ol>
}

export default function AboutPage() {
  return <>
    <ProviderNav />
    <main id="main" className="about-page">
      <AboutNavigation />
      <div className="about-content">
      <Section labelledBy="about-title" className="about-hero"><Wrap><div className="about-hero-grid">
        <div className="about-heading">
          <Eyebrow>About Health ID</Eyebrow>
          <Display as="h1" id="about-title">Building the infrastructure for connected healthcare.</Display>
          <p className="about-prose">Health ID is creating the digital infrastructure that helps healthcare organizations identify patients, manage care, digitize legacy records, and connect healthcare services across one ecosystem.</p>
          <p className="about-brand-line">One Health Identity. Connected Care. Accessible Records.</p>
          <div className="flex flex-wrap gap-3"><HeroDemoButton href="/products">Explore our products</HeroDemoButton><HeroDemoButton variant="secondary">Book a demo</HeroDemoButton></div>
        </div>
        <div className="about-ecosystem" aria-label="Health identity connects records, care, and healthcare services">
          <span className="about-caption">One connected ecosystem</span>
          <div className="about-identity"><HealthIcon name="person" size={30} /><span>Health Identity<small>The patient at the centre.</small></span></div>
          <div className="about-ecosystem-line" aria-hidden="true" />
          <div className="about-ecosystem-products">{ABOUT_PRODUCTS.slice(1).map(product => <div key={product.slug}><span>{product.mark}</span>{product.name.replace('Health ID ', '')}</div>)}</div>
          <p>Identity, records, and operations.<br />Designed to work together.</p>
        </div>
      </div></Wrap></Section>

      <Section labelledBy="why-title" rhythm="tight"><Wrap><div className="about-split">
        <Heading id="why-title" eyebrow="Why Health ID exists" title="Healthcare should not start over every time a patient walks through a new door.">
          <p>Across many healthcare systems, patient information is fragmented across paper folders, disconnected hospital systems, laboratories, pharmacies, outreach programs, and separate providers.</p>
          <p className="font-semibold text-ink">Health ID exists to reduce that fragmentation.</p>
          <p>We are building an ecosystem where identity, records, and healthcare operations can work together while still allowing each organization to use the tools that fit its needs.</p>
        </Heading>
        <ul className="about-fragmentation">{FRAGMENTATION.map((item, index) => <li key={item}><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{item}</li>)}</ul>
      </div></Wrap></Section>

      <Section tone="sunk" labelledBy="products-title"><Wrap>
        <Heading id="products-title" eyebrow="What Health ID is" title="More than a patient identity."><p>Health ID started with a simple idea: a patient should not lose continuity of care because they changed hospitals.</p><p>That idea has grown into a wider healthcare infrastructure platform. Today, Health ID brings together:</p></Heading>
        <HealthIDModuleShowcase items={ABOUT_MODULES} embedded />
      </Wrap></Section>

      <Section labelledBy="approach-title"><Wrap>
        <Heading id="approach-title" eyebrow="Our approach" title="Start with what already exists. Connect what comes next."><p>Health ID is not based on the assumption that every healthcare organization needs to replace everything it already uses. Our approach is modular.</p></Heading>
        <ol className="about-approach mt-12">{APPROACH.map((item, index) => <li key={item.label}>
          <span className="about-caption">0{index + 1} / Your path forward</span><p className="about-approach-label">{item.label}</p><h3 className="font-semibold">{item.title}</h3><p className="about-prose mt-3">{item.body}</p>
          {index < APPROACH.length - 1 && <span className="about-or">OR</span>}
        </li>)}</ol>
      </Wrap></Section>

      <Section tone="wash" labelledBy="patient-title"><Wrap><div className="about-split items-center">
        <Heading id="patient-title" eyebrow="The patient is the common thread" title="Different providers. One continuing health journey.">
          <p>A patient may register at one hospital, perform a test at another laboratory, fill a prescription somewhere else, and receive care months later at a different facility.</p>
          <p>Health ID is designed so those interactions do not have to exist as isolated events.</p><p>With appropriate access and permissions, the patient’s identity becomes the common thread that connects their healthcare journey.</p>
        </Heading>
        <div className="about-folder"><div className="about-folder-tab" aria-hidden="true"><HealthIcon name="file" /> Health ID</div><Display as="h3" size="sm">The patient folder. Reimagined.</Display><ul>{FOLDER_SECTIONS.map(item => <li key={item}><HealthIcon name="file" size={17} /><span>{item}</span><HealthIcon name="check" size={16} /></li>)}</ul></div>
      </div></Wrap></Section>

      <Section labelledBy="paper-title"><Wrap>
        <Heading id="paper-title" eyebrow="From paper to connected care" title="Digital transformation should not mean abandoning the past."><p>Many healthcare organizations already have years or decades of medical records stored in physical folders. Health ID Migrate helps organizations bring those records forward.</p></Heading>
        <Flow steps={MIGRATION_STEPS} label="From paper folder to digital patient folder" />
        <div className="about-callout"><HealthIcon name="file" size={24} /><div><p className="font-semibold">The original source record remains traceable alongside the structured digital data.</p><p className="about-prose mt-2">Healthcare organizations should not have to choose between their history and their future.</p></div></div>
      </Wrap></Section>

      <Section tone="sunk" labelledBy="workflow-title"><Wrap>
        <Heading id="workflow-title" eyebrow="Built around real healthcare workflows" title="Technology should follow the way healthcare teams actually work."><p>Health ID products are designed around role-based workflows. Each stage carries the context the next person needs.</p></Heading>
        <Flow steps={CARE_STEPS} label="An example care workflow" />
        <p className="mb-5 font-semibold">The system is designed so each person sees:</p><ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{WORKFLOW_CONTEXT.map(item => <li className="about-context" key={item}><HealthIcon name="check" /><p>{item}</p></li>)}</ul>
      </Wrap></Section>

      <Section labelledBy="modular-title"><Wrap><div className="about-split">
        <Heading id="modular-title" eyebrow="Designed to be modular" title="Every healthcare organization works differently."><p>A small clinic does not need the same system as a teaching hospital. A maternity centre does not need the same modules as a diagnostic centre.</p><p>Health ID allows organizations to activate only the departments and products they need.</p><p className="font-semibold text-brand">Start small. Add more when the organization is ready.</p></Heading>
        <ul className="about-departments">{DEPARTMENTS.map(item => <li key={item}><HealthIcon name="check" size={18} />{item}</li>)}</ul>
      </div></Wrap></Section>

      <Section tone="wash" labelledBy="interoperability-title"><Wrap><div className="about-split items-center">
        <Heading id="interoperability-title" eyebrow="Interoperability" title="Healthcare systems should be able to work together."><p>Health ID is being built so organizations can either use Health ID products directly or connect existing systems through APIs.</p><p>The long-term goal is not to create another isolated healthcare database. It is to make healthcare information easier to connect securely across the systems and organizations involved in care.</p></Heading>
        <div className="about-api" aria-label="Existing healthcare systems connect through the Health ID API to the Health ID ecosystem"><ul>{CONNECTED_SYSTEMS.map(item => <li key={item}>{item}</li>)}</ul><span className="about-api-arrow" aria-hidden="true">↓</span><div className="about-api-hub"><HealthIcon name="code" size={24} />Health ID API</div><span className="about-api-arrow" aria-hidden="true">↓</span><div className="about-api-destination">Health ID Ecosystem</div><p className="mt-4 text-xs text-muted">Our direction for connected healthcare.</p></div>
      </div></Wrap></Section>

      <Section labelledBy="trust-title"><Wrap>
        <Heading id="trust-title" eyebrow="Trust, access and accountability" title="Healthcare data requires more than convenience."><p>Our approach to healthcare information is built around concrete principles.</p></Heading>
        <ul className="about-trust mt-10">{TRUST_PRINCIPLES.map(item => <li key={item}><HealthIcon name="shield" size={22} />{item}</li>)}</ul>
        <p className="mt-10 border-t border-line pt-6 text-lg font-medium">Access to healthcare information should be deliberate, visible, and accountable.</p>
      </Wrap></Section>

      <Section tone="sunk" labelledBy="audiences-title"><Wrap>
        <Heading id="audiences-title" eyebrow="Who we are building for" title="Built for the healthcare ecosystem." />
        <ul className="about-card-grid mt-10">{AUDIENCES.map(item => <li key={item.title}><Card className="h-full p-6"><Display as="h3" size="sm">{item.title}</Display><p className="mt-3 text-sm/relaxed text-muted">{item.body}</p></Card></li>)}</ul>
      </Wrap></Section>

      <Section labelledBy="team-title" rhythm="tight"><Wrap>
        <Heading id="team-title" eyebrow="Our team" title="The people building Health ID." />
        <ul className="about-card-grid mt-10">{TEAM.map(person => <li key={person.name}>
          <Card className="team-card">
            <div className="team-card-portrait">
              {person.photo ? <Image src={person.photo} alt={person.name} width={640} height={820} className={`team-card-image${person.name === 'Abdulrahman Umar' ? ' team-card-image-abdulrahman' : person.name === 'Abeki Faridat' ? ' team-card-image-abeki' : person.name === 'Hikmah Owoade' ? ' team-card-image-hikmah' : ''}`} /> : <div className="team-card-placeholder" aria-label={`Portrait of ${person.name} coming soon`}><svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="32" cy="23" r="12" fill="currentColor" opacity=".48"/><path d="M10 60c1.5-14 9.5-21 22-21s20.5 7 22 21" fill="currentColor" opacity=".32"/></svg></div>}
            </div>
            <div className="team-card-body">
              <Display as="h3" size="sm">{person.name}</Display>
              <p className="team-card-role">{person.role}</p>
              {person.bio && <p className="team-card-bio">{person.bio}</p>}
              <div className="team-card-link-wrap">
                {person.linkedin ? <>
                <a href={person.linkedin} target="_blank" rel="noopener noreferrer" aria-label={`${person.name} on LinkedIn (opens in a new tab)`} className="team-card-link">
                  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.45 2H3.55C2.69 2 2 2.68 2 3.52v16.96c0 .84.69 1.52 1.55 1.52h16.9c.86 0 1.55-.68 1.55-1.52V3.52c0-.84-.69-1.52-1.55-1.52ZM7.93 18.75H4.98V9.2h2.95v9.55ZM6.45 7.9a1.71 1.71 0 1 1 0-3.42 1.71 1.71 0 0 1 0 3.42Zm12.3 10.85H15.8V14.1c0-1.11-.02-2.54-1.55-2.54-1.55 0-1.79 1.21-1.79 2.46v4.73H9.51V9.2h2.83v1.3h.04c.39-.74 1.36-1.52 2.79-1.52 2.99 0 3.54 1.97 3.54 4.53v5.24Z" /></svg>
                  LinkedIn profile
                </a>
                </> : <span className="team-card-link-placeholder" aria-hidden="true" />}
              </div>
            </div>
          </Card>
        </li>)}</ul>
      </Wrap></Section>

      <Section tone="inverse" labelledBy="vision-title" className="relative isolate overflow-hidden !bg-[#05090f]"><HeroBackground /><Wrap><div className="about-vision">
        <Eyebrow tone="inverse">Our vision</Eyebrow><Display id="vision-title">A future where healthcare does not lose the patient between systems.</Display>
        <p>We are working toward a healthcare ecosystem where a patient’s identity can remain consistent across care settings, healthcare organizations can digitize without discarding their history, and providers can access the information they need without rebuilding the patient’s story from the beginning.</p>
        <span className="about-caption">The goal is simple</span><p className="about-vision-brand">One Health Identity.<br />Connected Care.<br />Accessible Records.</p>
      </div></Wrap></Section>

      <Section id="about-cta" rhythm="tight"><Wrap><CtaBand title="Build a more connected healthcare operation." lede="Whether you’re moving from paper, replacing fragmented tools, adding a laboratory or pharmacy system, or connecting an existing healthcare product, Health ID gives you a path forward." primary={{ label: 'Book a Demo', href: '#demo' }} secondary={{ label: 'Explore Health ID', href: '/products' }} /></Wrap></Section>
      </div>
    </main>
    <SiteFooter /><BackToTop /><DemoDialog />
  </>
}
